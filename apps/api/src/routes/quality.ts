/* Контроль качества (задача 1186): справочник причин брака, анализы и статус партий, переделка брака.
   Чтение — любой участник; справочник причин ведёт admin и выше, анализы и переделку — member и выше.
   Правила — packages/db/src/quality.ts, раздел docs/architecture/quality.md. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { createBatchAnalysis, createReworkOrder, defectReasons, deleteBatchAnalysis, listBatchAnalyses, setBatchStatus, updateBatchAnalysis } from '@gr8r/db';
import { batchAnalysisCreate, batchAnalysisUpdate, batchStatusUpdate, defectReasonCreate, defectReasonQuery, defectReasonUpdate, idParam, reworkCreate, uuid } from '@gr8r/shared';
import { crud, ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

/** Справочник причин брака: CRUD, удаление — архивирование (ссылки позиций выпуска сохраняются) */
export const defectReasonRoutes = crud({
  entity: 'defect_reason',
  table: defectReasons,
  create: defectReasonCreate,
  update: defectReasonUpdate,
  query: defectReasonQuery,
  sortable: { name: defectReasons.name, createdAt: defectReasons.createdAt },
  defaultSort: 'name',
  search: [defectReasons.name],
  writeRole: 'admin',
});

const analysisParam = z.object({ id: uuid, analysisId: uuid });

/** Анализы и статус партии: монтируется в /stock рядом с отчётом партий */
export const batchQualityRoutes = new Hono<AppEnv>()
  .get('/batches/:id/analyses', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const items = await listBatchAnalyses(ctx.db, ctx.workspaceId, c.req.valid('param').id);
    return c.json({ items, total: items.length });
  })
  .post('/batches/:id/analyses', write, zValidator('param', idParam, validationHook), zValidator('json', batchAnalysisCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createBatchAnalysis(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json'));
    return c.json({ id }, 201);
  })
  .patch('/batches/:id/analyses/:analysisId', write, zValidator('param', analysisParam, validationHook), zValidator('json', batchAnalysisUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    await updateBatchAnalysis(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('param').analysisId, c.req.valid('json'));
    return c.json({ ok: true as const });
  })
  .delete('/batches/:id/analyses/:analysisId', write, zValidator('param', analysisParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteBatchAnalysis(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('param').analysisId);
    return c.json({ ok: true as const });
  })
  // статус входного контроля партии: ok — допущена, quarantine — на карантине, rejected — отклонена
  .patch('/batches/:id/status', write, zValidator('param', idParam, validationHook), zValidator('json', batchStatusUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    await setBatchStatus(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json').status);
    return c.json({ ok: true as const });
  });

const reworkParam = z.object({ id: uuid });

/** Переделка брака позиции проведённого выпуска: монтируется в /production */
export const reworkRoutes = new Hono<AppEnv>().post('/:id/rework', write, zValidator('param', reworkParam, validationHook), zValidator('json', reworkCreate.extend({ itemId: uuid }), validationHook), async c => {
  const ctx = ctxOf(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const orderId = await createReworkOrder(ctx.db, docCtx(ctx), id, body.itemId, {
    ...(body.date ? { date: body.date } : {}),
    ...(body.workCenterId !== undefined ? { workCenterId: body.workCenterId } : {}),
    ...(body.qty ? { qty: body.qty } : {}),
  });
  return c.json({ id: orderId }, 201);
});
