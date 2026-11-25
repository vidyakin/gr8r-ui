/* Почта, инкремент А — отправка (задача 1092, docs/architecture/email.md): ящики (общий и личные), очередь исходящих писем,
   касание CRM в истории записи. Саму отправку по SMTP делает воркер (email-send.ts, задача `email.send`).
   Пароль ящика — только в хранилище секретов (`mailbox.<id>.password`), в ответах его нет. Права: общий ящик правит admin+,
   личный — только его владелец (даже admin чужой личный ящик не видит). Изменение + касание + событие + задача — в одной транзакции. */
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
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
  withCaseNumber,
  type Role,
} from '@erp/shared';
import { getAttachment } from './attachments';
import { loadCase, markFirstResponse } from './cases';
import type { Db } from './client';
import { assertMailHostShape } from './email-transport';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { sanitizeRichText } from './rich-text';
import { companies, contacts, crmActivities, deals, documents, emailMessages, jobs, leads, mailboxes, organizations, workspaceSecrets } from './schema';
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
  if (input.kind !== 'shared') fields.createLeadFromUnmatched = false;
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
  if (m.kind !== 'shared' && fields.createLeadFromUnmatched) throw new DomainError(422, 'bad_request', 'Lead creation is available only for shared mailboxes');
  // undefined — «не трогать», null (у необязательных IMAP-полей) — «очистить»
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) set[k] = v;
  // подключение изменилось — прежняя проверка неактуальна
  const connectionChanged = password !== undefined || ['smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'email', 'imapHost', 'imapPort', 'imapSecure', 'imapUser'].some(k => k in set && set[k] !== (m as Record<string, unknown>)[k]);
  if (['imapHost', 'imapPort', 'imapSecure', 'imapUser'].some(k => k in set && set[k] !== (m as Record<string, unknown>)[k])) Object.assign(set, { imapUidValidity: null, imapLastUid: 0 });
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

type Links = { caseId?: string | null; leadId?: string | null; contactId?: string | null; companyId?: string | null; dealId?: string | null };

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
  // обращение: тема получает номер, письмо и касание попадают в его ленту; закрытое обращение не получает писем
  const caseRow = input.caseId ? await loadCase(db, input.caseId) : null;
  if (caseRow?.status === 'closed') throw new DomainError(409, 'case_closed', 'A closed case cannot be edited');
  if (input.documentId && input.printForm) {
    const [d] = await db.select({ type: documents.type, country: organizations.country }).from(documents)
      .innerJoin(organizations, eq(organizations.id, documents.organizationId)).where(eq(documents.id, input.documentId)).limit(1);
    if (!d || !formAllowedFor(d.type, input.printForm as PrintForm, d.country)) throw new DomainError(422, 'form_not_available', `The "${input.printForm}" form is not available for this document type`);
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
  const companyId = input.companyId ?? docCompanyId ?? caseRow?.companyId ?? null;
  const leadId = input.leadId ?? caseRow?.leadId ?? null;
  const contactId = input.contactId ?? caseRow?.contactId ?? null;
  const subject = caseRow ? withCaseNumber(input.subject.trim(), caseRow.number) : input.subject.trim();
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
      subject,
      bodyText,
      bodyHtml: input.bodyHtml ? sanitizeRichText(input.bodyHtml) : null,
      messageId,
      inReplyTo: input.inReplyTo ?? null,
      createdBy: c.memberId,
      leadId,
      contactId,
      companyId: companyId ?? null,
      dealId: input.dealId ?? caseRow?.dealId ?? null,
      caseId: caseRow?.id ?? null,
      documentId: input.documentId ?? null,
      printForm: input.documentId ? (input.printForm ?? null) : null,
      printTemplateId: input.documentId && input.printForm ? (input.templateId ?? null) : null,
      attachmentIds,
    })
    .returning();

  // касание в истории записи (лента лида, контакта, контрагента, сделки)
  if (leadId || contactId || companyId || input.dealId || caseRow) {
    const [act] = await db
      .insert(crmActivities)
      .values({ workspaceId: c.workspaceId, type: 'email', subject: msg!.subject.slice(0, 200), body: bodyText.slice(0, 2000) || null, leadId, contactId, companyId: companyId ?? null, dealId: input.dealId ?? null, caseId: caseRow?.id ?? null, authorId: c.memberId, emailMessageId: msg!.id })
      .returning();
    await recordEvent(db, { workspaceId: c.workspaceId, type: 'crm_activity.created', entity: 'crm_activity', recordId: act!.id, actorId: c.memberId, payload: { via: o.via ?? null } });
  }
  // ответ сотрудника — первый ответ по SLA; письма автоматизаций не в счёт
  if (caseRow && c.memberId) await markFirstResponse(db, { workspaceId: c.workspaceId, memberId: c.memberId }, caseRow.id);
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

