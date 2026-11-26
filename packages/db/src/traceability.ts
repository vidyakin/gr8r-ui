/* Прослеживаемость партий (задача 1253): запись связей партий и двусторонняя трассировка.

   Связи пишет проведение документов (выпуск продукции, перемещение, переработка давальческого
   сырья) в таблицу `stock_batch_links`; отмена проведения их удаляет, повторное проведение
   пересоздаёт (идемпотентно). Сами связи остаток и себестоимость не двигают — это только граф.

   Трассировка строит дерево из двух источников:
   - `stock_batch_links` — рёбра «вход → выход» выпусков и перемещений;
   - `stock_moves` / `customer_stock_moves` — листья (поступления, отгрузки, заказы, переработка).
   Готовое неструктурированное дерево собирает чистый построитель из `@erp/shared`
   (`buildTraceTree`), который сам защищён от циклов, глубины и взрыва числа узлов. */
import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import { buildTraceTree, dec, fmt, type TraceNode, type TraceNodeSeed } from '@erp/shared';
import type { Db } from './client';
import {
  companies,
  customerStockMoves,
  documentLines,
  documents,
  productionHeaders,
  products,
  stockBatchLinks,
  stockBatches,
  stockMoves,
  warehouses,
} from './schema';

/** Документы поступления: их партии — начало цепочки, вплоть до поставщика */
const RECEIPT_TYPES = new Set(['receipt', 'opening_stock', 'stock_posting']);

type LinkInsert = typeof stockBatchLinks.$inferInsert;

/** Модуль количества строкой (numeric приходит со знаком) */
const absQty = (q: string): string => fmt(dec(q) < 0n ? -dec(q) : dec(q));

/** Группировка массива по ключу */
function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k) ?? [];
    list.push(it);
    out.set(k, list);
  }
  return out;
}

/* ---------------- запись связей ---------------- */

/** Удаляет связи документа (отмена проведения, повторное проведение) */
export async function removeStockBatchLinks(db: Db, workspaceId: string, documentId: string): Promise<void> {
  await db.delete(stockBatchLinks).where(and(eq(stockBatchLinks.workspaceId, workspaceId), eq(stockBatchLinks.documentId, documentId)));
}

/**
 * Записывает связи партий по проведённому документу. Вызывается после проведения движений
 * склада (выпуск, перемещение) и давальческого сырья (переработка). Идемпотентно: старые связи
 * документа заменяются новыми.
 *
 * - production: каждая списанная партия сырья → каждая выпущенная партия продукции (и разборка —
 *   исходный товар → выходные продукты);
 * - transfer: партия склада-источника → партия склада-получателя (попарно по товару);
 * - processing: движения давальческого сырья (customer_stock_moves) — материалы → продукция,
 *   без партий своего склада (у давальца партийного измерения нет).
 */
