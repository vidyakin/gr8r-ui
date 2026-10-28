/* Взаиморасчёты с контрагентами (задача 1174б): регистр settlement_moves, начисление долга, оплаты, авансы и зачёт FIFO.
   Правила — docs/architecture/payments.md. Модуль не импортирует значения из documents.ts (документы вызывают его при проведении). */
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  ACCRUAL_TYPES,
  allocateFifo,
  DOCUMENT_LABELS_RU,
  dec,
  fmt,
  obligation,
  PAYABLE_TYPES,
  PREPAY_TYPES,
  paymentState,
  planOffset,
  SETTLEMENT_CHAIN_TYPES,
  splitPayment,
  type AdvanceSource,
  type Dec,
  type DocumentType,
  type PaymentState,
  type SettlementMode,
} from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { companies, documents, settlementMoves } from './schema';
import { workOrderKindType } from './repair';
import type { DocumentRow } from './documents';

export type Side = 'customer' | 'supplier';

type MoveKind = 'accrual' | 'payment' | 'offset';

interface Scope {
  workspaceId: string;
  companyId: string;
  side: Side;
  contractId: string | null;
}

/* ---------------- вспомогательное ---------------- */

export async function companyMode(db: Db, companyId: string): Promise<SettlementMode> {
  const [c] = await db.select({ m: companies.settlementMode }).from(companies).where(eq(companies.id, companyId)).limit(1);
  return (c?.m ?? 'by_documents') as SettlementMode;
}

type RootRow = Pick<DocumentRow, 'id' | 'type' | 'total' | 'date' | 'dueDate' | 'contractId' | 'counterpartyId' | 'status' | 'basedOnId' | 'number'>;

const rootCols = { id: documents.id, type: documents.type, total: documents.total, date: documents.date, dueDate: documents.dueDate, contractId: documents.contractId, counterpartyId: documents.counterpartyId, status: documents.status, basedOnId: documents.basedOnId, number: documents.number };

/** Документ расчётов: корень цепочки «основание» среди заказов, счетов и документов начисления. Сам документ, если основания нет */
export async function settlementRoot(db: Db, docId: string): Promise<RootRow> {
  let [cur] = await db.select(rootCols).from(documents).where(eq(documents.id, docId)).limit(1);
  if (!cur) throw new DomainError(404, 'not_found', 'document not found');
  for (let i = 0; i < 10 && cur.basedOnId; i++) {
    const [parent] = await db.select(rootCols).from(documents).where(eq(documents.id, cur.basedOnId)).limit(1);
    if (!parent || !(SETTLEMENT_CHAIN_TYPES as string[]).includes(parent.type) || parent.status === 'cancelled') break;
    cur = parent;
  }
  return cur;
}

const sum = (col: unknown) => sql<string>`coalesce(sum(${col}), 0)::text`;

/** Начислено и оплачено (с зачётами) по документу расчётов */
export async function rootTotals(db: Db, rootId: string): Promise<{ accrued: Dec; paid: Dec }> {
  const rows = await db
    .select({ kind: settlementMoves.kind, s: sum(settlementMoves.amount) })
    .from(settlementMoves)
    .where(eq(settlementMoves.settlementDocumentId, rootId))
    .groupBy(settlementMoves.kind);
  let accrued = 0n;
  let paid = 0n;
  for (const r of rows) {
    if (r.kind === 'accrual') accrued += dec(r.s);
    else paid -= dec(r.s);
  }
  return { accrued, paid };
}

async function insertMove(
  db: Db,
  scope: Scope,
  m: { settlementDocumentId: string | null; documentId: string; lineId?: string | null; advanceDocumentId?: string | null; advanceLineId?: string | null; date: string; kind: MoveKind; amount: Dec },
): Promise<void> {
  if (m.amount === 0n) return;
  await db.insert(settlementMoves).values({
    workspaceId: scope.workspaceId,
    companyId: scope.companyId,
    side: scope.side,
    contractId: scope.contractId,
    settlementDocumentId: m.settlementDocumentId,
    documentId: m.documentId,
    lineId: m.lineId ?? null,
    advanceDocumentId: m.advanceDocumentId ?? null,
    advanceLineId: m.advanceLineId ?? null,
    date: m.date,
    kind: m.kind,
    amount: fmt(m.amount, 2),
  });
}

