/* zod-схемы производства: участки, продукция (изделия и полуфабрикаты), строки спецификации, настройки. */
import { z } from 'zod';
import { BOM_KINDS, MANUFACTURED_KINDS, MATERIAL_PRICE_SOURCES, REPLENISHMENT_MODES, SEMI_MODES } from '../constants';
import { clientId, decimal, isoDate, isoDateTime, listQuery, shortText, toPatch, uuid } from './common';

const nonNeg = (max = 1e12) => decimal.refine(v => Number(v) >= 0 && Number(v) < max, 'Must not be negative');
const positive = (max = 1e12) => decimal.refine(v => Number(v) > 0 && Number(v) < max, 'Must be greater than zero');

/* ---------------- участки ---------------- */

export const workCenterCreate = z.object({
  id: clientId,
  code: z.string().trim().max(32).default(''),
  name: shortText,
  /** Ставка за час по умолчанию */
  hourlyRate: nonNeg().default('0'),
  /** Склад-цех участка: материалы передаются на него обычным перемещением */
  warehouseId: uuid.nullish(),
  /** Склад готовой продукции: куда участок выпускает продукцию */
  outputWarehouseId: uuid.nullish(),
  /** Склад отходов: куда уходят отходы производства */
  wasteWarehouseId: uuid.nullish(),
  note: z.string().max(1000).default(''),
});
export const workCenterUpdate = toPatch(workCenterCreate.omit({ id: true }));
export const workCenterQuery = listQuery;

/* ---------------- виды производства и этапы ---------------- */

/** Этап вида производства: последний этап списка — финальный («Завершение производства») */
export const productionStageInput = z.object({
  id: clientId,
  name: shortText,
});

/** Вид производства: наименование и упорядоченный список этапов */
export const productionKindCreate = z.object({
  id: clientId,
  name: shortText,
  note: z.string().max(1000).default(''),
  stages: z.array(productionStageInput).min(1).max(20),
});
export const productionKindUpdate = z.object({
  name: shortText.optional(),
  note: z.string().max(1000).optional(),
  stages: z.array(productionStageInput).min(1).max(20).optional(),
});
export const productionKindQuery = listQuery;

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
  /** Вид производства: этапы выпуска (без вида — единственный этап «Завершение производства») */
  productionKindId: uuid.nullish(),
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
    /** Этап, на котором расходуется материал или выполняется операция */
    stageId: uuid.nullish(),
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
    /** Этап, на котором расходуется материал или выполняется операция */
    stageId: uuid.nullish(),
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

/* ---------------- рабочее место «Выпуск продукции» ---------------- */

/** Отбор заказов рабочего места */
export const workbenchQuery = listQuery.extend({
  /** Заказ покупателя */
  customerOrderId: uuid.optional(),
  /** Заказ на производство */
  productionOrderId: uuid.optional(),
  /** Заказчик */
  counterpartyId: uuid.optional(),
  /** Товар каталога */
  productId: uuid.optional(),
  /** Состояние заказа на производство */
  state: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).optional(),
  /** Плановый срок: с даты */
  from: isoDate.optional(),
  /** Плановый срок: по дату */
  to: isoDate.optional(),
  /** Вид производства */
  productionKindId: uuid.optional(),
  /** Только продукция с этапами */
  staged: z.stringbool().optional(),
});

/** Режим выполнения: простой — весь остаток, расширенный — своё количество */
export const WORKBENCH_MODES = ['simple', 'extended'] as const;
export type WorkbenchMode = (typeof WORKBENCH_MODES)[number];

/** Выполнение рабочего места: строки заказов и их количество */
export const workbenchExecute = z.object({
  /** Дата документов выпуска (по умолчанию сегодня) */
  date: isoDate.optional(),
  /** Режим: простой — весь остаток, расширенный — количество из строки */
  mode: z.enum(WORKBENCH_MODES).default('simple'),
  rows: z
    .array(
      z.object({
        /** Заказ: покупателя или на производство */
        orderId: uuid,
        /** Источник строки */
        source: z.enum(['customer_order', 'production_order']),
        /** Строка заказа: позиция заказа на производство или строка заказа покупателя */
        lineId: uuid,
        /** Этап выпуска: пусто — «Завершение производства» */
        stageId: uuid.nullish(),
        /** Количество (расширенный режим) */
        qty: positive(1e9).optional(),
        /** Участок-изготовитель */
        workCenterId: uuid.optional(),
      }),
    )
    .min(1)
    .max(500),
});

