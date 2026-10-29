/* Воронки продаж (задача 1176, docs/architecture/pipelines.md): воронки, этапы, причины проигрыша, отчёт-воронка.
   Читают все участники, настраивают admin / owner. Логика с записью в БД — сервис `packages/db/src/pipelines.ts`. */
import { zValidator } from '@hono/zod-validator';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { assertPipelineValid, assertStageSetValid, createPipeline, dealFunnel, dealLostReasons, dealPipelines, dealStages, deals, defaultPipeline, recordEvent, stageDealCount, templateOf } from '@gr8r/db';
import {
  dealFunnelQuery,
  dealLostReasonCreate,
  dealLostReasonQuery,
  dealLostReasonReorder,
  dealLostReasonUpdate,
  dealPipelineCreate,
  dealPipelineQuery,
  dealPipelineReorder,
  dealPipelineUpdate,
  dealStageCreate,
  dealStageQuery,
  dealStageReorder,
  dealStageUpdate,
  idParam,
} from '@gr8r/shared';
import { crud, ctxOf, validationHook } from '../crud';
import { AppError, notFound } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');

/* ---------------- воронки ---------------- */

export const dealPipelineRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', dealPipelineQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const items = await ctx.db.select().from(dealPipelines).orderBy(asc(dealPipelines.sortOrder), asc(dealPipelines.createdAt));
    return c.json({ items, total: items.length, limit: items.length, offset: 0 });
  })
  .post('/', admin, zValidator('json', dealPipelineCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const stages = body.stages ?? templateOf(body.template).stages;
    if (body.stages) assertStageSetValid(body.stages);
    const made = await createPipeline(ctx.db, ctx.workspaceId, {
      name: body.name,
      stages: stages.map(s => ({ name: s.name, category: s.category ?? 'in_progress', color: s.color ?? 'gray', probability: s.probability ?? 0, slaDays: s.slaDays ?? undefined, requiredFields: 'requiredFields' in s ? s.requiredFields : undefined })),
    });
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'deal_pipeline.created', entity: 'deal_pipeline', recordId: made.pipeline.id, actorId: ctx.memberId, payload: {} });
    return c.json(made.pipeline, 201);
  })
  .post('/reorder', admin, zValidator('json', dealPipelineReorder, validationHook), async c => {
    const ctx = ctxOf(c);
    const { ids } = c.req.valid('json');
    for (const [i, id] of ids.entries()) await ctx.db.update(dealPipelines).set({ sortOrder: i, updatedAt: new Date() }).where(eq(dealPipelines.id, id));
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'deal_pipeline.updated', entity: 'deal_pipeline', recordId: null, actorId: ctx.memberId, payload: {} });
    return c.json({ ok: true as const });
  })
  .patch('/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', dealPipelineUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await ctx.db.select().from(dealPipelines).where(eq(dealPipelines.id, id)).limit(1).for('update');
    if (!existing) throw notFound('deal_pipeline');
    if (body.isDefault) await ctx.db.update(dealPipelines).set({ isDefault: false }).where(and(eq(dealPipelines.isDefault, true), ne(dealPipelines.id, id)));
    const [after] = await ctx.db
      .update(dealPipelines)
      .set({ ...(body.name !== undefined ? { name: body.name } : {}), ...(body.isDefault ? { isDefault: true } : {}), updatedAt: new Date() })
      .where(eq(dealPipelines.id, id))
      .returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'deal_pipeline.updated', entity: 'deal_pipeline', recordId: id, actorId: ctx.memberId, payload: {} });
    return c.json(after!);
  })
  .delete('/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const [existing] = await ctx.db.select().from(dealPipelines).where(eq(dealPipelines.id, id)).limit(1).for('update');
    if (!existing) throw notFound('deal_pipeline');
    if (existing.isDefault) throw new AppError(422, 'deal_pipeline_default', 'The default pipeline cannot be deleted');
    const [used] = await ctx.db.select({ n: count() }).from(deals).where(eq(deals.pipelineId, id));
    if ((used?.n ?? 0) > 0) throw new AppError(409, 'deal_pipeline_in_use', 'The pipeline is used by deals');
    await ctx.db.delete(dealPipelines).where(eq(dealPipelines.id, id));
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'deal_pipeline.deleted', entity: 'deal_pipeline', recordId: id, actorId: ctx.memberId, payload: {} });
    return c.json({ id, deleted: true as const });
  });

/* ---------------- этапы ---------------- */

