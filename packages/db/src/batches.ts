/* Партии и сроки годности (задача 1187, docs/architecture/stock.md «Партионный учёт»).
   Товар с флагом products.track_batches: приход создаёт партию (номер, дата выработки, годен до),
   расход списывается FEFO — по партиям с самой ранней датой истечения (без срока — последними).
   Вызывается из applyStockMoves: приходы помечаются batchId, расходы разбиваются по партиям.
   Себестоимость средняя по складу не меняется — партия задаёт только порядок списания и прослеживаемость. */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { addDays, dec, fmt, type Dec } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { documentLines, products, stockBatches } from './schema';
import type { MoveRequest } from './stock';

/** Товары с партионным учётом среди переданных */
export async function batchTrackedProducts(db: Db, productIds: string[]): Promise<Map<string, { name: string; shelfLifeDays: number | null }>> {
  const ids = [...new Set(productIds)];
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: products.id, name: products.name, shelfLifeDays: products.shelfLifeDays })
    .from(products)
    .where(and(inArray(products.id, ids), eq(products.trackBatches, true)));
  return new Map(rows.map(r => [r.id, { name: r.name, shelfLifeDays: r.shelfLifeDays }]));
}

export interface BatchLineInput {
  /** Номер партии (строка прихода); пусто — номер не задан */
  number?: string | null;
  /** Дата выработки; пусто — дата документа */
  producedAt?: string | null;
  /** Годен до; пусто — берётся из срока годности товара, а без него партия без срока */
  expiresAt?: string | null;
}

/** Разбивает расходы по партиям FEFO и собирает приходы. Возвращает обновлённые reqs:
    у расходов — порции с batchId (по движению на партию), у приходов — batchId партии.
    Сами движения пишет applyStockMoves: здесь только распределение, количества не меняются */
export async function assignBatches(db: Db, workspaceId: string, doc: { id: string; date: string }, reqs: MoveRequest[], lineBatches: Map<string, BatchLineInput>): Promise<MoveRequest[]> {
  const tracked = await batchTrackedProducts(db, reqs.map(r => r.productId));
  if (!tracked.size) return reqs;
  const out: MoveRequest[] = [];
  // 1. расходы: FEFO — партии с ранней датой истечения первыми (null — в конец), внутри даты — по времени создания
  const outBatchOfLine = new Map<string, string>();
  const keys = [...new Set(reqs.filter(r => r.direction === 'out' && tracked.has(r.productId)).map(r => `${r.warehouseId}:${r.productId}`))];
  const fefo = new Map<string, { id: string; qty: Dec }[]>();
  if (keys.length) {
    const rows = await db
      .select({
        id: stockBatches.id,
        warehouseId: stockBatches.warehouseId,
        productId: stockBatches.productId,
        qty: sql<string>`(select coalesce(sum(m.qty), 0) from stock_moves m where m.batch_id = stock_batches.id)`,
      })
      .from(stockBatches)
      .where(
        and(
          eq(stockBatches.workspaceId, workspaceId),
          inArray(stockBatches.productId, [...tracked.keys()]),
          inArray(stockBatches.warehouseId, [...new Set(keys.map(k => k.split(':')[0]!))]),
        ),
      )
      .orderBy(asc(stockBatches.warehouseId), asc(stockBatches.productId), sql`${stockBatches.expiresAt} asc nulls last`, asc(stockBatches.createdAt));
    for (const row of rows) {
      const qty = dec(row.qty);
      if (qty <= 0n) continue;
      const k = `${row.warehouseId}:${row.productId}`;
      fefo.set(k, [...(fefo.get(k) ?? []), { id: row.id, qty }]);
    }
  }
  for (const r of reqs) {
    if (r.direction !== 'out') continue;
    if (!tracked.has(r.productId)) {
      out.push(r);
      continue;
    }
    let left = r.qty;
    for (const b of fefo.get(`${r.warehouseId}:${r.productId}`) ?? []) {
      if (left <= 0n) break;
      if (b.qty <= 0n) continue;
      const take = b.qty < left ? b.qty : left;
      b.qty -= take;
      left -= take;
      if (r.lineId) outBatchOfLine.set(r.lineId, b.id);
      out.push({ ...r, qty: take, batchId: b.id });
    }
    if (left > 0n) out.push({ ...r, qty: left }); // нет партий (например, товар включили задним числом) — списываем без партии
  }
  // 2. приходы: партия строки — своя (номер из строки); для перемещения «в пути» — та же, что списана со склада отправителя
  const batchOfLine = new Map<string, string>();
  for (const r of reqs) {
    if (r.direction !== 'in') continue;
    if (!tracked.has(r.productId) || !r.lineId) {
      out.push(r);
      continue;
    }
    const product = tracked.get(r.productId)!;
    const input = lineBatches.get(r.lineId) ?? {};
    const number = (input.number ?? '').trim();
    if (!number) {
      // перемещение «в пути»: партия та же, что ушла со склада отправителя (её создал приход отправителя)
      const inherited = outBatchOfLine.get(r.lineId);
      if (inherited) {
        batchOfLine.set(r.lineId, inherited);
        out.push({ ...r, batchId: inherited });
        continue;
      }
      throw new DomainError(422, 'batch_number_required', `"${product.name}": enter a batch number for the receipt line`, { productId: r.productId, lineId: r.lineId });
    }
    const expiresAt = input.expiresAt ?? (product.shelfLifeDays ? addDays(doc.date, product.shelfLifeDays) : null);
    const producedAt = input.producedAt ?? doc.date;
    const [existing] = await db
      .select({ id: stockBatches.id })
      .from(stockBatches)
      .where(and(eq(stockBatches.workspaceId, workspaceId), eq(stockBatches.warehouseId, r.warehouseId), eq(stockBatches.productId, r.productId), eq(stockBatches.number, number)))
      .limit(1);
    let batchId = existing?.id;
    if (!batchId) {
      const [created] = await db
        .insert(stockBatches)
        .values({ workspaceId, warehouseId: r.warehouseId, productId: r.productId, number, producedAt, expiresAt, documentLineId: r.lineId })
        .onConflictDoUpdate({ target: [stockBatches.workspaceId, stockBatches.warehouseId, stockBatches.productId, stockBatches.number], set: { updatedAt: new Date() } })
        .returning({ id: stockBatches.id });
      batchId = created!.id;
    }
    batchOfLine.set(r.lineId, batchId);
    out.push({ ...r, batchId });
  }
  // порядок движений: расходы раньше приходов (как в applyStockMoves)
  return [...out.filter(r => r.direction === 'out'), ...out.filter(r => r.direction !== 'out')];
}

