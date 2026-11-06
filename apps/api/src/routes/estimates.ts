/* Смета объекта (задача 1269, docs/architecture/construction.md): основная смета, разделы и позиции, согласование,
   допработы, импорт строк из таблицы и заказы из позиций. Чтение — участник, запись — member и выше,
   возврат в черновик — admin и выше. Путь `/estimates` — модуль trade (packages/shared/src/licensing.ts).
   Маршруты `objectEstimateRoutes` монтируются под `/objects` (сметы объекта), остальные — под `/estimates`. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  approveEstimate,
  copyEstimateToObject,
  createEstimate,
  createEstimateChange,
  createProductionOrderFromEstimate,
  createSupplierOrderFromEstimate,
  deleteEstimate,
  getEstimate,
  importEstimateRows,
  listObjectEstimates,
  saveEstimateContent,
  saveEstimateDoneQty,
  unapproveEstimate,
  updateEstimate,
} from '@gr8r/db';
import {
  estimateChangeCreate,
  estimateContent,
  estimateCopy,
  estimateCreate,
  estimateDoneQty,
  estimateImport,
  estimateProductionOrder,
  estimateSupplierOrder,
  estimateUpdate,
  idParam,
} from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { AppError } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';
import { readTable } from '../xlsx';

const MAX_FILE = 10 * 1024 * 1024;

/** Контекст сметы: роль нужна для маскирования себестоимости и прав на возврат в черновик */
const estCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

const fileBody = z.object({
  fileName: z.string().max(200),
  /** Содержимое файла в base64 */
  data: z.string().max(14_000_000),
});

const member = requireRole('member');

/** Сметы объекта: список и создание основной сметы, копирование сметы другого объекта */
export const objectEstimateRoutes = new Hono<AppEnv>()
  .get('/:id/estimates', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listObjectEstimates(ctx.db, c.req.valid('param').id, ctx.role) });
  })
  .post('/:id/estimates', member, zValidator('param', idParam, validationHook), zValidator('json', estimateCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const row = await createEstimate(ctx.db, estCtx(ctx), c.req.valid('param').id, c.req.valid('json'));
    return c.json(await getEstimate(ctx.db, row.id, ctx.role), 201);
  })
  // копирование сметы другого объекта в основную смету этого объекта
  .post('/:id/estimates/copy', member, zValidator('param', idParam, validationHook), zValidator('json', estimateCopy, validationHook), async c => {
    const ctx = ctxOf(c);
    const row = await copyEstimateToObject(ctx.db, estCtx(ctx), c.req.valid('param').id, c.req.valid('json'));
    return c.json(await getEstimate(ctx.db, row.id, ctx.role), 201);
  });

export const estimateRoutes = new Hono<AppEnv>()
  /* ---------- таблица для сопоставления колонок ---------- */
  // файл разбирается тем же модулем, что и прайс-лист; в смету уходят уже сопоставленные строки
  .post('/import/preview', member, zValidator('json', fileBody, validationHook), async c => {
    const body = c.req.valid('json');
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(Buffer.from(body.data, 'base64'));
    } catch {
      throw new AppError(422, 'import_file_invalid', 'The file cannot be read');
    }
    if (!bytes.length || bytes.length > MAX_FILE) throw new AppError(422, 'import_file_invalid', 'The file is empty or too large');
    let table: string[][];
    try {
      table = readTable(body.fileName, bytes);
    } catch {
      throw new AppError(422, 'import_file_invalid', 'The file cannot be read: use XLSX or CSV');
    }
    if (table.length < 2) throw new AppError(422, 'import_file_invalid', 'The file has no data rows');
    return c.json({ header: table[0] ?? [], rows: table.slice(1, 201) });
  })
  /* ---------- одна смета ---------- */
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await getEstimate(ctx.db, c.req.valid('param').id, ctx.role));
  })
  .patch('/:id', member, zValidator('param', idParam, validationHook), zValidator('json', estimateUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await updateEstimate(ctx.db, estCtx(ctx), id, c.req.valid('json'));
    return c.json(await getEstimate(ctx.db, id, ctx.role));
  })
  .delete('/:id', member, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await deleteEstimate(ctx.db, estCtx(ctx), id);
    return c.json({ id, deleted: true as const });
  })
  /* ---------- содержимое ---------- */
  .put('/:id/items', member, zValidator('param', idParam, validationHook), zValidator('json', estimateContent, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    return c.json(await saveEstimateContent(ctx.db, estCtx(ctx), id, c.req.valid('json')));
  })
  // выполненные объёмы (задача 1272): факт, правится и у согласованной сметы; больше объёма — 422 done_qty_exceeds
  .patch('/:id/done-qty', member, zValidator('param', idParam, validationHook), zValidator('json', estimateDoneQty, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    return c.json(await saveEstimateDoneQty(ctx.db, estCtx(ctx), id, c.req.valid('json').items));
  })
  /* ---------- согласование ---------- */
  .post('/:id/approve', member, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await approveEstimate(ctx.db, estCtx(ctx), id);
    return c.json(await getEstimate(ctx.db, id, ctx.role));
  })
  .post('/:id/unapprove', requireRole('admin'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    await unapproveEstimate(ctx.db, estCtx(ctx), id);
    return c.json(await getEstimate(ctx.db, id, ctx.role));
  })
  /* ---------- допработы ---------- */
  .post('/:id/changes', member, zValidator('param', idParam, validationHook), zValidator('json', estimateChangeCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const row = await createEstimateChange(ctx.db, estCtx(ctx), id, c.req.valid('json'));
    return c.json(await getEstimate(ctx.db, row.id, ctx.role), 201);
  })
  /* ---------- импорт строк ---------- */
  .post('/:id/import', member, zValidator('param', idParam, validationHook), zValidator('json', estimateImport, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    return c.json(await importEstimateRows(ctx.db, estCtx(ctx), id, c.req.valid('json').rows));
  })
  /* ---------- заказы из позиций ---------- */
  .post('/:id/supplier-order', member, zValidator('param', idParam, validationHook), zValidator('json', estimateSupplierOrder, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    return c.json(await createSupplierOrderFromEstimate(ctx.db, estCtx(ctx), id, c.req.valid('json')), 201);
  })
  .post('/:id/production-order', member, zValidator('param', idParam, validationHook), zValidator('json', estimateProductionOrder, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    return c.json(await createProductionOrderFromEstimate(ctx.db, estCtx(ctx), id, c.req.valid('json')), 201);
  });
