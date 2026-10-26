/* Отчёты производства (задача 1091): GET /production/reports/<имя>. Чтение — любой участник;
   стоимость нормативного состава — только admin и owner (maskBomReport). Правила — packages/db/src/production-reports.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { bomReport, canSeeCost, costPlanFactReport, loadReport, maskBomReport, maskCostPlanFact, maskWipMovement, ordersReport, planFactReport, releaseCostReport, releaseReport, wipMovementReport, workOrderCostReport } from '@gr8r/db';
import { bomReportQuery, costPlanFactReportQuery, loadReportQuery, ordersReportQuery, planFactReportQuery, releaseCostReportQuery, releaseReportQuery, wipMovementReportQuery, workOrderCostReportQuery } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { AppError } from '../errors';
import type { AppEnv } from '../types';

export const productionReportRoutes = new Hono<AppEnv>()
  .get('/reports/release', zValidator('query', releaseReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await releaseReport(ctx.db, ctx.workspaceId, c.req.valid('query')));
  })
  .get('/reports/orders', zValidator('query', ordersReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await ordersReport(ctx.db, ctx.workspaceId, c.req.valid('query')));
  })
  .get('/reports/plan-fact', zValidator('query', planFactReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await planFactReport(ctx.db, ctx.workspaceId, c.req.valid('query')));
  })
  .get('/reports/bom', zValidator('query', bomReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(maskBomReport(await bomReport(ctx.db, ctx.workspaceId, c.req.valid('query')), canSeeCost(ctx.role)));
  })
  // себестоимость выпуска — стоимостной отчёт целиком: только admin и owner
  .get('/reports/release-cost', zValidator('query', releaseCostReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    if (!canSeeCost(ctx.role)) throw new AppError(403, 'cost_access_required', 'The cost report is available to the workspace owner and administrators only');
    return c.json(await releaseCostReport(ctx.db, ctx.workspaceId, c.req.valid('query')));
  })
  .get('/reports/cost-plan-fact', zValidator('query', costPlanFactReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(maskCostPlanFact(await costPlanFactReport(ctx.db, ctx.workspaceId, c.req.valid('query')), canSeeCost(ctx.role)));
  })
  .get('/reports/wip-movement', zValidator('query', wipMovementReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(maskWipMovement(await wipMovementReport(ctx.db, ctx.workspaceId, c.req.valid('query')), canSeeCost(ctx.role)));
  })
  // себестоимость заказ-нарядов, выполненных за период (задача 1096): только admin и owner
  .get('/reports/work-order-cost', zValidator('query', workOrderCostReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    if (!canSeeCost(ctx.role)) throw new AppError(403, 'cost_access_required', 'The cost report is available to the workspace owner and administrators only');
    return c.json(await workOrderCostReport(ctx.db, ctx.workspaceId, c.req.valid('query')));
  })
  .get('/reports/load', zValidator('query', loadReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await loadReport(ctx.db, ctx.workspaceId, c.req.valid('query')));
  });
