/* Склад: движения, остатки, средняя скользящая себестоимость, резервы. Всё пишется в транзакции проведения документа.
   Остаток по (склад, товар) блокируется строкой stock_balances (FOR UPDATE, в порядке ключей — без взаимных блокировок),
   поэтому параллельные проведения не могут уйти в минус одновременно и порядок движений (seq) совпадает с порядком блокировок. */
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { dec, fmt, replayMoves, stockIn, stockOut, weightedAvgCost, DOCUMENT_META, DOCUMENT_TYPES, type Dec, type DocumentType, type InventorySettings, type StockState } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { documentLines, documents, productionItems, products, stockBalances, stockMoves, stockReservations, workspaces } from './schema';

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
  /** Приход по цене фактического расхода той же строки (перемещение между складами) */
  costFromLine?: boolean;
  /** Фаза движения: 1 — основная, 2 — приёмка (перемещение «в пути») */
  phase?: number;
}

/** Записывает движения документа и обновляет остатки (в той же транзакции). Расход списывается по текущей средней; приход
    пересчитывает среднюю. Расходы пишутся раньше приходов: цена прихода перемещения — фактическая цена расхода той же строки.
    Уход в минус запрещён, пока воркспейс не разрешил его настройкой.
    `opts.inCost` считает цену прихода после расходов (выпуск: себестоимость партии из списанных материалов и работ).
    Возвращает фактическую цену расхода по каждой строке */
export async function applyStockMoves(db: Db, workspaceId: string, doc: { id: string; date: string }, reqs: MoveRequest[], settings: InventorySettings, opts?: { inCost?: (lineId: string, outCost: Map<string, Dec>) => Dec | undefined }): Promise<Map<string, Dec>> {
  if (!reqs.length) return new Map();
  const state = await lockBalances(db, workspaceId, reqs);
  const rows: (typeof stockMoves.$inferInsert)[] = [];
  const need = new Map<string, Dec>();
  /** Фактическая цена расхода по строке документа — ею оценивается приход перемещения */
  const outCost = new Map<string, Dec>();
  const apply = (r: MoveRequest) => {
    const k = keyOf(r);
    const s = state.get(k)!;
    if (r.direction === 'in') {
      const cost = opts?.inCost?.(r.lineId, outCost) ?? r.cost ?? (r.costFromLine ? outCost.get(r.lineId) : undefined) ?? s.avg;
      const next = stockIn(s, r.qty, cost);
      state.set(k, next);
      rows.push({ workspaceId, warehouseId: r.warehouseId, productId: r.productId, documentId: doc.id, documentLineId: r.lineId, qty: fmt(r.qty, 3), cost: fmt(cost, 4), movedAt: doc.date, phase: r.phase ?? 1 });
    } else {
      need.set(k, (need.get(k) ?? 0n) + r.qty);
      const o = stockOut(s, r.qty);
      state.set(k, o.state);
      outCost.set(r.lineId, o.cost);
      rows.push({ workspaceId, warehouseId: r.warehouseId, productId: r.productId, documentId: doc.id, documentLineId: r.lineId, qty: fmt(-r.qty, 3), cost: fmt(o.cost, 4), movedAt: doc.date, phase: r.phase ?? 1 });
    }
  };
  for (const r of reqs) if (r.direction === 'out') apply(r);
  if (!settings.allowNegativeStock) {
    const shortages = new Map<string, { key: StockKey; available: Dec; needed: Dec }>();
    for (const [k, s] of state) {
      const needed = need.get(k);
      if (needed === undefined || s.qty >= 0n) continue;
      const [warehouseId, productId] = k.split(':') as [string, string];
      shortages.set(k, { key: { warehouseId, productId }, available: s.qty + needed, needed });
    }
    if (shortages.size) {
      const names = await productNames(db, [...shortages.values()].map(s => s.key.productId));
      const items = [...shortages.values()].map(s => ({ productId: s.key.productId, warehouseId: s.key.warehouseId, name: names.get(s.key.productId) ?? s.key.productId, available: fmt(s.available, 3), needed: fmt(s.needed, 3) }));
      throw new DomainError(422, 'insufficient_stock', `Not enough stock: ${items.map(i => `${i.name} (available ${i.available}, needed ${i.needed})`).join('; ')}`, { items });
    }
  }
  for (const r of reqs) if (r.direction === 'in') apply(r);
  await db.insert(stockMoves).values(rows);
  for (const [k, s] of state) {
    const [warehouseId, productId] = k.split(':') as [string, string];
    await db.update(stockBalances).set({ qty: fmt(s.qty, 3), avgCost: fmt(s.avg, 4), updatedAt: new Date() }).where(and(eq(stockBalances.warehouseId, warehouseId), eq(stockBalances.productId, productId)));
  }
  return outCost;
}

