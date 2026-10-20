/* Журнал событий (outbox) и очередь фоновых задач. */
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts } from './columns';
import { wsCol } from './people';

/** Outbox: любое изменение пишет строку в той же транзакции. Из неё питаются realtime, активность,
    уведомления и автоматизации. processed_at ставит воркер (SKIP LOCKED), поэтому порядок коммитов не важен. */
export const events = pgTable(
  'events',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** 'task.created', 'deal.updated' … */
    type: text('type').notNull(),
    entity: text('entity').notNull(),
    recordId: uuid('record_id'),
    /** members.id инициатора (без FK: событие переживает участника) */
    actorId: uuid('actor_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    processedAt: ts('processed_at'),
  },
  t => [
    index('events_ws_id_idx').on(t.workspaceId, t.id),
    index('events_unprocessed_idx').on(t.id).where(sql`${t.processedAt} is null`),
  ],
);

/** Очередь фоновых задач: воркер берёт строки через FOR UPDATE SKIP LOCKED */
export const jobs = pgTable(
  'jobs',
  {
    id: pk(),
    workspaceId: wsCol(),
    queue: text('queue').notNull().default('default'),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] }).notNull().default('queued'),
    runAt: ts('run_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedAt: ts('locked_at'),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  t => [
    check('jobs_status_chk', sql`${t.status} in ('queued','running','done','failed')`),
    index('jobs_claim_idx').on(t.queue, t.runAt).where(sql`${t.status} = 'queued'`),
  ],
);