/** Партии строк документа для формы и печати: строка → партия (номер, даты) */
export async function lineBatchesView(db: Db, documentId: string) {
  const rows = await db
    .select({ lineId: stockBatches.documentLineId, batchId: stockBatches.id, number: stockBatches.number, producedAt: stockBatches.producedAt, expiresAt: stockBatches.expiresAt })
    .from(stockBatches)
    .where(eq(stockBatches.documentLineId, sql`any(select id from ${documentLines} where document_id = ${documentId})`));
  return rows.filter(r => r.lineId);
}

/** Отмена проведения: партии документа без остатка удаляются (приходы этого документа), партия с остатком остаётся.
    Ссылки на партию у расходов чужих документов не трогаем — их списание уже прошло */
export async function revertBatches(db: Db, workspaceId: string, documentId: string): Promise<void> {
  const rows = await db
    .select({ id: stockBatches.id, qty: sql<string>`(select coalesce(sum(m.qty), 0) from stock_moves m where m.batch_id = stock_batches.id)` })
    .from(stockBatches)
    .where(and(eq(stockBatches.workspaceId, workspaceId), eq(stockBatches.documentLineId, sql`any(select id from ${documentLines} where document_id = ${documentId})`)));
  const empty = rows.filter(r => dec(r.qty) <= 0n).map(r => r.id);
  if (empty.length) await db.delete(stockBatches).where(inArray(stockBatches.id, empty));
}

/** Остатки партий (по движениям) для отчёта: склад, товар, партия, количество, даты */
export async function batchBalances(db: Db, workspaceId: string, opts: { warehouseId?: string; productId?: string; days?: number; expired?: boolean; q?: string } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      batchId: stockBatches.id,
      warehouseId: stockBatches.warehouseId,
      productId: stockBatches.productId,
      number: stockBatches.number,
      producedAt: stockBatches.producedAt,
      expiresAt: stockBatches.expiresAt,
      qty: sql<string>`(select coalesce(sum(m.qty), 0) from stock_moves m where m.batch_id = stock_batches.id)`,
    })
    .from(stockBatches)
    .where(
      and(
        eq(stockBatches.workspaceId, workspaceId),
        opts.warehouseId ? eq(stockBatches.warehouseId, opts.warehouseId) : undefined,
        opts.productId ? eq(stockBatches.productId, opts.productId) : undefined,
        opts.expired ? sql`${stockBatches.expiresAt} < ${today}` : undefined,
        opts.days !== undefined ? sql`${stockBatches.expiresAt} is not null and ${stockBatches.expiresAt} <= (current_date + ${opts.days} * interval '1 day')` : undefined,
      ),
    )
    .orderBy(asc(stockBatches.warehouseId), asc(stockBatches.productId), sql`${stockBatches.expiresAt} asc nulls last`);
  return rows.map(r => ({ ...r, qty: fmt(dec(r.qty), 3) }));
}
