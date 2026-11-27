/* Дополнительные расходы в себестоимость (задача 1385): журнал, карточка, распределение по строкам оснований,
   проведение и отмена проведения, отчёт за период.

   Документ — запись `documents` типа `landed_cost`, поэтому проведение идёт общим кодом документов
   (проверки периода, номера, события), а себестоимость меняет хук типа (packages/db/src/landed-costs.ts).
   Суммы видят admin и owner (canSeeCost), остальным возвращаются без сумм. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { canSeeCost, createLandedCost, deleteLandedCost, landedCostBaseLines, landedCostBases, landedCostDetail, landedCostReport, listLandedCosts, postDocument, unpostDocument, updateLandedCost } from '@erp/db';
import { landedCostBasesQuery, landedCostCreate, landedCostQuery, landedCostReportQuery, landedCostUpdate, uuid } from '@erp/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });
const cost = (ctx: Ctx) => canSeeCost(ctx.role);

type Detail = Awaited<ReturnType<typeof landedCostDetail>>;

/** Суммы без права на себестоимость: состав, количества и веса остаются, деньги — null */
function maskDetail(ctx: Ctx, detail: Detail) {
  if (cost(ctx)) return detail;
  return {
    ...detail,
    total: null as string | null,
    lines: detail.lines.map(l => ({ ...l, amount: null as string | null, baseAmount: null as string | null, sharePct: null as string | null })),
  };
}

const baseLinesQuery = z.object({ documentId: uuid });

export const landedCostRoutes = new Hono<AppEnv>()
  // основания для выбора в форме: проведённые поступления и выпуски за период
  .get('/bases', zValidator('query', landedCostBasesQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const res = await landedCostBases(ctx.db, ctx.workspaceId, c.req.valid('query'));
    const items = cost(ctx) ? res.items : res.items.map(i => ({ ...i, total: null, landedAmount: null }));
    return c.json({ items });
  })
  // приходные строки основания: товар, количество, стоимость строки и вес
  .get('/bases/lines', zValidator('query', baseLinesQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const res = await landedCostBaseLines(ctx.db, ctx.workspaceId, c.req.valid('query').documentId);
    const lines = cost(ctx) ? res.lines : res.lines.map(l => ({ ...l, baseAmount: null }));
    return c.json({ ...res, lines });
  })
  // отчёт за период: документы, статьи, основания и товары
  .get('/report', zValidator('query', landedCostReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const { from, to } = c.req.valid('query');
    const report = await landedCostReport(ctx.db, ctx.workspaceId, from, to);
    const money = (v: string) => (cost(ctx) ? v : null);
    return c.json({
      ...report,
      documents: report.documents.map(d => ({ ...d, total: money(d.total) })),
      byCostItem: report.byCostItem.map(g => ({ ...g, amount: money(g.amount) })),
      byBase: report.byBase.map(g => ({ ...g, amount: money(g.amount) })),
      byProduct: report.byProduct.map(g => ({ ...g, amount: money(g.amount) })),
      total: money(report.total),
      postedTotal: money(report.postedTotal),
      costVisible: cost(ctx),
    });
  })
  // журнал
  .get('/', zValidator('query', landedCostQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const res = await listLandedCosts(ctx.db, ctx.workspaceId, c.req.valid('query'));
    if (cost(ctx)) return c.json({ ...res, costVisible: true });
    return c.json({ ...res, items: res.items.map(i => ({ ...i, total: null })), amount: null, costVisible: false });
  })
  // карточка со строками распределения
  .get('/:id', async c => {
    const ctx = ctxOf(c);
    return c.json(maskDetail(ctx, await landedCostDetail(ctx.db, ctx.workspaceId, c.req.param('id'))));
  })
  .post('/', write, zValidator('json', landedCostCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createLandedCost(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(maskDetail(ctx, await landedCostDetail(ctx.db, ctx.workspaceId, id)), 201);
  })
  .patch('/:id', write, zValidator('json', landedCostUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.param('id');
    await updateLandedCost(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(maskDetail(ctx, await landedCostDetail(ctx.db, ctx.workspaceId, id)));
  })
  // проведение: распределение пересчитывается по актуальным основаниям, цепочка себестоимости — хуком типа
  .post('/:id/post', write, async c => {
    const ctx = ctxOf(c);
    const id = c.req.param('id');
    await postDocument(ctx.db, docCtx(ctx), id);
    return c.json(maskDetail(ctx, await landedCostDetail(ctx.db, ctx.workspaceId, id)));
  })
  .post('/:id/unpost', write, async c => {
    const ctx = ctxOf(c);
    const id = c.req.param('id');
    await unpostDocument(ctx.db, docCtx(ctx), id);
    return c.json(maskDetail(ctx, await landedCostDetail(ctx.db, ctx.workspaceId, id)));
  })
  .delete('/:id', write, async c => {
    const ctx = ctxOf(c);
    await deleteLandedCost(ctx.db, docCtx(ctx), c.req.param('id'));
    return c.json({ ok: true });
  });
