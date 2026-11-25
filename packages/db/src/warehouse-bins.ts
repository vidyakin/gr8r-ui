/* Адресное хранение (docs/architecture/stock.md). Остатки ячеек меняются под блокировкой stock_balances. */
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { dec, fmt, type Dec, type WarehouseBinInput, type WarehouseBinPatch } from '@erp/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { products, stockBinBalances, stockMoves, warehouseBins, warehouses } from './schema';

type BinScope = { workspaceId: string; warehouseId: string };
type BinKey = { warehouseId: string; binId: string; productId: string };

const binsIn = (scope: BinScope) => and(eq(warehouseBins.workspaceId, scope.workspaceId), eq(warehouseBins.warehouseId, scope.warehouseId));
const balancesIn = (scope: BinScope) => and(eq(stockBinBalances.workspaceId, scope.workspaceId), eq(stockBinBalances.warehouseId, scope.warehouseId));
const binKey = (row: BinKey) => `${row.binId}:${row.productId}`;

async function loadWarehouse(db: Db, scope: BinScope, edit = false) {
  const query = db.select({ id: warehouses.id }).from(warehouses).where(and(
    eq(warehouses.workspaceId, scope.workspaceId), eq(warehouses.id, scope.warehouseId), isNull(warehouses.archivedAt),
  ));
  const [row] = edit ? await query.for('no key update') : await query;
  if (!row) throw new DomainError(404, 'not_found', 'Warehouse not found');
}

export async function listWarehouseBins(db: Db, scope: BinScope) {
  await loadWarehouse(db, scope);
  return db.select().from(warehouseBins).where(binsIn(scope)).orderBy(asc(warehouseBins.code));
}

export async function listBinBalances(db: Db, scope: BinScope) {
  await loadWarehouse(db, scope);
  return db.select({
    binId: warehouseBins.id, code: warehouseBins.code, productId: products.id, productName: products.name,
    unitCode: products.unitCode, qty: stockBinBalances.qty,
  }).from(stockBinBalances)
    .innerJoin(warehouseBins, and(eq(warehouseBins.workspaceId, stockBinBalances.workspaceId), eq(warehouseBins.warehouseId, stockBinBalances.warehouseId), eq(warehouseBins.id, stockBinBalances.binId)))
    .innerJoin(products, and(eq(products.workspaceId, stockBinBalances.workspaceId), eq(products.id, stockBinBalances.productId)))
    .where(and(balancesIn(scope), sql`${stockBinBalances.qty} <> 0`))
    .orderBy(asc(warehouseBins.code), asc(products.name), asc(products.id));
}

async function assertEmptyBins(db: Db, scope: BinScope, binId?: string) {
  const [row] = await db.select({ binId: stockBinBalances.binId }).from(stockBinBalances).where(and(
    balancesIn(scope), binId ? eq(stockBinBalances.binId, binId) : undefined, sql`${stockBinBalances.qty} <> 0`,
  )).limit(1);
  if (row) throw new DomainError(422, 'warehouse_bin_not_empty', 'Move the remaining stock out of the bins first');
}

export async function assertBinsCanBeDisabled(db: Db, scope: BinScope) {
  // CRUD склада уже удерживает блокировку его строки.
  await assertEmptyBins(db, scope);
}

async function assertParent(db: Db, scope: BinScope, parentId: string, childId?: string) {
  const rows = await db.select({ id: warehouseBins.id, parentId: warehouseBins.parentId, active: warehouseBins.active })
    .from(warehouseBins).where(binsIn(scope));
  const parents = new Map(rows.map(row => [row.id, row]));
  const seen = new Set(childId ? [childId] : []);
  for (let id: string | null = parentId; id;) {
    const parent = parents.get(id);
    if (!parent?.active || seen.has(id)) throw new DomainError(422, 'invalid_warehouse_bin', 'Select an active parent bin without a hierarchy cycle');
    seen.add(id);
    id = parent.parentId;
  }
}

export async function createWarehouseBin(db: Db, scope: BinScope, input: WarehouseBinInput, actorId: string) {
  await loadWarehouse(db, scope, true);
  if (input.parentId) await assertParent(db, scope, input.parentId);
  const [row] = await db.insert(warehouseBins).values({ ...scope, ...input }).returning();
  await recordEvent(db, { workspaceId: scope.workspaceId, type: 'warehouse_bin.created', entity: 'warehouse_bin', recordId: row!.id, actorId, payload: { warehouseId: scope.warehouseId } });
  return row!;
}

