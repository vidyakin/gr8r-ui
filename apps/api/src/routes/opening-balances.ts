/* Ввод начальных остатков денег и расчётов (раздел «Деньги»). Проведение, отмена, удаление — общие маршруты документов
   (`/documents/:id/post|unpost|cancel`). Правила — packages/db/src/opening-balances.ts и docs/architecture/payments.md. */
import { zValidator } from '@hono/zod-validator';
import { createOpening, listOpenings, openingDetail, updateOpening } from '@gr8r/db';
import { idParam, openingCreate, openingQuery, openingUpdate } from '@gr8r/shared';
import { Hono } from 'hono';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

/** Остатки вводит admin и выше: документ меняет сальдо денег и расчётов целиком */
const write = requireRole('admin');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

export const openingBalanceRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', openingQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json(await listOpenings(ctx.db, ctx.workspaceId, { limit: q.limit, offset: q.offset, status: q.status ? q.status.split(',').filter(Boolean) : undefined }));
  })
  .post('/', write, zValidator('json', openingCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createOpening(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await openingDetail(ctx.db, id), 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => c.json(await openingDetail(ctxOf(c).db, c.req.valid('param').id)))
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', openingUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updateOpening(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await openingDetail(ctx.db, id));
  });