export async function recordStockBatchLinks(db: Db, workspaceId: string, documentId: string): Promise<void> {
  const [doc] = await db
    .select({ id: documents.id, type: documents.type, tollingOrderId: documents.tollingOrderId })
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)))
    .limit(1);
  if (!doc) return;
  await removeStockBatchLinks(db, workspaceId, documentId);
  const rows: LinkInsert[] = [];

  if (doc.type === 'production' || doc.type === 'stock_transfer') {
    // Движения своего склада с партиями: приход (+) — выходные партии, расход (−) — входные
    const moves = await db
      .select({
        batchId: stockMoves.batchId,
        productId: stockMoves.productId,
        lineId: stockMoves.documentLineId,
        qty: stockMoves.qty,
      })
      .from(stockMoves)
      .where(and(eq(stockMoves.workspaceId, workspaceId), eq(stockMoves.documentId, documentId)))
      .orderBy(asc(stockMoves.seq));
    const withBatch = moves.filter(m => m.batchId) as { batchId: string; productId: string; lineId: string | null; qty: string }[];
    const ins = withBatch.filter(m => dec(m.qty) > 0n);
    const outs = withBatch.filter(m => dec(m.qty) < 0n);
    if (doc.type === 'production') {
      for (const o of outs) {
        for (const i of ins) {
          rows.push({
            workspaceId,
            documentId,
            kind: 'production',
            inputBatchId: o.batchId,
            outputBatchId: i.batchId,
            inputLineId: o.lineId,
            outputLineId: i.lineId,
            inputProductId: o.productId,
            outputProductId: i.productId,
            ownerKind: 'own',
            qty: absQty(o.qty),
          });
        }
      }
    } else {
      // Перемещение: приход и расход одной строки идут по порядку, партия-источник → партия-получатель
      const insByProduct = groupBy(ins, m => m.productId);
      const outsByProduct = groupBy(outs, m => m.productId);
      for (const [productId, productOuts] of outsByProduct) {
        const productIns = insByProduct.get(productId) ?? [];
        const pairs = Math.min(productOuts.length, productIns.length);
        for (let k = 0; k < pairs; k += 1) {
          const o = productOuts[k]!;
          const i = productIns[k]!;
          rows.push({
            workspaceId,
            documentId,
            kind: 'transfer',
            inputBatchId: o.batchId,
            outputBatchId: i.batchId,
            inputLineId: o.lineId,
            outputLineId: i.lineId,
            inputProductId: o.productId,
            outputProductId: i.productId,
            ownerKind: 'own',
            qty: absQty(o.qty),
          });
        }
      }
    }
  }

  // Давальческое сырьё (переработка): у своего склада партий нет — связь держится за заказ на переработку
  const cmoves = await db
    .select({
      productId: customerStockMoves.productId,
      qty: customerStockMoves.qty,
      ownerCompanyId: customerStockMoves.ownerCompanyId,
      processingOrderId: customerStockMoves.processingOrderId,
    })
    .from(customerStockMoves)
    .where(and(eq(customerStockMoves.workspaceId, workspaceId), eq(customerStockMoves.documentId, documentId)));
  if (cmoves.length) {
    const processingOrderId = doc.tollingOrderId ?? cmoves.find(m => m.processingOrderId)?.processingOrderId ?? null;
    const cOut = cmoves.filter(m => dec(m.qty) < 0n);
    const cIn = cmoves.filter(m => dec(m.qty) > 0n);
    if (cOut.length && cIn.length) {
      for (const o of cOut) {
        for (const i of cIn) {
          rows.push({
            workspaceId,
            documentId,
            kind: 'processing',
            ownerKind: 'customer',
            ownerCompanyId: o.ownerCompanyId,
            processingOrderId: processingOrderId ?? o.processingOrderId,
            inputProductId: o.productId,
            outputProductId: i.productId,
            qty: absQty(o.qty),
          });
        }
      }
    }
    // Только расход (переработка без выпуска в этом документе) или только приход (приём давальца)
    for (const m of cOut.length && !cIn.length ? cOut : cIn.length && !cOut.length ? cIn : []) {
      rows.push({
        workspaceId,
        documentId,
        kind: 'processing',
        ownerKind: 'customer',
        ownerCompanyId: m.ownerCompanyId,
        processingOrderId: processingOrderId ?? m.processingOrderId,
        inputProductId: dec(m.qty) < 0n ? m.productId : null,
        outputProductId: dec(m.qty) > 0n ? m.productId : null,
        qty: absQty(m.qty),
      });
    }
  }

  if (rows.length) await db.insert(stockBatchLinks).values(rows);
}

/* ---------------- трассировка ---------------- */

interface BatchRow {
  id: string;
  number: string;
  producedAt: string | null;
  expiresAt: string | null;
  status: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  documentLineId: string | null;
}
interface DocRow {
  id: string;
  type: string;
  number: string | null;
  date: string;
  status: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  basedOnId: string | null;
  tollingOrderId: string | null;
  processingOrderId: string | null;
}

interface Graph {
  seeds: Map<string, TraceNodeSeed>;
  adjacency: Map<string, string[]>;
}