/** Строка остаётся доступна истории после удаления из набора активных ячеек. */
export async function updateWarehouseBin(db: Db, scope: BinScope, id: string, patch: WarehouseBinPatch, actorId: string, archive = false) {
  await loadWarehouse(db, scope, true);
  const where = and(binsIn(scope), eq(warehouseBins.id, id));
  const [current] = await db.select().from(warehouseBins).where(where);
  if (!current) throw new DomainError(404, 'not_found', 'Warehouse bin not found');
  if (!Object.keys(patch).length || (archive && !current.active)) return current;
  const parent = patch.parentId === undefined ? current.parentId : patch.parentId;
  if (parent && (parent !== current.parentId || (patch.active === true && !current.active))) await assertParent(db, scope, parent, id);
  if (patch.active === false && current.active) {
    await assertEmptyBins(db, scope, id);
    const [child] = await db.select({ id: warehouseBins.id }).from(warehouseBins).where(and(
      binsIn(scope), eq(warehouseBins.parentId, id), eq(warehouseBins.active, true),
    )).limit(1);
    if (child) throw new DomainError(422, 'warehouse_bin_has_children', 'Move or deactivate the child bins first');
  }
  const [row] = await db.update(warehouseBins).set(patch).where(where).returning();
  await recordEvent(db, { workspaceId: scope.workspaceId, type: archive ? 'warehouse_bin.deleted' : 'warehouse_bin.updated', entity: 'warehouse_bin', recordId: id, actorId, payload: { warehouseId: scope.warehouseId } });
  return row!;
}

/** На выключенном складе адреса игнорируются. На включённом проверяем склад и доступность адреса. */
export async function resolveWarehouseBins(
  db: Db, workspaceId: string, requests: { warehouseId: string; binId?: string | null }[], lock = false,
) {
  const addressed = requests.flatMap(r => r.binId ? [{ warehouseId: r.warehouseId, binId: r.binId }] : []);
  const binIds = new Set<string>();
  if (!requests.length) return { warehouseIds: new Set<string>(), binIds };
  const query = db.select({ id: warehouses.id, useBins: warehouses.useBins }).from(warehouses)
    .where(and(eq(warehouses.workspaceId, workspaceId), inArray(warehouses.id, [...new Set(requests.map(r => r.warehouseId))])))
    .orderBy(asc(warehouses.id));
  const warehouseIds = new Set((lock ? await query.for('share') : await query).filter(w => w.useBins).map(w => w.id));
  const checked = addressed.filter(r => warehouseIds.has(r.warehouseId));
  if (!checked.length) return { warehouseIds, binIds };
  const bins = new Set((await db.select({ id: warehouseBins.id, warehouseId: warehouseBins.warehouseId }).from(warehouseBins)
    .where(and(eq(warehouseBins.workspaceId, workspaceId), eq(warehouseBins.active, true), inArray(warehouseBins.id, [...new Set(checked.map(r => r.binId))]))))
    .map(b => `${b.warehouseId}:${b.id}`));
  for (const r of checked) {
    const key = `${r.warehouseId}:${r.binId}`;
    if (!bins.has(key)) throw new DomainError(422, 'invalid_warehouse_bin', 'Select an active bin from the selected warehouse', r);
    binIds.add(key);
  }
  return { warehouseIds, binIds };
}

export async function assertSameWarehouseTransfer(
  db: Db, workspaceId: string, operation: string | null, warehouseId: string | null, targetId: string | null,
) {
  if (!targetId) throw new DomainError(422, 'target_warehouse_required', 'Select a destination warehouse');
  if (targetId !== warehouseId) return;
  const [warehouse] = await db.select({ useBins: warehouses.useBins }).from(warehouses)
    .where(and(eq(warehouses.workspaceId, workspaceId), eq(warehouses.id, targetId)));
  if (operation !== 'transfer' || !warehouse?.useBins) throw new DomainError(422, 'target_warehouse_required', 'Select another warehouse');
}

/** Расходы идут перед приходами, как для общих остатков. */
export async function applyBinBalances(db: Db, workspaceId: string, moves: (BinKey & { qty: string })[], allowNegative: boolean) {
  const deltas = new Map<string, { key: BinKey; total: Dec; out: Dec }>();
  for (const move of moves) {
    const key = binKey(move);
    const delta = deltas.get(key) ?? { key: { warehouseId: move.warehouseId, binId: move.binId, productId: move.productId }, total: 0n, out: 0n };
    const qty = dec(move.qty);
    delta.total += qty;
    if (qty < 0n) delta.out += qty;
    deltas.set(key, delta);
  }
  if (!deltas.size) return;
  const balances = await db.select().from(stockBinBalances).where(and(
    eq(stockBinBalances.workspaceId, workspaceId),
    or(...[...deltas.values()].map(({ key }) => and(eq(stockBinBalances.binId, key.binId), eq(stockBinBalances.productId, key.productId)))),
  ));
  const have = new Map(balances.map(row => [binKey(row), dec(row.qty)]));
  const rows = [...deltas].map(([id, delta]) => {
    const available = have.get(id) ?? 0n;
    if (!allowNegative && delta.out < 0n && available + delta.out < 0n) {
      throw new DomainError(422, 'insufficient_bin_stock', 'Not enough stock in the selected bin', { ...delta.key, available: fmt(available, 3), needed: fmt(-delta.out, 3) });
    }
    return { workspaceId, ...delta.key, qty: fmt(available + delta.total, 3) };
  });
  await saveBinBalances(db, rows);
}

