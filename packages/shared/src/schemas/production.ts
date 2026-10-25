/* zod-схемы производства: участки, продукция (изделия и полуфабрикаты), строки спецификации, настройки. */
import { z } from 'zod';
import { BOM_KINDS, DEFECT_MODES, MANUFACTURED_KINDS, MATERIAL_PRICE_SOURCES, NEEDS_METHODS, OPERATION_RATE_UNITS, PARAM_TYPES, PLAN_STEPS, PLAN_STATUSES, REPLENISHMENT_MODES, SEMI_MODES, SPEC_MODES, STOCK_REPLENISHMENT, WASTE_PRICE_SOURCES, WASTE_VALUATION } from '../constants';
import { MATERIAL_OWNERS } from '../documents';
import { CALENDAR_KINDS, LOAD_ROW_TYPES } from '../planning';
import { PARAM_KEY_RE } from '../parameters';
import { clientId, decimal, isoDate, isoDateTime, listQuery, shortText, toPatch, uuid } from './common';
import { paramValues } from './documents';
import { PRODUCTION_OPERATIONS } from '../documents';
import { checkFieldOptions, fieldOptions } from './meta';

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
  /** Склад брака: куда идёт бракованная продукция при учёте «на расходы» */
  defectWarehouseId: uuid.nullish(),
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

/** Параметр спецификации: описание значения (те же описания полей, что у характеристик категории) + флажок «разрез склада» */
export const specParamInput = z.object({
  key: z.string().trim().regex(PARAM_KEY_RE, 'Key: lowercase letters, digits and underscores'),
  name: shortText,
  type: z.enum(PARAM_TYPES),
  required: z.boolean().default(false),
  options: fieldOptions.default({}),
  /** Разрез склада: комбинация таких параметров даёт вариант товара */
  stockDimension: z.boolean().default(false),
})
  // те же правила вариантов и границ, что у полей конструктора (выборы, min/max, maxLength)
  .superRefine((v, ctx) => checkFieldOptions(v.type as never, v.options, ctx));

/** Параметры спецификации: до 20 параметров */
export const specParams = z.array(specParamInput).max(20);

export const itemCreate = z.object({
  id: clientId,
  code: z.string().trim().max(32).default(''),
  name: shortText,
  kind: z.enum(MANUFACTURED_KINDS).default('product'),
  /** Вид спецификации: сборка (изделие из материалов) или разборка (исходный товар делится на выходные продукты) */
  mode: z.enum(SPEC_MODES).default('assembly'),
  unitCode: z.string().trim().regex(/^\d{3,4}$/, 'OKEI code: 3–4 digits').default('796'),
  /** Товар каталога для продажи/склада (необязательно) */
  productId: uuid.nullish(),
  /** Спецификация задана на партию из batchQty единиц */
  batchQty: positive(1e9).default('1'),
  /** Накладные, % от прямых затрат */
  overheadPct: nonNeg(1000).default('0'),
  /** Вид производства: этапы выпуска (без вида — единственный этап «Завершение производства») */
  productionKindId: uuid.nullish(),
  /** Параметры спецификации: к ним добавляются характеристики категории товара */
  params: specParams.default([]),
  /** Недействительна: устаревшая спецификация — в новых документах не предлагается */
  isInvalid: z.boolean().default(false),
  /** Дней на изготовление (рабочих): дата запуска = дата выпуска минус это число по рабочему календарю */
  leadDays: z.coerce.number().int().min(0).max(365).default(0),
});
export const itemUpdate = toPatch(itemCreate.omit({ id: true }));
export const itemQuery = listQuery.extend({
  kind: z.enum(MANUFACTURED_KINDS).optional(),
  /** Фильтр списка «Содержит материал/операцию»: товар (материал, расход) или операция есть в строках спецификации */
  contains: uuid.optional(),
});

/* ---------------- строки спецификации ---------------- */