function edge(graph: Graph, parent: string, child: string): void {
  const list = graph.adjacency.get(parent) ?? [];
  if (!list.includes(child)) {
    list.push(child);
    graph.adjacency.set(parent, list);
  }
}

function createGraph(): Graph {
  return { seeds: new Map(), adjacency: new Map() };
}

async function loadBatch(db: Db, workspaceId: string, batchId: string): Promise<BatchRow | null> {
  const [row] = await db
    .select({
      id: stockBatches.id,
      number: stockBatches.number,
      producedAt: stockBatches.producedAt,
      expiresAt: stockBatches.expiresAt,
      status: stockBatches.status,
      warehouseId: stockBatches.warehouseId,
      warehouseName: warehouses.name,
      productId: stockBatches.productId,
      productName: products.name,
      documentLineId: stockBatches.documentLineId,
    })
    .from(stockBatches)
    .innerJoin(products, and(eq(products.workspaceId, stockBatches.workspaceId), eq(products.id, stockBatches.productId)))
    .innerJoin(warehouses, and(eq(warehouses.workspaceId, stockBatches.workspaceId), eq(warehouses.id, stockBatches.warehouseId)))
    .where(and(eq(stockBatches.workspaceId, workspaceId), eq(stockBatches.id, batchId)))
    .limit(1);
  return row ?? null;
}

async function loadDocument(db: Db, workspaceId: string, docId: string): Promise<DocRow | null> {
  const [row] = await db
    .select({
      id: documents.id,
      type: documents.type,
      number: documents.number,
      date: documents.date,
      status: documents.status,
      counterpartyId: documents.counterpartyId,
      counterpartyName: companies.name,
      basedOnId: documents.basedOnId,
      tollingOrderId: documents.tollingOrderId,
      processingOrderId: productionHeaders.processingOrderId,
    })
    .from(documents)
    .leftJoin(companies, and(eq(companies.workspaceId, documents.workspaceId), eq(companies.id, documents.counterpartyId)))
    .leftJoin(productionHeaders, and(eq(productionHeaders.workspaceId, documents.workspaceId), eq(productionHeaders.documentId, documents.id)))
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, docId)))
    .limit(1);
  return row ?? null;
}

async function documentOfLine(db: Db, workspaceId: string, lineId: string): Promise<string | null> {
  const [row] = await db
    .select({ documentId: documentLines.documentId })
    .from(documentLines)
    .where(and(eq(documentLines.workspaceId, workspaceId), eq(documentLines.id, lineId)))
    .limit(1);
  return row?.documentId ?? null;
}

/** Заказ-основание документа (для отгрузки): идём по based_on до документа-заказа */
async function orderOfDocument(db: Db, workspaceId: string, docId: string): Promise<string | null> {
  const orderTypes = new Set(['customer_order', 'supplier_order', 'production_order']);
  const seen = new Set<string>();
  let current: string | null = docId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const [row] = await db
      .select({ type: documents.type, basedOnId: documents.basedOnId })
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, current)))
      .limit(1);
    if (!row) return null;
    if (orderTypes.has(row.type)) return current;
    current = row.basedOnId ?? null;
  }
  return null;
}

