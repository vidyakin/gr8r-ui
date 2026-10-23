/* Давальческое сырьё: отдельный количественный учёт по ключу (склад, товар, давалец, заказ на переработку).
   Собственный склад, средняя и пересчёт себестоимости закрытия периода эти движения не видят — здесь только количество.
   Остаток блокируется строкой customer_stock_balances (FOR UPDATE, ключи в одном порядке — без взаимных блокировок),
   поэтому две параллельные проводки по одному ключу не могут вместе уйти в минус. */
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { dec, fmt, type Dec } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { companies, customerStockBalances, customerStockMoves, documents, products, warehouses } from './schema';

/** Ключ остатка давальческого сырья: склад, товар, давалец и заказ на переработку (пусто — общий остаток давальца) */
export interface CustomerStockKey {
  warehouseId: string;
  productId: string;
  /** Давалец — контрагент, чьё это сырьё */
  ownerCompanyId: string;
  /** Заказ на переработку; пусто — общий остаток давальца */
  processingOrderId: string | null;
}

const keyOf = (k: CustomerStockKey) => `${k.warehouseId}:${k.productId}:${k.ownerCompanyId}:${k.processingOrderId ?? ''}`;

const uniqueKeys = (keys: CustomerStockKey[]): CustomerStockKey[] => {
  const uniq = new Map<string, CustomerStockKey>();
  for (const k of keys) uniq.set(keyOf(k), { warehouseId: k.warehouseId, productId: k.productId, ownerCompanyId: k.ownerCompanyId, processingOrderId: k.processingOrderId });
  return [...uniq.values()].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
};

/** Создаёт недостающие строки остатков и блокирует все нужные в порядке ключей */
async function lockCustomerBalances(db: Db, workspaceId: string, keys: CustomerStockKey[]): Promise<Map<string, Dec>> {
  const uniq = uniqueKeys(keys);
  const out = new Map<string, Dec>();
  if (!uniq.length) return out;
  await db.insert(customerStockBalances).values(uniq.map(k => ({ workspaceId, ...k }))).onConflictDoNothing();
  const rows = await db
    .select()
    .from(customerStockBalances)
    .where(
      or(
        ...uniq.map(k =>
          and(
            eq(customerStockBalances.warehouseId, k.warehouseId),
            eq(customerStockBalances.productId, k.productId),
            eq(customerStockBalances.ownerCompanyId, k.ownerCompanyId),
            k.processingOrderId ? eq(customerStockBalances.processingOrderId, k.processingOrderId) : sql`${customerStockBalances.processingOrderId} is null`,
          ),
        ),
      ),
    )
    .orderBy(asc(customerStockBalances.warehouseId), asc(customerStockBalances.productId), asc(customerStockBalances.ownerCompanyId), asc(customerStockBalances.processingOrderId))
    .for('update');
  for (const r of rows) out.set(keyOf(r), dec(r.qty));
  return out;
}

/** Количество по ключам (без блокировок) — проверки остатка в отчётах и расчётах */
export async function customerStockQty(db: Db, workspaceId: string, keys: CustomerStockKey[]): Promise<Map<string, Dec>> {
  const uniq = uniqueKeys(keys);
  const out = new Map<string, Dec>();
  if (!uniq.length) return out;
  const rows = await db
    .select()
    .from(customerStockBalances)
    .where(
      and(
        eq(customerStockBalances.workspaceId, workspaceId),
        or(
          ...uniq.map(k =>
            and(
              eq(customerStockBalances.warehouseId, k.warehouseId),
              eq(customerStockBalances.productId, k.productId),
              eq(customerStockBalances.ownerCompanyId, k.ownerCompanyId),
              k.processingOrderId ? eq(customerStockBalances.processingOrderId, k.processingOrderId) : sql`${customerStockBalances.processingOrderId} is null`,
            ),
          ),
        ),
      ),
    );
  for (const r of rows) out.set(keyOf(r), dec(r.qty));
  return out;
}

export interface CustomerMoveRequest extends CustomerStockKey {
  /** Строка документа */
  lineId: string | null;
  /** Положительное количество */
  qty: Dec;
  direction: 'in' | 'out';
}

/** Записывает движения давальческого сырья и обновляет остатки (в транзакции проведения).
    Расходы пишутся раньше приходов — приход остаток не уменьшает, поэтому нехватку видно по результату расходов */
