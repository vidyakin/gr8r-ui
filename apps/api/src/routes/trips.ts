/* Рейсы (задача 1211, docs/architecture/trips.md): рейсы, точки в порядке объезда, статусы, путевой лист из рейса, экран диспетчера,
   маршрутный лист рейса. Правила — packages/db/src/trips.ts. Читает любой участник, правит member и выше, настройку вместимости — admin и owner. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  addStop,
  cancelTrip,
  completeTrip,
  createTrip,
  createTripWaybill,
  deleteTrip,
  dispatchBoard,
  ensureTransportWaybill,
  getTransportWaybill,
  getTrip,
  transportWaybillPrintData,
  getRun,
  listRuns,
  routingView,
  saveRoutingSettings,
  startDistribute,
  startOptimize,
  listTrips,
  removeStop,
  reorderStops,
  saveTripSettings,
  setStopStatus,
  recordDriverStopEvent,
  driverTripsForDate,
  startTrip,
  tripCapacityMode,
  tripPrintData,
  updateStop,
  updateTrip,
} from '@gr8r/db';
import { driverStopEvent, dispatchQuery, idParam, renderRouteSheet, renderTransportWaybill, routingDistribute, routingOptimize, routingSettingsSave, tnCreate, tripAddDelivery, tripQuery, tripSave, tripSettingsSave, tripStopOrder, tripStopSave, tripStopStatus, tripStopUpdate, tripUpdate } from '@gr8r/shared';
import { documentExports, jobs } from '@gr8r/db';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../errors';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });
const stopParam = z.object({ id: z.uuid(), stopId: z.uuid() });
const ok = { ok: true } as const;

export const tripRoutes = new Hono<AppEnv>()
  .get('/driver/mine', zValidator('query', z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await driverTripsForDate(ctx.db, docCtx(ctx), c.req.valid('query').date) });
  })
  .post('/driver/:id/stops/:stopId/events', write, zValidator('param', stopParam, validationHook), zValidator('json', driverStopEvent, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, stopId } = c.req.valid('param');
    return c.json(await recordDriverStopEvent(ctx.db, docCtx(ctx), id, stopId, c.req.valid('json')));
  })
  .get('/settings', async c => c.json({ capacityMode: await tripCapacityMode(ctxOf(c).db, ctxOf(c).workspaceId) }))
  // транспортная накладная (1214): выдать номер (повторно — тот же), HTML-страница, PDF задачей воркеру
  .post('/tn', write, zValidator('json', tnCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await ensureTransportWaybill(ctx.db, docCtx(ctx), c.req.valid('json')));
  })
  .get('/tn/:id', zValidator('param', idParam, validationHook), async c => c.json(await getTransportWaybill(ctxOf(c).db, c.req.valid('param').id)))
  .get('/tn/:id/print', zValidator('param', idParam, validationHook), async c => {
    const data = await transportWaybillPrintData(ctxOf(c).db, c.req.valid('param').id);
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderTransportWaybill(data));
  })
  .post('/tn/:id/pdf', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const w = await getTransportWaybill(ctx.db, c.req.valid('param').id);
    const [row] = await ctx.db.insert(documentExports).values({ workspaceId: ctx.workspaceId, name: `TN-${w.number.replace(/\D+/g, '')}.pdf`, contentType: 'application/pdf', requestedBy: ctx.memberId }).returning({ id: documentExports.id, name: documentExports.name, status: documentExports.status });
    await ctx.db.insert(jobs).values({ workspaceId: ctx.workspaceId, type: 'transport.waybill_pdf', payload: { exportId: row!.id, waybillId: w.id } });
    return c.json(row!, 202);
  })
  .get('/tn-files/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const [row] = await ctx.db.select().from(documentExports).where(and(eq(documentExports.id, c.req.valid('param').id), eq(documentExports.workspaceId, ctx.workspaceId), eq(documentExports.contentType, 'application/pdf'))).limit(1);
    if (!row) throw new AppError(404, 'not_found', 'File not found');
    if (c.req.query('download') !== '1') return c.json({ id: row.id, name: row.name, status: row.status, size: row.size, error: row.error });
    if (row.status !== 'ready' || !row.data) throw new AppError(409, 'not_ready', row.status === 'failed' ? `PDF generation failed: ${row.error}` : 'The PDF is not ready yet');
    return new Response(new Uint8Array(row.data), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${row.name}"`, 'content-length': String(row.data.length), 'x-content-type-options': 'nosniff' } });
  })
  .put('/settings', requireRole('admin'), zValidator('json', tripSettingsSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await saveTripSettings(ctx.db, docCtx(ctx), c.req.valid('json').capacityMode));
  })
  /* маршрутизация (задача 1213): настройки провайдера, запуск «Распределить», запуски */
  .get('/routing', async c => {
    const ctx = ctxOf(c);
    return c.json(await routingView(ctx.db, ctx.workspaceId, ctx.role === 'admin' || ctx.role === 'owner'));
  })
  .put('/routing', requireRole('admin'), zValidator('json', routingSettingsSave, validationHook), async c => {
    const ctx = ctxOf(c);
    await saveRoutingSettings(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await routingView(ctx.db, ctx.workspaceId, true));
  })
  .post('/routing/distribute', write, zValidator('json', routingDistribute, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await startDistribute(ctx.db, docCtx(ctx), c.req.valid('json')), 202);
  })
  .get('/routing/runs', zValidator('query', z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), tripId: z.uuid().optional() }), validationHook), async c => c.json({ items: await listRuns(ctxOf(c).db, c.req.valid('query')) }))
  .get('/routing/runs/:id', zValidator('param', idParam, validationHook), async c => c.json(await getRun(ctxOf(c).db, c.req.valid('param').id)))
  .get('/dispatch', zValidator('query', dispatchQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await dispatchBoard(ctx.db, docCtx(ctx), c.req.valid('query').date));
  })
  .get('/', zValidator('query', tripQuery, validationHook), async c => c.json(await listTrips(ctxOf(c).db, c.req.valid('query'))))
  .post('/', write, zValidator('json', tripSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createTrip(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await getTrip(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', tripUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateTrip(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteTrip(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(ok);
  })
  .post('/:id/start', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await startTrip(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  .post('/:id/complete', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await completeTrip(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  .post('/:id/cancel', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await cancelTrip(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  .post('/:id/optimize', write, zValidator('param', idParam, validationHook), zValidator('json', routingOptimize, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await startOptimize(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json').reorder), 202);
  })
  .post('/:id/waybill', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createTripWaybill(ctx.db, docCtx(ctx), c.req.valid('param').id), 201);
  })
  /* точки */
  .post('/:id/stops', write, zValidator('param', idParam, validationHook), zValidator('json', tripStopSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await addStop(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')), 201);
  })
  // перетаскивание доставки в рейс (экран диспетчера)
  .post('/:id/deliveries', write, zValidator('param', idParam, validationHook), zValidator('json', tripAddDelivery, validationHook), async c => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    return c.json(await addStop(ctx.db, docCtx(ctx), c.req.valid('param').id, { sourceKind: 'delivery', deliveryId: b.deliveryId, ...(b.index !== undefined ? { index: b.index } : {}) }), 201);
  })
  .put('/:id/order', write, zValidator('param', idParam, validationHook), zValidator('json', tripStopOrder, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await reorderStops(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json').stopIds) });
  })
  .patch('/:id/stops/:stopId', write, zValidator('param', stopParam, validationHook), zValidator('json', tripStopUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const p = c.req.valid('param');
    return c.json(await updateStop(ctx.db, docCtx(ctx), p.id, p.stopId, c.req.valid('json')));
  })
  .delete('/:id/stops/:stopId', write, zValidator('param', stopParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const p = c.req.valid('param');
    await removeStop(ctx.db, docCtx(ctx), p.id, p.stopId);
    return c.json(ok);
  })
  .post('/:id/stops/:stopId/status', write, zValidator('param', stopParam, validationHook), zValidator('json', tripStopStatus, validationHook), async c => {
    const ctx = ctxOf(c);
    const p = c.req.valid('param');
    const b = c.req.valid('json');
    return c.json(await setStopStatus(ctx.db, docCtx(ctx), p.id, p.stopId, b.status, b.comment));
  })
  // маршрутный лист рейса: готовая HTML-страница (в интерфейсе — в iframe)
  .get('/:id/print', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const data = await tripPrintData(ctx.db, docCtx(ctx), c.req.valid('param').id);
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderRouteSheet(data));
  });