const contractCond = (contractId: string | null) => (contractId ? eq(settlementMoves.contractId, contractId) : isNull(settlementMoves.contractId));

/** Источники аванса компании (пул): оплаты и излишки, ещё не зачтённые целиком, старые первыми */
async function advanceSources(db: Db, scope: Scope): Promise<(AdvanceSource & { documentId: string; lineId: string | null })[]> {
  const rows = await db
    .select({ docId: settlementMoves.advanceDocumentId, lineId: settlementMoves.advanceLineId, date: sql<string>`min(${settlementMoves.date})::text`, s: sum(settlementMoves.amount) })
    .from(settlementMoves)
    .where(and(eq(settlementMoves.companyId, scope.companyId), eq(settlementMoves.side, scope.side), isNull(settlementMoves.settlementDocumentId), contractCond(scope.contractId), sql`${settlementMoves.advanceDocumentId} is not null`))
    .groupBy(settlementMoves.advanceDocumentId, settlementMoves.advanceLineId)
    .having(sql`sum(${settlementMoves.amount}) < 0`);
  return rows.map(r => ({ key: `${r.docId}|${r.lineId ?? ''}`, date: r.date, remaining: -dec(r.s), documentId: r.docId!, lineId: r.lineId }));
}

/** Зачесть авансы (FIFO по дате аванса, внутри договора) в долг документов расчётов */
async function offsetAdvances(db: Db, scope: Scope, rootIds: string[], trigger: { documentId: string; date: string }): Promise<void> {
  for (const rootId of rootIds) {
    const t = await rootTotals(db, rootId);
    const debt = t.accrued - t.paid;
    if (debt <= 0n) continue;
    const sources = await advanceSources(db, scope);
    const plan = planOffset(debt, sources);
    for (const p of plan) {
      const src = sources.find(s => s.key === p.key)!;
      const common = { documentId: trigger.documentId, advanceDocumentId: src.documentId, advanceLineId: src.lineId, date: trigger.date, kind: 'offset' as const };
      await insertMove(db, scope, { ...common, settlementDocumentId: rootId, amount: -p.amount });
      await insertMove(db, scope, { ...common, settlementDocumentId: null, amount: p.amount });
    }
  }
}

/** Переплата по документу расчётов (после возврата покупателя) уходит в пул авансов */
async function releaseSurplus(db: Db, scope: Scope, root: RootRow, trigger: { documentId: string; date: string }): Promise<void> {
  const t = await rootTotals(db, root.id);
  const surplus = t.paid - obligation((PREPAY_TYPES as string[]).includes(root.type), root.total, t.accrued);
  if (surplus <= 0n) return;
  const common = { documentId: trigger.documentId, advanceDocumentId: trigger.documentId, advanceLineId: null, date: trigger.date, kind: 'offset' as const };
  await insertMove(db, scope, { ...common, settlementDocumentId: root.id, amount: surplus });
  await insertMove(db, scope, { ...common, settlementDocumentId: null, amount: -surplus });
}

/* ---------------- начисление ---------------- */

/** Проведение документа начисления (реализация, акт, заказ-наряд, поступление, возвраты): долг контрагента, зачёт авансов */
export async function postAccrual(db: Db, workspaceId: string, docId: string): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, docId)).limit(1);
  if (!doc) return;
  const rule = ACCRUAL_TYPES[doc.type as DocumentType];
  if (!rule || !doc.counterpartyId) return;
  const amount = dec(doc.total);
  if (amount <= 0n) return;
  // гарантийный ремонт — без выручки и без долга клиента
  if (doc.type === 'work_order' && (await workOrderKindType(db, doc.workOrderKindId)) === 'warranty') return;
  const scope: Scope = { workspaceId, companyId: doc.counterpartyId, side: rule.side, contractId: doc.contractId };
  const mode = await companyMode(db, doc.counterpartyId);
  const root = await settlementRoot(db, docId);
  const settlementDocumentId = mode === 'by_documents' ? root.id : null;
  await insertMove(db, scope, { settlementDocumentId, documentId: doc.id, date: doc.date, kind: 'accrual', amount: rule.sign === 1 ? amount : -amount });
  if (mode !== 'by_documents') return;
  if (rule.sign === 1) await offsetAdvances(db, scope, [root.id], { documentId: doc.id, date: doc.date });
  else await releaseSurplus(db, scope, root, { documentId: doc.id, date: doc.date });
}

