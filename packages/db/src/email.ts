/* Почта, инкремент А — отправка (задача 1092, docs/architecture/email.md): ящики (общий и личные), очередь исходящих писем,
   касание CRM в истории записи. Саму отправку по SMTP делает воркер (email-send.ts, задача `email.send`).
   Пароль ящика — только в хранилище секретов (`mailbox.<id>.password`), в ответах его нет. Права: общий ящик правит admin+,
   личный — только его владелец (даже admin чужой личный ящик не видит). Изменение + касание + событие + задача — в одной транзакции. */
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import {
  EMAIL_MAX_ATTACH_BYTES,
  EMAIL_MAX_RECIPIENTS,
  formAllowedFor,
  isEmailAddress,
  mailboxPasswordKey,
  type EmailCreate,
  type MailboxCreate,
  type MailboxUpdate,
  type PrintForm,
  type Role,
} from '@erp/shared';
import { getAttachment } from './attachments';
import type { Db } from './client';
import { assertMailHostShape } from './email-transport';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { sanitizeRichText } from './rich-text';
import { companies, contacts, crmActivities, deals, documents, emailMessages, jobs, leads, mailboxes, workspaceSecrets } from './schema';
import { deleteSecret, readSecret, setSecret } from './secrets';
import { uuidv7 } from './uuid';

export const EMAIL_SEND_JOB = 'email.send';
export type Mailbox = typeof mailboxes.$inferSelect;
export type EmailMessage = typeof emailMessages.$inferSelect;

/** Кто действует: участник воркспейса */
export interface MailCtx {
  workspaceId: string;
  memberId: string | null;
  role: Role;
}

const rank: Record<Role, number> = { guest: 0, member: 1, admin: 2, owner: 3 };
const isAdmin = (c: MailCtx) => rank[c.role] >= rank.admin;

/** Ящик без пароля, с фактом его наличия */
export type MailboxView = Mailbox & { hasPassword: boolean };

async function withPasswordFlags(db: Db, rows: Mailbox[]): Promise<MailboxView[]> {
  if (!rows.length) return [];
  const keys = rows.map(r => mailboxPasswordKey(r.id));
  const have = new Set((await db.select({ key: workspaceSecrets.key }).from(workspaceSecrets).where(inArray(workspaceSecrets.key, keys))).map(r => r.key));
  return rows.map(r => ({ ...r, hasPassword: have.has(mailboxPasswordKey(r.id)) }));
}

/** Ящик виден: общий — любому участнику, личный — только владельцу */
const visible = (c: MailCtx, m: Mailbox) => m.kind === 'shared' || (!!c.memberId && m.memberId === c.memberId);
/** Ящик можно менять: общий — admin+, личный — владелец */
const writable = (c: MailCtx, m: Mailbox) => (m.kind === 'shared' ? isAdmin(c) : !!c.memberId && m.memberId === c.memberId && rank[c.role] >= rank.member);

export async function listMailboxes(db: Db, c: MailCtx): Promise<MailboxView[]> {
  const rows = await db.select().from(mailboxes).where(eq(mailboxes.workspaceId, c.workspaceId)).orderBy(mailboxes.kind, mailboxes.createdAt);
  return withPasswordFlags(db, rows.filter(m => visible(c, m)));
}

async function loadMailbox(db: Db, c: MailCtx, id: string, need: 'read' | 'write'): Promise<Mailbox> {
  const [m] = await db.select().from(mailboxes).where(and(eq(mailboxes.id, id), eq(mailboxes.workspaceId, c.workspaceId)));
  if (!m || !visible(c, m)) throw new DomainError(404, 'not_found', 'Mailbox not found');
  if (need === 'write' && !writable(c, m)) throw new DomainError(403, 'forbidden', 'No permission to change this mailbox');
  return m;
}

export async function getMailbox(db: Db, c: MailCtx, id: string): Promise<MailboxView> {
  return (await withPasswordFlags(db, [await loadMailbox(db, c, id, 'read')]))[0]!;
}

const secretCtx = (c: MailCtx) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });

