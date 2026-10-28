/* Деньги (задача 1174б): документы оплат (ПКО, РКО, поступление на счёт, списание со счёта), авансовый отчёт, кассы, статьи ДДС,
   движения денег, остатки и отчёты. Правила — docs/architecture/payments.md.
   У документов нет товаров: строки лежат в payment_lines, проведение и нумерация — общие (хуки типа в document-hooks.ts). */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import {
  accountKindOfType,
  defaultCashFlowKey,
  DOCUMENT_LABELS_RU,
  dec,
  fmt,
  INTERNAL_CASH_FLOW_KEYS,
  isPaymentType,
  isReceiptType,
  operationNeedsAccountable,
  operationNeedsCounterparty,
  operationSettlement,
  operationsOfType,
  PAYABLE_TYPES,
  SYSTEM_CASH_FLOW_ITEMS,
  type Dec,
  type DocumentType,
  type PaymentDocType,
  type CashOrderData,
  type PaymentLineInput,
  type PrintOrganization,
  type SettlementActData,
} from '@gr8r/shared';
import type { Db } from './client';
import { DOCUMENT_HOOKS } from './document-hooks';
import type { DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { investmentOpen } from './investments';
import { applyPayment, applyRefund, payableOf, remainingOf, removeSettlementMoves, settlementCard, settlementRoot, type PayLine, type Side } from './settlements';
import {
  accountableMoves,
  bankAccounts,
  cashFlowItems,
  cashMoves,
  cashRegisters,
  companies,
  contracts,
  costItems,
  documents,
  members,
  organizations,
  paymentLines,
  payrollMoves,

} from './schema';
import { assertPeriodOpen } from './cost-closing';
import { requestPaidAmounts, syncRequestPaid } from './request-paid';

const today = () => new Date().toISOString().slice(0, 10);
const CASH_TYPES = ['cash_receipt', 'cash_payment', 'bank_receipt', 'bank_payment', 'advance_report'] as const;
export type CashDocType = (typeof CASH_TYPES)[number];
const isCashDoc = (t: string): t is CashDocType => (CASH_TYPES as readonly string[]).includes(t);

/* ---------------- справочники ---------------- */

/** Системные статьи ДДС воркспейса (создаются при первом обращении) */
export async function ensureCashFlowItems(db: Db, workspaceId: string): Promise<Map<string, string>> {
  const have = await db.select({ id: cashFlowItems.id, key: cashFlowItems.systemKey }).from(cashFlowItems).where(and(eq(cashFlowItems.workspaceId, workspaceId), sql`${cashFlowItems.systemKey} is not null`));
  const map = new Map(have.map(h => [h.key!, h.id]));
  for (const s of SYSTEM_CASH_FLOW_ITEMS) {
    if (map.has(s.key)) continue;
    // название могло быть занято своей статьёй: тогда системная получает пометку
    const [row] = await db
      .insert(cashFlowItems)
      .values({ workspaceId, name: s.name, kind: s.kind, flowGroup: s.group, systemKey: s.key })
      .onConflictDoNothing()
      .returning({ id: cashFlowItems.id });
    if (row) map.set(s.key, row.id);
    else {
      const [r2] = await db.insert(cashFlowItems).values({ workspaceId, name: `${s.name} (системная)`, kind: s.kind, flowGroup: s.group, systemKey: s.key }).returning({ id: cashFlowItems.id });
      map.set(s.key, r2!.id);
    }
  }
  return map;
}

async function defaultOrganizationId(db: Db): Promise<string> {
  const [o] = await db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.archivedAt)).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
  if (!o) throw new DomainError(422, 'organization_required', 'Add an organization in Settings → Organizations first');
  return o.id;
}

async function defaultAccount(db: Db, organizationId: string, kind: 'cash' | 'bank'): Promise<string | null> {
  if (kind === 'cash') {
    const [c] = await db.select({ id: cashRegisters.id }).from(cashRegisters).where(and(eq(cashRegisters.organizationId, organizationId), isNull(cashRegisters.archivedAt))).orderBy(asc(cashRegisters.createdAt)).limit(1);
    return c?.id ?? null;
  }
  const [b] = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.organizationId, organizationId)).orderBy(desc(bankAccounts.isDefault), asc(bankAccounts.createdAt)).limit(1);
  return b?.id ?? null;
}

/* ---------------- документы: ввод ---------------- */

export interface PaymentInput {
  id?: string;
  type: CashDocType;
  operation?: string | null;
  organizationId?: string | null;
  date?: string;
  cashRegisterId?: string | null;
  bankAccountId?: string | null;
  targetCashRegisterId?: string | null;
  targetBankAccountId?: string | null;
  counterpartyId?: string | null;
  accountableMemberId?: string | null;
  investmentProjectId?: string | null;
  basedOnId?: string | null;
  comment?: string;
  /** Ключ строки банковской выписки (повторный импорт не дублирует документ) */
  bankImportKey?: string | null;
  lines?: PaymentLineInput[];
}

export type DocRow = typeof documents.$inferSelect;

async function loadDoc(db: Db, id: string, lock = false): Promise<DocRow> {
  const q = db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row || !isCashDoc(row.type)) throw new DomainError(404, 'not_found', 'payment document not found');
  return row;
}

function defaultOperation(type: CashDocType): string | null {
  return type === 'advance_report' ? null : operationsOfType(type)[0]!;
}