/** Отмена проведения документа начисления или оплаты: его строки уходят, зачёты чужих документов за его счёт пересчитываются */
export async function removeSettlementMoves(db: Db, workspaceId: string, docId: string): Promise<void> {
  // зачёты, которые другие документы сделали за счёт аванса этого
  const foreign = await db
    .select()
    .from(settlementMoves)
    .where(and(eq(settlementMoves.advanceDocumentId, docId), ne(settlementMoves.documentId, docId), eq(settlementMoves.kind, 'offset')));
  const redo = new Map<string, { scope: Scope; triggerId: string; date: string }>();
  for (const m of foreign) {
    if (m.settlementDocumentId && !redo.has(m.settlementDocumentId)) redo.set(m.settlementDocumentId, { scope: { workspaceId, companyId: m.companyId, side: m.side as Side, contractId: m.contractId }, triggerId: m.documentId, date: m.date });
  }
  if (foreign.length) await db.delete(settlementMoves).where(inArray(settlementMoves.id, foreign.map(m => m.id)));
  await db.delete(settlementMoves).where(eq(settlementMoves.documentId, docId));
  // другие авансы покрывают освободившийся долг
  for (const [rootId, r] of redo) await offsetAdvances(db, r.scope, [rootId], { documentId: r.triggerId, date: r.date });
}

/* ---------------- оплата ---------------- */

export interface PayLine {
  id: string;
  companyId: string;
  settlementDocumentId: string | null;
  contractId: string | null;
  amount: Dec;
}

/** Строка оплаты (оплата покупателя / поставщику): гасит долг документа, сверх долга — аванс */
export async function applyPayment(db: Db, workspaceId: string, side: Side, doc: { id: string; date: string }, line: PayLine): Promise<{ rootId: string | null }> {
  const scope: Scope = { workspaceId, companyId: line.companyId, side, contractId: line.contractId };
  const mode = await companyMode(db, line.companyId);
  const advanceOf = { advanceDocumentId: doc.id, advanceLineId: line.id };
  if (mode === 'by_counterparty' || !line.settlementDocumentId) {
    await insertMove(db, scope, { settlementDocumentId: null, documentId: doc.id, lineId: line.id, ...advanceOf, date: doc.date, kind: 'payment', amount: -line.amount });
    return { rootId: null };
  }
  const [root] = await db.select(rootCols).from(documents).where(eq(documents.id, line.settlementDocumentId)).limit(1);
  if (!root) throw new DomainError(422, 'invalid_reference', 'The settlement document does not exist');
  const t = await rootTotals(db, root.id);
  const debt = obligation((PREPAY_TYPES as string[]).includes(root.type), root.total, t.accrued) - t.paid;
  const split = splitPayment(debt, line.amount);
  await insertMove(db, scope, { settlementDocumentId: root.id, documentId: doc.id, lineId: line.id, date: doc.date, kind: 'payment', amount: -split.toDocument });
  await insertMove(db, scope, { settlementDocumentId: null, documentId: doc.id, lineId: line.id, ...advanceOf, date: doc.date, kind: 'payment', amount: -split.advance });
  return { rootId: root.id };
}

