/* Прослеживаемость партий (задача 1253).
   Двусторонняя трассировка партий: назад «из чего сделана партия» (сырьё, полуфабрикаты,
   документы выпуска и поступления вплоть до поставщика) и вперёд «куда ушло сырьё»
   (выпуски, перемещения, отгрузки и заказы покупателей).

   Здесь — только чистые типы, zod-схемы запроса и построитель дерева. Построитель не знает
   про БД: ему дают плоский набор узлов и рёбра «родитель → потомки», он собирает вложенное
   дерево с защитой от циклов, ограничением глубины и предохранителем от взрыва числа узлов.
   База (packages/db/src/traceability.ts) отдаёт эти узлы/рёбра, интерфейс рисует дерево. */
import { z } from 'zod';

/** Направление трассировки: назад (из чего) или вперёд (куда ушло) */
export const TRACE_DIRECTIONS = ['backward', 'forward'] as const;
export type TraceDirection = (typeof TRACE_DIRECTIONS)[number];

/** Вид узла дерева трассировки */
export const TRACE_NODE_KINDS = ['batch', 'document', 'movement', 'order', 'supplier', 'processing'] as const;
export type TraceNodeKind = (typeof TRACE_NODE_KINDS)[number];

/** Узел без детей: то, что отдаёт база (плоско) */
export interface TraceNodeSeed {
  /** Уникальный id узла в пределах дерева: `batch:<uuid>`, `doc:<uuid>`, `order:<uuid>`, `supplier:<uuid>` */
  id: string;
  kind: TraceNodeKind;
  /** Заголовок: номер партии, номер документа, название товара или контрагента */
  title: string;
  /** Пояснение под заголовком: товар/склад, контрагент/дата, статус */
  subtitle?: string | null;
  batchId?: string | null;
  documentId?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  productId?: string | null;
  productName?: string | null;
  warehouseId?: string | null;
  /** Номер партии (для узлов вида batch) */
  number?: string | null;
  /** Количество по связи (строка с 3 знаками) */
  qty?: string | null;
  /** Дата документа/партии (YYYY-MM-DD) */
  date?: string | null;
  /** Произвольные дополнительные поля (статус партии, срок годности, заказ и т.п.) */
  meta?: Record<string, unknown>;
}

/** Узел дерева с детьми */
export interface TraceNode extends TraceNodeSeed {
  children: TraceNode[];
}

export interface BuildTraceOptions {
  /** Максимальная глубина разворота (корень — глубина 0). По умолчанию 100 */
  maxDepth?: number;
  /** Предохранитель от взрыва дерева: максимум узлов. По умолчанию 5000 */
  maxNodes?: number;
}

export const TRACE_DEFAULT_MAX_DEPTH = 100;
export const TRACE_DEFAULT_MAX_NODES = 5000;

/**
 * Собирает вложенное дерево из плоских узлов и рёбер.
 *
 * Защита от циклов — по множеству предков текущей ветви: если потомок уже встречался
 * выше по стеку, ребро не разворачивается (иначе дерево было бы бесконечным). «Ромб»
 * (один узел достижим двумя путями) циклом не считается: узел законно появляется в двух ветвях.
 * Дубли рёбер у одного родителя отбрасываются. Глубина и число узлов ограничены.
 *
 * Возвращает null, если корня нет в наборе узлов.
 */
export function buildTraceTree(
  rootId: string,
  seeds: Map<string, TraceNodeSeed>,
  adjacency: Map<string, string[]>,
  opts: BuildTraceOptions = {},
): TraceNode | null {
  if (!seeds.has(rootId)) return null;
  const maxDepth = opts.maxDepth ?? TRACE_DEFAULT_MAX_DEPTH;
  const maxNodes = opts.maxNodes ?? TRACE_DEFAULT_MAX_NODES;
  let count = 0;

  const build = (id: string, depth: number, path: Set<string>): TraceNode | null => {
    const seed = seeds.get(id);
    if (!seed) return null;
    count += 1;
    // Копируем поля узла; children заполняем ниже (seed сам children не содержит)
    const node: TraceNode = { ...seed, children: [] };
    if (depth >= maxDepth || count >= maxNodes) return node;
    const nextPath = new Set(path);
    nextPath.add(id);
    const seenChildren = new Set<string>();
    for (const childId of adjacency.get(id) ?? []) {
      if (seenChildren.has(childId)) continue; // дубль ребра
      seenChildren.add(childId);
      if (nextPath.has(childId)) continue; // цикл: предок не повторяется
      if (count >= maxNodes) break;
      const child = build(childId, depth + 1, nextPath);
      if (child) node.children.push(child);
    }
    return node;
  };

  return build(rootId, 0, new Set());
}

/** Плоский список узлов дерева (обход в глубину, корень первым) */
export function flattenTraceTree(node: TraceNode): TraceNode[] {
  const out: TraceNode[] = [];
  const walk = (n: TraceNode): void => {
    out.push(n);
    for (const child of n.children) walk(child);
  };
  walk(node);
  return out;
}

/** Глубина дерева: лист — 0, корень с детьми — максимум по ветвям */
export function traceTreeDepth(node: TraceNode): number {
  if (!node.children.length) return 0;
  return 1 + Math.max(...node.children.map(traceTreeDepth));
}

/** Общее число узлов дерева */
export function traceTreeSize(node: TraceNode): number {
  let size = 1;
  for (const child of node.children) size += traceTreeSize(child);
  return size;
}

/* ---------------- zod-схемы ---------------- */

export const traceDirectionSchema = z.enum(TRACE_DIRECTIONS);

/** Параметры запроса трассировки партии: ограничение глубины (1..50) */
export const batchTraceQuery = z.object({
  depth: z.coerce.number().int().min(1).max(50).optional(),
});
export type BatchTraceQuery = z.infer<typeof batchTraceQuery>;
