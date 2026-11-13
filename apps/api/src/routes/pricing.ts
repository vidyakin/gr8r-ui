/* Виды цен и прайс-листы (задача 1178): справочник видов, подстановка цены, история, документ «Установка цен», прайс-лист
   (экран, печать, XLSX/CSV), загрузка цен из таблицы и публичные ссылки. Проведение и отмена установки — общие маршруты
   документов (`/documents/:id/post|unpost`). Правила — packages/db/src/pricing.ts и docs/architecture/pricing.md. */
import { zValidator } from '@hono/zod-validator';
import { asc, desc, isNull } from 'drizzle-orm';
import {
  archivePriceKind,
  archiveSupplierProfile,
  applySupplierPrice,
  createProductsForSupplierLines,
  deleteSupplierPrice,
  listSupplierPrices,
  listSupplierProfiles,
  matchSupplierLinesByName,
  previewSupplierPriceApply,
  productSupplierPrices,
  saveSupplierProfile,
  supplierPriceDetail,
  updateSupplierPriceLine,
  uploadSupplierPrice,
  getSupplierPrice,
  canSeeCost,
  createPriceKind,
  createPriceLink,
  createPriceSetting,
  fillPriceSetting,
  listPriceKinds,
  listPriceLinks,
  listPriceSettings,
  massChangePriceSetting,
  matchImportRows,
  organizations,
  priceListKinds,
  priceListRows,
  priceSettingDetail,
  productPriceHistory,
  productPricesByKind,
  resolveForDocument,
  revokePriceLink,
  updatePriceKind,
  updatePriceLink,
  updatePriceSetting,
  type ImportRowIn,
} from '@gr8r/db';
import {
  detectImportColumns,
  idParam,
  parsePriceCell,
  priceImportApply,
  priceImportPreview,
  priceKindCreate,
  priceKindUpdate,
  priceListLinkCreate,
  priceListLinkUpdate,
  priceListQuery,
  priceResolveBody,
  priceSettingCreate,
  priceSettingFill,
  priceSettingMass,
  priceSettingQuery,
  priceSettingUpdate,
  supplierPriceApplyBody,
  supplierPriceDetailQuery,
  supplierPriceLineParam,
  supplierPriceLinePatch,
  supplierPriceLinesBody,
  supplierPriceUploadFields,
  supplierPricesQuery,
  supplierProfileBody,
  supplierProfilesQuery,
  productPricesQuery,
  renderPriceList,
  uuid,
} from '@gr8r/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { AppError } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';
import { buildXlsx, readTable, toCsv, XlsxError, type Cell } from '../xlsx';

const admin = requireRole('admin');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });
const today = () => new Date().toISOString().slice(0, 10);
const productParam = z.object({ productId: uuid });
const exportQuery = priceListQuery.extend({ format: z.enum(['xlsx', 'csv']).default('xlsx') });

/** Прайс-лист: виды и строки для экрана, печати и выгрузки */
async function loadPriceList(ctx: Ctx, q: z.output<typeof priceListQuery>) {
  const kinds = await priceListKinds(ctx.db, ctx.workspaceId, q.kindIds, canSeeCost(ctx.role));
  const date = q.date ?? today();
  const list = await priceListRows(ctx.db, ctx.workspaceId, kinds, { kindIds: q.kindIds, categoryId: q.categoryId, date, inStock: q.inStock, q: q.q, limit: q.limit, offset: q.offset });
  return { kinds, date, ...list };
}

// до 50 МБ — как общий лимит вложений (FILE_MAX_BYTES) и client_max_body_size 55m в nginx
const MAX_FILE = 50 * 1024 * 1024;
/** Загрузка цен в «Установку цен» (base64 в JSON) — прежний лимит */
const IMPORT_MAX_FILE = 10 * 1024 * 1024;

