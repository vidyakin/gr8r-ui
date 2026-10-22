/* Учёт имущества в эксплуатации: товары, переданные сотрудникам и участкам, и движения по ним.
   Количественный учёт без стоимости (стоимость списания — в статье затрат перемещения). Таблицы арендатора. */
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, numeric, pgTable, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './columns';
import { products } from './catalog';
import { documentLines, documents } from './documents';
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
