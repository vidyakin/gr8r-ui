/* Отчёты услуг (задача 1097): GET /services/reports/<имя>. Читает любой участник; себестоимость и маржа клиентов —
   только admin и owner (maskClientsReport). Правила — packages/db/src/service-reports.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { canSeeCost, clientsReport, maskClientsReport, scheduleReport, serviceLoadReport, statesReport } from '@gr8r/db';
import { serviceClientsReportQuery, serviceLoadReportQuery, serviceScheduleReportQuery, serviceStatesReportQuery } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import type { AppEnv } from '../types';

export const serviceReportRoutes = new Hono<AppEnv>()
  .get('/reports/states', zValidator('query', serviceStatesReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await statesReport(ctx.db, ctx.workspaceId, c.req.valid('query')));
  })
  .get('/reports/schedule', zValidator('query', serviceScheduleReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await scheduleReport(ctx.db, ctx.workspaceId, c.req.valid('query')));
  })
  .get('/reports/load', zValidator('query', serviceLoadReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await serviceLoadReport(ctx.db, ctx.workspaceId, c.req.valid('query')));
  })
  .get('/reports/clients', zValidator('query', serviceClientsReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(maskClientsReport(await clientsReport(ctx.db, ctx.workspaceId, c.req.valid('query')), canSeeCost(ctx.role)));
  });
