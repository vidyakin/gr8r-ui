/* zod-схемы лидов (задача 1175, docs/architecture/leads.md): лиды, статусы, формы сайта, конвертация, объединение, вебхук. */
import { z } from 'zod';
import { LEAD_STATUS_CATEGORIES, LEAD_STATUS_COLORS } from '../leads';
import { clientId, decimal, listQuery, shortText, toPatch, uuid } from './common';
import { customData } from './meta';

export const leadCreate = z.object({
  id: clientId,
  name: shortText,
  companyName: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(50).default(''),
  email: z.string().trim().max(254).default(''),
  comment: z.string().max(5000).default(''),
  /** Источник — текст (справочник источников — задача 1177) */
  source: z.string().trim().max(200).default(''),
  ownerId: uuid.nullish(),
  /** По умолчанию — первый статус категории «new» */
  statusId: uuid.optional(),
  rejectReason: z.string().trim().max(500).default(''),
  custom: customData.optional(),
});
export const leadUpdate = toPatch(leadCreate.omit({ id: true }));
export const leadQuery = listQuery.extend({
  statusId: uuid.optional(),
  category: z.enum(LEAD_STATUS_CATEGORIES).optional(),
  ownerId: uuid.optional(),
  source: z.string().max(200).optional(),
});

export const leadStatusCreate = z.object({
  name: shortText,
  category: z.enum(LEAD_STATUS_CATEGORIES),
  color: z.enum(LEAD_STATUS_COLORS).default('gray'),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export const leadStatusUpdate = toPatch(leadStatusCreate);
export const leadStatusQuery = listQuery.extend({});
/** Порядок статусов: id в нужной последовательности */
export const leadStatusReorder = z.object({ ids: z.array(uuid).min(1).max(100) });

export const leadFormCreate = z.object({
  name: shortText,
  source: z.string().trim().max(200).default(''),
  defaultOwnerId: uuid.nullish(),
  enabled: z.boolean().default(true),
});
export const leadFormUpdate = toPatch(leadFormCreate);
export const leadFormQuery = listQuery.extend({});

/** Цель конвертации: найденная запись, новая (имя) или не создавать */
export const convertTarget = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('existing'), id: uuid }),
  z.object({ mode: z.literal('new'), name: z.string().trim().max(200).default('') }),
  z.object({ mode: z.literal('none') }),
]);

export const leadConvert = z.object({
  company: convertTarget.default({ mode: 'none' }),
  contact: convertTarget.default({ mode: 'none' }),
  /** Создать сделку: название и сумма */
  deal: z.object({ name: z.string().trim().max(200).default(''), amount: decimal.refine(v => Number(v) >= 0, 'Amount must not be negative').optional() }).nullish(),
});

export const leadMerge = z.object({ intoId: uuid });

export const leadAssign = z.object({ mode: z.enum(['manual', 'round_robin']), memberId: uuid.nullish() });

/** Поиск дублей до создания (форма нового лида) */
export const leadDuplicatesQuery = z.object({
  phone: z.string().max(50).optional(),
  email: z.string().max(254).optional(),
  companyName: z.string().max(200).optional(),
  excludeId: uuid.optional(),
});

/** Тело вебхука формы сайта (JSON или form-urlencoded): известные поля + utm_*; остальное игнорируется */
export const leadWebhookBody = z
  .object({
    name: z.string().trim().max(200).default(''),
    phone: z.string().trim().max(50).default(''),
    email: z.string().trim().max(254).default(''),
    company: z.string().trim().max(200).default(''),
    comment: z.string().max(5000).default(''),
  })
  .loose();
