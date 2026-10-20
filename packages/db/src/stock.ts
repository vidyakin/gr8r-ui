/* Склад: движения, остатки, средняя скользящая себестоимость, резервы. Всё пишется в транзакции проведения документа.
   Остаток по (склад, товар) блокируется строкой stock_balances (FOR UPDATE, в порядке ключей — без взаимных блокировок),
   поэтому параллельные проведения не могут уйти в минус одновременно и порядок движений (seq) совпадает с порядком блокировок. */
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { dec, fmt, replayMoves, stockIn, stockOut, weightedAvgCost, type Dec, type InventorySettings, type StockState } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { documentLines, documents, products, stockBalances, stockMoves, stockReservations, workspaces } from './schema';

export interface StockKey {
  warehouseId: string;
  productId: string;
}

const keyOf = (k: StockKey) => `${k.warehouseId}:${k.productId}`;
const uniqueKeys = (keys: StockKey[]): StockKey[] => [...new Map(keys.map(k => [keyOf(k), { warehouseId: k.warehouseId, productId: k.productId }])).values()].sort((a, b) => (a.warehouseId === b.warehouseId ? a.productId.localeCompare(b.productId) : a.warehouseId.localeCompare(b.warehouseId)));

export async function loadInventorySettings(db: Db, workspaceId: string): Promise<InventorySettings> {
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return { allowNegativeStock: ws?.settings?.allowNegativeStock === true };
}

/** Создаёт недостающие строки остатков и блокирует все нужные; возвращает состояния */
async function lockBalances(db: Db, workspaceId: string, keys: StockKey[]): Promise<Map<string, StockState>> {
  const uniq = uniqueKeys(keys);
  const out = new Map<string, StockState>();
  if (!uniq.length) return out;
  await db.insert(stockBalances).values(uniq.map(k => ({ workspaceId, ...k }))).onConflictDoNothing();
  const rows = await db
    .select()
    .from(stockBalances)
    .where(or(...uniq.map(k => and(eq(stockBalances.warehouseId, k.warehouseId), eq(stockBalances.productId, k.productId))))!)
    .orderBy(asc(stockBalances.warehouseId), asc(stockBalances.productId))
    .for('update');
  for (const r of rows) out.set(keyOf(r), { qty: dec(r.qty), avg: dec(r.avgCost) });
  return out;
}

async function productNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, ids));
  return new Map(rows.map(r => [r.id, r.name]));
}

export interface MoveRequest extends StockKey {
  lineId: string;
  /** Положительное количество */
  qty: Dec;
  direction: 'in' | 'out';
  /** Приход: цена единицы; без неё берётся текущая средняя склада */
  cost?: Dec;
}

/** Записывает движения документа и обновляет остатки (в той же транзакции). Расход списывается по текущей средней; приход
    пересчитывает среднюю. Уход в минус запрещён, пока воркспейс не разрешил его настройкой */
export async function applyStockMoves(db: Db, workspaceId: string, doc: { id: string; date: string }, reqs: MoveRequest[], settings: InventorySettings): Promise<void> {
  if (!reqs.length) return;
  const state = await lockBalances(db, workspaceId, reqs);
  const rows: (typeof stockMoves.$inferInsert)[] = [];
  const shortages = new Map<string, { key: StockKey; available: Dec; needed: Dec }>();
  const need = new Map<string, Dec>();
  for (const r of reqs) {
    const k = keyOf(r);
    const s = state.get(k)!;
    if (r.direction === 'in') {
      const next = stockIn(s, r.qty, r.cost ?? s.avg);
      state.set(k, next);
      rows.push({ workspaceId, warehouseId: r.warehouseId, productId: r.productId, documentId: doc.id, documentLineId: r.lineId, qty: fmt(r.qty, 3), cost: fmt(r.cost ?? s.avg, 4), movedAt: doc.date });
    } else {
      need.set(k, (need.get(k) ?? 0n) + r.qty);
      const o = stockOut(s, r.qty);
      state.set(k, o.state);
      rows.push({ workspaceId, warehouseId: r.warehouseId, productId: r.productId, documentId: doc.id, documentLineId: r.lineId, qty: fmt(-r.qty, 3), cost: fmt(o.cost, 4), movedAt: doc.date });
    }
  }
  if (!settings.allowNegativeStock) {
    for (const [k, s] of state) {
      if (s.qty < 0n) {
        const [warehouseId, productId] = k.split(':') as [string, string];
        const needed = need.get(k) ?? 0n;
        shortages.set(k, { key: { warehouseId, productId }, available: s.qty + needed, needed });
      }
    }
    if (shortages.size) {
      const names = await productNames(db, [...shortages.values()].map(s => s.key.productId));
      const items = [...shortages.values()].map(s => ({ productId: s.key.productId, warehouseId: s.key.warehouseId, name: names.get(s.key.productId) ?? s.key.productId, available: fmt(s.available, 3), needed: fmt(s.needed, 3) }));
      throw new DomainError(422, 'insufficient_stock', `Not enough stock: ${items.map(i => `${i.name} (available ${i.available}, needed ${i.needed})`).join('; ')}`, { items });
    }
  }
  await db.insert(stockMoves).values(rows);
  for (const [k, s] of state) {
    const [warehouseId, productId] = k.split(':') as [string, string];
    await db.update(stockBalances).set({ qty: fmt(s.qty, 3), avgCost: fmt(s.avg, 4), updatedAt: new Date() }).where(and(eq(stockBalances.warehouseId, warehouseId), eq(stockBalances.productId, productId)));
  }
}

