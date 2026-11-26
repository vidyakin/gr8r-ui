/* Аналитика транспорта (задача 1216): GET /trips/analytics?from=...&to=...
   Читает любой участник; финансовые показатели и затраты видят только admin и owner. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { transportAnalytics } from '@erp/db';
import { transportAnalyticsQuery } from '@erp/shared';
import { ctxOf, validationHook } from '../crud';
import type { AppEnv } from '../types';

export const transportAnalyticsRoutes = new Hono<AppEnv>().get('/analytics', zValidator('query', transportAnalyticsQuery, validationHook), async c => {
  const ctx = ctxOf(c);
  return c.json(await transportAnalytics(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role }, c.req.valid('query')));
});
