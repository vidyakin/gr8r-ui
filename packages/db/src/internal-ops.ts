/* Перемещение «в пути» и передача в эксплуатацию: виды перемещения, у которых своя логика проведения.
   Здесь же — служебный склад «в пути» (один на воркспейс) и количественный учёт имущества «у кого» (сотрудник или участок).
   Хуки типа регистрируются в этом файле, чтобы общий сервис документов не знал про эти режимы. */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { dec, fmt } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { DOCUMENT_HOOKS, STATE_HOOKS } from './document-hooks';
import { applyDocumentMoves, type DocCtx, type DocumentLineRow, type DocumentRow } from './documents';
import { applyStockMoves, loadInventorySettings, revertStockMoves, type MoveRequest } from './stock';
import { costItems, documentLines, documents, inUseBalances, inUseMoves, products, warehouses } from './schema';

/** Служебный склад «в пути»: один на воркспейс, создаётся лениво (при первом перемещении «в пути») */
export async function ensureTransitWarehouse(db: Db, workspaceId: string): Promise<string> {
  const found = await db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.workspaceId, workspaceId), eq(warehouses.kind, 'transit'))).limit(1);
  if (found[0]) return found[0].id;
  await db.insert(warehouses).values({ workspaceId, name: 'В пути', code: 'TRANSIT', kind: 'transit' }).onConflictDoNothing();
  const [w] = await db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.workspaceId, workspaceId), eq(warehouses.kind, 'transit'))).limit(1);
  if (!w) throw new DomainError(422, 'transit_warehouse_failed', 'Could not create the in-transit warehouse');
  return w.id;
}

/** Строки с товарами (услуги склад не двигают) */
async function goodsLines(db: Db, lines: DocumentLineRow[]): Promise<DocumentLineRow[]> {
  if (!lines.length) return [];
  const kinds = new Map((await db.select({ id: products.id, kind: products.kind }).from(products).where(inArray(products.id, [...new Set(lines.map(l => l.productId))]))).map(p => [p.id, p.kind]));
  return lines.filter(l => kinds.get(l.productId) === 'goods');
}

/* ---------------- передача в эксплуатацию ---------------- */

/** Остаток имущества у получателя по его движениям */
async function inUseQty(db: Db, workspaceId: string, productId: string, memberId: string | null, workCenterId: string | null): Promise<bigint> {
  const [row] = await db
    .select({ qty: sql<string>`coalesce(sum(${inUseMoves.qty}), 0)::text` })
    .from(inUseMoves)
    .where(and(eq(inUseMoves.workspaceId, workspaceId), eq(inUseMoves.productId, productId), memberId ? eq(inUseMoves.memberId, memberId) : eq(inUseMoves.workCenterId, workCenterId!)));
  return dec(row?.qty ?? '0');
}

/** Остаток пересчитывается по движениям: отмена одного документа не ломает остаток у получателя */
async function recomputeInUseBalance(db: Db, workspaceId: string, productId: string, memberId: string | null, workCenterId: string | null): Promise<void> {
  const qty = await inUseQty(db, workspaceId, productId, memberId, workCenterId);
  const where = and(eq(inUseBalances.workspaceId, workspaceId), eq(inUseBalances.productId, productId), memberId ? eq(inUseBalances.memberId, memberId) : eq(inUseBalances.workCenterId, workCenterId!));
  const [bal] = await db.select().from(inUseBalances).where(where).limit(1);
  if (!bal) {
    if (qty !== 0n) await db.insert(inUseBalances).values({ workspaceId, productId, memberId, workCenterId, qty: fmt(qty, 3) }).onConflictDoNothing();
    return;
  }
  await db.update(inUseBalances).set({ qty: fmt(qty, 3), updatedAt: new Date() }).where(eq(inUseBalances.id, bal.id));
}

