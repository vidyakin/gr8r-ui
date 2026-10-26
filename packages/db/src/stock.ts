/* Склад: движения, остатки, средняя скользящая себестоимость, резервы. Всё пишется в транзакции проведения документа.
   Остаток по (склад, товар) блокируется строкой stock_balances (FOR UPDATE, в порядке ключей — без взаимных блокировок),
   поэтому параллельные проведения не могут уйти в минус одновременно и порядок движений (seq) совпадает с порядком блокировок. */
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { dec, div, fmt, mul, pctOf, replayMoves, stockIn, stockOut, weightedAvgCost, DOCUMENT_META, DOCUMENT_TYPES, type Dec, type DocumentType, type InventorySettings, type StockState } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { documentLines, documents, manufacturedItems, productionComponents, productionHeaders, productionItems, products, stockBalances, stockCostAdjustments, stockMoves, stockReservations, workspaces } from './schema';

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
  /** Строка документа; у материалов заказ-наряда строки нет — null */
  lineId: string | null;
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
export async function applyStockMoves(db: Db, workspaceId: string, doc: { id: string; date: string }, reqs: MoveRequest[], settings: InventorySettings, opts?: { inCost?: (lineId: string | null, outCost: Map<string, Dec>) => Dec | undefined }): Promise<Map<string, Dec>> {
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
      const cost = opts?.inCost?.(r.lineId, outCost) ?? r.cost ?? (r.costFromLine && r.lineId ? outCost.get(r.lineId) : undefined) ?? s.avg;
      const next = stockIn(s, r.qty, cost);
      state.set(k, next);
      rows.push({ workspaceId, warehouseId: r.warehouseId, productId: r.productId, documentId: doc.id, documentLineId: r.lineId, qty: fmt(r.qty, 3), cost: fmt(cost, 4), movedAt: doc.date, phase: r.phase ?? 1 });
    } else {
      need.set(k, (need.get(k) ?? 0n) + r.qty);
      const o = stockOut(s, r.qty);
      state.set(k, o.state);
      if (r.lineId) outCost.set(r.lineId, o.cost);
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

/* Корректировка себестоимости закрытия периода прибавляется к цене движения: стоимость везде читается как cost + delta.
   Средняя остатка (stock_balances.avg_cost) уже пересчитана при закрытии, поэтому отдельно тут не участвует. */
const effectiveCost = sql<string>`(${stockMoves.cost} + coalesce(${stockCostAdjustments.deltaCost}, 0))`;

/** Стоимость документов по движениям: сумма qty × (себестоимость + корректировка). У перемещения есть расход и приход —
    берётся только расходная сторона (иначе они взаимно сократились бы), у списания — расход, у оприходования — приход */
export async function documentCosts(db: Db, documentIds: string[]): Promise<Map<string, string>> {
  if (!documentIds.length) return new Map();
  const rows = await db
    .select({
      documentId: stockMoves.documentId,
      hasOut: sql<boolean>`bool_or(${stockMoves.qty} < 0)`,
      out: sql<string>`coalesce(sum(case when ${stockMoves.qty} < 0 then -${stockMoves.qty} * ${effectiveCost} else 0 end), 0)::text`,
      in: sql<string>`coalesce(sum(case when ${stockMoves.qty} > 0 then ${stockMoves.qty} * ${effectiveCost} else 0 end), 0)::text`,
    })
    .from(stockMoves)
    .leftJoin(stockCostAdjustments, and(eq(stockCostAdjustments.workspaceId, stockMoves.workspaceId), eq(stockCostAdjustments.moveId, stockMoves.id)))
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
  // после закрытия периода пересчёт пойдёт по всем остаткам: блокируем их все заранее и в общем порядке
  const adjusted = await hasCostAdjustments(db, workspaceId);
  if (adjusted) await lockWorkspaceBalances(db, workspaceId);
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
  // после закрытия периода средняя держит корректировки: базовый пересчёт выше их не видит, цепочку пересчитываем целиком
  if (adjusted) await recomputeStockCosts(db, workspaceId);
}

/** Пересчёт корректировок себестоимости по всей цепочке движений воркспейса (закрытие периода, этап 6).

    Записанная цена движения (stock_moves.cost) остаётся «базовой» — такой, какой её дало проведение. Корректировка
    stock_cost_adjustments хранит прибавку: ownDelta — косвенные, распределённые закрытием на приход продукции, а итог
    deltaCost = ownDelta + удорожание, пришедшее по цепочке. Проход идёт по всем движениям в порядке seq, как шло проведение:
    - расход списывается по средней пары (склад, товар) с учётом корректировок — разница с базовой и есть корректировка;
    - приход перемещения получает удорожание расхода той же строки (перемещение, в том числе «в пути»);
    - приход продукции выпуска — удорожание списанных на неё материалов и полуфабрикатов (с накладными % спецификации),
      делённое на количество;
    - приход возврата покупателя — удорожание исходной реализации;
    - остальные приходы — только свою часть.
    Так косвенные доходят по цепочке «выпуск → перемещение → выпуск → реализация» до копейки, а отмена закрытия (обнуление
    ownDelta) и повторный пересчёт возвращают всё назад. Воркспейс без корректировок не пересчитывается вовсе.
    Ограничение: удорожание материалов промежуточного этапа до финального этапа (НЗП) не доходит — задача 1137. */
export async function recomputeStockCosts(db: Db, workspaceId: string): Promise<number> {
  if (!(await hasCostAdjustments(db, workspaceId))) return 0;
  // все остатки воркспейса блокируются до чтения движений: параллельное проведение не проскочит между чтением и записью
  await lockWorkspaceBalances(db, workspaceId);
  const moves = await db
    .select({
      id: stockMoves.id,
      warehouseId: stockMoves.warehouseId,
      productId: stockMoves.productId,
      lineId: stockMoves.documentLineId,
      type: documents.type,
      qty: stockMoves.qty,
      cost: stockMoves.cost,
      own: sql<string>`coalesce(${stockCostAdjustments.ownDelta}, 0)::text`,
      delta: sql<string>`coalesce(${stockCostAdjustments.deltaCost}, 0)::text`,
      hasRow: sql<boolean>`${stockCostAdjustments.id} is not null`,
    })
    .from(stockMoves)
    .innerJoin(documents, eq(documents.id, stockMoves.documentId))
    .leftJoin(stockCostAdjustments, and(eq(stockCostAdjustments.workspaceId, stockMoves.workspaceId), eq(stockCostAdjustments.moveId, stockMoves.id)))
    .where(eq(stockMoves.workspaceId, workspaceId))
    .orderBy(asc(stockMoves.seq));
  if (!moves.length) return 0;

  // приход продукции выпуска: строка продукции → количество, накладные % и строки списанных на неё материалов.
  // В materials попадают только реально списанные материалы/полуфабрикаты; отходы (waste), расходы подрядчику (expense)
  // и выходные продукты разборки (output) — не входят в прямые затраты выпуска.
  const comps = await db
    .select({ productLineId: productionItems.documentLineId, qty: productionItems.qty, defectQty: productionItems.defectQty, defectMode: productionItems.defectMode, overheadPct: manufacturedItems.overheadPct, materialLineId: productionComponents.documentLineId, materialQty: documentLines.qty })
    .from(productionComponents)
    .innerJoin(productionItems, eq(productionItems.id, productionComponents.itemId))
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionItems.itemId))
    .innerJoin(documentLines, eq(documentLines.id, productionComponents.documentLineId))
    .where(and(eq(productionComponents.workspaceId, workspaceId), sql`${productionItems.documentLineId} is not null`, inArray(productionComponents.kind, ['material', 'semi'])));
  const releaseLines = new Map<string, { qty: Dec; pct: Dec; materials: { lineId: string; qty: Dec }[] }>();
  for (const c of comps) {
    // удорожание делится на приходованное: брак «в себестоимость» не приходуется, брак «на расходы» получает его вместе с годным
    const r = releaseLines.get(c.productLineId!) ?? { qty: dec(c.qty) - (c.defectMode === 'cost' ? dec(c.defectQty) : 0n), pct: dec(c.overheadPct), materials: [] };
    r.materials.push({ lineId: c.materialLineId!, qty: dec(c.materialQty) });
    releaseLines.set(c.productLineId!, r);
  }
  // приход возврата: строка возврата → строка исходной реализации
  const returns = await db
    .select({ id: documentLines.id, sourceLineId: documentLines.sourceLineId })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(eq(documentLines.workspaceId, workspaceId), eq(documents.type, 'customer_return'), sql`${documentLines.sourceLineId} is not null`));
  const sourceOf = new Map(returns.map(r => [r.id, r.sourceLineId!]));

  // разборка: удорожание идёт в другую сторону — от списанного исходного товара к приходу выходных продуктов.
  // База — распределение, сделанное при проведении (стоимость прихода выхода, `actual_cost`): цены продажи
  // могли поменяться после выпуска, а удорожание должно делиться так же, как делилась исходная стоимость
  const disRows = await db
    .select({
      itemId: productionComponents.itemId,
      kind: productionComponents.kind,
      lineId: productionComponents.documentLineId,
      qty: documentLines.qty,
      actualCost: productionComponents.actualCost,
      pct: manufacturedItems.overheadPct,
    })
    .from(productionComponents)
    .innerJoin(productionItems, eq(productionItems.id, productionComponents.itemId))
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionItems.itemId))
    .innerJoin(documents, eq(documents.id, productionComponents.documentId))
    .innerJoin(documentLines, eq(documentLines.id, productionComponents.documentLineId))
    .where(and(eq(productionComponents.workspaceId, workspaceId), eq(documents.type, 'production'), eq(documents.operation, 'disassembly'), inArray(productionComponents.kind, ['material', 'output'])));
  const disByItem = new Map<string, { sourceLine: string; sourceQty: Dec; pct: Dec; outputs: { lineId: string; qty: Dec; cost: Dec }[] }>();
  for (const r of disRows) {
    const itemId = r.itemId ?? '';
    if (!itemId) continue;
    const cur = disByItem.get(itemId) ?? { sourceLine: '', sourceQty: 0n, pct: dec(r.pct), outputs: [] };
    if (r.kind === 'material') {
      cur.sourceLine = r.lineId ?? '';
      cur.sourceQty = dec(r.qty);
    } else cur.outputs.push({ lineId: r.lineId ?? '', qty: dec(r.qty), cost: dec(r.actualCost ?? '0') });
    disByItem.set(itemId, cur);
  }
  /** Приход выходного продукта разборки: строка документа → исходный товар, база и доля */
  const disOutputs = new Map<string, { sourceLine: string; sourceQty: Dec; pct: Dec; base: Dec; totalBase: Dec; qty: Dec }>();
  for (const cur of disByItem.values()) {
    // без стоимости приходов (всё нулевое) — по количеству
    const byCost = cur.outputs.some(o => o.cost > 0n);
    const bases = cur.outputs.map(o => (byCost ? o.cost : o.qty));
    const totalBase = bases.reduce((s, b) => s + b, 0n);
    cur.outputs.forEach((o, i) => disOutputs.set(o.lineId, { sourceLine: cur.sourceLine, sourceQty: cur.sourceQty, pct: cur.pct, base: bases[i]!, totalBase, qty: o.qty }));
  }

  // распределения материалов смены (задача 1135): стоимость доходит до прихода продукции прибавкой к цене движения.
  // Своя доля позиции — production_items.alloc_cost (материалы с накладными), на финальный этап дополнительно приходит
  // доля промежуточных этапов того же источника (НЗП): на единицу — их alloc_cost / годное количество этапа
  const allocByLine = await loadAllocationChain(db, workspaceId);

  const r4 = (a: Dec) => dec(fmt(a, 4));
  const state = new Map<string, StockState>();
  /** Удорожание единицы последнего расхода по строке документа */
  const outDelta = new Map<string, Dec>();
  let changed = 0;
  for (const m of moves) {
    const k = keyOf(m);
    const s = state.get(k) ?? { qty: 0n, avg: 0n };
    const qty = dec(m.qty);
    const base = dec(m.cost);
    const own = dec(m.own);
    let delta: Dec;
    if (qty < 0n) {
      const o = stockOut(s, -qty);
      state.set(k, o.state);
      delta = r4(o.cost) - base;
      if (m.lineId) outDelta.set(m.lineId, delta);
    } else {
      let chain = 0n;
      const rel = m.type === 'production' && m.lineId ? releaseLines.get(m.lineId) : undefined;
      const dis = m.type === 'production' && m.lineId ? disOutputs.get(m.lineId) : undefined;
      if (dis && dis.totalBase > 0n) {
        // разборка: удорожание списанного исходного товара (с накладными) делится между выходами
        const dTotal = mul(outDelta.get(dis.sourceLine) ?? 0n, dis.sourceQty);
        const withOverhead = dTotal + pctOf(dTotal, dis.pct);
        chain = div(div(mul(withOverhead, dis.base), dis.totalBase), dis.qty);
      } else if (rel && rel.qty > 0n) {
        const materials = rel.materials.reduce((sum, x) => sum + mul(outDelta.get(x.lineId) ?? 0n, x.qty), 0n);
        chain = div(materials + pctOf(materials, rel.pct), rel.qty);
      } else if (m.lineId && outDelta.has(m.lineId)) chain = outDelta.get(m.lineId)!; // приход по цене расхода той же строки: перемещение, в том числе «в пути»
      else if (m.type === 'customer_return' && m.lineId) chain = outDelta.get(sourceOf.get(m.lineId) ?? '') ?? 0n;
      if (m.type === 'production' && m.lineId) chain += allocByLine.get(m.lineId) ?? 0n;
      delta = r4(own + chain);
      state.set(k, stockIn(s, qty, base + delta));
    }
    if (delta === dec(m.delta)) continue;
    changed++;
    if (delta === 0n && own === 0n) await db.delete(stockCostAdjustments).where(and(eq(stockCostAdjustments.workspaceId, workspaceId), eq(stockCostAdjustments.moveId, m.id)));
    else if (m.hasRow) await db.update(stockCostAdjustments).set({ deltaCost: fmt(delta, 4), updatedAt: new Date() }).where(and(eq(stockCostAdjustments.workspaceId, workspaceId), eq(stockCostAdjustments.moveId, m.id)));
    else await db.insert(stockCostAdjustments).values({ workspaceId, moveId: m.id, deltaCost: fmt(delta, 4), updatedAt: new Date() });
  }
  // количество остатка пересчёт не трогает (его ведут проведения), только среднюю с учётом корректировок
  for (const [k, s] of state) {
    const [warehouseId, productId] = k.split(':') as [string, string];
    await db.update(stockBalances).set({ avgCost: fmt(s.avg, 4), updatedAt: new Date() }).where(and(eq(stockBalances.warehouseId, warehouseId), eq(stockBalances.productId, productId), sql`${stockBalances.avgCost} <> ${fmt(s.avg, 4)}`));
  }
  return changed;
}

