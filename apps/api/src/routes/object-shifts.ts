/* Табель прораба (задача 1271, docs/architecture/construction.md): смены объекта, часы бригады, сменный отчёт объёмов,
   бейджи и рабочие без входа.
   Пути: `/objects/:id/shifts`, `/objects/:id/timesheet` (объект — модуль trade), `/shifts` (смена по id, новые пути в TENANT_PATHS)
   и `/members/workers|badge/:code|badges/print|:id/badge`. Права проверяет сервис: прораб ведёт только свои объекты,
   деньги (ставки и суммы) видит лишь owner/admin, правка и отмена подтверждённой смены — только admin/owner с причиной. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  badgesForPrint,
  confirmShift,
  createShift,
  createWorker,
  findMemberByBadge,
  issueBadge,
  objectShiftsView,
  objectTimesheet,
  saveShift,
  shiftObjects,
  shiftOptions,
  shiftView,
  unconfirmShift,
} from '@gr8r/db';
import {
  badgeCodeParam,
  badgePrintQuery,
  idParam,
  isoDate,
  objectShiftCreate,
  objectShiftQuery,
  objectShiftSave,
  objectShiftUnconfirm,
  renderBadges,
  uuid,
  workerCreate,
} from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

/** Контекст смены: воркспейс, автор и его роль (права и видимость денег) */
const shiftCtx = (ctx: ReturnType<typeof ctxOf>) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

const objectIdParam = z.object({ id: uuid });
const timesheetQuery = z.object({ from: isoDate, to: isoDate });

/** Смены и табель объекта — под /objects, чтобы путь уже был в TENANT_PATHS и модуле trade */
export const objectShiftObjectRoutes = new Hono<AppEnv>()
  // смены объекта за период: статус, часы, сумма (только admin/owner)
  .get('/:id/shifts', zValidator('param', objectIdParam, validationHook), zValidator('query', objectShiftQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const { from, to, limit } = c.req.valid('query');
    return c.json(await objectShiftsView(ctx.db, shiftCtx(ctx), c.req.valid('param').id, { from, to, limit }));
  })
  // открыть смену: повторный вызов на ту же тройку (объект, дата, прораб) возвращает уже открытую
  .post('/:id/shifts', requireRole('member'), zValidator('param', objectIdParam, validationHook), zValidator('json', objectShiftCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createShift(ctx.db, shiftCtx(ctx), c.req.valid('param').id, c.req.valid('json'));
    return c.json(await shiftView(ctx.db, shiftCtx(ctx), id), 201);
  })
  // работники бригады и позиции сметы для экрана смены (прораб — только свои объекты)
  .get('/:id/shifts/options', zValidator('param', objectIdParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await shiftOptions(ctx.db, shiftCtx(ctx), c.req.valid('param').id));
  })
  // табель за период: работник × дни по подтверждённым сменам
  .get('/:id/timesheet', zValidator('param', objectIdParam, validationHook), zValidator('query', timesheetQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await objectTimesheet(ctx.db, c.req.valid('param').id, c.req.valid('query')));
  });

/** Смена по id и её действия — корневой путь /shifts (TENANT_PATHS, модуль trade) */
export const objectShiftRoutes = new Hono<AppEnv>()
  // объекты, на которых участник может вести смену: свои для прораба, все для admin/owner
  .get('/objects', async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await shiftObjects(ctx.db, shiftCtx(ctx)) });
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await shiftView(ctx.db, shiftCtx(ctx), c.req.valid('param').id));
  })
  // пакетное сохранение часов бригады и объёмов; подтверждённую смену правит только admin/owner с причиной
  .put('/:id', requireRole('member'), zValidator('param', idParam, validationHook), zValidator('json', objectShiftSave, validationHook), async c => {
    const ctx = ctxOf(c);
    await saveShift(ctx.db, shiftCtx(ctx), c.req.valid('param').id, c.req.valid('json'));
    return c.json(await shiftView(ctx.db, shiftCtx(ctx), c.req.valid('param').id));
  })
  // подтвердить: снимок ставок, объёмы в done_qty, проверка бюджета (warn — предупреждение, block — 422)
  .post('/:id/confirm', requireRole('member'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const { warnings } = await confirmShift(ctx.db, shiftCtx(ctx), id);
    return c.json({ ...(await shiftView(ctx.db, shiftCtx(ctx), id)), warnings });
  })
  // отменить подтверждение: только admin/owner, причина обязательна, объёмы откатываются
  .post('/:id/unconfirm', requireRole('admin'), zValidator('param', idParam, validationHook), zValidator('json', objectShiftUnconfirm, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await unconfirmShift(ctx.db, shiftCtx(ctx), id, c.req.valid('json').reason);
    return c.json(await shiftView(ctx.db, shiftCtx(ctx), id));
  });

/** Бейджи и рабочие без входа — под /members (admin и выше) */
export const memberLaborRoutes = new Hono<AppEnv>()
  .use('*', requireRole('admin'))
  // рабочий без входа: участник без user_id и без membership
  .post('/workers', zValidator('json', workerCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createWorker(ctx.db, shiftCtx(ctx), c.req.valid('json')), 201);
  })
  // печать бейджей: имя, табельный номер и QR-код (HTML, A4); ?ids= — только выбранные
  .get('/badges/print', zValidator('query', badgePrintQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const ids = c.req.valid('query').ids?.split(',').filter(Boolean);
    c.header('Content-Security-Policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderBadges(await badgesForPrint(ctx.db, ctx.workspaceId, ids)));
  })
  // поиск работника по коду бейджа для скана: неизвестный и отозванный код — 404 badge_not_found
  .get('/badge/:code', zValidator('param', badgeCodeParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await findMemberByBadge(ctx.db, c.req.valid('param').code));
  })
  // выпуск и перевыпуск бейджа: старый код заменяется (отзывается), новый генерируется
  .post('/:id/badge', zValidator('param', idParam, validationHook), zValidator('json', z.object({ personnelNumber: z.string().trim().max(50).nullish() }), validationHook), async c => {
    const ctx = ctxOf(c);
    const { personnelNumber } = c.req.valid('json');
    return c.json(await issueBadge(ctx.db, shiftCtx(ctx), c.req.valid('param').id, personnelNumber));
  });