/** Себестоимость единицы прихода по умолчанию (для оприходования): текущая средняя склада, иначе последняя закупочная цена */
export async function defaultPostingCost(db: Db, warehouseId: string | null, productId: string): Promise<{ cost: string; source: 'avg' | 'last_receipt' | 'purchase' }> {
  if (warehouseId) {
    const [b] = await db.select({ avgCost: stockBalances.avgCost }).from(stockBalances).where(and(eq(stockBalances.warehouseId, warehouseId), eq(stockBalances.productId, productId))).limit(1);
    if (b && dec(b.avgCost) > 0n) return { cost: fmt(dec(b.avgCost), 2), source: 'avg' };
  }
  // последняя закупочная цена: цена последнего проведённого поступления по товару
  const [m] = await db
    .select({ cost: stockMoves.cost })
    .from(stockMoves)
    .innerJoin(documents, eq(documents.id, stockMoves.documentId))
    .where(and(eq(stockMoves.productId, productId), eq(documents.type, 'receipt'), eq(documents.status, 'posted'), sql`${stockMoves.qty} > 0`))
    .orderBy(desc(stockMoves.seq))
    .limit(1);
  if (m && dec(m.cost) > 0n) return { cost: fmt(dec(m.cost), 2), source: 'last_receipt' };
  const [p] = await db.select({ purchasePrice: products.purchasePrice }).from(products).where(eq(products.id, productId)).limit(1);
  return { cost: p?.purchasePrice ?? '0', source: 'purchase' };
}

/** Стоимость документов по движениям: сумма qty × cost. У перемещения есть расход и приход — берётся только расходная
    сторона (иначе они взаимно сократились бы), у списания — расход, у оприходования — приход */
export async function documentCosts(db: Db, documentIds: string[]): Promise<Map<string, string>> {
  if (!documentIds.length) return new Map();
  const rows = await db
    .select({
      documentId: stockMoves.documentId,
      hasOut: sql<boolean>`bool_or(${stockMoves.qty} < 0)`,
      out: sql<string>`coalesce(sum(case when ${stockMoves.qty} < 0 then -${stockMoves.qty} * ${stockMoves.cost} else 0 end), 0)::text`,
      in: sql<string>`coalesce(sum(case when ${stockMoves.qty} > 0 then ${stockMoves.qty} * ${stockMoves.cost} else 0 end), 0)::text`,
    })
    .from(stockMoves)
    .where(inArray(stockMoves.documentId, documentIds))
    .groupBy(stockMoves.documentId);
  return new Map(rows.map(r => [r.documentId, fmt(dec(r.hasOut ? r.out : r.in), 2)]));
}

/** Удаляет движения документа и пересчитывает остатки и среднюю по оставшимся движениям (отмена проведения).
    Расходы после отменённого прихода переоцениваются по новой средней; если после этого остаток уходит в минус — отмена запрещена.
    `phase` — отменить только одну фазу (перемещение «в пути»: отмена приёмки) */