/** Движения имущества документа откатываются: остатки у получателей пересчитываются по оставшимся движениям.
    Если после отмены остаток у получателя уходит в минус (товар уже вернули или списали) — отмена запрещена */
export async function revertInUseMoves(db: Db, workspaceId: string, documentId: string): Promise<void> {
  const moves = await db.select().from(inUseMoves).where(eq(inUseMoves.documentId, documentId));
  await db.delete(inUseMoves).where(eq(inUseMoves.documentId, documentId));
  for (const m of moves) {
    const qty = await inUseQty(db, workspaceId, m.productId, m.memberId, m.workCenterId);
    if (qty < 0n) throw new DomainError(422, 'in_use_conflict', 'Cannot unpost: the goods in use were already returned or written off. Unpost those documents first');
    await recomputeInUseBalance(db, workspaceId, m.productId, m.memberId, m.workCenterId);
  }
}

/* ---------------- перемещение «в пути» ---------------- */

/** Отправка: расход со склада отправителя и приход на служебный склад «в пути». Документ переходит в состояние «отправлено» */
async function shipTransfer(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  const transitId = await ensureTransitWarehouse(db, ctx.workspaceId);
  const goods = await goodsLines(db, lines);
  const reqs: MoveRequest[] = [];
  for (const l of goods) {
    reqs.push({ warehouseId: doc.warehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'out' });
    reqs.push({ warehouseId: transitId, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'in', costFromLine: true });
  }
  await applyStockMoves(db, ctx.workspaceId, { id: doc.id, date: doc.date }, reqs, await loadInventorySettings(db, ctx.workspaceId));
  await db.update(documents).set({ state: 'shipped', updatedAt: new Date() }).where(eq(documents.id, doc.id));
}

/** Приёмка: расход со склада «в пути» и приход получателю по принятому количеству (вторая фаза движений) */
async function receiveTransfer(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[], received?: { id: string; qty: string }[]): Promise<void> {
  const transitId = await ensureTransitWarehouse(db, ctx.workspaceId);
  const goods = await goodsLines(db, lines);
  const reqs: MoveRequest[] = [];
  for (const l of goods) {
    const asked = received?.find(r => r.id === l.id);
    const qty = asked ? dec(asked.qty) : dec(l.receivedQty || '0') > 0n ? dec(l.receivedQty) : dec(l.qty);
    if (qty < 0n || qty > dec(l.qty)) throw new DomainError(422, 'invalid_received_qty', `"${l.name}": the accepted quantity must not exceed the shipped one`);
    await db.update(documentLines).set({ receivedQty: fmt(qty, 3) }).where(eq(documentLines.id, l.id));
    if (qty <= 0n) continue;
    reqs.push({ warehouseId: transitId, productId: l.productId, lineId: l.id, qty, direction: 'out', phase: 2 });
    reqs.push({ warehouseId: doc.targetWarehouseId!, productId: l.productId, lineId: l.id, qty, direction: 'in', costFromLine: true, phase: 2 });
  }
  if (!reqs.length) throw new DomainError(422, 'nothing_received', 'Accept at least one line');
  await applyStockMoves(db, ctx.workspaceId, { id: doc.id, date: doc.date }, reqs, await loadInventorySettings(db, ctx.workspaceId));
}

/** Отмена приёмки: движения второй фазы удаляются, товар остаётся «в пути» */
async function cancelReception(db: Db, ctx: DocCtx, doc: DocumentRow): Promise<void> {
  await revertStockMoves(db, ctx.workspaceId, doc.id, await loadInventorySettings(db, ctx.workspaceId), 2);
}

/* ---------------- передача в эксплуатацию ---------------- */