export const bomLineCreate = z
  .object({
    id: clientId,
    kind: z.enum(BOM_KINDS),
    /** material / semi / output / waste: количество на партию */
    qty: positive(1e9).optional(),
    productId: uuid.nullish(),
    scrapPct: nonNeg(1000).optional(),
    /** output: доля стоимости исходного товара, % (если задана хоть одна — заданы все, сумма 100) */
    costShare: nonNeg(1000).nullish(),
    childItemId: uuid.nullish(),
    /** semi: режим полуфабриката — stock (списывается со склада) или explode (разворачивается до материалов) */
    semiMode: z.enum(SEMI_MODES).optional(),
    /** Формула количества строки над параметрами спецификации (пусто — обычное qty) */
    qtyExpr: z.string().trim().max(500).nullish(),
    /** Условие строки (пусто — строка всегда; ложное условие исключает строку из состава) */
    condition: z.string().trim().max(500).nullish(),
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
    } else if (v.kind === 'expense') {
      // расход: услуга подрядчика — в себестоимость, но не на склад
      need(!!v.productId, 'productId', 'Choose a service');
      need(v.qty !== undefined, 'qty', 'Quantity is required');
      need(v.semiMode === undefined, 'semiMode', 'Not applicable to an expense line');
    } else if (v.kind === 'semi') {
      need(!!v.childItemId, 'childItemId', 'Choose a product to include');
      need(v.qty !== undefined, 'qty', 'Quantity is required');
    } else if (v.kind === 'output') {
      // выходной продукт разборки: товар каталога и количество на партию
      need(!!v.productId, 'productId', 'Choose the output product');
      need(v.qty !== undefined, 'qty', 'Quantity is required');
      need(v.semiMode === undefined, 'semiMode', 'Not applicable to an output line');
    } else if (v.kind === 'waste') {
      // возвратный отход: товар-отход и количество на партию, без списания процента и доли стоимости
      need(!!v.productId, 'productId', 'Choose the waste product');
      need(v.qty !== undefined, 'qty', 'Quantity is required');
      need(v.scrapPct === undefined, 'scrapPct', 'Not applicable to a waste line');
      need(v.costShare == null, 'costShare', 'Not applicable to a waste line');
      need(v.semiMode === undefined, 'semiMode', 'Not applicable to a waste line');
      need(v.childItemId == null, 'childItemId', 'Not applicable to a waste line');
      need(v.workCenterId == null, 'workCenterId', 'Not applicable to a waste line');
      need(v.operation === undefined, 'operation', 'Not applicable to a waste line');
    } else {
      // работа: операция (товар каталога) или текстовое название; часы и ставка — норма строки
      need(!!v.operation || !!v.productId, 'operation', 'Name the operation or choose one from the catalogue');
      need((v.hours !== undefined && Number(v.hours) > 0) || (v.fixedCost != null && Number(v.fixedCost) > 0) || !!v.productId, 'hours', 'Set hours or a fixed cost');
      need(v.semiMode === undefined, 'semiMode', 'Not applicable to a work line');
    }
  });
/** Тип строки не меняется. Проверка полей по типу — в обработчике (после слияния с имеющимися значениями) */
export const bomLineUpdate = z
  .object({
    qty: positive(1e9).optional(),
    productId: uuid.optional(),
    scrapPct: nonNeg(1000).optional(),
    /** output: доля стоимости исходного товара, % */
    costShare: nonNeg(1000).nullish(),
    childItemId: uuid.optional(),
    /** semi: режим полуфабриката */
    semiMode: z.enum(SEMI_MODES).optional(),
    /** Формула количества строки над параметрами спецификации */
    qtyExpr: z.string().trim().max(500).nullish(),
    /** Условие строки */
    condition: z.string().trim().max(500).nullish(),
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
  /** Значения параметров изделия JSON-объектом (предпросмотр формул в интерфейсе) */
  params: z.string().trim().max(4000).optional(),
});
/** Печатные формы спецификации: кратко (свои строки) и развёрнуто (все переделы до исходных материалов) */
export const BOM_PRINT_FORMS = ['short', 'expanded'] as const;
export type BomPrintForm = (typeof BOM_PRINT_FORMS)[number];
export const bomPrintParam = z.object({ id: uuid, form: z.enum(BOM_PRINT_FORMS) });

