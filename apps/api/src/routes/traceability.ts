/* Прослеживаемость партий (задача 1253): двусторонняя трассировка партии.
   `from` — назад «из чего сделана партия» (сырьё, полуфабрикаты, документы, поставщик);
   `where-used` — вперёд «куда ушло сырьё» (выпуски, перемещения, отгрузки, заказы).
   Чтение — любой участник (как отчёт по партиям). Дерево собирает packages/db/src/traceability.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { batchTraceBackward, batchTraceForward } from '@erp/db';
import { batchTraceQuery, idParam } from '@erp/shared';
import { ctxOf, validationHook } from '../crud';
import { notFound } from '../errors';
import type { AppEnv } from '../types';

export const traceabilityRoutes = new Hono<AppEnv>()
  // Назад: из чего сделана партия (до поставщика и даты/номера партии)
  .get('/batches/:id/from', zValidator('param', idParam, validationHook), zValidator('query', batchTraceQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const { depth } = c.req.valid('query');
    const root = await batchTraceBackward(ctx.db, ctx.workspaceId, id, { depth });
    if (!root) throw notFound('batch');
    return c.json({ direction: 'backward', root });
  })
  // Вперёд: куда ушло сырьё партии (выпуски, перемещения, отгрузки, заказы покупателей)
  .get('/batches/:id/where-used', zValidator('param', idParam, validationHook), zValidator('query', batchTraceQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const { depth } = c.req.valid('query');
    const root = await batchTraceForward(ctx.db, ctx.workspaceId, id, { depth });
    if (!root) throw notFound('batch');
    return c.json({ direction: 'forward', root });
  });
