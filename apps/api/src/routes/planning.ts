/* Планирование загрузки: сменные графики, праздники, исключения, справочник ключевых ресурсов, потребность в
   ресурсах (норматив и закладка «Ресурсы» документа), расчёт загрузки и перегрузки.
   Чтение — любой участник, справочники — admin и выше, план — member и выше. Правила — packages/db/src/planning.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  addException,
  archiveCalendar,
  archiveResource,
  listCalendars,
  listDocumentResources,
  listExceptions,
  listHolidays,
  listProductResources,
  listResources,
  moveOperation,
  removeException,
  removeHoliday,
  saveCalendar,
  saveResource,
  setDocumentResources,
  setHoliday,
  setProductResources,
  workspaceLoad,
} from '@gr8r/db';
import {
  calendarExceptionInput,
  documentResourcesSet,
  holidayInput,
  idParam,
  loadQuery,
  moveOperationInput,
  productResourcesSet,
  resourceCreate,
  resourceUpdate,
  workCalendarCreate,
  workCalendarUpdate,
} from '@gr8r/shared';
import { z } from 'zod';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

/** Параметр «дата» — праздник */
const dateParam = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export const planningRoutes = new Hono<AppEnv>()
  /* ---------------- сменные графики ---------------- */
  .get('/calendars', async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listCalendars(ctx.db, ctx.workspaceId) });
  })
  .post('/calendars', admin, zValidator('json', workCalendarCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await saveCalendar(ctx.db, docCtx(ctx), {
      ...(body.id ? { id: body.id } : {}),
      name: body.name,
      kind: body.kind,
      pattern: body.pattern,
      cycleStart: body.cycleStart ?? null,
      hoursPerDay: body.hoursPerDay,
      isDefault: body.isDefault,
      note: body.note,
    });
    const items = await listCalendars(ctx.db, ctx.workspaceId);
    return c.json(items.find(x => x.id === id), 201);
  })
  .patch('/calendars/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', workCalendarUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = c.req.valid('param').id;
    const current = (await listCalendars(ctx.db, ctx.workspaceId, true)).find(x => x.id === id);
    if (!current) return c.json({ error: { code: 'not_found', message: 'The work calendar does not exist' } }, 404);
    await saveCalendar(ctx.db, docCtx(ctx), {
      id,
      name: body.name ?? current.name,
      kind: body.kind ?? current.kind,
      pattern: body.pattern ?? (current.pattern as Record<string, unknown>),
      cycleStart: body.cycleStart === undefined ? current.cycleStart : body.cycleStart,
      hoursPerDay: body.hoursPerDay ?? current.hoursPerDay,
      isDefault: body.isDefault ?? current.isDefault,
      note: body.note ?? current.note,
    });
    const items = await listCalendars(ctx.db, ctx.workspaceId);
    return c.json(items.find(x => x.id === id));
  })
  .delete('/calendars/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await archiveCalendar(ctx.db, docCtx(ctx), id);
    return c.json({ id, deleted: true as const });
  })
  /* ---------------- праздники воркспейса ---------------- */
  .get('/holidays', async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listHolidays(ctx.db, ctx.workspaceId) });
  })
  .post('/holidays', admin, zValidator('json', holidayInput, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await setHoliday(ctx.db, docCtx(ctx), body.date, body.name);
    return c.json({ date: body.date, name: body.name });
  })
  .delete('/holidays/:date', admin, zValidator('param', dateParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await removeHoliday(ctx.db, docCtx(ctx), c.req.valid('param').date);
    return c.json({ deleted: true as const });
  })
  /* ---------------- исключения из графика ---------------- */
  .get('/calendar-exceptions', async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listExceptions(ctx.db, ctx.workspaceId) });
  })
  .post('/calendar-exceptions', admin, zValidator('json', calendarExceptionInput, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await addException(ctx.db, docCtx(ctx), body);
    return c.json({ id }, 201);
  })
  .delete('/calendar-exceptions/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await removeException(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json({ deleted: true as const });
  })
  /* ---------------- справочник ключевых ресурсов ---------------- */
  .get('/resources', async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listResources(ctx.db, ctx.workspaceId) });
  })
  .post('/resources', admin, zValidator('json', resourceCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await saveResource(ctx.db, docCtx(ctx), {
      ...(body.id ? { id: body.id } : {}),
      name: body.name,
      code: body.code,
      kind: body.kind,
      workCenterId: body.workCenterId ?? null,
      capacityUnits: body.capacityUnits,
      calendarId: body.calendarId ?? null,
      note: body.note,
    });
    const items = await listResources(ctx.db, ctx.workspaceId);
    return c.json(items.find(x => x.id === id), 201);
  })
  .patch('/resources/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', resourceUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = c.req.valid('param').id;
    const current = (await listResources(ctx.db, ctx.workspaceId, true)).find(x => x.id === id);
    if (!current) return c.json({ error: { code: 'not_found', message: 'The resource does not exist' } }, 404);
    await saveResource(ctx.db, docCtx(ctx), {
      id,
      name: body.name ?? current.name,
      code: body.code ?? current.code,
      kind: body.kind ?? current.kind,
      workCenterId: body.workCenterId === undefined ? current.workCenterId : body.workCenterId,
      capacityUnits: body.capacityUnits ?? current.capacityUnits,
      calendarId: body.calendarId === undefined ? current.calendarId : body.calendarId,
      note: body.note ?? current.note,
    });
    const items = await listResources(ctx.db, ctx.workspaceId);
    return c.json(items.find(x => x.id === id));
  })
  .delete('/resources/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await archiveResource(ctx.db, docCtx(ctx), id);
    return c.json({ id, deleted: true as const });
  })
  /* ---------------- потребность в ресурсах ---------------- */
  // норматив: какие ресурсы нужны операции или работе и сколько часов на единицу
  .get('/product-resources', async c => {
    const ctx = ctxOf(c);
    const productId = c.req.query('productId');
    if (!productId) return c.json({ error: { code: 'validation_error', message: 'productId is required' } }, 422);
    return c.json({ items: await listProductResources(ctx.db, productId) });
  })
  .put('/product-resources', admin, zValidator('json', productResourcesSet, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await setProductResources(ctx.db, docCtx(ctx), body.productId, body.resources);
    return c.json({ items: await listProductResources(ctx.db, body.productId) });
  })
  // закладка «Ресурсы» документа: заказ на производство, заказ-наряд
  .get('/document-resources', async c => {
    const ctx = ctxOf(c);
    const documentId = c.req.query('documentId');
    if (!documentId) return c.json({ error: { code: 'validation_error', message: 'documentId is required' } }, 422);
    return c.json({ items: await listDocumentResources(ctx.db, documentId) });
  })
  .put('/document-resources', write, zValidator('json', documentResourcesSet, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await setDocumentResources(ctx.db, docCtx(ctx), body.documentId, body.items);
    return c.json({ items: await listDocumentResources(ctx.db, body.documentId) });
  })
  /* ---------------- загрузка ---------------- */
  .get('/load', zValidator('query', loadQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const load = await workspaceLoad(ctx.db, ctx.workspaceId, { from: q.from, to: q.to, rowType: q.rowType });
    return c.json({ rows: load.result, entries: load.entries, holidays: load.holidays });
  })
  /* ---------------- сдвиг операции в планировщике ---------------- */
  .patch('/operations/:id/move', write, zValidator('param', idParam, validationHook), zValidator('json', moveOperationInput, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await moveOperation(ctx.db, docCtx(ctx), c.req.valid('param').id, body);
    return c.json({ id: c.req.valid('param').id, ...body });
  });
