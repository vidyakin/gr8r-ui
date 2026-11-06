/* Объекты объектного учёта (задача 1268, docs/architecture/construction.md): справочник, карточка и сводка.
   Создание и правка — member и выше; удаление = архив, только admin и выше.
   Процент выполнения и вехи (задача 1272): GET /objects/:id/progress и CRUD вех под /objects/:id/milestones;
   деньги вех (цена заказчику) видят все участники. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  archiveObject,
  createObject,
  createObjectMilestone,
  deleteObjectMilestone,
  getObject,
  listObjects,
  milestoneView,
  objectBudget,
  objectMilestonesView,
  objectProgress,
  objectSummary,
  setMilestoneAccepted,
  setMilestoneDone,
  updateObject,
  updateObjectMilestone,
} from '@gr8r/db';
import { idParam, objectCreate, objectMilestoneAccept, objectMilestoneCreate, objectMilestoneDone, objectMilestoneUpdate, objectQuery, objectUpdate, uuid } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const milestoneParam = z.object({ id: uuid, milestoneId: uuid });

/** Контекст записи вех: воркспейс и автор события */
const writeCtx = (ctx: ReturnType<typeof ctxOf>) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId });

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
  // процент выполнения объекта (задача 1272): способ, процент и база расчёта
  .get('/:id/progress', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await objectProgress(ctx.db, c.req.valid('param').id));
  })
  /* ---------- вехи объекта (задача 1272) ---------- */
  .get('/:id/milestones', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await objectMilestonesView(ctx.db, c.req.valid('param').id));
  })
  .post('/:id/milestones', requireRole('member'), zValidator('param', idParam, validationHook), zValidator('json', objectMilestoneCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const row = await createObjectMilestone(ctx.db, writeCtx(ctx), id, c.req.valid('json'));
    return c.json(await milestoneView(ctx.db, id, row), 201);
  })
  .patch(
    '/:id/milestones/:milestoneId',
    requireRole('member'),
    zValidator('param', milestoneParam, validationHook),
    zValidator('json', objectMilestoneUpdate, validationHook),
    async c => {
      const ctx = ctxOf(c);
      const { id, milestoneId } = c.req.valid('param');
      const row = await updateObjectMilestone(ctx.db, writeCtx(ctx), id, milestoneId, c.req.valid('json'));
      return c.json(await milestoneView(ctx.db, id, row));
    },
  )
  .delete('/:id/milestones/:milestoneId', requireRole('member'), zValidator('param', milestoneParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, milestoneId } = c.req.valid('param');
    await deleteObjectMilestone(ctx.db, writeCtx(ctx), id, milestoneId);
    return c.json({ id: milestoneId, deleted: true as const });
  })
  // выполнено и принято заказчиком — разные отметки; принято только после выполнено
  .post('/:id/milestones/:milestoneId/done', requireRole('member'), zValidator('param', milestoneParam, validationHook), zValidator('json', objectMilestoneDone, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, milestoneId } = c.req.valid('param');
    const row = await setMilestoneDone(ctx.db, writeCtx(ctx), id, milestoneId, c.req.valid('json').done);
    return c.json(await milestoneView(ctx.db, id, row));
  })
  .post('/:id/milestones/:milestoneId/accept', requireRole('member'), zValidator('param', milestoneParam, validationHook), zValidator('json', objectMilestoneAccept, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, milestoneId } = c.req.valid('param');
    const row = await setMilestoneAccepted(ctx.db, writeCtx(ctx), id, milestoneId, c.req.valid('json').accepted);
    return c.json(await milestoneView(ctx.db, id, row));
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
