/* Работа: проекты, статусы, задачи, комментарии, активность, уведомления, файлы, время, виды, события календаря.
   Все таблицы — арендаторские (workspace_id + RLS). Связи внутри арендатора — составные FK (workspace_id, id),
   чтобы запись одного арендатора не могла сослаться на запись другого даже в обход API. */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Subtask } from '@gr8r/shared';
import { archivedAt, createdAt, hours, pk, ts, updatedAt } from './columns';
import { members, teams, wsCol } from './people';

export const projects = pgTable(
  'projects',
  {
    id: pk(),
    workspaceId: wsCol(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('folder'),
    color: text('color', { enum: ['indigo', 'blue', 'violet', 'teal', 'rose', 'amber', 'green', 'slate'] }).notNull().default('indigo'),
    status: text('status', { enum: ['planning', 'active', 'risk', 'hold', 'complete'] }).notNull().default('planning'),
    teamId: uuid('team_id'),
    leadId: uuid('lead_id'),
    startDate: date('start_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    /** Избранное. Пока общее для воркспейса, как в локальной модели фронтенда */
    fav: boolean('fav').notNull().default(false),
    isPrivate: boolean('is_private').notNull().default(false),
    /** Общий доступ (форма Share) */
    access: text('access', { enum: ['private', 'workspace'] }).notNull().default('workspace'),
    description: text('description').notNull().default(''),
    milestones: jsonb('milestones').$type<{ name: string; date: string }[]>().notNull().default([]),
    /** Счётчик для ключей задач (WEB-109): следующий номер выдаётся атомарным UPDATE … RETURNING */
    taskCounter: integer('task_counter').notNull().default(0),
    /** Порядок в сайдбаре */
    sortOrder: integer('sort_order').notNull().default(0),
    lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
    custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('projects_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('projects_ws_key_uq').on(t.workspaceId, sql`lower(${t.key})`),
    foreignKey({ columns: [t.workspaceId, t.teamId], foreignColumns: [teams.workspaceId, teams.id], name: 'projects_team_fk' }),
    foreignKey({ columns: [t.workspaceId, t.leadId], foreignColumns: [members.workspaceId, members.id], name: 'projects_lead_fk' }),
    index('projects_ws_order_idx').on(t.workspaceId, t.sortOrder),
  ],
);

/** Участники проекта и их права (Project.members + Project.perms) */
export const projectMembers = pgTable(
  'project_members',
  {
    workspaceId: wsCol(),
    projectId: uuid('project_id').notNull(),
    memberId: uuid('member_id').notNull(),
    permission: text('permission').notNull().default('edit'),
    createdAt: createdAt(),
  },
  t => [
    primaryKey({ columns: [t.projectId, t.memberId] }),
    foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id], name: 'pm_project_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'pm_member_fk' }).onDelete('cascade'),
  ],
);

/** Статусы = колонки доски. Задача хранит key статуса (текст) */
export const statuses = pgTable(
  'statuses',
  {
    id: pk(),
    workspaceId: wsCol(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** Токен цвета, например var(--st-todo) */
    color: text('color').notNull(),
    builtin: boolean('builtin').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [unique('statuses_ws_id_uq').on(t.workspaceId, t.id), unique('statuses_ws_key_uq').on(t.workspaceId, t.key)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Человекочитаемый ключ WEB-109, уникален в воркспейсе */
    key: text('key').notNull(),
    projectId: uuid('project_id').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('todo'),
    assigneeId: uuid('assignee_id'),
    /** Шкала 1–10 (10 — самый срочный); null — без приоритета */
    priority: smallint('priority'),
    dueDate: date('due_date', { mode: 'string' }),
    startDate: date('start_date', { mode: 'string' }),
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),
    /** Дерево подзадач любой глубины — как в локальной модели */
    subtasks: jsonb('subtasks').$type<Subtask[]>().notNull().default([]),
    /** id задач-зависимостей (без FK: проверяется в API) */
    deps: uuid('deps').array().notNull().default(sql`'{}'::uuid[]`),
    description: text('description').notNull().default(''),
    planHours: hours('plan_hours'),
    prevStatus: text('prev_status'),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    fav: boolean('fav').notNull().default(false),
    /** Повтор: 'Weekly' и т.п. */
    recur: text('recur'),
    custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: ts('completed_at'),
    archivedAt: archivedAt(),
  },
  t => [
    unique('tasks_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('tasks_ws_key_uq').on(t.workspaceId, t.key),
    foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id], name: 'tasks_project_fk' }),
    foreignKey({ columns: [t.workspaceId, t.assigneeId], foreignColumns: [members.workspaceId, members.id], name: 'tasks_assignee_fk' }),
    foreignKey({ columns: [t.workspaceId, t.status], foreignColumns: [statuses.workspaceId, statuses.key], name: 'tasks_status_fk' }),
    check('tasks_priority_chk', sql`${t.priority} is null or ${t.priority} between 1 and 10`),
    index('tasks_ws_project_status_idx').on(t.workspaceId, t.projectId, t.status),
    index('tasks_ws_assignee_idx').on(t.workspaceId, t.assigneeId),
    index('tasks_ws_due_idx').on(t.workspaceId, t.dueDate),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: pk(),
    workspaceId: wsCol(),
    taskId: uuid('task_id').notNull(),
    authorId: uuid('author_id').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('comments_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.id], name: 'comments_task_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.authorId], foreignColumns: [members.workspaceId, members.id], name: 'comments_author_fk' }),
    index('comments_task_idx').on(t.taskId, t.createdAt),
  ],
);

