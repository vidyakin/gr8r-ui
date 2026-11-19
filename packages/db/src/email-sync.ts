/* Входящая почта (docs/architecture/email.md): снимок INBOX вне транзакции, затем письмо, вложения,
   касание, уведомление, событие и курсор атомарно под RLS. IMAP подменяется в тестах. */
import { and, eq, isNull, sql as sqlExpr } from 'drizzle-orm';
import { simpleParser } from 'mailparser';
import { EMAIL_MAX_ATTACH_BYTES, caseNumberFromSubject, mailboxPasswordKey, normalizeEmail } from '@erp/shared';
import type { Db, Sql } from './client';
import { withContext } from './context';
import { createInboundAttachment } from './attachments';
import { applyClientReply, insertCase, type CaseRow } from './cases';
import { classifyMailError, openImap } from './email-transport';
import { recordEvent } from './events';
import { insertLead } from './leads';
import { sanitizeRichText } from './rich-text';
import { cases, companies, contacts, crmActivities, deals, emailMessages, leads, mailboxes, notifications } from './schema';
import { readSecret } from './secrets';
import type { EmailMessage, Mailbox } from './email';

export async function parseInboundEmail(source: Uint8Array) {
  const m = await simpleParser(Buffer.from(source), { skipImageLinks: true, skipTextLinks: true });
  const addresses = (a: typeof m.to) => (Array.isArray(a) ? a : a ? [a] : []).flatMap(x => x.value.map(v => v.address ?? '').filter(Boolean));
  return {
    fromEmail: normalizeEmail(m.from?.value[0]?.address), fromName: m.from?.value[0]?.name ?? '',
    to: addresses(m.to), cc: addresses(m.cc), subject: (m.subject ?? '').slice(0, 500),
    bodyText: (m.text ?? '').slice(0, 200_000), bodyHtml: m.html ? sanitizeRichText(m.html).slice(0, 400_000) : null,
    messageId: m.messageId ?? null, inReplyTo: m.inReplyTo ?? null,
    references: Array.isArray(m.references) ? m.references.join(' ') : m.references ?? null,
    receivedAt: m.date && Number.isFinite(m.date.getTime()) ? m.date : new Date(),
    attachments: m.attachments.map(a => ({ name: (a.filename ?? 'attachment').slice(0, 255), mime: a.contentType, data: new Uint8Array(a.content) })),
  };
}
type Incoming = Awaited<ReturnType<typeof parseInboundEmail>>;
type Links = Pick<EmailMessage, 'leadId' | 'contactId' | 'companyId' | 'dealId' | 'documentId'>;
const noLinks = (): Links => ({ leadId: null, contactId: null, companyId: null, dealId: null, documentId: null });

/** Заголовки ответа имеют приоритет над адресом; References просматриваются от ближайшего предка. */
async function matchIncoming(db: Db, m: Incoming, box: Mailbox): Promise<Links> {
  const ids = [...(m.inReplyTo?.match(/<[^>]+>/g) ?? []), ...(m.references?.match(/<[^>]+>/g) ?? []).reverse()];
  for (const id of [...new Set(ids)]) {
    const [sent] = await db.select().from(emailMessages).where(and(eq(emailMessages.messageId, id), eq(emailMessages.direction, 'out'), eq(emailMessages.status, 'sent'))).orderBy(emailMessages.createdAt).limit(1);
    if (sent && (sent.leadId || sent.contactId || sent.companyId || sent.dealId || sent.documentId)) return { leadId: sent.leadId, contactId: sent.contactId, companyId: sent.companyId, dealId: sent.dealId, documentId: sent.documentId };
  }
  if (!m.fromEmail) return noLinks();
  const [contact] = await db.select().from(contacts).where(and(sqlExpr`lower(trim(${contacts.email})) = ${m.fromEmail}`, isNull(contacts.archivedAt))).orderBy(contacts.createdAt, contacts.id).limit(1);
  if (contact) return { ...noLinks(), contactId: contact.id, companyId: contact.companyId };
  const [lead] = await db.select().from(leads).where(and(eq(leads.emailNorm, m.fromEmail), isNull(leads.archivedAt))).orderBy(leads.createdAt, leads.id).limit(1);
  if (lead) return { ...noLinks(), leadId: lead.id };
  if (box.kind === 'shared' && box.createLeadFromUnmatched) {
    const lead = await insertLead(db, { workspaceId: box.workspaceId, memberId: null }, { name: m.fromName.trim() || m.fromEmail, email: m.fromEmail, comment: m.subject });
    return { ...noLinks(), leadId: lead.id };
  }
  return noLinks();
}

/** Приём в обращения (docs/architecture/cases.md): ответ на письмо обращения (In-Reply-To / References) или номер «[ОБ-…]» в теме
    привязывает письмо к обращению (решённое открывается снова в течение 7 дней, позже и закрытое — новое обращение); иначе создаётся новое */