/** Возврат денег контрагенту/от контрагента: уменьшает аванс (сначала излишек документа, затем пул по FIFO) */
export async function applyRefund(db: Db, workspaceId: string, side: Side, doc: { id: string; date: string }, line: PayLine): Promise<void> {
  const scope: Scope = { workspaceId, companyId: line.companyId, side, contractId: line.contractId };
  const mode = await companyMode(db, line.companyId);
  let left = line.amount;
  if (mode === 'by_documents' && line.settlementDocumentId) {
    const t = await rootTotals(db, line.settlementDocumentId);
    const avail = t.paid - t.accrued;
    if (avail > 0n) {
      const take = avail < left ? avail : left;
      await insertMove(db, scope, { settlementDocumentId: line.settlementDocumentId, documentId: doc.id, lineId: line.id, date: doc.date, kind: 'payment', amount: take });
      left -= take;
    }
  }
  if (left <= 0n) return;
  if (mode === 'by_documents') {
    const sources = await advanceSources(db, scope);
    for (const p of planOffset(left, sources)) {
      const src = sources.find(s => s.key === p.key)!;
      await insertMove(db, scope, { settlementDocumentId: null, documentId: doc.id, lineId: line.id, advanceDocumentId: src.documentId, advanceLineId: src.lineId, date: doc.date, kind: 'payment', amount: p.amount });
      left -= p.amount;
    }
  }
  // сверх аванса контрагент остаётся должен нам (сальдо меняет знак)
  await insertMove(db, scope, { settlementDocumentId: null, documentId: doc.id, lineId: line.id, date: doc.date, kind: 'payment', amount: left });
}

/** Сторона документа расчётов: по правилу начисления, заказ поставщику — поставщик, остальные — покупатель */
export function rootSide(type: string): Side {
  return ACCRUAL_TYPES[type as DocumentType]?.side ?? (type === 'supplier_order' ? 'supplier' : 'customer');
}

/** Начальный долг или аванс контрагента («Ввод начальных остатков»). Без документа расчётов (или в режиме «по контрагенту») долг — начисление
    без документа (пул компании), аванс — оплата без документа с источником аванса: он зачтётся в ближайшее начисление, как обычная предоплата.
    С документом расчётов (режим «по документам»): долг начисляется на документ и гасится авансами, аванс — оплата этого документа (сверх долга — аванс) */
export async function postOpeningSettlement(
  db: Db,
  workspaceId: string,
  doc: { id: string; date: string },
  line: { id: string; companyId: string; side: Side; contractId: string | null; advance: boolean; amount: Dec; settlementDocumentId?: string | null },
): Promise<void> {
  const scope: Scope = { workspaceId, companyId: line.companyId, side: line.side, contractId: line.contractId };
  const attached = line.settlementDocumentId && (await companyMode(db, line.companyId)) === 'by_documents' ? line.settlementDocumentId : null;
  if (attached) {
    if (line.advance) {
      await applyPayment(db, workspaceId, line.side, doc, { id: line.id, companyId: line.companyId, settlementDocumentId: attached, contractId: line.contractId, amount: line.amount });
    } else {
      await insertMove(db, scope, { settlementDocumentId: attached, documentId: doc.id, lineId: line.id, date: doc.date, kind: 'accrual', amount: line.amount });
      await offsetAdvances(db, scope, [attached], { documentId: doc.id, date: doc.date });
    }
    return;
  }
  if (line.advance) await insertMove(db, scope, { settlementDocumentId: null, documentId: doc.id, lineId: line.id, advanceDocumentId: doc.id, advanceLineId: line.id, date: doc.date, kind: 'payment', amount: -line.amount });
  else await insertMove(db, scope, { settlementDocumentId: null, documentId: doc.id, lineId: line.id, date: doc.date, kind: 'accrual', amount: line.amount });
}

/* ---------------- состояние оплаты документов ---------------- */

export interface PaymentStatus {
  documentId: string;
  rootId: string;
  side: Side;
  mode: SettlementMode;
  /** К оплате по цепочке документов: заказ и счёт — не меньше своей суммы, остальные — начисленное */
  obligation: string;
  paid: string;
  remaining: string;
  state: PaymentState;
  /** Оплата пришла до начисления: аванс под заказ, счёт, заказ-наряд или заказ поставщику */
  prepaid: boolean;
}

