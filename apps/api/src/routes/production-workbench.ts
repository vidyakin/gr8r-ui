/* Рабочее место «Выпуск продукции»: отбор заказов с остатком к выпуску (заказы покупателей и заказы на производство)
   и массовое выполнение — на участок и дату один документ выпуска. Чтение — любой участник, выполнение — member и выше.
   Правила — packages/db/src/production.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { executeWorkbench, listWorkbench, markOperationDone } from '@gr8r/db';
import { workbenchExecute, workbenchQuery } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');

export const productionWorkbenchRoutes = new Hono<AppEnv>()
  // отбор заказов рабочего места: что и сколько осталось выпустить
  .get('/workbench', zValidator('query', workbenchQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json(
      await listWorkbench(ctx.db, ctx.workspaceId, {
        customerOrderId: q.customerOrderId,
        productionOrderId: q.productionOrderId,
        counterpartyId: q.counterpartyId,
        productId: q.productId,
        state: q.state,
        from: q.from,
        to: q.to,
        q: q.q,
        productionKindId: q.productionKindId,
        staged: q.staged,
        limit: q.limit,
        offset: q.offset,
      }),
    );
  })
  // выполнение: отмеченные строки заказов превращаются в документы выпуска (по участку и дате — один документ)
  .post('/workbench/execute', write, zValidator('json', workbenchExecute, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const docCtx = { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role };
    const documents = await executeWorkbench(ctx.db, docCtx, {
      date: body.date,
      mode: body.mode,
      rows: body.rows.map(r => ({ orderId: r.orderId, source: r.source, lineId: r.lineId, stageId: r.stageId ?? null, qty: r.qty, workCenterId: r.workCenterId, assignments: r.assignments })),
    });
    // отметки мастера: строки сдельных нарядов исполнителей (по одному наряду на исполнителя за день)
    for (const doc of documents) {
      for (const a of doc.assignments) await markOperationDone(ctx.db, docCtx, { assignmentId: a.assignmentId, qty: a.qty, date: body.date, releaseDocumentId: doc.id });
    }
    return c.json({ documents }, 201);
  });
