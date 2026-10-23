/* Операции, исполнители и сдельные наряды: справочник операций с историей расценок, назначения операций
   исполнителям (задачи модуля production), отметка выполнения и журнал сдельных нарядов с отчётом выработки.
   Чтение — любой участник, назначения и наряды — member и выше. Правила — packages/db/src/piecework.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  addOperationRate,
  assignOperations,
  canSeeCost,
  createPieceworkFromDocument,
  createPieceworkOrder,
  getOperationAssignment,
  listOperationRates,
  listOperations,
  listOrderOperations,
  listPieceworkOrders,
  markOperationDone,
  pieceworkDetail,
  pieceworkReport,
  setOperationSpec,
  updatePieceworkOrder,
} from '@gr8r/db';
import {
  idParam,
  operationDone,
  operationRateCreate,
  operationRateQuery,
  operationSet,
  pieceworkCreate,
  pieceworkFromDocument,
  pieceworkQuery,
  pieceworkReportQuery,
  pieceworkUpdate,
  productionAssignments,
} from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

/** Суммы наряда видят admin и owner и сам исполнитель — только свои */
function maskLines(ctx: Ctx, doc: { memberId: string | null }, lines: Record<string, unknown>[]) {
  if (canSeeCost(ctx.role) || (doc.memberId && doc.memberId === ctx.memberId)) return lines;
  return lines.map(l => ({ ...l, rate: null, amount: null }));
}

export const pieceworkRoutes = new Hono<AppEnv>()
  /* ---------------- справочник операций ---------------- */
  // операции каталога: норма времени, участок по умолчанию и расценки
  .get('/operations', async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listOperations(ctx.db, ctx.workspaceId) });
  })
  // норма времени и участок по умолчанию операции
  .put('/operations/:id', write, zValidator('param', idParam, validationHook), zValidator('json', operationSet, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const productId = c.req.valid('param').id;
    await setOperationSpec(ctx.db, docCtx(ctx), { productId, normHours: body.normHours, workCenterId: body.workCenterId });
    return c.json({ productId, normHours: body.normHours, workCenterId: body.workCenterId ?? null });
  })
  // история расценок операции
  .get('/operation-rates', zValidator('query', operationRateQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listOperationRates(ctx.db, c.req.valid('query').productId) });
  })
  // новая расценка: действует с указанной даты
  .post('/operation-rates', write, zValidator('json', operationRateCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await addOperationRate(ctx.db, docCtx(ctx), { productId: body.productId, validFrom: body.validFrom, rate: body.rate, unit: body.unit });
    return c.json({ id }, 201);
  })
  /* ---------------- назначения и выполнение ---------------- */
  // назначение операции: кто и сколько выполняет
  .get('/operations/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const item = await getOperationAssignment(ctx.db, c.req.valid('param').id);
    if (!item) return c.json({ error: { code: 'not_found', message: 'The operation assignment does not exist' } }, 404);
    return c.json(item);
  })
  // отметка выполнения операции: мастер (рабочее место) или исполнитель (своя задача)
  .post('/operations/:id/done', write, zValidator('param', idParam, validationHook), zValidator('json', operationDone, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const res = await markOperationDone(ctx.db, docCtx(ctx), { assignmentId: c.req.valid('param').id, qty: body.qty, date: body.date });
    return c.json(await pieceworkDetail(ctx.db, res.documentId));
  })
  /* ---------------- сдельные наряды ---------------- */
  // журнал нарядов
  .get('/piecework', zValidator('query', pieceworkQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const list = await listPieceworkOrders(ctx.db, { memberId: q.memberId, from: q.from, to: q.to, status: q.status, limit: q.limit, offset: q.offset });
    const seeCost = canSeeCost(ctx.role);
    return c.json({
      ...list,
      limit: q.limit,
      offset: q.offset,
      items: list.items.map(i => (seeCost || i.memberId === ctx.memberId ? i : { ...i, amount: null, total: null })),
    });
  })
  // отчёт выработки: admin и owner видят всех, участник — только себя
  .get('/piecework/report', zValidator('query', pieceworkReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const memberId = canSeeCost(ctx.role) ? q.memberId : ctx.memberId ?? undefined;
    const rows = await pieceworkReport(ctx.db, { from: q.from, to: q.to, memberId });
    const seeCost = canSeeCost(ctx.role);
    return c.json({ items: rows.map(r => (seeCost || r.memberId === ctx.memberId ? r : { ...r, amount: null })) });
  })
  // карточка наряда
  .get('/piecework/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const doc = await pieceworkDetail(ctx.db, c.req.valid('param').id);
    return c.json({ ...doc, lines: maskLines(ctx, doc, doc.lines) });
  })
  // новый наряд
  .post('/piecework', write, zValidator('json', pieceworkCreate, validationHook), async c => {    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await createPieceworkOrder(ctx.db, docCtx(ctx), {
      date: body.date,
      memberId: body.memberId,
      workCenterId: body.workCenterId,
      comment: body.comment,
      lines: body.lines.map(l => ({ ...l })),
    });
    const doc = await pieceworkDetail(ctx.db, id);
    return c.json({ ...doc, lines: maskLines(ctx, doc, doc.lines) }, 201);
  })
  // наряд на основании документа: заказ на производство, выпуск или заказ покупателя
  .post('/piecework/from-document', write, zValidator('json', pieceworkFromDocument, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const ids = await createPieceworkFromDocument(ctx.db, docCtx(ctx), { documentId: body.documentId, date: body.date });
    const docs = await Promise.all(ids.map(id => pieceworkDetail(ctx.db, id)));
    return c.json({ items: docs.map(d => ({ ...d, lines: maskLines(ctx, d, d.lines) })) }, 201);
  })
  // правка наряда до проведения: строки и расценки
  .patch('/piecework/:id', write, zValidator('param', idParam, validationHook), zValidator('json', pieceworkUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await updatePieceworkOrder(ctx.db, docCtx(ctx), c.req.valid('param').id, {
      date: body.date,
      comment: body.comment,
      lines: body.lines?.map(l => ({ ...l })),
    });
    const doc = await pieceworkDetail(ctx.db, c.req.valid('param').id);
    return c.json({ ...doc, lines: maskLines(ctx, doc, doc.lines) });
  });

/** Назначения операций заказа: кто и сколько выполняет */
export const operationAssignmentRoutes = new Hono<AppEnv>()
  .get('/:id/operations', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listOrderOperations(ctx.db, c.req.valid('param').id) });
  })
  .post('/:id/operations', write, zValidator('param', idParam, validationHook), zValidator('json', productionAssignments, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await assignOperations(ctx.db, docCtx(ctx), c.req.valid('param').id, body.assignments);
    return c.json({ items: await listOrderOperations(ctx.db, c.req.valid('param').id) });
  });
