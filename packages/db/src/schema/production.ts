/* Производство: участки, продукция (изделия и полуфабрикаты) и строки спецификации (BOM), заказы на производство и выпуск.
   Таблицы арендатора. Связи — составные внешние ключи (workspace_id, id). */
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { SpecParamDef } from '@gr8r/shared';
import { archivedAt, createdAt, money, pk, ts, updatedAt } from './columns';
import { products, units } from './catalog';
import { costItems, documentLines, documents, stockMoves, warehouses } from './documents';
import { members, wsCol } from './people';
import { tasks } from './work';
import { workCalendars } from './calendars';

export const workCenters = pgTable(
  'work_centers',
  {
    id: pk(),
    workspaceId: wsCol(),
    code: text('code').notNull().default(''),
    name: text('name').notNull(),
    /** Ставка за час по умолчанию */
    hourlyRate: money('hourly_rate').notNull().default('0'),
    /** Мощность участка: сколько часов в день он может принять (пусто — по графику) */
    capacityHoursPerDay: numeric('capacity_hours_per_day', { precision: 10, scale: 3 }),
    /** Рабочий график участка (пусто — график воркспейса по умолчанию) */
    calendarId: uuid('calendar_id'),
    /** Склад-цех участка: материалы передаются на него обычным перемещением */
    warehouseId: uuid('warehouse_id'),
    /** Склад готовой продукции: куда участок выпускает продукцию */
    outputWarehouseId: uuid('output_warehouse_id'),
    /** Склад отходов: куда уходят отходы производства */
    wasteWarehouseId: uuid('waste_warehouse_id'),
    /** Склад брака: куда идёт бракованная продукция при учёте «на расходы» */
    defectWarehouseId: uuid('defect_warehouse_id'),
    /** Режим списания материалов выпусков участка: при выпуске или по итогам смены (документ «Распределение материалов») */
    materialMode: text('material_mode', { enum: ['on_release', 'shift'] }).notNull().default('on_release'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('work_centers_ws_id_uq').on(t.workspaceId, t.id),
    check('work_centers_material_mode_chk', sql`${t.materialMode} in ('on_release','shift')`),
    check('work_centers_rate_chk', sql`${t.hourlyRate} >= 0`),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'work_centers_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.outputWarehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'work_centers_output_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.wasteWarehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'work_centers_waste_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.defectWarehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'work_centers_defect_warehouse_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.calendarId], foreignColumns: [workCalendars.workspaceId, workCalendars.id], name: 'work_centers_calendar_fk' }),
  ],
);

/* ---------------- виды производства и этапы ----------------

   Справочник «Этапы»: для каждого вида производства — упорядоченный список этапов. Последний этап — финальный
   («Завершение производства»): продукция приходуется только им. Спецификация без вида производства работает
   как раньше — единственный предопределённый этап «Завершение производства». */

/** Вид производства: настройка этапов */
export const productionKinds = pgTable(
  'production_kinds',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('production_kinds_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('production_kinds_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
  ],
);

/** Этап вида производства */
export const productionStages = pgTable(
  'production_stages',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Вид производства */
    kindId: uuid('kind_id').notNull(),
    /** Порядок выполнения */
    sortOrder: integer('sort_order').notNull().default(0),
    name: text('name').notNull(),
    /** Финальный этап: продукция приходуется только им */
    isFinal: boolean('is_final').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('production_stages_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.kindId], foreignColumns: [productionKinds.workspaceId, productionKinds.id], name: 'production_stages_kind_fk' }).onDelete('cascade'),
    index('production_stages_kind_idx').on(t.kindId, t.sortOrder),
    // финальный этап у вида производства один
    uniqueIndex('production_stages_kind_final_uq').on(t.workspaceId, t.kindId).where(sql`${t.isFinal}`),
  ],
);

export const manufacturedItems = pgTable(
  'manufactured_items',
  {
    id: pk(),
    workspaceId: wsCol(),
    code: text('code').notNull().default(''),
    name: text('name').notNull(),
    /** product — изделие на продажу, semi — полуфабрикат (на уровне данных различий нет: любой элемент можно включить в другой) */
    kind: text('kind', { enum: ['product', 'semi'] }).notNull().default('product'),
    /** Вид спецификации: сборка (изделие из материалов) или разборка (исходный товар делится на выходные продукты).
        У разборки товар спецификации — исходный (что разбираем), а строки — выходные продукты и работы */
    mode: text('mode', { enum: ['assembly', 'disassembly'] }).notNull().default('assembly'),
    unitCode: text('unit_code').notNull().default('796'),
    /** Товар каталога для продажи и склада (необязательно) */
    productId: uuid('product_id'),
    /** Спецификация задана на партию из batch_qty единиц */
    batchQty: numeric('batch_qty', { precision: 18, scale: 3 }).notNull().default('1'),
    /** Накладные, % от прямых затрат */
    overheadPct: numeric('overhead_pct', { precision: 7, scale: 2 }).notNull().default('0'),
    /** Вид производства: этапы выпуска (без вида — единственный этап «Завершение производства») */
    productionKindId: uuid('production_kind_id'),
    /** Параметры спецификации: описание значений (те же описания полей, что у характеристик категории)
        + флажок «разрез склада» — комбинация таких параметров даёт вариант товара */
    params: jsonb('params').$type<SpecParamDef[]>().notNull().default([]),
    /** Недействительна: устаревшая спецификация — в новых документах не предлагается и по умолчанию не выбирается */
    isInvalid: boolean('is_invalid').notNull().default(false),
    /** Дней на изготовление (рабочих, по календарю воркспейса): дата запуска = дата выпуска минус lead_days */
    leadDays: integer('lead_days').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('manufactured_items_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'manufactured_items_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productionKindId], foreignColumns: [productionKinds.workspaceId, productionKinds.id], name: 'manufactured_items_kind_fk' }),
    foreignKey({ columns: [t.workspaceId, t.unitCode], foreignColumns: [units.workspaceId, units.code], name: 'manufactured_items_unit_fk' }),
    check('manufactured_items_kind_chk', sql`${t.kind} in ('product','semi')`),
    check('manufactured_items_mode_chk', sql`${t.mode} in ('assembly','disassembly')`),
    check('manufactured_items_batch_chk', sql`${t.batchQty} > 0 and ${t.overheadPct} >= 0`),
    check('manufactured_items_lead_chk', sql`${t.leadDays} >= 0`),
    uniqueIndex('manufactured_items_ws_code_uq').on(t.workspaceId, sql`lower(${t.code})`).where(sql`${t.code} <> ''`),
  ],
);

