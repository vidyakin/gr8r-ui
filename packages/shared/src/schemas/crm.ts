/* zod-схемы CRM: компании, контакты, сделки, активности. Деньги — строкой/числом, хранятся numeric(18,2). */
import { z } from 'zod';
import { CRM_ACTIVITY_TYPES, DEAL_STAGES } from '../constants';
import { decimal, toPatch, isoDate, listQuery, shortText, uuid } from './common';

export const companyCreate = z.object({
  name: shortText,
  industry: z.string().max(200).default(''),
  size: z.string().max(50).default(''),
  ownerId: uuid.nullish(),
  website: z.string().max(300).default(''),
  city: z.string().max(200).default(''),
});
export const companyUpdate = toPatch(companyCreate);
export const companyQuery = listQuery.extend({ ownerId: uuid.optional(), industry: z.string().max(200).optional() });

export const contactCreate = z.object({
  companyId: uuid.nullish(),
  name: shortText,
  title: z.string().max(200).default(''),
  email: z.string().trim().max(254).default(''),
  phone: z.string().max(50).default(''),
  ownerId: uuid.nullish(),
});
export const contactUpdate = toPatch(contactCreate);
export const contactQuery = listQuery.extend({ companyId: uuid.optional(), ownerId: uuid.optional() });

export const dealCreate = z.object({
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
});
export const dealUpdate = toPatch(dealCreate);
export const dealQuery = listQuery.extend({
  stage: z.enum(DEAL_STAGES).optional(),
  companyId: uuid.optional(),
  ownerId: uuid.optional(),
  closeFrom: isoDate.optional(),
  closeTo: isoDate.optional(),
});

export const crmActivityCreate = z.object({
  type: z.enum(CRM_ACTIVITY_TYPES),
  subject: shortText,
  dealId: uuid.nullish(),
  companyId: uuid.nullish(),
  contactId: uuid.nullish(),
  dueDate: isoDate.nullish(),
  done: z.boolean().nullish(),
  body: z.string().max(20_000).nullish(),
});
export const crmActivityUpdate = toPatch(crmActivityCreate);
export const crmActivityQuery = listQuery.extend({
  type: z.enum(CRM_ACTIVITY_TYPES).optional(),
  dealId: uuid.optional(),
  companyId: uuid.optional(),
  contactId: uuid.optional(),
});