/** Оплата корней по FIFO общей суммой платежей контрагента (режим «по контрагенту») */
async function fifoPaid(db: Db, companyId: string, side: Side): Promise<{ paid: Map<string, Dec>; advance: Dec }> {
  const rows = await db
    .select({ docId: settlementMoves.documentId, s: sum(settlementMoves.amount) })
    .from(settlementMoves)
    .where(and(eq(settlementMoves.companyId, companyId), eq(settlementMoves.side, side), eq(settlementMoves.kind, 'accrual')))
    .groupBy(settlementMoves.documentId);
  const byRoot = new Map<string, { id: string; date: string; amount: Dec }>();
  let accruals = 0n;
  for (const r of rows) {
    accruals += dec(r.s);
    const root = await settlementRoot(db, r.docId);
    const cur = byRoot.get(root.id) ?? { id: root.id, date: root.date, amount: 0n };
    cur.amount += dec(r.s);
    byRoot.set(root.id, cur);
  }
  const [all] = await db.select({ s: sum(settlementMoves.amount) }).from(settlementMoves).where(and(eq(settlementMoves.companyId, companyId), eq(settlementMoves.side, side)));
  const paidTotal = accruals - dec(all?.s ?? '0');
  return allocateFifo([...byRoot.values()], paidTotal);
}

/** Корни цепочек «основание» для набора документов: не более одного запроса на уровень цепочки (заказ → счёт → реализация), а не на документ */
async function settlementRoots(db: Db, start: RootRow[]): Promise<Map<string, RootRow>> {
  const cur = new Map(start.map(d => [d.id, d]));
  const active = new Set(start.filter(d => d.basedOnId).map(d => d.id));
  for (let i = 0; i < 10 && active.size; i++) {
    const parentIds = [...new Set([...active].map(id => cur.get(id)!.basedOnId!))];
    const parents = new Map((await db.select(rootCols).from(documents).where(inArray(documents.id, parentIds))).map(p => [p.id, p]));
    for (const id of [...active]) {
      const parent = parents.get(cur.get(id)!.basedOnId!);
      if (!parent || !(SETTLEMENT_CHAIN_TYPES as string[]).includes(parent.type) || parent.status === 'cancelled') active.delete(id);
      else {
        cur.set(id, parent);
        if (!parent.basedOnId) active.delete(id);
      }
    }
  }
  return cur;
}

/** «Оплачено / к оплате» для списка документов (по цепочке: у заказа, счёта и реализации общий документ расчётов).
    Запросов столько, сколько уровней цепочки плюс фиксированное число — не по запросу на документ (режим «по контрагенту» считается по контрагентам) */
