/* Производство: участки, продукция (изделия и полуфабрикаты) и строки спецификации (BOM). Таблицы арендатора. */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { products, units } from './catalog';
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
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [unique('work_centers_ws_id_uq').on(t.workspaceId, t.id), check('work_centers_rate_chk', sql`${t.hourlyRate} >= 0`)],
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
