/* Документы публичного REST API v1 (задача 1392): список, карточка, создание, редактирование и проведение. */
import { zValidator } from '@hono/zod-validator';
import { and, count, desc, eq, gte, ilike, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  assertApproved,
  assertWorkOrderPostingByState,
  canSeeCost,
  companies,
  createDocument,
  documentDetail,
  maskDocumentKitCosts,
  documents,
  organizations,
  postDocument,
  updateDocument,
  warehouses,
} from '@erp/db';
import { assertNoHiddenFieldWrite, maskFields, maskRows, documentCreate, documentUpdate, idParam, isCashDocType, type DocumentType } from '@erp/shared';
import { ctxOf, escapeLike, validationHook, type Ctx } from '../../crud';
import { hiddenFieldsOf, requireVisibleFields } from '../../field-access';
import { AppError, notFound } from '../../errors';
import { requireRole } from '../../middleware';
import type { AppEnv } from '../../types';
import { parseUpdatedSince, requireV1Scope, v1DocumentQuery } from './auth';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });
const isInternal = (t: string) => t === 'stock_transfer' || t === 'write_off' || t === 'stock_posting' || t === 'opening_stock';

async function documentTypeOf(ctx: Ctx, id: string): Promise<string> {
  const [d] = await ctx.db.select({ type: documents.type }).from(documents).where(eq(documents.id, id)).limit(1);
  if (!d) throw notFound('document');
  return d.type;
}

export const v1DocumentRoutes = new Hono<AppEnv>()
  .use('*', requireV1Scope('/documents', 'trade'))
  .get('/documents', zValidator('query', v1DocumentQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const hidden = await hiddenFieldsOf(ctx);
    const since = parseUpdatedSince(q.updatedSince);
    const conds: (SQL | undefined)[] = [
      q.type ? eq(documents.type, q.type as DocumentType) : undefined,
      q.status ? eq(documents.status, q.status) : undefined,
      q.counterpartyId ? eq(documents.counterpartyId, q.counterpartyId) : undefined,
      q.warehouseId ? eq(documents.warehouseId, q.warehouseId) : undefined,
      q.dateFrom ? sql`${documents.date} >= ${q.dateFrom}` : undefined,
      q.dateTo ? sql`${documents.date} <= ${q.dateTo}` : undefined,
      since ? gte(documents.updatedAt, since) : undefined,
      q.q ? or(ilike(documents.number, `%${escapeLike(q.q)}%`), ilike(documents.comment, `%${escapeLike(q.q)}%`), ilike(companies.name, `%${escapeLike(q.q)}%`)) : undefined,
    ];
    const where = and(...conds);
    const totalQ = ctx.db.select({ n: count() }).from(documents);
    const [{ n }] = await (q.q ? totalQ.leftJoin(companies, eq(companies.id, documents.counterpartyId)) : totalQ).where(where);
    const rows = await ctx.db
      .select({
        doc: documents,
        counterpartyName: companies.name,
        organizationName: organizations.name,
        warehouseName: warehouses.name,
      })
      .from(documents)
      .leftJoin(companies, eq(companies.id, documents.counterpartyId))
      .innerJoin(organizations, eq(organizations.id, documents.organizationId))
      .leftJoin(warehouses, eq(warehouses.id, documents.warehouseId))
      .where(where)
      .orderBy(desc(documents.date), desc(documents.createdAt), desc(documents.id))
      .limit(q.limit)
      .offset(q.offset);
    const items = rows.map(({ doc: { custom: _custom, ...doc }, ...r }) => ({ ...doc, ...r }));
    return c.json({ items: maskRows('document', items, hidden), total: n, limit: q.limit, offset: q.offset });
  })
  .get('/documents/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const hidden = await hiddenFieldsOf(ctx);
    const detail = maskDocumentKitCosts(await documentDetail(ctx.db, c.req.valid('param').id), canSeeCost(ctx.role), !hidden.includes('document.total'));
    if (isInternal(detail.type) && !canSeeCost(ctx.role)) {
      return c.json(maskFields('document', { ...detail, lines: detail.lines.map(l => ({ ...l, price: '0.00' })), costTotal: null }, hidden));
    }
    return c.json(maskFields('document', detail, hidden));
  })
  .post('/documents', write, zValidator('json', documentCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    requireVisibleFields(assertNoHiddenFieldWrite('document', await c.req.json(), await hiddenFieldsOf(ctx)));
    if (
      body.type === 'production' ||
      body.type === 'production_order' ||
      body.type === 'other_costs' ||
      body.type === 'material_allocation' ||
      body.type === 'sales_plan' ||
      body.type === 'service_day' ||
      body.type === 'price_setting' ||
      body.type === 'landed_cost' ||
      isCashDocType(body.type)
    ) {
      throw new AppError(422, 'production_api_only', 'This document type must be created via its dedicated API');
    }
    const id = await createDocument(ctx.db, docCtx(ctx), body);
    const hidden = await hiddenFieldsOf(ctx);
    return c.json(maskFields('document', maskDocumentKitCosts(await documentDetail(ctx.db, id), canSeeCost(ctx.role), !hidden.includes('document.total')), hidden), 201);
  })
  .patch('/documents/:id', write, zValidator('param', idParam, validationHook), zValidator('json', documentUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const type = await documentTypeOf(ctx, id);
    if (type === 'price_setting') throw new AppError(422, 'pricing_api_only', 'The price setting is edited through /pricing/settings');
    if (isCashDocType(type)) throw new AppError(422, 'payments_api_only', 'Payment documents are edited through /payments');
    requireVisibleFields(assertNoHiddenFieldWrite('document', await c.req.json(), await hiddenFieldsOf(ctx)));
    await updateDocument(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    const hidden = await hiddenFieldsOf(ctx);
    return c.json(maskFields('document', maskDocumentKitCosts(await documentDetail(ctx.db, id), canSeeCost(ctx.role), !hidden.includes('document.total')), hidden));
  })
  .post('/documents/:id/post', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const type = (await documentTypeOf(ctx, id)) as DocumentType;
    assertWorkOrderPostingByState(type);
    if (type !== 'payment_request') await assertApproved(ctx.db, { kind: 'document', id });
    const warnings = await postDocument(ctx.db, docCtx(ctx), id);
    const hidden = await hiddenFieldsOf(ctx);
    return c.json(maskFields('document', { ...maskDocumentKitCosts(await documentDetail(ctx.db, id), canSeeCost(ctx.role), !hidden.includes('document.total')), warnings }, hidden));
  });
