/* Деньги (задача 1174б): документы оплат и авансовый отчёт, кассы, статьи ДДС, остатки, отчёты, взаиморасчёты и акт сверки.
   Проведение, отмена, удаление — общие маршруты документов (`/documents/:id/post|unpost|cancel|restore`).
   Правила — packages/db/src/payments.ts, settlements.ts и docs/architecture/payments.md. */
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  accountableBalances,
  cashBalances,
  cashFlowItems,
  cashFlowReport,
  cashOrderData,
  cashRegisters,
  companies,
  createPayment,
  createPaymentFromDocument,
  debtReport,
  documentExports,
  ensureCashFlowItems,
  jobs,
  listPayments,
  organizations,
  paymentDetail,
  paymentStatuses,
  settlementActData,
  settlementCard,
  updatePayment,
} from '@gr8r/db';
import {
  balancesQuery,
  cashFlowItemCreate,
  cashFlowItemQuery,
  cashFlowItemUpdate,
  cashFlowReportQuery,
  cashRegisterCreate,
  cashRegisterQuery,
  cashRegisterUpdate,
  debtReportQuery,
  idParam,
  paymentCreate,
  paymentFromDocument,
  paymentQuery,
  paymentUpdate,
  renderCashOrder,
  renderSettlementAct,
  settlementQuery,
  settlementStatusQuery,
  uuid,
} from '@gr8r/shared';
import { z } from 'zod';
import { crud, ctxOf, validationHook, type Ctx } from '../crud';
import { AppError } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });
const today = () => new Date().toISOString().slice(0, 10);
const csv = (v: string | undefined) => (v ? v.split(',').filter(Boolean) : undefined);

const actQuery = settlementQuery.extend({ side: z.enum(['customer', 'supplier']).default('customer'), organizationId: uuid.optional() });

const CSP = "default-src 'none'; img-src * data:; style-src 'unsafe-inline'";