/** Строки сохраняются списком: существующие по id обновляются, новые добавляются, отсутствующие удаляются */
export async function saveLines(db: Db, ctx: DocCtx, doc: DocRow, inputs: PaymentLineInput[]): Promise<void> {
  const items = await ensureCashFlowItems(db, ctx.workspaceId);
  const receipt = isPaymentType(doc.type) && isReceiptType(doc.type);
  const defaultKey = defaultCashFlowKey(doc.operation);
  const rows: (typeof paymentLines.$inferInsert)[] = [];
  for (const [i, l] of inputs.entries()) {
    if (dec(l.amount) <= 0n) throw new DomainError(422, 'invalid_amount', 'The amount must be greater than zero');
    const lineCompany = l.counterpartyId ?? doc.counterpartyId;
    let settlementDocumentId: string | null = null;
    let contractId = l.contractId ?? null;
    if (l.settlementDocumentId) {
      const [given] = await db.select({ type: documents.type }).from(documents).where(eq(documents.id, l.settlementDocumentId)).limit(1);
      if (!given || !(PAYABLE_TYPES as string[]).includes(given.type)) throw new DomainError(422, 'invalid_settlement_document', 'Select an order, invoice or document that creates the debt');
      const root = await settlementRoot(db, l.settlementDocumentId);
      if (root.status === 'cancelled') throw new DomainError(422, 'invalid_settlement_document', 'The settlement document is cancelled');
      if (root.counterpartyId !== lineCompany) throw new DomainError(422, 'settlement_document_mismatch', 'The settlement document belongs to another counterparty');
      settlementDocumentId = root.id;
      contractId = contractId ?? root.contractId;
    }
    let cashFlowItemId = l.cashFlowItemId ?? null;
    if (!cashFlowItemId) {
      const key = doc.type === 'advance_report' ? (l.counterpartyId ? 'suppliers_payment' : null) : defaultKey;
      cashFlowItemId = key ? (items.get(key) ?? null) : null;
      if (!cashFlowItemId) throw new DomainError(422, 'cash_flow_item_required', 'Select a cash flow item');
    }
    rows.push({
      id: l.id,
      workspaceId: ctx.workspaceId,
      documentId: doc.id,
      sortOrder: i,
      counterpartyId: doc.type === 'advance_report' ? (l.counterpartyId ?? null) : null,
      memberId: doc.operation === 'salary_payment' ? (l.memberId ?? null) : null,
      settlementDocumentId,
      contractId,
      amount: fmt(dec(l.amount), 2),
      cashFlowItemId,
      costItemId: l.costItemId ?? null,
      investmentProjectId: l.investmentProjectId ?? null,
      comment: l.comment?.trim() ?? '',
    });
  }
  void receipt;
  const existing = new Set((await db.select({ id: paymentLines.id }).from(paymentLines).where(eq(paymentLines.documentId, doc.id))).map(r => r.id));
  const keep = new Set(rows.map(r => r.id).filter((x): x is string => !!x));
  const drop = [...existing].filter(id => !keep.has(id));
  if (drop.length) await db.delete(paymentLines).where(inArray(paymentLines.id, drop));
  for (const r of rows) {
    if (r.id && existing.has(r.id)) {
      const { id, workspaceId: _w, documentId: _d, ...set } = r;
      await db.update(paymentLines).set(set).where(eq(paymentLines.id, id));
    } else await db.insert(paymentLines).values(r);
  }
  const total = rows.reduce((s, r) => s + dec(r.amount as string), 0n);
  await db.update(documents).set({ amountNet: fmt(total, 2), vatTotal: '0.00', total: fmt(total, 2), updatedAt: new Date() }).where(eq(documents.id, doc.id));
}

export async function createPayment(db: Db, ctx: DocCtx, input: PaymentInput): Promise<string> {
  if (!isCashDoc(input.type)) throw new DomainError(422, 'invalid_type', 'Unknown payment document type');
  const organizationId = input.organizationId ?? (await defaultOrganizationId(db));
  const operation = input.type === 'advance_report' ? null : (input.operation ?? defaultOperation(input.type));
  if (operation && !(operationsOfType(input.type as PaymentDocType) as readonly string[]).includes(operation)) throw new DomainError(422, 'invalid_operation', 'This operation is not available for the document type');
  const kind = input.type === 'advance_report' ? null : accountKindOfType(input.type as PaymentDocType);
  const cashRegisterId = kind === 'cash' ? (input.cashRegisterId ?? (await defaultAccount(db, organizationId, 'cash'))) : null;
  const bankAccountId = kind === 'bank' ? (input.bankAccountId ?? (await defaultAccount(db, organizationId, 'bank'))) : null;
  const date = input.date ?? today();
  if (input.basedOnId) await assertPayableBase(db, input.basedOnId);
  const [row] = await db
    .insert(documents)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      type: input.type,
      date,
      operation,
      organizationId,
      counterpartyId: input.counterpartyId ?? null,
      cashRegisterId,
      bankAccountId,
      targetCashRegisterId: operation === 'money_transfer' ? (input.targetCashRegisterId ?? null) : null,
      targetBankAccountId: operation === 'money_transfer' ? (input.targetBankAccountId ?? null) : null,
      accountableMemberId: input.accountableMemberId ?? null,
      investmentProjectId: input.investmentProjectId ?? null,
      basedOnId: input.basedOnId ?? null,
      comment: input.comment ?? '',
      bankImportKey: input.bankImportKey ?? null,
      responsibleId: ctx.memberId,
      createdBy: ctx.memberId,
    })
    .returning();
  if (input.lines?.length) await saveLines(db, ctx, row!, input.lines);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: row!.id, actorId: ctx.memberId, payload: { documentType: input.type } });
  return row!.id;
}

async function assertPayableBase(db: Db, baseId: string): Promise<void> {
  const [b] = await db.select({ type: documents.type, status: documents.status }).from(documents).where(eq(documents.id, baseId)).limit(1);
  if (b?.type === 'payment_request' || b?.type === 'payroll_statement') return; // заявка и ведомость: состояние проверяется при проведении оплаты
  if (!b || !(PAYABLE_TYPES as string[]).includes(b.type)) throw new DomainError(422, 'invalid_based_on', 'This document cannot be a basis for a payment');
  if (b.status === 'cancelled') throw new DomainError(422, 'invalid_based_on', 'A cancelled document cannot be a basis');
}

export async function updatePayment(db: Db, ctx: DocCtx, id: string, patch: Partial<Omit<PaymentInput, 'id' | 'type'>>): Promise<void> {
  const doc = await loadDoc(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only a draft can be edited: unpost the document first');
  if (patch.date && patch.date !== doc.date) await assertPeriodOpen(db, ctx.workspaceId, patch.date);
  if (patch.operation !== undefined && patch.operation !== null && doc.type !== 'advance_report' && !(operationsOfType(doc.type as PaymentDocType) as readonly string[]).includes(patch.operation))
    throw new DomainError(422, 'invalid_operation', 'This operation is not available for the document type');
  if (doc.numberSeq !== null && patch.organizationId && patch.organizationId !== doc.organizationId) throw new DomainError(422, 'number_locked', 'The document has a number: the organization cannot be changed');
  if (patch.basedOnId) await assertPayableBase(db, patch.basedOnId);
  const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  if (patch.operation !== undefined && patch.operation !== null) set.operation = patch.operation;
  if (patch.organizationId) set.organizationId = patch.organizationId;
  if (patch.date) set.date = patch.date;
  if (patch.cashRegisterId !== undefined) set.cashRegisterId = patch.cashRegisterId;
  if (patch.bankAccountId !== undefined) set.bankAccountId = patch.bankAccountId;
  if (patch.targetCashRegisterId !== undefined) set.targetCashRegisterId = patch.targetCashRegisterId;
  if (patch.targetBankAccountId !== undefined) set.targetBankAccountId = patch.targetBankAccountId;
  if (patch.counterpartyId !== undefined) set.counterpartyId = patch.counterpartyId;
  if (patch.accountableMemberId !== undefined) set.accountableMemberId = patch.accountableMemberId;
  if (patch.investmentProjectId !== undefined) set.investmentProjectId = patch.investmentProjectId;
  if (patch.basedOnId !== undefined) set.basedOnId = patch.basedOnId;
  if (patch.comment !== undefined) set.comment = patch.comment;
  const [row] = await db.update(documents).set(set).where(eq(documents.id, id)).returning();
  if (patch.lines) await saveLines(db, ctx, row!, patch.lines);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: doc.type } });
}

