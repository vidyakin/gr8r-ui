/* Биллинг договоров обслуживания: предпросмотр, запуск, отчёт по договору, выгрузка PDF и часовой пояс арендатора.
   Ручной запуск и выгрузка — admin и выше; предпросмотр и отчёт — любой участник. */
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { billingBreakdowns, contractReport, documentFiles, documents, jobs, previewBilling, runBilling, workspaceTimezone, workspaces } from '@gr8r/db';
import { billingExportRequest, billingPreviewQuery, billingReportQuery, billingRunRequest, idParam, isValidTimezone, supportedTimezones } from '@gr8r/shared';
import { z } from 'zod';
import { AppError } from '../errors';
import { requireRole } from '../middleware';
import { ctxOf, validationHook } from '../crud';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const docCtx = (ctx: ReturnType<typeof ctxOf>) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

export const billingRoutes = new Hono<AppEnv>()
  /** Предпросмотр: что будет выставлено за период (ничего не записывается) */
  .get('/preview', zValidator('query', billingPreviewQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query' as never) as { period?: string; contractIds?: string };
    const items = await previewBilling(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, { period: q.period, contractIds: q.contractIds ? q.contractIds.split(',').filter(Boolean) : undefined });
    return c.json({
      items: items.map(i => ({
        contractId: i.contract.id,
        contractNumber: i.contract.number,
        companyName: i.contract.companyName,
        period: i.period.key,
        factPeriod: i.factPeriod.key,
        existingDocumentId: i.existingDocumentId,
        warnings: i.computation.warnings,
        lines: i.computation.lines.map(l => ({ productId: l.productId, name: l.name, qty: l.qty, price: l.price, vatRate: l.vatRate, breakdown: l.breakdown })),
      })),
    });
  })
  /** Запуск биллинга: по одному счёту на договор и период, повтор ничего не создаёт */
  .post('/run', admin, zValidator('json', billingRunRequest, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json' as never) as { period?: string; contractIds?: string[] };
    const res = await runBilling(ctx.db, docCtx(ctx), { period: body.period, contractIds: body.contractIds });
    return c.json(res);
  })
  /** Доходы и расходы по договорам */
  .get('/report', zValidator('query', billingReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query' as never) as { from?: string; to?: string; contractId?: string };
    return c.json({ items: await contractReport(ctx.db, ctx.workspaceId, q) });
  })
  /** Выгрузка счетов периода: PDF печатных форм отдельными файлами (задачи воркера) */
  .post('/export', admin, zValidator('json', billingExportRequest, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json' as never) as { documentIds: string[] };
    const docs = await ctx.db.select({ id: documents.id, number: documents.number, type: documents.type }).from(documents).where(and(inArray(documents.id, body.documentIds), eq(documents.workspaceId, ctx.workspaceId)));
    const items: { documentId: string; number: string | null; fileId: string | null }[] = [];
    for (const d of docs) {
      const [file] = await ctx.db.insert(documentFiles).values({ workspaceId: ctx.workspaceId, documentId: d.id, form: 'invoice', status: 'pending', requestedBy: ctx.memberId }).returning();
      await ctx.db.insert(jobs).values({ workspaceId: ctx.workspaceId, type: 'document.pdf', payload: { fileId: file!.id } });
      items.push({ documentId: d.id, number: d.number, fileId: file!.id });
    }
    return c.json({ items, count: items.length });
  })
  /** Расшифровка биллинга счёта (вкладка «Billing breakdown») */
  .get('/breakdown/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const [row] = await ctx.db.select().from(billingBreakdowns).where(and(eq(billingBreakdowns.documentId, id), eq(billingBreakdowns.workspaceId, ctx.workspaceId))).limit(1);
    if (!row) throw new AppError(404, 'not_found', 'This document has no billing breakdown');
    return c.json(row.payload);
  })
  /** Часовой пояс арендатора: в нём считаются период биллинга и расписания автоматизаций */
  .get('/timezone', async c => {
    const ctx = ctxOf(c);
    return c.json({ timezone: await workspaceTimezone(ctx.db, ctx.workspaceId), options: supportedTimezones() });
  })
  .patch('/timezone', admin, zValidator('json', z.object({ timezone: z.string().trim().min(1).max(64) }), validationHook), async c => {
    const ctx = ctxOf(c);
    const body = (c.req.valid('json' as never) as { timezone: string });
    if (!isValidTimezone(body.timezone)) throw new AppError(422, 'invalid_timezone', 'Unknown time zone: use an IANA name like Europe/Moscow');
    await ctx.db.update(workspaces).set({ timezone: body.timezone, updatedAt: new Date() }).where(eq(workspaces.id, ctx.workspaceId));
    return c.json({ timezone: body.timezone });
  });
