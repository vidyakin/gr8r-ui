/* Каталог: единицы ОКЕИ, дерево категорий, характеристики категорий (с наследованием), товары и услуги.
   Чтение — любой участник; единицы, категории и характеристики меняет admin и выше; товары — member и выше. */
import { zValidator } from '@hono/zod-validator';
import { asc, eq, inArray, max, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { attributeDefs, productCategories, products, recordEvent, units, uuidv7 } from '@gr8r/db';
import { attributeCreate, attributeUpdate, categoryCreate, categoryQuery, categoryUpdate, destroyQuery, idParam, keyFromName, productCreate, productQuery, productUpdate, unitCreate, unitQuery, unitUpdate, type RecordData } from '@gr8r/shared';
import { crud, ctxOf, validationHook } from '../crud';
import { AppError, notFound } from '../errors';
import { requireRole } from '../middleware';
import { assertAttributeKeyFree, assertUnit, chainIds, effectiveAttributes, loadCategory, subtreeWhere, validateAttrs } from '../catalog/service';
import { customForCreate, customForUpdate, mergeData } from '../meta/service';
import type { AppEnv } from '../types';

const admin = requireRole('admin');

/* ---------------- единицы ---------------- */

export const unitRoutes = crud({
  entity: 'unit',
  table: units,
  create: unitCreate,
  update: unitUpdate,
  query: unitQuery,
  sortable: { code: units.code, name: units.name, symbol: units.symbol, createdAt: units.createdAt },
  defaultSort: 'code',
  search: [units.code, units.name, units.symbol],
  writeRole: 'admin',
  beforeDelete: (_ctx, row) => {
    if (row.isBase) throw new AppError(422, 'base_unit', 'Base OKEI units cannot be deleted');
  },
});

/* ---------------- категории ---------------- */

const categoryParam = z.object({ id: idParam.shape.id });

export const categoryRoutes = new Hono<AppEnv>()
  // всё дерево плоским списком (путь — из id предков): интерфейс строит дерево сам; productCount — товары прямо в категории
  .get('/', zValidator('query', categoryQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const rows = await ctx.db.select().from(productCategories).orderBy(asc(productCategories.sortOrder), asc(productCategories.name));
    const counts = await ctx.db.select({ id: products.categoryId, n: sql<number>`count(*)::int` }).from(products).where(sql`${products.archivedAt} is null`).groupBy(products.categoryId);
    const n = new Map(counts.map(r => [r.id, r.n]));
    const items = rows.map(r => ({ ...r, productCount: n.get(r.id) ?? 0 }));
    return c.json({ items, total: items.length, limit: items.length, offset: 0 });
  })
  .get('/:id', zValidator('param', categoryParam, validationHook), async c => c.json(await loadCategory(ctxOf(c), c.req.valid('param').id)))
  .post('/', admin, zValidator('json', categoryCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const parent = body.parentId ? await loadCategory(ctx, body.parentId) : null;
    const id = body.id ?? uuidv7();
    const [ord] = await ctx.db.select({ m: max(productCategories.sortOrder) }).from(productCategories);
    const [row] = await ctx.db
      .insert(productCategories)
      .values({ id, workspaceId: ctx.workspaceId, parentId: parent?.id ?? null, name: body.name, path: parent ? `${parent.path}/${id}` : id, sortOrder: body.sortOrder ?? Number(ord?.m ?? 0) + 1 })
      .returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'product_category.created', entity: 'product_category', recordId: id, actorId: ctx.memberId, payload: { name: body.name } });
    return c.json(row!, 201);
  })
  .patch('/:id', admin, zValidator('param', categoryParam, validationHook), zValidator('json', categoryUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const cat = await loadCategory(ctx, c.req.valid('param').id);
    const set: Partial<typeof productCategories.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) set.name = body.name;
    if (body.sortOrder !== undefined) set.sortOrder = body.sortOrder;
    // Перенос: нельзя в себя и в своих потомков; пути всего поддерева пересчитываются; ключи характеристик не должны столкнуться
    if (body.parentId !== undefined && (body.parentId ?? null) !== cat.parentId) {
      const parent = body.parentId ? await loadCategory(ctx, body.parentId) : null;
      if (parent && (parent.id === cat.id || parent.path.startsWith(`${cat.path}/`))) throw new AppError(422, 'category_cycle', 'A category cannot be moved into itself or its own sub-categories');
      const newPath = parent ? `${parent.path}/${cat.id}` : cat.id;
      const moving = await ctx.db.select({ key: attributeDefs.key }).from(attributeDefs).innerJoin(productCategories, eq(productCategories.id, attributeDefs.categoryId)).where(subtreeWhere(cat.path));
      if (parent && moving.length) {
        const inherited = await ctx.db.select({ key: attributeDefs.key }).from(attributeDefs).where(inArray(attributeDefs.categoryId, chainIds(parent)));
        const taken = new Set(inherited.map(r => r.key));
        const clash = moving.find(r => taken.has(r.key));
        if (clash) throw new AppError(409, 'conflict', `Cannot move: the new parent already has a characteristic with the key "${clash.key}"`);
      }
      // Товары переносимого поддерева сохраняют значения характеристик, которых у новой цепочки может не быть — запрещаем такой перенос
      const lost = await lostAttributeKeys(ctx, cat, parent);
      if (lost.length) throw new AppError(422, 'attributes_in_use', `Cannot move: products in this branch use characteristics inherited from the current parent (${lost.join(', ')}). Clear those values first`, { keys: lost });
      set.parentId = parent?.id ?? null;
      set.path = newPath;
      await ctx.db.execute(sql`update product_categories set path = ${newPath} || substr(path, ${cat.path.length + 1}) where path like ${cat.path + '/%'}`);
    }
    const [row] = await ctx.db.update(productCategories).set(set).where(eq(productCategories.id, cat.id)).returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'product_category.updated', entity: 'product_category', recordId: cat.id, actorId: ctx.memberId, payload: { changes: Object.keys(body) } });
    return c.json(row!);
  })
  .delete('/:id', admin, zValidator('param', categoryParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const cat = await loadCategory(ctx, c.req.valid('param').id);
    const [{ kids }] = await ctx.db.select({ kids: sql<number>`count(*)::int` }).from(productCategories).where(eq(productCategories.parentId, cat.id));
    if (kids) throw new AppError(422, 'category_not_empty', 'Delete or move the sub-categories first');
    const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.categoryId, cat.id));
    if (n) throw new AppError(422, 'category_not_empty', `The category still has ${n} product${n === 1 ? '' : 's'}; move or delete them first`);
    await ctx.db.delete(productCategories).where(eq(productCategories.id, cat.id)); // характеристики уходят каскадом
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'product_category.deleted', entity: 'product_category', recordId: cat.id, actorId: ctx.memberId, payload: { name: cat.name } });
    return c.json({ id: cat.id, deleted: true as const });
  })
  // ---- характеристики: действующий набор категории вместе с унаследованными ----
  .get('/:id/attributes', zValidator('param', categoryParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const items = await effectiveAttributes(ctx, await loadCategory(ctx, c.req.valid('param').id));
    return c.json({ items, total: items.length, limit: items.length, offset: 0 });
  })
  .post('/:id/attributes', admin, zValidator('param', categoryParam, validationHook), zValidator('json', attributeCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const cat = await loadCategory(ctx, c.req.valid('param').id);
    const key = body.key ?? keyFromName(body.name, 'attr');
    await assertAttributeKeyFree(ctx, cat, key);
    const [ord] = await ctx.db.select({ m: max(attributeDefs.sortOrder) }).from(attributeDefs).where(eq(attributeDefs.categoryId, cat.id));
    const [row] = await ctx.db
      .insert(attributeDefs)
      .values({ ...(body.id ? { id: body.id } : {}), workspaceId: ctx.workspaceId, categoryId: cat.id, key, name: body.name, type: body.type, required: body.required, unit: body.unit, options: body.options, sortOrder: Number(ord?.m ?? -1) + 1 })
      .returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'attribute_def.created', entity: 'attribute_def', recordId: row!.id, actorId: ctx.memberId, payload: { category: cat.id, key } });
    return c.json({ ...row!, inherited: false, categoryName: cat.name }, 201);
  });

