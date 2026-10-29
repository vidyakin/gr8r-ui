/* Воронки продаж (задача 1176, docs/architecture/pipelines.md): воронки, их этапы с категориями, причины проигрыша.
   История этапов сделки — в crm.ts (ссылается на сделки). Таблицы арендатора: workspace_id + составные FK + RLS. */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { DEAL_STAGE_CATEGORIES } from '@gr8r/shared';
import { createdAt, pk, updatedAt } from './columns';
import { wsCol } from './tenant';

/** Воронка: у сделки ровно одна; «основная» — для новых сделок без явной воронки */
export const dealPipelines = pgTable(
  'deal_pipelines',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('deal_pipelines_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('deal_pipelines_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`),
    uniqueIndex('deal_pipelines_default_uq').on(t.workspaceId).where(sql`${t.isDefault}`),
  ],
);

/** Этап воронки. Категория определяет логику; вероятность — в процентах; обязательные поля — ключи (`amount`, `closeDate`, `contact`, `source`, `custom:<ключ>`) */
export const dealStages = pgTable(
  'deal_stages',
  {
    id: pk(),
    workspaceId: wsCol(),
    pipelineId: uuid('pipeline_id').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull().default('gray'),
    sortOrder: integer('sort_order').notNull().default(0),
    category: text('category', { enum: DEAL_STAGE_CATEGORIES }).notNull().default('in_progress'),
    probability: integer('probability').notNull().default(0),
    requiredFields: jsonb('required_fields').$type<string[]>().notNull().default([]),
    /** Норматив дней на этапе; пусто — без норматива */
    slaDays: integer('sla_days'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('deal_stages_ws_id_uq').on(t.workspaceId, t.id),
    unique('deal_stages_ws_pipeline_id_uq').on(t.workspaceId, t.pipelineId, t.id),
    foreignKey({ columns: [t.workspaceId, t.pipelineId], foreignColumns: [dealPipelines.workspaceId, dealPipelines.id], name: 'deal_stages_pipeline_fk' }).onDelete('cascade'),
    uniqueIndex('deal_stages_pipeline_name_uq').on(t.workspaceId, t.pipelineId, sql`lower(${t.name})`),
    uniqueIndex('deal_stages_one_won_uq').on(t.workspaceId, t.pipelineId).where(sql`${t.category} = 'won'`),
    check('deal_stages_category_chk', sql`${t.category} in ('in_progress','won','lost')`),
    check('deal_stages_probability_chk', sql`${t.probability} between 0 and 100`),
    index('deal_stages_pipeline_idx').on(t.workspaceId, t.pipelineId, t.sortOrder),
  ],
);

/** Справочник причин проигрыша */
export const dealLostReasons = pgTable(
  'deal_lost_reasons',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [unique('deal_lost_reasons_ws_id_uq').on(t.workspaceId, t.id), uniqueIndex('deal_lost_reasons_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`)],
);