/** Ответ клиенту из обращения: ящик обращения (если доступен), тема с номером, ответ в ветке последнего входящего письма */
export async function replyToCase(db: Db, c: MailCtx, caseId: string, input: { mailboxId?: string | null; to: string[]; cc?: string[]; subject?: string | undefined; body: string; attachmentIds?: string[] }): Promise<EmailMessage> {
  const row = await loadCase(db, caseId);
  let mailboxId = input.mailboxId ?? null;
  if (!mailboxId && row.mailboxId) {
    const mine = (await listMailboxes(db, c)).some(m => m.id === row.mailboxId);
    if (mine) mailboxId = row.mailboxId;
  }
  const [last] = await db
    .select({ messageId: emailMessages.messageId })
    .from(emailMessages)
    .where(and(eq(emailMessages.caseId, caseId), eq(emailMessages.direction, 'in')))
    .orderBy(desc(emailMessages.createdAt), desc(emailMessages.id))
    .limit(1);
  return queueEmail(db, c, { mailboxId, to: input.to, cc: input.cc ?? [], subject: input.subject?.trim() || `Re: ${row.subject}`, body: input.body, attachmentIds: input.attachmentIds ?? [], caseId, inReplyTo: last?.messageId ?? null });
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
  if (m.direction === 'in') {
    if (!m.mailboxId) throw new DomainError(404, 'not_found', 'Email not found');
    await loadMailbox(db, c, m.mailboxId, 'read');
  }
  return m;
}

/** Переписка записи (лид, контакт, контрагент, сделка, документ) или указанные письма; без фильтра — свои письма (admin — все) */
export async function listEmails(db: Db, c: MailCtx, f: Links & { documentId?: string; ids?: string[]; direction?: 'in' | 'out'; unlinked?: string }, limit = 50, offset = 0): Promise<EmailMessage[]> {
  const accessible = (await listMailboxes(db, c)).map(m => m.id);
  const incomingVisible = and(eq(emailMessages.direction, 'in'), accessible.length ? inArray(emailMessages.mailboxId, accessible) : sql`false`);
  const conds = [
    or(eq(emailMessages.direction, 'out'), incomingVisible),
    f.direction ? eq(emailMessages.direction, f.direction) : undefined,
    f.unlinked === 'true' ? and(isNull(emailMessages.leadId), isNull(emailMessages.contactId), isNull(emailMessages.companyId), isNull(emailMessages.dealId), isNull(emailMessages.documentId)) : undefined,
    eq(emailMessages.workspaceId, c.workspaceId),
    f.leadId ? eq(emailMessages.leadId, f.leadId) : undefined,
    f.contactId ? eq(emailMessages.contactId, f.contactId) : undefined,
    f.companyId ? eq(emailMessages.companyId, f.companyId) : undefined,
    f.dealId ? eq(emailMessages.dealId, f.dealId) : undefined,
    f.documentId ? eq(emailMessages.documentId, f.documentId) : undefined,
    f.caseId ? eq(emailMessages.caseId, f.caseId) : undefined,
    f.ids?.length ? inArray(emailMessages.id, f.ids) : undefined,
  ];
  const filtered = !!(f.caseId || f.leadId || f.contactId || f.companyId || f.dealId || f.documentId || f.ids?.length);
  if (!filtered && !isAdmin(c)) conds.push(or(incomingVisible, and(eq(emailMessages.direction, 'out'), c.memberId ? eq(emailMessages.createdBy, c.memberId) : isNull(emailMessages.createdBy))));
  return db.select().from(emailMessages).where(and(...conds)).orderBy(desc(emailMessages.createdAt), desc(emailMessages.id)).limit(limit).offset(offset);
}

