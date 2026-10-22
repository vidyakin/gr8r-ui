/* План производства: журнал планов, карточка с периодами в колонках, автозаполнение (по статистике выпуска и продаж,
   по заказам покупателей), полуфабрикаты кнопкой, потребности плана и рабочее место «Заказы по плану».
   Чтение — любой участник; план и заказы — member и выше. Правила — packages/db/src/production-plans.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  canSeeCost,
  createOrdersByPlan,
  createProductionPlan,
  deleteProductionPlan,
  fillProductionPlan,
  listProductionPlans,
  planOrdersWorkbench,
  planSemiFinished,
  productionPlanDetail,
  productionPlanNeeds,
  removePlanSemi,
  updateProductionPlan,
} from '@gr8r/db';
import { idParam, planWorkbenchQuery, productionPlanCreate, productionPlanFill, productionPlanOrders, productionPlanQuery, productionPlanSemi, productionPlanUpdate } from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

/** Потребности плана: трудозатраты видят admin и owner (maskCost на уровне canSeeCost) */
async function needs(ctx: Ctx, id: string) {
  const data = await productionPlanNeeds(ctx.db, id);
  return canSeeCost(ctx.role) ? data : { ...data, labor: data.labor.map(l => ({ ...l, amount: null })) };
}

export const productionPlanRoutes = new Hono<AppEnv>()
  // рабочее место «Заказы по плану»: утверждённые планы и строки с остатком (путь конкретный — раньше /:id)
  .get('/workbench', zValidator('query', planWorkbenchQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json({ items: await planOrdersWorkbench(ctx.db, { periodStart: q.periodStart, workCenterId: q.workCenterId, limit: q.limit }) });
  })
  .get('/', zValidator('query', productionPlanQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const list = await listProductionPlans(ctx.db, { status: q.status, from: q.from, to: q.to, warehouseId: q.warehouseId, workCenterId: q.workCenterId, q: q.q, limit: q.limit, offset: q.offset });
    return c.json({ ...list, limit: q.limit, offset: q.offset });
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => c.json(await productionPlanDetail(ctxOf(c).db, c.req.valid('param').id)))
  .post('/', write, zValidator('json', productionPlanCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await createProductionPlan(ctx.db, docCtx(ctx), {
      ...(body.id ? { id: body.id } : {}),
      name: body.name,
      periodFrom: body.periodFrom,
      periodTo: body.periodTo,
      step: body.step,
      status: body.status,
      warehouseId: body.warehouseId,
      workCenterId: body.workCenterId ?? null,
      comment: body.comment,
      lines: body.lines.map(l => ({ itemId: l.itemId, periodStart: l.periodStart, qty: l.qty, isSemi: l.isSemi })),
    });
    return c.json(await productionPlanDetail(ctx.db, id), 201);
  })
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', productionPlanUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await updateProductionPlan(ctx.db, docCtx(ctx), c.req.valid('param').id, {
      name: body.name,
      periodFrom: body.periodFrom,
      periodTo: body.periodTo,
      step: body.step,
      status: body.status,
      warehouseId: body.warehouseId,
      workCenterId: body.workCenterId,
      comment: body.comment,
      lines: body.lines?.map(l => ({ id: l.id, itemId: l.itemId, periodStart: l.periodStart, qty: l.qty, isSemi: l.isSemi })),
    });
    return c.json(await productionPlanDetail(ctx.db, c.req.valid('param').id));
  })
  .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteProductionPlan(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json({ id: c.req.valid('param').id, deleted: true as const });
  })
  // автозаполнение: по статистике выпуска, по статистике продаж или по заказам покупателей
  .post('/:id/fill', write, zValidator('param', idParam, validationHook), zValidator('json', productionPlanFill, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await fillProductionPlan(ctx.db, docCtx(ctx), c.req.valid('param').id, { source: body.source, mode: body.mode, periods: body.periods });
    return c.json(await productionPlanDetail(ctx.db, c.req.valid('param').id));
  })
  // полуфабрикаты кнопкой: строки пропорционально продукции со сдвигом на срок изготовления
  .post('/:id/semi', write, zValidator('param', idParam, validationHook), zValidator('json', productionPlanSemi, validationHook), async c => {
    const ctx = ctxOf(c);
    await planSemiFinished(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json').itemIds);
    return c.json(await productionPlanDetail(ctx.db, c.req.valid('param').id));
  })
  .post('/:id/semi/remove', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await removePlanSemi(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(await productionPlanDetail(ctx.db, c.req.valid('param').id));
  })
  // потребности плана: материалы, полуфабрикаты, часы участков против мощности, трудозатраты
  .get('/:id/needs', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await needs(ctx, c.req.valid('param').id));
  })
  // черновики заказов на производство по строкам плана: остаток «план − уже заказано»
  .post('/:id/orders', write, zValidator('param', idParam, validationHook), zValidator('json', productionPlanOrders, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const res = await createOrdersByPlan(ctx.db, docCtx(ctx), c.req.valid('param').id, { periodStart: body.periodStart ?? null, lineIds: body.lineIds, date: body.date, comment: body.comment });
    return c.json(res, 201);
  });