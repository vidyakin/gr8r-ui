/* Учёт имущества в эксплуатации: товары, переданные сотрудникам и участкам, и движения по ним.
   Количественный учёт без стоимости (стоимость списания — в статье затрат перемещения). Таблицы арендатора.

   Тут же давальческое сырьё: принятое от давальца сырьё и продукция из него учитываются количественно по ключу
   (склад, товар, давалец, заказ на переработку) — собственный склад, средняя и пересчёт себестоимости такие движения не видят. */
import { sql } from 'drizzle-orm';
import { bigint, check, date, foreignKey, index, numeric, pgTable, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './columns';
import { products } from './catalog';
import { companies } from './crm';
import { documentLines, documents, warehouses } from './documents';
import { members, wsCol } from './people';
import { workCenters } from './production';

/** Остаток имущества в эксплуатации: у кого товар (участник или участок) и сколько */
export const inUseBalances = pgTable(
  'in_use_balances',
  {
    id: pk(),
    workspaceId: wsCol(),
    productId: uuid('product_id').notNull(),
    /** Получатель: участник воркспейса */
    memberId: uuid('member_id'),
    /** Получатель: участок */
    workCenterId: uuid('work_center_id'),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('in_use_balances_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'in_use_balances_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'in_use_balances_member_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'in_use_balances_work_center_fk' }),
    // получатель ровно один: сотрудник или участок
    check('in_use_balances_holder_chk', sql`(${t.memberId} is not null) <> (${t.workCenterId} is not null)`),
    uniqueIndex('in_use_balances_member_uq').on(t.workspaceId, t.productId, t.memberId).where(sql`${t.memberId} is not null`),
    uniqueIndex('in_use_balances_work_center_uq').on(t.workspaceId, t.productId, t.workCenterId).where(sql`${t.workCenterId} is not null`),
    index('in_use_balances_holder_idx').on(t.workspaceId, t.memberId, t.workCenterId),
  ],
);

/** Движения имущества в эксплуатации: передали сотруднику (+) или участку, вернули обратно (−) */
export const inUseMoves = pgTable(
  'in_use_moves',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    documentLineId: uuid('document_line_id'),
    productId: uuid('product_id').notNull(),
    memberId: uuid('member_id'),
    workCenterId: uuid('work_center_id'),
    /** Со знаком: передано +, возвращено − */
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull(),
    movedAt: date('moved_at', { mode: 'string' }).notNull(),
    createdAt: createdAt(),
  },
  t => [
    unique('in_use_moves_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'in_use_moves_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.documentLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'in_use_moves_line_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'in_use_moves_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'in_use_moves_member_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'in_use_moves_work_center_fk' }),
    check('in_use_moves_holder_chk', sql`(${t.memberId} is not null) <> (${t.workCenterId} is not null)`),
    check('in_use_moves_qty_chk', sql`${t.qty} <> 0`),
    index('in_use_moves_holder_idx').on(t.workspaceId, t.memberId, t.workCenterId),
    index('in_use_moves_document_idx').on(t.documentId),
  ],
);

/* ---------------- давальческое сырьё ----------------

   Учёт давальческого сырья — отдельный от своего склада: только количества, без стоимости и без средней.
   Ключ остатка — (склад, товар, давалец, заказ на переработку). Заказ необязателен: без него это общий остаток давальца,
   но сырьё одного заказа никогда не списывается на другой — запрет минуса проверяется по полному ключу. */

/** Остаток давальческого сырья по (склад, товар, давалец, заказ на переработку) */
export const customerStockBalances = pgTable(
  'customer_stock_balances',
  {
    id: pk(),
    workspaceId: wsCol(),
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    /** Давалец — контрагент, чьё это сырьё */
    ownerCompanyId: uuid('owner_company_id').notNull(),
    /** Заказ на переработку; пусто — общий остаток давальца */
    processingOrderId: uuid('processing_order_id'),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('customer_stock_balances_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'customer_stock_balances_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'customer_stock_balances_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.ownerCompanyId], foreignColumns: [companies.workspaceId, companies.id], name: 'customer_stock_balances_owner_fk' }),
    foreignKey({ columns: [t.workspaceId, t.processingOrderId], foreignColumns: [documents.workspaceId, documents.id], name: 'customer_stock_balances_order_fk' }),
    // ключ остатка NULL-безопасен двумя частичными индексами: свой — по заказу, общий — по давальцу без заказа
    uniqueIndex('customer_stock_balances_order_uq').on(t.workspaceId, t.warehouseId, t.productId, t.ownerCompanyId, t.processingOrderId).where(sql`${t.processingOrderId} is not null`),
    uniqueIndex('customer_stock_balances_owner_uq').on(t.workspaceId, t.warehouseId, t.productId, t.ownerCompanyId).where(sql`${t.processingOrderId} is null`),
    index('customer_stock_balances_owner_idx').on(t.workspaceId, t.ownerCompanyId),
    index('customer_stock_balances_product_idx').on(t.workspaceId, t.productId),
  ],
);

/** Движения давальческого сырья (со знаком: приход +, расход −). seq задаёт порядок отмены проведения */
export const customerStockMoves = pgTable(
  'customer_stock_moves',
  {
    id: pk(),
    workspaceId: wsCol(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    documentId: uuid('document_id').notNull(),
    documentLineId: uuid('document_line_id'),
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    ownerCompanyId: uuid('owner_company_id').notNull(),
    processingOrderId: uuid('processing_order_id'),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull(),
    movedAt: date('moved_at', { mode: 'string' }).notNull(),
    createdAt: createdAt(),
  },
  t => [
    unique('customer_stock_moves_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'customer_stock_moves_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.documentLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'customer_stock_moves_line_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'customer_stock_moves_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'customer_stock_moves_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.ownerCompanyId], foreignColumns: [companies.workspaceId, companies.id], name: 'customer_stock_moves_owner_fk' }),
    foreignKey({ columns: [t.workspaceId, t.processingOrderId], foreignColumns: [documents.workspaceId, documents.id], name: 'customer_stock_moves_order_fk' }),
    check('customer_stock_moves_qty_chk', sql`${t.qty} <> 0`),
    index('customer_stock_moves_card_idx').on(t.workspaceId, t.warehouseId, t.productId, t.ownerCompanyId, t.processingOrderId, t.seq),
    index('customer_stock_moves_document_idx').on(t.documentId),
  ],
);
