/* Конструктор сущностей (метаданные + JSONB): описание сущностей и полей, записи пользовательских сущностей.
   Таблицы под пользовательские данные на лету не создаются: значения лежат в records.data (jsonb), а у системных
   таблиц — в колонке custom. См. docs/architecture.md, «Конструктор сущностей». */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { FieldOptions } from '@gr8r/shared';
import { archivedAt, createdAt, pk, updatedAt } from './columns';
import { wsCol } from './people';

export const entities = pgTable(
  'entities',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** task, project, deal, company, contact — системные; остальные — пользовательские. Не меняется после создания */
    key: text('key').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['system', 'custom'] }).notNull().default('custom'),
    icon: text('icon').notNull().default('database'),
    /** Ключ поля-заголовка (для системных — имя колонки: title / name) */
    titleField: text('title_field').notNull().default('name'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Удалённая сущность: скрыта, записи остаются до очистки */
    archivedAt: archivedAt(),
  },
  t => [
    unique('entities_ws_id_uq').on(t.workspaceId, t.id),
    unique('entities_ws_key_uq').on(t.workspaceId, t.key),
    check('entities_kind_chk', sql`${t.kind} in ('system','custom')`),
  ],
);

export const fields = pgTable(
  'fields',
  {
    id: pk(),
    workspaceId: wsCol(),
    entityId: uuid('entity_id').notNull(),
    /** Ключ в jsonb; не меняется после создания, как и тип */
    key: text('key').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    required: boolean('required').notNull().default(false),
    unique: boolean('unique').notNull().default(false),
    /** Для поля создан индекс по выражению (CREATE INDEX CONCURRENTLY) */
    filterable: boolean('filterable').notNull().default(false),
    options: jsonb('options').$type<FieldOptions>().notNull().default({}),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Встроенное поле сущности (колонка таблицы): не редактируется и не удаляется */
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Удалённое поле: скрыто и не принимает значений, данные в jsonb остаются до очистки */
    archivedAt: archivedAt(),
  },
  t => [
    unique('fields_entity_key_uq').on(t.entityId, t.key),
    foreignKey({ columns: [t.workspaceId, t.entityId], foreignColumns: [entities.workspaceId, entities.id], name: 'fields_entity_fk' }).onDelete('cascade'),
    index('fields_entity_idx').on(t.entityId, t.sortOrder),
  ],
);

export const records = pgTable(
  'records',
  {
    id: pk(),
    workspaceId: wsCol(),
    entityId: uuid('entity_id').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    /** members.id автора (без FK: запись переживает участника) */
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('records_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.entityId], foreignColumns: [entities.workspaceId, entities.id], name: 'records_entity_fk' }).onDelete('cascade'),
    index('records_entity_created_idx').on(t.entityId, t.createdAt),
    index('records_data_gin').using('gin', sql`${t.data} jsonb_path_ops`),
  ],
);
