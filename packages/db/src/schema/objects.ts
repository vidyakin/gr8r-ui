/* Объекты объектного учёта (задача 1268, docs/architecture/construction.md): справочник объектов, прорабы и договоры.
   Таблицы арендатора (workspace_id + RLS), связи — составные FK. Ссылки на проекты задач, склады и договоры
   добавляются в SQL-миграции, чтобы не замыкать круг импортов схем (objects ↔ work/documents/billing). */
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, pk, updatedAt } from './columns';
import { companies } from './crm';
import { members, wsCol } from './people';

export const objects = pgTable(
  'objects',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Код объекта: уникален в воркспейсе (без учёта регистра, среди неархивных) */
    number: text('number').notNull(),
    name: text('name').notNull(),
    /** Основной заказчик */
    customerId: uuid('customer_id'),
    address: text('address').notNull().default(''),
    startDate: date('start_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    status: text('status', { enum: ['planning', 'active', 'hold', 'done', 'closed'] }).notNull().default('planning'),
    /** Ответственный участник */
    managerId: uuid('manager_id'),
    /** Способ выручки: акты, вехи, часы */
    revenueMode: text('revenue_mode', { enum: ['acts', 'milestones', 'hours'] }).notNull().default('acts'),
    /** Процент накладных от прямых затрат */
    overheadPct: numeric('overhead_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    /** Свой проект задач (график, Гант): составной FK (workspace_id, project_id) → projects добавляет миграция */
    projectId: uuid('project_id'),
    /** Склад объекта (необязательно): составной FK (workspace_id, warehouse_id) → warehouses добавляет миграция */
    warehouseId: uuid('warehouse_id'),
    note: text('note').notNull().default(''),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('objects_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('objects_ws_number_uq')
      .on(t.workspaceId, sql`lower(${t.number})`)
      .where(sql`${t.archivedAt} is null`),
    foreignKey({ columns: [t.workspaceId, t.customerId], foreignColumns: [companies.workspaceId, companies.id], name: 'objects_customer_fk' }),
    foreignKey({ columns: [t.workspaceId, t.managerId], foreignColumns: [members.workspaceId, members.id], name: 'objects_manager_fk' }),
    check('objects_status_chk', sql`${t.status} in ('planning','active','hold','done','closed')`),
    check('objects_revenue_mode_chk', sql`${t.revenueMode} in ('acts','milestones','hours')`),
    check('objects_overhead_chk', sql`${t.overheadPct} >= 0 and ${t.overheadPct} <= 100`),
    index('objects_ws_status_idx').on(t.workspaceId, t.status),
  ],
);

/** Прорабы объекта (назначенные участники) */
export const objectForemen = pgTable(
  'object_foremen',
  {
    workspaceId: wsCol(),
    objectId: uuid('object_id').notNull(),
    memberId: uuid('member_id').notNull(),
    createdAt: createdAt(),
  },
  t => [
    unique('object_foremen_ws_id_uq').on(t.workspaceId, t.objectId, t.memberId),
    foreignKey({ columns: [t.workspaceId, t.objectId], foreignColumns: [objects.workspaceId, objects.id], name: 'object_foremen_object_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'object_foremen_member_fk' }).onDelete('cascade'),
    index('object_foremen_object_idx').on(t.objectId),
  ],
);

/** Договоры объекта: ссылки на общий справочник contracts (составной FK добавляет миграция) */
export const objectContracts = pgTable(
  'object_contracts',
  {
    workspaceId: wsCol(),
    objectId: uuid('object_id').notNull(),
    contractId: uuid('contract_id').notNull(),
    createdAt: createdAt(),
  },
  t => [
    unique('object_contracts_ws_id_uq').on(t.workspaceId, t.objectId, t.contractId),
    check('object_contracts_object_chk', sql`${t.objectId} is not null and ${t.contractId} is not null`),
    foreignKey({ columns: [t.workspaceId, t.objectId], foreignColumns: [objects.workspaceId, objects.id], name: 'object_contracts_object_fk' }).onDelete('cascade'),
    index('object_contracts_object_idx').on(t.objectId),
  ],
);
