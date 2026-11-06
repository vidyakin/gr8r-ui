/* Прогноз прибыли объекта (задача 1275, docs/architecture/construction.md): отчёт по объекту, исполнители по
   подтверждённым сменам, ручные правки остатка (admin+) и портфель по всем активным объектам.
   Пути: `/objects/:id/forecast` (объект — модуль trade) и новый `/objects-forecast` (TENANT_PATHS, модуль trade).
   Деньги (себестоимость, прогноз, прибыль, ставки) видят только owner/admin — сервис отвечает 403 остальным. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  deleteForecastOverride,
  objectForecast,
  objectForecastExecutors,
  objectPortfolio,
  saveForecastOverride,
} from '@gr8r/db';
import { forecastExecutorsQuery, forecastOverrideDelete, forecastOverrideInput, uuid } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const objectIdParam = z.object({ id: uuid });

/** Отчёт прогноза и правки остатка — под /objects (путь уже в TENANT_PATHS и модуле trade) */
export const objectForecastObjectRoutes = new Hono<AppEnv>()
  // отчёт прогноза прибыли: строки по позициям, итоги по категориям, прогноз, прибыль и маржа
  .get('/:id/forecast', zValidator('param', objectIdParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await objectForecast(ctx.db, c.req.valid('param').id, ctx.role));
  })
  // исполнители: подтверждённые смены объекта — работник, часы, стоимость труда и позиции; период необязателен
  .get('/:id/forecast/executors', zValidator('param', objectIdParam, validationHook), zValidator('query', forecastExecutorsQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await objectForecastExecutors(ctx.db, c.req.valid('param').id, ctx.role, c.req.valid('query')));
  })
  // ручная правка остатка по позиции сметы или по категории: причина обязательна (admin+)
  .put('/:id/forecast/overrides', requireRole('admin'), zValidator('param', objectIdParam, validationHook), zValidator('json', forecastOverrideInput, validationHook), async c => {
    const ctx = ctxOf(c);
    const override = await saveForecastOverride(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role }, c.req.valid('param').id, c.req.valid('json'));
    return c.json(override);
  })
  .delete('/:id/forecast/overrides', requireRole('admin'), zValidator('param', objectIdParam, validationHook), zValidator('query', forecastOverrideDelete, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const q = c.req.valid('query');
    await deleteForecastOverride(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role }, id, q);
    return c.json({ id, deleted: true as const });
  });

/** Портфель: прогноз по всем активным объектам — корневой путь /objects-forecast (TENANT_PATHS, модуль trade) */
export const objectForecastRoutes = new Hono<AppEnv>().get('/', async c => {
  const ctx = ctxOf(c);
  return c.json(await objectPortfolio(ctx.db, ctx.role));
});
