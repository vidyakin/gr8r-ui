/* Производство: участки, продукция (изделия и полуфабрикаты) и строки спецификации (BOM), заказы на производство и выпуск.
   Таблицы арендатора. Связи — составные внешние ключи (workspace_id, id). */
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, numeric, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, ts, updatedAt } from './columns';
import { products, units } from './catalog';
import { documentLines, documents, warehouses } from './documents';
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
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('work_centers_ws_id_uq').on(t.workspaceId, t.id),
    check('work_centers_rate_chk', sql`${t.hourlyRate} >= 0`),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'work_centers_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.outputWarehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'work_centers_output_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.wasteWarehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'work_centers_waste_warehouse_fk' }),
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
    unitCode: text('unit_code').notNull().default('796'),
    /** Товар каталога для продажи и склада (необязательно) */
    productId: uuid('product_id'),
    /** Спецификация задана на партию из batch_qty единиц */
    batchQty: numeric('batch_qty', { precision: 18, scale: 3 }).notNull().default('1'),
    /** Накладные, % от прямых затрат */
    overheadPct: numeric('overhead_pct', { precision: 7, scale: 2 }).notNull().default('0'),
    /** Вид производства: этапы выпуска (без вида — единственный этап «Завершение производства») */
    productionKindId: uuid('production_kind_id'),
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
    check('manufactured_items_batch_chk', sql`${t.batchQty} > 0 and ${t.overheadPct} >= 0`),
    uniqueIndex('manufactured_items_ws_code_uq').on(t.workspaceId, sql`lower(${t.code})`).where(sql`${t.code} <> ''`),
  ],
);

export const bomLines = pgTable(
  'bom_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    itemId: uuid('item_id').notNull(),
    kind: text('kind', { enum: ['material', 'semi', 'work'] }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /** material */
    productId: uuid('product_id'),
    /** semi */
    childItemId: uuid('child_item_id'),
    /** semi: режим полуфабриката — stock (выпускается отдельно и списывается со склада) или explode (разворачивается до материалов) */
    semiMode: text('semi_mode', { enum: ['stock', 'explode'] }),
    /** Количество на партию (material, semi) */
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
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
    check('bom_lines_kind_chk', sql`${t.kind} in ('material','semi','work')`),
    check(
      'bom_lines_shape_chk',
      sql`(${t.kind} = 'material' and ${t.productId} is not null and ${t.childItemId} is null)
        or (${t.kind} = 'semi' and ${t.childItemId} is not null and ${t.productId} is null and ${t.childItemId} <> ${t.itemId})
        or (${t.kind} = 'work' and ${t.childItemId} is null)`,
    ),
    check('bom_lines_nonneg_chk', sql`${t.qty} >= 0 and ${t.scrapPct} >= 0 and ${t.hours} >= 0`),
    check('bom_lines_semi_mode_chk', sql`(${t.kind} = 'semi' and ${t.semiMode} is not null and ${t.semiMode} in ('stock','explode')) or (${t.kind} <> 'semi' and ${t.semiMode} is null)`),
    index('bom_lines_item_idx').on(t.itemId, t.sortOrder),
    index('bom_lines_child_idx').on(t.childItemId),
    index('bom_lines_product_idx').on(t.productId),
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
    /** Плановая себестоимость единицы */
    plannedUnitCost: numeric('planned_unit_cost', { precision: 18, scale: 4 }),
    /** Строка заказа покупателя, которую выполняет позиция */
    customerOrderLineId: uuid('customer_order_line_id'),
    /** Позиция заказа на производство, которую выполняет эта (выпуск по заказу) */
    sourceItemId: uuid('source_item_id'),
    /** Этап выпуска, к которому относится позиция */
    stageId: uuid('stage_id'),
    /** Фактическая себестоимость позиции на этом этапе (материалы + работы + накладные) */
    stageCost: numeric('stage_cost', { precision: 18, scale: 4 }),
    /** Строка документа с продукцией (у выпуска) */
    documentLineId: uuid('document_line_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    unique('production_items_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_items_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.itemId], foreignColumns: [manufacturedItems.workspaceId, manufacturedItems.id], name: 'production_items_item_fk' }),
    foreignKey({ columns: [t.workspaceId, t.customerOrderLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'production_items_customer_line_fk' }),
    foreignKey({ columns: [t.workspaceId, t.sourceItemId], foreignColumns: [t.workspaceId, t.id], name: 'production_items_source_fk' }),
    foreignKey({ columns: [t.workspaceId, t.stageId], foreignColumns: [productionStages.workspaceId, productionStages.id], name: 'production_items_stage_fk' }),
    foreignKey({ columns: [t.workspaceId, t.documentLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'production_items_line_fk' }).onDelete('set null'),
    check('production_items_qty_chk', sql`${t.qty} > 0`),
    index('production_items_document_idx').on(t.documentId, t.sortOrder),
    index('production_items_source_idx').on(t.sourceItemId),
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
    /** Тип строки состава */
    kind: text('kind', { enum: ['material', 'semi', 'work'] }).notNull(),
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
    /** Плановый старт */
    plannedStart: ts('planned_start'),
    /** Плановый финиш */
    plannedEnd: ts('planned_end'),
    /** Родительский заказ на производство (дочерний заказ на полуфабрикат) */
    parentDocumentId: uuid('parent_document_id'),
    /** Этап выпуска (у заказа на производство — пусто: этапы выбирают при выпуске) */
    stageId: uuid('stage_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    primaryKey({ columns: [t.workspaceId, t.documentId] }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_headers_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'production_headers_work_center_fk' }),
    foreignKey({ columns: [t.workspaceId, t.parentDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_headers_parent_fk' }),
    foreignKey({ columns: [t.workspaceId, t.stageId], foreignColumns: [productionStages.workspaceId, productionStages.id], name: 'production_headers_stage_fk' }),
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
