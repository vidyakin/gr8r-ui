/* Чтение справочников, остатков и цен для публичного REST API v1 (задача 1392). */
import { zValidator } from '@hono/zod-validator';
import { and, asc, count, eq, gte, ilike, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { canSeeCost, companies, priceListKinds, priceListRows, products, stockBalances, stockReservations, warehouses } from '@erp/db';
import { idParam, maskFields, maskRows } from '@erp/shared';
import { ctxOf, escapeLike, validationHook } from '../../crud';
import { hiddenFieldsOf } from '../../field-access';
import { notFound } from '../../errors';
import type { AppEnv } from '../../types';
import { parseUpdatedSince, requireV1Scope, v1CompanyQuery, v1PriceQuery, v1ProductQuery, v1StockQuery, v1WarehouseQuery } from './auth';

const today = () => new Date().toISOString().slice(0, 10);

export const v1CatalogRoutes = new Hono<AppEnv>()
  /* ---------- Products ---------- */
  .get('/products', requireV1Scope('/products', 'core'), zValidator('query', v1ProductQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const since = parseUpdatedSince(q.updatedSince);
    const where = and(
      isNull(products.archivedAt),
      q.sku ? eq(products.sku, q.sku) : undefined,
      q.categoryId ? eq(products.categoryId, q.categoryId) : undefined,
      q.kind ? eq(products.kind, q.kind) : undefined,
      q.active !== undefined ? eq(products.isActive, q.active) : undefined,
      since ? gte(products.updatedAt, since) : undefined,
      q.q ? or(ilike(products.name, `%${escapeLike(q.q)}%`), ilike(products.sku, `%${escapeLike(q.q)}%`), ilike(products.barcode, `%${escapeLike(q.q)}%`)) : undefined,
    );
    const [{ n }] = await ctx.db.select({ n: count() }).from(products).where(where);
    const items = await ctx.db.select().from(products).where(where).orderBy(asc(products.name), asc(products.id)).limit(q.limit).offset(q.offset);
    return c.json({ items: maskRows('product', items, await hiddenFieldsOf(ctx)), total: n, limit: q.limit, offset: q.offset });
  })
  .get('/products/:id', requireV1Scope('/products', 'core'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const [row] = await ctx.db.select().from(products).where(eq(products.id, c.req.valid('param').id)).limit(1);
    if (!row) throw notFound('product');
    return c.json(maskFields('product', row, await hiddenFieldsOf(ctx)));
  })
  /* ---------- Stock ---------- */
  .get('/stock', requireV1Scope('/stock', 'trade'), zValidator('query', v1StockQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const reserved = sql<string>`coalesce((select sum(r.qty) from ${stockReservations} r where r.warehouse_id = ${stockBalances.warehouseId} and r.product_id = ${stockBalances.productId}), 0)`;
    const where = and(
      q.warehouseId ? eq(stockBalances.warehouseId, q.warehouseId) : undefined,
      q.productId ? eq(stockBalances.productId, q.productId) : undefined,
      q.nonZero ? sql`${stockBalances.qty} <> 0` : undefined,
      q.q ? or(ilike(products.name, `%${escapeLike(q.q)}%`), ilike(products.sku, `%${escapeLike(q.q)}%`)) : undefined,
    );
    const rows = await ctx.db
      .select({
        warehouseId: stockBalances.warehouseId,
        warehouseName: warehouses.name,
        productId: stockBalances.productId,
        name: products.name,
        sku: products.sku,
        unitCode: products.unitCode,
        qty: stockBalances.qty,
        reserved: sql<string>`${reserved}::numeric(18,3)::text`,
        available: sql<string>`(${stockBalances.qty} - ${reserved})::numeric(18,3)::text`,
        avgCost: stockBalances.avgCost,
      })
      .from(stockBalances)
      .innerJoin(products, eq(products.id, stockBalances.productId))
      .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
      .where(where)
      .orderBy(asc(products.name), asc(warehouses.name))
      .limit(q.limit)
      .offset(q.offset);
    const [{ n }] = await ctx.db.select({ n: count() }).from(stockBalances).innerJoin(products, eq(products.id, stockBalances.productId)).where(where);
    const seeCost = canSeeCost(ctx.role);
    return c.json({ items: rows.map(r => (seeCost ? r : { ...r, avgCost: null })), total: n, limit: q.limit, offset: q.offset });
  })
  /* ---------- Prices ---------- */
  .get('/prices', requireV1Scope('/pricing', 'trade'), zValidator('query', v1PriceQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const kindIds = q.kindId ? [q.kindId] : undefined;
    const kinds = await priceListKinds(ctx.db, ctx.workspaceId, kindIds, canSeeCost(ctx.role));
    const date = q.date ?? today();
    const list = await priceListRows(ctx.db, ctx.workspaceId, kinds, { kindIds, categoryId: q.categoryId, date, inStock: q.inStock, q: q.q, limit: q.limit, offset: q.offset });
    return c.json({ date, kinds: kinds.map(k => ({ id: k.id, name: k.name })), items: list.rows, total: list.total, limit: q.limit, offset: q.offset });
  })
  /* ---------- Companies ---------- */
  .get('/companies', requireV1Scope('/companies', 'core'), zValidator('query', v1CompanyQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const since = parseUpdatedSince(q.updatedSince);
    const hidden = await hiddenFieldsOf(ctx);
    const seeRequisites = !hidden.includes('company.requisites');
    const where = and(
      isNull(companies.archivedAt),
      q.role === 'customer' ? eq(companies.isCustomer, true) : q.role === 'supplier' ? eq(companies.isSupplier, true) : undefined,
      q.inn && seeRequisites ? eq(companies.inn, q.inn) : undefined,
      since ? gte(companies.updatedAt, since) : undefined,
      q.q ? or(ilike(companies.name, `%${escapeLike(q.q)}%`), seeRequisites ? ilike(companies.inn, `%${escapeLike(q.q)}%`) : undefined, ilike(companies.city, `%${escapeLike(q.q)}%`)) : undefined,
    );
    const [{ n }] = await ctx.db.select({ n: count() }).from(companies).where(where);
    const items = await ctx.db.select().from(companies).where(where).orderBy(asc(companies.name), asc(companies.id)).limit(q.limit).offset(q.offset);
    return c.json({ items: maskRows('company', items, hidden), total: n, limit: q.limit, offset: q.offset });
  })
  .get('/companies/:id', requireV1Scope('/companies', 'core'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const [row] = await ctx.db.select().from(companies).where(eq(companies.id, c.req.valid('param').id)).limit(1);
    if (!row) throw notFound('company');
    return c.json(maskFields('company', row, await hiddenFieldsOf(ctx)));
  })
  /* ---------- Warehouses ---------- */
  .get('/warehouses', requireV1Scope('/warehouses', 'core'), zValidator('query', v1WarehouseQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const since = parseUpdatedSince(q.updatedSince);
    const where = and(
      isNull(warehouses.archivedAt),
      since ? gte(warehouses.updatedAt, since) : undefined,
      q.q ? or(ilike(warehouses.name, `%${escapeLike(q.q)}%`), ilike(warehouses.code, `%${escapeLike(q.q)}%`)) : undefined,
    );
    const [{ n }] = await ctx.db.select({ n: count() }).from(warehouses).where(where);
    const items = await ctx.db.select().from(warehouses).where(where).orderBy(asc(warehouses.name), asc(warehouses.id)).limit(q.limit).offset(q.offset);
    return c.json({ items, total: n, limit: q.limit, offset: q.offset });
  });
