/* zod-схемы почты (задача 1092, docs/architecture/email.md): ящики и письма. */
import { z } from 'zod';
import { EMAIL_MAX_RECIPIENTS, isEmailAddress } from '../email';
import { listQuery, uuid } from './common';

const security = z.enum(['ssl', 'starttls', 'none']);
const host = z.string().trim().min(1).max(253);
const port = z.number().int().min(1).max(65535);
const address = z.string().trim().max(254).refine(isEmailAddress, 'Expected an email address');

export const mailboxCreate = z.object({
  kind: z.enum(['shared', 'personal']),
  email: address,
  displayName: z.string().trim().max(200).default(''),
  smtpHost: host,
  smtpPort: port,
  smtpSecure: security,
  smtpUser: z.string().trim().min(1).max(254),
  imapHost: host.nullish(),
  imapPort: port.nullish(),
  imapSecure: security.nullish(),
  imapUser: z.string().trim().min(1).max(254).nullish(),
  signature: z.string().max(5000).default(''),
  /** Пароль приложения: уходит в хранилище секретов, в ответах не возвращается */
  password: z.string().min(1).max(512).optional(),
});

export const mailboxUpdate = mailboxCreate.omit({ kind: true }).partial();

export const emailCreate = z.object({
  /** Явный ящик; иначе личный ящик автора, иначе общий */
  mailboxId: uuid.nullish(),
  to: z.array(address).min(1).max(EMAIL_MAX_RECIPIENTS),
  cc: z.array(address).max(EMAIL_MAX_RECIPIENTS).default([]),
  subject: z.string().trim().min(1).max(500),
  body: z.string().max(200_000).default(''),
  /** Очищенный HTML (необязательно): сервер пропускает его через sanitizeRichText */
  bodyHtml: z.string().max(400_000).nullish(),
  inReplyTo: z.string().max(998).nullish(),
  /** id существующих вложений (права на объект проверяются) */
  attachmentIds: z.array(uuid).max(20).default([]),
  leadId: uuid.nullish(),
  contactId: uuid.nullish(),
  companyId: uuid.nullish(),
  dealId: uuid.nullish(),
  /** Документ и печатная форма: воркер приложит PDF при отправке */
  documentId: uuid.nullish(),
  printForm: z.string().max(40).nullish(),
  templateId: uuid.nullish(),
});

export const emailQuery = listQuery.pick({ limit: true, offset: true }).extend({
  leadId: uuid.optional(),
  contactId: uuid.optional(),
  companyId: uuid.optional(),
  dealId: uuid.optional(),
  documentId: uuid.optional(),
  /** Только указанные письма (через запятую), для ленты касаний */
  ids: z.string().max(2000).optional(),
});

export type MailboxCreate = z.infer<typeof mailboxCreate>;
export type MailboxUpdate = z.infer<typeof mailboxUpdate>;
export type EmailCreate = z.infer<typeof emailCreate>;
