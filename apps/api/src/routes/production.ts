/* Производство: участки, продукция (изделия и полуфабрикаты), спецификации (строки material / semi / work), расчёт
   себестоимости и настройки. Чтение — любой участник; участки и настройки меняет admin и выше; продукцию и спецификации — member и выше.
   Расчёт — та же чистая функция `computeBomCost`, что и в интерфейсе (packages/shared/src/bom.ts). */
import { zValidator } from '@hono/zod-validator';
import { asc, and, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { bomLines, calculateNeeds, createNeedsDrafts, createNeedsSupplierOrders, listProductionKinds, loadAvgCosts, manufacturedItems, postNeedsDrafts, productCategories, productionKinds, productionNeeds, productionStages, products, recordEvent, stockBalances, stockReservations, warehouses, workCenters, workspaces, writeOffDefects } from '@gr8r/db';
import {
  bomLineCreate,
  bomLineUpdate,
  bomPrintParam,
  bomReorder,
  checkCostShares,
  compileExpr,
  computeBomCost,
  computeNeeds,
  DisassemblyShareError,
  explodeBom,
  explodeQuery,
  idParam,
  itemCreate,
  itemQuery,
  itemUpdate,
  MATERIAL_PRICE_SOURCES,
  WASTE_PRICE_SOURCES,
  needsSupplierOrdersCreate,
  needsCalculateQuery,
  needsOrdersCreate,
  needsPostCreate,
  parseParamJson,
  productionNeedsQuery,
  productionSettingsUpdate,
  resolveMaterialPrice,
  wouldCreateCycle,
  workCenterCreate,
  workCenterQuery,
  workCenterUpdate,
  BomCycleError,
  BomFormulaError,
  ExprError,
  bomPrintHtml,
  type BomPrintData,
  type BomPrintRow,
  type BomItemInput,
  type Explosion,
  type MaterialPriceSource,
  type ProductionSettings,
  type WastePriceSource,
} from '@gr8r/shared';
import { crud, ctxOf, validationHook, type Ctx } from '../crud';
import { AppError, notFound } from '../errors';
import { requireRole } from '../middleware';
import { assertUnit, effectiveAttributes } from '../catalog/service';
import { loadSpecParams } from '@gr8r/db';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const write = requireRole('member');

export type ItemRow = typeof manufacturedItems.$inferSelect;
export type LineRow = typeof bomLines.$inferSelect;

/* ---------------- настройки ---------------- */

export async function loadSettings(ctx: Ctx): Promise<ProductionSettings> {
  const [ws] = await ctx.db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId)).limit(1);
  const v = ws?.settings?.materialPriceSource;
  const wasteSource = ws?.settings?.wastePriceSource;
  return {
    materialPriceSource: MATERIAL_PRICE_SOURCES.includes(v as MaterialPriceSource) ? (v as MaterialPriceSource) : 'purchase',
    wastePriceSource: WASTE_PRICE_SOURCES.includes(wasteSource as WastePriceSource) ? (wasteSource as WastePriceSource) : 'purchase',
  };
}

/* ---------------- участки ---------------- */

/** Вид производства изделия должен существовать */
async function assertProductionKind(ctx: Ctx, kindId: string | null | undefined) {
  if (!kindId) return;
  const [kind] = await ctx.db.select({ id: productionKinds.id, archivedAt: productionKinds.archivedAt }).from(productionKinds).where(eq(productionKinds.id, kindId)).limit(1);
  if (!kind || kind.archivedAt) throw new AppError(422, 'invalid_reference', 'The production kind does not exist', { issues: [{ path: 'productionKindId', message: 'Production kind not found' }] });
}

/** Этап строки спецификации: должен принадлежать виду производства изделия */
async function assertStageOfItem(ctx: Ctx, itemId: string, stageId: string | null | undefined) {
  const [item] = await ctx.db.select({ kindId: manufacturedItems.productionKindId }).from(manufacturedItems).where(eq(manufacturedItems.id, itemId)).limit(1);
  const kindId = item?.kindId ?? null;
  if (!stageId) {
    if (kindId) throw new AppError(422, 'stage_required', 'Set the stage of every line of the bill of materials', { issues: [{ path: 'stageId', message: 'Choose the stage of the line' }] });
    return;
  }
  if (!kindId) throw new AppError(422, 'stage_mismatch', 'The product has no production kind: the stage of its lines is not needed', { issues: [{ path: 'stageId', message: 'Not applicable: the product has no production kind' }] });
  const [stage] = await ctx.db.select({ kindId: productionStages.kindId }).from(productionStages).where(eq(productionStages.id, stageId)).limit(1);
  if (!stage) throw new AppError(422, 'invalid_reference', 'The stage does not exist', { issues: [{ path: 'stageId', message: 'Stage not found' }] });
  if (stage.kindId !== kindId) throw new AppError(422, 'stage_mismatch', 'The stage belongs to another production kind', { issues: [{ path: 'stageId', message: 'Choose a stage of the production kind of the product' }] });
}

