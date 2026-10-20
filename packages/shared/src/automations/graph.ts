/* Граф flow: формат хранения, проверка перед публикацией, помощники над реестром узлов.
   Формат: { nodes: [{ id, type, position, params }], edges: [{ id, source, sourceHandle?, target }] }.
   Редактор (React Flow) превращает его в свои узлы и связи и обратно. */
import { z } from 'zod';
import { NODE_DEFS, NODE_LIST } from './nodes';
import type { AnyNodeDef, OutputDef } from './types';

export const FLOW_LIMITS = { maxNodes: 60, maxEdges: 150, maxStepsPerRun: 100 } as const;

const nodeId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Only letters, digits, "_" and "-"');

export const flowNodeSchema = z.object({
  id: nodeId,
  type: z.string().min(1).max(64),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).default({ x: 0, y: 0 }),
  params: z.record(z.string(), z.unknown()).default({}),
});
export const flowEdgeSchema = z.object({
  id: z.string().min(1).max(128),
  source: nodeId,
  sourceHandle: z.string().max(64).nullish(),
  target: nodeId,
});
export const flowGraphSchema = z.object({
  nodes: z.array(flowNodeSchema).max(FLOW_LIMITS.maxNodes),
  edges: z.array(flowEdgeSchema).max(FLOW_LIMITS.maxEdges),
});

export type FlowNode = z.output<typeof flowNodeSchema>;
export type FlowEdge = z.output<typeof flowEdgeSchema>;
export type FlowGraph = z.output<typeof flowGraphSchema>;

export const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] };

/* ---------------- реестр: помощники ---------------- */

export const getNodeDef = (type: string): AnyNodeDef | undefined => NODE_DEFS[type];

const DEFAULT_OUTPUT: OutputDef[] = [{ id: 'out', label: '' }];

/** Выходы узла по его параметрам (если параметры неверны — по значениям по умолчанию) */
export function nodeOutputs(def: AnyNodeDef, params: unknown): OutputDef[] {
  if (!def.outputs) return DEFAULT_OUTPUT;
  if (typeof def.outputs !== 'function') return def.outputs;
  const parsed = def.params.safeParse(params ?? {});
  if (parsed.success) return def.outputs(parsed.data);
  const fallback = def.params.safeParse({});
  return fallback.success ? def.outputs(fallback.data) : DEFAULT_OUTPUT;
}

export const isTriggerType = (type: string) => NODE_DEFS[type]?.category === 'trigger';

const jsonSchemaCache = new Map<string, Record<string, unknown>>();

/** JSON Schema параметров узла (в нём же подсказки интерфейса из `.meta()`): по нему редактор строит форму */
export function nodeParamsJsonSchema(def: AnyNodeDef): Record<string, unknown> {
  let s = jsonSchemaCache.get(def.type);
  if (!s) {
    s = z.toJSONSchema(def.params, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    jsonSchemaCache.set(def.type, s);
  }
  return s;
}

/** Значения параметров нового узла: defaults из схемы */
export function defaultParams(def: AnyNodeDef): Record<string, unknown> {
  const props = (nodeParamsJsonSchema(def).properties ?? {}) as Record<string, { default?: unknown }>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (v.default !== undefined) out[k] = v.default;
  return out;
}

/* ---------------- проверка графа ---------------- */

export interface GraphIssue {
  nodeId?: string;
  message: string;
}

/** Проверка перед публикацией: ровно один триггер, нет висящих узлов, нет циклов и слияний, параметры верны по схемам узлов.
    Слияние (у узла больше одной входящей связи) запрещено: запуск идёт по дереву от триггера, каждый узел выполняется не более раза */
export function validateGraph(graph: FlowGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byId = new Map<string, FlowNode>();
  for (const n of graph.nodes) {
    if (byId.has(n.id)) issues.push({ nodeId: n.id, message: `Duplicate node id "${n.id}"` });
    byId.set(n.id, n);
  }
  const triggers = graph.nodes.filter(n => isTriggerType(n.type));
  if (!triggers.length) issues.push({ message: 'The flow needs a trigger' });
  else if (triggers.length > 1) for (const t of triggers.slice(1)) issues.push({ nodeId: t.id, message: 'Only one trigger is allowed per flow' });
  if (graph.nodes.length < 2 && triggers.length) issues.push({ message: 'Add at least one step after the trigger' });

  for (const n of graph.nodes) {
    const def = NODE_DEFS[n.type];
    if (!def) {
      issues.push({ nodeId: n.id, message: `Unknown node type "${n.type}"` });
      continue;
    }
    const r = def.params.safeParse(n.params);
    if (!r.success) {
      for (const i of r.error.issues) issues.push({ nodeId: n.id, message: `${def.label}: ${i.path.length ? i.path.join('.') + ' — ' : ''}${i.message}` });
    }
  }

  const incoming = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const e of graph.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) {
      issues.push({ message: `Connection ${e.id} points to a missing node` });
      continue;
    }
    if (e.source === e.target) issues.push({ nodeId: e.source, message: 'A node cannot be connected to itself' });
    const sdef = NODE_DEFS[s.type];
    if (sdef) {
      const handle = e.sourceHandle || 'out';
      if (!nodeOutputs(sdef, s.params).some(o => o.id === handle)) issues.push({ nodeId: s.id, message: `${sdef.label}: output "${handle}" does not exist` });
    }
    if (isTriggerType(t.type)) issues.push({ nodeId: t.id, message: 'A trigger cannot have incoming connections' });
    incoming.set(t.id, (incoming.get(t.id) ?? 0) + 1);
    out.set(s.id, [...(out.get(s.id) ?? []), t.id]);
  }
  for (const [id, n] of incoming) if (n > 1) issues.push({ nodeId: id, message: 'A node can have only one incoming connection (merging branches is not supported)' });

  // Достижимость от триггера: всё остальное — «висящие» узлы; обход заодно ловит циклы
  if (triggers.length === 1) {
    const seen = new Set<string>();
    const stack = [triggers[0]!.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(out.get(id) ?? []));
    }
    for (const n of graph.nodes) if (!seen.has(n.id)) issues.push({ nodeId: n.id, message: `"${NODE_DEFS[n.type]?.label ?? n.type}" is not connected to the trigger` });
  }
  return issues;
}

/** Триггер графа (первый) */
export const triggerNodeOf = (graph: FlowGraph): FlowNode | undefined => graph.nodes.find(n => isTriggerType(n.type));

export { NODE_LIST };
