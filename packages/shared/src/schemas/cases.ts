/* zod-схемы обращений клиентов (docs/architecture/cases.md): обращения, правила SLA, формы сайта, ответ, вебхук. */
import { z } from 'zod';
import { CASE_CHANNELS, CASE_PRIORITIES, CASE_STATUSES } from '../cases';
import { EMAIL_MAX_RECIPIENTS, isEmailAddress } from '../email';
import { listQuery, queryBool, shortText, toPatch, uuid } from './common';
import { customData } from './meta';

export const caseCreate = z.object({
  subject: shortText,
  description: z.string().max(20_000).default(''),
  priority: z.enum(CASE_PRIORITIES).default('normal'),
  channel: z.enum(CASE_CHANNELS).default('manual'),
  companyId: uuid.nullish(),
  contactId: uuid.nullish(),
  leadId: uuid.nullish(),
  /** Ответственный: пусто — по умолчанию ящика или по кругу среди должности с функцией support_agent */
  ownerId: uuid.nullish(),
  dealId: uuid.nullish(),
  mailboxId: uuid.nullish(),
  custom: customData.optional(),
});

export const caseUpdate = toPatch(
  caseCreate.omit({ channel: true }).extend({
    status: z.enum(CASE_STATUSES),
  }),
);

export const caseQuery = listQuery.extend({
  status: z.enum(CASE_STATUSES).optional(),
  /** Открытые (new / in_progress / waiting) */
  open: z.enum(['true', 'false']).optional(),
  priority: z.enum(CASE_PRIORITIES).optional(),
  ownerId: uuid.optional(),
  channel: z.enum(CASE_CHANNELS).optional(),
  companyId: uuid.optional(),
  contactId: uuid.optional(),
  /** Просроченные: срок SLA нарушен у открытого обращения */
  overdue: queryBool.optional(),
});

const slaRule = z.object({ firstResponseHours: z.number().int().min(1).max(8760), resolveHours: z.number().int().min(1).max(8760) });
/** Правила SLA по всем приоритетам разом */
export const caseSlaRulesUpdate = z.object({ low: slaRule, normal: slaRule, high: slaRule, urgent: slaRule });

export const caseFormCreate = z.object({
  name: shortText,
  defaultOwnerId: uuid.nullish(),
  enabled: z.boolean().default(true),
});
export const caseFormUpdate = toPatch(caseFormCreate);
export const caseFormQuery = listQuery.extend({});

const address = z.string().trim().max(254).refine(isEmailAddress, 'Expected an email address');
/** Ответ клиенту письмом: ящик — ящик обращения, иначе по правилам почты */
export const caseReply = z.object({
  mailboxId: uuid.nullish(),
  to: z.array(address).min(1).max(EMAIL_MAX_RECIPIENTS),
  cc: z.array(address).max(EMAIL_MAX_RECIPIENTS).default([]),
  subject: z.string().trim().max(500).optional(),
  body: z.string().max(200_000).default(''),
  attachmentIds: z.array(uuid).max(20).default([]),
});

/** Тело вебхука формы обращений (JSON или form-urlencoded) */
export const caseWebhookBody = z
  .object({
    name: z.string().trim().max(200).default(''),
    email: z.string().trim().max(254).default(''),
    phone: z.string().trim().max(50).default(''),
    company: z.string().trim().max(200).default(''),
    subject: z.string().trim().max(200).default(''),
    message: z.string().max(20_000).default(''),
    priority: z.enum(CASE_PRIORITIES).optional().catch(undefined),
  })
  .loose();

export type CaseCreate = z.infer<typeof caseCreate>;
export type CaseUpdate = z.infer<typeof caseUpdate>;
export type CaseReply = z.infer<typeof caseReply>;
