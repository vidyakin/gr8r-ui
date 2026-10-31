/* zod-схемы правил автоматических скидок, промокодов и лояльности (задача 1179). */
import { z } from 'zod';
import { LOYALTY_CARD_KINDS } from '../loyalty';
import { clientId, decimal, isoDate, shortText, toPatch, uuid } from './common';

const pct = decimal.refine(v => Number(v) >= 0 && Number(v) <= 100, 'Percent must be between 0 and 100');
const weekday = z.number().int().min(1).max(7);
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected HH:MM');

export const discountRuleBody = z.object({
  id: clientId,
  name: shortText,
  discountPct: pct,
  stackable: z.boolean().default(false),
  promoOnly: z.boolean().default(false),
  validFrom: isoDate.nullish(),
  validTo: isoDate.nullish(),
  weekdays: z.array(weekday).max(7).default([]),
  timeFrom: time.nullish(),
  timeTo: time.nullish(),
  minDocumentAmount: decimal.refine(v => Number(v) >= 0, 'Must not be negative').default('0'),
  minLineQty: decimal.refine(v => Number(v) >= 0, 'Must not be negative').default('0'),
  customerIds: z.array(uuid).max(500).default([]),
  priceKindIds: z.array(uuid).max(50).default([]),
  productIds: z.array(uuid).max(2000).default([]),
  categoryIds: z.array(uuid).max(200).default([]),
});
export const discountRuleCreate = discountRuleBody;
export const discountRuleUpdate = toPatch(discountRuleBody.omit({ id: true }));

export const promoCodeBody = z.object({
  id: clientId,
  code: z.string().trim().min(1).max(40),
  ruleId: uuid,
  validFrom: isoDate.nullish(),
  validTo: isoDate.nullish(),
  usageLimit: z.number().int().min(0).nullish(),
});
export const promoCodeCreate = promoCodeBody;
export const promoCodeIssue = z.object({
  ruleId: uuid,
  count: z.number().int().min(1).max(1000),
  prefix: z.string().trim().max(20).optional(),
  usageLimit: promoCodeBody.shape.usageLimit,
  validFrom: promoCodeBody.shape.validFrom,
  validTo: promoCodeBody.shape.validTo,
});
export const promoCodeUpdate = toPatch(promoCodeBody.omit({ id: true }));

export const loyaltyProgramUpdate = z.object({
  accrualPct: pct.optional(),
  redemptionLimitPct: pct.optional(),
  expirationDays: z.number().int().min(1).nullish(),
  cumulativeScale: z
    .array(z.object({ fromAmount: decimal, pct }))
    .max(20)
    .optional(),
});

export const loyaltyCardBody = z.object({
  id: clientId,
  number: z.string().trim().min(1).max(40),
  customerId: uuid,
  kind: z.enum(LOYALTY_CARD_KINDS),
  discountPct: pct.nullish(),
  isActive: z.boolean().default(true),
});
export const loyaltyCardCreate = loyaltyCardBody;
export const loyaltyCardUpdate = toPatch(loyaltyCardBody.omit({ id: true, kind: true, customerId: true }));

export const loyaltyCardsQuery = z.object({
  customerId: uuid.optional(),
  archived: z.coerce.boolean().optional(),
});

/** Пересчёт автоскидок строк документа (кнопка «Пересчитать скидки») и выбор карты/промокода на документе */
export const discountRecalcBody = z.object({
  promoCode: z.string().trim().max(40).nullish(),
});

export const documentLoyaltyBody = z.object({
  promoCodeId: uuid.nullish(),
  loyaltyCardId: uuid.nullish(),
  pointsRedeemed: decimal.refine(v => Number(v) >= 0, 'Must not be negative').optional(),
});
