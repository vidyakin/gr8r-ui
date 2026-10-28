/* Ввод начальных остатков (аналог 1С:УНФ, раздел «Деньги»): документ группы «cash» со строками opening_balance_lines.
   Строки «касса / расчётный счёт — сумма» при проведении пишут приход в cash_moves по внутренней статье «Начальные остатки»
   (в обороты «Движения денег» она не входит, в остатки — входит). Строки «долг / аванс контрагента» пишут взаиморасчёты.
   Правила — docs/architecture/payments.md, «Ввод начальных остатков». */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { DOCUMENT_LABELS_RU, dec, fmt, isOpeningMoneyKind, openingSettlement, SETTLEMENT_CHAIN_TYPES, type DocumentType, type OpeningLineInput, type OpeningLineKind } from '@gr8r/shared';
import type { Db } from './client';
import { DOCUMENT_HOOKS } from './document-hooks';
import type { DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { assertPeriodOpen } from './cost-closing';
import { ensureCashFlowItems } from './payments';
import { postOpeningSettlement, removeSettlementMoves, rootSide, settlementRoot } from './settlements';
import { accountableMoves, bankAccounts, cashMoves, cashRegisters, companies, contracts, documents, openingBalanceLines, organizations } from './schema';

const today = () => new Date().toISOString().slice(0, 10);
type DocRow = typeof documents.$inferSelect;
type LineRow = typeof openingBalanceLines.$inferSelect;

export interface OpeningInput {
  id?: string;
  organizationId?: string | null;
  date?: string;
  comment?: string;
  lines?: OpeningLineInput[];
}

async function loadOpening(db: Db, id: string, lock = false): Promise<DocRow> {
  const q = db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row || row.type !== 'opening_balance') throw new DomainError(404, 'not_found', 'opening balances document not found');
  return row;
}

const linesOf = (db: Db, docId: string) =>
  db.select().from(openingBalanceLines).where(eq(openingBalanceLines.documentId, docId)).orderBy(asc(openingBalanceLines.sortOrder), asc(openingBalanceLines.createdAt));

/** Сумма денег документа: касса и счета (долги и авансы контрагентов в неё не входят) */
const moneyTotal = (lines: Pick<LineRow, 'kind' | 'amount'>[]) => lines.filter(l => isOpeningMoneyKind(l.kind)).reduce((s, l) => s + dec(l.amount), 0n);

async function saveOpeningLines(db: Db, ctx: DocCtx, doc: DocRow, inputs: OpeningLineInput[]): Promise<void> {
  const rows = inputs.map((l, i) => {
    if (dec(l.amount) <= 0n) throw new DomainError(422, 'invalid_amount', 'The amount must be greater than zero');
    const money = isOpeningMoneyKind(l.kind);
    if (money && !(l.kind === 'cash' ? l.cashRegisterId : l.bankAccountId)) throw new DomainError(422, 'account_required', l.kind === 'cash' ? 'Select a cash register' : 'Select a bank account');
    if (!money && !l.counterpartyId) throw new DomainError(422, 'counterparty_required', 'Select a counterparty');
    return {
      id: l.id,
      workspaceId: ctx.workspaceId,
      documentId: doc.id,
      sortOrder: i,
      kind: l.kind,
      cashRegisterId: l.kind === 'cash' ? l.cashRegisterId! : null,
      bankAccountId: l.kind === 'bank' ? l.bankAccountId! : null,
      counterpartyId: money ? null : l.counterpartyId!,
      contractId: money ? null : (l.contractId ?? null),
      settlementDocumentId: money ? null : (l.settlementDocumentId ?? null),
      amount: fmt(dec(l.amount), 2),
      comment: l.comment?.trim() ?? '',
    } satisfies typeof openingBalanceLines.$inferInsert;
  });
  const existing = new Set((await db.select({ id: openingBalanceLines.id }).from(openingBalanceLines).where(eq(openingBalanceLines.documentId, doc.id))).map(r => r.id));
  const keep = new Set(rows.map(r => r.id).filter((x): x is string => !!x));
  const drop = [...existing].filter(id => !keep.has(id));
  if (drop.length) await db.delete(openingBalanceLines).where(inArray(openingBalanceLines.id, drop));
  for (const r of rows) {
    if (r.id && existing.has(r.id)) {
      const { id, workspaceId: _w, documentId: _d, ...set } = r;
      await db.update(openingBalanceLines).set(set).where(eq(openingBalanceLines.id, id));
    } else await db.insert(openingBalanceLines).values(r);
  }
  const total = moneyTotal(rows);
  await db.update(documents).set({ amountNet: fmt(total, 2), vatTotal: '0.00', total: fmt(total, 2), updatedAt: new Date() }).where(eq(documents.id, doc.id));
}

