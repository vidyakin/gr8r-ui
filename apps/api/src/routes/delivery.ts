/* Доставка (задача 1100, docs/architecture/delivery.md): способы доставки (правят admin и owner), доставка документа,
   список и «мои доставки», статусы и назначение, отчёт, маршрутный лист. Курьер-участник (members.is_courier, роль ниже admin)
   видит и меняет только свои доставки и только их статусы. Правила — packages/db/src/delivery.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  addDeliveryToDocument,
  archiveDeliveryMethod,
  assignCourier,
  changeDeliveryStatus,
  courierScope,
  createDeliveryMethod,
  deleteDelivery,
  deliveryOfDocument,
  deliveryReport,
  getDeliveryView,
  listCouriers,
  listDeliveries,
  listDeliveryMethods,
  myDeliveries,
  routeSheet,
  saveDelivery,
  setCourierFlag,
  updateDeliveryMethod,
} from '@gr8r/db';
import { courierFlag, deliveryAssign, deliveryMethodQuery, deliveryMethodSave, deliveryMethodUpdate, deliveryQuery, deliveryReportQuery, deliverySave, deliveryStatusChange, idParam, isoDate, renderRouteSheet } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { forbidden } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const admin = requireRole('admin');
const today = () => new Date().toISOString().slice(0, 10);
const docCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });

/** Курьеру-участнику правка доставок, назначение и отчёты недоступны */
async function notCourier(c: ReturnType<typeof ctxOf>): Promise<void> {
  if (await courierScope(c.db, docCtx(c))) throw forbidden('A courier can work with their own deliveries only');
}

export const deliveryMethodRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', deliveryMethodQuery, validationHook), async c => c.json({ items: await listDeliveryMethods(ctxOf(c).db, c.req.valid('query').archived) }))
  .post('/', admin, zValidator('json', deliveryMethodSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createDeliveryMethod(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .patch('/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', deliveryMethodUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateDeliveryMethod(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .post('/:id/archive', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await archiveDeliveryMethod(ctx.db, docCtx(ctx), c.req.valid('param').id, true);
    return c.json({ ok: true });
  })
  .post('/:id/restore', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await archiveDeliveryMethod(ctx.db, docCtx(ctx), c.req.valid('param').id, false);
    return c.json({ ok: true });
  });

const dateQuery = z.object({ date: isoDate.optional() });
const routeQuery = z.object({ courierId: z.uuid().optional(), date: isoDate.optional() });

export const deliveryRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', deliveryQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await listDeliveries(ctx.db, docCtx(ctx), c.req.valid('query')));
  })
  // «мои доставки»: назначенные текущему участнику на день (по умолчанию сегодня)
  .get('/mine', zValidator('query', dateQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await myDeliveries(ctx.db, docCtx(ctx), c.req.valid('query').date ?? today()));
  })
  .get('/couriers', async c => c.json({ items: await listCouriers(ctxOf(c).db) }))
  .put('/couriers/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', courierFlag, validationHook), async c => {
    const ctx = ctxOf(c);
    await setCourierFlag(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json').isCourier);
    return c.json({ ok: true });
  })
  .get('/report', write, zValidator('query', deliveryReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    await notCourier(ctx);
    return c.json(await deliveryReport(ctx.db, docCtx(ctx), c.req.valid('query')));
  })
  // маршрутный лист: данные и готовая страница для печати
  .get('/route-sheet', zValidator('query', routeQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const courierId = q.courierId ?? ctx.memberId;
    const data = await routeSheet(ctx.db, docCtx(ctx), courierId, q.date ?? today());
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderRouteSheet(data));
  })
  .get('/by-document/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await deliveryOfDocument(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  .put('/by-document/:id', write, zValidator('param', idParam, validationHook), zValidator('json', deliverySave, validationHook), async c => {
    const ctx = ctxOf(c);
    await notCourier(ctx);
    const row = await saveDelivery(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json'));
    return c.json(await getDeliveryView(ctx.db, docCtx(ctx), row.id));
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await getDeliveryView(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await notCourier(ctx);
    await deleteDelivery(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json({ ok: true });
  })
  .post('/:id/status', write, zValidator('param', idParam, validationHook), zValidator('json', deliveryStatusChange, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await changeDeliveryStatus(ctx.db, docCtx(ctx), id, body.status, body.comment);
    return c.json(await getDeliveryView(ctx.db, docCtx(ctx), id));
  })
  .post('/:id/assign', write, zValidator('param', idParam, validationHook), zValidator('json', deliveryAssign, validationHook), async c => {
    const ctx = ctxOf(c);
    await notCourier(ctx);
    const { id } = c.req.valid('param');
    await assignCourier(ctx.db, docCtx(ctx), id, c.req.valid('json').courierMemberId);
    return c.json(await getDeliveryView(ctx.db, docCtx(ctx), id));
  })
  .post('/:id/add-to-document', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await notCourier(ctx);
    const { id } = c.req.valid('param');
    await addDeliveryToDocument(ctx.db, docCtx(ctx), id);
    return c.json(await getDeliveryView(ctx.db, docCtx(ctx), id));
  });
