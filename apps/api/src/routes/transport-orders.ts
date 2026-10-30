/* Заявки на перевозку, тарифы по направлениям и экспедирование (задача 1223, docs/architecture/transport-orders.md).
   Правила — packages/db/src/transport-orders.ts. Читает любой участник, правит member и выше. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  addFleetTripCost,
  archiveRateSchedule,
  attachTransportOrderToTrip,
  billTransportOrder,
  carrierContractPrintData,
  createRateSchedule,
  createTransportOrder,
  deleteFleetTripCarrier,
  deleteFleetTripCost,
  deleteTransportOrder,
  getFleetTripCarrier,
  listFleetTripCosts,
  listOrderPoints,
  listRateSchedules,
  listTransportOrders,
  loadTransportOrder,
  saveFleetTripCarrier,
  setTransportOrderStatus,
  suggestRateSchedule,
  tripMargin,
  updateFleetTripCost,
  updateRateSchedule,
  updateTransportOrder,
} from '@gr8r/db';
import {
  fleetTripCarrierSave,
  fleetTripCarrierUpdate,
  fleetTripCostSave,
  fleetTripCostUpdate,
  idParam,
  queryBool,
  rateScheduleQuery,
  rateScheduleSave,
  rateScheduleUpdate,
  renderCarrierContract,
  transportOrderBilling,
  transportOrderQuery,
  transportOrderSave,
  transportOrderStatusChange,
  transportOrderToTrip,
  transportOrderUpdate,
} from '@gr8r/shared';
import { z } from 'zod';
import { AppError } from '../errors';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });
const ok = { ok: true } as const;
const tripIdParam = z.object({ id: z.uuid() });
const costIdParam = z.object({ id: z.uuid(), costId: z.uuid() });

export const transportOrderRoutes = new Hono<AppEnv>()
  /* тарифы по направлениям */
  .get('/rate-schedules', zValidator('query', rateScheduleQuery, validationHook), async c => c.json({ items: await listRateSchedules(ctxOf(c).db, c.req.valid('query')) }))
  .get('/rate-schedules/suggest', zValidator('query', z.object({ fromPlace: z.string().trim().min(1), toPlace: z.string().trim().min(1), bodyType: z.string().trim().optional() }), validationHook), async c => {
    const item = await suggestRateSchedule(ctxOf(c).db, c.req.valid('query'));
    return c.json({ item });
  })
  .post('/rate-schedules', write, zValidator('json', rateScheduleSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createRateSchedule(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .patch('/rate-schedules/:id', write, zValidator('param', idParam, validationHook), zValidator('json', rateScheduleUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateRateSchedule(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .post('/rate-schedules/:id/archive', write, zValidator('param', idParam, validationHook), zValidator('query', z.object({ archived: queryBool.optional() }), validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await archiveRateSchedule(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('query').archived ?? true));
  })
  /* заявки на перевозку */
  .get('/', zValidator('query', transportOrderQuery, validationHook), async c => c.json({ items: await listTransportOrders(ctxOf(c).db, c.req.valid('query')) }))
  .post('/', write, zValidator('json', transportOrderSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createTransportOrder(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const db = ctxOf(c).db;
    const order = await loadTransportOrder(db, c.req.valid('param').id);
    const points = await listOrderPoints(db, order.id);
    return c.json({ ...order, points });
  })
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', transportOrderUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateTransportOrder(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteTransportOrder(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(ok);
  })
  .post('/:id/status', write, zValidator('param', idParam, validationHook), zValidator('json', transportOrderStatusChange, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await setTransportOrderStatus(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json').status));
  })
  .post('/:id/trip', write, zValidator('param', idParam, validationHook), zValidator('json', transportOrderToTrip, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await attachTransportOrderToTrip(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json').tripId));
  })
  .post('/:id/invoice', write, zValidator('param', idParam, validationHook), zValidator('json', transportOrderBilling, validationHook), async c => {
    const ctx = ctxOf(c);
    const documentId = await billTransportOrder(ctx.db, docCtx(ctx), c.req.valid('param').id, 'invoice', c.req.valid('json').productId);
    return c.json({ documentId }, 201);
  })
  .post('/:id/act', write, zValidator('param', idParam, validationHook), zValidator('json', transportOrderBilling, validationHook), async c => {
    const ctx = ctxOf(c);
    const documentId = await billTransportOrder(ctx.db, docCtx(ctx), c.req.valid('param').id, 'act', c.req.valid('json').productId);
    return c.json({ documentId }, 201);
  })
  /* экспедирование: наём перевозчика и маржа рейса (путь — через рейс, не через заявку) */
  .get('/trips/:id/carrier', zValidator('param', tripIdParam, validationHook), async c => c.json({ item: await getFleetTripCarrier(ctxOf(c).db, c.req.valid('param').id) }))
  .put('/trips/:id/carrier', write, zValidator('param', tripIdParam, validationHook), zValidator('json', fleetTripCarrierSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await saveFleetTripCarrier(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .patch('/trips/:id/carrier', write, zValidator('param', tripIdParam, validationHook), zValidator('json', fleetTripCarrierUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const cur = await getFleetTripCarrier(ctx.db, c.req.valid('param').id);
    if (!cur) throw new AppError(404, 'not_found', 'The carrier is not assigned to this trip');
    return c.json(await saveFleetTripCarrier(ctx.db, docCtx(ctx), c.req.valid('param').id, { ...cur, ...c.req.valid('json') }));
  })
  .delete('/trips/:id/carrier', write, zValidator('param', tripIdParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteFleetTripCarrier(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(ok);
  })
  .get('/trips/:id/costs', zValidator('param', tripIdParam, validationHook), async c => c.json({ items: await listFleetTripCosts(ctxOf(c).db, c.req.valid('param').id) }))
  .post('/trips/:id/costs', write, zValidator('param', tripIdParam, validationHook), zValidator('json', fleetTripCostSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await addFleetTripCost(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')), 201);
  })
  .patch('/trips/:id/costs/:costId', write, zValidator('param', costIdParam, validationHook), zValidator('json', fleetTripCostUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateFleetTripCost(ctx.db, docCtx(ctx), c.req.valid('param').costId, c.req.valid('json')));
  })
  .delete('/trips/:id/costs/:costId', write, zValidator('param', costIdParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteFleetTripCost(ctx.db, docCtx(ctx), c.req.valid('param').costId);
    return c.json(ok);
  })
  .get('/trips/:id/margin', zValidator('param', tripIdParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await tripMargin(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  // договор-заявка наёмному перевозчику (задача 1223): готовая HTML-страница
  .get('/trips/:id/contract/print', zValidator('param', tripIdParam, validationHook), async c => {
    const data = await carrierContractPrintData(ctxOf(c).db, c.req.valid('param').id);
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderCarrierContract(data));
  });
