/* Исходящие подписки и журнал доставок, связанные с outbox в пределах одного арендатора. */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './columns';
import { events } from './system';
import { wsCol } from './tenant';

export const webhooks = pgTable('webhooks', {
  id: pk(), workspaceId: wsCol(), url: text('url').notNull(), secret: text('secret').notNull(),
  events: text('events').array().notNull(), enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [
  unique('webhooks_ws_id_uq').on(t.workspaceId, t.id),
  check('webhooks_url_chk', sql`char_length(${t.url}) between 1 and 2048`),
  check('webhooks_secret_chk', sql`char_length(${t.secret}) between 1 and 512`),
  check('webhooks_events_chk', sql`cardinality(${t.events}) > 0`),
]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: pk(), workspaceId: wsCol(), webhookId: uuid('webhook_id').notNull(), eventId: uuid('event_id').notNull(),
  status: text('status', { enum: ['queued', 'delivered', 'failed'] }).notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0), responseStatus: integer('response_status'), lastError: text('last_error'),
  nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(), createdAt: createdAt(), deliveredAt: ts('delivered_at'),
}, t => [
  unique('webhook_deliveries_ws_id_uq').on(t.workspaceId, t.id),
  unique('webhook_deliveries_event_uq').on(t.workspaceId, t.webhookId, t.eventId),
  foreignKey({ columns: [t.workspaceId, t.webhookId], foreignColumns: [webhooks.workspaceId, webhooks.id], name: 'webhook_deliveries_webhook_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.workspaceId, t.eventId], foreignColumns: [events.workspaceId, events.id], name: 'webhook_deliveries_event_fk' }).onDelete('cascade'),
  check('webhook_deliveries_status_chk', sql`${t.status} in ('queued', 'delivered', 'failed')`),
  check('webhook_deliveries_attempts_chk', sql`${t.attempts} >= 0`),
  index('webhook_deliveries_queue_idx').on(t.nextAttemptAt, t.id).where(sql`${t.status} = 'queued'`),
]);