export async function createOpening(db: Db, ctx: DocCtx, input: OpeningInput): Promise<string> {
  let organizationId = input.organizationId ?? null;
  if (!organizationId) {
    const [o] = await db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.archivedAt)).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
    if (!o) throw new DomainError(422, 'organization_required', 'Add an organization in Settings → Organizations first');
    organizationId = o.id;
  }
  await ensureCashFlowItems(db, ctx.workspaceId);
  const [row] = await db
    .insert(documents)
    .values({ ...(input.id ? { id: input.id } : {}), workspaceId: ctx.workspaceId, type: 'opening_balance', date: input.date ?? today(), organizationId, comment: input.comment ?? '', responsibleId: ctx.memberId, createdBy: ctx.memberId })
    .returning();
  if (input.lines?.length) await saveOpeningLines(db, ctx, row!, input.lines);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: row!.id, actorId: ctx.memberId, payload: { documentType: 'opening_balance' } });
  return row!.id;
}

export async function updateOpening(db: Db, ctx: DocCtx, id: string, patch: Partial<Omit<OpeningInput, 'id'>>): Promise<void> {
  const doc = await loadOpening(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only a draft can be edited: unpost the document first');
  if (patch.date && patch.date !== doc.date) await assertPeriodOpen(db, ctx.workspaceId, patch.date);
  if (doc.numberSeq !== null && patch.organizationId && patch.organizationId !== doc.organizationId) throw new DomainError(422, 'number_locked', 'The document has a number: the organization cannot be changed');
  const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  if (patch.organizationId) set.organizationId = patch.organizationId;
  if (patch.date) set.date = patch.date;
  if (patch.comment !== undefined) set.comment = patch.comment;
  const [row] = await db.update(documents).set(set).where(eq(documents.id, id)).returning();
  if (patch.lines) await saveOpeningLines(db, ctx, row!, patch.lines);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'opening_balance' } });
}

/* ---------------- проверка и проведение ---------------- */

async function checkPosting(db: Db, doc: DocRow): Promise<void> {
  const lines = await linesOf(db, doc.id);
  if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one line before posting');
  // начальные остатки вводятся один раз на организацию: повторный проведённый документ задвоил бы кассу, счета и долги
  const [dup] = await db
    .select({ id: documents.id, number: documents.number, date: documents.date })
    .from(documents)
    .where(and(eq(documents.workspaceId, doc.workspaceId), eq(documents.type, 'opening_balance'), eq(documents.organizationId, doc.organizationId), eq(documents.status, 'posted'), ne(documents.id, doc.id)))
    .limit(1);
  if (dup) throw new DomainError(409, 'opening_already_posted', `Opening balances for this organization are already posted (${dup.number ?? ''} dated ${dup.date}): unpost it first or edit it`, { documentId: dup.id, number: dup.number, date: dup.date });
  for (const l of lines) {
    if (l.kind === 'cash') {
      const [c] = await db.select({ org: cashRegisters.organizationId, archivedAt: cashRegisters.archivedAt }).from(cashRegisters).where(eq(cashRegisters.id, l.cashRegisterId!)).limit(1);
      if (!c || c.archivedAt) throw new DomainError(422, 'invalid_reference', 'The cash register does not exist or is archived');
      if (c.org !== doc.organizationId) throw new DomainError(422, 'account_organization_mismatch', 'The cash register belongs to another organization');
    } else if (l.kind === 'bank') {
      const [b] = await db.select({ org: bankAccounts.organizationId }).from(bankAccounts).where(eq(bankAccounts.id, l.bankAccountId!)).limit(1);
      if (!b) throw new DomainError(422, 'invalid_reference', 'The bank account does not exist');
      if (b.org !== doc.organizationId) throw new DomainError(422, 'account_organization_mismatch', 'The bank account belongs to the counterparty or to another organization');
    } else {
      const [c] = await db.select({ archivedAt: companies.archivedAt }).from(companies).where(eq(companies.id, l.counterpartyId!)).limit(1);
      if (!c || c.archivedAt) throw new DomainError(422, 'invalid_reference', 'The counterparty does not exist or is archived');
      if (l.contractId) {
        const [k] = await db.select({ companyId: contracts.companyId }).from(contracts).where(eq(contracts.id, l.contractId)).limit(1);
        if (!k || k.companyId !== l.counterpartyId) throw new DomainError(422, 'contract_mismatch', 'The contract belongs to another counterparty');
      }
      if (l.settlementDocumentId) {
        const [d] = await db.select({ type: documents.type, status: documents.status }).from(documents).where(eq(documents.id, l.settlementDocumentId)).limit(1);
        if (!d || d.status === 'cancelled') throw new DomainError(422, 'invalid_reference', 'The settlement document does not exist or is cancelled');
        const root = await settlementRoot(db, l.settlementDocumentId);
        const side = openingSettlement(l.kind as OpeningLineKind)!.side;
        if (!(SETTLEMENT_CHAIN_TYPES as string[]).includes(root.type) || root.counterpartyId !== l.counterpartyId || rootSide(root.type) !== side)
          throw new DomainError(422, 'settlement_document_mismatch', 'The settlement document belongs to another counterparty or to the other side of settlements');
      }
    }
  }
}