/** Значения параметров из строки запроса (JSON-объект) */
export function parseParamJson(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new z.ZodError([{ code: 'custom', path: ['params'], message: 'Not a JSON object' }]);
  }
  const res = paramValues.safeParse(parsed);
  if (!res.success) throw new z.ZodError([{ code: 'custom', path: ['params'], message: 'Parameter values: numbers, strings or true/false' }]);
  return res.data;
}

/* ---------------- настройки ---------------- */

export const productionSettingsUpdate = z
  .object({
    materialPriceSource: z.enum(MATERIAL_PRICE_SOURCES).optional(),
    /** Учётная цена возвратных отходов: purchase (по умолчанию) | price | avg_cost */
    wastePriceSource: z.enum(WASTE_PRICE_SOURCES).optional(),
  })
  .strict();
export interface ProductionSettings {
  materialPriceSource: (typeof MATERIAL_PRICE_SOURCES)[number];
  wastePriceSource: (typeof WASTE_PRICE_SOURCES)[number];
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
        /** Отметка мастера: кто и сколько выполнил (строки сдельных нарядов исполнителей) */
        assignments: z.array(z.object({ assignmentId: uuid, qty: positive(1e9) })).max(50).optional(),
      }),
    )
    .min(1)
    .max(500),
});

/* ---------------- обеспечение материалов ---------------- */

/** Правка резерва материала в строке заказа на производство: сколько в резерв и на каком складе */
export const materialReservationUpdate = z.object({
  /** Сколько зарезервировать (всего по строке) */
  qty: nonNeg(1e9),
  /** Склад резерва */
  warehouseId: uuid,
});

/** Создание дочерних заказов на полуфабрикаты по дефициту */
export const semiOrdersCreate = z.object({
  /** Дата заказов (по умолчанию сегодня) */
  date: isoDate.optional(),
});

/** Создание заказа поставщику по материалам заказа на производство (размещение) */
export const supplierOrdersCreate = z.object({
  /** Дата заказов (по умолчанию сегодня) */
  date: isoDate.optional(),
  /** Поставщик: пусто — берётся поставщик товара по умолчанию */
  supplierId: uuid.nullish(),
  /** Комментарий к заказу */
  comment: z.string().max(5000).default(''),
});

/** Сводная потребность по материалам заказов на производство */
export const productionNeedsQuery = listQuery.extend({
  /** Заказ на производство: только его потребность */
  productionOrderId: uuid.optional(),
  /** Товар каталога */
  productId: uuid.optional(),
});

/** Заказы поставщикам по сводной потребности */
export const needsSupplierOrdersCreate = z.object({
  /** Дата заказов (по умолчанию сегодня) */
  date: isoDate.optional(),
  /** Комментарий к заказам */
  comment: z.string().max(5000).default(''),
  lines: z
    .array(
      z.object({
        /** Товар каталога */
        productId: uuid,
        /** Сколько заказать */
        qty: positive(1e9),
        /** Поставщик: пусто — поставщик товара по умолчанию или последнего поступления */
        supplierId: uuid.nullish(),
      }),
    )
    .min(1)
    .max(500),
});

/* ---------------- план производства ---------------- */

/** Строка плана: изделие, период (начало периода = дата выпуска) и количество */
export const productionPlanLineInput = z.object({
  id: clientId,
  itemId: uuid,
  /** Начало периода = дата выпуска */
  periodStart: isoDate,
  /** Сколько выпустить к этой дате */
  qty: nonNeg(1e9),
  /** Строка полуфабриката (добавлена кнопкой «Plan semi-finished») */
  isSemi: z.boolean().default(false),
});

