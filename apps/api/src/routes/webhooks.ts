/* Управление исходящими вебхуками воркспейса и журналом доставок (задача 1392). Доступно только admin и owner. */
import { zValidator } from '@hono/zod-validator';
import { and, count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { events, webhookDeliveries, webhooks } from '@erp/db';
import { idParam, uuid, webhookCreate, webhookDeliveriesQuery, webhookUpdate } from '@erp/shared';
import { ctxOf, validationHook } from '../crud';
import { notFound } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const deliveryParam = z.object({ id: uuid, deliveryId: uuid });

function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return 'whsec_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export const webhookRoutes = new Hono<AppEnv>()
  .use('*', admin)
  .get('/', async c => {
    const ctx = ctxOf(c);
    const items = await ctx.db.select().from(webhooks).orderBy(desc(webhooks.createdAt));
    return c.json({ items });
  })
  .post('/', zValidator('json', webhookCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const secret = body.secret ?? generateWebhookSecret();
    const [row] = await ctx.db
      .insert(webhooks)
      .values({
        workspaceId: ctx.workspaceId,
        url: body.url,
        secret,
        events: [...new Set(body.events)],
        enabled: body.enabled,
      })
      .returning();
    return c.json(row!, 201);
  })
  .patch('/:id', zValidator('param', idParam, validationHook), zValidator('json', webhookUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const [existing] = await ctx.db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
    if (!existing) throw notFound('webhook');
    const set: Partial<typeof webhooks.$inferInsert> = { updatedAt: new Date() };
    if (body.url !== undefined) set.url = body.url;
    if (body.events !== undefined) set.events = [...new Set(body.events)];
    if (body.enabled !== undefined) set.enabled = body.enabled;
    if (body.rotateSecret) set.secret = generateWebhookSecret();
    const [row] = await ctx.db.update(webhooks).set(set).where(eq(webhooks.id, id)).returning();
    return c.json(row!);
  })
  .delete('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const [deleted] = await ctx.db.delete(webhooks).where(eq(webhooks.id, id)).returning({ id: webhooks.id });
    if (!deleted) throw notFound('webhook');
    return c.json({ id: deleted.id, deleted: true as const });
  })
  .get('/:id/deliveries', zValidator('param', idParam, validationHook), zValidator('query', webhookDeliveriesQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const q = c.req.valid('query');
    const [hook] = await ctx.db.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.id, id)).limit(1);
    if (!hook) throw notFound('webhook');
    const where = and(eq(webhookDeliveries.webhookId, id), q.status ? eq(webhookDeliveries.status, q.status) : undefined);
    const [{ n }] = await ctx.db.select({ n: count() }).from(webhookDeliveries).where(where);
    const rows = await ctx.db
      .select({
        id: webhookDeliveries.id,
        webhookId: webhookDeliveries.webhookId,
        eventId: webhookDeliveries.eventId,
        eventType: events.type,
        entity: events.entity,
        recordId: events.recordId,
        status: webhookDeliveries.status,
        attempts: webhookDeliveries.attempts,
        responseStatus: webhookDeliveries.responseStatus,
        lastError: webhookDeliveries.lastError,
        nextAttemptAt: webhookDeliveries.nextAttemptAt,
        createdAt: webhookDeliveries.createdAt,
        deliveredAt: webhookDeliveries.deliveredAt,
      })
      .from(webhookDeliveries)
      .innerJoin(events, eq(events.id, webhookDeliveries.eventId))
      .where(where)
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    return c.json({ items: rows, total: n, limit: q.limit, offset: q.offset });
  })
  .post('/:id/deliveries/:deliveryId/retry', zValidator('param', deliveryParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, deliveryId } = c.req.valid('param');
    const [row] = await ctx.db
      .update(webhookDeliveries)
      .set({
        status: 'queued',
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        responseStatus: null,
        deliveredAt: null,
      })
      .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.webhookId, id)))
      .returning();
    if (!row) throw notFound('webhook_delivery');
    return c.json(row);
  });