/** Оплата на основании документа: счёт, заказ, реализация, акт, заказ-наряд, поступление, возврат — с остатком к оплате */
export async function createPaymentFromDocument(db: Db, ctx: DocCtx, documentId: string, account: 'cash' | 'bank'): Promise<string> {
  const [src] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!src || !(PAYABLE_TYPES as string[]).includes(src.type)) throw new DomainError(422, 'not_payable', 'Payments are created from orders, invoices and documents that create a debt');
  if (src.status === 'cancelled') throw new DomainError(422, 'invalid_based_on', 'A cancelled document cannot be a basis');
  const info = await payableOf(db, documentId);
  if (!info) throw new DomainError(422, 'not_payable', 'The document has no counterparty');
  const supplier = info.status.side === 'supplier';
  const isReturn = src.type === 'customer_return' || src.type === 'supplier_return';
  // возврат: деньги идут в обратную сторону на сумму возврата; остальные документы — на остаток к оплате
  const receipt = isReturn ? supplier : !supplier;
  const operation = isReturn ? (supplier ? 'supplier_refund' : 'customer_refund') : supplier ? 'to_supplier' : 'from_customer';
  const amount = isReturn ? dec(src.total) : dec(info.status.remaining);
  if (amount <= 0n) throw new DomainError(422, 'nothing_to_pay', 'Nothing left to pay for this document');
  const type = (receipt ? (account === 'cash' ? 'cash_receipt' : 'bank_receipt') : account === 'cash' ? 'cash_payment' : 'bank_payment') as CashDocType;
  return createPayment(db, ctx, {
    type,
    operation,
    organizationId: src.organizationId,
    counterpartyId: info.counterpartyId,
    basedOnId: documentId,
    comment: '',
    lines: [{ settlementDocumentId: info.status.rootId, contractId: info.contractId ?? undefined, amount: fmt(amount, 2), comment: '' } as PaymentLineInput],
  });
}

/* ---------------- проверки и проведение ---------------- */

async function linesOf(db: Db, docId: string) {
  return db.select().from(paymentLines).where(eq(paymentLines.documentId, docId)).orderBy(asc(paymentLines.sortOrder), asc(paymentLines.createdAt));
}

async function assertAccounts(db: Db, doc: DocRow): Promise<void> {
  if (doc.type === 'advance_report') return;
  const kind = accountKindOfType(doc.type as PaymentDocType);
  if (kind === 'cash') {
    if (!doc.cashRegisterId) throw new DomainError(422, 'account_required', 'Select a cash register');
    const [c] = await db.select({ org: cashRegisters.organizationId, archivedAt: cashRegisters.archivedAt }).from(cashRegisters).where(eq(cashRegisters.id, doc.cashRegisterId)).limit(1);
    if (!c || c.archivedAt) throw new DomainError(422, 'invalid_reference', 'The cash register does not exist or is archived');
    if (c.org !== doc.organizationId) throw new DomainError(422, 'account_organization_mismatch', 'The cash register belongs to another organization');
  } else {
    if (!doc.bankAccountId) throw new DomainError(422, 'account_required', 'Select a bank account');
    const [b] = await db.select({ org: bankAccounts.organizationId }).from(bankAccounts).where(eq(bankAccounts.id, doc.bankAccountId)).limit(1);
    if (!b) throw new DomainError(422, 'invalid_reference', 'The bank account does not exist');
    if (b.org !== doc.organizationId) throw new DomainError(422, 'account_organization_mismatch', 'The bank account belongs to the counterparty or to another organization');
  }
  if (doc.operation === 'money_transfer') {
    const t = (doc.targetCashRegisterId ? 1 : 0) + (doc.targetBankAccountId ? 1 : 0);
    if (t !== 1) throw new DomainError(422, 'target_account_required', 'Select the cash register or bank account the money goes to');
    if ((doc.targetCashRegisterId && doc.targetCashRegisterId === doc.cashRegisterId) || (doc.targetBankAccountId && doc.targetBankAccountId === doc.bankAccountId))
      throw new DomainError(422, 'target_account_required', 'The target account must differ from the source account');
  }
}