export const bomLines = pgTable(
  'bom_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    itemId: uuid('item_id').notNull(),
    /** expense — расход: услуга подрядчика (окраска, вырубка). Входит в плановую себестоимость и калькуляцию,
        но со склада не списывается и в потребности не попадает; output — выходной продукт разборки */
    kind: text('kind', { enum: ['material', 'semi', 'work', 'expense', 'output', 'waste'] }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /** material */
    productId: uuid('product_id'),
    /** output: доля стоимости исходного товара, % (необязательна; если задана хоть одна — заданы все, сумма 100) */
    costShare: numeric('cost_share', { precision: 7, scale: 2 }),
    /** semi */
    childItemId: uuid('child_item_id'),
    /** semi: режим полуфабриката — stock (выпускается отдельно и списывается со склада) или explode (разворачивается до материалов) */
    semiMode: text('semi_mode', { enum: ['stock', 'explode'] }),
    /** Количество на партию (material, semi, expense) */
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Формула количества строки над параметрами спецификации (пусто — обычное qty) */
    qtyExpr: text('qty_expr'),
    /** Условие строки над параметрами (пусто — строка всегда; ложное условие исключает строку из состава) */
    condition: text('condition'),
    /** Единица строки: единица товара / продукции, заполняет сервер */
    unitCode: text('unit_code'),
    /** Отход, % (material) */
    scrapPct: numeric('scrap_pct', { precision: 7, scale: 2 }).notNull().default('0'),
    /** work */
    operation: text('operation').notNull().default(''),
    workCenterId: uuid('work_center_id'),
    hours: numeric('hours', { precision: 10, scale: 3 }).notNull().default('0'),
    /** Ставка за час; пусто — ставка участка */
    rate: money('rate'),
    fixedCost: money('fixed_cost'),
    /** Этап, на котором расходуется материал или выполняется операция */
    stageId: uuid('stage_id'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.itemId], foreignColumns: [manufacturedItems.workspaceId, manufacturedItems.id], name: 'bom_lines_item_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.stageId], foreignColumns: [productionStages.workspaceId, productionStages.id], name: 'bom_lines_stage_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'bom_lines_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.childItemId], foreignColumns: [manufacturedItems.workspaceId, manufacturedItems.id], name: 'bom_lines_child_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'bom_lines_work_center_fk' }),
    check('bom_lines_kind_chk', sql`${t.kind} in ('material','semi','work','expense','output','waste')`),
    check(
      'bom_lines_shape_chk',
      sql`(${t.kind} = 'material' and ${t.productId} is not null and ${t.childItemId} is null)
        or (${t.kind} = 'expense' and ${t.productId} is not null and ${t.childItemId} is null)
        or (${t.kind} = 'output' and ${t.productId} is not null and ${t.childItemId} is null)
        or (${t.kind} = 'waste' and ${t.productId} is not null and ${t.childItemId} is null)
        or (${t.kind} = 'semi' and ${t.childItemId} is not null and ${t.productId} is null and ${t.childItemId} <> ${t.itemId})
        or (${t.kind} = 'work' and ${t.childItemId} is null)`,
    ),
    // доля стоимости — только у выходных продуктов разборки
    check('bom_lines_cost_share_chk', sql`(${t.kind} = 'output' and (${t.costShare} is null or ${t.costShare} >= 0)) or (${t.kind} <> 'output' and ${t.costShare} is null)`),
    // формулы и условия считает expr.ts: длина ограничена там же (EXPR_MAX_LENGTH)
    check('bom_lines_expr_chk', sql`length(coalesce(${t.qtyExpr}, '')) <= 500 and length(coalesce(${t.condition}, '')) <= 500`),
    check('bom_lines_nonneg_chk', sql`${t.qty} >= 0 and ${t.scrapPct} >= 0 and ${t.hours} >= 0`),
    check('bom_lines_semi_mode_chk', sql`(${t.kind} = 'semi' and ${t.semiMode} is not null and ${t.semiMode} in ('stock','explode')) or (${t.kind} <> 'semi' and ${t.semiMode} is null)`),
    index('bom_lines_item_idx').on(t.itemId, t.sortOrder),
    index('bom_lines_child_idx').on(t.childItemId),
    index('bom_lines_product_idx').on(t.productId),
  ],
);

/* ---------------- план производства и нормы запаса ----------------

   План — объём выпуска по периодам (неделя или месяц) в разрезе склада готовой продукции и, необязательно,
   участка-диспетчера. Строка — «изделие × период»: дата начала периода = дата выпуска, количество — сколько
   выпустить к этой дате. Полуфабрикаты планируются кнопкой и помечаются флагом is_semi. */

/** План производства: диапазон дат, шаг периодов и склад готовой продукции */
export const productionPlans = pgTable(
  'production_plans',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    /** Шаг периодов: неделя или месяц */
    step: text('step', { enum: ['week', 'month'] }).notNull().default('week'),
    /** Состояние: черновик → утверждён (заказы создаются только по утверждённым) */
    status: text('status', { enum: ['draft', 'approved'] }).notNull().default('draft'),
    /** Склад готовой продукции (обязателен) */
    warehouseId: uuid('warehouse_id').notNull(),
    /** Участок-диспетчер (необязателен) */
    workCenterId: uuid('work_center_id'),
    /** Продукция правилась после последнего расчёта полуфабрикатов — нужно перепланировать */
    semiDirty: boolean('semi_dirty').notNull().default(false),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('production_plans_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'production_plans_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'production_plans_work_center_fk' }),
    check('production_plans_dates_chk', sql`${t.periodTo} >= ${t.periodFrom}`),
    check('production_plans_step_chk', sql`${t.step} in ('week','month')`),
    check('production_plans_status_chk', sql`${t.status} in ('draft','approved')`),
    index('production_plans_period_idx').on(t.workspaceId, t.periodFrom, t.periodTo),
  ],
);