export async function paymentStatuses(db: Db, ids: string[]): Promise<Record<string, PaymentStatus>> {
  const out: Record<string, PaymentStatus> = {};
  if (!ids.length) return out;
  const docs = (await db.select(rootCols).from(documents).where(inArray(documents.id, ids))).filter(d => (PAYABLE_TYPES as string[]).includes(d.type) && d.status !== 'cancelled');
  const roots = await settlementRoots(db, docs);
  const rootRows = new Map([...roots.values()].map(r => [r.id, r]));
  const rootIds = [...rootRows.keys()];
  const cpIds = [...new Set([...rootRows.values()].map(r => r.counterpartyId).filter((x): x is string => !!x))];
  const modes = new Map((cpIds.length ? await db.select({ id: companies.id, m: companies.settlementMode }).from(companies).where(inArray(companies.id, cpIds)) : []).map(c => [c.id, (c.m ?? 'by_documents') as SettlementMode]));
  const totals = new Map<string, { accrued: Dec; paid: Dec }>();
  if (rootIds.length) {
    const rows = await db
      .select({ rootId: settlementMoves.settlementDocumentId, kind: settlementMoves.kind, s: sum(settlementMoves.amount) })
      .from(settlementMoves)
      .where(inArray(settlementMoves.settlementDocumentId, rootIds))
      .groupBy(settlementMoves.settlementDocumentId, settlementMoves.kind);
    for (const r of rows) {
      const t = totals.get(r.rootId!) ?? { accrued: 0n, paid: 0n };
      if (r.kind === 'accrual') t.accrued += dec(r.s);
      else t.paid -= dec(r.s);
      totals.set(r.rootId!, t);
    }
  }
  const fifo = new Map<string, Awaited<ReturnType<typeof fifoPaid>>>();
  for (const d of docs) {
    const root = roots.get(d.id)!;
    if (!root.counterpartyId) continue;
    const rule = ACCRUAL_TYPES[root.type as DocumentType];
    const side: Side = rule?.side ?? (root.type === 'supplier_order' ? 'supplier' : 'customer');
    const mode = modes.get(root.counterpartyId) ?? 'by_documents';
    const prepay = (PREPAY_TYPES as string[]).includes(root.type);
    let ob: Dec;
    let paid: Dec;
    let accrued: Dec;
    if (mode === 'by_documents') {
      const t = totals.get(root.id) ?? { accrued: 0n, paid: 0n };
      accrued = t.accrued;
      ob = obligation(prepay, root.total, t.accrued);
      paid = t.paid;
    } else {
      const key = `${root.counterpartyId}|${side}`;
      if (!fifo.has(key)) fifo.set(key, await fifoPaid(db, root.counterpartyId, side));
      accrued = dec((await db.select({ s: sum(settlementMoves.amount) }).from(settlementMoves).where(and(eq(settlementMoves.kind, 'accrual'), inArray(settlementMoves.documentId, await chainDocIds(db, root.id)))))[0]?.s ?? '0');
      ob = obligation(prepay, root.total, accrued);
      paid = fifo.get(key)!.paid.get(root.id) ?? 0n;
    }
    const remaining = ob > paid ? ob - paid : 0n;
    // аванс: оплата пришла до начисления (заказ, счёт, заказ-наряд, заказ поставщику ещё не отгружены / не оприходованы)
    const prepaid = prepay && accrued === 0n && paid > 0n;
    out[d.id] = { documentId: d.id, rootId: root.id, side, mode, obligation: fmt(ob, 2), paid: fmt(paid, 2), remaining: fmt(remaining, 2), state: paymentState(ob, paid), prepaid };
  }
  return out;
}

/** Документы цепочки корня (корень и все, кто на нём основан): для режима «по контрагенту» */
async function chainDocIds(db: Db, rootId: string): Promise<string[]> {
  const ids = [rootId];
  let layer = [rootId];
  for (let i = 0; i < 6 && layer.length; i++) {
    const next = await db.select({ id: documents.id }).from(documents).where(inArray(documents.basedOnId, layer));
    layer = next.map(n => n.id).filter(id => !ids.includes(id));
    ids.push(...layer);
  }
  return ids;
}

/** Остаток к оплате документа (для «Оплатить»): документ, сторона, корень */
export async function payableOf(db: Db, docId: string): Promise<{ status: PaymentStatus; counterpartyId: string; contractId: string | null; rootNumber: string | null } | null> {
  const st = (await paymentStatuses(db, [docId]))[docId];
  if (!st) return null;
  const root = await settlementRoot(db, docId);
  return { status: st, counterpartyId: root.counterpartyId!, contractId: root.contractId, rootNumber: root.number };
}

/** Событие «документ оплачен полностью» нужно только если остаток обнулился */
export async function remainingOf(db: Db, rootId: string): Promise<string> {
  return (await paymentStatuses(db, [rootId]))[rootId]?.remaining ?? '0.00';
}

/* ---------------- сальдо и отчёты ---------------- */

export interface DebtDoc {
  documentId: string;
  type: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  amount: string;
  overdueDays: number;
}
export interface DebtRow {
  companyId: string;
  companyName: string;
  mode: SettlementMode;
  /** Чистая задолженность на дату: у покупателя — он должен нам, у поставщика — мы должны */
  balance: string;
  debt: string;
  advance: string;
  overdue: string;
  docs: DebtDoc[];
}