async function checkPosting(db: Db, doc: DocRow): Promise<void> {
  const lines = await linesOf(db, doc.id);
  if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one line before posting');
  await assertAccounts(db, doc);
  const advance = doc.type === 'advance_report';
  if (!advance) {
    if (operationNeedsCounterparty(doc.operation) && !doc.counterpartyId) throw new DomainError(422, 'counterparty_required', 'Select a counterparty before posting');
    if (operationNeedsAccountable(doc.operation) && !doc.accountableMemberId) throw new DomainError(422, 'accountable_required', 'Select the accountable person before posting');
  } else if (!doc.accountableMemberId) throw new DomainError(422, 'accountable_required', 'Select the accountable person before posting');
  if (doc.counterpartyId) {
    const [c] = await db.select({ id: companies.id, archivedAt: companies.archivedAt }).from(companies).where(eq(companies.id, doc.counterpartyId)).limit(1);
    if (!c || c.archivedAt) throw new DomainError(422, 'invalid_reference', 'The counterparty does not exist or is archived');
  }
  await checkRequestBase(db, doc, lines.reduce((s, l) => s + dec(l.amount), 0n));
  if (doc.operation === 'salary_payment') await checkSalaryPayment(db, doc, lines);
  const itemIds = [...new Set(lines.map(l => l.cashFlowItemId))];
  const items = new Map((await db.select({ id: cashFlowItems.id, kind: cashFlowItems.kind, archivedAt: cashFlowItems.archivedAt }).from(cashFlowItems).where(inArray(cashFlowItems.id, itemIds))).map(i => [i.id, i]));
  const incoming = !advance && isReceiptType(doc.type as PaymentDocType);
  for (const l of lines) {
    const item = items.get(l.cashFlowItemId);
    if (!item || item.archivedAt) throw new DomainError(422, 'invalid_reference', 'The cash flow item does not exist or is archived');
    if (doc.operation !== 'money_transfer' && item.kind !== (incoming ? 'income' : 'expense')) throw new DomainError(422, 'cash_flow_item_kind_mismatch', incoming ? 'A receipt needs an income cash flow item' : 'A payment needs an expense cash flow item');
    if (advance) {
      if (!l.counterpartyId && !l.costItemId) throw new DomainError(422, 'cost_item_required', 'An expense line of an advance report needs a cost item; a supplier payment needs the supplier');
    } else if (operationSettlement(doc.operation)) {
      const need = doc.counterpartyId;
      if (l.settlementDocumentId) {
        const root = await settlementRoot(db, l.settlementDocumentId);
        if (root.counterpartyId !== need) throw new DomainError(422, 'settlement_document_mismatch', 'The settlement document belongs to another counterparty');
        // расчёты с контрагентом по документам: основание должно быть проведено или быть предоплатой (проверяется общим кодом документов)
      }
    }
    const inv = l.investmentProjectId ?? doc.investmentProjectId;
    if (inv && !(await investmentOpen(db, inv))) throw new DomainError(422, 'investment_closed', 'The investment project is closed or archived: unlink it before posting');
    if (l.costItemId) {
      const [ci] = await db.select({ id: costItems.id, archivedAt: costItems.archivedAt }).from(costItems).where(eq(costItems.id, l.costItemId)).limit(1);
      if (!ci || ci.archivedAt) throw new DomainError(422, 'invalid_reference', 'The cost item does not exist or is archived');
    }
  }
}

/** Оплата на основании заявки: заявка согласована (или уже частично оплачена), общая сумма оплат не больше суммы заявки */
async function checkRequestBase(db: Db, doc: DocRow, total: bigint): Promise<void> {
  if (!doc.basedOnId) return;
  const [req] = await db.select({ type: documents.type, state: documents.state, total: documents.total }).from(documents).where(eq(documents.id, doc.basedOnId)).limit(1);
  if (req?.type !== 'payment_request') return;
  if (req.state !== 'approved') throw new DomainError(422, 'request_not_approved', 'The payment request must be approved before it is paid');
  const { posted } = await requestPaidAmounts(db, doc.basedOnId);
  if (posted + total > dec(req.total)) throw new DomainError(422, 'over_request', 'The payments exceed the amount of the payment request');
}

async function writeMoves(db: Db, ctx: DocCtx, doc: DocRow): Promise<void> {
  const lines = await linesOf(db, doc.id);
  const keys = await ensureCashFlowItems(db, ctx.workspaceId);
  const total = lines.reduce((s, l) => s + dec(l.amount), 0n);
  await db.update(documents).set({ amountNet: fmt(total, 2), vatTotal: '0.00', total: fmt(total, 2), updatedAt: new Date() }).where(eq(documents.id, doc.id));
  const base = { workspaceId: ctx.workspaceId, documentId: doc.id, date: doc.date };
  if (doc.type === 'advance_report') {
    for (const l of lines) {
      await db.insert(cashMoves).values({ ...base, lineId: l.id, accountKind: 'accountable', memberId: doc.accountableMemberId, cashFlowItemId: l.cashFlowItemId, direction: 'out', amount: l.amount, investmentProjectId: l.investmentProjectId ?? doc.investmentProjectId, costItemId: l.costItemId });
      if (l.counterpartyId) await applyPayment(db, ctx.workspaceId, 'supplier', doc, toPayLine(l, l.counterpartyId));
    }
    await db.insert(accountableMoves).values({ workspaceId: ctx.workspaceId, memberId: doc.accountableMemberId!, documentId: doc.id, date: doc.date, amount: fmt(-total, 2) });
    return;
  }
  const incoming = isReceiptType(doc.type as PaymentDocType);
  const kind = accountKindOfType(doc.type as PaymentDocType);
  const source = kind === 'cash' ? { accountKind: 'cash' as const, cashRegisterId: doc.cashRegisterId } : { accountKind: 'bank' as const, bankAccountId: doc.bankAccountId };
  const settle = operationSettlement(doc.operation);
  for (const l of lines) {
    const common = { ...base, lineId: l.id, amount: l.amount, investmentProjectId: l.investmentProjectId ?? doc.investmentProjectId, costItemId: l.costItemId };
    if (doc.operation === 'money_transfer') {
      await db.insert(cashMoves).values({ ...common, ...source, cashFlowItemId: keys.get('transfer_out')!, direction: 'out', investmentProjectId: null, costItemId: null });
      const target = doc.targetCashRegisterId ? { accountKind: 'cash' as const, cashRegisterId: doc.targetCashRegisterId } : { accountKind: 'bank' as const, bankAccountId: doc.targetBankAccountId };
      await db.insert(cashMoves).values({ ...common, ...target, cashFlowItemId: keys.get('transfer_in')!, direction: 'in', investmentProjectId: null, costItemId: null });
      continue;
    }
    await db.insert(cashMoves).values({ ...common, ...source, cashFlowItemId: l.cashFlowItemId, direction: incoming ? 'in' : 'out' });
    if (doc.operation === 'salary_payment') await db.insert(payrollMoves).values({ workspaceId: ctx.workspaceId, memberId: l.memberId!, documentId: doc.id, lineId: l.id, date: doc.date, kind: 'payment', amount: fmt(-dec(l.amount), 2) });
    if (settle) {
      const pl = toPayLine(l, doc.counterpartyId!);
      if (settle.mode === 'pay') await applyPayment(db, ctx.workspaceId, settle.side, doc, pl);
      else await applyRefund(db, ctx.workspaceId, settle.side, doc, pl);
    }
  }
  if (doc.operation === 'to_accountable') await db.insert(accountableMoves).values({ workspaceId: ctx.workspaceId, memberId: doc.accountableMemberId!, documentId: doc.id, date: doc.date, amount: fmt(total, 2) });
  if (doc.operation === 'from_accountable') await db.insert(accountableMoves).values({ workspaceId: ctx.workspaceId, memberId: doc.accountableMemberId!, documentId: doc.id, date: doc.date, amount: fmt(-total, 2) });
}

