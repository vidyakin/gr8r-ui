/* Серийные номера, ремонт и гарантия (задача 1099, docs/architecture/serials-repair.md). Таблицы арендатора (workspace_id + RLS).
   Состояние номера — результат журнала serial_events (по порядку seq): проведение дописывает события, отмена проведения
   удаляет события документа и пересчитывает номер. Изделие клиента в ремонте склад не трогает. */
import { sql } from 'drizzle-orm';
import { bigint, check, date, foreignKey, index, integer, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './columns';
import { products } from './catalog';
import { companies } from './crm';
import { documentLines, documents, warehouses } from './documents';
import { wsCol } from './people';
import { workOrderMaterials } from './services';

/** Реестр серийных номеров: уникален (товар, номер) в воркспейсе без учёта регистра */
export const serialNumbers = pgTable(
  'serial_numbers',
  {
    id: pk(),
    workspaceId: wsCol(),
    productId: uuid('product_id').notNull(),
    serial: text('serial').notNull(),
    /** Состояние: на складе, продан, списан (в том числе ушёл поставщику), в пути между складами */
    status: text('status', { enum: ['in_stock', 'sold', 'written_off', 'in_transit'] }).notNull().default('in_stock'),
    /** Склад, на котором номер лежит (только in_stock) */
    warehouseId: uuid('warehouse_id'),
    soldAt: date('sold_at', { mode: 'string' }),
    soldDocumentId: uuid('sold_document_id'),
    soldLineId: uuid('sold_line_id'),
    ownerCompanyId: uuid('owner_company_id'),
    warrantyMonths: integer('warranty_months'),
    warrantyUntil: date('warranty_until', { mode: 'string' }),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('serial_numbers_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'serial_numbers_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'serial_numbers_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.ownerCompanyId], foreignColumns: [companies.workspaceId, companies.id], name: 'serial_numbers_owner_fk' }),
    foreignKey({ columns: [t.workspaceId, t.soldDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'serial_numbers_sold_document_fk' }),
    check('serial_numbers_status_chk', sql`${t.status} in ('in_stock','sold','written_off','in_transit')`),
    uniqueIndex('serial_numbers_product_serial_uq').on(t.workspaceId, t.productId, sql`lower(${t.serial})`),
    index('serial_numbers_serial_idx').on(t.workspaceId, sql`lower(${t.serial})`),
    index('serial_numbers_product_status_idx').on(t.workspaceId, t.productId, t.status),
  ],
);

/** Журнал событий номера: приход, расход, продажа… Пишется проведением документа, удаляется его отменой */
export const serialEvents = pgTable(
  'serial_events',
  {
    id: pk(),
    workspaceId: wsCol(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    serialId: uuid('serial_id').notNull(),
    documentId: uuid('document_id').notNull(),
    documentLineId: uuid('document_line_id'),
    /** Фаза движения документа (перемещение «в пути»: 2 — приёмка) */
    phase: integer('phase').notNull().default(1),
    /** Тип документа и направление движения */
    docType: text('doc_type').notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    warehouseId: uuid('warehouse_id'),
    counterpartyId: uuid('counterparty_id'),
    /** Состояние номера после события */
    statusAfter: text('status_after', { enum: ['in_stock', 'sold', 'written_off', 'in_transit'] }).notNull(),
    movedAt: date('moved_at', { mode: 'string' }).notNull(),
    /** Продажа: гарантия до (правится в карточке номера) и срок в месяцах */
    warrantyMonths: integer('warranty_months'),
    warrantyUntil: date('warranty_until', { mode: 'string' }),
    createdAt: createdAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.serialId], foreignColumns: [serialNumbers.workspaceId, serialNumbers.id], name: 'serial_events_serial_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'serial_events_document_fk' }).onDelete('cascade'),
    index('serial_events_serial_idx').on(t.serialId, t.seq),
    index('serial_events_document_idx').on(t.documentId),
  ],
);

/** Номера строки документа (черновик хранит введённый текст; при проведении связывается с реестром).
    Строка — строка документа или материал заказ-наряда */
export const documentLineSerials = pgTable(
  'document_line_serials',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    documentLineId: uuid('document_line_id'),
    materialId: uuid('material_id'),
    serial: text('serial').notNull(),
    serialId: uuid('serial_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'document_line_serials_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.documentLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'document_line_serials_line_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.materialId], foreignColumns: [workOrderMaterials.workspaceId, workOrderMaterials.id], name: 'document_line_serials_material_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.serialId], foreignColumns: [serialNumbers.workspaceId, serialNumbers.id], name: 'document_line_serials_serial_fk' }).onDelete('set null'),
    check('document_line_serials_slot_chk', sql`(${t.documentLineId} is not null) <> (${t.materialId} is not null)`),
    index('document_line_serials_document_idx').on(t.documentId),
    index('document_line_serials_line_idx').on(t.documentLineId),
    index('document_line_serials_material_idx').on(t.materialId),
    index('document_line_serials_serial_idx').on(t.serialId),
  ],
);

/** Изделие в ремонте (по одному на заказ-наряд типа ремонт / гарантийный ремонт). Склад не затрагивает */
export const workOrderRepairItems = pgTable(
  'work_order_repair_items',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    productId: uuid('product_id'),
    /** Произвольное название, если изделия нет в каталоге */
    name: text('name').notNull().default(''),
    serialId: uuid('serial_id'),
    serialText: text('serial_text').notNull().default(''),
    defect: text('defect').notNull().default(''),
    completeness: text('completeness').notNull().default(''),
    appearance: text('appearance').notNull().default(''),
    receivedAt: date('received_at', { mode: 'string' }),
    returnedAt: date('returned_at', { mode: 'string' }),
    /** Сторонний ремонт */
    outsourceCompanyId: uuid('outsource_company_id'),
    outsourcedAt: date('outsourced_at', { mode: 'string' }),
    outsourceReturnedAt: date('outsource_returned_at', { mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('work_order_repair_items_ws_id_uq').on(t.workspaceId, t.id),
    unique('work_order_repair_items_document_uq').on(t.documentId),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'work_order_repair_items_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'work_order_repair_items_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.serialId], foreignColumns: [serialNumbers.workspaceId, serialNumbers.id], name: 'work_order_repair_items_serial_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.outsourceCompanyId], foreignColumns: [companies.workspaceId, companies.id], name: 'work_order_repair_items_outsource_fk' }),
    index('work_order_repair_items_serial_idx').on(t.serialId),
  ],
);

/** Материалы заказчика: что клиент принёс (информационно, без склада) */
export const workOrderCustomerMaterials = pgTable(
  'work_order_customer_materials',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    productId: uuid('product_id'),
    name: text('name').notNull().default(''),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('1'),
    comment: text('comment').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'work_order_customer_materials_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'work_order_customer_materials_product_fk' }),
    index('work_order_customer_materials_document_idx').on(t.documentId),
  ],
);
