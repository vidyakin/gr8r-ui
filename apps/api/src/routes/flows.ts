/* Автоматизации: flow (черновик + опубликованные версии), включение, ручной запуск и журнал запусков.
   Чтение — любой участник, изменение и запуск — admin и выше (flow выполняет действия и HTTP-запросы от имени воркспейса).
   Сами запуски выполняет воркер (apps/worker/src/flows): здесь только ставятся в очередь. */
import { zValidator } from '@hono/zod-validator';
import { and, asc, count, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createRun, flowRunSteps, flowRuns, flowVersions, flows, recordEvent } from '@gr8r/db';
import { flowCreate, flowPublish, flowQuery, flowRunQuery, flowRunStart, flowUpdate, idParam, triggerNodeOf, validateGraph, type FlowGraph } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { AppError, notFound } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => '\\' + m);

type FlowRow = typeof flows.$inferSelect;
const sameGraph = (a: FlowGraph, b: FlowGraph | null | undefined) => !!b && JSON.stringify(a) === JSON.stringify(b);

/** Краткое описание триггера для списка: тип и сущность/расписание */
function triggerSummary(graph: FlowGraph) {
  const t = triggerNodeOf(graph);
  return t ? { type: t.type, params: t.params } : null;
}

export const flowRoutes = new Hono<AppEnv>()
  // ---- список: без графов, но с последним запуском и числом ошибок за неделю ----
  .get('/', zValidator('query', flowQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const where = q.q ? ilike(flows.name, `%${escapeLike(q.q)}%`) : undefined;
    const rows = await ctx.db
      .select({ flow: flows, published: flowVersions.graph })
      .from(flows)
      .leftJoin(flowVersions, and(eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.publishedVersion)))
      .where(where)
      .orderBy(desc(flows.createdAt), desc(flows.id))
      .limit(q.limit)
      .offset(q.offset);
    const [{ n }] = await ctx.db.select({ n: count() }).from(flows).where(where);
    const ids = rows.map(r => r.flow.id);
    const last = ids.length
      ? await ctx.db
          .selectDistinctOn([flowRuns.flowId], { flowId: flowRuns.flowId, id: flowRuns.id, status: flowRuns.status, error: flowRuns.error, createdAt: flowRuns.createdAt, finishedAt: flowRuns.finishedAt })
          .from(flowRuns)
          .where(inArray(flowRuns.flowId, ids))
          .orderBy(flowRuns.flowId, desc(flowRuns.createdAt), desc(flowRuns.id))
      : [];
    const failed = ids.length
      ? await ctx.db
          .select({ flowId: flowRuns.flowId, n: count() })
          .from(flowRuns)
          .where(and(inArray(flowRuns.flowId, ids), eq(flowRuns.status, 'failed'), sql`${flowRuns.createdAt} > now() - interval '7 days'`))
          .groupBy(flowRuns.flowId)
      : [];
    const items = rows.map(({ flow, published }) => {
      const { graph, ...rest } = flow;
      return {
        ...rest,
        nodeCount: graph.nodes.length,
        trigger: triggerSummary(graph),
        hasDraftChanges: !sameGraph(graph, published),
        lastRun: last.find(l => l.flowId === flow.id) ?? null,
        failedRuns7d: failed.find(f => f.flowId === flow.id)?.n ?? 0,
      };
    });
    return c.json({ items, total: n, limit: q.limit, offset: q.offset });
  })
  // ---- один flow: черновик и опубликованный граф ----
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const [row] = await ctx.db
      .select({ flow: flows, published: flowVersions.graph })
      .from(flows)
      .leftJoin(flowVersions, and(eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.publishedVersion)))
      .where(eq(flows.id, id))
      .limit(1);
    if (!row) throw notFound('flow');
    return c.json({ ...row.flow, publishedGraph: row.published ?? null, hasDraftChanges: !sameGraph(row.flow.graph, row.published) });
  })
  .post('/', admin, zValidator('json', flowCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const [row] = await ctx.db.insert(flows).values({ workspaceId: ctx.workspaceId, name: body.name, description: body.description, graph: body.graph, createdBy: ctx.memberId }).returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'flow.created', entity: 'flow', recordId: row!.id, actorId: ctx.memberId, payload: { name: row!.name } });
    return c.json({ ...row!, publishedGraph: null, hasDraftChanges: true }, 201);
  })
  .patch('/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', flowUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await ctx.db.select().from(flows).where(eq(flows.id, id)).limit(1).for('update');
    if (!existing) throw notFound('flow');
    if (body.enabled === true && existing.publishedVersion === null) throw new AppError(409, 'not_published', 'Publish the flow before enabling it');
    const patch: Partial<FlowRow> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.graph !== undefined) patch.graph = body.graph;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    const [row] = await ctx.db.update(flows).set(patch).where(eq(flows.id, id)).returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'flow.updated', entity: 'flow', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(body).filter(k => k !== 'graph').concat(body.graph ? ['graph'] : []) } });
    const [pub] = row!.publishedVersion === null ? [] : await ctx.db.select({ graph: flowVersions.graph }).from(flowVersions).where(and(eq(flowVersions.flowId, id), eq(flowVersions.version, row!.publishedVersion))).limit(1);
    return c.json({ ...row!, publishedGraph: pub?.graph ?? null, hasDraftChanges: !sameGraph(row!.graph, pub?.graph) });
  })
  .delete('/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const [row] = await ctx.db.delete(flows).where(eq(flows.id, id)).returning({ id: flows.id });
    if (!row) throw notFound('flow');
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'flow.deleted', entity: 'flow', recordId: id, actorId: ctx.memberId, payload: {} });
    return c.json({ id, deleted: true as const });
  })
  // ---- публикация: черновик проверяется целиком и становится новой неизменяемой версией ----
  .post('/:id/publish', admin, zValidator('param', idParam, validationHook), zValidator('json', flowPublish, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await ctx.db.select().from(flows).where(eq(flows.id, id)).limit(1).for('update');
    if (!existing) throw notFound('flow');
    const issues = validateGraph(existing.graph);
    if (issues.length) throw new AppError(422, 'invalid_graph', `The flow cannot be published: ${issues[0]!.message}`, { issues });
    const version = existing.versionCounter + 1;
    const trig = triggerNodeOf(existing.graph)!;
    await ctx.db.insert(flowVersions).values({ workspaceId: ctx.workspaceId, flowId: id, version, graph: existing.graph, triggerType: trig.type, publishedBy: ctx.memberId });
    const [row] = await ctx.db
      .update(flows)
      .set({ versionCounter: version, publishedVersion: version, publishedAt: new Date(), updatedAt: new Date(), ...(body.enable !== undefined ? { enabled: body.enable } : {}) })
      .where(eq(flows.id, id))
      .returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'flow.published', entity: 'flow', recordId: id, actorId: ctx.memberId, payload: { version } });
    return c.json({ ...row!, publishedGraph: existing.graph, hasDraftChanges: false });
  })
  // ---- ручной запуск опубликованной версии (включённость не требуется) ----
  .post('/:id/run', admin, zValidator('param', idParam, validationHook), zValidator('json', flowRunStart, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [flow] = await ctx.db.select().from(flows).where(eq(flows.id, id)).limit(1);
    if (!flow) throw notFound('flow');
    if (flow.publishedVersion === null) throw new AppError(409, 'not_published', 'Publish the flow before running it');
    if (!!body.entity !== !!body.recordId) throw new AppError(400, 'validation_error', 'Pass both "entity" and "recordId", or neither');
    const trigger = { kind: 'manual', ...(body.entity ? { entity: body.entity, recordId: body.recordId } : {}), actorId: ctx.memberId, firedAt: new Date().toISOString() };
    const runId = await createRun(ctx.db, { workspaceId: ctx.workspaceId, flowId: id, version: flow.publishedVersion, triggerKind: 'manual', trigger, chain: [id], startedBy: ctx.memberId });
    return c.json({ runId: runId! }, 201);
  });