async function writeMoves(db: Db, ctx: DocCtx, doc: DocRow): Promise<void> {
  const lines = await linesOf(db, doc.id);
  const keys = await ensureCashFlowItems(db, ctx.workspaceId);
  const total = moneyTotal(lines);
  await db.update(documents).set({ amountNet: fmt(total, 2), vatTotal: '0.00', total: fmt(total, 2), updatedAt: new Date() }).where(eq(documents.id, doc.id));
  // сначала деньги и авансы без документа, потом долги с документом: долг сразу гасится авансами того же документа
  for (const l of [...lines.filter(x => !attachedDebtLine(x)), ...lines.filter(attachedDebtLine)]) {
    if (l.kind === 'cash' || l.kind === 'bank') {
      const account = l.kind === 'cash' ? { accountKind: 'cash' as const, cashRegisterId: l.cashRegisterId } : { accountKind: 'bank' as const, bankAccountId: l.bankAccountId };
      await db.insert(cashMoves).values({ workspaceId: ctx.workspaceId, documentId: doc.id, lineId: l.id, date: doc.date, ...account, cashFlowItemId: keys.get('opening_balance')!, direction: 'in', amount: l.amount });
      continue;
    }
    await writeSettlementLine(db, ctx.workspaceId, doc, l);
  }
}

/** Взаиморасчётная строка остатков: документ расчётов приводится к корню цепочки (заказ → счёт → реализация делят один документ) */
async function writeSettlementLine(db: Db, workspaceId: string, doc: DocRow, l: LineRow): Promise<void> {
  const s = openingSettlement(l.kind as OpeningLineKind)!;
  const settlementDocumentId = l.settlementDocumentId ? (await settlementRoot(db, l.settlementDocumentId)).id : null;
  await postOpeningSettlement(db, workspaceId, doc, { id: l.id, companyId: l.counterpartyId!, side: s.side, contractId: l.contractId, advance: s.advance, amount: dec(l.amount), settlementDocumentId });
}

/** Повтор взаиморасчётов проведённого документа остатков по одному контрагенту (смена режима расчётов) */
export async function replayOpeningSettlements(db: Db, workspaceId: string, doc: DocRow, companyId: string): Promise<void> {
  const lines = (await linesOf(db, doc.id)).filter(l => !isOpeningMoneyKind(l.kind) && l.counterpartyId === companyId);
  for (const l of [...lines.filter(x => !attachedDebtLine(x)), ...lines.filter(attachedDebtLine)]) await writeSettlementLine(db, workspaceId, doc, l);
}

const attachedDebtLine = (l: LineRow) => !!l.settlementDocumentId && !openingSettlement(l.kind as OpeningLineKind)?.advance;

