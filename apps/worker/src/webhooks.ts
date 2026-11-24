/* Очередь и доставка исходящих вебхуков (задача 1392): outbox → webhook_deliveries → POST с HMAC-SHA256 и ретраями. */
import { and, eq, sql as dsql } from 'drizzle-orm';
import { webhookDeliveries, webhooks, withContext, type Db, type Sql } from '@erp/db';
import { webhookMatchesEvent } from '@erp/shared';
import type { EventRow } from './handlers';
import { sendWebhook } from './webhook-http';
import type { WorkerOptions } from './worker';

export const WEBHOOK_MAX_ATTEMPTS = 5;

export const webhookBackoffSec = (attempt: number): number => Math.min(3600, 10 * 2 ** Math.max(0, attempt - 1));

export interface WebhookEventPayload {
  id: string;
  workspaceId: string;
  type: string;
  entity: string;
  recordId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date | string;
}

export function buildWebhookBody(ev: WebhookEventPayload): string {
  return JSON.stringify({
    id: ev.id,
    type: ev.type,
    entity: ev.entity,
    recordId: ev.recordId,
    workspaceId: ev.workspaceId,
    actorId: ev.actorId,
    createdAt: ev.createdAt instanceof Date ? ev.createdAt.toISOString() : ev.createdAt,
    data: ev.payload ?? {},
  });
}

/** Подбирает включённые подписки воркспейса для события outbox и ставит доставки в очередь (идемпотентно). */
export async function enqueueWebhooksForEvent(db: Db, event: EventRow): Promise<number> {
  const subs = await db
    .select({ id: webhooks.id, events: webhooks.events })
    .from(webhooks)
    .where(and(eq(webhooks.workspaceId, event.workspaceId), eq(webhooks.enabled, true)));
  const matched = subs.filter(s => webhookMatchesEvent(s.events, event.type));
  if (!matched.length) return 0;
  await db
    .insert(webhookDeliveries)
    .values(matched.map(s => ({ workspaceId: event.workspaceId, webhookId: s.id, eventId: event.id, status: 'queued' as const, attempts: 0 })))
    .onConflictDoNothing();
  return matched.length;
}

interface ClaimedDelivery {
  id: string;
  workspaceId: string;
  attempts: number;
  url: string;
  secret: string;
  enabled: boolean;
  eventId: string;
  eventType: string;
  eventEntity: string;
  recordId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  eventCreatedAt: Date | string;
}

export interface DeliveryOutcome {
  ok: boolean;
  status: number | null;
  error: string | null;
}

export async function deliverOnce(
  row: Pick<ClaimedDelivery, 'url' | 'secret' | 'workspaceId' | 'eventId' | 'eventType' | 'eventEntity' | 'recordId' | 'actorId' | 'payload' | 'eventCreatedAt'>,
  sender: typeof sendWebhook = sendWebhook,
): Promise<DeliveryOutcome> {
  const body = buildWebhookBody({
    id: row.eventId,
    workspaceId: row.workspaceId,
    type: row.eventType,
    entity: row.eventEntity,
    recordId: row.recordId,
    actorId: row.actorId,
    payload: row.payload,
    createdAt: row.eventCreatedAt,
  });
  try {
    const res = await sender(row.url, row.secret, body);
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, error: null };
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: null, error: (e instanceof Error ? e.message : String(e)).slice(0, 1000) };
  }
}

/** Один проход доставки вебхуков: захватывает готовые строки через SKIP LOCKED, шлёт POST вне транзакции, фиксирует результат. */
export async function processWebhookDeliveriesOnce(
  sql: Sql,
  o: Pick<WorkerOptions, 'log'>,
  batch = 20,
  maxAttempts = WEBHOOK_MAX_ATTEMPTS,
  sender: typeof sendWebhook = sendWebhook,
): Promise<number> {
  const claimed = await withContext(
    sql,
    {},
    async db =>
      (await db.execute(dsql`
        with picked as (
          select d.id from webhook_deliveries d
          where d.status = 'queued' and d.next_attempt_at <= now()
          order by d.next_attempt_at, d.id
          for update skip locked
          limit ${batch}
        )
        update webhook_deliveries d
        set attempts = d.attempts + 1, next_attempt_at = now() + interval '5 minutes'
        from picked, webhooks w, events e
        where d.id = picked.id and w.id = d.webhook_id and e.id = d.event_id
        returning d.id, d.workspace_id as "workspaceId", d.attempts, w.url, w.secret, w.enabled,
                  e.id as "eventId", e.type as "eventType", e.entity as "eventEntity",
                  e.record_id as "recordId", e.actor_id as "actorId", e.payload, e.created_at as "eventCreatedAt"
      `)) as unknown as ClaimedDelivery[],
    'app_worker',
  );
  if (!claimed.length) return 0;

  await Promise.all(
    claimed.map(async row => {
      if (!row.enabled) {
        await withContext(
          sql,
          {},
          db => db.execute(dsql`update webhook_deliveries set status = 'failed', last_error = 'Webhook is disabled' where id = ${row.id}`),
          'app_worker',
        );
        return;
      }
      const res = await deliverOnce(row, sender);
      if (res.ok) {
        await withContext(
          sql,
          {},
          db => db.execute(dsql`update webhook_deliveries set status = 'delivered', response_status = ${res.status}, last_error = null, delivered_at = now() where id = ${row.id}`),
          'app_worker',
        );
        return;
      }
      const final = row.attempts >= maxAttempts;
      const delay = webhookBackoffSec(row.attempts);
      o.log(`webhook delivery ${row.id} failed [attempt ${row.attempts}/${maxAttempts}]: ${res.error}`);
      await withContext(
        sql,
        {},
        db =>
          db.execute(dsql`
            update webhook_deliveries
            set status = ${final ? 'failed' : 'queued'},
                response_status = ${res.status},
                last_error = ${res.error},
                next_attempt_at = now() + make_interval(secs => ${delay})
            where id = ${row.id}
          `),
        'app_worker',
      );
    }),
  );
  return claimed.length;
}
