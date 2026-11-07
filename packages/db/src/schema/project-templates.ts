/* Шаблоны проектов (задача «Шаблоны проектов», docs/architecture/task-modules.md): проект, сохранённый как заготовка.
   Сроки — «день N от старта» (день 1 = дата старта), исполнители — должностями (positions), а не людьми. Таблицы арендатора: workspace_id + RLS. */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, smallint, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { TemplateMilestone, TemplateSubtask } from '@gr8r/shared';
import { createdAt, pk, updatedAt } from './columns';
import { members } from './people';
import { positions } from './positions';
import { wsCol } from './tenant';

export const projectTemplates = pgTable(
  'project_templates',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull().default('folder'),
    color: text('color').notNull().default('indigo'),
    /** Длительность проекта в днях от старта (по сроку исходного проекта); null — срок не задан */
    durationDays: integer('duration_days'),
    /** Вехи проекта: день от старта вместо даты */
    milestones: jsonb('milestones').$type<TemplateMilestone[]>().notNull().default([]),
    /** Отключён: скрыт из выбора при создании проекта, в списке шаблонов остаётся */
    disabled: boolean('disabled').notNull().default(false),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('project_templates_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('project_templates_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`),
    check('project_templates_duration_chk', sql`${t.durationDays} is null or ${t.durationDays} >= 1`),
    foreignKey({ columns: [t.workspaceId, t.createdBy], foreignColumns: [members.workspaceId, members.id], name: 'project_templates_created_by_fk' }).onDelete('set null'),
  ],
);

/** Задача шаблона. Подзадачи (они же чек-лист) — дерево в jsonb, как в tasks.subtasks, но со сроками в днях */
export const projectTemplateTasks = pgTable(
  'project_template_tasks',
  {
    id: pk(),
    workspaceId: wsCol(),
    templateId: uuid('template_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** Ключ статуса воркспейса; при создании проекта, если статуса уже нет, — todo */
    status: text('status').notNull().default('todo'),
    priority: smallint('priority'),
    startDay: integer('start_day'),
    dueDay: integer('due_day'),
    planHours: numeric('plan_hours', { precision: 10, scale: 2 }),
    /** Исполнитель по должности: при создании проекта — первый активный участник с этой должностью; пусто — без исполнителя */
    positionId: uuid('position_id'),
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),
    subtasks: jsonb('subtasks').$type<TemplateSubtask[]>().notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.templateId], foreignColumns: [projectTemplates.workspaceId, projectTemplates.id], name: 'project_template_tasks_template_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.positionId], foreignColumns: [positions.workspaceId, positions.id], name: 'project_template_tasks_position_fk' }).onDelete('set null'),
    check('project_template_tasks_priority_chk', sql`${t.priority} is null or ${t.priority} between 1 and 10`),
    check('project_template_tasks_days_chk', sql`(${t.startDay} is null or ${t.startDay} >= 1) and (${t.dueDay} is null or ${t.dueDay} >= 1)`),
    index('project_template_tasks_template_idx').on(t.workspaceId, t.templateId, t.sortOrder),
  ],
);