/** Есть ли у воркспейса корректировки закрытия или распределённые материалы смены
    (тогда отмена проведения и переоценка пересчитывают цепочку целиком) */
export async function hasCostAdjustments(db: Db, workspaceId: string): Promise<boolean> {
  const [row] = await db.select({ id: stockCostAdjustments.id }).from(stockCostAdjustments).where(eq(stockCostAdjustments.workspaceId, workspaceId)).limit(1);
  if (row) return true;
  const [alloc] = await db.select({ id: productionItems.id }).from(productionItems).where(and(eq(productionItems.workspaceId, workspaceId), sql`${productionItems.allocCost} <> 0`)).limit(1);
  return !!alloc;
}

/** Прибавка к цене единицы прихода продукции от распределений материалов смены: строка документа → прибавка */
async function loadAllocationChain(db: Db, workspaceId: string): Promise<Map<string, Dec>> {
  const out = new Map<string, Dec>();
  const items = await db
    .select({
      lineId: productionItems.documentLineId,
      qty: productionItems.qty,
      defectQty: productionItems.defectQty,
      defectMode: productionItems.defectMode,
      alloc: productionItems.allocCost,
      source: productionItems.sourceItemId,
      customer: productionItems.customerOrderLineId,
      stageId: productionHeaders.stageId,
    })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .leftJoin(productionHeaders, and(eq(productionHeaders.workspaceId, productionItems.workspaceId), eq(productionHeaders.documentId, productionItems.documentId)))
    .where(and(eq(productionItems.workspaceId, workspaceId), eq(documents.type, 'production'), eq(documents.status, 'posted')));
  if (!items.some(i => dec(i.alloc) !== 0n)) return out;
  const srcKey = (i: { source: string | null; customer: string | null }) => (i.source ? `s:${i.source}` : i.customer ? `c:${i.customer}` : '');
  // НЗП: промежуточные этапы источника (у позиции нет строки продукции)
  const stages = new Map<string, { cost: Dec; qty: Dec }>();
  for (const i of items) {
    if (i.lineId || !srcKey(i)) continue;
    const k = `${srcKey(i)}|${i.stageId ?? ''}`;
    const cur = stages.get(k) ?? { cost: 0n, qty: 0n };
    cur.cost += dec(i.alloc);
    cur.qty += dec(i.qty) - dec(i.defectQty);
    stages.set(k, cur);
  }
  const wipUnit = new Map<string, Dec>();
  for (const [k, v] of stages) {
    if (v.qty <= 0n) continue;
    const key = k.split('|')[0]!;
    wipUnit.set(key, (wipUnit.get(key) ?? 0n) + div(v.cost, v.qty));
  }
  for (const i of items) {
    if (!i.lineId) continue;
    const total = dec(i.qty);
    const den = i.defectMode === 'cost' ? total - dec(i.defectQty) : total; // как у выпуска: брак «в себестоимость» не приходуется
    if (den <= 0n) continue;
    const amount = dec(i.alloc) + mul(wipUnit.get(srcKey(i)) ?? 0n, total);
    if (amount !== 0n) out.set(i.lineId, div(amount, den));
  }
  return out;
}

