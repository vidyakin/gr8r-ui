/* Производство: участки, продукция (изделия и полуфабрикаты), спецификации (строки material / semi / work), расчёт
   себестоимости и настройки. Чтение — любой участник; участки и настройки меняет admin и выше; продукцию и спецификации — member и выше.
   Расчёт — та же чистая функция `computeBomCost`, что и в интерфейсе (packages/shared/src/bom.ts). */
import { zValidator } from '@hono/zod-validator';
import { asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { bomLines, loadAvgCosts, manufacturedItems, products, recordEvent, stockBalances, stockReservations, warehouses, workCenters, workspaces } from '@gr8r/db';
import {
  bomLineCreate,
  bomLineUpdate,
  bomReorder,
  computeBomCost,
  computeNeeds,
  explodeBom,
  explodeQuery,
  idParam,
  itemCreate,
  itemQuery,
  itemUpdate,
  MATERIAL_PRICE_SOURCES,
  productionSettingsUpdate,
  resolveMaterialPrice,
  wouldCreateCycle,
  workCenterCreate,
  workCenterQuery,
  workCenterUpdate,
  BomCycleError,
  type BomItemInput,
  type Explosion,
  type MaterialPriceSource,
  type ProductionSettings,
} from '@gr8r/shared';
import { crud, ctxOf, validationHook, type Ctx } from '../crud';
import { AppError, notFound } from '../errors';
import { requireRole } from '../middleware';
import { assertUnit } from '../catalog/service';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const write = requireRole('member');

export type ItemRow = typeof manufacturedItems.$inferSelect;
export type LineRow = typeof bomLines.$inferSelect;

/* ---------------- настройки ---------------- */

export async function loadSettings(ctx: Ctx): Promise<ProductionSettings> {
  const [ws] = await ctx.db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId)).limit(1);
  const v = ws?.settings?.materialPriceSource;
  return { materialPriceSource: MATERIAL_PRICE_SOURCES.includes(v as MaterialPriceSource) ? (v as MaterialPriceSource) : 'purchase' };
}

/* ---------------- участки ---------------- */

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

export const toInput = (item: ItemRow, lines: LineRow[]): BomItemInput => ({
  id: item.id,
  name: item.name,
  unitCode: item.unitCode,
  productId: item.productId,
  batchQty: item.batchQty,
  overheadPct: item.overheadPct,
  lines: lines.map(l => ({ id: l.id, kind: l.kind, qty: l.qty, productId: l.productId, scrapPct: l.scrapPct, unitCode: l.unitCode, childItemId: l.childItemId, semiMode: l.semiMode, operation: l.operation, workCenterId: l.workCenterId, hours: l.hours, rate: l.rate, fixedCost: l.fixedCost })),
});

/* ---------------- продукция и спецификации ---------------- */

const lineParam = idParam;

