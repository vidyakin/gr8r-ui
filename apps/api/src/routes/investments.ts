/* Инвестпроекты и окупаемость: список, карточка, план-факт, смена статуса.
   Суммы и показатели (NPV, IRR, PI, окупаемость) видят только admin и owner — маскирует сервер (maskInvestment*).
   Создаёт, правит и меняет статус admin и выше: member сумм не видит, поэтому и план не правит.
   Проекты для поля «Инвестпроект» документа (`/options`) видит любой участник. Правила — packages/db/src/investments.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  archiveInvestment,
  createInvestment,
  investmentDetail,
  investmentOptions,
  investmentPlanFact,
  listInvestments,
  maskInvestmentDetail,
  maskInvestmentPlanFact,
  maskInvestmentRow,
  setInvestmentStatus,
  updateInvestment,
} from '@gr8r/db';
import { investmentCreate, investmentQuery, investmentStatusAction, investmentUpdate } from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const manage = requireRole('admin');
const invCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId });
const detail = async (ctx: Ctx, id: string) => maskInvestmentDetail(await investmentDetail(ctx.db, id), ctx.role);

export const investmentRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', investmentQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const res = await listInvestments(ctx.db, c.req.valid('query'));
    return c.json({ ...res, items: res.items.map(r => maskInvestmentRow(r, ctx.role)) });
  })
  .get('/options', async c => c.json({ items: await investmentOptions(ctxOf(c).db) }))
  .get('/:id', async c => {
    const ctx = ctxOf(c);
    return c.json(await detail(ctx, c.req.param('id')));
  })
  .get('/:id/plan-fact', async c => {
    const ctx = ctxOf(c);
    return c.json(maskInvestmentPlanFact(await investmentPlanFact(ctx.db, c.req.param('id')), ctx.role));
  })
  .post('/', manage, zValidator('json', investmentCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createInvestment(ctx.db, invCtx(ctx), c.req.valid('json'));
    return c.json(await detail(ctx, id), 201);
  })
  .patch('/:id', manage, zValidator('json', investmentUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    await updateInvestment(ctx.db, invCtx(ctx), c.req.param('id'), c.req.valid('json'));
    return c.json(await detail(ctx, c.req.param('id')));
  })
  // черновик → утверждён → закрыт и обратно по шагу
  .post('/:id/status', manage, zValidator('json', investmentStatusAction, validationHook), async c => {
    const ctx = ctxOf(c);
    await setInvestmentStatus(ctx.db, invCtx(ctx), c.req.param('id'), c.req.valid('json').action);
    return c.json(await detail(ctx, c.req.param('id')));
  })
  .delete('/:id', manage, async c => {
    const ctx = ctxOf(c);
    await archiveInvestment(ctx.db, invCtx(ctx), c.req.param('id'));
    return c.json({ ok: true });
  })
  .post('/:id/restore', manage, async c => {
    const ctx = ctxOf(c);
    await archiveInvestment(ctx.db, invCtx(ctx), c.req.param('id'), true);
    return c.json(await detail(ctx, c.req.param('id')));
  });
