/* Отчёты продаж: P&L «Валовая прибыль» и ABC-анализ (задача 1390).
   Смонтировано под `/documents`: `/documents/reports/sales-profit`, `/documents/reports/sales-abc` и их экспорт в XLSX.
   Себестоимость, валовая прибыль и маржа видны только admin и owner (`canSeeCost`); ABC по прибыли — 403 для остальных. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { canSeeCost, maskSalesAbcReport, maskSalesProfitReport, salesAbcReport, salesProfitReport } from '@erp/db';
import { salesAbcQuery, salesProfitQuery } from '@erp/shared';
import { ctxOf, validationHook } from '../crud';
import { AppError } from '../errors';
import type { AppEnv } from '../types';
import { buildXlsx, type Cell } from '../xlsx';

const COST_FORBIDDEN = () => new AppError(403, 'cost_access_required', 'Profit-based ABC analysis is available to the workspace owner and administrators only');

const num = (v: string | null) => (v === null ? null : Number(v));

export const salesProfitRoutes = new Hono<AppEnv>()
  .get('/reports/sales-profit', zValidator('query', salesProfitQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const r = await salesProfitReport(ctx.db, ctx.workspaceId, c.req.valid('query'));
    return c.json(maskSalesProfitReport(r, canSeeCost(ctx.role)));
  })
  .get('/reports/sales-profit/export', zValidator('query', salesProfitQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const see = canSeeCost(ctx.role);
    const r = await salesProfitReport(ctx.db, ctx.workspaceId, q);
    const header: Cell[] = see
      ? ['Group', 'Revenue', 'Discount', 'COGS', 'Gross profit', 'Gross margin %']
      : ['Group', 'Revenue', 'Discount'];
    const table: Cell[][] = [header];
    for (const row of r.items) {
      table.push(
        see
          ? [row.groupName || row.groupId, num(row.revenue), num(row.discount), num(row.cogs), num(row.grossProfit), num(row.grossMarginPct)]
          : [row.groupName || row.groupId, num(row.revenue), num(row.discount)],
      );
    }
    table.push(
      see
        ? ['Total', num(r.totals.revenue), num(r.totals.discount), num(r.totals.cogs), num(r.totals.grossProfit), num(r.totals.grossMarginPct)]
        : ['Total', num(r.totals.revenue), num(r.totals.discount)],
    );
    const stamp = q.dateTo ?? new Date().toISOString().slice(0, 10);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', `attachment; filename="sales-profit-${stamp}.xlsx"`);
    return c.body(buildXlsx('Sales P&L', table) as unknown as ArrayBuffer);
  })
  .get('/reports/sales-abc', zValidator('query', salesAbcQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const see = canSeeCost(ctx.role);
    if (q.metric === 'profit' && !see) throw COST_FORBIDDEN();
    const r = await salesAbcReport(ctx.db, ctx.workspaceId, q);
    return c.json(maskSalesAbcReport(r, see));
  })
  .get('/reports/sales-abc/export', zValidator('query', salesAbcQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const see = canSeeCost(ctx.role);
    if (q.metric === 'profit' && !see) throw COST_FORBIDDEN();
    const r = await salesAbcReport(ctx.db, ctx.workspaceId, q);
    const header: Cell[] = see
      ? ['Class', 'Group', 'Revenue', 'Discount', 'COGS', 'Gross profit', 'Gross margin %', 'Share %', 'Cumulative %']
      : ['Class', 'Group', 'Revenue', 'Discount', 'Share %', 'Cumulative %'];
    const table: Cell[][] = [header];
    for (const row of r.items) {
      table.push(
        see
          ? [row.abcClass, row.groupName || row.groupId, num(row.revenue), num(row.discount), num(row.cogs), num(row.grossProfit), num(row.grossMarginPct), num(row.contributionPct), num(row.cumulativePct)]
          : [row.abcClass, row.groupName || row.groupId, num(row.revenue), num(row.discount), num(row.contributionPct), num(row.cumulativePct)],
      );
    }
    const stamp = q.dateTo ?? new Date().toISOString().slice(0, 10);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', `attachment; filename="sales-abc-${stamp}.xlsx"`);
    return c.body(buildXlsx('Sales ABC', table) as unknown as ArrayBuffer);
  });
