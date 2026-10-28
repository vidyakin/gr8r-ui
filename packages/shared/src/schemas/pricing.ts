/* zod-схемы видов цен, установки цен, прайс-листа и публичной ссылки (задача 1178). */
import { z } from 'zod';
import { COST_BASES, PRICE_METHODS, ROUNDING_MODES, ROUNDING_STEPS } from '../pricing';
import { clientId, decimal, isoDate, queryBool, shortText, toPatch, uuid } from './common';

const percent = decimal.refine(v => Number(v) >= -100 && Number(v) <= 1000, 'Percent must be between -100 and 1000');
const price = decimal.refine(v => Number(v) >= 0, 'Price must not be negative');
const csvIds = z
  .string()
  .max(2000)
  .optional()
  .transform(v => (v ? v.split(',').filter(Boolean) : undefined));

export const priceKindBody = z.object({
  id: clientId,
  name: shortText,
  method: z.enum(PRICE_METHODS).default('manual'),
  baseKindId: uuid.nullish(),
  /** Наценка (+) или скидка (−), % */
  markupPct: percent.default('0'),
  costBasis: z.enum(COST_BASES).nullish(),
  roundingStep: z.enum(ROUNDING_STEPS).default('0.01'),
  roundingMode: z.enum(ROUNDING_MODES).default('math'),
  roundToNine: z.boolean().default(false),
  includesVat: z.boolean().default(true),
  /** Вид цен поставщика (контрагент-поставщик) */
  supplierId: uuid.nullish(),
  /** Поступление обновляет цены этого вида (для видов поставщика и «Закупочной») */
  updateFromReceipts: z.boolean().default(false),
});
export const priceKindCreate = priceKindBody;
export const priceKindUpdate = toPatch(priceKindBody.omit({ id: true, method: true }));

/* ---------------- подстановка цен ---------------- */

export const priceResolveBody = z.object({
  productIds: z.array(uuid).min(1).max(500),
  date: isoDate.optional(),
  party: z.enum(['customer', 'supplier']).default('customer'),
  /** Явный вид цен (шапка документа) */
  priceKindId: uuid.nullish(),
  contractId: uuid.nullish(),
  counterpartyId: uuid.nullish(),
  workOrderKindId: uuid.nullish(),
});

export const productPricesQuery = z.object({ date: isoDate.optional() });

/* ---------------- документ «Установка цен» ---------------- */

export const priceSettingLine = z.object({
  id: clientId,
  productId: uuid,
  priceKindId: uuid,
  price,
});

export const priceSettingCreate = z.object({
  id: clientId,
  date: isoDate.optional(),
  organizationId: uuid.nullish(),
  comment: z.string().max(2000).optional(),
  lines: z.array(priceSettingLine).max(5000).optional(),
});
export const priceSettingUpdate = z.object({
  date: isoDate.optional(),
  organizationId: uuid.nullish(),
  comment: z.string().max(2000).optional(),
  lines: z.array(priceSettingLine).max(5000).optional(),
});

export const priceSettingQuery = z.object({
  status: z
    .string()
    .optional()
    .transform(v => (v ? v.split(',').filter(Boolean) : undefined)),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Заполнение: по категории, по всем товарам или из поступления */
export const priceSettingFill = z.object({
  mode: z.enum(['all', 'category', 'receipt']),
  priceKindIds: z.array(uuid).min(1).max(20),
  categoryId: uuid.nullish(),
  receiptId: uuid.nullish(),
});

/** Массовое изменение строк: +N %, округлить или рассчитать по правилу вида */
export const priceSettingMass = z.object({
  action: z.enum(['percent', 'round', 'rule']),
  percent: percent.optional(),
  roundingStep: z.enum(ROUNDING_STEPS).optional(),
  roundingMode: z.enum(ROUNDING_MODES).optional(),
  roundToNine: z.boolean().optional(),
  /** Только строки этих видов; пусто — все */
  priceKindIds: z.array(uuid).max(20).optional(),
});

/* ---------------- прайс-лист ---------------- */

export const priceListQuery = z.object({
  kindIds: csvIds,
  categoryId: uuid.optional(),
  date: isoDate.optional(),
  inStock: queryBool.optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Загрузка цен из таблицы: файл XLSX/CSV (base64) → предпросмотр → черновик «Установки цен» */
export const priceImportPreview = z.object({
  fileName: z.string().max(200),
  /** Содержимое файла в base64 */
  data: z.string().max(14_000_000),
  /** Колонки с ценами: номер колонки (с 0) → вид цен */
  columns: z.array(z.object({ column: z.number().int().min(0).max(200), priceKindId: uuid })).max(20).optional(),
  /** Колонки артикула и названия (с 0); по умолчанию определяются по заголовку */
  skuColumn: z.number().int().min(0).max(200).optional(),
  nameColumn: z.number().int().min(0).max(200).optional(),
});
export const priceImportApply = priceImportPreview.extend({
  date: isoDate.optional(),
  /** Создать документ даже при строках без совпадения (они пропускаются) */
  skipUnmatched: z.boolean().default(true),
});

/* ---------------- публичная ссылка ---------------- */

export const priceListLinkCreate = z.object({
  name: shortText,
  priceKindIds: z.array(uuid).min(1).max(10),
  categoryIds: z.array(uuid).max(100).default([]),
  inStockOnly: z.boolean().default(false),
  /** Срок действия: пусто — бессрочно */
  expiresAt: isoDate.nullish(),
});
export const priceListLinkUpdate = toPatch(priceListLinkCreate);