async function saveBinBalances(db: Db, rows: (typeof stockBinBalances.$inferInsert)[]) {
  if (!rows.length) return;
  await db.insert(stockBinBalances).values(rows).onConflictDoUpdate({
    target: [stockBinBalances.workspaceId, stockBinBalances.warehouseId, stockBinBalances.binId, stockBinBalances.productId],
    set: { qty: sql`excluded.qty` },
  });
}

/** Отмена проверяет весь оставшийся ряд движений ячейки, в том числе уже проведённые расходы. */
export async function replayBinBalances(db: Db, workspaceId: string, moves: BinKey[], allowNegative: boolean) {
  const keys = [...new Map(moves.map(move => [binKey(move), move])).values()];
  const rows: (typeof stockBinBalances.$inferInsert)[] = [];
  for (const { warehouseId, binId, productId } of keys) {
    const history = db.select({
      qty: stockMoves.qty,
      running: sql<string>`sum(${stockMoves.qty}) over (order by ${stockMoves.seq})`.as('running'),
      batchRunning: sql<string | null>`case when ${stockMoves.batchId} is not null then sum(${stockMoves.qty}) over (partition by ${stockMoves.batchId} order by ${stockMoves.seq}) end`.as('batch_running'),
    }).from(stockMoves).where(and(
      eq(stockMoves.workspaceId, workspaceId), eq(stockMoves.warehouseId, warehouseId), eq(stockMoves.binId, binId), eq(stockMoves.productId, productId),
    )).as('bin_history');
    const [balance] = await db.select({
      qty: sql<string>`coalesce(sum(${history.qty}), 0)::text`,
      min: sql<string>`least(coalesce(min(${history.running}), 0), coalesce(min(${history.batchRunning}), 0))::text`,
    }).from(history);
    if (!allowNegative && dec(balance!.min) < 0n) {
      throw new DomainError(422, 'stock_conflict', 'Cannot unpost: later movements need the stock in this bin', { warehouseId, binId, productId });
    }
    rows.push({ workspaceId, warehouseId, binId, productId, qty: balance!.qty });
  }
  await saveBinBalances(db, rows);
}

/** Пустой адрес расходует только складской остаток, ещё не распределённый по ячейкам. */
export async function assertUnassignedStock(
  db: Db, workspaceId: string, withdrawals: { warehouseId: string; productId: string; onHand: Dec; needed: Dec }[],
) {
  const keyOf = (r: { warehouseId: string; productId: string }) => `${r.warehouseId}:${r.productId}`;
  const requests = new Map<string, typeof withdrawals[number]>();
  for (const row of withdrawals) {
    const key = keyOf(row);
    requests.set(key, { ...row, needed: row.needed + (requests.get(key)?.needed ?? 0n) });
  }
  if (!requests.size) return;
  const rows = await db.select({
    warehouseId: stockBinBalances.warehouseId, productId: stockBinBalances.productId, qty: sql<string>`sum(${stockBinBalances.qty})`,
  }).from(stockBinBalances).where(and(
    eq(stockBinBalances.workspaceId, workspaceId),
    or(...[...requests.values()].map(r => and(eq(stockBinBalances.warehouseId, r.warehouseId), eq(stockBinBalances.productId, r.productId)))),
  )).groupBy(stockBinBalances.warehouseId, stockBinBalances.productId);
  const addressed = new Map(rows.map(row => [keyOf(row), dec(row.qty)]));
  for (const [key, { warehouseId, productId, onHand, needed }] of requests) {
    const available = onHand - (addressed.get(key) ?? 0n);
    if (available < needed && onHand >= needed) {
      throw new DomainError(422, 'insufficient_bin_stock', 'Not enough unassigned stock: select a bin to pick from', { warehouseId, productId, binId: null, available: fmt(available, 3), needed: fmt(needed, 3) });
    }
  }
}
