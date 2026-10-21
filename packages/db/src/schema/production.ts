/* Производство: участки, продукция (изделия и полуфабрикаты) и строки спецификации (BOM), заказы на производство и выпуск.
   Таблицы арендатора. Связи — составные внешние ключи (workspace_id, id). */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, numeric, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, ts, updatedAt } from './columns';
import { products, units } from './catalog';
import { documentLines, documents, warehouses } from './documents';
import { wsCol } from './people';

export const workCenters = pgTable(
  'work_centers',
  {
    id: pk(),
    workspaceId: wsCol(),
    code: text('code').notNull().default(''),
    name: text('name').notNull(),
    /** Ставка за час по умолчанию */
    hourlyRate: money('hourly_rate').notNull().default('0'),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('manufactured_items_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'manufactured_items_product_fk' }),
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
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.itemId], foreignColumns: [manufacturedItems.workspaceId, manufacturedItems.id], name: 'bom_lines_item_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'bom_lines_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.childItemId], foreignColumns: [manufacturedItems.workspaceId, manufacturedItems.id], name: 'bom_lines_child_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'bom_lines_work_center_fk' }),
    check('bom_lines_kind_chk', sql`${t.kind} in ('material','semi','work')`),
    check(
      'bom_lines_shape_chk',
      sql`(${t.kind} = 'material' and ${t.productId} is not null and ${t.childItemId} is null)
        or (${t.kind} = 'semi' and ${t.childItemId} is not null and ${t.productId} is null and ${t.childItemId} <> ${t.itemId})
        or (${t.kind} = 'work' and ${t.productId} is null and ${t.childItemId} is null)`,
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
    check(
      'production_components_shape_chk',
      sql`(${t.kind} = 'work' and ${t.productId} is null) or (${t.kind} <> 'work' and ${t.productId} is not null)`,
    ),
    check('production_components_nonneg_chk', sql`${t.qty} >= 0 and ${t.hours} >= 0`),
    index('production_components_document_idx').on(t.documentId, t.sortOrder),
    index('production_components_item_idx').on(t.itemId),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    primaryKey({ columns: [t.workspaceId, t.documentId] }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_headers_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'production_headers_work_center_fk' }),
    foreignKey({ columns: [t.workspaceId, t.parentDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'production_headers_parent_fk' }),
  ],
);
