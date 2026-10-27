/* Заявка на расход (задача 1174г): документ группы «cash» со строками payment_lines. Подаётся на согласование проведением,
   согласует admin и выше (смена состояния), оплачивается документом РКО или списанием со счёта на основании заявки.
   Правила — docs/architecture/payments.md, «Платёжный календарь». */
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { allocateRequest, dec, fmt, REQUEST_STATES, requestTransitions, type PaymentLineInput } from '@gr8r/shared';
import type { Db } from './client';
import { DOCUMENT_HOOKS, STATE_PROVIDERS, type DynamicStateDef } from './document-hooks';
import type { DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { assertPeriodOpen } from './cost-closing';
import { createPayment, ensureCashFlowItems, saveLines } from './payments';
import { requestPaidAmounts } from './request-paid';
import { cashFlowItems, companies, contracts, documents, organizations, paymentLines } from './schema';

const today = () => new Date().toISOString().slice(0, 10);
type DocRow = typeof documents.$inferSelect;

export interface RequestInput {
  id?: string;
  operation?: string | null;
  organizationId?: string | null;
  date?: string;
  dueDate?: string | null;
  counterpartyId?: string | null;
  investmentProjectId?: string | null;
  comment?: string;
  lines?: PaymentLineInput[];
}

async function loadRequest(db: Db, id: string, lock = false): Promise<DocRow> {
  const q = db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row || row.type !== 'payment_request') throw new DomainError(404, 'not_found', 'payment request not found');
  return row;
}

const checkOperation = (op: string | null | undefined) => {
  if (op && op !== 'to_supplier' && op !== 'other_expense') throw new DomainError(422, 'invalid_operation', 'A payment request is either a payment to a supplier or another expense');
};

export async function createRequest(db: Db, ctx: DocCtx, input: RequestInput): Promise<string> {
  checkOperation(input.operation);
  let organizationId = input.organizationId ?? null;
  if (!organizationId) {
    const [o] = await db.select({ id: organizations.id }).from(organizations).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
    if (!o) throw new DomainError(422, 'organization_required', 'Add an organization in Settings → Organizations first');
    organizationId = o.id;
  }
  await ensureCashFlowItems(db, ctx.workspaceId);
  const [row] = await db
    .insert(documents)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      type: 'payment_request',
      date: input.date ?? today(),
      dueDate: input.dueDate ?? null,
      operation: input.operation ?? 'to_supplier',
      organizationId,
      counterpartyId: input.counterpartyId ?? null,
      investmentProjectId: input.investmentProjectId ?? null,
      comment: input.comment ?? '',
      responsibleId: ctx.memberId,
      createdBy: ctx.memberId,
    })
    .returning();
  if (input.lines?.length) await saveLines(db, ctx, row!, input.lines);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: row!.id, actorId: ctx.memberId, payload: { documentType: 'payment_request' } });
  return row!.id;
}

export async function updateRequest(db: Db, ctx: DocCtx, id: string, patch: Partial<Omit<RequestInput, 'id'>>): Promise<void> {
  const doc = await loadRequest(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only a draft can be edited: unpost the document first');
  checkOperation(patch.operation);
  if (patch.date && patch.date !== doc.date) await assertPeriodOpen(db, ctx.workspaceId, patch.date);
  if (doc.numberSeq !== null && patch.organizationId && patch.organizationId !== doc.organizationId) throw new DomainError(422, 'number_locked', 'The document has a number: the organization cannot be changed');
  const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  if (patch.operation) set.operation = patch.operation;
  if (patch.organizationId) set.organizationId = patch.organizationId;
  if (patch.date) set.date = patch.date;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.counterpartyId !== undefined) set.counterpartyId = patch.counterpartyId;
  if (patch.investmentProjectId !== undefined) set.investmentProjectId = patch.investmentProjectId;
  if (patch.comment !== undefined) set.comment = patch.comment;
  const [row] = await db.update(documents).set(set).where(eq(documents.id, id)).returning();
  if (patch.lines) await saveLines(db, ctx, row!, patch.lines);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'payment_request' } });
}

/* ---------------- проведение = подача на согласование ---------------- */