/** Блокирует все остатки воркспейса в порядке ключей — том же, что у lockBalances, поэтому взаимных блокировок нет */
async function lockWorkspaceBalances(db: Db, workspaceId: string): Promise<void> {
  await db.select({ id: stockBalances.warehouseId }).from(stockBalances).where(eq(stockBalances.workspaceId, workspaceId)).orderBy(asc(stockBalances.warehouseId), asc(stockBalances.productId)).for('update');
}

/** Переоценка прихода: цена движения меняется, средняя склада и оценка последующих расходов пересчитываются по цепочке.
    Используется, когда фактическая стоимость работ меняет себестоимость уже проведённого выпуска. */
export async function revalueMove(db: Db, workspaceId: string, moveId: string, cost: Dec): Promise<void> {
  const [move] = await db.select().from(stockMoves).where(eq(stockMoves.id, moveId)).limit(1);
  if (!move) return;
  const key = { warehouseId: move.warehouseId, productId: move.productId };
  const adjusted = await hasCostAdjustments(db, workspaceId);
  if (adjusted) await lockWorkspaceBalances(db, workspaceId);
  await lockBalances(db, workspaceId, [key]);
  await db.update(stockMoves).set({ cost: fmt(cost, 4) }).where(eq(stockMoves.id, moveId));
  const moves = await db
    .select({ id: stockMoves.id, qty: stockMoves.qty, cost: stockMoves.cost })
    .from(stockMoves)
    .where(and(eq(stockMoves.warehouseId, key.warehouseId), eq(stockMoves.productId, key.productId)))
    .orderBy(asc(stockMoves.seq));
  const r = replayMoves(moves.map(m => ({ qty: dec(m.qty), cost: dec(m.cost) })));
  for (const [i, m] of moves.entries()) {
    const c = fmt(r.moves[i]!.cost, 4);
    if (dec(m.qty) < 0n && c !== m.cost) await db.update(stockMoves).set({ cost: c }).where(eq(stockMoves.id, m.id));
  }
  await db.update(stockBalances).set({ qty: fmt(r.state.qty, 3), avgCost: fmt(r.state.avg, 4), updatedAt: new Date() }).where(and(eq(stockBalances.warehouseId, key.warehouseId), eq(stockBalances.productId, key.productId)));
  if (adjusted) await recomputeStockCosts(db, workspaceId);
}