export async function createMailbox(db: Db, c: MailCtx, input: MailboxCreate): Promise<MailboxView> {
  if (input.kind === 'shared' ? !isAdmin(c) : !c.memberId || rank[c.role] < rank.member) throw new DomainError(403, 'forbidden', 'No permission to create this mailbox');
  assertMailHostShape(input.smtpHost);
  if (input.imapHost) assertMailHostShape(input.imapHost);
  const { password, ...fields } = input;
  const taken = await db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(and(eq(mailboxes.workspaceId, c.workspaceId), eq(mailboxes.kind, input.kind), input.kind === 'personal' ? eq(mailboxes.memberId, c.memberId!) : undefined))
    .limit(1);
  if (taken.length) throw new DomainError(409, 'mailbox_exists', input.kind === 'shared' ? 'The shared mailbox already exists' : 'You already have a personal mailbox');
  const [row] = await db
    .insert(mailboxes)
    .values({ ...fields, workspaceId: c.workspaceId, memberId: input.kind === 'personal' ? c.memberId : null, status: 'unchecked' })
    .returning();
  if (password) await setSecret(db, secretCtx(c), mailboxPasswordKey(row!.id), password);
  await recordEvent(db, { workspaceId: c.workspaceId, type: 'mailbox.created', entity: 'mailbox', recordId: row!.id, actorId: c.memberId, payload: { kind: row!.kind } });
  return getMailbox(db, c, row!.id);
}

export async function updateMailbox(db: Db, c: MailCtx, id: string, patch: MailboxUpdate): Promise<MailboxView> {
  const m = await loadMailbox(db, c, id, 'write');
  if (patch.smtpHost) assertMailHostShape(patch.smtpHost);
  if (patch.imapHost) assertMailHostShape(patch.imapHost);
  const { password, ...fields } = patch;
  // undefined — «не трогать», null (у необязательных IMAP-полей) — «очистить»
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) set[k] = v;
  // подключение изменилось — прежняя проверка неактуальна
  const connectionChanged = password !== undefined || ['smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'email'].some(k => k in set && set[k] !== (m as Record<string, unknown>)[k]);
  if (connectionChanged) Object.assign(set, { status: 'unchecked', lastError: null, checkedAt: null });
  if (Object.keys(set).length) await db.update(mailboxes).set({ ...set, updatedAt: new Date() }).where(eq(mailboxes.id, id));
  if (password) await setSecret(db, secretCtx(c), mailboxPasswordKey(id), password);
  await recordEvent(db, { workspaceId: c.workspaceId, type: 'mailbox.updated', entity: 'mailbox', recordId: id, actorId: c.memberId, payload: {} });
  return getMailbox(db, c, id);
}

export async function deleteMailbox(db: Db, c: MailCtx, id: string): Promise<void> {
  await loadMailbox(db, c, id, 'write');
  await db.delete(mailboxes).where(eq(mailboxes.id, id));
  const key = mailboxPasswordKey(id);
  if ((await db.select({ key: workspaceSecrets.key }).from(workspaceSecrets).where(eq(workspaceSecrets.key, key)).limit(1)).length) await deleteSecret(db, secretCtx(c), key);
  await recordEvent(db, { workspaceId: c.workspaceId, type: 'mailbox.deleted', entity: 'mailbox', recordId: id, actorId: c.memberId, payload: {} });
}

/** Результат проверки подключения: записывается в ящик (статус, текст ошибки, время) */
export async function saveMailboxCheck(db: Db, c: MailCtx, id: string, error: string | null): Promise<MailboxView> {
  await db.update(mailboxes).set({ status: error ? 'error' : 'ok', lastError: error, checkedAt: new Date(), updatedAt: new Date() }).where(eq(mailboxes.id, id));
  await recordEvent(db, { workspaceId: c.workspaceId, type: 'mailbox.checked', entity: 'mailbox', recordId: id, actorId: c.memberId, payload: { ok: !error } });
  return getMailbox(db, c, id);
}

