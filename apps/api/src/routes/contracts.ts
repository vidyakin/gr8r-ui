/* Договоры и тарифные планы (этап 8 «УНФ: Услуги»).
   Чтение — любой участник; договоры и тарифные планы меняет member и выше.
   Правила — packages/db/src/contracts.ts и packages/shared/src/billing.ts. */
import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  companies,
  contractDetail,
  contracts,
  duplicateContractNumbers,
  listContracts,
  organizations,
  saveTariffPlanLines,
  tariffPlans,
  tariffPlanLinesOf,
} from '@gr8r/db';
import { contractCreate, contractQuery, contractUpdate, idParam, tariffPlanCreate, tariffPlanLinesUpdate, tariffPlanQuery, tariffPlanUpdate } from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { AppError, notFound } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const admin = requireRole('admin');

/** Организация по умолчанию — если не указана */
async function defaultOrganization(ctx: Ctx): Promise<string> {
  const [o] = await ctx.db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.archivedAt)).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
  if (!o) throw new AppError(422, 'organization_required', 'Add an organization in Settings → Organizations first');
  return o.id;
}

/** Проверки договора: договор обслуживания требует тарифный план и периодичность */
function assertContract(body: { isService?: boolean; tariffPlanId?: string | null; periodicity?: string | null; validFrom?: string; validTo?: string | null }) {
  if (body.isService) {
    if (!body.tariffPlanId) throw new AppError(422, 'tariff_plan_required', 'A service contract needs a tariff plan');
    if (!body.periodicity) throw new AppError(422, 'periodicity_required', 'A service contract needs a billing periodicity');
  }
  if (body.validFrom && body.validTo && body.validTo < body.validFrom) throw new AppError(422, 'invalid_period', 'The contract end date is earlier than its start date');
}

/** Договор по умолчанию — один на контрагента */
async function clearDefault(ctx: Ctx, companyId: string, exceptId?: string) {
  await ctx.db.update(contracts).set({ isDefault: false }).where(and(eq(contracts.companyId, companyId), exceptId ? ne(contracts.id, exceptId) : undefined));
}

/** Карточка договора с названиями и предупреждениями (совпадающий номер — предупреждение, не ошибка) */
async function decorate(ctx: Ctx, row: typeof contracts.$inferSelect) {
  const [company] = await ctx.db.select({ name: companies.name }).from(companies).where(eq(companies.id, row.companyId)).limit(1);
  const [org] = await ctx.db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, row.organizationId)).limit(1);
  const [plan] = row.tariffPlanId ? await ctx.db.select({ name: tariffPlans.name, extraProductPolicy: tariffPlans.extraProductPolicy }).from(tariffPlans).where(eq(tariffPlans.id, row.tariffPlanId)).limit(1) : [];
  const duplicates = await duplicateContractNumbers(ctx.db, row.companyId, row.number, row.id);
  const warnings = duplicates.length ? [`The contract number ${row.number} is already used by another contract`] : [];
  return { ...row, companyName: company?.name ?? '', organizationName: org?.name ?? '', tariffPlanName: plan?.name ?? null, extraProductPolicy: plan?.extraProductPolicy ?? 'allow', warnings };
}

export const contractRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', contractQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query' as never) as { companyId?: string; kind?: string; isService?: boolean; q?: string; archived?: 'true' | 'false'; limit: number; offset: number };
    const items = await listContracts(ctx.db, { workspaceId: ctx.workspaceId, companyId: q.companyId, kind: q.kind, isService: q.isService, q: q.q, archived: q.archived === 'true' });
    return c.json({ items: items.slice(q.offset, q.offset + q.limit), total: items.length, limit: q.limit, offset: q.offset });
  })
  .post('/', write, zValidator('json', contractCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json' as never) as z.infer<typeof contractCreate>;
    assertContract(body);
    const organizationId = body.organizationId ?? (await defaultOrganization(ctx));
    if (body.isDefault) await clearDefault(ctx, body.companyId);
    const [row] = await ctx.db
      .insert(contracts)
      .values({
        ...(body.id ? { id: body.id } : {}),
        workspaceId: ctx.workspaceId,
        companyId: body.companyId,
        organizationId,
        number: body.number,
        date: body.date,
        kind: body.kind,
        category: body.category,
        isSigned: body.isSigned,
        isDefault: body.isDefault ?? false,
        validFrom: body.validFrom,
        validTo: body.validTo ?? null,
        paymentDays: body.paymentDays,
        priceType: body.priceType,
        priceKindId: body.priceKindId ?? null,
        isService: body.isService,
        tariffPlanId: body.tariffPlanId ?? null,
        periodicity: body.periodicity ?? null,
        billingDay: body.billingDay,
        documentPackage: body.documentPackage,
        note: body.note,
      })
      .returning();
    return c.json(await decorate(ctx, row!), 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const detail = await contractDetail(ctx.db, id);
    if (!detail) throw notFound('contract');
    return c.json(detail);
  })
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', contractUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const body = c.req.valid('json' as never) as z.infer<typeof contractUpdate>;
    const [existing] = await ctx.db.select().from(contracts).where(and(eq(contracts.id, id), eq(contracts.workspaceId, ctx.workspaceId))).limit(1);
    if (!existing) throw notFound('contract');
    assertContract({ isService: body.isService ?? existing.isService, tariffPlanId: body.tariffPlanId ?? existing.tariffPlanId, periodicity: body.periodicity ?? existing.periodicity, validFrom: body.validFrom ?? existing.validFrom, validTo: body.validTo === undefined ? existing.validTo : body.validTo });
    if (body.isDefault === true) await clearDefault(ctx, existing.companyId, id);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['number', 'date', 'kind', 'category', 'isSigned', 'isDefault', 'validFrom', 'validTo', 'paymentDays', 'priceType', 'priceKindId', 'isService', 'tariffPlanId', 'periodicity', 'billingDay', 'documentPackage', 'note'] as const) {
      if (body[key] !== undefined) patch[key] = body[key] === null ? null : body[key];
    }
    if (body.organizationId) patch.organizationId = body.organizationId;
    const [after] = await ctx.db.update(contracts).set(patch as never).where(eq(contracts.id, id)).returning();
    return c.json(await decorate(ctx, after!));
  })
  .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const [existing] = await ctx.db.select().from(contracts).where(and(eq(contracts.id, id), eq(contracts.workspaceId, ctx.workspaceId))).limit(1);
    if (!existing) throw notFound('contract');
    await ctx.db.update(contracts).set({ archivedAt: new Date(), isDefault: false, updatedAt: new Date() }).where(eq(contracts.id, id));
    return c.json({ id, deleted: false as const, archived: true as const });
  })
  .post('/:id/restore', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const [row] = await ctx.db.update(contracts).set({ archivedAt: null, updatedAt: new Date() }).where(and(eq(contracts.id, id), eq(contracts.workspaceId, ctx.workspaceId))).returning();
    if (!row) throw notFound('contract');
    return c.json(await decorate(ctx, row));
  });