/** Повтор взаиморасчётов проведённой оплаты по одному контрагенту (смена режима расчётов): те же вызовы, что при проведении, но только строки этого контрагента */
export async function replayPaymentSettlements(db: Db, workspaceId: string, doc: DocRow, companyId: string): Promise<void> {
  const lines = await linesOf(db, doc.id);
  if (doc.type === 'advance_report') {
    for (const l of lines) if (l.counterpartyId === companyId) await applyPayment(db, workspaceId, 'supplier', doc, toPayLine(l, companyId));
    return;
  }
  const settle = operationSettlement(doc.operation);
  if (!settle || doc.counterpartyId !== companyId) return;
  for (const l of lines) {
    if (settle.mode === 'pay') await applyPayment(db, workspaceId, settle.side, doc, toPayLine(l, companyId));
    else await applyRefund(db, workspaceId, settle.side, doc, toPayLine(l, companyId));
  }
}

/** Выплата зарплаты: у каждой строки сотрудник; на основании ведомости — ведомость проведена и выплаты не превышают её сумму */
async function checkSalaryPayment(db: Db, doc: DocRow, lines: (typeof paymentLines.$inferSelect)[]): Promise<void> {
  if (lines.some(l => !l.memberId)) throw new DomainError(422, 'member_required', 'Select an employee in every line of a salary payment');
  if (!doc.basedOnId) return;
  const [st] = await db.select({ type: documents.type, status: documents.status, total: documents.total }).from(documents).where(eq(documents.id, doc.basedOnId)).limit(1);
  if (st?.type !== 'payroll_statement') return;
  if (st.status !== 'posted') throw new DomainError(422, 'statement_not_posted', 'Post the payroll statement before paying it');
  const [other] = await db
    .select({ s: sql<string>`coalesce(sum(${paymentLines.amount}), 0)::text` })
    .from(paymentLines)
    .innerJoin(documents, eq(documents.id, paymentLines.documentId))
    .where(and(eq(documents.basedOnId, doc.basedOnId), eq(documents.status, 'posted'), ne(documents.id, doc.id)));
  const total = lines.reduce((s, l) => s + dec(l.amount), 0n);
  if (dec(other?.s ?? '0') + total > dec(st.total)) throw new DomainError(422, 'over_statement', 'The payments exceed the amount of the payroll statement');
}

const toPayLine = (l: typeof paymentLines.$inferSelect, companyId: string): PayLine => ({ id: l.id, companyId, settlementDocumentId: l.settlementDocumentId, contractId: l.contractId, amount: dec(l.amount) });

async function clearMoves(db: Db, ctx: DocCtx, docId: string): Promise<void> {
  await db.delete(cashMoves).where(eq(cashMoves.documentId, docId));
  await db.delete(accountableMoves).where(eq(accountableMoves.documentId, docId));
  await db.delete(payrollMoves).where(eq(payrollMoves.documentId, docId));
  await removeSettlementMoves(db, ctx.workspaceId, docId);
}

for (const type of CASH_TYPES) {
  DOCUMENT_HOOKS[type as DocumentType] = {
    check: async (db, _ctx, doc) => checkPosting(db, doc),
    post: async (db, ctx, doc) => writeMoves(db, ctx, doc),
    afterPost: async (db, ctx, doc) => {
      const lines = await linesOf(db, doc.id);
      if (doc.basedOnId) await syncRequestPaid(db, ctx, doc.basedOnId);
      const [fresh] = await db.select({ total: documents.total, number: documents.number }).from(documents).where(eq(documents.id, doc.id)).limit(1);
      await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.payment_posted', entity: 'document', recordId: doc.id, actorId: ctx.memberId, payload: { documentType: doc.type, operation: doc.operation, total: fresh?.total, number: fresh?.number } });
      // документы расчётов, оплаченные полностью этим документом
      for (const rootId of new Set(lines.map(l => l.settlementDocumentId).filter((x): x is string => !!x))) {
        const remaining = await remainingOf(db, rootId);
        await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.paid', entity: 'document', recordId: rootId, actorId: ctx.memberId, payload: { paymentId: doc.id, changes: { remaining: { to: remaining } }, remaining, paid: dec(remaining) === 0n } });
      }
    },
    afterUnpost: async (db, ctx, doc) => {
      await clearMoves(db, ctx, doc.id);
      if (doc.basedOnId) await syncRequestPaid(db, ctx, doc.basedOnId);
    },
  };
}

/* ---------------- карточка и журнал ---------------- */

async function accountLabels(db: Db, ids: { cash: (string | null)[]; bank: (string | null)[] }) {
  const cash = ids.cash.filter((x): x is string => !!x);
  const bank = ids.bank.filter((x): x is string => !!x);
  const c = cash.length ? await db.select({ id: cashRegisters.id, name: cashRegisters.name }).from(cashRegisters).where(inArray(cashRegisters.id, cash)) : [];
  const b = bank.length ? await db.select({ id: bankAccounts.id, name: bankAccounts.bankName, account: bankAccounts.account }).from(bankAccounts).where(inArray(bankAccounts.id, bank)) : [];
  return { cash: new Map(c.map(r => [r.id, r.name])), bank: new Map(b.map(r => [r.id, `${r.name} · ${r.account.slice(-4)}`])) };
}

/** Остаток кассы или счёта на дату (включительно) по проведённым движениям */
export async function accountBalance(db: Db, kind: 'cash' | 'bank', id: string, asOf: string): Promise<Dec> {
  const col = kind === 'cash' ? cashMoves.cashRegisterId : cashMoves.bankAccountId;
  const [r] = await db
    .select({ s: sql<string>`coalesce(sum(case when ${cashMoves.direction} = 'in' then ${cashMoves.amount} else -${cashMoves.amount} end), 0)::text` })
    .from(cashMoves)
    .where(and(eq(col, id), lte(cashMoves.date, asOf)));
  return dec(r?.s ?? '0');
}