/** Для проверки подключения: ящик с правом записи и открытый пароль (только серверный код) */
export async function mailboxForCheck(db: Db, c: MailCtx, id: string): Promise<{ mailbox: Mailbox; password: string | null }> {
  const mailbox = await loadMailbox(db, c, id, 'write');
  return { mailbox, password: await readSecret(db, c.workspaceId, mailboxPasswordKey(id)) };
}

/* ---------------- выбор ящика ---------------- */

/** Явный ящик (общий или свой личный); иначе личный ящик автора, иначе общий; ничего нет — 422 mailbox_required */
export async function pickMailbox(db: Db, c: { workspaceId: string; memberId: string | null }, o: { mailboxId?: string | null; prefer?: 'personal' | 'shared' } = {}): Promise<Mailbox> {
  const all = await db.select().from(mailboxes).where(eq(mailboxes.workspaceId, c.workspaceId));
  if (o.mailboxId) {
    const m = all.find(x => x.id === o.mailboxId);
    if (!m || !(m.kind === 'shared' || (c.memberId && m.memberId === c.memberId))) throw new DomainError(404, 'not_found', 'Mailbox not found');
    return m;
  }
  const personal = c.memberId ? all.find(x => x.kind === 'personal' && x.memberId === c.memberId) : undefined;
  const shared = all.find(x => x.kind === 'shared');
  const m = o.prefer === 'shared' ? shared : (personal ?? shared);
  if (!m) throw new DomainError(422, 'mailbox_required', 'No mailbox is configured: add a mailbox in Settings → Mail');
  return m;
}

/* ---------------- очередь ---------------- */

const dailyLimit = () => Number(process.env.EMAIL_DAILY_LIMIT ?? 500);

type Links = { leadId?: string | null; contactId?: string | null; companyId?: string | null; dealId?: string | null };

async function assertExists(db: Db, links: Links & { documentId?: string | null }): Promise<{ docCompanyId: string | null }> {
  const check = async (id: string | null | undefined, table: typeof leads | typeof contacts | typeof companies | typeof deals, what: string) => {
    if (!id) return;
    const [r] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
    if (!r) throw new DomainError(404, 'not_found', `${what} not found`);
  };
  await check(links.leadId, leads, 'Lead');
  await check(links.contactId, contacts, 'Contact');
  await check(links.companyId, companies, 'Company');
  await check(links.dealId, deals, 'Deal');
  let docCompanyId: string | null = null;
  if (links.documentId) {
    const [d] = await db.select({ company: documents.counterpartyId }).from(documents).where(eq(documents.id, links.documentId)).limit(1);
    if (!d) throw new DomainError(404, 'not_found', 'Document not found');
    docCompanyId = d.company;
  }
  return { docCompanyId };
}

export interface QueueOptions {
  /** Подмена выбора ящика (автоматизации) */
  mailbox?: Mailbox;
  /** Метка автоматизации в событиях: flow не запускает сам себя */
  via?: unknown;
  /** Добавить подпись ящика в конец текста */
  appendSignature?: boolean;
}

