/* Партии и сроки годности (задача 1187, docs/architecture/stock.md «Партионный учёт»).
   Товар с флагом products.track_batches: приход создаёт партию (номер, дата выработки, годен до),
   расход списывается FEFO — по партиям с самой ранней датой истечения (без срока — последними).
   Вызывается из applyStockMoves: приходы помечаются batchId, расходы разбиваются по партиям.
   Себестоимость средняя по складу не меняется — партия задаёт только порядок списания и прослеживаемость. */
import { and, asc, eq, gt, ilike, inArray, sql } from 'drizzle-orm';
import { addDays, dec, fmt, type Dec } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { documentLines, products, stockBatches, stockMoves, warehouses } from './schema';
import { quarantineWarehouses } from './quarantine';
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

type BatchStatus = (typeof stockBatches.$inferSelect)['status'];
type BatchDates = Pick<typeof stockBatches.$inferSelect, 'number' | 'producedAt' | 'expiresAt'>;
type AvailableBatch = BatchDates & { id: string; qty: Dec; status: BatchStatus };

/** Создаёт партию именно на складе движения. Вызывается под блокировкой остатка склада/товара. */
async function receiptBatch(db: Db, workspaceId: string, r: MoveRequest, dates: BatchDates, status: BatchStatus): Promise<string> {
  // статус задаётся только при создании партии; у существующей партии (тот же номер) он не меняется
  const [batch] = await db.insert(stockBatches)
    .values({ workspaceId, warehouseId: r.warehouseId, productId: r.productId, documentLineId: r.lineId, status, ...dates })
    .onConflictDoUpdate({ target: [stockBatches.workspaceId, stockBatches.warehouseId, stockBatches.productId, stockBatches.number], set: { updatedAt: new Date() } })
    .returning({ id: stockBatches.id });
  return batch!.id;
}

/** Отказ: товар лежит в партиях, не допущенных входным контролем */
function blocked(batches: { number: string; status: BatchStatus }[], r: MoveRequest): DomainError {
  const list = batches.map(b => `${b.number} (${b.status})`).join(', ');
  return new DomainError(422, 'batch_blocked', `Batches not accepted by quality control cannot be issued: ${list}`, { productId: r.productId, warehouseId: r.warehouseId, lineId: r.lineId });
}

/** Распределяет FEFO под блокировками applyStockMoves. Перемещения сохраняют каждую
    порцию и даты, но получают отдельную партию на принимающем складе. */