/** Реакции на комментарии (Comment.re: эмодзи → участники) */
export const commentReactions = pgTable(
  'comment_reactions',
  {
    workspaceId: wsCol(),
    commentId: uuid('comment_id').notNull(),
    memberId: uuid('member_id').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  t => [
    primaryKey({ columns: [t.commentId, t.memberId, t.emoji] }),
    foreignKey({ columns: [t.workspaceId, t.commentId], foreignColumns: [comments.workspaceId, comments.id], name: 'cr_comment_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'cr_member_fk' }).onDelete('cascade'),
  ],
);

/** Лента активности. Пишется API вместе с событием (позже — воркером из events) */
export const activity = pgTable(
  'activity',
  {
    id: pk(),
    workspaceId: wsCol(),
    actorId: uuid('actor_id'),
    verb: text('verb').notNull(),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    extra: text('extra').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [index('activity_ws_created_idx').on(t.workspaceId, t.createdAt), index('activity_project_idx').on(t.projectId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Кому адресовано */
    recipientId: uuid('recipient_id').notNull(),
    type: text('type', { enum: ['mention', 'assign', 'comment', 'update'] }).notNull(),
    actorId: uuid('actor_id'),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    snippet: text('snippet').notNull().default(''),
    read: boolean('read').notNull().default(false),
    createdAt: createdAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.recipientId], foreignColumns: [members.workspaceId, members.id], name: 'notif_recipient_fk' }).onDelete('cascade'),
    index('notifications_recipient_idx').on(t.workspaceId, t.recipientId, t.createdAt),
  ],
);

/** Метаданные файлов проекта/задачи. Сами файлы — в S3-совместимом хранилище (storage_key) */
export const files = pgTable(
  'files',
  {
    id: pk(),
    workspaceId: wsCol(),
    projectId: uuid('project_id'),
    taskId: uuid('task_id'),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['fig', 'pdf', 'zip', 'img', 'sheet', 'doc', 'code', 'other'] }).notNull().default('other'),
    mime: text('mime'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    storageKey: text('storage_key'),
    uploadedBy: uuid('uploaded_by'),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id], name: 'files_project_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.id], name: 'files_task_fk' }).onDelete('cascade'),
    index('files_project_idx').on(t.projectId),
    index('files_task_idx').on(t.taskId),
  ],
);

/** Учёт времени. sub_id — id подзадачи внутри jsonb-дерева задачи (без FK) */
export const timeLogs = pgTable(
  'time_logs',
  {
    id: pk(),
    workspaceId: wsCol(),
    taskId: uuid('task_id').notNull(),
    subId: text('sub_id'),
    memberId: uuid('member_id').notNull(),
    hours: hours('hours').notNull(),
    logDate: date('log_date', { mode: 'string' }).notNull(),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.id], name: 'tl_task_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'tl_member_fk' }),
    check('time_logs_hours_chk', sql`${t.hours} > 0`),
    index('time_logs_task_idx').on(t.taskId),
    index('time_logs_ws_date_idx').on(t.workspaceId, t.logDate),
  ],
);

export const savedViews = pgTable(
  'saved_views',
  {
    id: pk(),
    workspaceId: wsCol(),
    projectId: uuid('project_id').notNull(),
    ownerId: uuid('owner_id'),
    name: text('name').notNull(),
    type: text('type', { enum: ['list', 'board', 'table', 'calendar', 'timeline'] }).notNull(),
    filters: jsonb('filters').$type<{ f: 'status' | 'assignee' | 'priority' | 'due' | 'project'; v: string[] }[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id], name: 'sv_project_fk' }).onDelete('cascade')],
);

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: pk(),
    workspaceId: wsCol(),
    projectId: uuid('project_id'),
    title: text('title').notNull(),
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    /** HH:MM */
    eventTime: text('event_time').notNull().default('09:00'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id], name: 'ce_project_fk' }).onDelete('cascade'),
    check('calendar_events_time_chk', sql`${t.eventTime} ~ '^[0-2][0-9]:[0-5][0-9]$'`),
    index('calendar_events_ws_date_idx').on(t.workspaceId, t.eventDate),
  ],
);