/* ---------------- тарифные планы ---------------- */

export const tariffPlanRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', tariffPlanQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query' as never) as { q?: string; limit: number; offset: number };
    const conds = [eq(tariffPlans.workspaceId, ctx.workspaceId), isNull(tariffPlans.archivedAt)];
    if (q.q) conds.push(or(sql`${tariffPlans.name} ilike ${'%' + q.q + '%'}`, sql`${tariffPlans.note} ilike ${'%' + q.q + '%'}`)!);
    const rows = await ctx.db.select().from(tariffPlans).where(and(...conds)).orderBy(asc(tariffPlans.name)).limit(q.limit).offset(q.offset);
    const items = await Promise.all(rows.map(async r => ({ ...r, lines: await tariffPlanLinesOf(ctx.db, r.id) })));
    return c.json({ items, total: items.length, limit: q.limit, offset: q.offset });
  })
  .post('/', admin, zValidator('json', tariffPlanCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json' as never) as z.infer<typeof tariffPlanCreate>;
    const [row] = await ctx.db.insert(tariffPlans).values({ ...(body.id ? { id: body.id } : {}), workspaceId: ctx.workspaceId, name: body.name, extraProductPolicy: body.extraProductPolicy, note: body.note }).returning();
    return c.json({ ...row!, lines: [] }, 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const [row] = await ctx.db.select().from(tariffPlans).where(and(eq(tariffPlans.id, id), eq(tariffPlans.workspaceId, ctx.workspaceId))).limit(1);
    if (!row) throw notFound('tariff plan');
    return c.json({ ...row, lines: await tariffPlanLinesOf(ctx.db, id) });
  })
  .patch('/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', tariffPlanUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const body = c.req.valid('json' as never) as z.infer<typeof tariffPlanUpdate>;
    const [row] = await ctx.db.update(tariffPlans).set({ ...(body.name !== undefined ? { name: body.name } : {}), ...(body.extraProductPolicy !== undefined ? { extraProductPolicy: body.extraProductPolicy } : {}), ...(body.note !== undefined ? { note: body.note } : {}), updatedAt: new Date() }).where(and(eq(tariffPlans.id, id), eq(tariffPlans.workspaceId, ctx.workspaceId))).returning();
    if (!row) throw notFound('tariff plan');
    return c.json({ ...row, lines: await tariffPlanLinesOf(ctx.db, id) });
  })
  .delete('/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const [used] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(contracts).where(and(eq(contracts.tariffPlanId, id), eq(contracts.workspaceId, ctx.workspaceId)));
    if (used && used.n > 0) throw new AppError(422, 'tariff_plan_in_use', 'The tariff plan is used by contracts: archive it instead of deleting');
    await ctx.db.update(tariffPlans).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(tariffPlans.id, id), eq(tariffPlans.workspaceId, ctx.workspaceId)));
    return c.json({ id, deleted: false as const, archived: true as const });
  })
  .post('/:id/lines', admin, zValidator('param', idParam, validationHook), zValidator('json', tariffPlanLinesUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const body = c.req.valid('json' as never) as z.infer<typeof tariffPlanLinesUpdate>;
    const [row] = await ctx.db.select().from(tariffPlans).where(and(eq(tariffPlans.id, id), eq(tariffPlans.workspaceId, ctx.workspaceId))).limit(1);
    if (!row) throw notFound('tariff plan');
    await saveTariffPlanLines(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, id, body.lines);
    return c.json({ ...row, lines: await tariffPlanLinesOf(ctx.db, id) });
  });