export async function applyCustomerStockMoves(db: Db, workspaceId: string, doc: { id: string; date: string }, reqs: CustomerMoveRequest[]): Promise<void> {
  if (!reqs.length) return;
  const state = await lockCustomerBalances(db, workspaceId, reqs);
  const rows: (typeof customerStockMoves.$inferInsert)[] = [];
  const need = new Map<string, Dec>();
  const apply = (r: CustomerMoveRequest) => {
    const k = keyOf(r);
    const qty = state.get(k) ?? 0n;
    state.set(k, r.direction === 'in' ? qty + r.qty : qty - r.qty);
    if (r.direction === 'out') need.set(k, (need.get(k) ?? 0n) + r.qty);
    rows.push({ workspaceId, documentId: doc.id, documentLineId: r.lineId, warehouseId: r.warehouseId, productId: r.productId, ownerCompanyId: r.ownerCompanyId, processingOrderId: r.processingOrderId, qty: fmt(r.direction === 'in' ? r.qty : -r.qty, 3), movedAt: doc.date });
  };
  for (const r of reqs) if (r.direction === 'out') apply(r);
  const short = [...need.entries()].filter(([k, q]) => q > 0n && (state.get(k) ?? 0n) < 0n);
  if (short.length) {
    const parts = short.map(([k, q]) => ({ key: k, needed: q, warehouseId: k.split(':')[0]!, productId: k.split(':')[1]!, ownerCompanyId: k.split(':')[2]! }));
    const names = await productNames(db, parts.map(p => p.productId));
    const owners = await companyNames(db, parts.map(p => p.ownerCompanyId));
    const items = parts.map(p => ({
      productId: p.productId,
      warehouseId: p.warehouseId,
      ownerCompanyId: p.ownerCompanyId,
      name: names.get(p.productId) ?? p.productId,
      ownerName: owners.get(p.ownerCompanyId) ?? p.ownerCompanyId,
      available: fmt((state.get(p.key) ?? 0n) + p.needed, 3),
      needed: fmt(p.needed, 3),
    }));
    throw new DomainError(422, 'insufficient_customer_stock', `Not enough customer materials: ${items.map(i => `${i.name} (${i.ownerName}: available ${i.available}, needed ${i.needed})`).join('; ')}`, { items });
  }
  for (const r of reqs) if (r.direction === 'in') apply(r);
  await db.insert(customerStockMoves).values(rows);
  for (const r of uniqueKeys(reqs)) {
    await db
      .update(customerStockBalances)
      .set({ qty: fmt(state.get(keyOf(r)) ?? 0n, 3), updatedAt: new Date() })
      .where(
        and(
          eq(customerStockBalances.warehouseId, r.warehouseId),
          eq(customerStockBalances.productId, r.productId),
          eq(customerStockBalances.ownerCompanyId, r.ownerCompanyId),
          r.processingOrderId ? eq(customerStockBalances.processingOrderId, r.processingOrderId) : sql`${customerStockBalances.processingOrderId} is null`,
        ),
      );
  }
}

/** Отмена проведения: движения документа удаляются, остатки пересчитываются по оставшимся движениям.
    Если после отмены остаток ушёл бы в минус (сырьё уже вернули или списали) — отмена запрещена */
export async function revertCustomerStockMoves(db: Db, workspaceId: string, documentId: string): Promise<void> {
  const own = await db.select().from(customerStockMoves).where(eq(customerStockMoves.documentId, documentId));
  if (!own.length) return;
  const keys = own.map(m => ({ warehouseId: m.warehouseId, productId: m.productId, ownerCompanyId: m.ownerCompanyId, processingOrderId: m.processingOrderId }));
  await lockCustomerBalances(db, workspaceId, keys);
  await db.delete(customerStockMoves).where(eq(customerStockMoves.documentId, documentId));
  const bad: CustomerStockKey[] = [];
  for (const k of uniqueKeys(keys)) {
    const qty = await movedQty(db, workspaceId, k);
    if (qty < 0n) bad.push(k);
    await db
      .update(customerStockBalances)
      .set({ qty: fmt(qty, 3), updatedAt: new Date() })
      .where(
        and(
          eq(customerStockBalances.warehouseId, k.warehouseId),
          eq(customerStockBalances.productId, k.productId),
          eq(customerStockBalances.ownerCompanyId, k.ownerCompanyId),
          k.processingOrderId ? eq(customerStockBalances.processingOrderId, k.processingOrderId) : sql`${customerStockBalances.processingOrderId} is null`,
        ),
      );
  }
  if (bad.length) {
    const names = await productNames(db, bad.map(b => b.productId));
    throw new DomainError(422, 'customer_stock_conflict', `Cannot unpost: the customer materials are already written off or returned (${bad.map(b => names.get(b.productId) ?? b.productId).join(', ')}). Unpost those documents first`, { productIds: bad.map(b => b.productId) });
  }
}

