/* zod-схемы производства: участки, продукция (изделия и полуфабрикаты), строки спецификации, настройки. */
import { z } from 'zod';
import { BOM_KINDS, MANUFACTURED_KINDS, MATERIAL_PRICE_SOURCES, SEMI_MODES } from '../constants';
import { clientId, decimal, listQuery, shortText, toPatch, uuid } from './common';

const nonNeg = (max = 1e12) => decimal.refine(v => Number(v) >= 0 && Number(v) < max, 'Must not be negative');
const positive = (max = 1e12) => decimal.refine(v => Number(v) > 0 && Number(v) < max, 'Must be greater than zero');

/* ---------------- участки ---------------- */

export const workCenterCreate = z.object({
  id: clientId,
  code: z.string().trim().max(32).default(''),
  name: shortText,
  /** Ставка за час по умолчанию */
  hourlyRate: nonNeg().default('0'),
  note: z.string().max(1000).default(''),
});
export const workCenterUpdate = toPatch(workCenterCreate.omit({ id: true }));
export const workCenterQuery = listQuery;

/* ---------------- продукция ---------------- */

export const itemCreate = z.object({
  id: clientId,
  code: z.string().trim().max(32).default(''),
  name: shortText,
  kind: z.enum(MANUFACTURED_KINDS).default('product'),
  unitCode: z.string().trim().regex(/^\d{3,4}$/, 'OKEI code: 3–4 digits').default('796'),
  /** Товар каталога для продажи/склада (необязательно) */
  productId: uuid.nullish(),
  /** Спецификация задана на партию из batchQty единиц */
  batchQty: positive(1e9).default('1'),
  /** Накладные, % от прямых затрат */
  overheadPct: nonNeg(1000).default('0'),
});
export const itemUpdate = toPatch(itemCreate.omit({ id: true }));
export const itemQuery = listQuery.extend({ kind: z.enum(MANUFACTURED_KINDS).optional() });

/* ---------------- строки спецификации ---------------- */

export const bomLineCreate = z
  .object({
    id: clientId,
    kind: z.enum(BOM_KINDS),
    /** material / semi: количество на партию */
    qty: positive(1e9).optional(),
    productId: uuid.nullish(),
    scrapPct: nonNeg(1000).optional(),
    childItemId: uuid.nullish(),
    /** semi: режим полуфабриката — stock (списывается со склада) или explode (разворачивается до материалов) */
    semiMode: z.enum(SEMI_MODES).optional(),
    operation: z.string().trim().max(200).optional(),
    workCenterId: uuid.nullish(),
    hours: nonNeg(1e6).optional(),
    /** Ставка за час; пусто — ставка участка */
    rate: nonNeg().nullish(),
    fixedCost: nonNeg().nullish(),
    note: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    const need = (ok: boolean, path: string, message: string) => ok || ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.kind === 'material') {
      need(!!v.productId, 'productId', 'Choose a product');
      need(v.qty !== undefined, 'qty', 'Quantity is required');
      need(v.semiMode === undefined, 'semiMode', 'Not applicable to a material line');
    } else if (v.kind === 'semi') {
      need(!!v.childItemId, 'childItemId', 'Choose a product to include');
      need(v.qty !== undefined, 'qty', 'Quantity is required');
    } else {
      need(!!v.operation, 'operation', 'Name the operation');
      need((v.hours !== undefined && Number(v.hours) > 0) || (v.fixedCost != null && Number(v.fixedCost) > 0), 'hours', 'Set hours or a fixed cost');
      need(v.semiMode === undefined, 'semiMode', 'Not applicable to a work line');
    }
  });
/** Тип строки не меняется. Проверка полей по типу — в обработчике (после слияния с имеющимися значениями) */
export const bomLineUpdate = z
  .object({
    qty: positive(1e9).optional(),
    productId: uuid.optional(),
    scrapPct: nonNeg(1000).optional(),
    childItemId: uuid.optional(),
    /** semi: режим полуфабриката */
    semiMode: z.enum(SEMI_MODES).optional(),
    operation: z.string().trim().min(1).max(200).optional(),
    workCenterId: uuid.nullish(),
    hours: nonNeg(1e6).optional(),
    rate: nonNeg().nullish(),
    fixedCost: nonNeg().nullish(),
    note: z.string().max(500).optional(),
  })
  .strict();
export const bomReorder = z.object({ ids: z.array(uuid).min(1).max(500) });

/** Развёртка спецификации на количество: сколько единиц изделия и по какому складу считаем потребность */
export const explodeQuery = z.object({
  qty: positive(1e9).default('1'),
  /** Склад: остатки только его; без склада — по всем складам воркспейса */
  warehouseId: uuid.optional(),
});

/* ---------------- настройки ---------------- */

export const productionSettingsUpdate = z.object({ materialPriceSource: z.enum(MATERIAL_PRICE_SOURCES) }).strict();
export interface ProductionSettings {
  materialPriceSource: (typeof MATERIAL_PRICE_SOURCES)[number];
}