async function routeToCase(db: Db, box: Mailbox, m: Incoming, links: Links): Promise<{ caseRow: CaseRow; links: Links; existed: boolean }> {
  const ctx = { workspaceId: box.workspaceId, memberId: null };
  const ids = [...new Set([...(m.inReplyTo?.match(/<[^>]+>/g) ?? []), ...(m.references?.match(/<[^>]+>/g) ?? []).reverse()])];
  let found: CaseRow | undefined;
  for (const id of ids) {
    const [msg] = await db.select({ caseId: emailMessages.caseId }).from(emailMessages).where(and(eq(emailMessages.messageId, id), sqlExpr`${emailMessages.caseId} is not null`)).orderBy(emailMessages.createdAt).limit(1);
    if (!msg?.caseId) continue;
    [found] = await db.select().from(cases).where(eq(cases.id, msg.caseId)).limit(1);
    if (found) break;
  }
  if (!found) {
    const number = caseNumberFromSubject(m.subject);
    if (number) [found] = await db.select().from(cases).where(eq(cases.number, number)).limit(1);
  }
  let previous: CaseRow | undefined;
  if (found) {
    const after = await applyClientReply(db, ctx, found.id, m.receivedAt);
    if (after) return { caseRow: after, existed: true, links: { leadId: after.leadId ?? links.leadId, contactId: after.contactId ?? links.contactId, companyId: after.companyId ?? links.companyId, dealId: after.dealId ?? links.dealId, documentId: links.documentId } };
    previous = found;
  }
  const row = await insertCase(db, ctx, { subject: m.subject.trim() || '(no subject)', description: m.bodyText.slice(0, 20_000), channel: 'email', leadId: links.leadId, contactId: links.contactId, companyId: links.companyId, dealId: links.dealId, mailboxId: box.id, defaultOwnerId: box.caseOwnerId, at: m.receivedAt });
  if (previous) await db.insert(crmActivities).values({ workspaceId: box.workspaceId, type: 'note', subject: `Follows case ${previous.number}`, caseId: row.id, system: true });
  return { caseRow: row, links, existed: false };
}

async function notifyOwner(db: Db, box: Mailbox, m: EmailMessage, caseOwnerId: string | null = null) {
  let ownerId: string | null = caseOwnerId;
  if (!ownerId)
  for (const [id, table] of [[m.leadId, leads], [m.contactId, contacts], [m.dealId, deals], [m.companyId, companies]] as const) {
    if (!id) continue;
    const [row] = await db.select({ ownerId: table.ownerId }).from(table).where(eq(table.id, id));
    if (row?.ownerId) { ownerId = row.ownerId; break; }
  }
  ownerId ??= box.memberId;
  if (!ownerId) return;
  const [n] = await db.insert(notifications).values({ workspaceId: box.workspaceId, recipientId: ownerId, type: 'update', text: `Получено письмо: ${m.subject}`, snippet: `${m.fromEmail}: ${m.bodyText}`.slice(0, 500) }).returning();
  await recordEvent(db, { workspaceId: box.workspaceId, type: 'notification.created', entity: 'notification', recordId: n!.id, actorId: null, payload: { recipientId: ownerId, emailId: m.id } });
}