/** multipart с файлом прайса поставщика: Content-Length до чтения тела, затем фактический размер; таблица — через readTable */
async function readPriceFile(c: import('hono').Context<AppEnv>): Promise<{ file: File; bytes: Uint8Array; table: string[][]; fields: Record<string, string> }> {
  if (Number(c.req.header('content-length') ?? 0) > MAX_FILE + 64 * 1024) throw new AppError(413, 'attachment_too_large', `File is larger than ${MAX_FILE} bytes`, { maxBytes: MAX_FILE });
  let body: Record<string, string | File | (string | File)[]>;
  try {
    body = await c.req.parseBody();
  } catch {
    throw new AppError(400, 'bad_request', 'Expected multipart/form-data');
  }
  const file = body.file;
  if (!(file instanceof File)) throw new AppError(400, 'bad_request', 'Field "file" is required');
  if (!file.size || file.size > MAX_FILE) throw new AppError(422, 'import_file_invalid', 'The file is empty or too large');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let table: string[][];
  try {
    // прайс поставщика: до 300 000 строк, распакованный XML книги до 512 МБ (файл до 50 МБ)
    table = readTable(file.name || 'file', bytes, { maxRows: 300_000, maxUnpacked: 512 * 1024 * 1024 });
  } catch (e) {
    if (e instanceof XlsxError && e.reason === 'xls') throw new AppError(422, 'import_file_xls', 'Legacy XLS is not supported: save the file as XLSX');
    if (e instanceof XlsxError && e.reason === 'too_large') throw new AppError(422, 'import_file_too_large', 'The workbook is too large to read');
    throw new AppError(422, 'price_file_invalid', 'The file cannot be read: use XLSX or CSV');
  }
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === 'string') fields[k] = v;
  return { file, bytes, table, fields };
}

/** Файл → таблица строк; ошибки разбора — 422 */
function tableOf(body: z.output<typeof priceImportPreview>): string[][] {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(body.data, 'base64'));
  } catch {
    throw new AppError(422, 'import_file_invalid', 'The file cannot be read');
  }
  if (!bytes.length || bytes.length > IMPORT_MAX_FILE) throw new AppError(422, 'import_file_invalid', 'The file is empty or too large');
  try {
    return readTable(body.fileName, bytes);
  } catch {
    throw new AppError(422, 'import_file_invalid', 'The file cannot be read: use XLSX or CSV');
  }
}

async function parseImport(ctx: Ctx, body: z.output<typeof priceImportPreview>) {
  const table = tableOf(body);
  if (table.length < 2) throw new AppError(422, 'import_file_invalid', 'The file has no data rows');
  const kinds = (await listPriceKinds(ctx.db, ctx.workspaceId, { canSeeCost: true })).map(k => ({ id: k.id, name: k.name }));
  const auto = detectImportColumns(table[0]!, kinds);
  const priceColumns = body.columns?.length ? body.columns.map(c => ({ column: c.column, priceKindId: c.priceKindId })) : auto.priceColumns;
  const skuColumn = body.skuColumn ?? auto.skuColumn;
  const nameColumn = body.nameColumn ?? auto.nameColumn;
  if (!priceColumns.length) throw new AppError(422, 'import_no_price_columns', 'No price columns found: name the columns after the price kinds');
  if (skuColumn === null && nameColumn === null) throw new AppError(422, 'import_no_key_columns', 'No SKU or name column found');
  const rows: ImportRowIn[] = [];
  for (let i = 1; i < Math.min(table.length, 5001); i++) {
    const r = table[i]!;
    const prices = priceColumns.flatMap(c => {
      const price = parsePriceCell(r[c.column]);
      return price === null ? [] : [{ priceKindId: c.priceKindId, price }];
    });
    const sku = skuColumn === null ? '' : String(r[skuColumn] ?? '').trim();
    const name = nameColumn === null ? '' : String(r[nameColumn] ?? '').trim();
    if (!sku && !name) continue;
    rows.push({ rowNo: i + 1, sku, name, prices });
  }
  return { header: table[0]!, columns: { skuColumn, nameColumn, priceColumns }, rows, kinds };
}

