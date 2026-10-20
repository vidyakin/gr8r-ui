/* Автоматизации: flow (черновик + опубликованные версии), журнал запусков и шагов.
   Все таблицы — арендаторские (workspace_id + RLS). См. docs/architecture.md, «Автоматизации». */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { FlowGraph } from '@gr8r/shared';
import { createdAt, pk, ts, updatedAt } from './columns';
import { wsCol } from './people';

export const flows = pgTable(
  'flows',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Работает ли опубликованная версия. Включить можно только опубликованный flow */
    enabled: boolean('enabled').notNull().default(false),
    /** Черновик: редактируется, на запуски не влияет */
    graph: jsonb('graph').$type<FlowGraph>().notNull().default({ nodes: [], edges: [] }),
    /** Номер последней выданной версии (растёт при каждой публикации) */
    versionCounter: integer('version_counter').notNull().default(0),
    /** Действующая версия (flow_versions.version); null — ещё не публиковался */
    publishedVersion: integer('published_version'),
    publishedAt: ts('published_at'),
    /** members.id создателя: от его имени flow создаёт задачи и пишет комментарии (без FK: flow переживает участника) */
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('flows_ws_id_uq').on(t.workspaceId, t.id),
    check('flows_published_chk', sql`${t.enabled} = false or ${t.publishedVersion} is not null`),
    index('flows_ws_enabled_idx').on(t.workspaceId, t.enabled),
  ],
);

/** Опубликованные версии графа: неизменяемы, запуск ссылается на номер версии */
export const flowVersions = pgTable(
  'flow_versions',
  {
    id: pk(),
    workspaceId: wsCol(),
    flowId: uuid('flow_id').notNull(),
    version: integer('version').notNull(),
    graph: jsonb('graph').$type<FlowGraph>().notNull(),
    /** Тип и параметры триггера отдельно — для быстрого подбора flow по событию */
    triggerType: text('trigger_type').notNull(),
    publishedBy: uuid('published_by'),
    createdAt: createdAt(),
  },
  t => [
    unique('flow_versions_flow_version_uq').on(t.flowId, t.version),
    foreignKey({ columns: [t.workspaceId, t.flowId], foreignColumns: [flows.workspaceId, flows.id], name: 'flow_versions_flow_fk' }).onDelete('cascade'),
  ],
);

export const flowRuns = pgTable(
  'flow_runs',
  {
    id: pk(),
    workspaceId: wsCol(),
    flowId: uuid('flow_id').notNull(),
    version: integer('version').notNull(),
    /** queued → running → waiting (задержка / повтор) → succeeded | failed; skipped — запуск отклонён защитой от зацикливания */
    status: text('status', { enum: ['queued', 'running', 'waiting', 'succeeded', 'failed', 'skipped'] }).notNull().default('queued'),
    /** event | schedule | manual */
    triggerKind: text('trigger_kind').notNull(),
    /** События журнала: один запуск на пару (flow, событие) */
    eventId: uuid('event_id'),
    /** Для расписания — минута срабатывания: один запуск на пару (flow, минута) */
    dedupeKey: text('dedupe_key'),
    /** Контекст триггера (запись, изменения…), снимок на момент запуска */
    trigger: jsonb('trigger').$type<Record<string, unknown>>().notNull().default({}),
    /** Ход выполнения: очередь узлов, выходы шагов, счётчик шагов, время возобновления */
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
    /** Цепочка flow, породивших это событие, + сам flow: защита от зацикливания */
    chain: uuid('chain').array().notNull().default(sql`'{}'::uuid[]`),
    error: text('error'),
    /** members.id: кто запустил вручную */
    startedBy: uuid('started_by'),
    createdAt: createdAt(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  t => [
    unique('flow_runs_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.flowId], foreignColumns: [flows.workspaceId, flows.id], name: 'flow_runs_flow_fk' }).onDelete('cascade'),
    check('flow_runs_status_chk', sql`${t.status} in ('queued','running','waiting','succeeded','failed','skipped')`),
    uniqueIndex('flow_runs_event_uq').on(t.flowId, t.eventId).where(sql`${t.eventId} is not null`),
    uniqueIndex('flow_runs_dedupe_uq').on(t.flowId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    index('flow_runs_flow_idx').on(t.workspaceId, t.flowId, t.createdAt),
    index('flow_runs_ws_idx').on(t.workspaceId, t.createdAt),
  ],
);

export const flowRunSteps = pgTable(
  'flow_run_steps',
  {
    id: pk(),
    workspaceId: wsCol(),
    runId: uuid('run_id').notNull(),
    /** Порядковый номер шага в запуске */
    seq: integer('seq').notNull(),
    nodeId: text('node_id').notNull(),
    nodeType: text('node_type').notNull(),
    status: text('status', { enum: ['running', 'waiting', 'retrying', 'succeeded', 'failed'] }).notNull(),
    /** Попытка выполнения (растёт при повторах временной ошибки) */
    attempt: integer('attempt').notNull().default(1),
    /** Параметры узла после подстановок */
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb('output').$type<Record<string, unknown>>(),
    error: text('error'),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.runId], foreignColumns: [flowRuns.workspaceId, flowRuns.id], name: 'flow_run_steps_run_fk' }).onDelete('cascade'),
    check('flow_run_steps_status_chk', sql`${t.status} in ('running','waiting','retrying','succeeded','failed')`),
    index('flow_run_steps_run_idx').on(t.runId, t.seq),
  ],
);
