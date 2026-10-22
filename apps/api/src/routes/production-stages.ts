/* Справочник «Этапы»: виды производства и их упорядоченные этапы. Чтение — любой участник,
   меняет admin и выше. Правила — packages/db/src/production-stages.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { archiveProductionKind, createProductionKind, listProductionKinds, updateProductionKind } from '@gr8r/db';
import { idParam, productionKindCreate, productionKindUpdate } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');

export const productionStageRoutes = new Hono<AppEnv>()
  // виды производства с этапами
  .get('/kinds', async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listProductionKinds(ctx.db, ctx.workspaceId) });
  })
  .post('/kinds', admin, zValidator('json', productionKindCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await createProductionKind(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role }, {
      ...(body.id ? { id: body.id } : {}),
      name: body.name,
      note: body.note,
      stages: body.stages,
    });
    const items = await listProductionKinds(ctx.db, ctx.workspaceId);
    return c.json(items.find(k => k.id === id), 201);
  })
  .patch('/kinds/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', productionKindUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await updateProductionKind(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role }, c.req.valid('param').id, body);
    const items = await listProductionKinds(ctx.db, ctx.workspaceId);
    return c.json(items.find(k => k.id === c.req.valid('param').id));
  })
  .delete('/kinds/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await archiveProductionKind(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role }, id);
    return c.json({ id, deleted: true as const });
  });
