/* Журнал событий (outbox). recordEvent вызывается в транзакции изменения: строка events коммитится вместе с данными,
   а pg_notify доставляется подписчикам только после коммита (откат транзакции отменяет и событие, и уведомление). */
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { events } from './schema';

export const EVENTS_CHANNEL = 'gr8r_events';

export interface NewEvent {
  workspaceId: string;
  type: string;
  entity: string;
  recordId?: string | null;
  actorId?: string | null;
  payload?: Record<string, unknown>;
}

/** Облегчённая версия события для рассылки: без payload (лимит NOTIFY — 8000 байт) */
export interface EventEnvelope {
  id: string;
  workspaceId: string;
  type: string;
  entity: string;
  recordId: string | null;
  actorId: string | null;
  createdAt: string;
}

export async function recordEvent(db: Db, e: NewEvent) {
  const [row] = await db
    .insert(events)
    .values({
      workspaceId: e.workspaceId,
      type: e.type,
      entity: e.entity,
      recordId: e.recordId ?? null,
      actorId: e.actorId ?? null,
      payload: e.payload ?? {},
    })
    .returning();
  const envelope: EventEnvelope = {
    id: row!.id,
    workspaceId: row!.workspaceId,
    type: row!.type,
    entity: row!.entity,
    recordId: row!.recordId,
    actorId: row!.actorId,
    createdAt: row!.createdAt.toISOString(),
  };
  await db.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(envelope)})`);
  return row!;
}

/** Пакет событий одним INSERT и одним NOTIFY-запросом (массовые операции: по одному событию на запись, но без запроса на каждое) */
export async function recordEvents(db: Db, list: NewEvent[]): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < list.length; i += CHUNK) {
    const rows = await db
      .insert(events)
      .values(list.slice(i, i + CHUNK).map(e => ({ workspaceId: e.workspaceId, type: e.type, entity: e.entity, recordId: e.recordId ?? null, actorId: e.actorId ?? null, payload: e.payload ?? {} })))
      .returning();
    const envelopes: EventEnvelope[] = rows.map(row => ({ id: row.id, workspaceId: row.workspaceId, type: row.type, entity: row.entity, recordId: row.recordId, actorId: row.actorId, createdAt: row.createdAt.toISOString() }));
    await db.execute(sql`select pg_notify(${EVENTS_CHANNEL}, e) from (values ${sql.join(envelopes.map(e => sql`(${JSON.stringify(e)}::text)`), sql`, `)}) as t(e)`);
  }
}
