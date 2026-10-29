/* Автопарк (задача 1210, docs/architecture/fleet.md): машины, водители, документы со сроками, путевые листы (и печать), топливо
   (в том числе загрузка выписки CSV), регламент ТО, ремонты, штрафы, затраты на машины. Правила — packages/db/src/fleet.ts.
   Читает любой участник, правит member и выше, затраты видят admin и owner. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  archiveFuelCard,
  archiveServicePlan,
  archiveVehicle,
  cancelWaybill,
  closeWaybill,
  createFine,
  createFleetDocument,
  createRepair,
  createServicePlan,
  createVehicle,
  createWaybill,
  createFuelEntry,
  deleteFine,
  deleteFleetDocument,
  deleteFuelEntry,
  deleteRepair,
  deleteWaybill,
  fleetCosts,
  fleetSummary,
  getRepair,
  getVehicle,
  getWaybill,
  importFuelCsv,
  issueWaybill,
  listDrivers,
  listFines,
  listFleetDocuments,
  listFuelCards,
  listFuelEntries,
  listRepairs,
  listServicePlans,
  listVehicles,
  listWaybills,
  postRepair,
  saveDriverProfile,
  saveFuelCard,
  unpostRepair,
  updateFine,
  updateFleetDocument,
  updateFuelEntry,
  updateRepair,
  updateServicePlan,
  updateVehicle,
  updateWaybill,
  waybillPrintData,
} from '@gr8r/db';
import {
  driverProfileSave,
  fineQuery,
  fineSave,
  fineUpdate,
  fleetCostsQuery,
  fleetDocumentQuery,
  fleetDocumentSave,
  fleetDocumentUpdate,
  fuelCardSave,
  fuelCardUpdate,
  fuelEntrySave,
  fuelEntryUpdate,
  fuelImport,
  fuelQuery,
  idParam,
  renderWaybill,
  repairQuery,
  repairSave,
  repairUpdate,
  servicePlanSave,
  servicePlanUpdate,
  vehicleQuery,
  vehicleSave,
  vehicleUpdate,
  waybillQuery,
  waybillSave,
  waybillUpdate,
} from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });
const memberParam = z.object({ memberId: z.uuid() });
const vehicleFilter = z.object({ vehicleId: z.uuid().optional() });
const ok = { ok: true } as const;

export const fleetRoutes = new Hono<AppEnv>()
  .get('/summary', async c => c.json(await fleetSummary(ctxOf(c).db)))
  /* машины */
  .get('/vehicles', zValidator('query', vehicleQuery, validationHook), async c => {
    const q = c.req.valid('query');
    const items = await listVehicles(ctxOf(c).db, q);
    return c.json({ items, total: items.length, limit: items.length, offset: 0 });
  })
  .post('/vehicles', write, zValidator('json', vehicleSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createVehicle(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .get('/vehicles/:id', zValidator('param', idParam, validationHook), async c => c.json(await getVehicle(ctxOf(c).db, c.req.valid('param').id)))
  .patch('/vehicles/:id', write, zValidator('param', idParam, validationHook), zValidator('json', vehicleUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateVehicle(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .post('/vehicles/:id/archive', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await archiveVehicle(ctx.db, docCtx(ctx), c.req.valid('param').id, true);
    return c.json(ok);
  })
  .post('/vehicles/:id/restore', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await archiveVehicle(ctx.db, docCtx(ctx), c.req.valid('param').id, false);
    return c.json(ok);
  })
  /* водители */
  .get('/drivers', async c => c.json({ items: await listDrivers(ctxOf(c).db) }))
  .put('/drivers/:memberId', write, zValidator('param', memberParam, validationHook), zValidator('json', driverProfileSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await saveDriverProfile(ctx.db, docCtx(ctx), c.req.valid('param').memberId, c.req.valid('json')));
  })
  /* документы со сроками */
  .get('/documents', zValidator('query', fleetDocumentQuery, validationHook), async c => {
    const items = await listFleetDocuments(ctxOf(c).db, c.req.valid('query'));
    return c.json({ items, total: items.length, limit: items.length, offset: 0 });
  })
  .post('/documents', write, zValidator('json', fleetDocumentSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createFleetDocument(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .patch('/documents/:id', write, zValidator('param', idParam, validationHook), zValidator('json', fleetDocumentUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateFleetDocument(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/documents/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteFleetDocument(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(ok);
  })
  /* путевые листы */
  .get('/waybills', zValidator('query', waybillQuery, validationHook), async c => c.json(await listWaybills(ctxOf(c).db, c.req.valid('query'))))
  .post('/waybills', write, zValidator('json', waybillSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createWaybill(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .get('/waybills/:id', zValidator('param', idParam, validationHook), async c => c.json(await getWaybill(ctxOf(c).db, c.req.valid('param').id)))
  .patch('/waybills/:id', write, zValidator('param', idParam, validationHook), zValidator('json', waybillUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateWaybill(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/waybills/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteWaybill(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(ok);
  })
  .post('/waybills/:id/issue', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await issueWaybill(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  .post('/waybills/:id/close', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await closeWaybill(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  .post('/waybills/:id/cancel', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await cancelWaybill(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  // печатная форма: готовая HTML-страница (в интерфейсе — в iframe), как маршрутный лист доставки
  .get('/waybills/:id/print', zValidator('param', idParam, validationHook), async c => {
    const data = await waybillPrintData(ctxOf(c).db, c.req.valid('param').id);
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderWaybill(data));
  })
  /* топливо */
  .get('/fuel-cards', async c => c.json({ items: await listFuelCards(ctxOf(c).db) }))
  .post('/fuel-cards', write, zValidator('json', fuelCardSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await saveFuelCard(ctx.db, docCtx(ctx), null, c.req.valid('json')), 201);
  })
  .patch('/fuel-cards/:id', write, zValidator('param', idParam, validationHook), zValidator('json', fuelCardUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await saveFuelCard(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/fuel-cards/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await archiveFuelCard(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(ok);
  })
  .get('/fuel', zValidator('query', fuelQuery, validationHook), async c => c.json(await listFuelEntries(ctxOf(c).db, c.req.valid('query'))))
  .post('/fuel', write, zValidator('json', fuelEntrySave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createFuelEntry(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .post('/fuel/import', write, zValidator('json', fuelImport, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    return c.json(await importFuelCsv(ctx.db, docCtx(ctx), body.csv, body.dryRun));
  })
  .patch('/fuel/:id', write, zValidator('param', idParam, validationHook), zValidator('json', fuelEntryUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateFuelEntry(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/fuel/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteFuelEntry(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(ok);
  })
  /* регламент ТО */
  .get('/service-plans', zValidator('query', vehicleFilter, validationHook), async c => c.json({ items: await listServicePlans(ctxOf(c).db, c.req.valid('query').vehicleId) }))
  .post('/service-plans', write, zValidator('json', servicePlanSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createServicePlan(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .patch('/service-plans/:id', write, zValidator('param', idParam, validationHook), zValidator('json', servicePlanUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateServicePlan(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/service-plans/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await archiveServicePlan(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(ok);
  })
  /* ТО и ремонты */
  .get('/repairs', zValidator('query', repairQuery, validationHook), async c => c.json(await listRepairs(ctxOf(c).db, c.req.valid('query'))))
  .post('/repairs', write, zValidator('json', repairSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createRepair(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .get('/repairs/:id', zValidator('param', idParam, validationHook), async c => c.json(await getRepair(ctxOf(c).db, c.req.valid('param').id)))
  .patch('/repairs/:id', write, zValidator('param', idParam, validationHook), zValidator('json', repairUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateRepair(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/repairs/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteRepair(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(ok);
  })
  .post('/repairs/:id/post', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await postRepair(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  .post('/repairs/:id/unpost', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await unpostRepair(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  /* штрафы */
  .get('/fines', zValidator('query', fineQuery, validationHook), async c => c.json(await listFines(ctxOf(c).db, c.req.valid('query'))))
  .post('/fines', write, zValidator('json', fineSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createFine(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .patch('/fines/:id', write, zValidator('param', idParam, validationHook), zValidator('json', fineUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateFine(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/fines/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteFine(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(ok);
  })
  /* затраты на машины */
  .get('/costs', requireRole('admin'), zValidator('query', fleetCostsQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await fleetCosts(ctx.db, docCtx(ctx), c.req.valid('query')));
  });