/** Строка плана: сколько изделия (или полуфабриката) выпустить к началу периода */
export const productionPlanLines = pgTable(
  'production_plan_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    planId: uuid('plan_id').notNull(),
    /** Продукция (изделие или полуфабрикат) */
    itemId: uuid('item_id').notNull(),
    /** Начало периода = дата выпуска */
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    /** Сколько выпустить к этой дате */
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Строка полуфабриката (добавляется кнопкой «Запланировать полуфабрикаты») */
    isSemi: boolean('is_semi').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('production_plan_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.planId], foreignColumns: [productionPlans.workspaceId, productionPlans.id], name: 'production_plan_lines_plan_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.itemId], foreignColumns: [manufacturedItems.workspaceId, manufacturedItems.id], name: 'production_plan_lines_item_fk' }),
    check('production_plan_lines_qty_chk', sql`${t.qty} >= 0`),
    index('production_plan_lines_plan_idx').on(t.planId, t.sortOrder),
    index('production_plan_lines_item_idx').on(t.itemId, t.periodStart),
  ],
);

/** Норма запаса товара: строка по складу или строка без склада (норма по компании) */
export const stockLevels = pgTable(
  'stock_levels',
  {
    id: pk(),
    workspaceId: wsCol(),
    productId: uuid('product_id').notNull(),
    /** Склад; пусто — норма по компании (действует, если для склада своей строки нет) */
    warehouseId: uuid('warehouse_id'),
    minQty: numeric('min_qty', { precision: 18, scale: 3 }).notNull().default('0'),
    maxQty: numeric('max_qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Способ пополнения: закупить, выпустить или переместить с другого склада */
    replenishment: text('replenishment', { enum: ['purchase', 'production', 'transfer'] }).notNull().default('purchase'),
    /** Склад-источник (только для перемещения) */
    sourceWarehouseId: uuid('source_warehouse_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('stock_levels_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'stock_levels_product_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'stock_levels_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.sourceWarehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'stock_levels_source_fk' }),
    check('stock_levels_qty_chk', sql`${t.minQty} >= 0 and ${t.maxQty} >= ${t.minQty}`),
    check('stock_levels_replenishment_chk', sql`${t.replenishment} in ('purchase','production','transfer')`),
    // перемещению нужен склад-источник, отличный от склада-получателя
    // перемещение — только на конкретный склад: у нормы по компании склада-получателя нет
    check('stock_levels_transfer_chk', sql`${t.replenishment} <> 'transfer' or (${t.warehouseId} is not null and ${t.sourceWarehouseId} is not null and ${t.sourceWarehouseId} <> ${t.warehouseId})`),
    uniqueIndex('stock_levels_wh_uq').on(t.workspaceId, t.productId, t.warehouseId).where(sql`${t.warehouseId} is not null`),
    // норма по компании — одна на товар
    uniqueIndex('stock_levels_company_uq').on(t.workspaceId, t.productId).where(sql`${t.warehouseId} is null`),
    index('stock_levels_product_idx').on(t.workspaceId, t.productId),
  ],
);

/* ---------------- заказы на производство и выпуск ----------------

   Производственные данные лежат рядом с документом, а не в document_lines: строка документа — всегда товар каталога,
   а в заказе бывают изделия без товара и работы. Поэтому:
     - production_items — что выпускает документ (заказ на производство или выпуск): изделие, количество, строка заказа покупателя;
     - production_components — снимок развёрнутой спецификации: материалы, полуфабрикаты и работы;
     - production_headers — шапка производственного документа: изготовитель, плановые сроки, родительский заказ. */

/** Способ пополнения товара и спецификация по умолчанию: товар «производится» вместо закупки */
export const productManufacturing = pgTable(
  'product_manufacturing',
  {
    workspaceId: wsCol(),
    /** Товар каталога */
    productId: uuid('product_id').notNull(),
    /** Способ пополнения: закупить (purchase) или выпустить (production) */
    replenishment: text('replenishment', { enum: ['purchase', 'production'] }).notNull().default('purchase'),
    /** Спецификация по умолчанию: что выпускаем вместо закупки */
    defaultItemId: uuid('default_item_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    primaryKey({ columns: [t.workspaceId, t.productId] }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'product_manufacturing_product_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.defaultItemId], foreignColumns: [manufacturedItems.workspaceId, manufacturedItems.id], name: 'product_manufacturing_item_fk' }),
  ],
);