export async function revertStockMoves(db: Db, workspaceId: string, documentId: string, settings: InventorySettings, phase?: number): Promise<void> {
  const scope = phase ? and(eq(stockMoves.documentId, documentId), eq(stockMoves.phase, phase)) : eq(stockMoves.documentId, documentId);
  const own = await db.select({ warehouseId: stockMoves.warehouseId, productId: stockMoves.productId }).from(stockMoves).where(scope);
  if (!own.length) return;
  const keys = uniqueKeys(own);
  await lockBalances(db, workspaceId, keys);
  await db.delete(stockMoves).where(scope);
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

/** Себестоимость единицы по каждой строке документа: расходная сторона (у перемещения — цена ушедшего товара) */
export async function documentLineCosts(db: Db, documentId: string): Promise<Map<string, string>> {
  const rows = await db.select({ lineId: stockMoves.documentLineId, qty: stockMoves.qty, cost: stockMoves.cost }).from(stockMoves).where(eq(stockMoves.documentId, documentId));
  const out = new Map<string, string>();
  const incoming = new Map<string, string>();
  for (const r of rows) {
    if (!r.lineId) continue;
    if (dec(r.qty) < 0n) out.set(r.lineId, r.cost);
    else incoming.set(r.lineId, r.cost);
  }
  return new Map([...incoming, ...out]);
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
  // резерв снимают документы-исполнители, перечисленные в метаданных типа заказа
  const releasers = [...new Set(DOCUMENT_TYPES.filter(t => DOCUMENT_META[t].reserves).flatMap(t => DOCUMENT_META[t].reservedUntil ?? []))];
  const shippedRows = releasers.length
    ? await db
        .select({ origin: documentLines.originLineId, qty: sql<string>`sum(${documentLines.qty})` })
        .from(documentLines)
        .innerJoin(documents, eq(documents.id, documentLines.documentId))
        .where(and(inArray(documentLines.originLineId, ids), eq(documents.status, 'posted'), inArray(documents.type, releasers)))
        .groupBy(documentLines.originLineId)
    : [];
  const shipped = new Map(shippedRows.map(r => [r.origin!, dec(r.qty)]));
  /** Сколько ещё можно держать в резерве выпущенной под строку продукции: остаток строки к отгрузке */
  const leftForProduction = new Map<string, Dec>();
  for (const l of lines) {
    const reserves = DOCUMENT_META[l.type as DocumentType].reserves === true;
    const open = reserves && l.status === 'posted' && l.kind === 'goods' ? dec(l.qty) - (shipped.get(l.id) ?? 0n) : 0n;
    const want = l.warehouseId ? open : 0n;
    leftForProduction.set(l.id, open > 0n ? open : 0n);
    if (want > 0n) {
      await db
        .insert(stockReservations)
        .values({ workspaceId, documentId: l.documentId, documentLineId: l.id, warehouseId: l.warehouseId!, productId: l.productId, qty: fmt(want, 3) })
        .onConflictDoUpdate({ target: stockReservations.documentLineId, set: { qty: fmt(want, 3), warehouseId: l.warehouseId!, updatedAt: new Date() } });
    } else await db.delete(stockReservations).where(eq(stockReservations.documentLineId, l.id));
  }
  // Резерв продукции, выпущенной под заказ (production_line_id): отгрузка уменьшает его, отмена заказа снимает.
  // Сначала урезаются самые поздние выпуски
  const prodRes = await db
    .select({ id: stockReservations.id, qty: stockReservations.qty, orderLineId: productionItems.customerOrderLineId })
    .from(stockReservations)
    .innerJoin(productionItems, eq(productionItems.documentLineId, stockReservations.productionLineId))
    .where(inArray(productionItems.customerOrderLineId, ids))
    .orderBy(asc(stockReservations.updatedAt));
  for (const r of prodRes) {
    const left = leftForProduction.get(r.orderLineId!) ?? 0n;
    const keep = dec(r.qty) < left ? dec(r.qty) : left;
    leftForProduction.set(r.orderLineId!, left - keep);
    if (keep <= 0n) await db.delete(stockReservations).where(eq(stockReservations.id, r.id));
    else if (keep < dec(r.qty)) await db.update(stockReservations).set({ qty: fmt(keep, 3), updatedAt: new Date() }).where(eq(stockReservations.id, r.id));
  }
}
