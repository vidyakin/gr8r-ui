/* Биллинг договоров обслуживания: предпросмотр, запуск, отчёт по договору, выгрузка PDF архивом и часовой пояс арендатора.
   Ручной запуск и выгрузка — admin и выше; предпросмотр и отчёт — любой участник. */
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { billingBreakdowns, contractReport, documentExports, documents, jobs, previewBilling, runBilling, workspaceTimezone, workspaces } from '@gr8r/db';
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
  /** Выгрузка счетов периода одним ZIP-архивом (задача воркера billing.export_zip). Ответ — id выгрузки:
      статус и скачивание архива — GET /billing/export/:id */
  .post('/export', admin, zValidator('json', billingExportRequest, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json' as never) as { documentIds: string[] };
    const ids = [...new Set(body.documentIds)];
    if (!ids.length) throw new AppError(422, 'no_documents', 'Select at least one invoice to export');
    const docs = await ctx.db.select({ id: documents.id, number: documents.number, type: documents.type }).from(documents).where(and(inArray(documents.id, ids), eq(documents.workspaceId, ctx.workspaceId)));
    if (docs.length !== ids.length) throw new AppError(422, 'document_not_found', 'Some documents do not exist in this workspace');
    const foreign = docs.filter(d => d.type !== 'invoice');
    if (foreign.length) throw new AppError(422, 'not_an_invoice', 'Only invoices can be exported: the archive holds the invoice print forms', { documentIds: foreign.map(d => d.id) });
    const name = `invoices-${new Date().toISOString().slice(0, 10)}.zip`;
    const [row] = await ctx.db.insert(documentExports).values({ workspaceId: ctx.workspaceId, name, documentIds: ids, requestedBy: ctx.memberId }).returning({ id: documentExports.id, name: documentExports.name, status: documentExports.status });
    await ctx.db.insert(jobs).values({ workspaceId: ctx.workspaceId, type: 'billing.export_zip', payload: { exportId: row!.id } });
    return c.json({ id: row!.id, name: row!.name, status: row!.status, count: ids.length }, 202);
  })
  /** Статус выгрузки и скачивание архива (как у файлов печатных форм: ?download=1) */
  .get('/export/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const [row] = await ctx.db.select().from(documentExports).where(and(eq(documentExports.id, id), eq(documentExports.workspaceId, ctx.workspaceId))).limit(1);
    if (!row) throw new AppError(404, 'not_found', 'Export not found');
    const meta = { id: row.id, name: row.name, status: row.status, size: row.size, error: row.error, count: row.documentIds.length };
    if (c.req.query('download') !== '1') return c.json(meta);
    if (row.status !== 'ready' || !row.data) throw new AppError(409, 'not_ready', row.status === 'failed' ? `Export failed: ${row.error}` : 'The archive is not ready yet');
    return new Response(new Uint8Array(row.data), { headers: { 'content-type': row.contentType, 'content-disposition': `attachment; filename="${row.name}"`, 'content-length': String(row.data.length), 'x-content-type-options': 'nosniff' } });
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
