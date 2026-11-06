/* Субподряд на объекте (задача 1274, docs/architecture/construction.md): список актов субподрядчика и сводка субподряда,
   предложение строк из заказа, создание черновика, карточка и правка черновика, приёмка и отклонение, отмена приёмки.
   Пути: `/objects/:id/sub-acts`, `/objects/:id/subcontract` (объект — модуль trade) и `/sub-acts` (новый путь в TENANT_PATHS,
   модуль trade). Права: чтение — участник, запись — member и выше; отмена приёмки — admin и выше (проверяет сервис). */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  acceptSubAct,
  createSubAct,
  deleteSubAct,
  getSubAct,
  objectSubActsView,
  objectSubcontractSummary,
  rejectSubAct,
  suggestSubActFromOrder,
  unacceptSubAct,
  updateSubAct,
} from '@gr8r/db';
import { idParam, objectSubActCreate, objectSubActQuery, objectSubActReject, objectSubActSuggestionQuery, objectSubActUpdate, uuid } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const objectIdParam = z.object({ id: uuid });

/** Контекст акта: воркспейс, автор и роль (отмена приёмки — admin+) */
const subActCtx = (ctx: ReturnType<typeof ctxOf>) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

/** Акты субподрядчика и сводка — под /objects, чтобы путь уже был в TENANT_PATHS и модуле trade */
export const objectSubActObjectRoutes = new Hono<AppEnv>()
  // сводка субподряда: заказано, предъявлено, принято, отклонено (с причинами), оплачено и заказы субподрядчикам
  .get('/:id/subcontract', zValidator('param', objectIdParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await objectSubcontractSummary(ctx.db, c.req.valid('param').id));
  })
  // предложение строк акта из заказа: остаток к приёмке по строкам-услугам заказа
  .get('/:id/sub-acts/suggestion', zValidator('param', objectIdParam, validationHook), zValidator('query', objectSubActSuggestionQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await suggestSubActFromOrder(ctx.db, c.req.valid('param').id, c.req.valid('query').orderId));
  })
  .get('/:id/sub-acts', zValidator('param', objectIdParam, validationHook), zValidator('query', objectSubActQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const { from, to } = c.req.valid('query');
    return c.json(await objectSubActsView(ctx.db, c.req.valid('param').id, { from, to }));
  })
  .post('/:id/sub-acts', requireRole('member'), zValidator('param', objectIdParam, validationHook), zValidator('json', objectSubActCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const row = await createSubAct(ctx.db, subActCtx(ctx), c.req.valid('param').id, c.req.valid('json'));
    return c.json(await getSubAct(ctx.db, row.id), 201);
  });

/** Акт субподрядчика по id и его действия — корневой путь /sub-acts (TENANT_PATHS, модуль trade) */
export const objectSubActRoutes = new Hono<AppEnv>()
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await getSubAct(ctx.db, c.req.valid('param').id));
  })
  .patch('/:id', requireRole('member'), zValidator('param', idParam, validationHook), zValidator('json', objectSubActUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updateSubAct(ctx.db, subActCtx(ctx), id, c.req.valid('json'));
    return c.json(await getSubAct(ctx.db, id));
  })
  .delete('/:id', requireRole('member'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await deleteSubAct(ctx.db, subActCtx(ctx), id);
    return c.json({ id, deleted: true as const });
  })
  // приёмка: принятые количества идут в поступление услуг, материалы — в списание со склада объекта
  .post('/:id/accept', requireRole('member'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const done = await acceptSubAct(ctx.db, subActCtx(ctx), id);
    return c.json({
      receiptDocumentId: done.receiptDocumentId,
      writeOffDocumentId: done.writeOffDocumentId,
      warnings: done.warnings,
      act: await getSubAct(ctx.db, id),
    });
  })
  // отклонение акта целиком с причиной: документов не создаётся
  .post('/:id/reject', requireRole('member'), zValidator('param', idParam, validationHook), zValidator('json', objectSubActReject, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await rejectSubAct(ctx.db, subActCtx(ctx), id, c.req.valid('json').reason);
    return c.json(await getSubAct(ctx.db, id));
  })
  // отмена приёмки: admin и выше и только без оплат — документы снимаются с проведения и отменяются
  .post('/:id/unaccept', requireRole('admin'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await unacceptSubAct(ctx.db, subActCtx(ctx), id);
    return c.json(await getSubAct(ctx.db, id));
  });
