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
  createPayment,
  createPaymentFromDocument,
  debtReport,
  ensureCashFlowItems,
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
import { hasRole, requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });
const today = () => new Date().toISOString().slice(0, 10);
const csv = (v: string | undefined) => (v ? v.split(',').filter(Boolean) : undefined);

const CSP = "default-src 'none'; img-src * data:; style-src 'unsafe-inline'";

export const paymentRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', paymentQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const res = await listPayments(ctx.db, ctx.workspaceId, { ...q, types: csv(q.type), status: csv(q.status) });
    // выплаты зарплаты видят только admin и owner
    return c.json(hasRole(c, 'admin') ? res : { ...res, items: res.items.filter(i => i.operation !== 'salary_payment') });
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
  .get('/settlements/:companyId/act', zValidator('param', z.object({ companyId: uuid }), validationHook), zValidator('query', settlementQuery.extend({ side: z.enum(['customer', 'supplier']).default('customer'), organizationId: uuid.optional() }), validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const data = await settlementActData(ctx.db, ctx.workspaceId, c.req.valid('param').companyId, q);
    c.header('Content-Security-Policy', CSP);
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderSettlementAct(data));
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
    if (b.operation === 'salary_payment' && !hasRole(c, 'admin')) throw new AppError(403, 'forbidden', 'Salary payments require the admin role');
    const id = await createPayment(ctx.db, docCtx(ctx), { ...b, lines: b.lines });
    return c.json(await paymentDetail(ctx.db, id), 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const d = await paymentDetail(ctxOf(c).db, c.req.valid('param').id);
    if (d.operation === 'salary_payment' && !hasRole(c, 'admin')) throw new AppError(403, 'forbidden', 'Salary payments require the admin role');
    return c.json(d);
  })
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', paymentUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    if ((await paymentDetail(ctx.db, id)).operation === 'salary_payment' && !hasRole(c, 'admin')) throw new AppError(403, 'forbidden', 'Salary payments require the admin role');
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