/** Ключи характеристик, значения которых есть у товаров поддерева и которые пропадут из цепочки после переноса */
async function lostAttributeKeys(ctx: ReturnType<typeof ctxOf>, cat: typeof productCategories.$inferSelect, newParent: typeof productCategories.$inferSelect | null): Promise<string[]> {
  const oldParentChain = cat.parentId ? chainIds(cat).slice(0, -1) : [];
  if (!oldParentChain.length) return [];
  const keep = new Set(newParent ? (await ctx.db.select({ key: attributeDefs.key }).from(attributeDefs).where(inArray(attributeDefs.categoryId, chainIds(newParent)))).map(r => r.key) : []);
  const oldKeys = (await ctx.db.select({ key: attributeDefs.key }).from(attributeDefs).where(inArray(attributeDefs.categoryId, oldParentChain))).map(r => r.key).filter(k => !keep.has(k));
  if (!oldKeys.length) return [];
  const used: string[] = [];
  for (const k of oldKeys) {
    const rows = await ctx.db.execute(sql`select 1 from products p join product_categories c on c.id = p.category_id where jsonb_exists(p.attrs, ${k}::text) and (c.path = ${cat.path} or c.path like ${cat.path + '/%'}) limit 1`);
    if (rows.length) used.push(k);
  }
  return used;
}

