/* Акты выполненных работ объекта (задача 1273, docs/architecture/construction.md): список, предложение строк,
   создание черновика, карточка и правка черновика, подпись и её отмена (admin+), выставление счёта и акта,
   сводка выручки объекта и печать КС-2/КС-3.
   Пути: `/objects/:id/acts`, `/objects/:id/revenue` (объект — модуль trade) и `/object-acts` (новый путь в TENANT_PATHS,
   модуль trade). Права: чтение — участник, запись — member и выше; отмена подписи — admin и выше (проверяет сервис). */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  createObjectAct,
  deleteObjectAct,
  getObjectAct,
  invoiceObjectAct,
  objectActPrintData,
  objectActsView,
  objectRevenue,
  signObjectAct,
  suggestAct,
  unsignObjectAct,
  updateObjectAct,
} from '@gr8r/db';
import {
  idParam,
  objectActCreate,
  objectActQuery,
  objectActSuggestionQuery,
  objectActUpdate,
  renderKs2,
  renderKs3,
  uuid,
} from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const objectIdParam = z.object({ id: uuid });

/** Контекст акта: воркспейс, автор и роль (отмена подписи — admin+) */
const actCtx = (ctx: ReturnType<typeof ctxOf>) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

/** Акты и сводка выручки — под /objects, чтобы путь уже был в TENANT_PATHS и модуле trade */
export const objectActObjectRoutes = new Hono<AppEnv>()
  // сводка выручки объекта: выполнено (по смете), принято (подписанные акты), выставлено и оплачено
  .get('/:id/revenue', zValidator('param', objectIdParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await objectRevenue(ctx.db, c.req.valid('param').id));
  })
  // предложение строк акта по виду: объёмы (done_qty − принято), веха (сумма вехи), часы (неучтённые часы × ставка)
  .get('/:id/acts/suggestion', zValidator('param', objectIdParam, validationHook), zValidator('query', objectActSuggestionQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await suggestAct(ctx.db, c.req.valid('param').id, c.req.valid('query')));
  })
  .get('/:id/acts', zValidator('param', objectIdParam, validationHook), zValidator('query', objectActQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const { from, to } = c.req.valid('query');
    return c.json(await objectActsView(ctx.db, c.req.valid('param').id, { from, to }));
  })
  .post('/:id/acts', requireRole('member'), zValidator('param', objectIdParam, validationHook), zValidator('json', objectActCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const row = await createObjectAct(ctx.db, actCtx(ctx), c.req.valid('param').id, c.req.valid('json'));
    return c.json(await getObjectAct(ctx.db, row.id), 201);
  });

/** Акт по id и его действия — корневой путь /object-acts (TENANT_PATHS, модуль trade) */
export const objectActRoutes = new Hono<AppEnv>()
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await getObjectAct(ctx.db, c.req.valid('param').id));
  })
  // печатные формы акта выполненных работ: КС-2 и КС-3 (HTML A4, как у документов)
  .get('/:id/print/:form', zValidator('param', z.object({ id: uuid, form: z.enum(['ks2', 'ks3']) }), validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, form } = c.req.valid('param');
    const data = await objectActPrintData(ctx.db, id);
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(form === 'ks2' ? renderKs2(data.ks2) : renderKs3(data.ks3));
  })
  .patch('/:id', requireRole('member'), zValidator('param', idParam, validationHook), zValidator('json', objectActUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updateObjectAct(ctx.db, actCtx(ctx), id, c.req.valid('json'));
    return c.json(await getObjectAct(ctx.db, id));
  })
  .delete('/:id', requireRole('member'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await deleteObjectAct(ctx.db, actCtx(ctx), id);
    return c.json({ id, deleted: true as const });
  })
  // подпись заказчиком = принято: строки фиксируются
  .post('/:id/sign', requireRole('member'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await signObjectAct(ctx.db, actCtx(ctx), id);
    return c.json(await getObjectAct(ctx.db, id));
  })
  // отмена подписи: admin и выше и только без оплат
  .post('/:id/unsign', requireRole('admin'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await unsignObjectAct(ctx.db, actCtx(ctx), id);
    return c.json(await getObjectAct(ctx.db, id));
  })
  // выставить: счёт и «Акт оказания услуг» с объектом и заказчиком объекта
  .post('/:id/invoice', requireRole('member'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const invoiced = await invoiceObjectAct(ctx.db, actCtx(ctx), id);
    return c.json({ ...invoiced, act: await getObjectAct(ctx.db, id) });
  });