/** Поставить письмо в очередь: письмо `queued` + касание `email` в истории записи + задача `email.send` + события */
export async function queueEmail(db: Db, c: MailCtx, input: EmailCreate, o: QueueOptions = {}): Promise<EmailMessage> {
  const to = [...new Set(input.to.map(a => a.trim()))];
  const cc = [...new Set((input.cc ?? []).map(a => a.trim()))].filter(a => !to.includes(a));
  if (!to.length || [...to, ...cc].some(a => !isEmailAddress(a)) || to.length + cc.length > EMAIL_MAX_RECIPIENTS) throw new DomainError(422, 'email_recipients_invalid', 'Invalid recipients');

  const mailbox = o.mailbox ?? (await pickMailbox(db, c, { mailboxId: input.mailboxId }));
  const [pw] = await db.select({ key: workspaceSecrets.key }).from(workspaceSecrets).where(eq(workspaceSecrets.key, mailboxPasswordKey(mailbox.id))).limit(1);
  if (!pw) throw new DomainError(422, 'mailbox_password_missing', 'The mailbox has no password: set it in Settings → Mail');

  // суточный лимит воркспейса: защита от рассылки и зацикленной автоматизации
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(and(eq(emailMessages.workspaceId, c.workspaceId), eq(emailMessages.direction, 'out'), gt(emailMessages.createdAt, sql`now() - interval '1 day'`)));
  if (n >= dailyLimit()) throw new DomainError(422, 'email_limit_reached', 'The daily limit of outgoing emails is reached');

  const { docCompanyId } = await assertExists(db, input);
  if (input.documentId && input.printForm) {
    const [d] = await db.select({ type: documents.type }).from(documents).where(eq(documents.id, input.documentId)).limit(1);
    if (!formAllowedFor(d!.type, input.printForm as PrintForm)) throw new DomainError(422, 'form_not_available', `The "${input.printForm}" form is not available for this document type`);
  }

  // вложения: права как у объекта, суммарный размер ограничен
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];
  if (attachmentIds.length && !c.memberId) throw new DomainError(422, 'email_attachments_forbidden', 'Attachments need an author');
  let size = 0;
  for (const id of attachmentIds) {
    const { attachment, versions } = await getAttachment(db, { workspaceId: c.workspaceId, memberId: c.memberId!, role: c.role }, id);
    size += versions.find(v => v.version === attachment.currentVersion)?.sizeBytes ?? 0;
  }
  if (size > EMAIL_MAX_ATTACH_BYTES) throw new DomainError(413, 'email_too_large', 'Attachments are too large for one email');

  const domain = mailbox.email.split('@')[1] ?? 'localhost';
  const messageId = `<${uuidv7()}@${domain}>`;
  const bodyText = o.appendSignature && mailbox.signature.trim() ? `${input.body}\n\n-- \n${mailbox.signature}` : input.body;
  const companyId = input.companyId ?? docCompanyId;
  const [msg] = await db
    .insert(emailMessages)
    .values({
      workspaceId: c.workspaceId,
      mailboxId: mailbox.id,
      direction: 'out',
      status: 'queued',
      fromEmail: mailbox.email,
      fromName: mailbox.displayName,
      to,
      cc,
      subject: input.subject.trim(),
      bodyText,
      bodyHtml: input.bodyHtml ? sanitizeRichText(input.bodyHtml) : null,
      messageId,
      inReplyTo: input.inReplyTo ?? null,
      createdBy: c.memberId,
      leadId: input.leadId ?? null,
      contactId: input.contactId ?? null,
      companyId: companyId ?? null,
      dealId: input.dealId ?? null,
      documentId: input.documentId ?? null,
      printForm: input.documentId ? (input.printForm ?? null) : null,
      printTemplateId: input.documentId && input.printForm ? (input.templateId ?? null) : null,
      attachmentIds,
    })
    .returning();

  // касание в истории записи (лента лида, контакта, контрагента, сделки)
  if (input.leadId || input.contactId || companyId || input.dealId) {
    const [act] = await db
      .insert(crmActivities)
      .values({ workspaceId: c.workspaceId, type: 'email', subject: msg!.subject.slice(0, 200), body: bodyText.slice(0, 2000) || null, leadId: input.leadId ?? null, contactId: input.contactId ?? null, companyId: companyId ?? null, dealId: input.dealId ?? null, authorId: c.memberId, emailMessageId: msg!.id })
      .returning();
    await recordEvent(db, { workspaceId: c.workspaceId, type: 'crm_activity.created', entity: 'crm_activity', recordId: act!.id, actorId: c.memberId, payload: { via: o.via ?? null } });
  }
  await db.insert(jobs).values({ workspaceId: c.workspaceId, type: EMAIL_SEND_JOB, payload: { emailId: msg!.id }, maxAttempts: 5 });
  await recordEvent(db, { workspaceId: c.workspaceId, type: 'email.queued', entity: 'email', recordId: msg!.id, actorId: c.memberId, payload: { via: o.via ?? null } });
  return msg!;
}