/** Себестоимость единицы по каждой строке документа: расходная сторона (у перемещения — цена ушедшего товара) */
export async function documentLineCosts(db: Db, documentId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ lineId: stockMoves.documentLineId, qty: stockMoves.qty, cost: effectiveCost })
    .from(stockMoves)
    .leftJoin(stockCostAdjustments, and(eq(stockCostAdjustments.workspaceId, stockMoves.workspaceId), eq(stockCostAdjustments.moveId, stockMoves.id)))
    .where(eq(stockMoves.documentId, documentId));
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
  const rows = await db
    .select({ lineId: stockMoves.documentLineId, cost: effectiveCost })
    .from(stockMoves)
    .leftJoin(stockCostAdjustments, and(eq(stockCostAdjustments.workspaceId, stockMoves.workspaceId), eq(stockCostAdjustments.moveId, stockMoves.id)))
    .where(inArray(stockMoves.documentLineId, lineIds));
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

/** Свободное количество по складам: остаток минус резерв (все резервы: заказов покупателей, выпущенной продукции и материалов заказов на производство).
    Строки остатков блокируются — два заказа не займут одно и то же количество */
export async function lockFreeStock(db: Db, workspaceId: string, keys: StockKey[]): Promise<Map<string, { qty: Dec; reserved: Dec; free: Dec }>> {
  const uniq = uniqueKeys(keys);
  const out = new Map<string, { qty: Dec; reserved: Dec; free: Dec }>();
  if (!uniq.length) return out;
  const state = await lockBalances(db, workspaceId, uniq);
  const rows = await db
    .select({ warehouseId: stockReservations.warehouseId, productId: stockReservations.productId, qty: sql<string>`sum(${stockReservations.qty})` })
    .from(stockReservations)
    .where(or(...uniq.map(k => and(eq(stockReservations.warehouseId, k.warehouseId), eq(stockReservations.productId, k.productId))))!)
    .groupBy(stockReservations.warehouseId, stockReservations.productId);
  const reserved = new Map(rows.map(r => [`${r.warehouseId}:${r.productId}`, dec(r.qty)]));
  for (const k of uniq) {
    const key = keyOf(k);
    const qty = state.get(key)?.qty ?? 0n;
    const res = reserved.get(key) ?? 0n;
    out.set(key, { qty, reserved: res, free: qty - res });
  }
  return out;
}

/** Резервы заказа покупателя: по каждой строке заказа резерв = заказано − отгружено (проведёнными реализациями).
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
