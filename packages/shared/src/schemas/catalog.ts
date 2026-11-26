/* zod-схемы каталога: единицы ОКЕИ, категории, характеристики категорий, товары и услуги. */
import { z } from 'zod';
import { countryVatRate } from './countries';
import { PRODUCT_KINDS } from '../constants';
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
  vatRate: countryVatRate.optional(),
  /** Цена продажи */
  price: money.default('0'),
  purchasePrice: money.default('0'),
  categoryId: uuid.nullish(),
  /** Поставщик по умолчанию: заказы поставщикам по потребности создаются на него */
  defaultSupplierId: uuid.nullish(),
  /** Срок поставки, дней (в расчёте потребностей) */
  /** Насыпная плотность, т/м³ (добыча: перевод массы в объём) */
  bulkDensity: z.coerce.number().positive().max(100).nullish(),
  leadDays: z.coerce.number().int().min(0).max(365).default(0),
  /** Товар-родитель: вариант товара (комбинация параметров с флажком «разрез склада») */
  parentProductId: uuid.nullish(),
  /** Значения характеристик категории; проверяются по схеме категории (с унаследованными) */
  attrs: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().default(true),
  /** Комплект (набор как в УНФ): продаётся с автосписанием составляющих без производства */
  isKit: z.boolean().default(false),
  /** Учёт по серийным номерам: складские документы требуют номера по количеству */
  trackSerials: z.boolean().default(false),
  /** Партионный учёт (задача 1187): приход создаёт партию, расход списывается FEFO */
  trackBatches: z.boolean().default(false),
  /** Срок годности, дней (задача 1187): при приходе дата истечения = дата документа + срок; пусто — без срока */
  shelfLifeDays: z.number().int().min(1).max(3650).nullish(),
  /** Гарантия, мес. (пусто — без гарантии) */
  warrantyMonths: z.number().int().min(0).max(600).nullish(),
  /** Повторить продажу через, дн. (задача 1133; пусто — нет): после продажи у компании ставится дата следующего контакта */
  repeatSaleDays: z.number().int().min(1).max(3650).nullish(),
  appointmentMinutes: z.number().int().min(5).max(600).nullish(),
  /** Вес, кг (задача 1100): вес доставки = Σ количество × вес */
  weightKg: decimal.nullish().refine(v => v == null || Number(v) >= 0, 'Expected a non-negative weight'),
  /** Вид номенклатуры (задача 1172, необязательный): тип вида должен совпадать с kind товара */
  productKindId: uuid.nullish(),
  /** Основная картинка: вложение товара (entity_type = product, mime image/*, задача 1192) */
  imageAttachmentId: uuid.nullish(),
  custom: customData.optional(),
});
export const productUpdate = toPatch(productCreate.omit({ id: true }));
export const productQuery = listQuery.extend({
  categoryId: uuid.optional(),
  /** Включать подкатегории (по умолчанию да) */
  subtree: queryBool.optional(),
  kind: z.enum(PRODUCT_KINDS).optional(),
  active: queryBool.optional(),
  productKindId: uuid.optional(),
  /** Контрагент документа: поиск ?q= находит и по артикулу контрагента, ответ дополняется его артикулом и наименованием */
  counterpartyId: uuid.optional(),
});

/** Упаковки товара (единицы с коэффициентом, docs/plans/2026-11-14-product-packages.md): список заменяет прежний */
export const productUnitsBody = z.object({
  items: z
    .array(
      z.object({
        unitCode: z.string().trim().regex(/^\d{3,4}$/),
        /** Базовых единиц в одной такой: «ящик = 100 шт» → 100 */
        factor: z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/),
      }),
    )
    .max(20),
});
export type ProductUnitsBody = z.infer<typeof productUnitsBody>;

/** Состав комплекта (набора): список составляющих и необязательные доли цены */
export const productKitItemsBody = z.object({
  items: z
    .array(
      z.object({
        componentProductId: uuid,
        qty: decimal.refine(v => Number(v) > 0 && Number(v) < 1e12, 'Must be greater than zero'),
        priceShare: decimal.refine(v => Number(v) >= 0 && Number(v) < 1e12, 'Must not be negative').nullish(),
      }),
    )
    .max(100),
});
export type ProductKitItemsBody = z.infer<typeof productKitItemsBody>;
