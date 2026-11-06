/* Объекты объектного учёта (задача 1268, docs/architecture/construction.md): справочник, карточка и сводка.
   Создание и правка — member и выше; удаление = архив, только admin и выше. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { archiveObject, createObject, getObject, listObjects, objectBudget, objectSummary, updateObject } from '@gr8r/db';
import { idParam, objectCreate, objectQuery, objectUpdate } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

export const objectRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', objectQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const page = await listObjects(ctx.db, ctx.workspaceId, {
      status: q.status,
      q: q.q,
      archived: q.archived,
      sort: q.sort,
      limit: q.limit,
      offset: q.offset,
    });
    return c.json({ ...page, limit: q.limit, offset: q.offset });
  })
  .get('/:id/summary', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    return c.json(await objectSummary(ctx.db, id, ctx.role));
  })
  // бюджет объекта по категориям (задача 1270): суммы — только owner/admin, остальным null-поля
  .get('/:id/budget', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await objectBudget(ctx.db, c.req.valid('param').id, ctx.role));
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await getObject(ctx.db, c.req.valid('param').id));
  })
  .post('/', requireRole('member'), zValidator('json', objectCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const row = await createObject(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, c.req.valid('json'));
    return c.json(await getObject(ctx.db, row.id), 201);
  })
  .patch('/:id', requireRole('member'), zValidator('param', idParam, validationHook), zValidator('json', objectUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await updateObject(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, id, c.req.valid('json'));
    return c.json(await getObject(ctx.db, id));
  })
  .delete('/:id', requireRole('admin'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await archiveObject(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, id);
    return c.json({ id, deleted: false as const, archived: true as const });
  });
