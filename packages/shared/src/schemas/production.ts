/* zod-схемы производства: участки, продукция (изделия и полуфабрикаты), строки спецификации, настройки. */
import { z } from 'zod';
import { BOM_KINDS, MANUFACTURED_KINDS, MATERIAL_PRICE_SOURCES, OPERATION_RATE_UNITS, REPLENISHMENT_MODES, SEMI_MODES } from '../constants';
import { CALENDAR_KINDS, LOAD_ROW_TYPES } from '../planning';
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
