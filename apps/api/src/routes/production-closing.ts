/* Закрытие периода и прочие затраты (этап 6 «УНФ: Производство»).

   Закрытие — фоновая задача воркера `production.close_period`: косвенные затраты месяца распределяются на выпуски
   по базе статьи, себестоимость цепочки пересчитывается, результат пишется в `production_cost_closings`.
   Закрывает admin и выше, отменяет закрытие (и сдвигает дату запрета назад) только owner.
   Суммы закрытия видят admin и owner. Правила — packages/db/src/cost-closing.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  canSeeCost,
  createOtherCosts,
  deleteDocument,
  documents,
  jobs,
  listClosings,
  listOtherCosts,
  loadPeriodLock,
  otherCostsDetail,
  postDocument,
  previewPeriod,
  productionCostClosings,
  unpostDocument,
  updateOtherCosts,
  workspaces,
} from '@gr8r/db';
import { monthKey, monthLabel, monthPeriod, monthRange, otherCostsCreate, otherCostsQuery, otherCostsUpdate, periodCloseInput, periodSettingsInput } from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { AppError } from '../errors';
import { hasRole, requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const close = requireRole('admin');
const ownerOnly = requireRole('owner');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

const monthParam = z.object({ month: monthKey });

/** Результат закрытия с замаскированными суммами: member видит состав, но не суммы */
function maskedTotals(ctx: Ctx, totals: Record<string, unknown>) {
  if (canSeeCost(ctx.role)) return totals;
  return {
    ...totals,
    byCostItem: ((totals.byCostItem ?? []) as Record<string, unknown>[]).map(g => ({ ...g, amount: null, distributed: null })),
    byRelease: ((totals.byRelease ?? []) as Record<string, unknown>[]).map(r => ({ ...r, directCost: null, allocated: null })),
    undistributed: null,
    total: null,
  };
}

/** Месяцы режима «за период»: от указанного до конечного (в порядке закрытия) */
const monthsOf = (month: string, through?: string) => (through && through > month ? monthRange(month, through) : [month]);

/** Строка закрытия месяца отмечается как «выполняется»: экран показывает статус, пока воркер не закончил */
async function markClosing(ctx: Ctx, month: string, status: 'running' = 'running'): Promise<void> {
  const { start } = monthPeriod(month);
  await ctx.db
    .insert(productionCostClosings)
    .values({ workspaceId: ctx.workspaceId, period: start, status, totals: {}, runAt: new Date() })
    .onConflictDoUpdate({ target: [productionCostClosings.workspaceId, productionCostClosings.period], set: { status, updatedAt: new Date() } });
}

