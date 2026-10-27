/* Интеграции оплат (задача 1174д): подключения счетов к API банков и ЮКассе (только admin и owner), загрузка операций вручную
   (ставит задачу bank.sync — сеть ходит только воркер) и ссылки на онлайн-оплату счетов. Ключи — в хранилище секретов (/secrets). */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createPaymentLink, deleteConnection, enqueueBankSync, listConnections, listPaymentLinks, upsertConnection } from '@gr8r/db';
import { bankConnectionUpsert, connectionIdParam, paymentLinkCreate, paymentLinksQuery } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const write = requireRole('member');
const docCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });

export const bankConnectionRoutes = new Hono<AppEnv>()
  .get('/', admin, async c => c.json({ items: await listConnections(ctxOf(c).db) }))
  .put('/', admin, zValidator('json', bankConnectionUpsert, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ id: await upsertConnection(ctx.db, docCtx(ctx), c.req.valid('json')) });
  })
  .delete('/:id', admin, zValidator('param', connectionIdParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteConnection(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json({ ok: true });
  })
  // загрузка операций сейчас: задача уходит воркеру; false — такая уже стоит в очереди
  .post('/:id/sync', admin, zValidator('param', connectionIdParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ queued: await enqueueBankSync(ctx.db, ctx.workspaceId, c.req.valid('param').id) }, 202);
  });

export const paymentLinkRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', paymentLinksQuery, validationHook), async c => c.json({ items: await listPaymentLinks(ctxOf(c).db, c.req.valid('query').documentId) }))
  .post('/', write, zValidator('json', paymentLinkCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createPaymentLink(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  });
