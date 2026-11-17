/* Подразделения (оргструктура, docs/architecture/departments.md): дерево с руководителями и состав сотрудников.
   Таблицы арендатора: workspace_id + RLS. У участника не больше одного подразделения (уникальный индекс по member_id). */
import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, pk, updatedAt } from './columns';
import { members } from './people';
import { wsCol } from './tenant';

/** Подразделение: название (уникально без учёта регистра), родительское подразделение и руководитель-участник */
export const departments = pgTable(
  'departments',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    parentId: uuid('parent_id'),
    headMemberId: uuid('head_member_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('departments_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('departments_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`),
    // родитель — своё же подразделение; удаление родителя с детьми запрещено (RESTRICT)
    foreignKey({ columns: [t.workspaceId, t.parentId], foreignColumns: [t.workspaceId, t.id], name: 'departments_parent_fk' }).onDelete('restrict'),
    // руководитель — участник воркспейса; при удалении участника обнуляется только head_member_id
    foreignKey({ columns: [t.workspaceId, t.headMemberId], foreignColumns: [members.workspaceId, members.id], name: 'departments_head_member_fk' }).onDelete('set null'),
    index('departments_parent_idx').on(t.parentId),
  ],
);

/** Состав подразделения: у участника не больше одного подразделения (уникальный индекс по workspace_id + member_id) */
export const departmentMembers = pgTable(
  'department_members',
  {
    workspaceId: wsCol(),
    departmentId: uuid('department_id').notNull(),
    memberId: uuid('member_id').notNull(),
  },
  t => [
    primaryKey({ columns: [t.departmentId, t.memberId] }),
    foreignKey({ columns: [t.workspaceId, t.departmentId], foreignColumns: [departments.workspaceId, departments.id], name: 'department_members_department_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'department_members_member_fk' }).onDelete('cascade'),
    uniqueIndex('department_members_ws_member_uq').on(t.workspaceId, t.memberId),
    index('department_members_department_idx').on(t.departmentId),
  ],
);