DOCUMENT_HOOKS.payment_request = {
  check: async (db, _ctx, doc) => {
    const lines = await db.select().from(paymentLines).where(eq(paymentLines.documentId, doc.id));
    if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one line before posting');
    if (!doc.counterpartyId) throw new DomainError(422, 'counterparty_required', 'Select the payee before posting');
    const items = new Map((await db.select({ id: cashFlowItems.id, kind: cashFlowItems.kind, archivedAt: cashFlowItems.archivedAt }).from(cashFlowItems).where(inArray(cashFlowItems.id, [...new Set(lines.map(l => l.cashFlowItemId))]))).map(i => [i.id, i]));
    for (const l of lines) {
      const it = items.get(l.cashFlowItemId);
      if (!it || it.archivedAt) throw new DomainError(422, 'invalid_reference', 'The cash flow item does not exist or is archived');
      if (it.kind !== 'expense') throw new DomainError(422, 'cash_flow_item_kind_mismatch', 'A payment needs an expense cash flow item');
    }
    const [cp] = await db.select({ archivedAt: companies.archivedAt }).from(companies).where(eq(companies.id, doc.counterpartyId)).limit(1);
    if (!cp || cp.archivedAt) throw new DomainError(422, 'invalid_reference', 'The counterparty does not exist or is archived');
  },
  post: async (db, _ctx, doc) => {
    const [t] = await db.select({ s: sql<string>`coalesce(sum(${paymentLines.amount}), 0)::text` }).from(paymentLines).where(eq(paymentLines.documentId, doc.id));
    await db.update(documents).set({ amountNet: fmt(dec(t!.s), 2), vatTotal: '0.00', total: fmt(dec(t!.s), 2) }).where(eq(documents.id, doc.id));
  },
  afterPost: async (db, _ctx, doc) => {
    await db.update(documents).set({ state: 'pending' }).where(eq(documents.id, doc.id));
  },
  // снять с согласования можно, пока заявка не согласована
  beforeUnpost: async (_db, _ctx, doc) => {
    if (doc.state !== 'pending' && doc.state !== 'rejected') throw new DomainError(409, 'request_not_editable', 'An approved or paid request cannot be unposted');
  },
  afterUnpost: async (db, _ctx, doc) => {
    await db.update(documents).set({ state: null }).where(eq(documents.id, doc.id));
  },
};

/** Состояния заявки фиксированные; согласовать и отклонить может admin и выше, «оплачена» ставит только оплата */
STATE_PROVIDERS.payment_request = {
  states: async (): Promise<DynamicStateDef[]> => REQUEST_STATES.map(key => ({ key, label: key, final: key === 'paid' })),
  canTransition: (from, to, ctx) => {
    if (!from || !requestTransitions(from.key).includes(to.key as never)) return { ok: false, message: `Cannot change the state from "${from?.key ?? 'none'}" to "${to.key}"` };
    if (to.key !== 'pending' && ctx.role !== 'owner' && ctx.role !== 'admin') return { ok: false, message: 'Only an admin can approve or reject a payment request' };
    return { ok: true };
  },
};

/* ---------------- оплата на основании ---------------- */

export async function createPaymentFromRequest(db: Db, ctx: DocCtx, requestId: string, account: 'cash' | 'bank'): Promise<string> {
  const req = await loadRequest(db, requestId, true);
  if (req.status !== 'posted' || req.state !== 'approved') throw new DomainError(422, 'request_not_approved', 'The payment request must be approved before it is paid');
  const { posted, draft } = await requestPaidAmounts(db, requestId);
  const remaining = dec(req.total) - posted - draft;
  if (remaining <= 0n) throw new DomainError(422, 'nothing_to_pay', 'Nothing left to pay for this request');
  const lines = await db.select().from(paymentLines).where(eq(paymentLines.documentId, requestId)).orderBy(asc(paymentLines.sortOrder), asc(paymentLines.createdAt));
  const byId = new Map(lines.map(l => [l.id, l]));
  const alloc = allocateRequest(lines.map(l => ({ id: l.id, amount: l.amount })), fmt(remaining, 2));
  return createPayment(db, ctx, {
    type: account === 'cash' ? 'cash_payment' : 'bank_payment',
    operation: req.operation,
    organizationId: req.organizationId,
    counterpartyId: req.counterpartyId,
    investmentProjectId: req.investmentProjectId,
    basedOnId: requestId,
    comment: req.comment,
    lines: alloc.map(a => {
      const l = byId.get(a.id)!;
      return { settlementDocumentId: l.settlementDocumentId, contractId: l.contractId, cashFlowItemId: l.cashFlowItemId, costItemId: l.costItemId, investmentProjectId: l.investmentProjectId, amount: a.amount, comment: l.comment } as PaymentLineInput;
    }),
  });
}