export async function paymentDetail(db: Db, id: string) {
  const doc = await loadDoc(db, id);
  const lines = await linesOf(db, id);
  const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, doc.organizationId)).limit(1);
  const [cp] = doc.counterpartyId ? await db.select({ id: companies.id, name: companies.name, settlementMode: companies.settlementMode }).from(companies).where(eq(companies.id, doc.counterpartyId)).limit(1) : [];
  const [mem] = doc.accountableMemberId ? await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.id, doc.accountableMemberId)).limit(1) : [];
  const acc = await accountLabels(db, { cash: [doc.cashRegisterId, doc.targetCashRegisterId], bank: [doc.bankAccountId, doc.targetBankAccountId] });
  const settleIds = [...new Set(lines.map(l => l.settlementDocumentId).filter((x): x is string => !!x))];
  const settle = new Map((settleIds.length ? await db.select({ id: documents.id, type: documents.type, number: documents.number, date: documents.date }).from(documents).where(inArray(documents.id, settleIds)) : []).map(d => [d.id, d]));
  const itemIds = [...new Set(lines.map(l => l.cashFlowItemId))];
  const items = new Map((itemIds.length ? await db.select({ id: cashFlowItems.id, name: cashFlowItems.name }).from(cashFlowItems).where(inArray(cashFlowItems.id, itemIds)) : []).map(i => [i.id, i.name]));
  const costIds = [...new Set(lines.map(l => l.costItemId).filter((x): x is string => !!x))];
  const costs = new Map((costIds.length ? await db.select({ id: costItems.id, name: costItems.name }).from(costItems).where(inArray(costItems.id, costIds)) : []).map(i => [i.id, i.name]));
  const cpIds = [...new Set(lines.map(l => l.counterpartyId).filter((x): x is string => !!x))];
  const cps = new Map((cpIds.length ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, cpIds)) : []).map(c => [c.id, c.name]));
  const conIds = [...new Set(lines.map(l => l.contractId).filter((x): x is string => !!x))];
  const cons = new Map((conIds.length ? await db.select({ id: contracts.id, number: contracts.number }).from(contracts).where(inArray(contracts.id, conIds)) : []).map(c => [c.id, c.number]));
  const [base] = doc.basedOnId ? await db.select({ id: documents.id, type: documents.type, number: documents.number, status: documents.status, date: documents.date }).from(documents).where(eq(documents.id, doc.basedOnId)).limit(1) : [];
  // предупреждение: касса или счёт уходит в минус на дату документа (не запрет)
  const warnings: string[] = [];
  if (doc.type !== 'advance_report' && !isReceiptType(doc.type as PaymentDocType) && doc.status !== 'cancelled') {
    const kind = accountKindOfType(doc.type as PaymentDocType);
    const accId = kind === 'cash' ? doc.cashRegisterId : doc.bankAccountId;
    if (accId) {
      let bal = await accountBalance(db, kind, accId, doc.date);
      if (doc.status === 'draft') bal -= lines.reduce((s, l) => s + dec(l.amount), 0n);
      if (bal < 0n) warnings.push('negative_balance');
    }
  }
  return {
    ...doc,
    organizationName: org?.name ?? null,
    counterparty: cp ?? null,
    accountable: mem ?? null,
    cashRegisterName: doc.cashRegisterId ? (acc.cash.get(doc.cashRegisterId) ?? null) : null,
    bankAccountName: doc.bankAccountId ? (acc.bank.get(doc.bankAccountId) ?? null) : null,
    targetName: doc.targetCashRegisterId ? (acc.cash.get(doc.targetCashRegisterId) ?? null) : doc.targetBankAccountId ? (acc.bank.get(doc.targetBankAccountId) ?? null) : null,
    basedOn: base ?? null,
    warnings,
    lines: lines.map(l => ({
      ...l,
      settlementDocument: l.settlementDocumentId ? (settle.get(l.settlementDocumentId) ?? null) : null,
      cashFlowItemName: items.get(l.cashFlowItemId) ?? '',
      costItemName: l.costItemId ? (costs.get(l.costItemId) ?? null) : null,
      counterpartyName: l.counterpartyId ? (cps.get(l.counterpartyId) ?? null) : null,
      contractNumber: l.contractId ? (cons.get(l.contractId) ?? null) : null,
    })),
  };
}

export interface PaymentListParams {
  types?: string[];
  status?: string[];
  counterpartyId?: string;
  cashRegisterId?: string;
  bankAccountId?: string;
  from?: string;
  to?: string;
  q?: string;
  limit: number;
  offset: number;
}

export async function listPayments(db: Db, workspaceId: string, p: PaymentListParams) {
  const types = (p.types?.length ? p.types : [...CASH_TYPES]).filter(isCashDoc);
  const conds = [
    eq(documents.workspaceId, workspaceId),
    inArray(documents.type, types),
    p.status?.length ? inArray(documents.status, p.status as ('draft' | 'posted' | 'cancelled')[]) : undefined,
    p.counterpartyId ? eq(documents.counterpartyId, p.counterpartyId) : undefined,
    p.cashRegisterId ? eq(documents.cashRegisterId, p.cashRegisterId) : undefined,
    p.bankAccountId ? eq(documents.bankAccountId, p.bankAccountId) : undefined,
    p.from ? gte(documents.date, p.from) : undefined,
    p.to ? lte(documents.date, p.to) : undefined,
    p.q ? sql`(${documents.comment} ilike ${'%' + p.q + '%'} or ${documents.number} ilike ${'%' + p.q + '%'} or exists (select 1 from companies c where c.id = ${documents.counterpartyId} and c.name ilike ${'%' + p.q + '%'}))` : undefined,
  ];
  const rows = await db.select().from(documents).where(and(...conds)).orderBy(desc(documents.date), desc(documents.createdAt)).limit(p.limit).offset(p.offset);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(...conds));
  const [tot] = await db
    .select({
      incoming: sql<string>`coalesce(sum(${documents.total}) filter (where ${documents.type} in ('cash_receipt','bank_receipt') and ${documents.status} <> 'cancelled'), 0)::text`,
      outgoing: sql<string>`coalesce(sum(${documents.total}) filter (where ${documents.type} in ('cash_payment','bank_payment') and ${documents.status} <> 'cancelled'), 0)::text`,
    })
    .from(documents)
    .where(and(...conds));
  const acc = await accountLabels(db, { cash: rows.map(r => r.cashRegisterId), bank: rows.map(r => r.bankAccountId) });
  const cpIds = [...new Set(rows.map(r => r.counterpartyId).filter((x): x is string => !!x))];
  const cps = new Map((cpIds.length ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, cpIds)) : []).map(c => [c.id, c.name]));
  const memIds = [...new Set(rows.map(r => r.accountableMemberId).filter((x): x is string => !!x))];
  const mems = new Map((memIds.length ? await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, memIds)) : []).map(m => [m.id, m.name]));
  return {
    items: rows.map(r => ({
      id: r.id,
      type: r.type,
      number: r.number,
      date: r.date,
      status: r.status,
      operation: r.operation,
      total: r.total,
      comment: r.comment,
      counterpartyId: r.counterpartyId,
      counterpartyName: r.counterpartyId ? (cps.get(r.counterpartyId) ?? null) : r.accountableMemberId ? (mems.get(r.accountableMemberId) ?? null) : null,
      accountName: r.cashRegisterId ? (acc.cash.get(r.cashRegisterId) ?? null) : r.bankAccountId ? (acc.bank.get(r.bankAccountId) ?? null) : null,
    })),
    total: Number(count?.n ?? 0),
    incoming: fmt(dec(tot?.incoming ?? '0'), 2),
    outgoing: fmt(dec(tot?.outgoing ?? '0'), 2),
  };
}