/** Передача в эксплуатацию: расход со склада (себестоимость — на статью затрат) и количественный учёт «у кого» */
async function transferToOperation(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  const goods = await goodsLines(db, lines);
  const reqs: MoveRequest[] = goods.map(l => ({ warehouseId: doc.warehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'out' }));
  if (reqs.length) await applyStockMoves(db, ctx.workspaceId, { id: doc.id, date: doc.date }, reqs, await loadInventorySettings(db, ctx.workspaceId));
  for (const l of goods) {
    await db.insert(inUseMoves).values({ workspaceId: ctx.workspaceId, documentId: doc.id, documentLineId: l.id, productId: l.productId, memberId: doc.inUseMemberId, workCenterId: doc.inUseWorkCenterId, qty: fmt(dec(l.qty), 3), movedAt: doc.date });
    await recomputeInUseBalance(db, ctx.workspaceId, l.productId, doc.inUseMemberId, doc.inUseWorkCenterId);
  }
}

/** Возврат из эксплуатации: остаток у получателя уменьшается, склад не меняется */
async function returnFromOperation(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  const goods = await goodsLines(db, lines);
  for (const l of goods) {
    const have = await inUseQty(db, ctx.workspaceId, l.productId, doc.inUseMemberId, doc.inUseWorkCenterId);
    if (have < dec(l.qty)) throw new DomainError(422, 'insufficient_in_use', `"${l.name}": there are not enough goods in use at this holder (${fmt(have, 3)})`);
    await db.insert(inUseMoves).values({ workspaceId: ctx.workspaceId, documentId: doc.id, documentLineId: l.id, productId: l.productId, memberId: doc.inUseMemberId, workCenterId: doc.inUseWorkCenterId, qty: fmt(-dec(l.qty), 3), movedAt: doc.date });
    await recomputeInUseBalance(db, ctx.workspaceId, l.productId, doc.inUseMemberId, doc.inUseWorkCenterId);
  }
}

/* ---------------- регистрация хуков ---------------- */

DOCUMENT_HOOKS.stock_transfer = {
  check: async (db, _ctx, doc, lines) => {
    const goods = await goodsLines(db, lines);
    if (!goods.length) throw new DomainError(422, 'no_lines', 'Add at least one line before posting');
    // возврат из эксплуатации склад не меняет — склад ему не нужен
    if (doc.operation !== 'from_operation' && !doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse before posting');
    if ((doc.operation === 'transfer' || doc.operation === 'in_transit') && (!doc.targetWarehouseId || doc.targetWarehouseId === doc.warehouseId)) throw new DomainError(422, 'target_warehouse_required', 'Select another warehouse to move the goods to');
    if (doc.operation === 'to_operation') {
      if (!doc.costItemId) throw new DomainError(422, 'cost_item_required', 'Select an expense cost item before posting');
      const [c] = await db.select({ kind: costItems.kind }).from(costItems).where(eq(costItems.id, doc.costItemId)).limit(1);
      if (c?.kind !== 'expense') throw new DomainError(422, 'cost_item_kind_mismatch', 'This document needs an expense cost item');
    }
  },
  post: async (db, ctx, doc, lines) => {
    if (doc.operation === 'in_transit') return shipTransfer(db, ctx, doc, lines);
    if (doc.operation === 'to_operation') return transferToOperation(db, ctx, doc, lines);
    if (doc.operation === 'from_operation') return returnFromOperation(db, ctx, doc, lines);
    return applyDocumentMoves(db, ctx, doc, lines);
  },
  afterUnpost: async (db, ctx, doc) => {
    // отмена проведения возвращает товар «в пути» и снимает учёт «у кого»
    if (doc.operation === 'in_transit') await db.update(documents).set({ state: null, updatedAt: new Date() }).where(eq(documents.id, doc.id));
    await revertInUseMoves(db, ctx.workspaceId, doc.id);
  },
};

STATE_HOOKS.stock_transfer = async (db, ctx, doc, from, to, payload) => {
  if (doc.operation !== 'in_transit') return;
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, doc.id));
  if (to === 'received') await receiveTransfer(db, ctx, doc, lines, payload?.received);
  else if (to === 'shipped' && from === 'received') await cancelReception(db, ctx, doc);
};
