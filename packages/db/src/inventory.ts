/* Инвентаризация: остатки не двигают, документ фиксирует результат сверки. Учётное количество строки — по остаткам склада,
   фактическое — то, что насчитали; разница (недостача или излишек) оформляется списанием и оприходованием на основании. */
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { dec, fmt } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { createDocument, type DocCtx } from './documents';
import { documentLines, documents, costItems, products, stockBalances } from './schema';
import { uuidv7 } from './uuid';

export interface CountSheetRow {
  productId: string;
  name: string;
  sku: string;
  unitCode: string;
  /** Учётное количество по остаткам склада */
  qty: string;
}

/** Опись склада: текущие остатки товаров (учётное количество для инвентаризации) */
export async function countSheet(db: Db, _workspaceId: string, warehouseId: string): Promise<CountSheetRow[]> {
  const rows = await db
    .select({ productId: products.id, name: products.name, sku: products.sku, unitCode: products.unitCode, qty: stockBalances.qty })
    .from(stockBalances)
    .innerJoin(products, eq(products.id, stockBalances.productId))
    .where(and(eq(stockBalances.warehouseId, warehouseId), sql`${stockBalances.qty} <> 0`))
    .orderBy(asc(products.name));
  return rows.map(r => ({ productId: r.productId, name: r.name, sku: r.sku, unitCode: r.unitCode, qty: r.qty }));
}

/** Заполнить строки инвентаризации по остаткам склада: учётное количество — по остатку, фактическое — как насчитали (или как по остатку).
    Строки, которых нет на складе, остаются: в них может быть излишек */
export async function fillCountSheet(db: Db, ctx: DocCtx, docId: string): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, docId)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  if (doc.type !== 'inventory_count') throw new DomainError(422, 'invalid_document', 'Only an inventory count can be filled by stock');
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only a draft can be filled');
  if (!doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse before filling');
  const sheet = await countSheet(db, ctx.workspaceId, doc.warehouseId);
  const existing = await db.select().from(documentLines).where(eq(documentLines.documentId, docId)).orderBy(asc(documentLines.sortOrder));
  const byProduct = new Map(existing.map(l => [l.productId, l]));
  const keep = new Set<string>();
  let sort = 0;
  for (const row of sheet) {
    const prev = byProduct.get(row.productId);
    const bookQty = fmt(dec(row.qty), 3);
    const factQty = prev ? prev.qty : bookQty;
    const values = { name: row.name, unitCode: row.unitCode, qty: factQty, price: '0.00', discountPct: '0', vatRate: 'none', net: '0.00', vatAmount: '0.00', total: '0.00', bookQty, receivedQty: '0.000', sortOrder: sort++ };
    if (prev) await db.update(documentLines).set(values).where(eq(documentLines.id, prev.id));
    else await db.insert(documentLines).values({ ...values, id: uuidv7(), workspaceId: ctx.workspaceId, documentId: docId, productId: row.productId });
    keep.add(row.productId);
  }
  // строки, которых нет на складе, сохраняем: в них может быть излишек
  for (const l of existing) {
    if (!keep.has(l.productId)) await db.update(documentLines).set({ sortOrder: sort++ }).where(eq(documentLines.id, l.id));
  }
}

/** Сколько уже оформлено по строке инвентаризации (списанием или оприходованием) */
async function usedByLine(db: Db, lineId: string, exceptDocId?: string): Promise<bigint> {
  const [row] = await db
    .select({ qty: sql<string>`coalesce(sum(${documentLines.qty}), 0)::text` })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(eq(documentLines.originLineId, lineId), inArray(documents.type, ['write_off', 'stock_posting']), ne(documents.status, 'cancelled'), exceptDocId ? ne(documents.id, exceptDocId) : undefined));
  return dec(row?.qty ?? '0');
}

/** Системная статья затрат или доходов по ключу (Недостача, Излишки) */
async function systemCostItem(db: Db, workspaceId: string, systemKey: string): Promise<string> {
  const [c] = await db.select({ id: costItems.id }).from(costItems).where(and(eq(costItems.workspaceId, workspaceId), eq(costItems.systemKey, systemKey))).limit(1);
  if (!c) throw new DomainError(422, 'cost_item_missing', `The workspace has no cost item "${systemKey}"`);
  return c.id;
}

/** Документ на основании инвентаризации: списание недостачи или оприходование излишков — строго по разнице.
    Количество ограничено разницей: столько уже оформлено, столько ещё можно */
export async function createInventoryBasedOn(db: Db, ctx: DocCtx, inventoryId: string, target: 'write_off' | 'stock_posting'): Promise<string> {
  const [inv] = await db.select().from(documents).where(eq(documents.id, inventoryId)).limit(1);
  if (!inv) throw new DomainError(404, 'not_found', 'document not found');
  if (inv.type !== 'inventory_count') throw new DomainError(422, 'invalid_based_on', 'Only an inventory count can be the basis');
  if (inv.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the inventory count first');
  if (!inv.warehouseId) throw new DomainError(422, 'warehouse_required', 'The inventory count has no warehouse');
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, inventoryId)).orderBy(asc(documentLines.sortOrder));
  const shortage = target === 'write_off';
  const items: { productId: string; name: string; unitCode: string; qty: string; source: string }[] = [];
  for (const l of lines) {
    const diff = dec(l.qty) - dec(l.bookQty);
    if (shortage ? diff >= 0n : diff <= 0n) continue;
    const rest = (shortage ? -diff : diff) - (await usedByLine(db, l.id));
    if (rest <= 0n) continue;
    items.push({ productId: l.productId, name: l.name, unitCode: l.unitCode, qty: fmt(rest, 3), source: l.id });
  }
  if (!items.length) throw new DomainError(422, 'nothing_to_create', shortage ? 'There is no shortage left to write off' : 'There is no surplus left to post');
  const costItemId = await systemCostItem(db, ctx.workspaceId, shortage ? 'nedostacha' : 'izlishki');
  const id = await createDocument(db, ctx, {
    type: target,
    organizationId: inv.organizationId,
    warehouseId: inv.warehouseId,
    costItemId,
    date: inv.date,
    comment: `По инвентаризации ${inv.number ?? ''}`.trim(),
    lines: items.map(i => ({ productId: i.productId, name: i.name, unitCode: i.unitCode, qty: i.qty, price: '0', discountPct: '0' })),
  });
  await db.update(documents).set({ basedOnId: inventoryId }).where(eq(documents.id, id));
  const created = await db.select().from(documentLines).where(eq(documentLines.documentId, id)).orderBy(asc(documentLines.sortOrder));
  for (const [i, l] of created.entries()) {
    const src = items[i]!.source;
    await db.update(documentLines).set({ sourceLineId: src, originLineId: src }).where(eq(documentLines.id, l.id));
  }
  return id;
}