export async function assignBatches(db: Db, workspaceId: string, doc: { id: string; date: string }, reqs: MoveRequest[], lineBatches: Map<string, BatchLineInput>): Promise<MoveRequest[]> {
  const tracked = await batchTrackedProducts(db, reqs.map(r => r.productId));
  if (!tracked.size) return reqs;
  const quarantine = await quarantineWarehouses(db, workspaceId);
  const out: MoveRequest[] = [];
  const outOfLine = new Map<string, MoveRequest[]>();
  const withdrawals = reqs.filter(r => r.direction === 'out' && tracked.has(r.productId));
  const fefo = new Map<string, AvailableBatch[]>();
  const byId = new Map<string, AvailableBatch>();
  if (withdrawals.length) {
    const rows = await db.select({
      id: stockBatches.id, warehouseId: stockBatches.warehouseId, productId: stockBatches.productId,
      number: stockBatches.number, status: stockBatches.status, producedAt: stockBatches.producedAt, expiresAt: stockBatches.expiresAt,
      qty: sql<string>`(select coalesce(sum(m.qty), 0) from stock_moves m where m.batch_id = stock_batches.id)`,
    }).from(stockBatches).where(and(
      eq(stockBatches.workspaceId, workspaceId),
      inArray(stockBatches.productId, [...tracked.keys()]),
      inArray(stockBatches.warehouseId, [...new Set(withdrawals.map(r => r.warehouseId))]),
    )).orderBy(sql`${stockBatches.expiresAt} asc nulls last`, asc(stockBatches.createdAt), asc(stockBatches.id));
    for (const row of rows) {
      const batch = { ...row, qty: dec(row.qty) };
      byId.set(batch.id, batch);
      const key = `${row.warehouseId}:${row.productId}`;
      const list = fefo.get(key) ?? [];
      list.push(batch);
      fefo.set(key, list);
    }
  }
  // Приёмка выбирает порции своей отправки. Общий FEFO склада «в пути» может
  // содержать тот же товар из других перемещений, включая более ранние партии.
  const shipped = withdrawals.some(r => r.phase === 2)
    ? await db.select().from(stockMoves).where(and(
      eq(stockMoves.workspaceId, workspaceId), eq(stockMoves.documentId, doc.id),
      eq(stockMoves.phase, 1), gt(stockMoves.qty, '0'),
    )).orderBy(asc(stockMoves.seq))
    : [];
  for (const r of reqs) {
    if (r.direction !== 'out') continue;
    if (!tracked.has(r.productId)) { out.push(r); continue; }
    const portions: MoveRequest[] = [];
    let left = r.qty;
    const take = (qty: Dec, batch?: AvailableBatch) => {
      if (qty <= 0n) return;
      left -= qty;
      if (batch) batch.qty -= qty;
      portions.push({ ...r, qty, batchId: batch?.id ?? null });
    };
    if (r.phase === 2) {
      for (const m of shipped) {
        if (left <= 0n) break;
        if (m.documentLineId !== r.lineId || m.warehouseId !== r.warehouseId || m.productId !== r.productId) continue;
        const batch = m.batchId ? byId.get(m.batchId) : undefined;
        const qty = dec(m.qty) < left ? dec(m.qty) : left;
        if (m.batchId && (!batch || batch.qty < qty)) throw new DomainError(422, 'stock_conflict', 'The shipped batch is no longer available');
        take(qty, batch);
      }
      if (left > 0n) throw new DomainError(422, 'stock_conflict', 'The shipment does not contain the requested quantity');
    } else {
      const all = fefo.get(`${r.warehouseId}:${r.productId}`) ?? [];
      // Контроль качества (задача 1186): обычный расход и перемещение берут только партии ok;
      // возврат поставщику и списание на брак — любые партии склада.
      if (!r.qualityExit) {
        const wanted = lineBatches.get(r.lineId ?? '')?.number?.trim();
        const named = wanted ? all.find(b => b.number === wanted) : undefined;
        if (named && named.status !== 'ok') throw blocked([named], r);
      }
      for (const batch of r.qualityExit ? all : all.filter(b => b.status === 'ok')) {
        if (left <= 0n) break;
        take(batch.qty < left ? batch.qty : left, batch);
      }
      if (left > 0n && !r.qualityExit) {
        // Остаток не в ok: если он лежит в заблокированных партиях — отказ. Свободный остаток без партий
        // (до включения партионного учёта) и разрешённый минус остаются без партии, как раньше.
        const held = all.filter(b => b.status !== 'ok' && b.qty > 0n);
        if (held.length) {
          const [free] = await db.select({ qty: sql<string>`coalesce(sum(${stockMoves.qty}), 0)` }).from(stockMoves).where(and(
            eq(stockMoves.workspaceId, workspaceId), eq(stockMoves.warehouseId, r.warehouseId), eq(stockMoves.productId, r.productId), sql`${stockMoves.batchId} is null`,
          ));
          if (left > dec(free?.qty ?? '0')) throw blocked(held, r);
        }
      }
      // Остаток до включения партионного учёта (или разрешённый минус) остаётся без партии.
      if (left > 0n) take(left);
    }
    out.push(...portions);
    if (r.lineId) outOfLine.set(r.lineId, [...(outOfLine.get(r.lineId) ?? []), ...portions]);
  }
  for (const r of reqs) {
    if (r.direction !== 'in') continue;
    if (!tracked.has(r.productId) || !r.lineId) { out.push(r); continue; }
    if (r.costFromLine) {
      let left = r.qty;
      for (const portion of outOfLine.get(r.lineId) ?? []) {
        if (left <= 0n) break;
        const qty = portion.qty < left ? portion.qty : left;
        const source = portion.batchId ? byId.get(portion.batchId)! : null;
        // статус партии-источника переносится на партию-получатель (принятая партия остаётся ok, непринятая не размывается)
        const batchId = source ? await receiptBatch(db, workspaceId, r, { number: source.number, producedAt: source.producedAt, expiresAt: source.expiresAt }, source.status) : null;
        out.push({ ...r, qty, batchId });
        left -= qty;
      }
      if (left > 0n) throw new DomainError(422, 'stock_conflict', 'The transfer has no matching withdrawal');
      continue;
    }
    const product = tracked.get(r.productId)!;
    const input = lineBatches.get(r.lineId) ?? {};
    const number = (input.number ?? '').trim();
    if (!number) throw new DomainError(422, 'batch_number_required', `"${product.name}": enter a batch number for the receipt line`, { productId: r.productId, lineId: r.lineId });
    const batchId = await receiptBatch(db, workspaceId, r, {
      number, producedAt: input.producedAt ?? doc.date,
      expiresAt: input.expiresAt ?? (product.shelfLifeDays ? addDays(doc.date, product.shelfLifeDays) : null),
    }, quarantine.has(r.warehouseId) ? 'quarantine' : 'ok'); // приход на карантинный склад создаёт партию на карантине
    out.push({ ...r, batchId });
  }
  return out;
}

