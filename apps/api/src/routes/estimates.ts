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
  createEstimateImport,
  createProductionOrderFromEstimate,
  createSupplierOrderFromEstimate,
  deleteEstimate,
  getEstimate,
  getEstimateImport,
  getEstimateImportSource,
  importEstimateRows,
  listObjectEstimates,
  runEstimateImportExtract,
  saveEstimateContent,
  saveEstimateDoneQty,
  supplierProductPrices,
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
  estimateImportExtract,
  estimateProductionOrder,
  estimateSupplierOrder,
  estimateSupplierPrices,
  estimateUpdate,
  idParam,
  uuid,
} from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { readDocxTables } from '../docx';
import { AppError } from '../errors';
import { readPdfPages } from '../pdf';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';
import { readTable } from '../xlsx';

const MAX_FILE = 10 * 1024 * 1024;
/** Импорт документов: PDF-тома проектов тяжёлые (реальный пример — 14 МБ), docx легче */
const MAX_FILE_DOC = 25 * 1024 * 1024;

/** Контекст сметы: роль нужна для маскирования себестоимости и прав на возврат в черновик */
const estCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

const fileBody = z.object({
  fileName: z.string().max(200),
  /** Содержимое файла в base64 */
  data: z.string().max(14_000_000),
});

/** Импорт документа (docx/pdf): больше лимит файла (36 млн символов base64 ≈ 27 МБ — с запасом над
    MAX_FILE_DOC, чтобы слишком большой файл отклоняла проверка маршрута с кодом import_file_invalid), смета необязательна */
const documentBody = fileBody.extend({ data: z.string().max(36_000_000), estimateId: uuid.optional() });

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
      throw new AppError(422, 'import_file_invalid', 'The file cannot be read: use XLSX, CSV or DOCX');
    }
    if (table.length < 2) throw new AppError(422, 'import_file_invalid', 'The file has no data rows');
    return c.json({ header: table[0] ?? [], rows: table.slice(1, 201) });
  })
  /* ---------- импорт сметы из документа (docx/pdf) ---------- */
  // docx: таблица извлекается сразу (docx.ts), ИИ размечает строки задачей estimate.ai_extract;
  // pdf: документ классифицируется и разбирается постранично (pdf.ts), задача ставится после выбора
  // страниц и подсказки (POST /:id/extract). Без ключа ИИ задача сразу отвечает done без разметки
  .post('/import/document', member, zValidator('json', documentBody, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(Buffer.from(body.data, 'base64'));
    } catch {
      throw new AppError(422, 'import_file_invalid', 'The file cannot be read');
    }
    if (!bytes.length || bytes.length > MAX_FILE_DOC) throw new AppError(422, 'import_file_invalid', 'The file is empty or too large');
    if (/\.pdf$/i.test(body.fileName)) {
      let pdf;
      try {
        pdf = await readPdfPages(bytes);
      } catch {
        throw new AppError(422, 'import_file_invalid', 'The file cannot be read: use a valid PDF document');
      }
      if (pdf.pageCount > 300) throw new AppError(422, 'import_pdf_too_many_pages', 'The PDF has more than 300 pages');
      if (!pdf.pageCount) throw new AppError(422, 'import_file_invalid', 'The PDF has no pages');
      const hasText = pdf.rows.length > 0;
      const id = await createEstimateImport(ctx.db, estCtx(ctx), {
        estimateId: body.estimateId ?? null,
        fileName: body.fileName,
        table: { header: pdf.header, rows: pdf.rows.slice(0, 2000), rowPages: pdf.rowPages.slice(0, 2000) },
        status: 'ready',
        meta: { pageCount: pdf.pageCount, pdfType: pdf.pdfType, pagesNeedingOcr: pdf.pagesNeedingOcr.slice(0, 100) },
        source: pdf.pages,
      });
      return c.json({ id, status: 'ready' as const, pageCount: pdf.pageCount, pdfType: pdf.pdfType, hasText }, 202);
    }
    if (!/\.docx$/i.test(body.fileName)) throw new AppError(422, 'import_file_invalid', 'The file must be a .docx or .pdf document');
    let table: string[][];
    try {
      table = readDocxTables(bytes);
    } catch {
      throw new AppError(422, 'import_file_invalid', 'The file cannot be read: use a valid DOCX document');
    }
    if (table.length < 2) throw new AppError(422, 'import_file_invalid', 'The document has no data rows');
    // в разметку уходит до 2000 строк — столько же принимает импорт сметы
    const id = await createEstimateImport(ctx.db, estCtx(ctx), {
      estimateId: body.estimateId ?? null,
      fileName: body.fileName,
      table: { header: table[0] ?? [], rows: table.slice(1, 2001) },
    });
    return c.json({ id, status: 'pending' as const }, 202);
  })
  // статус импорта документа: таблица и разметка ИИ (null — fallback на сопоставление колонок)
  .get('/import/:id', member, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const row = await getEstimateImport(ctx.db, ctx.workspaceId, c.req.valid('param').id);
    return c.json({
      id: row.id,
      status: row.status,
      fileName: row.fileName,
      table: row.table,
      aiResult: row.aiResult,
      aiError: row.aiError,
      job: row.job,
      error: row.error,
      hint: row.hint,
      meta: row.meta,
    });
  })
  // запуск разметки PDF: фильтр строк по выбранным страницам + подсказка для ИИ → задача estimate.ai_extract
  .post('/import/:id/extract', member, zValidator('param', idParam, validationHook), zValidator('json', estimateImportExtract, validationHook), async c => {
    const ctx = ctxOf(c);
    await runEstimateImportExtract(ctx.db, estCtx(ctx), c.req.valid('param').id, c.req.valid('json'));
    return c.json({ id: c.req.valid('param').id, status: 'pending' as const }, 202);
  })
  // исходный markdown документа (pdf): «документ как его видит разбор» — отдельно, чтобы не таскать
  // мегабайты источника в каждом опросе статуса
  .get('/import/:id/source', member, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ pages: await getEstimateImportSource(ctx.db, ctx.workspaceId, c.req.valid('param').id) });
  })
  /* ---------- цены поставщика для себестоимости ---------- */
  // POST /estimates/supplier-prices: цены товаров по виду цен поставщика на сегодня; нет цены — товара нет в ответе.
  // Только owner/admin (403 из сервиса); путь объявлен до '/:id', чтобы не совпасть с ним
  .post('/supplier-prices', member, zValidator('json', estimateSupplierPrices, validationHook), async c => {
    const ctx = ctxOf(c);
    const { supplierId, productIds } = c.req.valid('json');
    return c.json({ items: await supplierProductPrices(ctx.db, estCtx(ctx), supplierId, productIds) });
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