/** Остаток по ключу: сумма движений (движения остаются, строки остатка обновляются при проводке) */
async function movedQty(db: Db, workspaceId: string, k: CustomerStockKey): Promise<Dec> {
  const [row] = await db
    .select({ qty: sql<string>`coalesce(sum(${customerStockMoves.qty}), 0)::text` })
    .from(customerStockMoves)
    .where(
      and(
        eq(customerStockMoves.workspaceId, workspaceId),
        eq(customerStockMoves.warehouseId, k.warehouseId),
        eq(customerStockMoves.productId, k.productId),
        eq(customerStockMoves.ownerCompanyId, k.ownerCompanyId),
        k.processingOrderId ? eq(customerStockMoves.processingOrderId, k.processingOrderId) : sql`${customerStockMoves.processingOrderId} is null`,
      ),
    );
  return dec(row?.qty ?? '0');
}

export async function productNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  return new Map((await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, [...new Set(ids)]))).map(p => [p.id, p.name]));
}

export async function companyNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  return new Map((await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, [...new Set(ids)]))).map(c => [c.id, c.name]));
}

export interface CustomerBalanceRow {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  name: string;
  sku: string;
  unitCode: string;
  ownerCompanyId: string;
  ownerName: string;
  processingOrderId: string | null;
  processingOrderNumber: string | null;
  qty: string;
}

/** Остатки давальцев — отчёт «Запасы, принятые в переработку»: по складу, товару, давальцу и заказу */
export async function customerStockRows(
  db: Db,
  filters: { warehouseId?: string | null; productId?: string | null; ownerCompanyId?: string | null; processingOrderId?: string | null; nonZero?: boolean; q?: string | null } = {},
): Promise<CustomerBalanceRow[]> {
  const rows = await db
    .select({
      warehouseId: customerStockBalances.warehouseId,
      warehouseName: warehouses.name,
      productId: customerStockBalances.productId,
      name: products.name,
      sku: products.sku,
      unitCode: products.unitCode,
      ownerCompanyId: customerStockBalances.ownerCompanyId,
      ownerName: companies.name,
      processingOrderId: customerStockBalances.processingOrderId,
      qty: customerStockBalances.qty,
    })
    .from(customerStockBalances)
    .innerJoin(products, eq(products.id, customerStockBalances.productId))
    .innerJoin(warehouses, eq(warehouses.id, customerStockBalances.warehouseId))
    .innerJoin(companies, eq(companies.id, customerStockBalances.ownerCompanyId))
    .where(
      and(
        filters.warehouseId ? eq(customerStockBalances.warehouseId, filters.warehouseId) : undefined,
        filters.productId ? eq(customerStockBalances.productId, filters.productId) : undefined,
        filters.ownerCompanyId ? eq(customerStockBalances.ownerCompanyId, filters.ownerCompanyId) : undefined,
        filters.processingOrderId ? eq(customerStockBalances.processingOrderId, filters.processingOrderId) : undefined,
        filters.nonZero === false ? undefined : sql`${customerStockBalances.qty} <> 0`,
        filters.q ? sql`(${products.name} ilike ${'%' + filters.q + '%'} or ${products.sku} ilike ${'%' + filters.q + '%'} or ${companies.name} ilike ${'%' + filters.q + '%'})` : undefined,
      ),
    )
    .orderBy(asc(companies.name), asc(products.name), asc(warehouses.name));
  const orderIds = rows.map(r => r.processingOrderId).filter((x): x is string => !!x);
  const orders = orderIds.length ? await db.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.id, orderIds)) : [];
  const number = new Map(orders.map(o => [o.id, o.number]));
  return rows.map(r => ({ ...r, processingOrderNumber: r.processingOrderId ? (number.get(r.processingOrderId) ?? null) : null, qty: fmt(dec(r.qty), 3) }));
}

/** Движения давальческого сырья документа: карточка движения (количество со знаком) */
export async function customerStockMovesOf(db: Db, documentId: string) {
  const rows = await db
    .select({
      id: customerStockMoves.id,
      seq: customerStockMoves.seq,
      lineId: customerStockMoves.documentLineId,
      warehouseId: customerStockMoves.warehouseId,
      productId: customerStockMoves.productId,
      ownerCompanyId: customerStockMoves.ownerCompanyId,
      processingOrderId: customerStockMoves.processingOrderId,
      qty: customerStockMoves.qty,
      movedAt: customerStockMoves.movedAt,
    })
    .from(customerStockMoves)
    .where(eq(customerStockMoves.documentId, documentId))
    .orderBy(asc(customerStockMoves.seq));
  return rows;
}