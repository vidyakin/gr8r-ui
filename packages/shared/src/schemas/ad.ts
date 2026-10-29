/* zod-схемы источников привлечения и рекламных кампаний (задача 1177, docs/architecture/ad-campaigns.md). */
import { z } from 'zod';
import { LEAD_SOURCE_KINDS } from '../ad-report';
import { LEAD_STATUS_COLORS } from '../leads';
import { decimal, isoDate, listQuery, shortText, toPatch, uuid } from './common';

const nonNegative = decimal.refine(v => Number(v) >= 0, 'Amount must not be negative');

export const leadSourceCreate = z.object({
  name: shortText,
  color: z.enum(LEAD_STATUS_COLORS).default('gray'),
  /** Тип: канал, партнёр (у записи — контрагент, который привёл) или контактное лицо (контакт, который привёл) */
  kind: z.enum(LEAD_SOURCE_KINDS).default('channel'),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export const leadSourceUpdate = toPatch(leadSourceCreate);
export const leadSourceQuery = listQuery.extend({});

export const adCampaignCreate = z.object({
  name: shortText,
  sourceId: uuid,
  /** Код для сопоставления заявок с сайта (utm_campaign); уникален без учёта регистра */
  utmCampaign: z.string().trim().max(200).default(''),
  startDate: isoDate.nullish(),
  endDate: isoDate.nullish(),
  budget: nonNegative.default('0'),
  comment: z.string().max(5000).default(''),
  ownerId: uuid.nullish(),
});
export const adCampaignUpdate = toPatch(adCampaignCreate);
export const adCampaignQuery = listQuery.extend({ sourceId: uuid.optional() });

export const adExpenseCreate = z.object({
  campaignId: uuid,
  date: isoDate,
  amount: nonNegative,
  comment: z.string().max(1000).default(''),
});
export const adExpenseUpdate = toPatch(adExpenseCreate);
export const adExpenseQuery = listQuery.extend({ campaignId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional() });

/** Отчёт по каналам: период и разрез (источник или кампания) */
export const adReportQuery = z.object({
  from: isoDate,
  to: isoDate,
  /** referrer — по тем, кто привёл (источники-партнёры и контактные лица) */
  groupBy: z.enum(['source', 'campaign', 'referrer']).default('source'),
});

/** Источник и кампания записи (лид, форма, контрагент, сделка): кампания задаёт источник */
export const attribution = {
  sourceId: uuid.nullish(),
  campaignId: uuid.nullish(),
  /** Кто привёл: контрагент (источник-партнёр) или контакт (источник «контактное лицо»); к другому типу не сохраняется */
  referrerCompanyId: uuid.nullish(),
  referrerContactId: uuid.nullish(),
};
