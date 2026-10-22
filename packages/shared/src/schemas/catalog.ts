/* zod-схемы каталога: единицы ОКЕИ, категории, характеристики категорий, товары и услуги. */
import { z } from 'zod';
import { PRODUCT_KINDS, VAT_RATES } from '../constants';
import { FIELD_KEY_RE, FIELD_TYPES, type FieldType } from '../fields';
import { clientId, decimal, listQuery, queryBool, shortText, toPatch, uuid } from './common';
import { checkFieldOptions, customData, fieldOptions } from './meta';

const money = decimal.refine(v => Number(v) >= 0 && Number(v) < 1e15, 'Must be a non-negative amount');

/* ---------------- единицы ---------------- */

export const unitCreate = z.object({
  id: clientId,
  code: z.string().trim().regex(/^\d{3,4}$/, 'OKEI code: 3–4 digits'),
  name: shortText,
  symbol: z.string().trim().min(1).max(20),
});
/** Код не меняется: на него ссылаются товары и спецификации */
export const unitUpdate = toPatch(unitCreate.omit({ id: true, code: true }));
export const unitQuery = listQuery;

/* ---------------- категории и характеристики ---------------- */

export const categoryCreate = z.object({
  id: clientId,
  parentId: uuid.nullish(),
  name: shortText,
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});
export const categoryUpdate = toPatch(categoryCreate.omit({ id: true }));
export const categoryQuery = listQuery.extend({ limit: z.coerce.number().int().min(1).max(500).default(500) });

/** Типы характеристик: без ссылок на записи (user / ref / refs) и без даты со временем */
export const ATTRIBUTE_TYPES = FIELD_TYPES.filter(t => !['user', 'ref', 'refs', 'datetime'].includes(t)) as FieldType[];

export const attributeCreate = z
  .object({
    id: clientId,
    key: z.string().trim().regex(FIELD_KEY_RE, 'Key: lowercase letters, digits and underscore, starts with a letter').optional(),
    name: shortText,
    type: z.enum(ATTRIBUTE_TYPES as [FieldType, ...FieldType[]]),
    required: z.boolean().default(false),
    /** Единица измерения для подписи («мм», «кг») */
    unit: z.string().trim().max(20).default(''),
    options: fieldOptions.default({}),
  })
  .superRefine((v, ctx) => checkFieldOptions(v.type, v.options, ctx));
/** Ключ и тип не меняются: от них зависят записанные значения */
export const attributeUpdate = z
  .object({
    name: shortText.optional(),
    required: z.boolean().optional(),
    unit: z.string().trim().max(20).optional(),
    options: fieldOptions.optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

/* ---------------- товары и услуги ---------------- */

export const productCreate = z.object({
  id: clientId,
  kind: z.enum(PRODUCT_KINDS).default('goods'),
  sku: z.string().trim().max(64).default(''),
  name: shortText,
  description: z.string().max(5000).default(''),
  barcode: z
    .string()
    .trim()
    .regex(/^(\d{8,14})?$/, 'Barcode: 8–14 digits')
    .default(''),
  unitCode: z.string().trim().regex(/^\d{3,4}$/, 'OKEI code: 3–4 digits').default('796'),
  vatRate: z.enum(VAT_RATES).default('20'),
  /** Цена продажи */
  price: money.default('0'),
  purchasePrice: money.default('0'),
  categoryId: uuid.nullish(),
  /** Поставщик по умолчанию: заказы поставщикам по потребности создаются на него */
  defaultSupplierId: uuid.nullish(),
  /** Значения характеристик категории; проверяются по схеме категории (с унаследованными) */
  attrs: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().default(true),
  custom: customData.optional(),
});
export const productUpdate = toPatch(productCreate.omit({ id: true }));
export const productQuery = listQuery.extend({
  categoryId: uuid.optional(),
  /** Включать подкатегории (по умолчанию да) */
  subtree: queryBool.optional(),
  kind: z.enum(PRODUCT_KINDS).optional(),
  active: queryBool.optional(),
});