export const paymentRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', paymentQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json(await listPayments(ctx.db, ctx.workspaceId, { ...q, types: csv(q.type), status: csv(q.status) }));
  })
  // остатки денег по кассам, счетам и подотчётным лицам на дату
  .get('/balances', zValidator('query', balancesQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await cashBalances(ctx.db, ctx.workspaceId, c.req.valid('query').asOf ?? today()));
  })
  .get('/accountable', zValidator('query', balancesQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await accountableBalances(ctx.db, ctx.workspaceId, c.req.valid('query').asOf ?? today()) });
  })
  .get('/reports/cash-flow', zValidator('query', cashFlowReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    await ensureCashFlowItems(ctx.db, ctx.workspaceId);
    return c.json(await cashFlowReport(ctx.db, ctx.workspaceId, c.req.valid('query')));
  })
  .get('/reports/receivables', zValidator('query', debtReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json(await debtReport(ctx.db, ctx.workspaceId, 'customer', q.asOf ?? today(), q.companyId));
  })
  .get('/reports/payables', zValidator('query', debtReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json(await debtReport(ctx.db, ctx.workspaceId, 'supplier', q.asOf ?? today(), q.companyId));
  })
  // «оплачено / к оплате» для списка документов
  .get('/status', zValidator('query', settlementStatusQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await paymentStatuses(ctx.db, c.req.valid('query').ids) });
  })
  // сальдо контрагента и обороты периода (карточка контрагента)
  .get('/settlements/:companyId', zValidator('param', z.object({ companyId: uuid }), validationHook), zValidator('query', settlementQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await settlementCard(ctx.db, ctx.workspaceId, c.req.valid('param').companyId, c.req.valid('query')));
  })
  // акт сверки: печатная форма (HTML, A4)
  .get('/settlements/:companyId/act', zValidator('param', z.object({ companyId: uuid }), validationHook), zValidator('query', actQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const data = await settlementActData(ctx.db, ctx.workspaceId, c.req.valid('param').companyId, q);
    c.header('Content-Security-Policy', CSP);
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderSettlementAct(data));
  })
  // акт сверки в PDF: задача воркеру (headless Chromium); файл лежит в document_exports (акт — не документ учёта)
  .post('/settlements/:companyId/act/pdf', write, zValidator('param', z.object({ companyId: uuid }), validationHook), zValidator('query', actQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const companyId = c.req.valid('param').companyId;
    const q = c.req.valid('query');
    const [co] = await ctx.db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!co) throw new AppError(404, 'not_found', 'Counterparty not found');
    const name = `settlement-act-${q.from ?? 'start'}-${q.to ?? today()}.pdf`;
    const [row] = await ctx.db.insert(documentExports).values({ workspaceId: ctx.workspaceId, name, contentType: 'application/pdf', requestedBy: ctx.memberId }).returning({ id: documentExports.id, name: documentExports.name, status: documentExports.status });
    await ctx.db.insert(jobs).values({ workspaceId: ctx.workspaceId, type: 'settlement.act_pdf', payload: { exportId: row!.id, companyId, ...q } });
    return c.json(row!, 202);
  })
  // статус акта сверки в PDF и скачивание (?download=1)
  .get('/act-files/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const [row] = await ctx.db.select().from(documentExports).where(and(eq(documentExports.id, id), eq(documentExports.workspaceId, ctx.workspaceId), eq(documentExports.contentType, 'application/pdf'))).limit(1);
    if (!row) throw new AppError(404, 'not_found', 'File not found');
    if (c.req.query('download') !== '1') return c.json({ id: row.id, name: row.name, status: row.status, size: row.size, error: row.error });
    if (row.status !== 'ready' || !row.data) throw new AppError(409, 'not_ready', row.status === 'failed' ? `PDF generation failed: ${row.error}` : 'The PDF is not ready yet');
    return new Response(new Uint8Array(row.data), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${row.name}"`, 'content-length': String(row.data.length), 'x-content-type-options': 'nosniff' } });
  })
  .post('/from-document', write, zValidator('json', paymentFromDocument, validationHook), async c => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    const id = await createPaymentFromDocument(ctx.db, docCtx(ctx), b.documentId, b.account);
    return c.json(await paymentDetail(ctx.db, id), 201);
  })
  .post('/', write, zValidator('json', paymentCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    const id = await createPayment(ctx.db, docCtx(ctx), { ...b, lines: b.lines });
    return c.json(await paymentDetail(ctx.db, id), 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => c.json(await paymentDetail(ctxOf(c).db, c.req.valid('param').id)))
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', paymentUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updatePayment(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await paymentDetail(ctx.db, id));
  })
  // КО-1 / КО-2
  .get('/:id/print/:form', zValidator('param', z.object({ id: uuid, form: z.enum(['ko1', 'ko2']) }), validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, form } = c.req.valid('param');
    const d = await paymentDetail(ctx.db, id);
    if ((form === 'ko1') !== (d.type === 'cash_receipt')) throw new AppError(422, 'form_not_available', 'This form is not available for the document type');
    c.header('Content-Security-Policy', CSP);
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderCashOrder(await cashOrderData(ctx.db, id, form)));
  });

/** Кассы: чтение — любой участник, меняет admin и выше */
export const cashRegisterRoutes = crud({
  entity: 'cash_register',
  table: cashRegisters,
  create: cashRegisterCreate,
  update: cashRegisterUpdate,
  query: cashRegisterQuery,
  sortable: { name: cashRegisters.name, createdAt: cashRegisters.createdAt },
  defaultSort: 'name',
  search: [cashRegisters.name],
  writeRole: 'admin',
  prepareCreate: async (ctx, body) => {
    let organizationId = body.organizationId ?? null;
    if (!organizationId) {
      const [o] = await ctx.db.select({ id: organizations.id }).from(organizations).where(and(isNull(organizations.archivedAt))).orderBy(asc(organizations.createdAt)).limit(1);
      if (!o) throw new AppError(422, 'organization_required', 'Add an organization in Settings → Organizations first');
      organizationId = o.id;
    }
    return { organizationId };
  },
});

/** Статьи ДДС: системные создаются сами (не удаляются), меняет admin и выше */
export const cashFlowItemRoutes = crud({
  entity: 'cash_flow_item',
  table: cashFlowItems,
  create: cashFlowItemCreate,
  update: cashFlowItemUpdate,
  query: cashFlowItemQuery,
  sortable: { name: cashFlowItems.name, kind: cashFlowItems.kind, createdAt: cashFlowItems.createdAt },
  defaultSort: 'name',
  search: [cashFlowItems.name],
  writeRole: 'admin',
  filters: q => [q.kind ? eq(cashFlowItems.kind, q.kind) : undefined],
  beforeDelete: (_ctx, row) => {
    if (row.systemKey) throw new AppError(422, 'system_item', 'A system cash flow item cannot be deleted');
  },
});