/** Ручная проверка доступного ящика; блокировка общая с планировщиком. */
export async function enqueueEmailSync(db: Db, c: MailCtx, id: string): Promise<{ queued: boolean }> {
  const m = await loadMailbox(db, c, id, 'read');
  if (rank[c.role] < rank.member) throw new DomainError(403, 'forbidden', 'No permission to sync mail');
  if (!m.imapHost || !m.imapPort || !m.imapSecure || !m.imapUser) throw new DomainError(422, 'bad_request', 'IMAP is not configured');
  await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.id, id)).for('update');
  const pending = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.type, 'email.sync'), sql`${jobs.payload}->>'mailboxId' = ${id}`, inArray(jobs.status, ['queued', 'running']))).limit(1);
  if (pending.length) return { queued: false };
  await db.insert(jobs).values({ workspaceId: c.workspaceId, type: 'email.sync', payload: { mailboxId: id }, maxAttempts: 5 });
  return { queued: true };
}

/** Привязать входящее письмо к контакту или лиду; касание переносится вместе с письмом. */
export async function linkEmail(db: Db, c: MailCtx, id: string, input: { contactId?: string; leadId?: string }): Promise<EmailMessage> {
  const m = await getEmail(db, c, id);
  if (rank[c.role] < rank.member) throw new DomainError(403, 'forbidden', 'No permission to link mail');
  if (m.direction !== 'in' || !!input.contactId === !!input.leadId) throw new DomainError(422, 'bad_request', 'Choose a contact or lead for an incoming email');
  await assertExists(db, input);
  const [contact] = input.contactId ? await db.select().from(contacts).where(eq(contacts.id, input.contactId)) : [];
  const links = { contactId: input.contactId ?? null, leadId: input.leadId ?? null, companyId: contact?.companyId ?? null, dealId: null, documentId: null };
  await db.select({ id: emailMessages.id }).from(emailMessages).where(eq(emailMessages.id, id)).for('update');
  const [row] = await db.update(emailMessages).set({ ...links, updatedAt: new Date() }).where(eq(emailMessages.id, id)).returning();
  const acts = await db.update(crmActivities).set({ contactId: links.contactId, leadId: links.leadId, companyId: links.companyId, dealId: null }).where(eq(crmActivities.emailMessageId, id)).returning();
  if (!acts.length) {
    const [act] = await db.insert(crmActivities).values({ workspaceId: c.workspaceId, type: 'email', subject: m.subject.slice(0, 200), body: m.bodyText.slice(0, 2000), emailMessageId: id, contactId: links.contactId, leadId: links.leadId, companyId: links.companyId }).returning();
    await recordEvent(db, { workspaceId: c.workspaceId, type: 'crm_activity.created', entity: 'crm_activity', recordId: act!.id, actorId: c.memberId, payload: {} });
  } else for (const act of acts) await recordEvent(db, { workspaceId: c.workspaceId, type: 'crm_activity.updated', entity: 'crm_activity', recordId: act.id, actorId: c.memberId, payload: {} });
  await recordEvent(db, { workspaceId: c.workspaceId, type: 'email.updated', entity: 'email', recordId: id, actorId: c.memberId, payload: links });
  return row!;
}