/** До 100 UID за проход. При смене UIDVALIDITY старый курсор сбрасывается; прежняя история сохраняется. */
export async function syncMailbox(sql: Sql, workspaceId: string, mailboxId: string): Promise<number> {
  const prep = await withContext(sql, { workspaceId }, async db => {
    const [box] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
    if (!box?.imapHost || !box.imapPort || !box.imapSecure || !box.imapUser) return null;
    const password = await readSecret(db, workspaceId, mailboxPasswordKey(mailboxId));
    if (!password) throw new Error('The mailbox has no password');
    return { box, password };
  });
  if (!prep) return 0;
  const { box, password } = prep;
  try {
    const imap = await openImap({ host: box.imapHost!, port: box.imapPort!, secure: box.imapSecure!, user: box.imapUser!, password });
    try {
      const validity = imap.uidValidity;
      const from = (box.imapUidValidity === validity ? box.imapLastUid : 0) + 1;
      const to = Math.min(imap.uidNext - 1, from + 99);
      const rows = to >= from ? await imap.fetchRange(from, to) : [];
      const parsed = await Promise.all(rows.filter(r => r.uid >= from && r.uid <= to).map(async r => ({ ...r, mail: r.source ? await parseInboundEmail(r.source) : null })));
      return await withContext(sql, { workspaceId }, async db => {
        const [current] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).for('update');
        // Другой воркер или настройка ящика уже продвинули/сбросили курсор — снимок больше не актуален.
        if (!current || current.imapUidValidity !== box.imapUidValidity || current.imapLastUid !== box.imapLastUid || current.imapHost !== box.imapHost || current.imapPort !== box.imapPort || current.imapUser !== box.imapUser || current.imapSecure !== box.imapSecure) return 0;
        let count = 0;
        for (const row of parsed.sort((a, b) => a.uid - b.uid)) {
          // Проверяем до сопоставления: повтор не должен создавать лид или уведомление.
          const [exists] = await db.select({ id: emailMessages.id }).from(emailMessages).where(and(eq(emailMessages.mailboxId, mailboxId), eq(emailMessages.imapUidValidity, validity), eq(emailMessages.imapUid, row.uid))).limit(1);
          if (exists) continue;
          const mail = row.mail;
          // После пересоздания INBOX UID меняются: Message-ID сохраняет историю без повторных касаний.
          if (mail?.messageId) {
            const [same] = await db.select({ id: emailMessages.id }).from(emailMessages).where(and(eq(emailMessages.mailboxId, mailboxId), eq(emailMessages.direction, 'in'), eq(emailMessages.messageId, mail.messageId))).limit(1);
            if (same) continue;
          }
          let links = mail ? await matchIncoming(db, mail, current) : noLinks();
          let caseRow: CaseRow | null = null;
          let caseExisted = false;
          // свои исходящие и служебные адреса не создают обращений: иначе автоответы зацикливаются
          if (mail && current.createCasesFromMail && mail.fromEmail && mail.fromEmail !== normalizeEmail(current.email) && !/^(mailer-daemon|postmaster)@/.test(mail.fromEmail)) {
            const routed = await routeToCase(db, current, mail, links);
            caseRow = routed.caseRow;
            caseExisted = routed.existed;
            links = routed.links;
          }
          const { attachments: files, ...fields } = mail ?? { fromEmail: '', fromName: '', to: [], cc: [], subject: '', bodyText: '', bodyHtml: null, messageId: null, inReplyTo: null, references: null, receivedAt: new Date(), attachments: [] };
          const [m] = await db.insert(emailMessages).values({ ...fields, ...links, workspaceId, mailboxId, direction: 'in', status: 'received', caseId: caseRow?.id ?? null, imapUidValidity: validity, imapUid: row.uid, lastError: mail ? null : 'Email source exceeds size limit (30 MiB)' }).returning();
          let bytes = 0;
          const attachmentIds: string[] = [];
          const skipped: string[] = [];
          for (const file of files) {
            if (bytes + file.data.length > EMAIL_MAX_ATTACH_BYTES) { skipped.push(file.name); continue; }
            const { attachment } = await createInboundAttachment(db, workspaceId, m!.id, file);
            bytes += file.data.length;
            attachmentIds.push(attachment.id);
          }
          if (attachmentIds.length || skipped.length) await db.update(emailMessages).set({ attachmentIds, ...(skipped.length ? { lastError: `Attachments exceed 20 MiB: ${skipped.join(', ')}`.slice(0, 1000) } : {}) }).where(eq(emailMessages.id, m!.id));
          if (links.leadId || links.contactId || links.companyId || links.dealId || caseRow) {
            const [act] = await db.insert(crmActivities).values({ workspaceId, type: 'email', subject: m!.subject.slice(0, 200), body: m!.bodyText.slice(0, 2000) || null, leadId: links.leadId, contactId: links.contactId, companyId: links.companyId, dealId: links.dealId, caseId: caseRow?.id ?? null, emailMessageId: m!.id }).returning();
            await recordEvent(db, { workspaceId, type: 'crm_activity.created', entity: 'crm_activity', recordId: act!.id, actorId: null, payload: { direction: 'in' } });
          }
          // новое обращение уже уведомило ответственного при создании
          if (!caseRow || caseExisted) await notifyOwner(db, current, m!, caseRow?.ownerId ?? null);
          await recordEvent(db, { workspaceId, type: 'email.received', entity: 'email', recordId: m!.id, actorId: null, payload: { ...links, mailboxId, fromEmail: m!.fromEmail, ...(caseRow ? { caseId: caseRow.id } : {}) } });
          count++;
        }
        // FETCH может ограничить объём пачки: продвигаемся только до последнего возвращённого UID.
        const lastUid = parsed.length ? Math.max(...parsed.map(r => r.uid)) : Math.max(from - 1, to);
        await db.update(mailboxes).set({ imapUidValidity: validity, imapLastUid: lastUid, status: 'ok', lastError: null, checkedAt: new Date(), updatedAt: new Date() }).where(eq(mailboxes.id, mailboxId));
        await recordEvent(db, { workspaceId, type: 'mailbox.synced', entity: 'mailbox', recordId: mailboxId, actorId: null, payload: { received: count } });
        return count;
      });
    } finally { await imap.close(); }
  } catch (e) {
    const error = classifyMailError(e, password);
    await withContext(sql, { workspaceId }, async db => {
      await db.update(mailboxes).set({ status: 'error', lastError: error.message, checkedAt: new Date(), updatedAt: new Date() }).where(eq(mailboxes.id, mailboxId));
      await recordEvent(db, { workspaceId, type: 'mailbox.checked', entity: 'mailbox', recordId: mailboxId, actorId: null, payload: { ok: false } });
    });
    throw error;
  }
}