/** Из автоматизации (узел «Отправить письмо»): ящик общий или личный ответственного, подпись ящика, автор не задан */
export async function queueAutomationEmail(
  db: Db,
  workspaceId: string,
  via: unknown,
  a: { mailbox: 'shared' | 'owner'; ownerId?: string | null; to: string[]; subject: string; text: string; link?: Links & { documentId?: string } },
): Promise<{ id: string; mailboxId: string }> {
  const rows = await db.select().from(mailboxes).where(eq(mailboxes.workspaceId, workspaceId));
  const owner = a.mailbox === 'owner' && a.ownerId ? rows.find(m => m.kind === 'personal' && m.memberId === a.ownerId) : undefined;
  const mailbox = owner ?? rows.find(m => m.kind === 'shared');
  if (!mailbox) throw new DomainError(422, 'mailbox_required', 'No mailbox is configured: add a mailbox in Settings → Mail');
  const msg = await queueEmail(db, { workspaceId, memberId: null, role: 'member' }, { to: a.to, cc: [], subject: a.subject, body: a.text, attachmentIds: [], ...a.link }, { mailbox, via, appendSignature: true });
  return { id: msg.id, mailboxId: mailbox.id };
}

/** Повторить отправку письма со статусом failed (автор или admin+) */
export async function retryEmail(db: Db, c: MailCtx, id: string): Promise<EmailMessage> {
  const [m] = await db.select().from(emailMessages).where(and(eq(emailMessages.id, id), eq(emailMessages.workspaceId, c.workspaceId)));
  if (!m) throw new DomainError(404, 'not_found', 'Email not found');
  if (m.createdBy !== c.memberId && !isAdmin(c)) throw new DomainError(403, 'forbidden', 'Only the author or an admin can retry this email');
  if (m.status !== 'failed' || m.direction !== 'out') throw new DomainError(409, 'conflict', 'Only a failed outgoing email can be retried');
  const [row] = await db.update(emailMessages).set({ status: 'queued', attempts: 0, lastError: null, updatedAt: new Date() }).where(eq(emailMessages.id, id)).returning();
  await db.insert(jobs).values({ workspaceId: c.workspaceId, type: EMAIL_SEND_JOB, payload: { emailId: id }, maxAttempts: 5 });
  await recordEvent(db, { workspaceId: c.workspaceId, type: 'email.queued', entity: 'email', recordId: id, actorId: c.memberId, payload: {} });
  return row!;
}

export async function getEmail(db: Db, c: MailCtx, id: string): Promise<EmailMessage> {
  const [m] = await db.select().from(emailMessages).where(and(eq(emailMessages.id, id), eq(emailMessages.workspaceId, c.workspaceId)));
  if (!m) throw new DomainError(404, 'not_found', 'Email not found');
  return m;
}

/** Переписка записи (лид, контакт, контрагент, сделка, документ) или указанные письма; без фильтра — свои письма (admin — все) */
export async function listEmails(db: Db, c: MailCtx, f: Links & { documentId?: string; ids?: string[] }, limit = 50, offset = 0): Promise<EmailMessage[]> {
  const conds = [
    eq(emailMessages.workspaceId, c.workspaceId),
    f.leadId ? eq(emailMessages.leadId, f.leadId) : undefined,
    f.contactId ? eq(emailMessages.contactId, f.contactId) : undefined,
    f.companyId ? eq(emailMessages.companyId, f.companyId) : undefined,
    f.dealId ? eq(emailMessages.dealId, f.dealId) : undefined,
    f.documentId ? eq(emailMessages.documentId, f.documentId) : undefined,
    f.ids?.length ? inArray(emailMessages.id, f.ids) : undefined,
  ];
  const filtered = conds.slice(1).some(Boolean);
  if (!filtered && !isAdmin(c)) conds.push(c.memberId ? eq(emailMessages.createdBy, c.memberId) : isNull(emailMessages.createdBy));
  return db.select().from(emailMessages).where(and(...conds)).orderBy(desc(emailMessages.createdAt), desc(emailMessages.id)).limit(limit).offset(offset);
}