/** Проверка строки перед записью: ссылки, единица, запрет циклов. Возвращает колонки, которые определяет сервер */
async function checkLine(ctx: Ctx, itemId: string, l: Pick<LineRow, 'kind' | 'productId' | 'childItemId' | 'workCenterId' | 'operation'>): Promise<{ unitCode: string | null }> {
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
  if (l.workCenterId) {
    const [wc] = await ctx.db.select({ id: workCenters.id }).from(workCenters).where(eq(workCenters.id, l.workCenterId)).limit(1);
    if (!wc) throw new AppError(422, 'invalid_reference', 'The work center does not exist', { issues: [{ path: 'workCenterId', message: 'Work center not found' }] });
  }
  return { unitCode: null };
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
  filters: q => [q.kind ? eq(manufacturedItems.kind, q.kind) : undefined],
  prepareCreate: async (ctx, body) => {
    await assertUnit(ctx, body.unitCode);
    return {};
  },
  prepareUpdate: async (ctx, existing, body) => {
    if (body.unitCode !== undefined && body.unitCode !== existing.unitCode) await assertUnit(ctx, body.unitCode);
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
    const base = { kind: body.kind, productId: body.kind === 'material' ? (body.productId ?? null) : null, childItemId: body.kind === 'semi' ? (body.childItemId ?? null) : null, semiMode: body.kind === 'semi' ? (body.semiMode ?? 'stock') : null, workCenterId: body.kind === 'work' ? (body.workCenterId ?? null) : null, operation: body.operation ?? '' };
    const { unitCode } = await checkLine(ctx, item.id, base);
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
    try {
      const tree = computeBomCost(g.items.map(i => toInput(i, byItem.get(i.id) ?? [])), id, {
        materialPrice: pid => (prod.has(pid) ? resolveMaterialPrice(settings.materialPriceSource, prod.get(pid)!, g.avg.get(pid)) : null),
        workCenterRate: wid => rates.get(wid),
      });
      return c.json({ itemId: id, source: settings.materialPriceSource, tree });
    } catch (e) {
      if (e instanceof BomCycleError) throw new AppError(422, 'bom_cycle', e.message, { path: e.path });
      throw e;
    }
  })
  // развёртка спецификации на количество и потребность с учётом остатков: нужно / доступно / дефицит
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
    let explosion: Explosion;
    try {
      explosion = explodeBom(g.items.map(i => toInput(i, byItem.get(i.id) ?? [])), id, q.qty);
    } catch (e) {
      if (e instanceof BomCycleError) throw new AppError(422, 'bom_cycle', e.message, { path: e.path });
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
      semis: needs.semis.map(s => ({ ...s, name: items.get(s.itemId ?? '')?.name ?? s.itemId, unitCode: items.get(s.itemId ?? '')?.unitCode ?? null })),
      works: needs.works,
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
    const foreign: Record<LineRow['kind'], string[]> = { material: ['childItemId', 'semiMode', 'operation', 'workCenterId', 'hours', 'rate', 'fixedCost'], semi: ['productId', 'scrapPct', 'operation', 'workCenterId', 'hours', 'rate', 'fixedCost'], work: ['productId', 'childItemId', 'semiMode', 'qty', 'scrapPct'] };
    const bad = foreign[line.kind].find(k => (body as Record<string, unknown>)[k] !== undefined);
    if (bad) throw new AppError(400, 'validation_error', `${bad}: not applicable to a ${line.kind} line`, { issues: [{ path: bad, message: `Not applicable to a ${line.kind} line` }] });
    const next = { ...line, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) } as LineRow;
    if (line.kind === 'work' && !(Number(next.hours) > 0 || Number(next.fixedCost ?? 0) > 0)) throw new AppError(400, 'validation_error', 'hours: Set hours or a fixed cost', { issues: [{ path: 'hours', message: 'Set hours or a fixed cost' }] });
    const refChanged = next.productId !== line.productId || next.childItemId !== line.childItemId || next.workCenterId !== line.workCenterId;
    const { unitCode } = refChanged ? await checkLine(ctx, line.itemId, next) : { unitCode: line.unitCode };
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
      items: g.items.map(i => ({ ...i, lines: byItem.get(i.id) ?? [] })),
      workCenters: g.centers.filter(w => !w.archivedAt || g.lines.some(l => l.workCenterId === w.id)),
      materials: g.mats.map(p => ({ id: p.id, name: p.name, sku: p.sku, kind: p.kind, unitCode: p.unitCode, price: p.price, purchasePrice: p.purchasePrice, avgCost: g.avg.get(p.id) ?? null, archived: !!p.archivedAt })),
    });
  })
  .get('/settings', async c => c.json(await loadSettings(ctxOf(c))))
  .patch('/settings', admin, zValidator('json', productionSettingsUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await ctx.db.update(workspaces).set({ settings: sql`${workspaces.settings} || ${JSON.stringify(body)}::jsonb`, updatedAt: new Date() }).where(eq(workspaces.id, ctx.workspaceId));
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'workspace.updated', entity: 'workspace', recordId: ctx.workspaceId, actorId: ctx.memberId, payload: { changes: body } });
    return c.json(await loadSettings(ctx));
  });