/** Участок привязан к складу-цеху: материалы передаются на него обычным перемещением */
async function assertWorkshopWarehouse(ctx: Ctx, warehouseId: string | null | undefined) {
  if (!warehouseId) return;
  const [w] = await ctx.db.select({ id: warehouses.id, kind: warehouses.kind, archivedAt: warehouses.archivedAt }).from(warehouses).where(eq(warehouses.id, warehouseId)).limit(1);
  if (!w || w.archivedAt) throw new AppError(422, 'invalid_reference', 'The warehouse does not exist', { issues: [{ path: 'warehouseId', message: 'Warehouse not found' }] });
  if (w.kind !== 'workshop') throw new AppError(422, 'invalid_warehouse_kind', 'A work center can only be tied to a workshop warehouse', { issues: [{ path: 'warehouseId', message: 'Choose a warehouse of the "workshop" kind' }] });
}

export const workCenterRoutes = crud({
  entity: 'work_center',
  table: workCenters,
  create: workCenterCreate,
  update: workCenterUpdate,
  query: workCenterQuery,
  sortable: { name: workCenters.name, code: workCenters.code, hourlyRate: workCenters.hourlyRate, createdAt: workCenters.createdAt },
  defaultSort: 'name',
  search: [workCenters.name, workCenters.code],
  writeRole: 'admin',
  prepareCreate: async (ctx, body) => {
    await assertWorkshopWarehouse(ctx, body.warehouseId);
    return {};
  },
  prepareUpdate: async (ctx, existing, body) => {
    if (body.warehouseId !== undefined && body.warehouseId !== existing.warehouseId) await assertWorkshopWarehouse(ctx, body.warehouseId);
    return {};
  },
});

/** Разборка — в один этап: выходы приходуются тем же выпуском, что списывает исходный товар, поэтому вид производства
    (этапы) у спецификации разборки не задаётся */
function assertSingleStage(mode: string | null | undefined, productionKindId: string | null | undefined): void {
  if (mode === 'disassembly' && productionKindId)
    throw new AppError(422, 'disassembly_stages', 'A disassembly is done in one stage: remove the production kind', { issues: [{ path: 'productionKindId', message: 'Not allowed for a disassembly' }] });
}

/* ---------------- расчёт ---------------- */

/** Продукция с её строками и данные для цены: всё, что нужно computeBomCost (без архивной продукции) */
async function loadBomGraph(ctx: Ctx) {
  const items = await ctx.db.select().from(manufacturedItems).where(isNull(manufacturedItems.archivedAt)).orderBy(asc(manufacturedItems.name));
  const lines = await ctx.db.select().from(bomLines).orderBy(asc(bomLines.itemId), asc(bomLines.sortOrder), asc(bomLines.createdAt));
  const centers = await ctx.db.select().from(workCenters);
  const productIds = [...new Set(lines.map(l => l.productId).filter((x): x is string => !!x))];
  const mats = productIds.length ? await ctx.db.select().from(products).where(inArray(products.id, productIds)) : [];
  // средняя себестоимость склада (взвешенная остатком по складам) — для источника цены «avg_cost»; нет остатка — нет значения
  const avg = productIds.length ? await loadAvgCosts(ctx.db, productIds) : new Map<string, string>();
  return { items, lines, centers, mats, avg };
}

export const toInput = (item: ItemRow, lines: LineRow[], paramKeys: string[] = [], params?: Record<string, unknown> | null): BomItemInput => ({
  id: item.id,
  name: item.name,
  unitCode: item.unitCode,
  productId: item.productId,
  mode: item.mode,
  batchQty: item.batchQty,
  overheadPct: item.overheadPct,
  paramKeys,
  params,
  lines: lines.map(l => ({ id: l.id, kind: l.kind, qty: l.qty, productId: l.productId, costShare: l.costShare, scrapPct: l.scrapPct, unitCode: l.unitCode, childItemId: l.childItemId, semiMode: l.semiMode, operation: l.operation, workCenterId: l.workCenterId, hours: l.hours, rate: l.rate, fixedCost: l.fixedCost, qtyExpr: l.qtyExpr, condition: l.condition })),
});

/* ---------------- продукция и спецификации ---------------- */

const lineParam = idParam;

