/* Отправка исходящего письма (задача `email.send`, docs/architecture/email.md). Три шага, SMTP — вне транзакции:
   1) под RLS арендатора: письмо → `sending`, читаются ящик, пароль, вложения и PDF печатной формы;
   2) отправка через nodemailer (email-transport.ts);
   3) под RLS: `sent`, либо ошибка. Временная ошибка (сеть, 4xx) возвращает письмо в `queued` и бросает исключение — очередь jobs
      повторит с экспоненциальной паузой; на последней попытке (attempt >= maxAttempts) или при окончательной ошибке письмо → `failed`.
   Идемпотентность: письмо в `sent`/`failed` повторно не уходит. Если воркер упал между SMTP и записью `sent`, при возврате задачи
   письмо уйдёт ещё раз (доставка «минимум один раз»; Message-ID при этом тот же). */
import { eq } from 'drizzle-orm';
import { mailboxPasswordKey, type PrintForm } from '@erp/shared';
import type { Db, Sql } from './client';
import { withContext } from './context';
import { classifyMailError, MailError, openTransport, type OutMail } from './email-transport';
import { recordEvent } from './events';
import { getFileStore } from './file-store';
import { attachments, attachmentVersions, deliveryNotifications, emailMessages, mailboxes } from './schema';
import { readSecret } from './secrets';

export interface EmailSendDeps {
  /** PDF печатной формы документа для вложения (воркер: renderDocumentHtml + Chromium) */
  renderPrintPdf?: (db: Db, m: { documentId: string; form: PrintForm; templateId: string | null; memberId: string | null }) => Promise<{ filename: string; data: Uint8Array }>;
}

interface Prepared {
  mail: OutMail;
  password: string;
  mailboxId: string;
}