/** Общий кэш узлов дерева: один и тот же документ/партия не загружается повторно, но рёбра добавляются все */
function nodeFactory(graph: Graph) {
  const batchNodes = new Map<string, string | null>();
  const docNodes = new Map<string, string | null>();
  const batchRows = new Map<string, BatchRow | null>();
  const docRows = new Map<string, DocRow | null>();

  const ensureBatch = async (db: Db, workspaceId: string, batchId: string): Promise<string | null> => {
    if (batchNodes.has(batchId)) return batchNodes.get(batchId)!;
    const row = await loadBatch(db, workspaceId, batchId);
    batchRows.set(batchId, row);
    if (!row) {
      batchNodes.set(batchId, null);
      return null;
    }
    const id = `batch:${batchId}`;
    graph.seeds.set(id, {
      id,
      kind: 'batch',
      title: row.number,
      subtitle: `${row.productName} · ${row.warehouseName}`,
      batchId: row.id,
      productId: row.productId,
      productName: row.productName,
      warehouseId: row.warehouseId,
      number: row.number,
      date: row.producedAt,
      meta: { status: row.status, expiresAt: row.expiresAt },
    });
    batchNodes.set(batchId, id);
    return id;
  };

  const ensureDoc = async (db: Db, workspaceId: string, docId: string, kind: 'document' | 'order' = 'document'): Promise<string | null> => {
    const key = `${kind}:${docId}`;
    if (docNodes.has(key)) return docNodes.get(key)!;
    const row = await loadDocument(db, workspaceId, docId);
    docRows.set(docId, row);
    if (!row) {
      docNodes.set(key, null);
      return null;
    }
    const id = `${kind === 'order' ? 'order' : 'doc'}:${docId}`;
    graph.seeds.set(id, {
      id,
      kind,
      title: row.number ?? row.type,
      subtitle: row.counterpartyName,
      documentId: row.id,
      documentType: row.type,
      documentNumber: row.number,
      date: row.date,
      meta: { status: row.status },
    });
    docNodes.set(key, id);
    return id;
  };

  const ensureSupplier = (companyId: string, name: string | null): string => {
    const id = `supplier:${companyId}`;
    if (!graph.seeds.has(id)) graph.seeds.set(id, { id, kind: 'supplier', title: name ?? '', subtitle: null });
    return id;
  };

  return { batchNodes, batchRows, docRows, ensureBatch, ensureDoc, ensureSupplier };
}

/**
 * Трассировка назад: «из чего сделана партия X».
 * Партия → документ, который её создал (выпуск/перемещение/поступление) → списанные партии сырья
 * (рекурсивно) → … → поступления вплоть до поставщика и даты/номера партии.
 */
export async function batchTraceBackward(
  db: Db,
  workspaceId: string,
  batchId: string,
  opts: { depth?: number } = {},
): Promise<TraceNode | null> {
  const graph = createGraph();
  const f = nodeFactory(graph);
  const root = await f.ensureBatch(db, workspaceId, batchId);
  if (!root) return null;

  const queue: string[] = [batchId];
  const visited = new Set<string>([batchId]);
  const processedDocs = new Set<string>();
  while (queue.length) {
    const b = queue.shift()!;
    const bnode = f.batchNodes.get(b);
    const brow = f.batchRows.get(b);
    if (!bnode || !brow?.documentLineId) continue;
    const originDocId = await documentOfLine(db, workspaceId, brow.documentLineId);
    if (!originDocId) continue;
    const dnode = await f.ensureDoc(db, workspaceId, originDocId);
    if (!dnode) continue;
    edge(graph, bnode, dnode);
    if (processedDocs.has(originDocId)) continue;
    processedDocs.add(originDocId);
    const drow = f.docRows.get(originDocId);
    if (!drow) continue;
    if (drow.type === 'production' || drow.type === 'stock_transfer') {
      const links = await db
        .select({ inputBatchId: stockBatchLinks.inputBatchId })
        .from(stockBatchLinks)
        .where(and(eq(stockBatchLinks.workspaceId, workspaceId), eq(stockBatchLinks.documentId, originDocId), isNotNull(stockBatchLinks.inputBatchId)));
      for (const l of links) {
        if (!l.inputBatchId) continue;
        const inode = await f.ensureBatch(db, workspaceId, l.inputBatchId);
        if (!inode) continue;
        edge(graph, dnode, inode);
        if (!visited.has(l.inputBatchId)) {
          visited.add(l.inputBatchId);
          queue.push(l.inputBatchId);
        }
      }
    }
    if (RECEIPT_TYPES.has(drow.type) && drow.counterpartyId) {
      edge(graph, dnode, f.ensureSupplier(drow.counterpartyId, drow.counterpartyName));
    }
  }
  return buildTraceTree(root, graph.seeds, graph.adjacency, { maxDepth: opts.depth });
}

