/* Движок выполнения flow. Запуск (flow_runs) выполняется пошагово задачей jobs `flow.run`: каждый шаг — отдельная транзакция
   под ролью app_user с app.workspace_id арендатора (RLS действует; BYPASSRLS у воркера здесь не используется).
   В одной транзакции шаг делает действие, пишет flow_run_steps и сдвигает курсор запуска (flow_runs.state), поэтому упавший воркер
   не оставляет «полдействия»: транзакция откатывается и шаг выполнится заново. Действие узла идёт под SAVEPOINT — при ошибке его
   записи откатываются, а факт ошибки сохраняется в журнале шага.

   Граф — дерево от триггера (публикация запрещает слияния и циклы). Очередь `state.queue` хранит узлы к выполнению; её голова — текущий узел.
   Задержка и повтор временной ошибки не держат воркер: запуск переходит в waiting, а задача `flow.run` ставится в jobs с run_at. */
import { and, eq } from 'drizzle-orm';
import { enqueueRun, flowRunSteps, flowRuns, flowVersions, flows, recordEvent, withContext, type Db, type Sql, type Tx } from '@gr8r/db';
import {
  getNodeDef,
  resolveTemplates,
  TransientError,
  triggerNodeOf,
  type EventVia,
  type FlowContext,
  type FlowGraph,
  type HttpRequest,
  type HttpResult,
  type TriggerContext,
} from '@gr8r/shared';
import { defaultHttpOptions } from './http';
import { loadProjectOf, loadRecord } from './records';
import { makeRuntime } from './runtime';

export const flowEngine = {
  /** Максимум шагов на запуск */
  maxSteps: Number(process.env.FLOW_MAX_STEPS ?? 100),
  /** Попыток на шаг при временной ошибке (включая первую) */
  maxAttempts: Number(process.env.FLOW_MAX_ATTEMPTS ?? 3),
  /** Пауза перед повтором: base * 2^(попытка-1) секунд */
  retryBaseSec: Number(process.env.FLOW_RETRY_BASE_SEC ?? 5),
  http: defaultHttpOptions(),
  /** Подмена HTTP в тестах */
  httpImpl: undefined as ((req: HttpRequest) => Promise<HttpResult>) | undefined,
  log: (m: string) => console.log(`[flows] ${m}`),
};

interface RunState {
  queue: string[];
  steps: Record<string, Record<string, unknown>>;
  stepCount: number;
  seq: number;
  /** Номер текущей попытки узла в голове очереди */
  attempt?: number;
  /** Строка журнала текущего узла (при повторе и задержке) */
  stepId?: string;
  /** Узел из головы очереди отработал задержку: при возобновлении идём дальше, не выполняя его заново */
  delayDone?: string;
  resumeAt?: string;
}

const MAX_JSON = 20_000;
const SECRET_KEY = /authorization|token|secret|password|api[-_]?key|cookie/i;
const SECRET_LINE = /^(\s*(?:authorization|proxy-authorization|x-api-key|api-key|cookie|x-auth-token)\s*:).*$/gim;

/** Параметры в журнал: значения секретов (заголовки Authorization и т.п.) скрываются, большие значения обрезаются */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '…';
  if (typeof value === 'string') return value.replace(SECRET_LINE, '$1 ***');
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) && typeof v === 'string' && v ? '***' : redact(v, depth + 1)]));
  return value;
}

export function clip<T extends Record<string, unknown>>(v: T): T | Record<string, unknown> {
  const s = JSON.stringify(v);
  return s.length <= MAX_JSON ? v : { truncated: true, preview: s.slice(0, 2000) };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);

type Outcome = 'continue' | 'stop';

const successors = (graph: FlowGraph, nodeId: string, handle: string) => graph.edges.filter(e => e.source === nodeId && (e.sourceHandle || 'out') === handle).map(e => e.target);

/** Выполняет запуск до завершения, задержки или повтора. Бросает только при сбое инфраструктуры (задача jobs повторится) */
export async function executeRun(sql: Sql, workspaceId: string, runId: string): Promise<void> {
  for (let i = 0; i < flowEngine.maxSteps + 20; i++) {
    const outcome = await withContext(sql, { workspaceId }, (db, tx) => stepRun(db, tx, workspaceId, runId));
    if (outcome === 'stop') return;
  }
}