export const pricingRoutes = new Hono<AppEnv>()
  /* ---------- виды цен ---------- */
  .get('/kinds', async c => {
    const ctx = ctxOf(c);
    const archived = c.req.query('archived') === 'true';
    return c.json({ items: await listPriceKinds(ctx.db, ctx.workspaceId, { canSeeCost: canSeeCost(ctx.role), archived }) });
  })
  .post('/kinds', admin, zValidator('json', priceKindCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createPriceKind(ctx.db, docCtx(ctx), c.req.valid('json'));
    const row = (await listPriceKinds(ctx.db, ctx.workspaceId, { canSeeCost: true })).find(k => k.id === id);
    return c.json(row, 201);
  })
  .patch('/kinds/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', priceKindUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updatePriceKind(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json((await listPriceKinds(ctx.db, ctx.workspaceId, { canSeeCost: true })).find(k => k.id === id));
  })
  .delete('/kinds/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await archivePriceKind(ctx.db, docCtx(ctx), id);
    return c.json({ id, archived: true as const });
  })
  /* ---------- подстановка и история ---------- */
  // цены для документа: вид по приоритету (шапка, договор, контрагент, вид заказ-наряда, розничная; закупка — вид поставщика, закупочная)
  .post('/resolve', zValidator('json', priceResolveBody, validationHook), async c => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    return c.json(await resolveForDocument(ctx.db, ctx.workspaceId, { party: b.party, priceKindId: b.priceKindId, contractId: b.contractId, counterpartyId: b.counterpartyId, workOrderKindId: b.workOrderKindId, productIds: b.productIds, date: b.date }));
  })
  .get('/products/:productId/prices', zValidator('param', productParam, validationHook), zValidator('query', productPricesQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await productPricesByKind(ctx.db, ctx.workspaceId, c.req.valid('param').productId, c.req.valid('query').date ?? today(), canSeeCost(ctx.role)) });
  })
  .get('/products/:productId/history', zValidator('param', productParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await productPriceHistory(ctx.db, ctx.workspaceId, c.req.valid('param').productId, canSeeCost(ctx.role)) });
  })
  /* ---------- документ «Установка цен» (admin и выше) ---------- */
  .get('/settings', admin, zValidator('query', priceSettingQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json(await listPriceSettings(ctx.db, ctx.workspaceId, q));
  })
  .post('/settings', admin, zValidator('json', priceSettingCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createPriceSetting(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await priceSettingDetail(ctx.db, id), 201);
  })
  .get('/settings/:id', admin, zValidator('param', idParam, validationHook), async c => c.json(await priceSettingDetail(ctxOf(c).db, c.req.valid('param').id)))
  .patch('/settings/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', priceSettingUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updatePriceSetting(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await priceSettingDetail(ctx.db, id));
  })
  .post('/settings/:id/fill', admin, zValidator('param', idParam, validationHook), zValidator('json', priceSettingFill, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await fillPriceSetting(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await priceSettingDetail(ctx.db, id));
  })
  .post('/settings/:id/mass', admin, zValidator('param', idParam, validationHook), zValidator('json', priceSettingMass, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const r = await massChangePriceSetting(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json({ ...(await priceSettingDetail(ctx.db, id)), changed: r.changed });
  })
  /* ---------- прайс-лист ---------- */
  .get('/price-list', zValidator('query', priceListQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const r = await loadPriceList(ctx, c.req.valid('query'));
    return c.json({ date: r.date, kinds: r.kinds.map(k => ({ id: k.id, name: k.name })), total: r.total, items: r.rows });
  })
  // печатная форма (HTML, A4); PDF — печатью страницы в браузере
  .get('/price-list/print', zValidator('query', priceListQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const r = await loadPriceList(ctx, c.req.valid('query'));
    const [org] = await ctx.db.select({ name: organizations.name }).from(organizations).where(isNull(organizations.archivedAt)).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
    c.header('Content-Security-Policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderPriceList({ title: 'Прайс-лист', company: org?.name ?? '', date: r.date, kinds: r.kinds.map(k => ({ id: k.id, name: k.name })), rows: r.rows.map(x => ({ sku: x.sku, name: x.name, unit: x.unit, category: x.categoryName, prices: x.prices })) }));
  })
  .get('/price-list/export', zValidator('query', exportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const r = await loadPriceList(ctx, q);
    // колонки названы по видам цен: тот же файл можно загрузить обратно (импорт сопоставляет заголовки)
    const table: Cell[][] = [['Артикул', 'Наименование', 'Ед.', 'Категория', ...r.kinds.map(k => k.name), 'Остаток']];
    for (const x of r.rows) table.push([x.sku, x.name, x.unit, x.categoryName ?? '', ...r.kinds.map(k => (x.prices[k.id] === null ? null : Number(x.prices[k.id]))), Number(x.stockQty)]);
    c.header('X-Content-Type-Options', 'nosniff');
    if (q.format === 'csv') {
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', `attachment; filename="price-list-${r.date}.csv"`);
      return c.body(toCsv(table));
    }
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', `attachment; filename="price-list-${r.date}.xlsx"`);
    return c.body(buildXlsx('Прайс-лист', table) as unknown as ArrayBuffer);
  })
  /* ---------- загрузка цен из таблицы (admin) ---------- */
  .post('/import/preview', admin, zValidator('json', priceImportPreview, validationHook), async c => {
    const ctx = ctxOf(c);
    const p = await parseImport(ctx, c.req.valid('json'));
    const matched = await matchImportRows(ctx.db, ctx.workspaceId, p.rows, today());
    const names = new Map(p.kinds.map(k => [k.id, k.name]));
    return c.json({
      header: p.header,
      columns: p.columns,
      kinds: p.kinds,
      summary: { rows: matched.length, matched: matched.filter(m => m.productId).length, unmatched: matched.filter(m => !m.productId).length },
      rows: matched.slice(0, 1000).map(m => ({ rowNo: m.rowNo, sku: m.sku, name: m.name, productId: m.productId, productName: m.productName, matchedBy: m.matchedBy, lines: m.lines.map(l => ({ ...l, priceKindName: names.get(l.priceKindId) ?? '' })) })),
    });
  })
  // создаёт черновик «Установки цен»: проверить и провести можно в обычном порядке
  .post('/import/apply', admin, zValidator('json', priceImportApply, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const p = await parseImport(ctx, body);
    const date = body.date ?? today();
    const matched = await matchImportRows(ctx.db, ctx.workspaceId, p.rows, date);
    const lines = new Map<string, { productId: string; priceKindId: string; price: string }>();
    for (const m of matched) if (m.productId) for (const l of m.lines) lines.set(`${m.productId}|${l.priceKindId}`, { productId: m.productId, priceKindId: l.priceKindId, price: l.price });
    if (!lines.size) throw new AppError(422, 'import_nothing_matched', 'No rows of the file match the catalog');
    const id = await createPriceSetting(ctx.db, docCtx(ctx), { date, comment: `Загрузка из файла ${body.fileName}`, lines: [...lines.values()] });
    return c.json({ id, lines: lines.size, skipped: matched.filter(m => !m.productId).length }, 201);
  })
  /* ---------- публичные ссылки (admin) ---------- */
  .get('/links', admin, async c => c.json({ items: await listPriceLinks(ctxOf(c).db, ctxOf(c).workspaceId) }))
  .post('/links', admin, zValidator('json', priceListLinkCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const r = await createPriceLink(ctx.db, docCtx(ctx), c.req.valid('json'));
    // токен показывается один раз: в базе остаётся только хэш
    return c.json({ id: r.id, token: r.token, path: `/p/price/${r.token}` }, 201);
  })
  .patch('/links/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', priceListLinkUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updatePriceLink(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json({ items: (await listPriceLinks(ctx.db, ctx.workspaceId)).filter(l => l.id === id) });
  })
  .delete('/links/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await revokePriceLink(ctx.db, docCtx(ctx), id);
    return c.json({ id, revoked: true as const });
  })
  /* ---------- прайсы поставщиков (admin: цены поставщиков скрыты от участников) ---------- */
  .get('/supplier-profiles', admin, zValidator('query', supplierProfilesQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listSupplierProfiles(ctx.db, ctx.workspaceId, c.req.valid('query').companyId) });
  })
  .post('/supplier-profiles', admin, zValidator('json', supplierProfileBody, validationHook), async c => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    const row = await saveSupplierProfile(ctx.db, docCtx(ctx), b);
    return c.json(row, b.id ? 200 : 201);
  })
  // сетка файла-образца для настройки колонок: первые строки и число колонок
  .post('/supplier-profiles/preview', admin, async c => {
    const { file, table } = await readPriceFile(c);
    return c.json({ fileName: file.name, totalRows: table.length, columns: table.reduce((m, r) => Math.max(m, r.length), 0), rows: table.slice(0, 30) });
  })
  .delete('/supplier-profiles/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await archiveSupplierProfile(ctx.db, docCtx(ctx), id);
    return c.json({ id, archived: true as const });
  })
  .get('/supplier-prices', admin, zValidator('query', supplierPricesQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listSupplierPrices(ctx.db, ctx.workspaceId, c.req.valid('query').companyId) });
  })
  // multipart: file, companyId, profileId, date, name?
  .post('/supplier-prices/upload', admin, async c => {
    const ctx = ctxOf(c);
    const { file, bytes, table, fields } = await readPriceFile(c);
    const f = supplierPriceUploadFields.safeParse(fields);
    if (!f.success) throw new AppError(400, 'validation_error', 'Invalid upload fields', { issues: f.error.issues });
    const r = await uploadSupplierPrice(ctx.db, docCtx(ctx), { ...f.data, rows: table, file: { name: file.name || 'price', mime: file.type || null, data: bytes } });
    return c.json({ price: r.price, lines: r.lines }, 201);
  })
  .get('/supplier-prices/:id', admin, zValidator('param', idParam, validationHook), zValidator('query', supplierPriceDetailQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await supplierPriceDetail(ctx.db, ctx.workspaceId, c.req.valid('param').id, c.req.valid('query').status));
  })
  .delete('/supplier-prices/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await deleteSupplierPrice(ctx.db, docCtx(ctx), id);
    return c.json({ id, deleted: true as const });
  })
  .patch('/supplier-prices/:id/lines/:lineId', admin, zValidator('param', supplierPriceLineParam, validationHook), zValidator('json', supplierPriceLinePatch, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, lineId } = c.req.valid('param');
    const line = await updateSupplierPriceLine(ctx.db, docCtx(ctx), id, lineId, c.req.valid('json'));
    return c.json({ line, price: await getSupplierPrice(ctx.db, ctx.workspaceId, id) });
  })
  .post('/supplier-prices/:id/match-by-name', admin, zValidator('param', idParam, validationHook), zValidator('json', supplierPriceLinesBody, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const r = await matchSupplierLinesByName(ctx.db, docCtx(ctx), id, c.req.valid('json').lineIds);
    return c.json({ ...r, price: await getSupplierPrice(ctx.db, ctx.workspaceId, id) });
  })
  .post('/supplier-prices/:id/create-products', admin, zValidator('param', idParam, validationHook), zValidator('json', supplierPriceLinesBody, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const r = await createProductsForSupplierLines(ctx.db, docCtx(ctx), id, c.req.valid('json').lineIds);
    return c.json({ ...r, price: await getSupplierPrice(ctx.db, ctx.workspaceId, id) });
  })
  // сводка «было → стало» без записи
  .get('/supplier-prices/:id/preview-apply', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await previewSupplierPriceApply(ctx.db, ctx.workspaceId, c.req.valid('param').id));
  })
  .post('/supplier-prices/:id/apply', admin, zValidator('param', idParam, validationHook), zValidator('json', supplierPriceApplyBody, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await applySupplierPrice(ctx.db, docCtx(ctx), c.req.valid('param').id, { date: c.req.valid('json').date }));
  })
  // поставщики товара: артикул, наименование, цена вида цен поставщика на сегодня (карточка товара, admin)
  .get('/products/:productId/suppliers', admin, zValidator('param', productParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await productSupplierPrices(ctx.db, ctx.workspaceId, c.req.valid('param').productId, today()) });
  });