export const productionPlanCreate = z.object({
  id: clientId,
  name: shortText,
  periodFrom: isoDate,
  periodTo: isoDate,
  /** Шаг периодов: неделя или месяц */
  step: z.enum(PLAN_STEPS).default('week'),
  /** Состояние: черновик или утверждён */
  status: z.enum(PLAN_STATUSES).default('draft'),
  /** Склад готовой продукции */
  warehouseId: uuid,
  /** Участок-диспетчер (необязателен) */
  workCenterId: uuid.nullish(),
  comment: z.string().max(5000).default(''),
  lines: z.array(productionPlanLineInput).max(500).default([]),
});
export const productionPlanUpdate = toPatch(productionPlanCreate.omit({ id: true }));
export const productionPlanQuery = listQuery.extend({
  status: z.enum(PLAN_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  warehouseId: uuid.optional(),
  workCenterId: uuid.optional(),
});

/** Источник автозаполнения плана */
export const PLAN_FILL_SOURCES = ['output', 'sales', 'customer_orders'] as const;
export type PlanFillSource = (typeof PLAN_FILL_SOURCES)[number];

/** Заполнение плана: вручную, по статистике выпуска, по статистике продаж или по заказам покупателей */
export const productionPlanFill = z.object({
  source: z.enum(PLAN_FILL_SOURCES),
  /** Заменить строки продукции или добавить к ним */
  mode: z.enum(['replace', 'add']).default('replace'),
  /** Сколько прошлых периодов взять для статистики выпуска и продаж */
  periods: z.coerce.number().int().min(1).max(60).default(6),
});

/** Полуфабрикаты к плану: строки добавляются пропорционально продукции, сдвиг — на срок изготовления */
export const productionPlanSemi = z.object({
  /** Только строки этих изделий (пусто — все строки продукции) */
  itemIds: z.array(uuid).max(200).default([]),
});

/** Заказы на производство по плану: остаток «план − уже заказано» черновиками */
export const productionPlanOrders = z.object({
  /** Период: строки этого периода (пусто — все строки плана) */
  periodStart: isoDate.nullish(),
  /** Строки плана: пусто — все строки периода с остатком */
  lineIds: z.array(uuid).max(500).default([]),
  /** Дата заказов (по умолчанию сегодня) */
  date: isoDate.optional(),
  comment: z.string().max(5000).default(''),
});

/** Рабочее место «Заказы по плану»: период и участок */
export const planWorkbenchQuery = z.object({
  /** Период (начало периода плана) */
  periodStart: isoDate.optional(),
  workCenterId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/* ---------------- нормы запаса ---------------- */

/** Норма запаса товара: строка по складу или строка без склада (норма по компании) */
export const stockLevelInput = z.object({
  warehouseId: uuid.nullish(),
  minQty: nonNeg(1e9),
  maxQty: nonNeg(1e9),
  replenishment: z.enum(STOCK_REPLENISHMENT),
  /** Склад-источник: обязателен для перемещения */
  sourceWarehouseId: uuid.nullish(),
});
/** Нормы запаса товара заменяются целиком: строка без склада — норма по компании */
export const stockLevelsSet = z.object({
  productId: uuid,
  rows: z.array(stockLevelInput).max(100).default([]),
});
export const stockLevelsQuery = z.object({ productId: uuid });

/* ---------------- общий расчёт потребностей ---------------- */

/** Параметры расчёта потребностей: три шага — рекомендации, планирование, заказы */
export const needsCalculateQuery = z.object({
    /** Способ пополнения: закупка, производство, перемещение или все */
    replenishment: z.enum([...STOCK_REPLENISHMENT, 'all']).default('all'),
    /** Методика: по заказам с мин./макс. или по продажам */
    method: z.enum(NEEDS_METHODS).default('orders'),
    /** Шаг периода: день, неделя или месяц */
    step: z.enum(['day', 'week', 'month']).default('week'),
    /** Сколько периодов в горизонте */
    periods: z.coerce.number().int().min(1).max(60).default(8),
    /** Начало горизонта (по умолчанию сегодня) */
    from: isoDate.optional(),
    /** Учитывать потребность по складам (false — по компании в целом) */
    byWarehouse: z.stringbool().default(true),
    /** Склад (по складам); без склада — суммы по всем складам */
    warehouseId: uuid.optional(),
    /** Заказы поставщикам, на производство и планы: товары-источники потребления */
    source: z.enum(['all', 'orders', 'plan']).default('all'),
    /** Только заданные нормы (по умолчанию — все товары с нормой) */
    productId: uuid.optional(),
    /** Страховой запас по дням поставки (методика «по статистике продаж») */
    safetyDays: z.coerce.number().int().min(0).max(365).default(0),
    /** Страховой запас в процентах от плановой потребности; может быть отрицательным */
    safetyPct: z.coerce.number().min(-100).max(1000).optional(),
    /** Сколько прошлых периодов брать для средних продаж */
    historyPeriods: z.coerce.number().int().min(1).max(60).default(6),
  });

/** Черновики заказов по рассчитанной потребности */
export const needsOrdersCreate = z.object({
  /** Способ пополнения: закупка, производство или перемещение */
  replenishment: z.enum(STOCK_REPLENISHMENT).default('purchase'),
  /** Поставщик или участок: пусто — по умолчанию (поставщик товара, участок плана) */
  supplierId: uuid.nullish(),
  workCenterId: uuid.nullish(),
  /** Дата поступления (по умолчанию — дата дефицита) */
  date: isoDate.nullish(),
  /** Поставка одной датой, а не на каждый период дефицита */
  singleDate: z.boolean().default(false),
  /** Отдельный заказ под каждый заказ покупателя */
  perCustomerOrder: z.boolean().default(false),
  comment: z.string().max(5000).default(''),
  lines: z
    .array(
      z.object({
        /** Товар каталога */
        productId: uuid,
        /** Склад-получатель */
        warehouseId: uuid.nullish(),
        /** Склад-источник (для перемещения) */
        sourceWarehouseId: uuid.nullish(),
        /** Участок-производитель (для производства) */
        workCenterId: uuid.nullish(),
        /** Поставщик строки (для закупки): пусто — поставщик товара по умолчанию */
        supplierId: uuid.nullish(),
        /** Сколько заказать */
        qty: positive(1e9),
        /** Дата потребности (поступления) */
        date: isoDate.nullish(),
        /** Заказ покупателя, ради которого заказываем (для «отдельно под каждый заказ») */
        customerOrderId: uuid.nullish(),
        /** Цена за единицу: пусто — последняя цена поставщика */
        price: nonNeg(1e9).nullish(),
      }),
    )
    .min(1)
    .max(500),
});

/** Массовое проведение созданных черновиков */
export const needsPostCreate = z.object({ documentIds: z.array(uuid).min(1).max(200) });

/* ---------------- операции, исполнители и сдельный наряд ---------------- */

/** Операция — вид номенклатуры: норма времени на единицу и участок по умолчанию */
export const operationSet = z.object({
  /** Товар каталога с видом «операция» */
  productId: uuid,
  /** Норма времени на единицу продукции, ч */
  normHours: nonNeg(1e6).default('0'),
  /** Участок по умолчанию */
  workCenterId: uuid.nullish(),
});

/** Расценка операции: история с датой начала действия (в наряд идёт расценка на дату наряда) */
export const operationRateCreate = z.object({
  productId: uuid,
  /** Дата начала действия расценки */
  validFrom: isoDate,
  /** Расценка: за единицу продукции или за час */
  rate: nonNeg(1e9),
  /** Способ расчёта: за единицу или по норме времени */
  unit: z.enum(OPERATION_RATE_UNITS).default('per_unit'),
});
export const operationRateQuery = z.object({ productId: uuid.optional() });

/** Назначение операции исполнителю: часть операции в заказе на производство */
export const operationAssignmentInput = z.object({
  /** Строка состава — работа */
  componentId: uuid,
  /** Исполнитель — участник воркспейса */
  memberId: uuid,
  /** Назначенное количество (в единицах продукции) */
  qty: positive(1e9),
});
export const productionAssignments = z.object({ assignments: z.array(operationAssignmentInput).max(500).default([]) });

/** Отметка выполнения операции исполнителем: сколько выполнено */
export const operationDone = z.object({
  /** Выполнено сейчас */
  qty: positive(1e9),
  /** Дата наряда (по умолчанию сегодня) */
  date: isoDate.optional(),
});

/** Строка сдельного наряда: выполненная операция */
export const pieceworkLineInput = z.object({
  /** Операция (товар каталога) */
  operationId: uuid,
  /** Продукция, которую делали */
  productId: uuid.nullish(),
  /** Заказ на производство */
  orderDocumentId: uuid.nullish(),
  /** Выпуск, к которому относится работа */
  releaseDocumentId: uuid.nullish(),
  /** Назначение операции исполнителю */
  assignmentId: uuid.nullish(),
  /** План: сколько назначено исполнителю */
  planQty: nonNeg(1e9).optional(),
  /** Факт: сколько выполнено */
  qty: positive(1e9),
  /** Нормочасы */
  hours: nonNeg(1e6).optional(),
  /** Расценка (по умолчанию — действующая на дату наряда) */
  rate: nonNeg(1e9).optional(),
});
export const pieceworkCreate = z.object({
  /** Дата наряда (по умолчанию сегодня) */
  date: isoDate.optional(),
  /** Исполнитель */
  memberId: uuid,
  /** Участок */
  workCenterId: uuid.nullish(),
  comment: z.string().max(5000).default(''),
  lines: z.array(pieceworkLineInput).min(1).max(200),
});
export const pieceworkUpdate = z.object({
  date: isoDate.optional(),
  comment: z.string().max(5000).optional(),
  /** Строки наряда: сумма правится до проведения */
  lines: z.array(pieceworkLineInput.extend({ id: clientId })).max(200).optional(),
});
/** Наряд на основании документа: заказ на производство, выпуск или заказ покупателя */
export const pieceworkFromDocument = z.object({
  /** Документ-основание */
  documentId: uuid,
  /** Дата наряда (по умолчанию сегодня) */
  date: isoDate.optional(),
});

export const pieceworkQuery = listQuery.extend({
  /** Исполнитель */
  memberId: uuid.optional(),
  /** Дата наряда: с даты */
  from: isoDate.optional(),
  /** Дата наряда: по дату */
  to: isoDate.optional(),
  /** Статус: draft | posted */
  status: z.enum(['draft', 'posted']).optional(),
});
/** Отчёт выработки: кто, что и сколько заработал за период */
export const pieceworkReportQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Исполнитель */
  memberId: uuid.optional(),
});

/* ---------------- заказ на производство и выпуск ---------------- */

/** Строка заказа на производство: что выпускаем */
export const productionOrderItemInput = z.object({
  /** Продукция (изделие или полуфабрикат) */
  itemId: uuid,
  qty: positive(1e9),
  /** Строка заказа покупателя, которую выполняет эта позиция */
  customerOrderLineId: uuid.optional(),
  /** Значения параметров спецификации изделия (замеры, цвет): состав считается формулами строк */
  params: paramValues.optional(),
});
export type ProductionOrderItemInput = z.infer<typeof productionOrderItemInput>;

export const productionOrderCreate = z.object({
  id: clientId,
  /** Вид операции: сборка (по умолчанию) или разборка */
  operation: z.enum(PRODUCTION_OPERATIONS).default('assembly'),
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
  /** Заказ на переработку: выпуск из давальческого сырья, продукция уходит на остаток давальца */
  processingOrderId: uuid.nullish(),
  /** Стоимость отходов: учётная (по умолчанию) или нулевая */
  wasteValuation: z.enum(WASTE_VALUATION).optional(),
  /** Склады отходов и брака; пусто — с участка */
  wasteWarehouseId: uuid.nullish(),
  defectWarehouseId: uuid.nullish(),
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
  /** Стоимость отходов: учётная (по умолчанию) или нулевая */
  wasteValuation: z.enum(WASTE_VALUATION).optional(),
  /** Склады отходов и брака; пусто — из заказа или с участка */
  wasteWarehouseId: uuid.nullish(),
  defectWarehouseId: uuid.nullish(),
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
        /** Брак в количестве qty (0 ≤ defectQty ≤ qty): заказ исполняется годным */
        defectQty: decimal.optional(),
        /** Режим брака: в себестоимость годного или на склад брака для списания */
        defectMode: z.enum(DEFECT_MODES).optional(),
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
  wasteValuation: z.enum(WASTE_VALUATION).optional(),
  wasteWarehouseId: uuid.nullish(),
  defectWarehouseId: uuid.nullish(),
  lines: z
    .array(z.object({ customerOrderLineId: uuid, stageId: uuid.nullish(), qty: positive(1e9), defectQty: decimal.optional(), defectMode: z.enum(DEFECT_MODES).optional() }))
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

/* ---------------- планирование: ресурсы, графики, загрузка ---------------- */

/** Виды ресурсов: equipment — оборудование, other — прочий ключевой ресурс */
export const RESOURCE_KINDS = ['equipment', 'other'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Шаблон графика: недельный (дни недели и часы) или циклический (дни цикла от даты начала) */
export const calendarPattern = z
  .object({
    /** Недельный: дни недели (1 — понедельник … 7 — воскресенье) */
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    startHour: z.number().min(0).max(24).optional(),
    endHour: z.number().min(0).max(24).optional(),
    /** Циклический: 1 — рабочий день, 0 — выходной */
    cycle: z.array(z.number().int().min(0).max(1)).min(1).max(31).optional(),
  })
  .passthrough();

/** Рабочий график: недельный или циклический (2/2, сутки через трое) */
export const workCalendarCreate = z.object({
  id: clientId,
  name: shortText,
  kind: z.enum(CALENDAR_KINDS).default('weekly'),
  pattern: calendarPattern.default({}),
  /** Дата начала цикла (циклический график) */
  cycleStart: isoDate.nullish(),
  /** Рабочих часов в день */
  hoursPerDay: nonNeg(1e4).default('8'),
  /** График воркспейса по умолчанию */
  isDefault: z.boolean().default(false),
  note: z.string().max(1000).default(''),
});
export const workCalendarUpdate = toPatch(workCalendarCreate.omit({ id: true }));

/** Праздник воркспейса */
export const holidayInput = z.object({
  date: isoDate,
  name: z.string().trim().max(200).default(''),
});

/** Исключение из графика: отпуск, больничный, ремонт */
export const calendarExceptionInput = z.object({
  scope: z.enum(['member', 'work_center', 'resource']),
  /** Сотрудник, участок или ресурс */
  scopeId: uuid,
  dateFrom: isoDate,
  dateTo: isoDate,
  note: z.string().max(500).default(''),
});

/** Ключевой ресурс: оборудование или прочий ресурс */
export const resourceCreate = z.object({
  id: clientId,
  code: z.string().trim().max(32).default(''),
  name: shortText,
  kind: z.enum(RESOURCE_KINDS).default('equipment'),
  /** Участок, в котором ресурс работает */
  workCenterId: uuid.nullish(),
  /** Сколько единиц ресурса доступно одновременно */
  capacityUnits: z.number().int().min(1).max(1000).default(1),
  /** Рабочий график ресурса */
  calendarId: uuid.nullish(),
  note: z.string().max(1000).default(''),
});
export const resourceUpdate = toPatch(resourceCreate.omit({ id: true }));

/** Норматив потребности в ресурсах: у операции или работы */
export const productResourcesSet = z.object({
  productId: uuid,
  resources: z.array(z.object({ resourceId: uuid, hoursPerUnit: nonNeg(1e6) })).max(50).default([]),
});

/** Ресурсы документа: закладка «Ресурсы» заказа на производство и заказ-наряда */
export const documentResourcesSet = z.object({
  documentId: uuid,
  items: z
    .array(
      z.object({
        id: clientId,
        /** Строка документа */
        lineId: uuid.nullish(),
        resourceId: uuid,
        /** Интервал работы ресурса */
        startAt: isoDateTime.nullish(),
        endAt: isoDateTime.nullish(),
        hours: nonNeg(1e6).default('0'),
      }),
    )
    .max(200)
    .default([]),
});

/** Загрузка за период */
export const loadQuery = z.object({
  from: isoDate,
  to: isoDate,
  /** Строки загрузки: сотрудники, участки или ресурсы */
  rowType: z.enum(LOAD_ROW_TYPES).default('member'),
});

/** Сдвиг операции в планировщике */
export const moveOperationInput = z.object({
  start: isoDate.nullish(),
  end: isoDate.nullish(),
  /** Новый исполнитель */
  memberId: uuid.nullish(),
  /** Новый участок */
  workCenterId: uuid.nullish(),
});

/* ---------------- закрытие периода ---------------- */

/** Ключ месяца закрытия «2026-10» */
export const monthKey = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month key: YYYY-MM');

/** Закрытие месяца или периода: помесячно (по одному месяцу) или «за период» — месяцы идут по очереди */
export const periodCloseInput = z.object({
  /** Последний месяц режима «за период» (по умолчанию — тот же месяц) */
  through: monthKey.optional(),
});

/** Дата запрета редактирования и настройка её переноса при закрытии */
export const periodSettingsInput = z.object({
  /** Новая дата запрета (вперёд — admin и выше, назад — только owner) */
  closedThrough: isoDate.nullish(),
  /** Переносить дату запрета на конец закрываемого месяца */
  closeMovesLock: z.boolean().optional(),
});

/* ---------------- прочие затраты ---------------- */

/** Документ «Прочие затраты»: строки — статья, участок, сумма и комментарий (товара и склада нет) */
export const otherCostLineInput = z.object({
  id: clientId,
  costItemId: uuid,
  /** Участок: пусто — затрата идёт на общий выпуск месяца */
  workCenterId: uuid.nullish(),
  amount: positive(),
  comment: z.string().trim().max(500).default(''),
});

export const otherCostsCreate = z.object({
  id: clientId,
  /** Пусто — организация по умолчанию */
  organizationId: uuid.nullish(),
  date: isoDate.optional(),
  comment: z.string().max(5000).default(''),
  lines: z.array(otherCostLineInput).min(1).max(200),
});
export const otherCostsUpdate = z.object({
  organizationId: uuid.nullish(),
  date: isoDate.optional(),
  comment: z.string().max(5000).optional(),
  lines: z.array(otherCostLineInput).min(1).max(200).optional(),
});
export const otherCostsQuery = listQuery.extend({ from: isoDate.optional(), to: isoDate.optional(), q: z.string().trim().max(200).optional() });

/* ---------------- переработка давальческого сырья ---------------- */

/** Журнал заказов на переработку (заказы покупателей с видом операции «Переработка») */
export const processingOrderQuery = listQuery.extend({
  status: z.enum(['draft', 'posted', 'cancelled']).optional(),
});

/** Отчёт «Stock received for processing»: остатки давальцев по складу, товару, давальцу и заказу */
export const customerBalanceQuery = z.object({
  warehouseId: uuid.optional(),
  productId: uuid.optional(),
  ownerCompanyId: uuid.optional(),
  processingOrderId: uuid.optional(),
  q: z.string().trim().max(200).optional(),
});

/** Признак «чей материал» у строки состава заказа на производство */
export const materialOwnerUpdate = z.object({ ownerKind: z.enum(MATERIAL_OWNERS) });

/** Отчёт переработчика: выпуск на складе переработчика — что вернул, какие материалы потратил и услуги */
export const processorReportCreate = z.object({
  /** Изделие, которое вернул переработчик */
  itemId: uuid,
  qty: positive(1e12),
  /** Склад переработчика (склад контрагента): оттуда списываются наши материалы */
  processorWarehouseId: uuid,
  /** Наш склад: куда приходит продукция */
  warehouseId: uuid,
  workCenterId: uuid.nullish(),
  date: isoDate.optional(),
  comment: z.string().max(5000).default(''),
  /** Заказ поставщику с видом операции «Переработка» (основание отчёта) */
  basedOnId: uuid.nullish(),
  /** Услуги переработчика: цена идёт в себестоимость продукции */
  services: z.array(z.object({ productId: uuid, qty: positive(1e12), price: nonNeg() })).max(20).optional(),
  /** Материалы по факту; без них берётся спецификация изделия */
  materials: z.array(z.object({ productId: uuid, qty: positive(1e12) })).max(200).optional(),
});

/** Правка отходов и брака в черновике выпуска или заказа: шапка, вкладка «Отходы» целиком, брак по позициям */
export const productionAccountingUpdate = z
  .object({
    wasteValuation: z.enum(WASTE_VALUATION).optional(),
    wasteWarehouseId: uuid.nullish(),
    defectWarehouseId: uuid.nullish(),
    defects: z.array(z.object({ itemId: uuid, defectQty: decimal, defectMode: z.enum(DEFECT_MODES).nullish() })).max(200).optional(),
    waste: z.array(z.object({ id: uuid.optional(), productId: uuid, qty: positive(1e9), price: decimal.nullish() })).max(200).optional(),
  })
  .strict();