/** Партии строк документа для формы и печати: строка → партия (номер, даты) */
export async function lineBatchesView(db: Db, documentId: string) {
  const rows = await db
    .select({ lineId: stockBatches.documentLineId, batchId: stockBatches.id, number: stockBatches.number, producedAt: stockBatches.producedAt, expiresAt: stockBatches.expiresAt })
    .from(stockBatches)
    .where(eq(stockBatches.documentLineId, sql`any(select id from ${documentLines} where document_id = ${documentId})`));
  return rows.filter(r => r.lineId);
}

/** После удаления движений проверяет все затронутые партии, включая пополнение чужой партии.
    Нулевой остаток не означает отсутствие ссылок: удалять можно только партии без движений. */
export async function revertBatches(db: Db, workspaceId: string, batchIds: string[], allowNegativeStock: boolean): Promise<void> {
  if (!batchIds.length) return;
  const rows = await db
    .select({
      id: stockBatches.id,
      qty: sql<string>`(select coalesce(sum(m.qty), 0) from stock_moves m where m.batch_id = stock_batches.id)`,
      used: sql<boolean>`exists(select 1 from stock_moves m where m.batch_id = stock_batches.id)`,
    })
    .from(stockBatches)
    .where(and(eq(stockBatches.workspaceId, workspaceId), inArray(stockBatches.id, batchIds)));
  const negative = rows.filter(r => dec(r.qty) < 0n);
  if (!allowNegativeStock && negative.length) throw new DomainError(422, 'stock_conflict', 'Cannot unpost: later movements need these batches. Unpost the dependent documents first.', { batchIds: negative.map(r => r.id) });
  const empty = rows.filter(r => !r.used).map(r => r.id);
  if (empty.length) await db.delete(stockBatches).where(inArray(stockBatches.id, empty));
}

/** Остатки партий (по движениям) для отчёта: склад, товар, партия, количество, даты */
export async function batchBalances(db: Db, workspaceId: string, opts: { warehouseId?: string; productId?: string; days?: number; expired?: boolean; q?: string } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      batchId: stockBatches.id,
      warehouseId: stockBatches.warehouseId,
      warehouseName: warehouses.name,
      productId: stockBatches.productId,
      productName: products.name,
      number: stockBatches.number,
      status: stockBatches.status,
      producedAt: stockBatches.producedAt,
      expiresAt: stockBatches.expiresAt,
      qty: sql<string>`(select coalesce(sum(m.qty), 0) from stock_moves m where m.batch_id = stock_batches.id)`,
    })
    .from(stockBatches)
    .innerJoin(products, eq(products.id, stockBatches.productId))
    .innerJoin(warehouses, eq(warehouses.id, stockBatches.warehouseId))
    .where(
      and(
        eq(stockBatches.workspaceId, workspaceId),
        opts.warehouseId ? eq(stockBatches.warehouseId, opts.warehouseId) : undefined,
        opts.productId ? eq(stockBatches.productId, opts.productId) : undefined,
        opts.q?.trim() ? ilike(stockBatches.number, `%${opts.q.trim().replace(/[%_\\]/g, m => '\\' + m)}%`) : undefined,
        opts.expired ? sql`${stockBatches.expiresAt} < ${today}` : undefined,
        opts.days !== undefined ? sql`${stockBatches.expiresAt} is not null and ${stockBatches.expiresAt} <= (current_date + ${opts.days} * interval '1 day')` : undefined,
      ),
    )
    .orderBy(asc(stockBatches.warehouseId), asc(stockBatches.productId), sql`${stockBatches.expiresAt} asc nulls last`);
  return rows.map(r => ({ ...r, qty: fmt(dec(r.qty), 3) }));
}
