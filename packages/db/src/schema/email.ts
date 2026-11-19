/* Почта (задача 1092, docs/architecture/email.md): почтовые ящики (общий и личные) и письма. Таблицы арендатора: workspace_id + RLS.
   Пароль ящика лежит в хранилище секретов (`mailbox.<id>.password`), в таблице его нет. */
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './columns';
import { members } from './people';
import { wsCol } from './tenant';

export const MAILBOX_KINDS = ['shared', 'personal'] as const;
export const MAIL_SECURITY = ['ssl', 'starttls', 'none'] as const;
export const MAILBOX_STATUSES = ['ok', 'error', 'unchecked'] as const;
export const EMAIL_STATUSES = ['queued', 'sending', 'sent', 'failed', 'received'] as const;

/** Ящик: общий (один на воркспейс, member_id пуст) или личный (один на участника). Поля IMAP заполняются для входящих (инкремент Б) */
export const mailboxes = pgTable(
  'mailboxes',
  {
    id: pk(),
    workspaceId: wsCol(),
    kind: text('kind', { enum: MAILBOX_KINDS }).notNull(),
    memberId: uuid('member_id'),
    email: text('email').notNull(),
    displayName: text('display_name').notNull().default(''),
    smtpHost: text('smtp_host').notNull(),
    smtpPort: integer('smtp_port').notNull(),
    smtpSecure: text('smtp_secure', { enum: MAIL_SECURITY }).notNull().default('ssl'),
    smtpUser: text('smtp_user').notNull(),
    imapHost: text('imap_host'),
    imapPort: integer('imap_port'),
    imapSecure: text('imap_secure', { enum: MAIL_SECURITY }),
    imapUser: text('imap_user'),
    imapUidValidity: text('imap_uid_validity'),
    imapLastUid: bigint('imap_last_uid', { mode: 'number' }).notNull().default(0),
    createLeadFromUnmatched: boolean('create_lead_from_unmatched').notNull().default(false),
    signature: text('signature').notNull().default(''),
    status: text('status', { enum: MAILBOX_STATUSES }).notNull().default('unchecked'),
    lastError: text('last_error'),
    checkedAt: ts('checked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('mailboxes_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'mailboxes_member_fk' }).onDelete('cascade'),
    check('mailboxes_kind_chk', sql`(${t.kind} = 'shared' and ${t.memberId} is null) or (${t.kind} = 'personal' and ${t.memberId} is not null)`),
    uniqueIndex('mailboxes_shared_uq').on(t.workspaceId).where(sql`${t.kind} = 'shared'`),
    uniqueIndex('mailboxes_personal_uq').on(t.workspaceId, t.memberId).where(sql`${t.kind} = 'personal'`),
  ],
);

/** Письмо: исходящее ставится в очередь (`queued`) и уходит задачей воркера `email.send`; входящие (`received`) — инкремент Б */
export const emailMessages = pgTable(
  'email_messages',
  {
    id: pk(),
    workspaceId: wsCol(),
    mailboxId: uuid('mailbox_id'),
    direction: text('direction', { enum: ['out', 'in'] }).notNull().default('out'),
    status: text('status', { enum: EMAIL_STATUSES }).notNull().default('queued'),
    fromEmail: text('from_email').notNull(),
    fromName: text('from_name').notNull().default(''),
    to: text('to').array().notNull().default(sql`'{}'::text[]`),
    cc: text('cc').array().notNull().default(sql`'{}'::text[]`),
    subject: text('subject').notNull().default(''),
    bodyText: text('body_text').notNull().default(''),
    /** Очищенный HTML (sanitizeRichText); пусто — письмо только текстом */
    bodyHtml: text('body_html'),
    imapUidValidity: text('imap_uid_validity'),
    imapUid: bigint('imap_uid', { mode: 'number' }),
    messageId: text('message_id'),
    inReplyTo: text('in_reply_to'),
    references: text('references'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: ts('sent_at'),
    receivedAt: ts('received_at'),
    createdBy: uuid('created_by'),
    leadId: uuid('lead_id'),
    contactId: uuid('contact_id'),
    companyId: uuid('company_id'),
    dealId: uuid('deal_id'),
    documentId: uuid('document_id'),
    /** Печатная форма документа, которую воркер превращает в PDF-вложение при отправке */
    printForm: text('print_form'),
    printTemplateId: uuid('print_template_id'),
    /** Существующие вложения (attachments.id), права проверены при постановке в очередь */
    attachmentIds: uuid('attachment_ids').array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    uniqueIndex('email_messages_imap_uid_uq').on(t.workspaceId, t.mailboxId, t.imapUidValidity, t.imapUid),
    unique('email_messages_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.mailboxId], foreignColumns: [mailboxes.workspaceId, mailboxes.id], name: 'email_messages_mailbox_fk' }).onDelete('set null'),
    index('email_messages_ws_created_idx').on(t.workspaceId, t.createdAt),
    index('email_messages_lead_idx').on(t.leadId),
    index('email_messages_contact_idx').on(t.contactId),
    index('email_messages_company_idx').on(t.companyId),
    index('email_messages_deal_idx').on(t.dealId),
    index('email_messages_document_idx').on(t.documentId),
    index('email_messages_message_id_idx').on(t.workspaceId, t.messageId),
  ],
);
