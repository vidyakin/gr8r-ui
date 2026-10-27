/* Планирование продаж (задача 1133): /sales-plan. Читает любой участник, правят admin и owner.
   /scenarios — справочник «Сценарии планирования»; /plans — документ «План продаж» (черновик, проведение, отмена проведения);
   /analysis — «План-фактный анализ продаж». Правила — packages/db/src/sales-plan.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createSalesPlan, deleteDocument, documents, listSalesPlans, postDocument, salesPlanAnalysis, salesPlanDetail, salesPlanScenarios, scenarioUsed, unpostDocument, updateSalesPlan } from '@gr8r/db';
import { idParam, salesPlanAnalysisQuery, salesPlanCreate, salesPlanListQuery, salesPlanScenarioCreate, salesPlanScenarioQuery, salesPlanScenarioUpdate, salesPlanUpdate } from '@gr8r/shared';
import { crud, ctxOf, validationHook, type Ctx } from '../crud';
import { AppError } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

const scenarioRoutes = crud({
  entity: 'sales_plan_scenario',
  table: salesPlanScenarios,
  create: salesPlanScenarioCreate,
  update: salesPlanScenarioUpdate,
  query: salesPlanScenarioQuery,
  sortable: { name: salesPlanScenarios.name, createdAt: salesPlanScenarios.createdAt },
  defaultSort: 'name',
  search: [salesPlanScenarios.name],
  writeRole: 'admin',
  prepareUpdate: async (ctx, existing, body) => {
    // периодичность и разрез сценария с документами менять нельзя: строки планов перестанут ему соответствовать
    const changed = (body.periodicity !== undefined && body.periodicity !== existing.periodicity) || (body.dimension !== undefined && body.dimension !== existing.dimension);
    if (changed && (await scenarioUsed(ctx.db, existing.id))) throw new AppError(409, 'scenario_in_use', 'The scenario is used by sales plans: its periodicity and dimension cannot change');
    return {};
  },
});

async function assertPlan(ctx: Ctx, id: string): Promise<void> {
  const [doc] = await ctx.db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, id), eq(documents.type, 'sales_plan'))).limit(1);
  if (!doc) throw new AppError(404, 'not_found', 'Sales plan not found');
}

export const salesPlanRoutes = new Hono<AppEnv>()
  .route('/scenarios', scenarioRoutes)
  .get('/plans', zValidator('query', salesPlanListQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await listSalesPlans(ctx.db, ctx.workspaceId, c.req.valid('query')));
  })
  .get('/plans/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await assertPlan(ctx, id);
    return c.json(await salesPlanDetail(ctx.db, id));
  })
  .post('/plans', admin, zValidator('json', salesPlanCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createSalesPlan(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await salesPlanDetail(ctx.db, id), 201);
  })
  .patch('/plans/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', salesPlanUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await assertPlan(ctx, id);
    await updateSalesPlan(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await salesPlanDetail(ctx.db, id));
  })
  .post('/plans/:id/post', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await assertPlan(ctx, id);
    await postDocument(ctx.db, docCtx(ctx), id);
    return c.json(await salesPlanDetail(ctx.db, id));
  })
  .post('/plans/:id/unpost', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await assertPlan(ctx, id);
    await unpostDocument(ctx.db, docCtx(ctx), id);
    return c.json(await salesPlanDetail(ctx.db, id));
  })
  .delete('/plans/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await assertPlan(ctx, id);
    await deleteDocument(ctx.db, docCtx(ctx), id);
    return c.json({ ok: true });
  })
  .get('/analysis', zValidator('query', salesPlanAnalysisQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await salesPlanAnalysis(ctx.db, ctx.workspaceId, c.req.valid('query')));
  });
