/* zod-схемы CRM: компании, контакты, сделки, активности. Деньги — строкой/числом, хранятся numeric(18,2). */
import { z } from 'zod';
import { CRM_ACTIVITY_TYPES, DEAL_STAGES } from '../constants';
import { COMPANY_KINDS } from '../ru';
import { clientId, decimal, toPatch, isoDate, listQuery, shortText, uuid } from './common';
import { customData } from './meta';

export const companyCreate = z.object({
  id: clientId,
  name: shortText,
  industry: z.string().max(200).default(''),
  size: z.string().max(50).default(''),
  ownerId: uuid.nullish(),
  website: z.string().max(300).default(''),
  city: z.string().max(200).default(''),
  /** Реквизиты (Россия): тип контрагента, ИНН (контрольная сумма проверяется на сервере вместе с типом), КПП, ОГРН/ОГРНИП, адреса */
  kind: z.enum(COMPANY_KINDS).default('legal'),
  inn: z.string().trim().regex(/^(\d{10}|\d{12})?$/, 'INN: 10 or 12 digits').default(''),
  kpp: z.string().trim().regex(/^([0-9]{4}[0-9A-Z]{2}[0-9]{3})?$/, 'KPP: 9 characters').default(''),
  ogrn: z.string().trim().regex(/^(\d{13}|\d{15})?$/, 'OGRN: 13 digits, OGRNIP: 15 digits').default(''),
  legalAddress: z.string().trim().max(500).default(''),
  actualAddress: z.string().trim().max(500).default(''),
  /** Следующий контакт (задача 1133): дата и заметка; пусто — контакта не запланировано */
  /** Взаиморасчёты: по документам или по контрагенту в целом (задача 1174б) */
  settlementMode: z.enum(['by_documents', 'by_counterparty']).default('by_documents'),
  nextContactDate: isoDate.nullish(),
  nextContactNote: z.string().trim().max(500).default(''),
  custom: customData.optional(),
});
export const companyUpdate = toPatch(companyCreate.omit({ id: true }));
export const companyQuery = listQuery.extend({ ownerId: uuid.optional(), industry: z.string().max(200).optional() });

export const contactCreate = z.object({
  id: clientId,
  companyId: uuid.nullish(),
  name: shortText,
  title: z.string().max(200).default(''),
  email: z.string().trim().max(254).default(''),
  phone: z.string().max(50).default(''),
  ownerId: uuid.nullish(),
  custom: customData.optional(),
});
export const contactUpdate = toPatch(contactCreate.omit({ id: true }));
export const contactQuery = listQuery.extend({ companyId: uuid.optional(), ownerId: uuid.optional() });

export const dealCreate = z.object({
  id: clientId,
  name: shortText,
  companyId: uuid.nullish(),
  ownerId: uuid.nullish(),
  amount: decimal.refine(v => Number(v) >= 0, 'Amount must not be negative').default('0'),
  currency: z.string().length(3).toUpperCase().default('USD'),
  stage: z.enum(DEAL_STAGES).default('lead'),
  closeDate: isoDate.nullish(),
  closedAt: isoDate.nullish(),
  lostReason: z.string().max(500).nullish(),
  sortOrder: z.number().optional(),
  /** Контакты сделки (заменяют список целиком) */
  contactIds: z.array(uuid).max(100).optional(),
  custom: customData.optional(),
});
export const dealUpdate = toPatch(dealCreate.omit({ id: true }));
export const dealQuery = listQuery.extend({
  stage: z.enum(DEAL_STAGES).optional(),
  companyId: uuid.optional(),
  ownerId: uuid.optional(),
  closeFrom: isoDate.optional(),
  closeTo: isoDate.optional(),
});

export const crmActivityCreate = z.object({
  id: clientId,
  type: z.enum(CRM_ACTIVITY_TYPES),
  subject: shortText,
  dealId: uuid.nullish(),
  companyId: uuid.nullish(),
  contactId: uuid.nullish(),
  dueDate: isoDate.nullish(),
  done: z.boolean().nullish(),
  body: z.string().max(20_000).nullish(),
});
export const crmActivityUpdate = toPatch(crmActivityCreate.omit({ id: true }));
export const crmActivityQuery = listQuery.extend({
  type: z.enum(CRM_ACTIVITY_TYPES).optional(),
  dealId: uuid.optional(),
  companyId: uuid.optional(),
  contactId: uuid.optional(),
});

