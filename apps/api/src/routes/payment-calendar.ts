/* Платёжный календарь и заявки на расход (задача 1174г). Подача на согласование и отмена — общие маршруты документов
   (`/documents/:id/post|unpost|cancel|restore`), состояния и оплата — здесь. Правила — docs/architecture/payments.md. */
import { zValidator } from '@hono/zod-validator';
import { changeDocumentState, createPaymentFromRequest, createRequest, listRequests, paymentCalendar, paymentDetail, requestDetail, updateRequest } from '@gr8r/db';
import { idParam, paymentCalendarQuery, requestCreate, requestPay, requestQuery, requestState, requestUpdate } from '@gr8r/shared';
import { Hono } from 'hono';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

export const paymentCalendarRoutes = new Hono<AppEnv>().get('/', zValidator('query', paymentCalendarQuery, validationHook), async c => {
  const ctx = ctxOf(c);
  const q = c.req.valid('query');
  return c.json(await paymentCalendar(ctx.db, ctx.workspaceId, { days: q.days, organizationId: q.organizationId, includePending: q.includePending === 'true' }));
});

export const paymentRequestRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', requestQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json(await listRequests(ctx.db, ctx.workspaceId, q));
  })
  .post('/', write, zValidator('json', requestCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createRequest(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await requestDetail(ctx.db, id), 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => c.json(await requestDetail(ctxOf(c).db, c.req.valid('param').id)))
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', requestUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updateRequest(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await requestDetail(ctx.db, id));
  })
  // согласовать, отклонить, вернуть на согласование (согласует admin и выше)
  .post('/:id/state', write, zValidator('param', idParam, validationHook), zValidator('json', requestState, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await changeDocumentState(ctx.db, docCtx(ctx), id, c.req.valid('json').state);
    return c.json(await requestDetail(ctx.db, id));
  })
  // оплата на основании: черновик РКО или списания со счёта на остаток заявки
  .post('/:id/pay', write, zValidator('param', idParam, validationHook), zValidator('json', requestPay, validationHook), async c => {
    const ctx = ctxOf(c);
    const paymentId = await createPaymentFromRequest(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json').account);
    return c.json(await paymentDetail(ctx.db, paymentId), 201);
  });