/* ---------------- карточка и журнал ---------------- */

export async function requestDetail(db: Db, id: string) {
  const doc = await loadRequest(db, id);
  const lines = await db.select().from(paymentLines).where(eq(paymentLines.documentId, id)).orderBy(asc(paymentLines.sortOrder), asc(paymentLines.createdAt));
  const [cp] = doc.counterpartyId ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, doc.counterpartyId)).limit(1) : [];
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, doc.organizationId)).limit(1);
  const settleIds = [...new Set(lines.map(l => l.settlementDocumentId).filter((x): x is string => !!x))];
  const settle = new Map((settleIds.length ? await db.select({ id: documents.id, type: documents.type, number: documents.number, date: documents.date }).from(documents).where(inArray(documents.id, settleIds)) : []).map(d => [d.id, d]));
  const itemIds = [...new Set(lines.map(l => l.cashFlowItemId))];
  const items = new Map((itemIds.length ? await db.select({ id: cashFlowItems.id, name: cashFlowItems.name }).from(cashFlowItems).where(inArray(cashFlowItems.id, itemIds)) : []).map(i => [i.id, i.name]));
  const conIds = [...new Set(lines.map(l => l.contractId).filter((x): x is string => !!x))];
  const cons = new Map((conIds.length ? await db.select({ id: contracts.id, number: contracts.number }).from(contracts).where(inArray(contracts.id, conIds)) : []).map(c => [c.id, c.number]));
  const payments = await db.select({ id: documents.id, type: documents.type, number: documents.number, date: documents.date, status: documents.status, total: documents.total }).from(documents).where(and(eq(documents.basedOnId, id), inArray(documents.type, ['cash_payment', 'bank_payment']))).orderBy(asc(documents.createdAt));
  const { posted, draft } = await requestPaidAmounts(db, id);
  return {
    ...doc,
    organizationName: org?.name ?? null,
    counterparty: cp ?? null,
    paid: fmt(posted, 2),
    remaining: fmt(dec(doc.total) - posted, 2),
    /** Остаток, под который ещё нет ни проведённой оплаты, ни черновика */
    payable: fmt(dec(doc.total) - posted - draft, 2),
    payments,
    lines: lines.map(l => ({
      ...l,
      settlementDocument: l.settlementDocumentId ? (settle.get(l.settlementDocumentId) ?? null) : null,
      cashFlowItemName: items.get(l.cashFlowItemId) ?? '',
      contractNumber: l.contractId ? (cons.get(l.contractId) ?? null) : null,
    })),
  };
}

export interface RequestListParams {
  state?: string;
  counterpartyId?: string;
  from?: string;
  to?: string;
  q?: string;
  limit: number;
  offset: number;
}

export async function listRequests(db: Db, workspaceId: string, p: RequestListParams) {
  const conds = [
    eq(documents.workspaceId, workspaceId),
    eq(documents.type, 'payment_request'),
    p.state === 'draft' ? eq(documents.status, 'draft') : p.state === 'cancelled' ? eq(documents.status, 'cancelled') : p.state ? eq(documents.state, p.state) : undefined,
    p.counterpartyId ? eq(documents.counterpartyId, p.counterpartyId) : undefined,
    p.from ? gte(documents.date, p.from) : undefined,
    p.to ? lte(documents.date, p.to) : undefined,
    p.q ? sql`(${documents.comment} ilike ${'%' + p.q + '%'} or ${documents.number} ilike ${'%' + p.q + '%'} or exists (select 1 from companies c where c.id = ${documents.counterpartyId} and c.name ilike ${'%' + p.q + '%'}))` : undefined,
  ];
  const rows = await db.select().from(documents).where(and(...conds)).orderBy(desc(documents.date), desc(documents.createdAt)).limit(p.limit).offset(p.offset);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(...conds));
  const cpIds = [...new Set(rows.map(r => r.counterpartyId).filter((x): x is string => !!x))];
  const cps = new Map((cpIds.length ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, cpIds)) : []).map(c => [c.id, c.name]));
  return {
    items: rows.map(r => ({ id: r.id, number: r.number, date: r.date, dueDate: r.dueDate, status: r.status, state: r.state, operation: r.operation, total: r.total, comment: r.comment, counterpartyId: r.counterpartyId, counterpartyName: r.counterpartyId ? (cps.get(r.counterpartyId) ?? null) : null })),
    total: Number(count?.n ?? 0),
  };
}