/* ---------------- остатки и отчёты ---------------- */

const signed = sql<string>`coalesce(sum(case when ${cashMoves.direction} = 'in' then ${cashMoves.amount} else -${cashMoves.amount} end), 0)::text`;

/** Остатки денег на дату по кассам, счетам организаций и подотчётным лицам */
export async function cashBalances(db: Db, workspaceId: string, asOf: string) {
  const cashRows = await db
    .select({ id: cashMoves.cashRegisterId, s: signed })
    .from(cashMoves)
    .where(and(eq(cashMoves.workspaceId, workspaceId), eq(cashMoves.accountKind, 'cash'), lte(cashMoves.date, asOf)))
    .groupBy(cashMoves.cashRegisterId);
  const bankRows = await db
    .select({ id: cashMoves.bankAccountId, s: signed })
    .from(cashMoves)
    .where(and(eq(cashMoves.workspaceId, workspaceId), eq(cashMoves.accountKind, 'bank'), lte(cashMoves.date, asOf)))
    .groupBy(cashMoves.bankAccountId);
  const registers = await db
    .select({ id: cashRegisters.id, name: cashRegisters.name, organizationId: cashRegisters.organizationId, organizationName: organizations.name })
    .from(cashRegisters)
    .innerJoin(organizations, eq(organizations.id, cashRegisters.organizationId))
    .where(isNull(cashRegisters.archivedAt))
    .orderBy(asc(cashRegisters.name));
  const banks = await db
    .select({ id: bankAccounts.id, bankName: bankAccounts.bankName, account: bankAccounts.account, organizationId: bankAccounts.organizationId, organizationName: organizations.name })
    .from(bankAccounts)
    .innerJoin(organizations, eq(organizations.id, bankAccounts.organizationId))
    .orderBy(asc(organizations.name), asc(bankAccounts.bankName));
  const cashMap = new Map(cashRows.map(r => [r.id!, dec(r.s)]));
  const bankMap = new Map(bankRows.map(r => [r.id!, dec(r.s)]));
  const accountable = await accountableBalances(db, workspaceId, asOf);
  const cash = registers.map(r => ({ id: r.id, name: r.name, organizationId: r.organizationId, organizationName: r.organizationName, balance: fmt(cashMap.get(r.id) ?? 0n, 2) }));
  const bank = banks.map(b => ({ id: b.id, name: `${b.bankName} · ${b.account}`, organizationId: b.organizationId!, organizationName: b.organizationName, balance: fmt(bankMap.get(b.id) ?? 0n, 2) }));
  const totalCash = cash.reduce((s, r) => s + dec(r.balance), 0n);
  const totalBank = bank.reduce((s, r) => s + dec(r.balance), 0n);
  return { asOf, cash, bank, accountable, totals: { cash: fmt(totalCash, 2), bank: fmt(totalBank, 2), all: fmt(totalCash + totalBank, 2) } };
}

/** Подотчётные лица: долг сотрудника (выдано − отчитался − вернул); отрицательное — перерасход, компания должна сотруднику */
export async function accountableBalances(db: Db, workspaceId: string, asOf: string) {
  const rows = await db
    .select({ memberId: accountableMoves.memberId, s: sql<string>`coalesce(sum(${accountableMoves.amount}), 0)::text` })
    .from(accountableMoves)
    .where(and(eq(accountableMoves.workspaceId, workspaceId), lte(accountableMoves.date, asOf)))
    .groupBy(accountableMoves.memberId);
  const names = new Map((rows.length ? await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, rows.map(r => r.memberId))) : []).map(m => [m.id, m.name]));
  return rows.filter(r => dec(r.s) !== 0n).map(r => ({ memberId: r.memberId, name: names.get(r.memberId) ?? '', balance: fmt(dec(r.s), 2) })).sort((a, b) => a.name.localeCompare(b.name));
}

export interface CashFlowParams {
  from: string;
  to: string;
  groupBy: 'item' | 'account' | 'month';
  organizationId?: string;
}