async function stepRun(db: Db, tx: Tx, ws: string, runId: string): Promise<Outcome> {
  const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1).for('update');
  if (!run || run.status === 'succeeded' || run.status === 'failed' || run.status === 'skipped') return 'stop';
  const state = run.state as unknown as RunState;
  if (run.status === 'waiting' && state.resumeAt && new Date(state.resumeAt).getTime() > Date.now()) return 'stop'; // задача пришла раньше срока

  const [flow] = await db.select().from(flows).where(eq(flows.id, run.flowId)).limit(1);
  const [ver] = await db.select().from(flowVersions).where(and(eq(flowVersions.flowId, run.flowId), eq(flowVersions.version, run.version))).limit(1);
  const via: EventVia = { runId: run.id, flowId: run.flowId, chain: run.chain };

  const finish = async (status: 'succeeded' | 'failed' | 'skipped', error: string | null) => {
    await db.update(flowRuns).set({ status, error, state: state as never, finishedAt: new Date(), startedAt: run.startedAt ?? new Date() }).where(eq(flowRuns.id, run.id));
    await recordEvent(db, { workspaceId: ws, type: 'flow_run.finished', entity: 'flow_run', recordId: run.id, actorId: null, payload: { flowId: run.flowId, status } });
    return 'stop' as const;
  };
  if (!flow || !ver) return finish('failed', 'The flow or its published version no longer exists');
  if (run.triggerKind !== 'manual' && !flow.enabled) return finish('skipped', 'The flow is disabled');
  const graph = ver.graph;

  // Старт: курсор — триггер
  if (run.status === 'queued') {
    const trig = triggerNodeOf(graph);
    if (!trig) return finish('failed', 'The flow has no trigger');
    state.queue = [trig.id];
    state.steps = {};
    state.stepCount = 0;
    state.seq = 0;
    await db.update(flowRuns).set({ status: 'running', startedAt: new Date() }).where(eq(flowRuns.id, run.id));
  } else if (run.status === 'waiting') {
    await db.update(flowRuns).set({ status: 'running' }).where(eq(flowRuns.id, run.id));
  }

  // Ручной запуск и расписание: запись для контекста подгружается при первом шаге
  let trigger = run.trigger as unknown as TriggerContext & { enriched?: boolean };
  if (!trigger.enriched && trigger.kind !== 'event') {
    if (trigger.entity && trigger.recordId) {
      const record = await loadRecord(db, ws, trigger.entity, trigger.recordId);
      if (!record) return finish('failed', `Record ${trigger.recordId} (${trigger.entity}) not found`);
      trigger = { ...trigger, record, ...(trigger.entity === 'task' ? { project: (await loadProjectOf(db, ws, record)) ?? undefined } : {}) };
    }
    trigger.enriched = true;
    await db.update(flowRuns).set({ trigger: trigger as never }).where(eq(flowRuns.id, run.id));
  }

  const save = () => db.update(flowRuns).set({ state: state as never }).where(eq(flowRuns.id, run.id));
  const nodeId = state.queue[0];
  if (!nodeId) return finish('succeeded', null);
  const node = graph.nodes.find(n => n.id === nodeId);
  const def = node && getNodeDef(node.type);
  if (!node || !def) return finish('failed', `Unknown node "${nodeId}" in the published graph`);

  // Возобновление после задержки: узел уже выполнен, идём по связям дальше
  if (state.delayDone === node.id) {
    if (state.stepId) await db.update(flowRunSteps).set({ status: 'succeeded', finishedAt: new Date() }).where(eq(flowRunSteps.id, state.stepId));
    state.queue.shift();
    state.queue.push(...successors(graph, node.id, 'out'));
    delete state.delayDone;
    delete state.stepId;
    delete state.resumeAt;
    delete state.attempt;
    if (!state.queue.length) return finish('succeeded', null);
    await save();
    return 'continue';
  }

  if (state.stepCount >= flowEngine.maxSteps) return finish('failed', `Step limit exceeded (${flowEngine.maxSteps} steps per run)`);

  const ctx: FlowContext = { trigger, steps: state.steps, flow: { id: flow.id, name: flow.name }, run: { id: run.id }, now: new Date().toISOString() };
  const input = resolveTemplates(node.params, ctx) as Record<string, unknown>;
  const attempt = state.attempt ?? 1;
  const loggedInput = clip(redact(input) as Record<string, unknown>);

  // Строка журнала: новая или та же при повторе
  let stepId = state.stepId;
  if (stepId && attempt > 1) {
    await db.update(flowRunSteps).set({ status: 'running', attempt, input: loggedInput as never, error: null, finishedAt: null }).where(eq(flowRunSteps.id, stepId));
  } else {
    state.stepCount += 1;
    state.seq += 1;
    const [row] = await db
      .insert(flowRunSteps)
      .values({ workspaceId: ws, runId: run.id, seq: state.seq, nodeId: node.id, nodeType: node.type, status: 'running', attempt, input: loggedInput as never })
      .returning({ id: flowRunSteps.id });
    stepId = row!.id;
    state.stepId = stepId;
  }

  const failStep = async (message: string) => {
    await db.update(flowRunSteps).set({ status: 'failed', error: message, finishedAt: new Date() }).where(eq(flowRunSteps.id, stepId!));
    return finish('failed', `${def.label}: ${message}`);
  };

  const parsed = def.params.safeParse(input);
  if (!parsed.success) return failStep(`Invalid parameters — ${parsed.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join('.') || 'params'}: ${i.message}`).join('; ')}`);

  const rt = makeRuntime({ db, workspaceId: ws, nodeId: node.id, ctx, via, author: flow.createdBy, http: flowEngine.http, httpImpl: flowEngine.httpImpl });
  await tx.unsafe('savepoint flow_step');
  let result: Awaited<ReturnType<typeof def.execute>>;
  try {
    result = await def.execute(parsed.data, rt);
    await tx.unsafe('release savepoint flow_step');
  } catch (e) {
    await tx.unsafe('rollback to savepoint flow_step'); // действия неудавшегося шага не остаются
    const message = errText(e);
    if (e instanceof TransientError && attempt < flowEngine.maxAttempts) {
      const resumeAt = new Date(Date.now() + flowEngine.retryBaseSec * 2 ** (attempt - 1) * 1000);
      await db.update(flowRunSteps).set({ status: 'retrying', error: message, finishedAt: new Date() }).where(eq(flowRunSteps.id, stepId));
      state.attempt = attempt + 1;
      state.resumeAt = resumeAt.toISOString();
      await db.update(flowRuns).set({ status: 'waiting', state: state as never }).where(eq(flowRuns.id, run.id));
      await enqueueRun(db, ws, run.id, resumeAt);
      await recordEvent(db, { workspaceId: ws, type: 'flow_run.updated', entity: 'flow_run', recordId: run.id, actorId: null, payload: { flowId: run.flowId, status: 'waiting' } });
      return 'stop';
    }
    return failStep(e instanceof TransientError ? `${message} (gave up after ${attempt} attempts)` : message);
  }

  const output = clip(result.output ?? {}) as Record<string, unknown>;
  state.steps[node.id] = output;

  if (result.delayMs) {
    const resumeAt = new Date(Date.now() + result.delayMs);
    await db.update(flowRunSteps).set({ status: 'waiting', output: { ...output, resumeAt: resumeAt.toISOString() } as never }).where(eq(flowRunSteps.id, stepId));
    state.delayDone = node.id;
    state.resumeAt = resumeAt.toISOString();
    await db.update(flowRuns).set({ status: 'waiting', state: state as never }).where(eq(flowRuns.id, run.id));
    await enqueueRun(db, ws, run.id, resumeAt);
    await recordEvent(db, { workspaceId: ws, type: 'flow_run.updated', entity: 'flow_run', recordId: run.id, actorId: null, payload: { flowId: run.flowId, status: 'waiting' } });
    return 'stop';
  }

  await db.update(flowRunSteps).set({ status: 'succeeded', output: output as never, finishedAt: new Date() }).where(eq(flowRunSteps.id, stepId));
  state.queue.shift();
  state.queue.push(...successors(graph, node.id, result.next ?? 'out'));
  delete state.stepId;
  delete state.attempt;
  delete state.resumeAt;
  if (!state.queue.length) return finish('succeeded', null);
  await save();
  return 'continue';
}