/**
 * Трассировка вперёд: «куда ушло сырьё партии Y».
 * Партия → документы, где она списана (выпуск/перемещение/отгрузка/списание) → для выпусков и
 * перемещений выходные партии (рекурсивно), для отгрузок — заказ покупателя, для переработки —
 * продукция давальца.
 */
export async function batchTraceForward(
  db: Db,
  workspaceId: string,
  batchId: string,
  opts: { depth?: number } = {},
): Promise<TraceNode | null> {
  const graph = createGraph();
  const f = nodeFactory(graph);
  const root = await f.ensureBatch(db, workspaceId, batchId);
  if (!root) return null;

  const queue: string[] = [batchId];
  const visited = new Set<string>([batchId]);
  const processedDocs = new Set<string>();
  while (queue.length) {
    const b = queue.shift()!;
    const bnode = f.batchNodes.get(b);
    if (!bnode) continue;
    // Документы, где партия израсходована (отрицательные движения)
    const consumed = await db
      .select({ documentId: stockMoves.documentId })
      .from(stockMoves)
      .where(and(eq(stockMoves.workspaceId, workspaceId), eq(stockMoves.batchId, b), lt(stockMoves.qty, '0')));
    for (const docId of new Set(consumed.map(c => c.documentId))) {
      const dnode = await f.ensureDoc(db, workspaceId, docId);
      if (!dnode) continue;
      edge(graph, bnode, dnode);
      if (processedDocs.has(docId)) continue;
      processedDocs.add(docId);
      const drow = f.docRows.get(docId);
      if (!drow) continue;
      if (drow.type === 'production' || drow.type === 'stock_transfer') {
        // Выходные партии, связанные именно с этой входной партией
        const links = await db
          .select({ outputBatchId: stockBatchLinks.outputBatchId })
          .from(stockBatchLinks)
          .where(
            and(
              eq(stockBatchLinks.workspaceId, workspaceId),
              eq(stockBatchLinks.documentId, docId),
              eq(stockBatchLinks.inputBatchId, b),
              isNotNull(stockBatchLinks.outputBatchId),
            ),
          );
        for (const l of links) {
          if (!l.outputBatchId) continue;
          const onode = await f.ensureBatch(db, workspaceId, l.outputBatchId);
          if (!onode) continue;
          edge(graph, dnode, onode);
          if (!visited.has(l.outputBatchId)) {
            visited.add(l.outputBatchId);
            queue.push(l.outputBatchId);
          }
        }
        // Переработка давальческого сырья: показать продукцию давальца и заказ на переработку
        if (drow.type === 'production' && drow.processingOrderId) {
          const products_ = await db
            .select({ outputProductId: stockBatchLinks.outputProductId, qty: stockBatchLinks.qty })
            .from(stockBatchLinks)
            .where(and(eq(stockBatchLinks.workspaceId, workspaceId), eq(stockBatchLinks.documentId, docId), eq(stockBatchLinks.kind, 'processing')));
          for (const p of products_) {
            if (!p.outputProductId) continue;
            const id = `processing:${docId}:${p.outputProductId}`;
            if (!graph.seeds.has(id)) {
              graph.seeds.set(id, {
                id,
                kind: 'processing',
                title: p.outputProductId,
                subtitle: drow.counterpartyName,
                productId: p.outputProductId,
                documentId: docId,
                qty: fmt(dec(p.qty)),
              });
            }
            edge(graph, dnode, id);
          }
          const orderNode = await f.ensureDoc(db, workspaceId, drow.processingOrderId, 'order');
          if (orderNode) edge(graph, dnode, orderNode);
        }
      } else if (drow.type === 'realization' || drow.type === 'work_order') {
        const orderId = await orderOfDocument(db, workspaceId, docId);
        if (orderId) {
          const onode = await f.ensureDoc(db, workspaceId, orderId, 'order');
          if (onode) edge(graph, dnode, onode);
        }
      }
    }
  }
  return buildTraceTree(root, graph.seeds, graph.adjacency, { maxDepth: opts.depth });
}