/** Отчёт «Дебиторская/Кредиторская задолженность» на дату: долг по документам (с просрочкой по сроку оплаты) и авансы */
export async function debtReport(db: Db, workspaceId: string, side: Side, asOf: string, companyId?: string): Promise<{ rows: DebtRow[]; totals: { debt: string; advance: string; overdue: string } }> {
  const rows = await db
    .select({ companyId: settlementMoves.companyId, rootId: settlementMoves.settlementDocumentId, s: sum(settlementMoves.amount) })
    .from(settlementMoves)
    .where(and(eq(settlementMoves.workspaceId, workspaceId), eq(settlementMoves.side, side), sql`${settlementMoves.date} <= ${asOf}`, companyId ? eq(settlementMoves.companyId, companyId) : undefined))
    .groupBy(settlementMoves.companyId, settlementMoves.settlementDocumentId);
  const byCompany = new Map<string, { docs: { rootId: string; s: Dec }[]; pool: Dec }>();
  for (const r of rows) {
    const e = byCompany.get(r.companyId) ?? { docs: [], pool: 0n };
    if (r.rootId) e.docs.push({ rootId: r.rootId, s: dec(r.s) });
    else e.pool += dec(r.s);
    byCompany.set(r.companyId, e);
  }
  const names = new Map((await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, [...byCompany.keys()]))).map(c => [c.id, c.name]));
  const out: DebtRow[] = [];
  let tDebt = 0n;
  let tAdv = 0n;
  let tOver = 0n;
  const days = (due: string | null) => (due && due < asOf ? Math.round((Date.parse(asOf) - Date.parse(due)) / 86_400_000) : 0);
  for (const [cid, e] of byCompany) {
    const mode = await companyMode(db, cid);
    let debt = 0n;
    let advance = 0n;
    let overdue = 0n;
    const docs: DebtDoc[] = [];
    const ids = e.docs.map(d => d.rootId);
    const meta = new Map((ids.length ? await db.select(rootCols).from(documents).where(inArray(documents.id, ids)) : []).map(d => [d.id, d]));
    for (const d of e.docs) {
      if (d.s > 0n) {
        const m = meta.get(d.rootId);
        debt += d.s;
        const od = days(m?.dueDate ?? null);
        if (od > 0) overdue += d.s;
        docs.push({ documentId: d.rootId, type: m?.type ?? '', number: m?.number ?? null, date: m?.date ?? '', dueDate: m?.dueDate ?? null, amount: fmt(d.s, 2), overdueDays: od });
      } else advance += -d.s; // предоплата под заказ или счёт
    }
    if (e.pool < 0n) advance += -e.pool;
    else if (e.pool > 0n) {
      if (mode === 'by_counterparty') {
        // одно сальдо: долг распределён по документам FIFO, неоплаченные — по датам
        const fifo = await fifoPaid(db, cid, side);
        const accrualRows = await db
          .select({ docId: settlementMoves.documentId })
          .from(settlementMoves)
          .where(and(eq(settlementMoves.companyId, cid), eq(settlementMoves.side, side), eq(settlementMoves.kind, 'accrual'), sql`${settlementMoves.date} <= ${asOf}`));
        const seen = new Set<string>();
        for (const a of accrualRows) {
          const root = await settlementRoot(db, a.docId);
          if (seen.has(root.id)) continue;
          seen.add(root.id);
          const t = (await db.select({ s: sum(settlementMoves.amount) }).from(settlementMoves).where(and(eq(settlementMoves.kind, 'accrual'), eq(settlementMoves.companyId, cid), eq(settlementMoves.side, side), inArray(settlementMoves.documentId, await chainDocIds(db, root.id)))))[0]?.s ?? '0';
          const left = dec(t) - (fifo.paid.get(root.id) ?? 0n);
          if (left <= 0n) continue;
          const od = days(root.dueDate);
          if (od > 0) overdue += left;
          docs.push({ documentId: root.id, type: root.type, number: root.number, date: root.date, dueDate: root.dueDate, amount: fmt(left, 2), overdueDays: od });
        }
        debt += e.pool;
      } else debt += e.pool; // положительный пул: контрагент остался должен после возврата денег
    }
    // по контрагенту: чистое сальдо — долг только если оно положительное
    if (mode === 'by_counterparty') {
      const net = e.pool + e.docs.reduce((a, d) => a + d.s, 0n);
      debt = net > 0n ? net : 0n;
      advance = net < 0n ? -net : 0n;
      if (net <= 0n) {
        overdue = 0n;
        docs.length = 0;
      }
    }
    if (debt === 0n && advance === 0n) continue;
    tDebt += debt;
    tAdv += advance;
    tOver += overdue;
    out.push({ companyId: cid, companyName: names.get(cid) ?? '', mode, balance: fmt(debt - advance, 2), debt: fmt(debt, 2), advance: fmt(advance, 2), overdue: fmt(overdue, 2), docs: docs.sort((a, b) => (a.date < b.date ? -1 : 1)) });
  }
  out.sort((a, b) => (dec(b.debt) > dec(a.debt) ? 1 : dec(b.debt) < dec(a.debt) ? -1 : a.companyName.localeCompare(b.companyName)));
  return { rows: out, totals: { debt: fmt(tDebt, 2), advance: fmt(tAdv, 2), overdue: fmt(tOver, 2) } };
}

