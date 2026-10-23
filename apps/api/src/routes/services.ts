/* Учёт времени и нормы работ: нормы времени работ каталога (норма на единицу и участок по умолчанию)
   и табель сотрудника — отчёт по времени задач модуля services. Читает любой участник, нормы меняет member и выше. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { canSeeCost, listWorkNorms, servicesSchedule, servicesTimesheet, setWorkNorm } from '@gr8r/db';
import { idParam, serviceScheduleQuery, timesheetQuery, workNormSet } from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

export const serviceRoutes = new Hono<AppEnv>()
  // работы каталога с нормой времени и участком по умолчанию
  .get('/work-norms', async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listWorkNorms(ctx.db, ctx.workspaceId) });
  })
  // норма времени работы и участок по умолчанию
  .put('/work-norms/:id', write, zValidator('param', idParam, validationHook), zValidator('json', workNormSet, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const productId = c.req.valid('param').id;
    await setWorkNorm(ctx.db, docCtx(ctx), { productId, normHours: body.normHours, workCenterId: body.workCenterId });
    return c.json({ productId, normHours: body.normHours, workCenterId: body.workCenterId ?? null });
  })
  // табель сотрудника: время по задачам модуля services за период (строки по заказчику и виду работ).
  // admin и owner видят всех, участник — только себя
  .get('/timesheet', zValidator('query', timesheetQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const memberId = canSeeCost(ctx.role) ? q.memberId : (ctx.memberId ?? undefined);
    return c.json(await servicesTimesheet(ctx.db, ctx.workspaceId, { memberId, from: q.from, to: q.to }));
  })
  // часовой план услуг: загрузка по часам (исполнители или ресурсы), перегрузка и работа вне смены
  .get('/schedule', zValidator('query', serviceScheduleQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json(await servicesSchedule(ctx.db, ctx.workspaceId, { from: q.from, to: q.to, rowType: q.resource }));
  });
