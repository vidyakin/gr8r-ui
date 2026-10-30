/* Запись клиентов на приём (задача 1171): /appointments. Читают все, пишут member и выше; график правят admin/owner и сам специалист.
   Правила — packages/db/src/appointments.ts и @gr8r/shared (appointments). Документ дня — тип service_day, проведение общее (/documents не нужен). */
import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  appointmentDetail,
  createAppointment,
  createAppointmentClient,
  createAppointmentWorkOrder,
  createServiceDay,
  dayBoard,
  deleteDocument,
  deleteScheduleException,
  fillServiceDay,
  findFreeTime,
  listAppointments,
  listSpecialists,
  moveAppointment,
  postDocument,
  saveSchedule,
  saveScheduleException,
  scheduleView,
  serviceDayDetail,
  setAppointmentStatus,
  unclosedDays,
  unpostDocument,
  updateAppointment,
  updateServiceDay,
  weekBoard,
  workspaceTimeZone,
} from '@gr8r/db';
import {
  appointmentCancel,
  appointmentClientCreate,
  appointmentCreate,
  appointmentFreeQuery,
  appointmentListQuery,
  appointmentMove,
  appointmentUpdate,
  appointmentWeekQuery,
  dateInTimezone,
  idParam,
  scheduleExceptionUpdate,
  scheduleUpdate,
  serviceDayCreate,
  serviceDayUpdate,
  unclosedDaysQuery,
  isoDate,
  uuid,
} from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { AppError } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const member = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });
const memberParam = z.object({ memberId: uuid });
const exceptionParam = z.object({ memberId: uuid, date: isoDate });
const dayQuery = z.object({ date: isoDate });

/** График правят admin/owner и сам специалист */
function assertScheduleAccess(ctx: Ctx, memberId: string): void {
  if (ctx.role === 'owner' || ctx.role === 'admin' || ctx.memberId === memberId) return;
  throw new AppError(403, 'forbidden', 'Only an admin or the specialist can change this schedule');
}

export const appointmentRoutes = new Hono<AppEnv>()
  .get('/specialists', async c => c.json({ items: await listSpecialists(ctxOf(c).db) }))
  .get('/schedules/:memberId', zValidator('param', memberParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await scheduleView(ctx.db, ctx.workspaceId, c.req.valid('param').memberId));
  })
  .put('/schedules/:memberId', member, zValidator('param', memberParam, validationHook), zValidator('json', scheduleUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { memberId } = c.req.valid('param');
    assertScheduleAccess(ctx, memberId);
    await saveSchedule(ctx.db, docCtx(ctx), memberId, c.req.valid('json'));
    return c.json(await scheduleView(ctx.db, ctx.workspaceId, memberId));
  })
  .put('/schedules/:memberId/exceptions/:date', member, zValidator('param', exceptionParam, validationHook), zValidator('json', scheduleExceptionUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { memberId, date } = c.req.valid('param');
    assertScheduleAccess(ctx, memberId);
    await saveScheduleException(ctx.db, docCtx(ctx), memberId, date, c.req.valid('json'));
    return c.json(await scheduleView(ctx.db, ctx.workspaceId, memberId));
  })
  .delete('/schedules/:memberId/exceptions/:date', member, zValidator('param', exceptionParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { memberId, date } = c.req.valid('param');
    assertScheduleAccess(ctx, memberId);
    await deleteScheduleException(ctx.db, docCtx(ctx), memberId, date);
    return c.json(await scheduleView(ctx.db, ctx.workspaceId, memberId));
  })
  .get('/day', zValidator('query', dayQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await dayBoard(ctx.db, ctx.workspaceId, c.req.valid('query').date));
  })
  .get('/week', zValidator('query', appointmentWeekQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json(await weekBoard(ctx.db, ctx.workspaceId, q.specialistId, q.from));
  })
  .get('/free', zValidator('query', appointmentFreeQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const tz = await workspaceTimeZone(ctx.db, ctx.workspaceId);
    return c.json({ slot: await findFreeTime(ctx.db, ctx.workspaceId, c.req.valid('query'), dateInTimezone(tz)) });
  })
  .get('/unclosed-days', zValidator('query', unclosedDaysQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await unclosedDays(ctx.db, ctx.workspaceId, c.req.valid('query').specialistId) });
  })
  .post('/clients', member, zValidator('json', appointmentClientCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createAppointmentClient(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  /* ---- документ дня ---- */
  .post('/day-documents', member, zValidator('json', serviceDayCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createServiceDay(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await serviceDayDetail(ctx.db, id), 201);
  })
  .get('/day-documents/:id', zValidator('param', idParam, validationHook), async c => c.json(await serviceDayDetail(ctxOf(c).db, c.req.valid('param').id)))
  .patch('/day-documents/:id', member, zValidator('param', idParam, validationHook), zValidator('json', serviceDayUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await updateServiceDay(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await serviceDayDetail(ctx.db, id));
  })
  .post('/day-documents/:id/fill', member, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await fillServiceDay(ctx.db, docCtx(ctx), id);
    return c.json(await serviceDayDetail(ctx.db, id));
  })
  .post('/day-documents/:id/post', member, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await serviceDayDetail(ctx.db, id);
    await postDocument(ctx.db, docCtx(ctx), id);
    return c.json(await serviceDayDetail(ctx.db, id));
  })
  .post('/day-documents/:id/unpost', member, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await serviceDayDetail(ctx.db, id);
    await unpostDocument(ctx.db, docCtx(ctx), id);
    return c.json(await serviceDayDetail(ctx.db, id));
  })
  .delete('/day-documents/:id', member, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await serviceDayDetail(ctx.db, id);
    await deleteDocument(ctx.db, docCtx(ctx), id);
    return c.json({ ok: true });
  })
  /* ---- записи ---- */
  .get('/', zValidator('query', appointmentListQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await listAppointments(ctx.db, c.req.valid('query')));
  })
  .post('/', member, zValidator('json', appointmentCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createAppointment(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await appointmentDetail(ctx.db, id), 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => c.json(await appointmentDetail(ctxOf(c).db, c.req.valid('param').id)))
  .patch('/:id', member, zValidator('param', idParam, validationHook), zValidator('json', appointmentUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await updateAppointment(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await appointmentDetail(ctx.db, id));
  })
  .post('/:id/confirm', member, zValidator('param', idParam, validationHook), async c => status(c, 'confirmed'))
  .post('/:id/came', member, zValidator('param', idParam, validationHook), async c => status(c, 'came'))
  .post('/:id/no-show', member, zValidator('param', idParam, validationHook), async c => status(c, 'no_show'))
  .post('/:id/cancel', member, zValidator('param', idParam, validationHook), zValidator('json', appointmentCancel, validationHook), async c => status(c, 'cancelled', c.req.valid('json').reason))
  .post('/:id/work-order', member, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const { documentId } = await createAppointmentWorkOrder(ctx.db, docCtx(ctx), id);
    return c.json({ documentId, appointment: await appointmentDetail(ctx.db, id) }, 201);
  })
  .post('/:id/move', member, zValidator('param', idParam, validationHook), zValidator('json', appointmentMove, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await moveAppointment(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await appointmentDetail(ctx.db, id));
  });

async function status(c: Context<AppEnv>, to: 'confirmed' | 'came' | 'no_show' | 'cancelled', reason?: string) {
  const ctx = ctxOf(c);
  const id = c.req.param('id') as string;
  await setAppointmentStatus(ctx.db, docCtx(ctx), id, to, reason);
  return c.json(await appointmentDetail(ctx.db, id));
}
