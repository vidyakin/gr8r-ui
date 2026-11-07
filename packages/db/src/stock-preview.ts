/* Движения документа до проведения (docs/architecture/stock.md, «Движения документа»).
   Для проведённого документа — фактические движения из stock_moves. Для черновика — настоящее проведение
   внутри savepoint с откатом: логика (applyStockMoves, партии FEFO, средняя, возвраты по цене источника, выпуск, перемещения)
   не дублируется и не расходится с реальным проведением. Откат возвращает всё: номер документа и счётчик, остатки,
   партии, взаиморасчёты, события outbox и NOTIFY (уведомления внутри отменённого savepoint не доставляются). */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import { DomainError } from './errors';
import { postDocument, type DocCtx } from './documents';
import { documents, products, stockBatches, stockCostAdjustments, stockMoves, warehouses } from './schema';

export interface DocumentMoveRow {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  sku: string;
  unitCode: string;
  /** Количество со знаком: приход +, расход − */
  qty: string;
  /** Цена единицы (себестоимость расхода или цена прихода) */
  cost: string;
  /** qty × cost, 2 знака */
  amount: string;
  batchNumber: string | null;
  phase: number;
  lineId: string | null;
  movedAt: string;
}

export interface DocumentMovesResult {
  /** actual — фактические движения проведённого документа; preview — расчёт проведения черновика */
  mode: 'actual' | 'preview';
  moves: DocumentMoveRow[];
  /** Проведение черновика сейчас невозможно (нехватка остатка, закрытый период…): код и текст ошибки проведения */
  error: { code: string; message: string; details?: unknown } | null;
}

/** Движения документа из stock_moves (себестоимость с корректировкой закрытия периода) */
export async function readDocumentMoves(db: Db, workspaceId: string, documentId: string): Promise<DocumentMoveRow[]> {
  const cost = sql`(${stockMoves.cost} + coalesce(${stockCostAdjustments.deltaCost}, 0))`;
  return db
    .select({
      warehouseId: stockMoves.warehouseId,
      warehouseName: warehouses.name,
      productId: stockMoves.productId,
      productName: products.name,
      sku: products.sku,
      unitCode: products.unitCode,
      qty: sql<string>`${stockMoves.qty}::numeric(18,3)::text`,
      cost: sql<string>`${cost}::numeric(18,4)::text`,
      amount: sql<string>`round(${stockMoves.qty} * ${cost}, 2)::text`,
      batchNumber: stockBatches.number,
      phase: stockMoves.phase,
      lineId: stockMoves.documentLineId,
      movedAt: stockMoves.movedAt,
    })
    .from(stockMoves)
    .innerJoin(warehouses, eq(warehouses.id, stockMoves.warehouseId))
    .innerJoin(products, eq(products.id, stockMoves.productId))
    .leftJoin(stockBatches, eq(stockBatches.id, stockMoves.batchId))
    .leftJoin(stockCostAdjustments, and(eq(stockCostAdjustments.workspaceId, stockMoves.workspaceId), eq(stockCostAdjustments.moveId, stockMoves.id)))
    .where(and(eq(stockMoves.workspaceId, workspaceId), eq(stockMoves.documentId, documentId)))
    .orderBy(asc(stockMoves.phase), asc(stockMoves.seq));
}

/** Выполняет fn внутри savepoint и всегда откатывает его (результат fn возвращается) */
async function withRollback<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  const name = `moves_preview_${Math.random().toString(36).slice(2, 10)}`;
  await db.execute(sql.raw(`savepoint ${name}`));
  try {
    return await fn();
  } finally {
    await db.execute(sql.raw(`rollback to savepoint ${name}`));
    await db.execute(sql.raw(`release savepoint ${name}`));
  }
}

/** Движения документа: проведённого — фактические, черновика — какие сделает проведение (данные не меняются) */
export async function documentMovesView(db: Db, ctx: DocCtx, id: string): Promise<DocumentMovesResult> {
  const [doc] = await db.select({ status: documents.status }).from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'Document not found');
  if (doc.status === 'posted') return { mode: 'actual', moves: await readDocumentMoves(db, ctx.workspaceId, id), error: null };
  if (doc.status !== 'draft') return { mode: 'preview', moves: [], error: null };
  try {
    const moves = await withRollback(db, async () => {
      await postDocument(db, ctx, id);
      return readDocumentMoves(db, ctx.workspaceId, id);
    });
    return { mode: 'preview', moves, error: null };
  } catch (e) {
    // правило проведения не пускает документ — это ответ, а не сбой запроса; прочие ошибки (в т.ч. БД) идут как есть
    if (e instanceof DomainError) return { mode: 'preview', moves: [], error: { code: e.code, message: e.message, details: e.details } };
    throw e;
  }
}