DOCUMENT_HOOKS.opening_balance = {
  check: async (db, _ctx, doc) => checkPosting(db, doc),
  post: async (db, ctx, doc) => writeMoves(db, ctx, doc),
  afterPost: async (db, ctx, doc) => {
    const [fresh] = await db.select({ total: documents.total, number: documents.number }).from(documents).where(eq(documents.id, doc.id)).limit(1);
    await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.payment_posted', entity: 'document', recordId: doc.id, actorId: ctx.memberId, payload: { documentType: 'opening_balance', total: fresh?.total, number: fresh?.number } });
  },
  afterUnpost: async (db, ctx, doc) => {
    await db.delete(cashMoves).where(eq(cashMoves.documentId, doc.id));
    await db.delete(accountableMoves).where(eq(accountableMoves.documentId, doc.id));
    await removeSettlementMoves(db, ctx.workspaceId, doc.id);
  },
};

/* ---------------- карточка и журнал ---------------- */

export async function openingDetail(db: Db, id: string) {
  const doc = await loadOpening(db, id);
  const lines = await linesOf(db, id);
  const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, doc.organizationId)).limit(1);
  const cashIds = lines.map(l => l.cashRegisterId).filter((x): x is string => !!x);
  const bankIds = lines.map(l => l.bankAccountId).filter((x): x is string => !!x);
  const cpIds = [...new Set(lines.map(l => l.counterpartyId).filter((x): x is string => !!x))];
  const conIds = [...new Set(lines.map(l => l.contractId).filter((x): x is string => !!x))];
  const cash = new Map((cashIds.length ? await db.select({ id: cashRegisters.id, name: cashRegisters.name }).from(cashRegisters).where(inArray(cashRegisters.id, cashIds)) : []).map(r => [r.id, r.name]));
  const bank = new Map((bankIds.length ? await db.select({ id: bankAccounts.id, name: bankAccounts.bankName, account: bankAccounts.account }).from(bankAccounts).where(inArray(bankAccounts.id, bankIds)) : []).map(r => [r.id, `${r.name} · ${r.account.slice(-4)}`]));
  const cps = new Map((cpIds.length ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, cpIds)) : []).map(c => [c.id, c.name]));
  const cons = new Map((conIds.length ? await db.select({ id: contracts.id, number: contracts.number }).from(contracts).where(inArray(contracts.id, conIds)) : []).map(c => [c.id, c.number]));
  const sdIds = [...new Set(lines.map(l => l.settlementDocumentId).filter((x): x is string => !!x))];
  const sdocs = new Map((sdIds.length ? await db.select({ id: documents.id, type: documents.type, number: documents.number, date: documents.date }).from(documents).where(inArray(documents.id, sdIds)) : []).map(d => [d.id, `${DOCUMENT_LABELS_RU[d.type as DocumentType] ?? d.type}${d.number ? ` ${d.number}` : ''} · ${d.date}`]));
  return {
    ...doc,
    organizationName: org?.name ?? null,
    lines: lines.map(l => ({
      ...l,
      accountName: l.cashRegisterId ? (cash.get(l.cashRegisterId) ?? null) : l.bankAccountId ? (bank.get(l.bankAccountId) ?? null) : null,
      counterpartyName: l.counterpartyId ? (cps.get(l.counterpartyId) ?? null) : null,
      contractNumber: l.contractId ? (cons.get(l.contractId) ?? null) : null,
      settlementDocumentLabel: l.settlementDocumentId ? (sdocs.get(l.settlementDocumentId) ?? null) : null,
    })),
  };
}

export interface OpeningListParams {
  status?: string[];
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export async function listOpenings(db: Db, workspaceId: string, p: OpeningListParams) {
  const conds = [
    eq(documents.workspaceId, workspaceId),
    eq(documents.type, 'opening_balance'),
    p.status?.length ? inArray(documents.status, p.status as ('draft' | 'posted' | 'cancelled')[]) : undefined,
    p.from ? gte(documents.date, p.from) : undefined,
    p.to ? lte(documents.date, p.to) : undefined,
  ];
  const rows = await db.select().from(documents).where(and(...conds)).orderBy(desc(documents.date), desc(documents.createdAt)).limit(p.limit).offset(p.offset);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(...conds));
  const orgIds = [...new Set(rows.map(r => r.organizationId))];
  const orgs = new Map((orgIds.length ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, orgIds)) : []).map(o => [o.id, o.name]));
  return {
    items: rows.map(r => ({ id: r.id, number: r.number, date: r.date, status: r.status, total: r.total, comment: r.comment, organizationId: r.organizationId, organizationName: orgs.get(r.organizationId) ?? '' })),
    total: Number(count?.n ?? 0),
  };
}