/* ---------------- заказ на производство и выпуск ---------------- */

/** Строка заказа на производство: что выпускаем */
export const productionOrderItemInput = z.object({
  /** Продукция (изделие или полуфабрикат) */
  itemId: uuid,
  qty: positive(1e9),
  /** Строка заказа покупателя, которую выполняет эта позиция */
  customerOrderLineId: uuid.optional(),
});
export type ProductionOrderItemInput = z.infer<typeof productionOrderItemInput>;

export const productionOrderCreate = z.object({
  id: clientId,
  /** Участок-изготовитель */
  workCenterId: uuid.nullish(),
  /** Склад материалов (списывать из) */
  warehouseId: uuid.nullish(),
  /** Склад готовой продукции (продукция в) */
  targetWarehouseId: uuid.nullish(),
  /** Пусто — сегодня */
  date: isoDate.optional(),
  /** Плановый старт и финиш */
  plannedStart: isoDateTime.optional(),
  plannedEnd: isoDateTime.optional(),
  comment: z.string().max(5000).default(''),
  /** Родительский заказ на производство (дочерний заказ на полуфабрикат) */
  parentDocumentId: uuid.nullish(),
  items: z.array(productionOrderItemInput).max(200).default([]),
});
export const productionOrderUpdate = toPatch(productionOrderCreate.omit({ id: true }));

export const productionOrderQuery = listQuery.extend({
  /** Состояние заказа (planned | in_progress | done | closed) */
  state: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).optional(),
  /** Плановый старт: с даты */
  from: isoDate.optional(),
  /** Плановый финиш: по дату */
  to: isoDate.optional(),
});

/** Выпуск по заказу на производство: что производим */
export const productionCreate = z.object({
  /** Дата выпуска (по умолчанию сегодня) */
  date: isoDate.optional(),
  /** Участок-изготовитель */
  workCenterId: uuid.nullish(),
  /** Склад материалов (списывать из) */
  warehouseId: uuid.nullish(),
  /** Склад готовой продукции (продукция в) */
  targetWarehouseId: uuid.nullish(),
  /** Позиции заказа на производство, которые выпускаем */
  lines: z
    .array(
      z.object({
        /** Позиция заказа на производство */
        orderItemId: uuid.optional(),
        /** Этап выпуска: пусто — «Завершение производства» */
        stageId: uuid.nullish(),
        /** Количество */
        qty: positive(1e9),
      }),
    )
    .min(1)
    .max(200),
});

/** Выпуск прямо из заказа покупателя */
export const productionFromCustomerOrder = z.object({
  customerOrderId: uuid,
  date: isoDate.optional(),
  workCenterId: uuid.nullish(),
  warehouseId: uuid.nullish(),
  targetWarehouseId: uuid.nullish(),
  lines: z
    .array(z.object({ customerOrderLineId: uuid, stageId: uuid.nullish(), qty: positive(1e9) }))
    .min(1)
    .max(200),
});

/** Заказ на производство по заказу покупателя */
export const productionOrderFromCustomerOrder = z.object({
  customerOrderId: uuid,
  date: isoDate.optional(),
  workCenterId: uuid.nullish(),
  warehouseId: uuid.nullish(),
  targetWarehouseId: uuid.nullish(),
});

/** Способ пополнения товара и спецификация по умолчанию */
export const productManufacturingUpdate = z.object({
  /** Способ пополнения: закупить или выпустить */
  replenishment: z.enum(REPLENISHMENT_MODES),
  /** Что выпускаем вместо закупки */
  defaultItemId: uuid.nullish(),
});
/** Запись справочника пополнения: товар и его способ пополнения */
export const productManufacturingSet = productManufacturingUpdate.extend({ productId: uuid });