/** Удаляет движения документа и пересчитывает остатки и среднюю по оставшимся движениям (отмена проведения).
    Расходы после отменённого прихода переоцениваются по новой средней; если после этого остаток уходит в минус — отмена запрещена */
export async function revertStockMoves(db: Db, workspaceId: string, documentId: string, settings: InventorySettings): Promise<void> {
  const own = await db.select({ warehouseId: stockMoves.warehouseId, productId: stockMoves.productId }).from(stockMoves).where(eq(stockMoves.documentId, documentId));
  if (!own.length) return;
  const keys = uniqueKeys(own);
  await lockBalances(db, workspaceId, keys);
  await db.delete(stockMoves).where(eq(stockMoves.documentId, documentId));
  const bad: StockKey[] = [];
  for (const k of keys) {
    const moves = await db
      .select({ id: stockMoves.id, qty: stockMoves.qty, cost: stockMoves.cost })
      .from(stockMoves)
      .where(and(eq(stockMoves.warehouseId, k.warehouseId), eq(stockMoves.productId, k.productId)))
      .orderBy(asc(stockMoves.seq));
    const r = replayMoves(moves.map(m => ({ qty: dec(m.qty), cost: dec(m.cost) })));
    for (const [i, m] of moves.entries()) {
      const cost = fmt(r.moves[i]!.cost, 4);
      if (dec(m.qty) < 0n && cost !== m.cost) await db.update(stockMoves).set({ cost }).where(eq(stockMoves.id, m.id));
    }
    if (!settings.allowNegativeStock && (r.minQty < 0n || r.state.qty < 0n)) bad.push(k);
    await db.update(stockBalances).set({ qty: fmt(r.state.qty, 3), avgCost: fmt(r.state.avg, 4), updatedAt: new Date() }).where(and(eq(stockBalances.warehouseId, k.warehouseId), eq(stockBalances.productId, k.productId)));
  }
  if (bad.length) {
    const names = await productNames(db, bad.map(b => b.productId));
    throw new DomainError(422, 'stock_conflict', `Cannot unpost: later stock movements need these items (${bad.map(b => names.get(b.productId) ?? b.productId).join(', ')}). Unpost the dependent documents first.`, { productIds: bad.map(b => b.productId) });
  }
}

/** Цена прихода по строке возврата: себестоимость исходного движения (если строка скопирована с реализации или поступления) */
export async function sourceMoveCosts(db: Db, lineIds: string[]): Promise<Map<string, Dec>> {
  if (!lineIds.length) return new Map();
  const rows = await db.select({ lineId: stockMoves.documentLineId, cost: stockMoves.cost }).from(stockMoves).where(inArray(stockMoves.documentLineId, lineIds));
  return new Map(rows.filter(r => r.lineId).map(r => [r.lineId!, dec(r.cost)]));
}

/** Средняя себестоимость товаров «по организации»: средняя по складам, взвешенная остатком. Только товары с остатком и ненулевой ценой.
    Источник цены материала «средняя себестоимость склада» в расчёте производства */
export async function loadAvgCosts(db: Db, productIds?: string[]): Promise<Map<string, string>> {
  const rows = await db
    .select({ productId: stockBalances.productId, qty: stockBalances.qty, avgCost: stockBalances.avgCost })
    .from(stockBalances)
    .where(and(sql`${stockBalances.qty} > 0`, productIds ? inArray(stockBalances.productId, productIds) : undefined));
  const by = new Map<string, { qty: string; avgCost: string }[]>();
  for (const r of rows) by.set(r.productId, [...(by.get(r.productId) ?? []), r]);
  const out = new Map<string, string>();
  for (const [id, list] of by) {
    const avg = weightedAvgCost(list);
    if (avg) out.set(id, avg);
  }
  return out;
}

/** Резервы под проведённые заказы покупателей: по каждой строке заказа резерв = заказано − отгружено (проведёнными реализациями).
    Пересчитывается для переданных строк заказов; вызывается после проведения и отмены проведения заказов и отгрузок */
export async function syncReservations(db: Db, workspaceId: string, orderLineIds: string[]): Promise<void> {
  const ids = [...new Set(orderLineIds)];
  if (!ids.length) return;
  const lines = await db
    .select({ id: documentLines.id, documentId: documentLines.documentId, qty: documentLines.qty, productId: documentLines.productId, status: documents.status, type: documents.type, warehouseId: documents.warehouseId, kind: products.kind })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .innerJoin(products, eq(products.id, documentLines.productId))
    .where(inArray(documentLines.id, ids));
  const shippedRows = await db
    .select({ origin: documentLines.originLineId, qty: sql<string>`sum(${documentLines.qty})` })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(inArray(documentLines.originLineId, ids), eq(documents.status, 'posted'), eq(documents.type, 'realization')))
    .groupBy(documentLines.originLineId);
  const shipped = new Map(shippedRows.map(r => [r.origin!, dec(r.qty)]));
  for (const l of lines) {
    const want = l.type === 'customer_order' && l.status === 'posted' && l.warehouseId && l.kind === 'goods' ? dec(l.qty) - (shipped.get(l.id) ?? 0n) : 0n;
    if (want > 0n) {
      await db
        .insert(stockReservations)
        .values({ workspaceId, documentId: l.documentId, documentLineId: l.id, warehouseId: l.warehouseId!, productId: l.productId, qty: fmt(want, 3) })
        .onConflictDoUpdate({ target: stockReservations.documentLineId, set: { qty: fmt(want, 3), warehouseId: l.warehouseId!, updatedAt: new Date() } });
    } else await db.delete(stockReservations).where(eq(stockReservations.documentLineId, l.id));
  }
}