/** Проверка строки перед записью: ссылки, единица, запрет циклов. Возвращает колонки, которые определяет сервер */
async function checkLine(ctx: Ctx, itemId: string, l: Pick<LineRow, 'kind' | 'productId' | 'childItemId' | 'workCenterId' | 'operation'> & { stageId?: string | null }): Promise<{ unitCode: string | null }> {
  // этап у возвратного отхода не задаётся: отходы приходует финальный этап
  if (l.kind === 'waste' && l.stageId) throw new AppError(422, 'stage_mismatch', 'A waste line has no stage: the final stage receives the waste', { issues: [{ path: 'stageId', message: 'Not applicable to a waste line' }] });
  if (l.kind !== 'waste') await assertStageOfItem(ctx, itemId, l.stageId ?? null);
  // вид спецификации задаёт набор допустимых строк: у разборки — только выходные продукты и работы
  const [item] = await ctx.db.select({ mode: manufacturedItems.mode, name: manufacturedItems.name }).from(manufacturedItems).where(eq(manufacturedItems.id, itemId)).limit(1);
  const disassembly = item?.mode === 'disassembly';
  if (disassembly && l.kind !== 'output' && l.kind !== 'work' && l.kind !== 'waste')
    throw new AppError(422, 'spec_kind_forbidden', 'A disassembly specification has outputs, waste and work operations only', { issues: [{ path: 'kind', message: 'Not applicable to a disassembly specification' }] });
  if (l.kind === 'waste') {
    // возвратный отход: складской товар каталога
    const [p] = await ctx.db.select({ unitCode: products.unitCode, kind: products.kind }).from(products).where(eq(products.id, l.productId ?? '')).limit(1);
    if (!p) throw new AppError(422, 'invalid_reference', 'The product does not exist', { issues: [{ path: 'productId', message: 'Product not found' }] });
    if (p.kind !== 'goods') throw new AppError(422, 'invalid_waste', 'Only goods can be returnable waste', { issues: [{ path: 'productId', message: 'Choose a goods product' }] });
    return { unitCode: p.unitCode };
  }
  if (!disassembly && l.kind === 'output')
    throw new AppError(422, 'spec_kind_forbidden', 'Outputs belong to a disassembly specification only', { issues: [{ path: 'kind', message: 'Not applicable to an assembly specification' }] });
  if (l.kind === 'material') {
    const [p] = await ctx.db.select({ unitCode: products.unitCode, kind: products.kind }).from(products).where(eq(products.id, l.productId ?? '')).limit(1);
    if (!p) throw new AppError(422, 'invalid_reference', 'The product does not exist', { issues: [{ path: 'productId', message: 'Product not found' }] });
    if (p.kind !== 'goods') throw new AppError(422, 'invalid_material', 'Only goods can be used as materials; add services as work operations', { issues: [{ path: 'productId', message: 'Services cannot be materials' }] });
    return { unitCode: p.unitCode };
  }
  if (l.kind === 'semi') {
    const [child] = await ctx.db.select({ unitCode: manufacturedItems.unitCode, archivedAt: manufacturedItems.archivedAt }).from(manufacturedItems).where(eq(manufacturedItems.id, l.childItemId ?? '')).limit(1);
    if (!child || child.archivedAt) throw new AppError(422, 'invalid_reference', 'The included product does not exist', { issues: [{ path: 'childItemId', message: 'Product not found' }] });
    // Граф меняется параллельно: проверка цикла и запись идут под одной рекомендательной блокировкой воркспейса
    await ctx.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ctx.workspaceId}::text, 4))`);
    const edges = new Map<string, string[]>();
    for (const e of await ctx.db.select({ item: bomLines.itemId, child: bomLines.childItemId }).from(bomLines).where(eq(bomLines.kind, 'semi'))) {
      if (e.child) edges.set(e.item, [...(edges.get(e.item) ?? []), e.child]);
    }
    if (wouldCreateCycle(edges, itemId, l.childItemId!)) throw new AppError(422, 'bom_cycle', 'A product cannot include itself, directly or through its semi-finished products', { issues: [{ path: 'childItemId', message: 'This would create a cycle' }] });
    return { unitCode: child.unitCode };
  }
  if (l.kind === 'expense') {
    // расход: услуга подрядчика — в себестоимость, но не на склад
    const [p] = await ctx.db.select({ unitCode: products.unitCode, kind: products.kind }).from(products).where(eq(products.id, l.productId ?? '')).limit(1);
    if (!p) throw new AppError(422, 'invalid_reference', 'The service does not exist', { issues: [{ path: 'productId', message: 'Service not found' }] });
    if (p.kind !== 'service') throw new AppError(422, 'invalid_expense', 'An expense line is a service of a contractor', { issues: [{ path: 'productId', message: 'Choose a service' }] });
    return { unitCode: p.unitCode };
  }
  if (l.kind === 'output') {
    // выходной продукт разборки: складской товар каталога
    const [p] = await ctx.db.select({ unitCode: products.unitCode, kind: products.kind }).from(products).where(eq(products.id, l.productId ?? '')).limit(1);
    if (!p) throw new AppError(422, 'invalid_reference', 'The product does not exist', { issues: [{ path: 'productId', message: 'Product not found' }] });
    if (p.kind !== 'goods') throw new AppError(422, 'invalid_output', 'Only goods can be an output of a disassembly', { issues: [{ path: 'productId', message: 'Choose a goods product' }] });
    return { unitCode: p.unitCode };
  }
  if (l.kind === 'work') {
    // работа может ссылаться на операцию (вид номенклатуры «операция»)
    if (l.productId) {
      const [p] = await ctx.db.select({ kind: products.kind }).from(products).where(eq(products.id, l.productId)).limit(1);
      if (!p) throw new AppError(422, 'invalid_reference', 'The operation does not exist', { issues: [{ path: 'productId', message: 'Operation not found' }] });
      if (p.kind !== 'operation') throw new AppError(422, 'not_operation', 'Only a product of the "operation" kind can be an operation', { issues: [{ path: 'productId', message: 'Choose an operation' }] });
    }
    if (l.workCenterId) {
      const [wc] = await ctx.db.select({ id: workCenters.id }).from(workCenters).where(eq(workCenters.id, l.workCenterId)).limit(1);
      if (!wc) throw new AppError(422, 'invalid_reference', 'The work center does not exist', { issues: [{ path: 'workCenterId', message: 'Work center not found' }] });
    }
    return { unitCode: null };
  }
  return { unitCode: null };
}

/** Ключи, доступные в формулах строк спецификации: параметры спецификации и характеристики категории товара */
async function specKeys(ctx: Ctx, itemId: string): Promise<string[]> {
  const specs = await loadSpecParams(ctx.db, ctx.workspaceId);
  return specs.get(itemId)?.keys ?? [];
}

/** Ключ параметра спецификации не должен совпадать с ключом характеристики категории товара */
async function assertParamsFree(ctx: Ctx, productId: string | null | undefined, params: { key: string }[]): Promise<void> {
  if (!productId || !params.length) return;
  const [p] = await ctx.db.select({ categoryId: products.categoryId }).from(products).where(eq(products.id, productId)).limit(1);
  if (!p?.categoryId) return;
  const [cat] = await ctx.db.select().from(productCategories).where(eq(productCategories.id, p.categoryId)).limit(1);
  if (!cat) return;
  const attrs = await effectiveAttributes(ctx, cat);
  const attrKeys = attrs.map(a => a.key);
  const clash = params.map(x => x.key).find(k => attrKeys.includes(k));
  if (clash) throw new AppError(422, 'param_key_clash', `The key “${clash}” is already used by a characteristic of the product category`, { issues: [{ path: 'params', message: `The key “${clash}” is already used by a characteristic of the product category` }] });
}

/** Проверка формул строки спецификации при сохранении: неизвестный параметр, синтаксическая ошибка, лимиты — 422 */
async function assertFormulas(ctx: Ctx, itemId: string, body: { qtyExpr?: string | null; condition?: string | null }): Promise<void> {
  const keys = await specKeys(ctx, itemId);
  for (const [field, src] of [['qtyExpr', body.qtyExpr], ['condition', body.condition]] as const) {
    if (!src?.trim()) continue;
    try {
      compileExpr(src, keys);
    } catch (e) {
      if (e instanceof ExprError) throw new AppError(422, 'invalid_expression', `${field}: ${e.message}`, { issues: [{ path: field, message: e.message }] });
      throw e;
    }
  }
}

/** Доли стоимости выходов спецификации: если задана хоть одна — заданы все, и сумма ровно 100 % */
async function assertSpecCostShares(ctx: Ctx, itemId: string): Promise<void> {
  const outs = await ctx.db.select({ costShare: bomLines.costShare }).from(bomLines).where(and(eq(bomLines.itemId, itemId), eq(bomLines.kind, 'output')));
  if (!outs.length) return;
  try {
    checkCostShares(outs.map(o => ({ costShare: o.costShare ?? null })));
  } catch (e) {
    if (e instanceof DisassemblyShareError) throw new AppError(422, e.code, e.message);
    throw e;
  }
}

/** Состав спецификации должен соответствовать её виду: у разборки — только выходы и работы */
async function assertSpecComposition(ctx: Ctx, itemId: string, mode: 'assembly' | 'disassembly'): Promise<void> {
  const lines = await ctx.db.select({ kind: bomLines.kind }).from(bomLines).where(eq(bomLines.itemId, itemId));
  for (const l of lines) {
    if (mode === 'disassembly' && l.kind !== 'output' && l.kind !== 'work')
      throw new AppError(422, 'spec_kind_forbidden', 'A disassembly specification has outputs, waste and work operations only', { issues: [{ path: 'kind', message: 'Not applicable to a disassembly specification' }] });
    if (mode === 'assembly' && l.kind === 'output')
      throw new AppError(422, 'spec_kind_forbidden', 'Outputs belong to a disassembly specification only', { issues: [{ path: 'kind', message: 'Not applicable to an assembly specification' }] });
  }
}

export const itemRoutes = crud({
  entity: 'manufactured_item',
  table: manufacturedItems,
  create: itemCreate,
  update: itemUpdate,
  query: itemQuery,
  sortable: { name: manufacturedItems.name, code: manufacturedItems.code, kind: manufacturedItems.kind, createdAt: manufacturedItems.createdAt, updatedAt: manufacturedItems.updatedAt },
  defaultSort: 'name',
  search: [manufacturedItems.name, manufacturedItems.code],
  filters: (q, ctx) => [
    q.kind ? eq(manufacturedItems.kind, q.kind) : undefined,
    // «содержит материал/операцию»: товар или операция есть в строках спецификации (у работы — операция строки)
    q.contains ? inArray(manufacturedItems.id, ctx.db.select({ id: bomLines.itemId }).from(bomLines).where(eq(bomLines.productId, q.contains))) : undefined,
  ],
  prepareCreate: async (ctx, body) => {
    await assertUnit(ctx, body.unitCode);
    await assertProductionKind(ctx, body.productionKindId);
    assertSingleStage(body.mode, body.productionKindId);
    await assertParamsFree(ctx, body.productId, body.params ?? []);
    return {};
  },
  prepareUpdate: async (ctx, existing, body) => {
    if (body.unitCode !== undefined && body.unitCode !== existing.unitCode) await assertUnit(ctx, body.unitCode);
    if (body.productionKindId !== undefined) await assertProductionKind(ctx, body.productionKindId);
    assertSingleStage(body.mode ?? existing.mode, body.productionKindId !== undefined ? body.productionKindId : existing.productionKindId);
    if (body.params !== undefined) await assertParamsFree(ctx, body.productId ?? existing.productId, body.params);
    // вид спецификации задаёт набор строк, а доли стоимости выходов должны давать 100 %
    const mode = (body.mode ?? existing.mode) as 'assembly' | 'disassembly';
    await assertSpecComposition(ctx, existing.id, mode);
    await assertSpecCostShares(ctx, existing.id);
    return {};
  },
  // Продукцию, которая входит в чужие спецификации, нельзя убрать: сначала уберите её оттуда
  beforeDelete: async (ctx, row) => {
    const users = await ctx.db
      .select({ name: manufacturedItems.name })
      .from(bomLines)
      .innerJoin(manufacturedItems, eq(manufacturedItems.id, bomLines.itemId))
      .where(eq(bomLines.childItemId, row.id))
      .limit(3);
    if (users.length) throw new AppError(422, 'in_use', `“${row.name}” is part of the bill of materials of ${users.map(u => `“${u.name}”`).join(', ')}. Remove it from there first`, { items: users });
  },
})
  .get('/:id/lines', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await loadItem(ctx, id);
    const items = await ctx.db.select().from(bomLines).where(eq(bomLines.itemId, id)).orderBy(asc(bomLines.sortOrder), asc(bomLines.createdAt));
    return c.json({ items, total: items.length, limit: items.length, offset: 0 });
  })
  .post('/:id/lines', write, zValidator('param', idParam, validationHook), zValidator('json', bomLineCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const item = await loadItem(ctx, c.req.valid('param').id);
    const base = { kind: body.kind, productId: body.kind === 'material' || body.kind === 'expense' || body.kind === 'output' || body.kind === 'waste' ? (body.productId ?? null) : body.kind === 'work' ? (body.productId ?? null) : null, childItemId: body.kind === 'semi' ? (body.childItemId ?? null) : null, semiMode: body.kind === 'semi' ? (body.semiMode ?? 'stock') : null, workCenterId: body.kind === 'work' ? (body.workCenterId ?? null) : null, operation: body.operation ?? '', stageId: body.stageId ?? null };
    const { unitCode } = await checkLine(ctx, item.id, base);
    await assertFormulas(ctx, item.id, body);
    const [ord] = await ctx.db.select({ m: max(bomLines.sortOrder) }).from(bomLines).where(eq(bomLines.itemId, item.id));
    const [row] = await ctx.db
      .insert(bomLines)
      .values({
        ...(body.id ? { id: body.id } : {}),
        workspaceId: ctx.workspaceId,
        itemId: item.id,
        ...base,
        sortOrder: Number(ord?.m ?? -1) + 1,
        qty: body.kind === 'work' ? '1' : body.qty!,
        unitCode,
        scrapPct: body.kind === 'material' ? (body.scrapPct ?? '0') : '0',
        hours: body.kind === 'work' ? (body.hours ?? '0') : '0',
        rate: body.kind === 'work' ? (body.rate ?? null) : null,
        fixedCost: body.kind === 'work' ? (body.fixedCost ?? null) : null,
        qtyExpr: body.qtyExpr ?? null,
        condition: body.condition ?? null,
        costShare: body.kind === 'output' ? (body.costShare ?? null) : null,
        note: body.note ?? '',
      })
      .returning();
    await touchItem(ctx, item.id);
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'bom_line.created', entity: 'bom_line', recordId: row!.id, actorId: ctx.memberId, payload: { item: item.id, kind: body.kind } });
    return c.json(row!, 201);
  })
  // порядок строк: перетаскивание присылает полный список id
  .post('/:id/lines/reorder', write, zValidator('param', idParam, validationHook), zValidator('json', bomReorder, validationHook), async c => {
    const ctx = ctxOf(c);
    const item = await loadItem(ctx, c.req.valid('param').id);
    const { ids } = c.req.valid('json');
    const current = await ctx.db.select({ id: bomLines.id }).from(bomLines).where(eq(bomLines.itemId, item.id)).orderBy(asc(bomLines.sortOrder), asc(bomLines.createdAt));
    const known = new Set(current.map(l => l.id));
    if (ids.some(id => !known.has(id))) throw new AppError(422, 'invalid_reference', 'The list contains lines that do not belong to this product');
    const order = [...new Set([...ids, ...current.map(l => l.id).filter(id => !ids.includes(id))])];
    for (const [i, id] of order.entries()) await ctx.db.update(bomLines).set({ sortOrder: i }).where(eq(bomLines.id, id));
    await touchItem(ctx, item.id);
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'bom_line.reordered', entity: 'bom_line', recordId: item.id, actorId: ctx.memberId, payload: { item: item.id } });
    const items = await ctx.db.select().from(bomLines).where(eq(bomLines.itemId, item.id)).orderBy(asc(bomLines.sortOrder));
    return c.json({ items });
  })
  // себестоимость единицы: дерево с разбивкой «материалы / работы / накладные»
  .get('/:id/cost', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await loadItem(ctx, id);
    const settings = await loadSettings(ctx);
    const g = await loadBomGraph(ctx);
    const byItem = new Map<string, LineRow[]>();
    for (const l of g.lines) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l]);
    const prod = new Map(g.mats.map(p => [p.id, p]));
    const rates = new Map(g.centers.map(w => [w.id, w.hourlyRate]));
    const specs = await loadSpecParams(ctx.db, ctx.workspaceId);
    try {
      const tree = computeBomCost(g.items.map(i => toInput(i, byItem.get(i.id) ?? [], specs.get(i.id)?.keys ?? [])), id, {
        materialPrice: pid => (prod.has(pid) ? resolveMaterialPrice(settings.materialPriceSource, prod.get(pid)!, g.avg.get(pid)) : null),
        wastePrice: pid => (prod.has(pid) ? resolveMaterialPrice(settings.wastePriceSource, prod.get(pid)!, g.avg.get(pid)) : null),
        workCenterRate: wid => rates.get(wid),
      });
      return c.json({ itemId: id, source: settings.materialPriceSource, tree });
    } catch (e) {
      if (e instanceof BomCycleError) throw new AppError(422, 'bom_cycle', e.message, { path: e.path });
      // формулы строк требуют значений параметров изделия: без них себестоимость спецификации не считается
      if (e instanceof BomFormulaError) throw new AppError(422, 'formula_error', e.message);
      throw e;
    }
  })
  // развёртка спецификации на количество и потребность с учётом остатков: нужно / доступно / дефицит
  // печатная форма спецификации: кратко (свои строки) и развёрнуто (переделы до исходных материалов)
  .get('/:id/print/:form', zValidator('param', bomPrintParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, form } = c.req.valid('param');
    const item = await loadItem(ctx, id);
    const g = await loadBomGraph(ctx);
    const byItem = new Map<string, LineRow[]>();
    for (const l of g.lines) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l]);
    const prod = new Map(g.mats.map(p => [p.id, p]));
    const items = new Map(g.items.map(i => [i.id, i]));
    const specs = await loadSpecParams(ctx.db, ctx.workspaceId);
    const params = parseParamJson(c.req.query('params'));
    const kindLabel: Record<string, string> = { material: 'Материал', semi: 'Полуфабрикат', work: 'Работа', expense: 'Расход', output: 'Выходной продукт' };
    let n = 0;
    // строки спецификации: в краткой форме — свои, в развёрнутой — с переделами
    const build = (itemId: string, deep: boolean): BomPrintRow[] => {
      const out: BomPrintRow[] = [];
      for (const l of byItem.get(itemId) ?? []) {
        n++;
        const child = l.kind === 'semi' && l.childItemId ? items.get(l.childItemId) : undefined;
        const name = l.kind === 'material' || l.kind === 'expense' || l.kind === 'output' ? (prod.get(l.productId ?? '')?.name ?? '') : l.kind === 'work' ? l.operation ?? '' : (child?.name ?? '');
        const row: BomPrintRow = {
          n,
          kind: kindLabel[l.kind] ?? l.kind,
          name,
          product: l.kind === 'material' || l.kind === 'expense' || l.kind === 'output' ? (prod.get(l.productId ?? '')?.sku ?? '') : '',
          unitCode: l.unitCode ?? '',
          qty: l.qty,
          note: l.note ?? '',
          costShare: l.costShare ?? null,
        };
        if (deep && child) row.children = build(child.id, true);
        out.push(row);
      }
      return out;
    };
    const spec = specs.get(item.id);
    const values = spec?.params.map(p => ({ name: p.name, value: String((params ?? {})[p.key] ?? '') })).filter(x => x.value !== '') ?? [];
    const data: BomPrintData = {
      form,
      mode: item.mode,
      name: item.name,
      code: item.code,
      productName: item.productId ? (prod.get(item.productId)?.name ?? null) : null,
      unitCode: item.unitCode,
      batchQty: item.batchQty,
      overheadPct: item.overheadPct,
      date: new Date().toISOString().slice(0, 10),
      params: values,
      rows: build(item.id, form === 'expanded'),
    };
    c.header('Content-Security-Policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(bomPrintHtml(data));
  })
  .get('/:id/explode', zValidator('param', idParam, validationHook), zValidator('query', explodeQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const q = c.req.valid('query');
    await loadItem(ctx, id);
    if (q.warehouseId) {
      const [w] = await ctx.db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, q.warehouseId)).limit(1);
      if (!w) throw notFound('warehouse');
    }
    const g = await loadBomGraph(ctx);
    const byItem = new Map<string, LineRow[]>();
    for (const l of g.lines) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l]);
    const specs = await loadSpecParams(ctx.db, ctx.workspaceId);
    // значения параметров изделия: формулы количества и условия строк
    const params = parseParamJson(q.params);
    let explosion: Explosion;
    try {
      explosion = explodeBom(g.items.map(i => toInput(i, byItem.get(i.id) ?? [], specs.get(i.id)?.keys ?? [], i.id === id ? params : undefined)), id, q.qty);
    } catch (e) {
      if (e instanceof BomCycleError) throw new AppError(422, 'bom_cycle', e.message, { path: e.path });
      if (e instanceof BomFormulaError) throw new AppError(422, 'formula_error', e.message);
      throw e;
    }
    // Доступно: остаток склада минус резерв под заказы покупателей (по одному складу или по всем сразу)
    const reserved = sql<string>`coalesce((select sum(r.qty) from ${stockReservations} r where r.warehouse_id = ${stockBalances.warehouseId} and r.product_id = ${stockBalances.productId}), 0)`;
    const rows = await ctx.db
      .select({ productId: stockBalances.productId, available: sql<string>`sum((${stockBalances.qty} - ${reserved}))::numeric(18,3)::text` })
      .from(stockBalances)
      .where(q.warehouseId ? eq(stockBalances.warehouseId, q.warehouseId) : undefined)
      .groupBy(stockBalances.productId);
    const needs = computeNeeds(explosion, new Map(rows.map(r => [r.productId, r.available])));
    const prod = new Map(g.mats.map(p => [p.id, p]));
    const items = new Map(g.items.map(i => [i.id, i]));
    return c.json({
      itemId: id,
      qty: explosion.qty,
      batchQty: explosion.batchQty,
      warehouseId: q.warehouseId ?? null,
      materials: needs.materials.map(m => ({ ...m, name: prod.get(m.productId ?? '')?.name ?? m.productId, unitCode: prod.get(m.productId ?? '')?.unitCode ?? null })),
      // расходы подрядчику: в себестоимость входят, но в потребность (остатки склада) не попадают
      expenses: explosion.materials.filter(m => m.expense).map(m => ({ productId: m.productId, name: prod.get(m.productId ?? '')?.name ?? m.productId, unitCode: prod.get(m.productId ?? '')?.unitCode ?? null, qty: m.qty })),
      semis: needs.semis.map(s => ({ ...s, name: items.get(s.itemId ?? '')?.name ?? s.itemId, unitCode: items.get(s.itemId ?? '')?.unitCode ?? null })),
      works: needs.works,
      // выходные продукты разборки: они не расходуются, а получаются
      outputs: explosion.outputs.map(o => ({ productId: o.productId, name: prod.get(o.productId)?.name ?? o.productId, unitCode: prod.get(o.productId)?.unitCode ?? null, qty: o.qty, costShare: o.costShare ?? null })),
    });
  });

async function loadItem(ctx: Ctx, id: string): Promise<ItemRow> {
  const [row] = await ctx.db.select().from(manufacturedItems).where(eq(manufacturedItems.id, id)).limit(1);
  if (!row) throw notFound('manufactured_item');
  return row;
}

const touchItem = (ctx: Ctx, id: string) => ctx.db.update(manufacturedItems).set({ updatedAt: new Date() }).where(eq(manufacturedItems.id, id));

/** Правка и удаление строки спецификации по её id */
export const bomLineRoutes = new Hono<AppEnv>()
  .patch('/:id', write, zValidator('param', lineParam, validationHook), zValidator('json', bomLineUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const [line] = await ctx.db.select().from(bomLines).where(eq(bomLines.id, c.req.valid('param').id)).limit(1).for('update');
    if (!line) throw notFound('bom_line');
    // Поля, чужие для типа строки, отклоняются: тип не меняется
    const foreign: Record<LineRow['kind'], string[]> = { material: ['childItemId', 'semiMode', 'operation', 'workCenterId', 'hours', 'rate', 'fixedCost'], semi: ['productId', 'scrapPct', 'operation', 'workCenterId', 'hours', 'rate', 'fixedCost'], work: ['childItemId', 'semiMode', 'qty', 'scrapPct'], expense: ['childItemId', 'semiMode', 'operation', 'workCenterId', 'hours', 'rate', 'fixedCost'], output: ['childItemId', 'semiMode', 'operation', 'workCenterId', 'hours', 'rate', 'fixedCost'], waste: ['childItemId', 'semiMode', 'operation', 'workCenterId', 'hours', 'rate', 'fixedCost', 'scrapPct', 'costShare'] };
    const bad = foreign[line.kind].find(k => (body as Record<string, unknown>)[k] !== undefined);
    if (bad) throw new AppError(400, 'validation_error', `${bad}: not applicable to a ${line.kind} line`, { issues: [{ path: bad, message: `Not applicable to a ${line.kind} line` }] });
    const next = { ...line, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) } as LineRow;
    if (line.kind === 'work' && !(Number(next.hours) > 0 || Number(next.fixedCost ?? 0) > 0) && !next.productId) throw new AppError(400, 'validation_error', 'hours: Set hours or a fixed cost', { issues: [{ path: 'hours', message: 'Set hours or a fixed cost' }] });
    const refChanged = next.productId !== line.productId || next.childItemId !== line.childItemId || next.workCenterId !== line.workCenterId;
    const { unitCode } = refChanged ? await checkLine(ctx, line.itemId, next) : { unitCode: line.unitCode };
    await assertFormulas(ctx, line.itemId, body);
    const [row] = await ctx.db
      .update(bomLines)
      .set({ ...body, unitCode, updatedAt: new Date() })
      .where(eq(bomLines.id, line.id))
      .returning();
    await touchItem(ctx, line.itemId);
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'bom_line.updated', entity: 'bom_line', recordId: line.id, actorId: ctx.memberId, payload: { item: line.itemId, changes: Object.keys(body) } });
    return c.json(row!);
  })
  .delete('/:id', write, zValidator('param', lineParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const [line] = await ctx.db.delete(bomLines).where(eq(bomLines.id, c.req.valid('param').id)).returning();
    if (!line) throw notFound('bom_line');
    await touchItem(ctx, line.itemId);
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'bom_line.deleted', entity: 'bom_line', recordId: line.id, actorId: ctx.memberId, payload: { item: line.itemId } });
    return c.json({ id: line.id, deleted: true as const });
  });

/* ---------------- снимок для интерфейса и настройки ---------------- */

export const productionRoutes = new Hono<AppEnv>()
  // всё, что нужно для мгновенного пересчёта на клиенте одним запросом: продукция со строками, участки, материалы из спецификаций
  .get('/snapshot', async c => {
    const ctx = ctxOf(c);
    const g = await loadBomGraph(ctx);
    const settings = await loadSettings(ctx);
    const byItem = new Map<string, LineRow[]>();
    for (const l of g.lines) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l]);
    return c.json({
      settings,
      kinds: await listProductionKinds(ctx.db, ctx.workspaceId),
      items: g.items.map(i => ({ ...i, lines: byItem.get(i.id) ?? [] })),
      workCenters: g.centers.filter(w => !w.archivedAt || g.lines.some(l => l.workCenterId === w.id)),
      materials: g.mats.map(p => ({ id: p.id, name: p.name, sku: p.sku, kind: p.kind, unitCode: p.unitCode, price: p.price, purchasePrice: p.purchasePrice, avgCost: g.avg.get(p.id) ?? null, archived: !!p.archivedAt })),
    });
  })
  .get('/settings', async c => c.json(await loadSettings(ctxOf(c))))
  // сводная потребность по материалам заказов на производство
  .get('/needs', zValidator('query', productionNeedsQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json({ items: await productionNeeds(ctx.db, ctx.workspaceId, { productionOrderId: q.productionOrderId, productId: q.productId }) });
  })
  // общий расчёт потребностей (обработка УНФ «Расчёт потребностей в запасах»): рекомендации по периодам
  .get('/needs/calculate', zValidator('query', needsCalculateQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json(
      await calculateNeeds(
        ctx.db,
        ctx.role,
        {
          replenishment: q.replenishment as 'purchase' | 'production' | 'transfer' | 'all',
          method: q.method as 'orders' | 'sales_minmax' | 'sales_statistics',
          step: q.step as 'day' | 'week' | 'month',
          periods: q.periods,
          from: q.from ?? new Date().toISOString().slice(0, 10),
          byWarehouse: q.byWarehouse,
          warehouseId: q.warehouseId,
          source: q.source as 'all' | 'orders' | 'plan',
          productId: q.productId,
        },
        { safetyDays: q.safetyDays, safetyPct: q.safetyPct === undefined ? undefined : String(q.safetyPct), historyPeriods: q.historyPeriods },
      ),
    );
  })
  // черновики по потребности: закупка → заказ поставщику, производство → заказ на производство, перемещение → перемещение
  .post('/needs/orders', write, zValidator('json', needsOrdersCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const res = await createNeedsDrafts(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role }, {
      replenishment: body.replenishment,
      supplierId: body.supplierId ?? null,
      workCenterId: body.workCenterId ?? null,
      date: body.date ?? null,
      singleDate: body.singleDate,
      perCustomerOrder: body.perCustomerOrder,
      comment: body.comment,
      lines: body.lines.map(l => ({ productId: l.productId, warehouseId: l.warehouseId ?? null, sourceWarehouseId: l.sourceWarehouseId ?? null, workCenterId: l.workCenterId ?? null, qty: l.qty, date: l.date ?? null, customerOrderId: l.customerOrderId ?? null, price: l.price ?? null, supplierId: l.supplierId ?? null })),
    });
    return c.json(res, 201);
  })
  // массовое проведение созданных черновиков
  .post('/needs/post', write, zValidator('json', needsPostCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const res = await postNeedsDrafts(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role }, c.req.valid('json').documentIds);
    return c.json(res);
  })
  // заказы поставщикам по сводной потребности: черновики по поставщику, строки без поставщика — отдельно
  .post('/needs/supplier-orders', write, zValidator('json', needsSupplierOrdersCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const res = await createNeedsSupplierOrders(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role }, { date: body.date, comment: body.comment, lines: body.lines });
    return c.json(res, 201);
  })
  .patch('/settings', admin, zValidator('json', productionSettingsUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await ctx.db.update(workspaces).set({ settings: sql`${workspaces.settings} || ${JSON.stringify(body)}::jsonb`, updatedAt: new Date() }).where(eq(workspaces.id, ctx.workspaceId));
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'workspace.updated', entity: 'workspace', recordId: ctx.workspaceId, actorId: ctx.memberId, payload: { changes: body } });
    return c.json(await loadSettings(ctx));
  })
  // списание брака выпуска: создаёт черновик write_off по дефектным позициям
  .post('/:id/write-off-defects', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, created } = await writeOffDefects(ctx.db, ctx, c.req.valid('param').id);
    return c.json({ id, created }, created ? 201 : 200);
  });
