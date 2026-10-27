/* Должности сотрудников и виды номенклатуры (задача 1172, docs/architecture/positions.md). Справочники читают все,
   правят admin и owner. GET /positions/me — должности, функции и видимые разделы меню текущего участника. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  createPosition,
  createProductKind,
  deletePosition,
  deleteProductKind,
  listPositions,
  listProductKinds,
  myPositions,
  setMemberPositions,
  updatePosition,
  updateProductKind,
} from '@gr8r/db';
import { idParam, memberPositionsSet, positionSave, positionUpdate, productKindSave, productKindUpdate } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const docCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });
const memberParam = z.object({ memberId: z.uuid() });

export const productKindRoutes = new Hono<AppEnv>()
  .get('/', async c => c.json({ items: await listProductKinds(ctxOf(c).db) }))
  .post('/', admin, zValidator('json', productKindSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createProductKind(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .patch('/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', productKindUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateProductKind(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteProductKind(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json({ ok: true });
  });

export const positionRoutes = new Hono<AppEnv>()
  .get('/', async c => c.json({ items: await listPositions(ctxOf(c).db) }))
  .get('/me', async c => {
    const ctx = ctxOf(c);
    return c.json(await myPositions(ctx.db, ctx.memberId, ctx.role));
  })
  .put('/by-member/:memberId', admin, zValidator('param', memberParam, validationHook), zValidator('json', memberPositionsSet, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ positionIds: await setMemberPositions(ctx.db, docCtx(ctx), c.req.valid('param').memberId, c.req.valid('json').positionIds) });
  })
  .post('/', admin, zValidator('json', positionSave, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createPosition(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .patch('/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', positionUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updatePosition(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deletePosition(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json({ ok: true });
  });