const stageBase = crud({
  entity: 'deal_stage',
  table: dealStages,
  create: dealStageCreate,
  update: dealStageUpdate,
  query: dealStageQuery,
  sortable: { sortOrder: dealStages.sortOrder, name: dealStages.name },
  defaultSort: 'sortOrder',
  search: [dealStages.name],
  writeRole: 'admin',
  filters: q => [q.pipelineId ? eq(dealStages.pipelineId, q.pipelineId) : undefined],
  prepareCreate: async (ctx, body) => {
    const [p] = await ctx.db.select({ id: dealPipelines.id }).from(dealPipelines).where(eq(dealPipelines.id, body.pipelineId)).limit(1);
    if (!p) throw new AppError(422, 'pipeline_missing', 'Pipeline not found');
    if (body.sortOrder !== undefined) return {};
    const [r] = await ctx.db.select({ n: count() }).from(dealStages).where(eq(dealStages.pipelineId, body.pipelineId));
    return { sortOrder: r?.n ?? 0, slaDays: body.slaDays ?? null };
  },
  // инварианты воронки (один «выиграна», хотя бы один «проиграна») проверяются после записи — при нарушении транзакция откатывается
  afterCreate: (ctx, row) => assertPipelineValid(ctx.db, row.pipelineId),
  prepareUpdate: (_ctx, _existing, body) => (body.slaDays === undefined ? {} : { slaDays: body.slaDays ?? null }),
  afterUpdate: (ctx, _before, after) => assertPipelineValid(ctx.db, after.pipelineId),
  beforeDelete: async (ctx, row) => {
    if ((await stageDealCount(ctx.db, row.id)) > 0) throw new AppError(409, 'deal_stage_in_use', 'The stage is used by deals');
    const rest = await ctx.db.select({ category: dealStages.category }).from(dealStages).where(and(eq(dealStages.pipelineId, row.pipelineId), ne(dealStages.id, row.id)));
    assertStageSetValid(rest);
  },
});

export const dealStageRoutes = new Hono<AppEnv>()
  .post('/reorder', admin, zValidator('json', dealStageReorder, validationHook), async c => {
    const ctx = ctxOf(c);
    const { pipelineId, ids } = c.req.valid('json');
    for (const [i, id] of ids.entries()) await ctx.db.update(dealStages).set({ sortOrder: i, updatedAt: new Date() }).where(and(eq(dealStages.id, id), eq(dealStages.pipelineId, pipelineId)));
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'deal_stage.updated', entity: 'deal_stage', recordId: null, actorId: ctx.memberId, payload: {} });
    return c.json({ ok: true as const });
  })
  .route('/', stageBase);

/* ---------------- причины проигрыша ---------------- */

const reasonBase = crud({
  entity: 'deal_lost_reason',
  table: dealLostReasons,
  create: dealLostReasonCreate,
  update: dealLostReasonUpdate,
  query: dealLostReasonQuery,
  sortable: { sortOrder: dealLostReasons.sortOrder, name: dealLostReasons.name },
  defaultSort: 'sortOrder',
  search: [dealLostReasons.name],
  writeRole: 'admin',
  prepareCreate: async (ctx, body) => {
    if (body.sortOrder !== undefined) return {};
    const [r] = await ctx.db.select({ n: count() }).from(dealLostReasons);
    return { sortOrder: r?.n ?? 0 };
  },
  beforeDelete: async (ctx, row) => {
    const [used] = await ctx.db.select({ n: count() }).from(deals).where(eq(deals.lostReasonId, row.id));
    if ((used?.n ?? 0) > 0) throw new AppError(409, 'deal_lost_reason_in_use', 'The lost reason is used by deals');
  },
});

export const dealLostReasonRoutes = new Hono<AppEnv>()
  .post('/reorder', admin, zValidator('json', dealLostReasonReorder, validationHook), async c => {
    const ctx = ctxOf(c);
    const { ids } = c.req.valid('json');
    for (const [i, id] of ids.entries()) await ctx.db.update(dealLostReasons).set({ sortOrder: i, updatedAt: new Date() }).where(eq(dealLostReasons.id, id));
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'deal_lost_reason.updated', entity: 'deal_lost_reason', recordId: null, actorId: ctx.memberId, payload: {} });
    return c.json({ ok: true as const });
  })
  .route('/', reasonBase);

/* ---------------- отчёт-воронка ---------------- */

export const dealFunnelRoutes = new Hono<AppEnv>().get('/', zValidator('query', dealFunnelQuery, validationHook), async c => {
  const ctx = ctxOf(c);
  const q = c.req.valid('query');
  const pipelineId = q.pipelineId ?? (await defaultPipeline(ctx.db)).id;
  return c.json(await dealFunnel(ctx.db, { pipelineId, from: q.from, to: q.to }));
});