/* ---------------- журнал запусков ---------------- */

export const flowRunRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', flowRunQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const where = and(q.flowId ? eq(flowRuns.flowId, q.flowId) : undefined, q.status ? eq(flowRuns.status, q.status) : undefined, q.failed ? eq(flowRuns.status, 'failed') : undefined);
    const rows = await ctx.db
      .select({
        id: flowRuns.id,
        flowId: flowRuns.flowId,
        flowName: flows.name,
        version: flowRuns.version,
        status: flowRuns.status,
        triggerKind: flowRuns.triggerKind,
        error: flowRuns.error,
        createdAt: flowRuns.createdAt,
        startedAt: flowRuns.startedAt,
        finishedAt: flowRuns.finishedAt,
        stepCount: sql<number>`(select count(*)::int from flow_run_steps s where s.run_id = ${flowRuns.id})`,
      })
      .from(flowRuns)
      .innerJoin(flows, eq(flows.id, flowRuns.flowId))
      .where(where)
      .orderBy(desc(flowRuns.createdAt), desc(flowRuns.id))
      .limit(q.limit)
      .offset(q.offset);
    const [{ n }] = await ctx.db.select({ n: count() }).from(flowRuns).where(where);
    return c.json({ items: rows, total: n, limit: q.limit, offset: q.offset });
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const [run] = await ctx.db
      .select({ run: flowRuns, flowName: flows.name })
      .from(flowRuns)
      .innerJoin(flows, eq(flows.id, flowRuns.flowId))
      .where(eq(flowRuns.id, id))
      .limit(1);
    if (!run) throw notFound('flow run');
    const steps = await ctx.db.select().from(flowRunSteps).where(eq(flowRunSteps.runId, id)).orderBy(asc(flowRunSteps.seq));
    const { state: _state, ...rest } = run.run;
    return c.json({ ...rest, flowName: run.flowName, steps });
  });