/** Позиция производственного документа: что выпускаем */
export const productionItems = pgTable(
  'production_items',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Документ: заказ на производство или выпуск */
    documentId: uuid('document_id').notNull(),
    /** Продукция (изделие или полуфабрикат) */
    itemId: uuid('item_id').notNull(),
    /** Количество */
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Единица: единица продукции */
    unitCode: text('unit_code').notNull().default('796'),
    /** Значения параметров спецификации изделия (замеры, цвет): состав считается формулами строк */
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    /** Вариант товара, который выпускается (создан по значениям параметров с флажком «разрез склада») */
    productVariantId: uuid('product_variant_id'),
    /** Плановая себестоимость единицы */
    plannedUnitCost: numeric('planned_unit_cost', { precision: 18, scale: 4 }),
    /** Строка заказа покупателя, которую выполняет позиция */
    customerOrderLineId: uuid('customer_order_line_id'),
    /** Позиция заказа на производство, которую выполняет эта (выпуск по заказу) */
    sourceItemId: uuid('source_item_id'),
    /** Этап выпуска, к которому относится позиция */
    stageId: uuid('stage_id'),
    /** Строка плана производства, из которой позиция заказа (заказы по плану не дублируются) */
    planLineId: uuid('plan_line_id'),
    /** Фактическая себестоимость позиции на этом этапе (материалы + работы + накладные) */
    stageCost: numeric('stage_cost', { precision: 18, scale: 4 }),
    /** Часть stage_cost, пришедшая из проведённых распределений материалов смены (с накладными); доходит до прихода продукции корректировкой */
    allocCost: numeric('alloc_cost', { precision: 18, scale: 4 }).notNull().default('0'),
    /** Косвенные затраты, распределённые закрытием месяца на промежуточный этап (НЗП): входят в НЗП этапа и доходят до
        продукции корректировкой на финальном этапе (recomputeStockCosts); в stage_cost не входят, при повторном закрытии обнуляются */
    closingCost: numeric('closing_cost', { precision: 18, scale: 4 }).notNull().default('0'),
    /** Строка документа с продукцией (у выпуска) */
    documentLineId: uuid('document_line_id'),
    /** Брак в позиции выпуска: количество (0 если нет) */
    defectQty: numeric('defect_qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Режим учёта брака: waste — на склад отходов, cost — в себестоимость годного (не приходуется),
        expense — на склад брака и далее списание через write_off */
    defectMode: text('defect_mode', { enum: ['waste', 'cost', 'expense'] }),
    /** Себестоимость единицы брака, захваченная при проведении (для ревалоризации и списания) */
    defectUnitCost: numeric('defect_unit_cost', { precision: 18, scale: 4 }),
    /** Черновик write_off, созданный кнопкой «Списать брак» (для защиты от дубля и связи) */
    disposalDocumentId: uuid('disposal_document_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    unique('production_items_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_items_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.itemId], foreignColumns: [manufacturedItems.workspaceId, manufacturedItems.id], name: 'production_items_item_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productVariantId], foreignColumns: [products.workspaceId, products.id], name: 'production_items_variant_fk' }),
    foreignKey({ columns: [t.workspaceId, t.customerOrderLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'production_items_customer_line_fk' }),
    foreignKey({ columns: [t.workspaceId, t.sourceItemId], foreignColumns: [t.workspaceId, t.id], name: 'production_items_source_fk' }),
    foreignKey({ columns: [t.workspaceId, t.stageId], foreignColumns: [productionStages.workspaceId, productionStages.id], name: 'production_items_stage_fk' }),
    foreignKey({ columns: [t.workspaceId, t.documentLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'production_items_line_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.planLineId], foreignColumns: [productionPlanLines.workspaceId, productionPlanLines.id], name: 'production_items_plan_line_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.disposalDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_items_disposal_document_fk' }).onDelete('set null'),
    check('production_items_qty_chk', sql`${t.qty} > 0`),
    check('production_items_defect_chk', sql`${t.defectQty} >= 0 and ${t.defectQty} <= ${t.qty}`),
    check('production_items_defect_mode_chk', sql`${t.defectMode} is null or ${t.defectMode} in ('waste','cost','expense')`),
    index('production_items_document_idx').on(t.documentId, t.sortOrder),
    index('production_items_source_idx').on(t.sourceItemId),
    index('production_items_plan_line_idx').on(t.planLineId),
    index('production_items_customer_line_idx').on(t.customerOrderLineId),
  ],
);

/** Снимок состава: материалы, полуфабрикаты и работы выпуска (или заказа) */
export const productionComponents = pgTable(
  'production_components',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Документ */
    documentId: uuid('document_id').notNull(),
    /** Позиция документа, к которой относится строка состава */
    itemId: uuid('item_id'),
    /** Тип строки состава: expense — расход подрядчику (услуга), в себестоимость входит, со склада не списывается;
        output — выходной продукт разборки: приходуется на склад, а не расходуется;
        waste — возвратный отход: приходуется на склад отходов финальным этапом, в себестоимости вычитается */
    kind: text('kind', { enum: ['material', 'semi', 'work', 'expense', 'output', 'waste'] }).notNull(),
    /** Доля стоимости исходного товара, % (выходной продукт разборки) */
    costShare: numeric('cost_share', { precision: 7, scale: 2 }),
    /** Материал или полуфабрикат на складе */
    productId: uuid('product_id'),
    /** Участок (работа) */
    workCenterId: uuid('work_center_id'),
    /** Название работы */
    operation: text('operation').notNull().default(''),
    /** Количество (материал, полуфабрикат) */
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Часы работы */
    hours: numeric('hours', { precision: 10, scale: 3 }).notNull().default('0'),
    /** Ставка за час; пусто — ставка участка */
    rate: numeric('rate', { precision: 18, scale: 2 }),
    /** Фиксированная стоимость работы */
    fixedCost: numeric('fixed_cost', { precision: 18, scale: 2 }),
    /** Плановая стоимость строки */
    plannedCost: numeric('planned_cost', { precision: 18, scale: 4 }).notNull().default('0'),
    /** Учётная цена отхода за единицу: пусто — берётся из настройки «Цена отходов» при заполнении снимка */
    price: numeric('price', { precision: 18, scale: 4 }),
    /** Фактическое количество (заполняется при проведении) */
    actualQty: numeric('actual_qty', { precision: 18, scale: 3 }),
    /** Фактическая стоимость строки */
    actualCost: numeric('actual_cost', { precision: 18, scale: 4 }),
    /** Строка документа, по которой материал списывается */
    documentLineId: uuid('document_line_id'),
    /** Строка состава заказа, из которой эта строка взята (выпуск наследует состав заказа) */
    sourceComponentId: uuid('source_component_id'),
    /** Этап, на котором расходуется материал или выполняется работа (снимок строки спецификации) */
    stageId: uuid('stage_id'),
    /** Чей материал: наш (списывается со своего склада по средней) или давальца (с его остатка, только количества) */
    ownerKind: text('owner_kind', { enum: ['own', 'customer'] }).notNull().default('own'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    unique('production_components_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_components_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.itemId], foreignColumns: [productionItems.workspaceId, productionItems.id], name: 'production_components_item_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'production_components_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'production_components_work_center_fk' }),
    foreignKey({ columns: [t.workspaceId, t.documentLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'production_components_line_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.sourceComponentId], foreignColumns: [t.workspaceId, t.id], name: 'production_components_source_fk' }),
    foreignKey({ columns: [t.workspaceId, t.stageId], foreignColumns: [productionStages.workspaceId, productionStages.id], name: 'production_components_stage_fk' }),
    check('production_components_kind_chk', sql`${t.kind} in ('material','semi','work','expense','output','waste')`),
    check('production_components_cost_share_chk', sql`(${t.kind} = 'output' and (${t.costShare} is null or ${t.costShare} >= 0)) or (${t.kind} <> 'output' and ${t.costShare} is null)`),
    check('production_components_owner_chk', sql`${t.ownerKind} in ('own','customer')`),
    check('production_components_price_chk', sql`${t.price} is null or (${t.kind} = 'waste' and ${t.price} >= 0)`),
    check(
      'production_components_shape_chk',
      sql`${t.kind} = 'work' or (${t.kind} <> 'work' and ${t.productId} is not null)`,
    ),
    check('production_components_nonneg_chk', sql`${t.qty} >= 0 and ${t.hours} >= 0`),
    index('production_components_document_idx').on(t.documentId, t.sortOrder),
    index('production_components_item_idx').on(t.itemId),
    index('production_components_source_idx').on(t.sourceComponentId),
  ],
);

/** Размещение: сколько материала заказа на производство заказано поставщику или дочерним заказом на полуфабрикат.
    Строка заказа поставщику привязывается к строке состава заказа на производство (document_line_id), дочерний заказ — к строке
    состава родителя (document_line_id пусто). При поступлении по привязанному заказу товар резервируется под заказ на производство */
export const productionPlacements = pgTable(
  'production_placements',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Строка состава заказа на производство */
    componentId: uuid('component_id').notNull(),
    /** Документ: заказ поставщику, поступление или дочерний заказ на производство */
    documentId: uuid('document_id').notNull(),
    /** Строка документа (заказ поставщику или поступление); у дочернего заказа — пусто */
    documentLineId: uuid('document_line_id'),
    /** Размещённое количество */
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    createdAt: createdAt(),
  },
  t => [
    unique('production_placements_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.componentId], foreignColumns: [productionComponents.workspaceId, productionComponents.id], name: 'production_placements_component_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_placements_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.documentLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'production_placements_line_fk' }).onDelete('cascade'),
    check('production_placements_qty_chk', sql`${t.qty} > 0`),
    uniqueIndex('production_placements_line_uq').on(t.workspaceId, t.documentLineId).where(sql`${t.documentLineId} is not null`),
    uniqueIndex('production_placements_document_uq').on(t.workspaceId, t.componentId, t.documentId).where(sql`${t.documentLineId} is null`),
    index('production_placements_component_idx').on(t.workspaceId, t.componentId),
    index('production_placements_document_idx').on(t.workspaceId, t.documentId),
  ],
);

/** Шапка производственного документа: изготовитель, плановые сроки, родительский заказ */
export const productionHeaders = pgTable(
  'production_headers',
  {
    workspaceId: wsCol(),
    /** Документ: заказ на производство или выпуск */
    documentId: uuid('document_id').notNull(),
    /** Участок-изготовитель */
    workCenterId: uuid('work_center_id'),
    /** Завершающий участок: на нём числится НЗП промежуточных этапов (по умолчанию — участок заказа или выпуска) */
    finalWorkCenterId: uuid('final_work_center_id'),
    /** Плановый старт */
    plannedStart: ts('planned_start'),
    /** Плановый финиш */
    plannedEnd: ts('planned_end'),
    /** Родительский заказ на производство (дочерний заказ на полуфабрикат) */
    parentDocumentId: uuid('parent_document_id'),
    /** Этап выпуска (у заказа на производство — пусто: этапы выбирают при выпуске) */
    stageId: uuid('stage_id'),
    /** Заказ на переработку (заказ покупателя с видом операции «Переработка»): выпуск делается из давальческого сырья,
        а продукция приходуется на остаток давальца */
    processingOrderId: uuid('processing_order_id'),
    /** Учёт стоимости возвратных отходов: zero — не вычитается, accounting — вычитается из себестоимости продукции */
    wasteValuation: text('waste_valuation', { enum: ['zero', 'accounting'] }).notNull().default('accounting'),
    /** Склад отходов выпуска (по умолчанию из участка) */
    wasteWarehouseId: uuid('waste_warehouse_id'),
    /** Склад брака выпуска (по умолчанию из участка) */
    defectWarehouseId: uuid('defect_warehouse_id'),
    /** Режим списания материалов: on_release — при проведении выпуска, shift — по итогам смены (берётся у участка при создании) */
    materialMode: text('material_mode', { enum: ['on_release', 'shift'] }).notNull().default('on_release'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    primaryKey({ columns: [t.workspaceId, t.documentId] }),
    check('production_headers_material_mode_chk', sql`${t.materialMode} in ('on_release','shift')`),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_headers_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'production_headers_work_center_fk' }),
    foreignKey({ columns: [t.workspaceId, t.finalWorkCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'production_headers_final_work_center_fk' }),
    foreignKey({ columns: [t.workspaceId, t.parentDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_headers_parent_fk' }),
    foreignKey({ columns: [t.workspaceId, t.stageId], foreignColumns: [productionStages.workspaceId, productionStages.id], name: 'production_headers_stage_fk' }),
    foreignKey({ columns: [t.workspaceId, t.processingOrderId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_headers_processing_order_fk' }),
    foreignKey({ columns: [t.workspaceId, t.wasteWarehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'production_headers_waste_warehouse_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.defectWarehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'production_headers_defect_warehouse_fk' }).onDelete('set null'),
  ],
);

/** Себестоимость услуги переработки: наши затраты выпуска (свои материалы, работы, накладные) по заказу на переработку.
    Пишется при проведении отчёта о переработке и переносится на акт услуги — это себестоимость реализации услуги */
export const processingServiceCosts = pgTable(
  'processing_service_costs',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Документ: отчёт о переработке, созданный из него акт услуги или (у строки закрытия месяца) выпуск переработки */
    documentId: uuid('document_id').notNull(),
    /** Заказ на переработку (заказ покупателя с видом операции «Переработка») */
    processingOrderId: uuid('processing_order_id').notNull(),
    /** Себестоимость услуги: у отчёта — затраты его партии, у строки закрытия — доля косвенных затрат месяца на выпуск */
    amount: numeric('amount', { precision: 18, scale: 4 }).notNull().default('0'),
    /** Закрытие месяца, которое распределило косвенные затраты на выпуск переработки (строка снимается отменой закрытия) */
    closingId: uuid('closing_id'),
    /** Отчёт о переработке, к себестоимости которого добавлена доля закрытия (отчёт уже был проведён) */
    reportId: uuid('report_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('processing_service_costs_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'processing_service_costs_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.processingOrderId], foreignColumns: [documents.workspaceId, documents.id], name: 'processing_service_costs_order_fk' }),
    foreignKey({ columns: [t.workspaceId, t.reportId], foreignColumns: [documents.workspaceId, documents.id], name: 'processing_service_costs_report_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.closingId], foreignColumns: [productionCostClosings.workspaceId, productionCostClosings.id], name: 'processing_service_costs_closing_fk' }).onDelete('cascade'),
    uniqueIndex('processing_service_costs_document_uq').on(t.workspaceId, t.documentId),
    index('processing_service_costs_order_idx').on(t.workspaceId, t.processingOrderId),
    index('processing_service_costs_closing_idx').on(t.workspaceId, t.closingId),
  ],
);

/* ---------------- операции, исполнители и сдельный наряд ----------------

   Операция — вид номенклатуры (`products.kind = 'operation'`): норма времени на единицу, участок по умолчанию
   и история расценок. Строка работ спецификации ссылается на операцию; когда исполнителю назначена часть
   операции, появляется задача модуля production и строка сдельного наряда (на исполнителя за день). */

/** Операция: норма времени на единицу продукции и участок по умолчанию */
export const operations = pgTable(
  'operations',
  {
    workspaceId: wsCol(),
    /** Товар каталога с видом «операция» */
    productId: uuid('product_id').notNull(),
    /** Норма времени на единицу продукции, ч */
    normHours: numeric('norm_hours', { precision: 10, scale: 3 }).notNull().default('0'),
    /** Участок по умолчанию */
    workCenterId: uuid('work_center_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    primaryKey({ columns: [t.workspaceId, t.productId] }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'operations_product_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'operations_work_center_fk' }),
    check('operations_norm_chk', sql`${t.normHours} >= 0`),
  ],
);

/** Расценка операции: история с датой начала действия (в наряд идёт расценка на дату наряда) */
export const operationRates = pgTable(
  'operation_rates',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Операция (товар каталога) */
    productId: uuid('product_id').notNull(),
    /** Дата начала действия расценки */
    validFrom: date('valid_from').notNull(),
    /** Расценка: за единицу продукции или за час */
    rate: numeric('rate', { precision: 18, scale: 2 }).notNull().default('0'),
    /** Способ расчёта: per_unit (за единицу) или per_hour (по норме времени) */
    unit: text('unit', { enum: ['per_unit', 'per_hour'] }).notNull().default('per_unit'),
    createdAt: createdAt(),
  },
  t => [
    unique('operation_rates_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'operation_rates_product_fk' }).onDelete('cascade'),
    check('operation_rates_rate_chk', sql`${t.rate} >= 0`),
    index('operation_rates_product_idx').on(t.productId, t.validFrom),
  ],
);

/** Назначение операции исполнителю: часть операции в заказе на производство и задача исполнителя */
export const productionOperations = pgTable(
  'production_operations',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Заказ на производство */
    documentId: uuid('document_id').notNull(),
    /** Позиция заказа */
    itemId: uuid('item_id').notNull(),
    /** Строка состава — работа */
    componentId: uuid('component_id').notNull(),
    /** Операция (товар каталога) */
    operationId: uuid('operation_id'),
    /** Исполнитель — участник воркспейса */
    memberId: uuid('member_id').notNull(),
    /** Задача модуля production */
    taskId: uuid('task_id'),
    /** Этап, на котором выполняется операция */
    stageId: uuid('stage_id'),
    /** Участок-исполнитель */
    workCenterId: uuid('work_center_id'),
    /** Назначенное количество (в единицах продукции) */
    plannedQty: numeric('planned_qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Плановые нормочасы */
    plannedHours: numeric('planned_hours', { precision: 10, scale: 3 }).notNull().default('0'),
    /** Выполнено по проведённым нарядам */
    doneQty: numeric('done_qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Плановые даты операции (расставлены автопланированием или вручную в планировщике) */
    plannedStart: date('planned_start', { mode: 'string' }),
    plannedEnd: date('planned_end', { mode: 'string' }),
    /** Даты проставлены автопланированием: ручные даты автопланирование не двигает */
    autoPlanned: boolean('auto_planned').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    unique('production_operations_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_operations_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.itemId], foreignColumns: [productionItems.workspaceId, productionItems.id], name: 'production_operations_item_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.componentId], foreignColumns: [productionComponents.workspaceId, productionComponents.id], name: 'production_operations_component_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.operationId], foreignColumns: [products.workspaceId, products.id], name: 'production_operations_operation_fk' }),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'production_operations_member_fk' }),
    foreignKey({ columns: [t.workspaceId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.id], name: 'production_operations_task_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.stageId], foreignColumns: [productionStages.workspaceId, productionStages.id], name: 'production_operations_stage_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'production_operations_work_center_fk' }),
    check('production_operations_qty_chk', sql`${t.plannedQty} > 0 and ${t.doneQty} >= 0`),
    index('production_operations_document_idx').on(t.documentId),
    index('production_operations_item_idx').on(t.itemId),
    index('production_operations_member_idx').on(t.memberId),
  ],
);

/** Шапка сдельного наряда: исполнитель и участок (один наряд на исполнителя за день) */
export const pieceworkHeaders = pgTable(
  'piecework_headers',
  {
    workspaceId: wsCol(),
    /** Документ наряда */
    documentId: uuid('document_id').notNull(),
    /** Исполнитель — участник воркспейса */
    memberId: uuid('member_id').notNull(),
    /** Участок */
    workCenterId: uuid('work_center_id'),
    createdAt: createdAt(),
  },
  t => [
    primaryKey({ columns: [t.workspaceId, t.documentId] }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'piecework_headers_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'piecework_headers_member_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'piecework_headers_work_center_fk' }),
  ],
);

/** Строка сдельного наряда: выполненная операция, расценка на дату наряда и сумма */
export const pieceworkLines = pgTable(
  'piecework_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Документ наряда */
    documentId: uuid('document_id').notNull(),
    /** Операция (товар каталога) */
    operationId: uuid('operation_id').notNull(),
    /** Продукция, которую делали */
    productId: uuid('product_id'),
    /** Заказ на производство */
    orderDocumentId: uuid('order_document_id'),
    /** Выпуск, к которому относится работа */
    releaseDocumentId: uuid('release_document_id'),
    /** Назначение операции исполнителю */
    assignmentId: uuid('assignment_id'),
    /** Строка состава выпуска (работа) */
    componentId: uuid('component_id'),
    /** План: сколько назначено испнителю */
    planQty: numeric('plan_qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Факт: сколько выполнено */
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Нормочасы */
    hours: numeric('hours', { precision: 10, scale: 3 }).notNull().default('0'),
    /** Расценка на дату наряда */
    rate: numeric('rate', { precision: 18, scale: 2 }).notNull().default('0'),
    /** Способ расчёта: за единицу или по норме времени */
    unit: text('unit', { enum: ['per_unit', 'per_hour'] }).notNull().default('per_unit'),
    /** Сумма строки */
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    unique('piecework_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'piecework_lines_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.operationId], foreignColumns: [products.workspaceId, products.id], name: 'piecework_lines_operation_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'piecework_lines_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.orderDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'piecework_lines_order_fk' }),
    foreignKey({ columns: [t.workspaceId, t.releaseDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'piecework_lines_release_fk' }),
    foreignKey({ columns: [t.workspaceId, t.assignmentId], foreignColumns: [productionOperations.workspaceId, productionOperations.id], name: 'piecework_lines_assignment_fk' }),
    foreignKey({ columns: [t.workspaceId, t.componentId], foreignColumns: [productionComponents.workspaceId, productionComponents.id], name: 'piecework_lines_component_fk' }),
    check('piecework_lines_qty_chk', sql`${t.qty} > 0 and ${t.rate} >= 0 and ${t.amount} >= 0`),
    index('piecework_lines_document_idx').on(t.documentId, t.sortOrder),
    index('piecework_lines_assignment_idx').on(t.assignmentId),
    index('piecework_lines_release_idx').on(t.releaseDocumentId),
  ],
);

/* ---------------- закрытие периода: косвенные затраты, корректировки, результат ----------------

   Косвенные затраты месяца (`period_costs`) набираются при проведении документов: строки-услуги поступления со
   статьёй и участком, списание материалов на участок, документ «Прочие затраты». Закрытие периода (задача воркера
   `production.close_period`) распределяет их на выпуски месяца по базе статьи и записывает корректировки
   (`stock_cost_adjustments`: сколько добавилось к себестоимости движения) — остаток продукции дорожает,
   а у уже списанного (в том числе проданного) движения себестоимость увеличивается. */

/** Косвенные затраты периода: статья, участок, сумма и источник-документ */
export const periodCosts = pgTable(
  'period_costs',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Первый день месяца затрат */
    period: date('period', { mode: 'string' }).notNull(),
    /** Статья затрат (её способ распределения задаёт базу) */
    costItemId: uuid('cost_item_id').notNull(),
    /** Участок: затраты сначала идут на выпуск своего участка, иначе — на общий выпуск */
    workCenterId: uuid('work_center_id'),
    /** Сумма затрат */
    amount: money('amount').notNull().default('0'),
    /** Источник: поступление (строка-услуга), списание на участок, прочие затраты */
    source: text('source', { enum: ['receipt', 'write_off', 'other_costs'] }).notNull(),
    documentId: uuid('document_id'),
    /** Строка документа (поступление) — по ней запись однозначна и перезаписывается при повторном проведении */
    documentLineId: uuid('document_line_id'),
    createdAt: createdAt(),
  },
  t => [
    unique('period_costs_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.costItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'period_costs_item_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'period_costs_work_center_fk' }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'period_costs_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.documentLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'period_costs_line_fk' }).onDelete('cascade'),
    check('period_costs_amount_chk', sql`${t.amount} > 0`),
    // одна запись на строку документа: повторное проведение перезаписывает, а не дублирует
    uniqueIndex('period_costs_line_uq').on(t.workspaceId, t.documentLineId).where(sql`${t.documentLineId} is not null`),
    index('period_costs_period_idx').on(t.workspaceId, t.period),
    index('period_costs_document_idx').on(t.documentId),
  ],
);

/** Корректировка себестоимости движения (закрытие периода): сколько добавилось к цене движения.
    Движений с нулевым количеством не бывает (CHECK stock_moves_qty_chk), поэтому корректировка живёт отдельно */
export const stockCostAdjustments = pgTable(
  'stock_cost_adjustments',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Движение склада, которому меняют себестоимость */
    moveId: uuid('move_id').notNull(),
    /** Итоговая прибавка к себестоимости единицы (может быть отрицательной): своя часть + пришедшее по цепочке */
    deltaCost: numeric('delta_cost', { precision: 18, scale: 4 }).notNull().default('0'),
    /** Своя часть — косвенные затраты, распределённые закрытием на приход продукции. Остальное (deltaCost − ownDelta)
        пересчитывается по цепочке движений (recomputeStockCosts) и хранится только как кэш */
    ownDelta: numeric('own_delta', { precision: 18, scale: 4 }).notNull().default('0'),
    /** Закрытие периода, которому принадлежит своя часть (её отмена обнуляет ownDelta) */
    closingId: uuid('closing_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('stock_cost_adjustments_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.moveId], foreignColumns: [stockMoves.workspaceId, stockMoves.id], name: 'stock_cost_adjustments_move_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.closingId], foreignColumns: [productionCostClosings.workspaceId, productionCostClosings.id], name: 'stock_cost_adjustments_closing_fk' }).onDelete('cascade'),
    check('stock_cost_adjustments_delta_chk', sql`${t.deltaCost} <> 0 or ${t.ownDelta} <> 0`),
    uniqueIndex('stock_cost_adjustments_move_uq').on(t.workspaceId, t.moveId),
    index('stock_cost_adjustments_closing_idx').on(t.closingId),
  ],
);

/** Результат закрытия периода: статус, сводка распределения (jsonb) и время прогона.
    Один закрытый месяц на воркспейс — уникальный индекс: повторное закрытие обновляет запись, а не плодит новую */
export const productionCostClosings = pgTable(
  'production_cost_closings',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Первый день закрываемого месяца */
    period: date('period', { mode: 'string' }).notNull(),
    /** Закрыт / открыт заново / выполняется / ошибка */
    status: text('status', { enum: ['running', 'done', 'reopened', 'failed'] }).notNull().default('running'),
    /** Распределено по статьям, участкам и выпускам; нераспределённое; предупреждения */
    totals: jsonb('totals').$type<Record<string, unknown>>().notNull().default({}),
    error: text('error'),
    runAt: ts('run_at').notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('production_cost_closings_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('production_cost_closings_period_uq').on(t.workspaceId, t.period),
    check('production_cost_closings_status_chk', sql`${t.status} in ('running','done','reopened','failed')`),
    index('production_cost_closings_period_idx').on(t.period),
  ],
);

/** Строка документа «Прочие затраты»: статья, участок, сумма и комментарий (товара у строки нет — склад не двигается) */
export const otherCostLines = pgTable(
  'other_cost_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Статья затрат */
    costItemId: uuid('cost_item_id').notNull(),
    /** Участок: необязателен (затраты без участка идут на общий выпуск) */
    workCenterId: uuid('work_center_id'),
    /** Сумма затрат */
    amount: money('amount').notNull().default('0'),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [
    unique('other_cost_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'other_cost_lines_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.costItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'other_cost_lines_item_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'other_cost_lines_work_center_fk' }),
    check('other_cost_lines_amount_chk', sql`${t.amount} > 0`),
    index('other_cost_lines_document_idx').on(t.documentId, t.sortOrder),
  ],
);

/* ---------------- распределение материалов по итогам смены (задача 1135) ---------------- */

/** Шапка документа «Распределение материалов»: период смены (участок и склад — в самом документе) */
export const materialAllocations = pgTable(
  'material_allocations',
  {
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    /** Период, за который берутся выпуски участка в режиме смены (по умолчанию один день — дата документа) */
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    primaryKey({ columns: [t.workspaceId, t.documentId] }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'material_allocations_document_fk' }).onDelete('cascade'),
    check('material_allocations_period_chk', sql`${t.periodFrom} <= ${t.periodTo}`),
  ],
);

/** Вкладка «Продукция» документа «Распределение материалов»: позиции выпусков, между которыми делится расход */
export const materialAllocationItems = pgTable(
  'material_allocation_items',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    /** Выпуск и его позиция */
    releaseId: uuid('release_id').notNull(),
    releaseItemId: uuid('release_item_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    unique('material_allocation_items_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'material_allocation_items_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.releaseId], foreignColumns: [documents.workspaceId, documents.id], name: 'material_allocation_items_release_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.releaseItemId], foreignColumns: [productionItems.workspaceId, productionItems.id], name: 'material_allocation_items_item_fk' }).onDelete('cascade'),
    uniqueIndex('material_allocation_items_doc_item_uq').on(t.documentId, t.releaseItemId),
    index('material_allocation_items_release_idx').on(t.releaseId),
    index('material_allocation_items_item_idx').on(t.releaseItemId),
  ],
);

/** Таблица «Распределение» (позиция × материал × количество): хранится и в черновике, правится вручную; стоимость пишет проведение */
export const materialAllocationRows = pgTable(
  'material_allocation_rows',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Документ «Распределение материалов» */
    documentId: uuid('document_id').notNull(),
    /** Выпуск и его позиция */
    releaseId: uuid('release_id').notNull(),
    releaseItemId: uuid('release_item_id').notNull(),
    /** Материал */
    productId: uuid('product_id').notNull(),
    /** Строка списания материала в документе распределения */
    documentLineId: uuid('document_line_id'),
    qty: numeric('qty', { precision: 18, scale: 6 }).notNull().default('0'),
    /** Стоимость доли по цене списания (без накладных) */
    cost: numeric('cost', { precision: 18, scale: 4 }).notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    unique('material_allocation_rows_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'material_allocation_rows_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.releaseId], foreignColumns: [documents.workspaceId, documents.id], name: 'material_allocation_rows_release_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.releaseItemId], foreignColumns: [productionItems.workspaceId, productionItems.id], name: 'material_allocation_rows_item_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'material_allocation_rows_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.documentLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'material_allocation_rows_line_fk' }).onDelete('set null'),
    index('material_allocation_rows_document_idx').on(t.documentId, t.sortOrder),
    index('material_allocation_rows_release_idx').on(t.releaseId),
    index('material_allocation_rows_item_idx').on(t.releaseItemId),
  ],
);