/** Правка и удаление характеристики по её id */
export const attributeRoutes = new Hono<AppEnv>()
  .patch('/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', attributeUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const [a] = await ctx.db.select().from(attributeDefs).where(eq(attributeDefs.id, c.req.valid('param').id)).limit(1).for('update');
    if (!a) throw notFound('attribute');
    // Параметры проверяются теми же правилами, что и при создании (варианты select…)
    const check = attributeCreate.safeParse({ name: body.name ?? a.name, type: a.type, options: body.options ?? a.options, unit: body.unit ?? a.unit });
    if (!check.success) validationHook({ success: false, error: check.error });
    const [row] = await ctx.db
      .update(attributeDefs)
      .set({ ...(body.name !== undefined ? { name: body.name } : {}), ...(body.required !== undefined ? { required: body.required } : {}), ...(body.unit !== undefined ? { unit: body.unit } : {}), ...(body.options ? { options: body.options } : {}), ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}), updatedAt: new Date() })
      .where(eq(attributeDefs.id, a.id))
      .returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'attribute_def.updated', entity: 'attribute_def', recordId: a.id, actorId: ctx.memberId, payload: { changes: Object.keys(body) } });
    return c.json(row!);
  })
  // Удаление необратимо: значения характеристики стираются у товаров всей ветки. Подтверждение — ?confirm=<ключ>
  .delete('/:id', admin, zValidator('param', idParam, validationHook), zValidator('query', destroyQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const [a] = await ctx.db.select().from(attributeDefs).where(eq(attributeDefs.id, c.req.valid('param').id)).limit(1).for('update');
    if (!a) throw notFound('attribute');
    if (c.req.valid('query').confirm !== a.key) throw new AppError(400, 'confirmation_required', `Confirm deleting characteristic "${a.name}" by passing confirm=${a.key}`);
    const cat = await loadCategory(ctx, a.categoryId);
    const cleared = await ctx.db.execute(
      sql`update products set attrs = attrs - ${a.key}::text where jsonb_exists(attrs, ${a.key}::text) and category_id in (select id from product_categories where path = ${cat.path} or path like ${cat.path + '/%'})`,
    );
    await ctx.db.delete(attributeDefs).where(eq(attributeDefs.id, a.id));
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'attribute_def.deleted', entity: 'attribute_def', recordId: a.id, actorId: ctx.memberId, payload: { category: cat.id, key: a.key, cleared: cleared.count } });
    return c.json({ id: a.id, deleted: true as const, cleared: cleared.count });
  });

/* ---------------- товары и услуги ---------------- */

export const productRoutes = crud({
  entity: 'product',
  table: products,
  create: productCreate,
  update: productUpdate,
  query: productQuery,
  sortable: { name: products.name, sku: products.sku, kind: products.kind, price: products.price, purchasePrice: products.purchasePrice, createdAt: products.createdAt, updatedAt: products.updatedAt },
  defaultSort: 'name',
  search: [products.name, products.sku, products.barcode],
  filters: q => [
    q.kind ? eq(products.kind, q.kind) : undefined,
    q.active !== undefined ? eq(products.isActive, q.active) : undefined,
    q.categoryId
      ? q.subtree === false
        ? eq(products.categoryId, q.categoryId)
        : sql`${products.categoryId} in (select c.id from product_categories c, product_categories r where r.id = ${q.categoryId} and (c.path = r.path or c.path like r.path || '/%'))`
      : undefined,
  ],
  prepareCreate: async (ctx, body) => {
    await assertUnit(ctx, body.unitCode);
    const cat = body.categoryId ? await loadCategory(ctx, body.categoryId) : null;
    const attrs = validateAttrs(cat ? await effectiveAttributes(ctx, cat) : [], body.attrs, 'create');
    return { attrs, ...(await customForCreate(ctx, 'product', body.custom)) };
  },
  prepareUpdate: async (ctx, existing, body) => {
    if (body.unitCode !== undefined && body.unitCode !== existing.unitCode) await assertUnit(ctx, body.unitCode);
    const out: Record<string, unknown> = { ...(await customForUpdate(ctx, 'product', existing.custom, body.custom, existing.id)) };
    const categoryChanged = body.categoryId !== undefined && (body.categoryId ?? null) !== existing.categoryId;
    if (categoryChanged || body.attrs !== undefined) {
      const catId = categoryChanged ? (body.categoryId ?? null) : existing.categoryId;
      const defs = catId ? await effectiveAttributes(ctx, await loadCategory(ctx, catId)) : [];
      if (categoryChanged) {
        // Новая схема: итог (имеющиеся значения + присланные, null убирает ключ) проверяется целиком, как при создании
        const merged = mergeData(existing.attrs, (body.attrs ?? {}) as RecordData);
        out.attrs = validateAttrs(defs, merged, 'create');
      } else {
        // Та же категория: проверяются только изменённые ключи (старые значения не перепроверяются), null убирает ключ
        const input = (body.attrs ?? {}) as Record<string, unknown>;
        const changed = Object.fromEntries(Object.entries(input).filter(([k, v]) => (v === null ? existing.attrs[k] !== undefined : JSON.stringify(v) !== JSON.stringify(existing.attrs[k]))));
        out.attrs = mergeData(existing.attrs, validateAttrs(defs, changed, 'patch'));
      }
    }
    return out;
  },
});
