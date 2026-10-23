/* Калькуляция заказа покупателя: плановая себестоимость изделий по спецификациям с параметрами, разовые расходы,
   источник цены себестоимости и наценка. Чтение — любой участник (суммы без права видеть себестоимость скрыты),
   пересчёт и применение цены — только admin и owner. Правила — packages/db/src/calculations.ts. */
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { applyCalculationPrices, canSeeCost, orderCalculationLines, orderCalculations, recalculateOrderCalculation, setCalculationExtra } from '@gr8r/db';
import { calculationApply, calculationCreate, calculationLinesUpdate, calculationPatch, idParam } from '@gr8r/shared';
import { z } from 'zod';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { AppError, notFound } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

/** Пересчёт и применение цены видны только тем, кому видна себестоимость */
const cost = requireRole('admin');

/** Калькуляция заказа: итоги и строки (суммы скрыты, если нет права видеть себестоимость) */
async function calculationView(ctx: Ctx, documentId: string) {
  const [calc] = await ctx.db.select().from(orderCalculations).where(eq(orderCalculations.documentId, documentId)).limit(1);
  if (!calc) return null;
  const lines = await ctx.db.select().from(orderCalculationLines).where(eq(orderCalculationLines.calculationId, calc.id)).orderBy(asc(orderCalculationLines.sortOrder));
  const see = canSeeCost(ctx.role);
  return {
    ...calc,
    costTotal: see ? calc.costTotal : null,
    lineCostTotal: see ? calc.lineCostTotal : null,
    priceTotal: see ? calc.priceTotal : null,
    lines: lines.map(l => (see ? l : { ...l, price: null, amount: null, unitCost: null })),
  };
}

export const calculationRoutes = new Hono<AppEnv>()
  // калькуляция заказа покупателя
  .get('/:documentId', zValidator('param', z.object({ documentId: idParam.shape.id }), validationHook), async c => {
    const ctx = ctxOf(c);
    const view = await calculationView(ctx, c.req.valid('param').documentId);
    return c.json({ calculation: view });
  })
  // создать или пересчитать калькуляцию: состав по спецификациям строк заказа
  .post('/', cost, zValidator('json', calculationCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await recalculateOrderCalculation(ctx.db, ctx.workspaceId, { customerOrderId: body.customerOrderId, priceSource: body.priceSource, markupPct: body.markupPct });
    const [calc] = await ctx.db.select().from(orderCalculations).where(eq(orderCalculations.id, id)).limit(1);
    return c.json(await calculationView(ctx, calc!.documentId), 201);
  })
  // источник цены и наценка: после правки калькуляция пересчитывается
  .patch('/:id', cost, zValidator('param', idParam, validationHook), zValidator('json', calculationPatch, validationHook), async c => {
    const ctx = ctxOf(c);
    const [calc] = await ctx.db.select().from(orderCalculations).where(and(eq(orderCalculations.id, c.req.valid('param').id), eq(orderCalculations.workspaceId, ctx.workspaceId))).limit(1);
    if (!calc) throw notFound('calculation');
    await ctx.db.update(orderCalculations).set({ ...(c.req.valid('json').priceSource !== undefined ? { priceSource: c.req.valid('json').priceSource } : {}), ...(c.req.valid('json').markupPct !== undefined ? { markupPct: c.req.valid('json').markupPct } : {}), updatedAt: new Date() }).where(eq(orderCalculations.id, calc.id));
    const id = await recalculateOrderCalculation(ctx.db, ctx.workspaceId, { customerOrderId: calc.documentId });
    const [after] = await ctx.db.select().from(orderCalculations).where(eq(orderCalculations.id, id)).limit(1);
    return c.json(await calculationView(ctx, after!.documentId));
  })
  // разовые расходы калькуляции (доставка и т. п.)
  .put('/:id/lines', cost, zValidator('param', idParam, validationHook), zValidator('json', calculationLinesUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await setCalculationExtra(ctx.db, ctx.workspaceId, c.req.valid('param').id, body.extra.map(e => ({ ...e, id: e.id ?? '' })));
    const [calc] = await ctx.db.select().from(orderCalculations).where(eq(orderCalculations.id, c.req.valid('param').id)).limit(1);
    return c.json(await calculationView(ctx, calc!.documentId));
  })
  // применить цену к строкам заказа: цена строки = себестоимость единицы × (1 + наценка)
  .post('/:id/apply', cost, zValidator('param', idParam, validationHook), zValidator('json', calculationApply, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const [calc] = await ctx.db.select().from(orderCalculations).where(and(eq(orderCalculations.id, id), eq(orderCalculations.workspaceId, ctx.workspaceId))).limit(1);
    if (!calc) throw notFound('calculation');
    if (calc.documentId !== c.req.valid('json').documentId) throw new AppError(422, 'invalid_reference', 'The calculation belongs to another document');
    const applied = await applyCalculationPrices(ctx.db, ctx.workspaceId, id);
    return c.json({ applied, ...(await calculationView(ctx, calc.documentId)) });
  });