export interface SettlementCardSide {
  side: Side;
  opening: string;
  closing: string;
  rows: { date: string; documentId: string; documentType: string; number: string | null; label: string; accrual: string; payment: string }[];
}

/** Карточка контрагента: сальдо на дату по обеим сторонам и обороты периода (для акта сверки) */
export async function settlementCard(db: Db, workspaceId: string, companyId: string, p: { from?: string; to?: string; contractId?: string | null }): Promise<{ companyId: string; mode: SettlementMode; from: string; to: string; sides: SettlementCardSide[]; balances: Record<Side, string> }> {
  const to = p.to ?? new Date().toISOString().slice(0, 10);
  const from = p.from ?? `${to.slice(0, 4)}-01-01`;
  const mode = await companyMode(db, companyId);
  const sides: SettlementCardSide[] = [];
  const balances = { customer: '0.00', supplier: '0.00' } as Record<Side, string>;
  for (const side of ['customer', 'supplier'] as Side[]) {
    const base = [eq(settlementMoves.workspaceId, workspaceId), eq(settlementMoves.companyId, companyId), eq(settlementMoves.side, side), p.contractId ? eq(settlementMoves.contractId, p.contractId) : undefined];
    const [open] = await db.select({ s: sum(settlementMoves.amount) }).from(settlementMoves).where(and(...base, sql`${settlementMoves.date} < ${from}`));
    const [all] = await db.select({ s: sum(settlementMoves.amount) }).from(settlementMoves).where(and(...base, sql`${settlementMoves.date} <= ${to}`));
    const [now] = await db.select({ s: sum(settlementMoves.amount) }).from(settlementMoves).where(and(...base));
    balances[side] = fmt(dec(now?.s ?? '0'), 2);
    const moves = await db
      .select({ date: settlementMoves.date, documentId: settlementMoves.documentId, kind: settlementMoves.kind, s: sum(settlementMoves.amount), type: documents.type, number: documents.number })
      .from(settlementMoves)
      .innerJoin(documents, eq(documents.id, settlementMoves.documentId))
      .where(and(...base, sql`${settlementMoves.date} >= ${from}`, sql`${settlementMoves.date} <= ${to}`, ne(settlementMoves.kind, 'offset')))
      .groupBy(settlementMoves.date, settlementMoves.documentId, settlementMoves.kind, documents.type, documents.number)
      .orderBy(asc(settlementMoves.date));
    const rows = moves
      .map(m => {
        const v = dec(m.s);
        // долг растёт — «начисление», падает — «оплата» (возврат покупателя тоже уменьшает долг)
        return { date: m.date, documentId: m.documentId, documentType: m.type, number: m.number, label: `${DOCUMENT_LABELS_RU[m.type as DocumentType] ?? m.type}${m.number ? ` ${m.number}` : ''}`, accrual: fmt(v > 0n ? v : 0n, 2), payment: fmt(v < 0n ? -v : 0n, 2) };
      })
      .filter(r => r.accrual !== '0.00' || r.payment !== '0.00');
    if (dec(all?.s ?? '0') === 0n && !rows.length && dec(open?.s ?? '0') === 0n) continue;
    sides.push({ side, opening: fmt(dec(open?.s ?? '0'), 2), closing: fmt(dec(all?.s ?? '0'), 2), rows });
  }
  return { companyId, mode, from, to, sides, balances };
}
