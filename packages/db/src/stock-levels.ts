/* Нормы запаса товара (мин./макс.) — строка по складу или строка без склада (норма по компании).
   Норма читает расчёт потребностей (packages/db/src/replenishment.ts) и карточка товара во вкладке «Stock levels». */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { dec } from '@gr8r/shared';
import type { Db } from './client';
import { recordEvent } from './events';
import { DomainError } from './errors';
import { companies, documentLines, documents, products, stockLevels, warehouses } from './schema';

export interface StockLevelRow {
  id: string;
  productId: string;
  warehouseId: string | null;
  warehouseName: string | null;
  minQty: string;
  maxQty: string;
  replenishment: 'purchase' | 'production' | 'transfer';
  sourceWarehouseId: string | null;
  sourceWarehouseName: string | null;
}

export interface StockLevelInput {
  warehouseId?: string | null;
  minQty: string;
  maxQty: string;
  replenishment: 'purchase' | 'production' | 'transfer';
  sourceWarehouseId?: string | null;
}

/** Нормы запаса товара: строка без склада (норма по компании) идёт первой */
export async function listStockLevels(db: Db, productId: string): Promise<StockLevelRow[]> {
  const rows = await db.select().from(stockLevels).where(eq(stockLevels.productId, productId)).orderBy(sql`${stockLevels.warehouseId} is not null`, asc(stockLevels.warehouseId));
  const whs = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses);
  const byWh = new Map(whs.map(w => [w.id, w.name]));
  return rows.map(r => ({
    id: r.id,
    productId: r.productId,
    warehouseId: r.warehouseId,
    warehouseName: r.warehouseId ? (byWh.get(r.warehouseId) ?? null) : null,
    minQty: r.minQty,
    maxQty: r.maxQty,
    replenishment: r.replenishment,
    sourceWarehouseId: r.sourceWarehouseId,
    sourceWarehouseName: r.sourceWarehouseId ? (byWh.get(r.sourceWarehouseId) ?? null) : null,
  }));
}

/** Норма по компании (склад не задан) */
export async function companyLevel(db: Db, productId: string): Promise<StockLevelRow | null> {
  const [row] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), isNull(stockLevels.warehouseId))).limit(1);
  return row ? { ...row, warehouseName: null, sourceWarehouseName: null } : null;
}

async function assertWarehouses(db: Db, ids: (string | null | undefined)[]): Promise<void> {
  const list = ids.filter((x): x is string => !!x);
  if (!list.length) return;
  const found = await db.select({ id: warehouses.id }).from(warehouses).where(sql`${warehouses.id} in ${list}`);
  if (found.length !== new Set(list).size) throw new DomainError(422, 'invalid_reference', 'The warehouse does not exist');
}

function checkRow(row: StockLevelInput): void {
  const min = dec(row.minQty);
  const max = dec(row.maxQty);
  if (min < 0n || max < min) throw new DomainError(422, 'invalid_level', 'The minimum stock must not be greater than the maximum one');
  if (row.replenishment === 'transfer') {
    if (!row.sourceWarehouseId) throw new DomainError(422, 'source_warehouse_required', 'Choose the source warehouse for replenishment by transfer');
    if (row.sourceWarehouseId === (row.warehouseId ?? null)) throw new DomainError(422, 'same_warehouse', 'The source warehouse must differ from the target one');
  }
}

/** Нормы запаса товара заменяются целиком: строка без склада — норма по компании */
export async function setStockLevels(
  db: Db,
  ctx: { workspaceId: string; memberId: string | null },
  productId: string,
  rows: StockLevelInput[],
): Promise<StockLevelRow[]> {
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
  if (!p) throw new DomainError(422, 'invalid_reference', 'The product does not exist');
  await assertWarehouses(
    db,
    rows.flatMap(r => [r.warehouseId ?? null, r.replenishment === 'transfer' ? r.sourceWarehouseId : null]),
  );
  const seen = new Set<string>();
  for (const r of rows) {
    checkRow(r);
    const key = r.warehouseId ?? 'company';
    if (seen.has(key)) throw new DomainError(422, 'duplicate_level', 'There are two stock levels for the same warehouse');
    seen.add(key);
  }
  await db.delete(stockLevels).where(eq(stockLevels.productId, productId));
  if (rows.length) {
    await db.insert(stockLevels).values(
      rows.map(r => ({
        workspaceId: ctx.workspaceId,
        productId,
        warehouseId: r.warehouseId ?? null,
        minQty: r.minQty,
        maxQty: r.maxQty,
        replenishment: r.replenishment,
        sourceWarehouseId: r.replenishment === 'transfer' ? (r.sourceWarehouseId ?? null) : null,
      })),
    );
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'stock_level.updated', entity: 'stock_level', recordId: productId, actorId: ctx.memberId, payload: { productId } });
  return listStockLevels(db, productId);
}

/** Последняя цена поставщика по товару (поступление на этого контрагента) и дата последнего поступления */
export async function lastSupplierPrice(db: Db, productId: string, supplierId: string): Promise<{ price: string | null; date: string | null }> {
  const [row] = await db
    .select({ price: documentLines.price, date: documents.date })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(
      and(
        eq(documentLines.productId, productId),
        eq(documents.counterpartyId, supplierId),
        eq(documents.type, 'receipt'),
        eq(documents.status, 'posted'),
      ),
    )
    .orderBy(sql`${documents.date} desc, ${documentLines.id} desc`)
    .limit(1);
  return { price: row?.price ?? null, date: row?.date ?? null };
}

/** Поставщики, у которых товар уже покупали: цена и дата последнего поступления */
export async function supplierHistory(db: Db, productId: string): Promise<{ supplierId: string; name: string; price: string | null; date: string | null }[]> {
  const rows = await db
    .select({ supplierId: documents.counterpartyId, date: sql<string>`max(${documents.date})` })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(eq(documentLines.productId, productId), eq(documents.type, 'receipt'), eq(documents.status, 'posted')))
    .groupBy(documents.counterpartyId);
  const names = await db.select({ id: companies.id, name: companies.name }).from(companies);
  const byCp = new Map(names.map(c => [c.id, c.name]));
  const out: { supplierId: string; name: string; price: string | null; date: string | null }[] = [];
  for (const r of rows) {
    if (!r.supplierId) continue;
    const last = await lastSupplierPrice(db, productId, r.supplierId);
    out.push({ supplierId: r.supplierId, name: byCp.get(r.supplierId) ?? r.supplierId, price: last.price, date: last.date });
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}