export async function sendQueuedEmail(sql: Sql, workspaceId: string, emailId: string, job: { attempts: number; maxAttempts: number }, deps: EmailSendDeps = {}): Promise<'sent' | 'skipped' | 'failed'> {
  const final = job.attempts >= job.maxAttempts;
  const fail = (db: Db, error: string, mailboxId?: string | null, auth = false) =>
    markFailed(db, workspaceId, emailId, error, mailboxId, auth);

  // шаг 1: подготовка
  const prep = await withContext(sql, { workspaceId }, async (db): Promise<Prepared | 'skipped' | 'failed'> => {
    const [m] = await db.select().from(emailMessages).where(eq(emailMessages.id, emailId));
    if (!m || m.direction !== 'out' || (m.status !== 'queued' && m.status !== 'sending')) return 'skipped';
    await db.update(emailMessages).set({ status: 'sending', attempts: job.attempts, updatedAt: new Date() }).where(eq(emailMessages.id, emailId));
    const [box] = m.mailboxId ? await db.select().from(mailboxes).where(eq(mailboxes.id, m.mailboxId)) : [];
    if (!box) {
      await fail(db, 'The mailbox was deleted');
      return 'failed';
    }
    const password = await readSecret(db, workspaceId, mailboxPasswordKey(box.id));
    if (!password) {
      await fail(db, 'The mailbox has no password', box.id);
      return 'failed';
    }
    const files: OutMail['attachments'] = [];
    try {
      if (m.attachmentIds.length) {
        const store = getFileStore();
        if (!store) throw new Error('File storage is not configured');
        for (const id of m.attachmentIds) {
          const [att] = await db.select().from(attachments).where(eq(attachments.id, id));
          if (!att) continue;
          const ver = (await db.select().from(attachmentVersions).where(eq(attachmentVersions.attachmentId, id))).find(x => x.version === att.currentVersion);
          const data = ver?.storageKey ? await store.get(ver.storageKey) : null;
          if (!data) throw new Error(`Attachment "${att.name}" has no content`);
          files.push({ filename: att.name, content: data, contentType: ver!.mime || undefined });
        }
      }
      if (m.documentId && m.printForm) {
        if (!deps.renderPrintPdf) throw new Error('PDF rendering is not available');
        const pdf = await deps.renderPrintPdf(db, { documentId: m.documentId, form: m.printForm as PrintForm, templateId: m.printTemplateId, memberId: m.createdBy });
        files.push({ filename: pdf.filename, content: pdf.data, contentType: 'application/pdf' });
      }
    } catch (e) {
      // вложение или PDF не собрались: повторять вслепую бессмысленно
      await fail(db, e instanceof Error ? e.message.slice(0, 500) : String(e), box.id);
      return 'failed';
    }
    return {
      mailboxId: box.id,
      password,
      mail: { from: { name: m.fromName, address: m.fromEmail }, to: m.to, cc: m.cc, subject: m.subject, text: m.bodyText, html: m.bodyHtml, messageId: m.messageId ?? '', inReplyTo: m.inReplyTo, references: m.references, attachments: files },
    };
  });
  if (prep === 'skipped' || prep === 'failed') return prep;

  // шаг 2: SMTP
  const [box] = await withContext(sql, { workspaceId }, db => db.select().from(mailboxes).where(eq(mailboxes.id, prep.mailboxId)));
  let error: MailError | null = null;
  if (!box) error = new MailError('The mailbox was deleted', false);
  else {
    try {
      const transport = await openTransport({ host: box.smtpHost, port: box.smtpPort, secure: box.smtpSecure, user: box.smtpUser, password: prep.password });
      try {
        await transport.sendMail(prep.mail);
      } finally {
        transport.close();
      }
    } catch (e) {
      error = classifyMailError(e, prep.password);
    }
  }

  // шаг 3: итог. Исключение для повтора бросается после коммита: иначе откат стёр бы статус и текст ошибки
  let retry: MailError | null = null;
  const result = await withContext(sql, { workspaceId }, async db => {
    if (!error) {
      const now = new Date();
      await db.update(emailMessages).set({ status: 'sent', sentAt: now, lastError: null, updatedAt: now }).where(eq(emailMessages.id, emailId));
      await db.update(deliveryNotifications).set({ status: 'sent', sentAt: now, error: null, updatedAt: now }).where(eq(deliveryNotifications.externalId, emailId));
      await recordEvent(db, { workspaceId, type: 'email.sent', entity: 'email', recordId: emailId, actorId: null, payload: {} });
      return 'sent' as const;
    }
    if (error.transient && !final) {
      await db.update(emailMessages).set({ status: 'queued', lastError: error.message, updatedAt: new Date() }).where(eq(emailMessages.id, emailId));
      await recordEvent(db, { workspaceId, type: 'email.updated', entity: 'email', recordId: emailId, actorId: null, payload: {} });
      retry = error; // очередь jobs повторит с паузой
      return 'failed' as const;
    }
    await fail(db, error.message, prep.mailboxId, error.kind === 'auth');
    return 'failed' as const;
  });
  if (retry) throw retry;
  return result;
}

async function markFailed(db: Db, workspaceId: string, emailId: string, error: string, mailboxId?: string | null, auth = false): Promise<void> {
  const now = new Date();
  await db.update(emailMessages).set({ status: 'failed', lastError: error.slice(0, 1000), updatedAt: now }).where(eq(emailMessages.id, emailId));
  await db.update(deliveryNotifications).set({ status: 'failed', error: error.slice(0, 1000), updatedAt: now }).where(eq(deliveryNotifications.externalId, emailId));
  // неверный пароль — ящик помечается ошибочным, чтобы это было видно в настройках
  if (auth && mailboxId) await db.update(mailboxes).set({ status: 'error', lastError: error.slice(0, 1000), checkedAt: now }).where(eq(mailboxes.id, mailboxId));
  await recordEvent(db, { workspaceId, type: 'email.failed', entity: 'email', recordId: emailId, actorId: null, payload: {} });
}