/** Движение денег по статьям ДДС / кассам и счетам / месяцам. Внутренние статьи (перемещение, подотчёт) в разрезах «статья» и «месяц» не участвуют */
export async function cashFlowReport(db: Db, workspaceId: string, p: CashFlowParams) {
  const base = [eq(cashMoves.workspaceId, workspaceId), gte(cashMoves.date, p.from), lte(cashMoves.date, p.to), p.organizationId ? sql`exists (select 1 from documents d where d.id = ${cashMoves.documentId} and d.organization_id = ${p.organizationId})` : undefined];
  const inSum = sql<string>`coalesce(sum(${cashMoves.amount}) filter (where ${cashMoves.direction} = 'in'), 0)::text`;
  const outSum = sql<string>`coalesce(sum(${cashMoves.amount}) filter (where ${cashMoves.direction} = 'out'), 0)::text`;
  const internalIds = (await db.select({ id: cashFlowItems.id }).from(cashFlowItems).where(and(eq(cashFlowItems.workspaceId, workspaceId), inArray(cashFlowItems.systemKey, INTERNAL_CASH_FLOW_KEYS)))).map(r => r.id);
  const notInternal = internalIds.length ? sql`${cashMoves.cashFlowItemId} not in (${sql.join(internalIds.map(i => sql`${i}`), sql`, `)})` : undefined;
  type Row = { key: string; name: string; group?: string; income: string; expense: string; net: string; opening?: string; closing?: string };
  let rows: Row[] = [];
  if (p.groupBy === 'item') {
    const r = await db
      .select({ id: cashMoves.cashFlowItemId, name: cashFlowItems.name, kind: cashFlowItems.kind, group: cashFlowItems.flowGroup, i: inSum, o: outSum })
      .from(cashMoves)
      .innerJoin(cashFlowItems, eq(cashFlowItems.id, cashMoves.cashFlowItemId))
      .where(and(...base, notInternal))
      .groupBy(cashMoves.cashFlowItemId, cashFlowItems.name, cashFlowItems.kind, cashFlowItems.flowGroup)
      .orderBy(asc(cashFlowItems.flowGroup), desc(cashFlowItems.kind), asc(cashFlowItems.name));
    rows = r.map(x => ({ key: x.id, name: x.name, group: x.group, income: fmt(dec(x.i), 2), expense: fmt(dec(x.o), 2), net: fmt(dec(x.i) - dec(x.o), 2) }));
  } else if (p.groupBy === 'month') {
    const month = sql<string>`to_char(${cashMoves.date}, 'YYYY-MM')`;
    const r = await db.select({ m: month, i: inSum, o: outSum }).from(cashMoves).where(and(...base, notInternal)).groupBy(month).orderBy(month);
    rows = r.map(x => ({ key: x.m, name: x.m, income: fmt(dec(x.i), 2), expense: fmt(dec(x.o), 2), net: fmt(dec(x.i) - dec(x.o), 2) }));
  } else {
    // по кассам и счетам: с остатками на начало и конец периода, перемещения видны (они меняют остатки)
    const bal = await cashBalances(db, workspaceId, p.to);
    const before = await cashBalances(db, workspaceId, new Date(Date.parse(p.from) - 86_400_000).toISOString().slice(0, 10));
    // начальные остатки внутри периода — не оборот, а часть остатка на начало
    const openingIds = (await db.select({ id: cashFlowItems.id }).from(cashFlowItems).where(and(eq(cashFlowItems.workspaceId, workspaceId), eq(cashFlowItems.systemKey, 'opening_balance')))).map(r => r.id);
    const isOpening = openingIds.length ? sql`${cashMoves.cashFlowItemId} in (${sql.join(openingIds.map(i => sql`${i}`), sql`, `)})` : sql`false`;
    const turn = await db
      .select({ cash: cashMoves.cashRegisterId, bank: cashMoves.bankAccountId, i: inSum, o: outSum })
      .from(cashMoves)
      .where(and(...base, sql`${cashMoves.accountKind} in ('cash','bank')`, sql`not ${isOpening}`))
      .groupBy(cashMoves.cashRegisterId, cashMoves.bankAccountId);
    const inPeriodOpening = await db
      .select({ cash: cashMoves.cashRegisterId, bank: cashMoves.bankAccountId, s: signed })
      .from(cashMoves)
      .where(and(...base, sql`${cashMoves.accountKind} in ('cash','bank')`, isOpening))
      .groupBy(cashMoves.cashRegisterId, cashMoves.bankAccountId);
    const t = new Map(turn.map(x => [(x.cash ?? x.bank)!, x]));
    const prev = new Map([...before.cash, ...before.bank].map(a => [a.id, a.balance]));
    for (const o of inPeriodOpening) {
      const id = (o.cash ?? o.bank)!;
      prev.set(id, fmt(dec(prev.get(id) ?? '0') + dec(o.s), 2));
    }
    rows = [...bal.cash.map(a => ({ ...a, kind: 'cash' })), ...bal.bank.map(a => ({ ...a, kind: 'bank' }))]
      .filter(a => t.has(a.id) || dec(a.balance) !== 0n || dec(prev.get(a.id) ?? '0') !== 0n)
      .map(a => {
        const x = t.get(a.id);
        const inc = dec(x?.i ?? '0');
        const out = dec(x?.o ?? '0');
        return { key: a.id, name: a.name, group: a.kind, income: fmt(inc, 2), expense: fmt(out, 2), net: fmt(inc - out, 2), opening: prev.get(a.id) ?? '0.00', closing: a.balance };
      });
  }
  const income = rows.reduce((s, r) => s + dec(r.income), 0n);
  const expense = rows.reduce((s, r) => s + dec(r.expense), 0n);
  return { from: p.from, to: p.to, groupBy: p.groupBy, rows, totals: { income: fmt(income, 2), expense: fmt(expense, 2), net: fmt(income - expense, 2) } };
}

/* ---------------- данные печатных форм ---------------- */

async function printOrg(db: Db, organizationId: string): Promise<PrintOrganization> {
  const [o] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!o) throw new DomainError(404, 'not_found', 'organization not found');
  return {
    name: o.name,
    fullName: o.fullName || o.name,
    inn: o.inn,
    kpp: o.kpp,
    ogrn: o.ogrn,
    address: o.legalAddress,
    phone: o.phone,
    bank: null,
    kind: o.kind,
    directorName: o.directorName,
    directorTitle: o.directorTitle,
    accountantName: o.accountantName,
    taxSystem: o.taxSystem,
    stampFile: o.stampFile ?? null,
    directorSignatureFile: o.directorSignatureFile ?? null,
    accountantSignatureFile: o.accountantSignatureFile ?? null,
  };
}

/** КО-1 и КО-2: кассовые документы (банковские печатаются платёжным поручением позже) */
export async function cashOrderData(db: Db, id: string, form: 'ko1' | 'ko2'): Promise<CashOrderData> {
  const d = await paymentDetail(db, id);
  if (d.type !== 'cash_receipt' && d.type !== 'cash_payment') throw new DomainError(422, 'form_not_available', 'Cash orders are printed for cash documents only');
  const docs = d.lines.map(l => (l.settlementDocument ? `${DOCUMENT_LABELS_RU[l.settlementDocument.type as DocumentType] ?? l.settlementDocument.type}${l.settlementDocument.number ? ` ${l.settlementDocument.number}` : ''}` : l.comment || l.cashFlowItemName)).filter(Boolean);
  return {
    form,
    number: d.number,
    date: d.date,
    organization: await printOrg(db, d.organizationId),
    cashRegisterName: d.cashRegisterName ?? '',
    personName: d.counterparty?.name ?? d.accountable?.name ?? '',
    basis: [...new Set([...docs, d.comment].filter(Boolean))].join('; '),
    amount: d.total,
  };
}

/** Акт сверки взаиморасчётов по стороне (покупатель/поставщик) за период */
export async function settlementActData(db: Db, workspaceId: string, companyId: string, p: { side: Side; from?: string; to?: string; contractId?: string | null; organizationId?: string | null }): Promise<SettlementActData> {
  const card = await settlementCard(db, workspaceId, companyId, p);
  const [c] = await db.select({ name: companies.name, inn: companies.inn }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) throw new DomainError(404, 'not_found', 'counterparty not found');
  const side = card.sides.find(s => s.side === p.side);
  const orgId = p.organizationId ?? (await defaultOrganizationId(db));
  return {
    organization: await printOrg(db, orgId),
    counterpartyName: c.name,
    counterpartyInn: c.inn,
    side: p.side,
    from: card.from,
    to: card.to,
    opening: side?.opening ?? '0.00',
    rows: (side?.rows ?? []).map(r => ({ date: r.date, label: r.label, accrual: r.accrual, payment: r.payment })),
    closing: side?.closing ?? '0.00',
  };
}