export const productionClosingRoutes = new Hono<AppEnv>()
  /* ---------------- закрытие периода ---------------- */
  // журнал закрытых месяцев, дата запрета и настройка её переноса
  .get('/periods', async c => {
    const ctx = ctxOf(c);
    const closings = await listClosings(ctx.db, ctx.workspaceId);
    const lock = await loadPeriodLock(ctx.db, ctx.workspaceId);
    const items = closings.map(r => ({ ...r, month: r.period.slice(0, 7), label: monthLabel(r.period.slice(0, 7)), totals: maskedTotals(ctx, r.totals) }));
    return c.json({ items, closedThrough: lock.closedThrough, closeMovesLock: lock.closeMovesLock });
  })
  // предварительный анализ месяца: косвенные затраты, выпуски и проблемы (отрицательные остатки, непроведённые документы)
  .get('/periods/:month/preview', zValidator('param', monthParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { month } = c.req.valid('param');
    const preview = await previewPeriod(ctx.db, ctx.workspaceId, month);
    if (canSeeCost(ctx.role)) return c.json(preview);
    return c.json({ ...preview, costs: preview.costs.map(c => ({ ...c, amount: null })), targets: preview.targets.map(t => ({ ...t, directCost: null })), total: null });
  })
  // закрыть месяц или период «за период»: ставится задача воркера, месяцы выполняются последовательно
  .post('/periods/:month/close', close, zValidator('param', monthParam, validationHook), zValidator('json', periodCloseInput, validationHook), async c => {
    const ctx = ctxOf(c);
    const { month } = c.req.valid('param');
    // более поздние закрытые месяцы считались от прежней себестоимости этого месяца — их перезакрываем следом, по порядку
    const requested = c.req.valid('json').through ?? month;
    const [latest] = await ctx.db
      .select({ period: productionCostClosings.period })
      .from(productionCostClosings)
      .where(and(eq(productionCostClosings.workspaceId, ctx.workspaceId), gt(productionCostClosings.period, monthPeriod(requested).start), eq(productionCostClosings.status, 'done')))
      .orderBy(desc(productionCostClosings.period))
      .limit(1);
    const months = monthsOf(month, latest ? latest.period.slice(0, 7) : requested);
    for (const m of months) await markClosing(ctx, m);
    await ctx.db.insert(jobs).values({ workspaceId: ctx.workspaceId, queue: 'production', type: 'production.close_period', payload: { month: months[0]!, through: months[months.length - 1] } });
    return c.json({ months, queued: true }, 202);
  })
  // отмена закрытия — в обратном порядке; открывает только owner
  .post('/periods/:month/reopen', ownerOnly, zValidator('param', monthParam, validationHook), zValidator('json', periodCloseInput, validationHook), async c => {
    const ctx = ctxOf(c);
    const { month } = c.req.valid('param');
    const months = monthsOf(month, c.req.valid('json').through);
    // отмена идёт от последнего закрытого месяца: более поздний закрытый месяц считался от этого распределения
    const [later] = await ctx.db
      .select({ period: productionCostClosings.period })
      .from(productionCostClosings)
      .where(and(eq(productionCostClosings.workspaceId, ctx.workspaceId), gt(productionCostClosings.period, monthPeriod(months[months.length - 1]!).start), eq(productionCostClosings.status, 'done')))
      .limit(1);
    if (later) throw new AppError(422, 'later_month_closed', `Reopen ${later.period.slice(0, 7)} first: a later month is closed`);
    for (const m of months) await markClosing(ctx, m);
    await ctx.db.insert(jobs).values({ workspaceId: ctx.workspaceId, queue: 'production', type: 'production.close_period', payload: { month: months[0]!, through: months[months.length - 1], reopen: true } });
    return c.json({ months, queued: true }, 202);
  })
  // дата запрета и настройка «переносить дату запрета при закрытии»: вперёд — admin и выше, назад — только owner
  .patch('/periods/settings', close, zValidator('json', periodSettingsInput, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const lock = await loadPeriodLock(ctx.db, ctx.workspaceId);
    /** Месяцы, закрытия которых сняты сдвигом даты запрета назад */
    let reopened: string[] = [];
    if (body.closedThrough !== undefined) {
      // вперёд (позже месяц) сдвигает admin и выше, назад или снятие даты (null) — только owner: открытый месяц пересчитывает следующее закрытие
      const back = lock.closedThrough !== null && (body.closedThrough === null || body.closedThrough < lock.closedThrough);
      if (back && !hasRole(c, 'owner')) throw new AppError(403, 'owner_required', 'Only the owner can move the closed-through date back');
      await ctx.db.update(workspaces).set({ closedThrough: body.closedThrough, updatedAt: new Date() }).where(eq(workspaces.id, ctx.workspaceId));
      // открытие периода сбрасывает закрытия затронутых месяцев: месяц, который снова можно править хотя бы частично
      // (конец месяца позже новой даты), отменяется вместе со всеми поздними — от последнего к раннему, задачей воркера
      if (back) {
        const after = await ctx.db
          .select({ period: productionCostClosings.period })
          .from(productionCostClosings)
          .where(
            and(
              eq(productionCostClosings.workspaceId, ctx.workspaceId),
              eq(productionCostClosings.status, 'done'),
              body.closedThrough === null ? undefined : sql`(${productionCostClosings.period} + interval '1 month' - interval '1 day')::date > ${body.closedThrough}::date`,
            ),
          )
          .orderBy(asc(productionCostClosings.period));
        reopened = after.map(r => r.period.slice(0, 7));
        if (reopened.length) {
          for (const m of reopened) await markClosing(ctx, m);
          await ctx.db.insert(jobs).values({ workspaceId: ctx.workspaceId, queue: 'production', type: 'production.close_period', payload: { month: reopened[0]!, through: reopened[reopened.length - 1], reopen: true } });
        }
      }
    }
    if (body.closeMovesLock !== undefined) await ctx.db.update(workspaces).set({ closeMovesLock: body.closeMovesLock, updatedAt: new Date() }).where(eq(workspaces.id, ctx.workspaceId));
    return c.json({ ...(await loadPeriodLock(ctx.db, ctx.workspaceId)), reopened });
  });

/* ---------------- прочие затраты ---------------- */
export const otherCostsRoutes = new Hono<AppEnv>()
  // журнал прочих затрат
  .get('/', zValidator('query', otherCostsQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const res = await listOtherCosts(ctx.db, ctx.workspaceId, c.req.valid('query'));
    return c.json({ ...res, amount: canSeeCost(ctx.role) ? res.amount : null });
  })
  // карточка документа со строками
  .get('/:id', async c => {
    const ctx = ctxOf(c);
    const detail = await otherCostsDetail(ctx.db, c.req.param('id'));
    if (!canSeeCost(ctx.role)) return c.json({ ...detail, lines: detail.lines.map(l => ({ ...l, amount: null })), total: null });
    return c.json(detail);
  })
  .post('/', write, zValidator('json', otherCostsCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createOtherCosts(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await otherCostsDetail(ctx.db, id), 201);
  })
  .patch('/:id', write, zValidator('json', otherCostsUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.param('id');
    await assertOtherCosts(ctx, id);
    await updateOtherCosts(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await otherCostsDetail(ctx.db, id));
  })
  .post('/:id/post', write, async c => {
    const ctx = ctxOf(c);
    await postDocument(ctx.db, docCtx(ctx), c.req.param('id'));
    return c.json(await otherCostsDetail(ctx.db, c.req.param('id')));
  })
  .post('/:id/unpost', write, async c => {
    const ctx = ctxOf(c);
    await unpostDocument(ctx.db, docCtx(ctx), c.req.param('id'));
    return c.json(await otherCostsDetail(ctx.db, c.req.param('id')));
  })
  .delete('/:id', write, async c => {
    const ctx = ctxOf(c);
    const id = c.req.param('id');
    await assertOtherCosts(ctx, id);
    await deleteDocument(ctx.db, docCtx(ctx), id);
    return c.json({ ok: true });
  });

/** Это должен быть документ «Прочие затраты» */
async function assertOtherCosts(ctx: Ctx, id: string): Promise<void> {
  const [doc] = await ctx.db.select({ id: documents.id, type: documents.type }).from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc || doc.type !== 'other_costs') throw new AppError(404, 'not_found', 'Other costs document not found');
}