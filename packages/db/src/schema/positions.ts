/* Должности сотрудников и виды номенклатуры (задача 1172, docs/architecture/positions.md). Таблицы арендатора: workspace_id + RLS. */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './columns';
import { members } from './people';
import { wsCol } from './tenant';

/** Вид номенклатуры (как в 1С): название и тип; тип совпадает с products.kind товара (товар / услуга / работа) */
export const productKinds = pgTable(
  'product_kinds',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    type: text('type', { enum: ['goods', 'service', 'work'] }).notNull().default('goods'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('product_kinds_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('product_kinds_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`),
    check('product_kinds_type_chk', sql`${t.type} in ('goods','service','work')`),
  ],
);

/** Должность: название, функции (для фильтров списков выбора) и разделы меню (пусто — все разделы) */
export const positions = pgTable(
  'positions',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    functions: text('functions').array().notNull().default(sql`'{}'::text[]`),
    sections: text('sections').array().notNull().default(sql`'{}'::text[]`),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [unique('positions_ws_id_uq').on(t.workspaceId, t.id), uniqueIndex('positions_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`)],
);

/** Должности участника (одна или несколько) */
export const memberPositions = pgTable(
  'member_positions',
  {
    workspaceId: wsCol(),
    memberId: uuid('member_id').notNull(),
    positionId: uuid('position_id').notNull(),
  },
  t => [
    primaryKey({ columns: [t.memberId, t.positionId] }),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'member_positions_member_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.positionId], foreignColumns: [positions.workspaceId, positions.id], name: 'member_positions_position_fk' }).onDelete('cascade'),
    index('member_positions_position_idx').on(t.positionId),
  ],
);

/** Виды номенклатуры, которые оказывает должность со функцией «специалист записи» */
export const positionProductKinds = pgTable(
  'position_product_kinds',
  {
    workspaceId: wsCol(),
    positionId: uuid('position_id').notNull(),
    productKindId: uuid('product_kind_id').notNull(),
  },
  t => [
    primaryKey({ columns: [t.positionId, t.productKindId] }),
    foreignKey({ columns: [t.workspaceId, t.positionId], foreignColumns: [positions.workspaceId, positions.id], name: 'position_product_kinds_position_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productKindId], foreignColumns: [productKinds.workspaceId, productKinds.id], name: 'position_product_kinds_kind_fk' }).onDelete('cascade'),
  ],
);
