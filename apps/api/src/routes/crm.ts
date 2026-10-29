/* CRM: компании, контакты, сделки, активности. */
import { zValidator } from '@hono/zod-validator';
import { desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { companies, contacts, crmActivities, dealContacts, dealStageHistory, deals, loadStage, planStageChange, recalcSettlementMode, recordStageChange } from '@gr8r/db';
import {
  companyCreate,
  companyQuery,
  companyUpdate,
  contactCreate,
  contactQuery,
  contactUpdate,
  crmActivityCreate,
  crmActivityQuery,
  crmActivityUpdate,
  dealCreate,
  dealQuery,
  dealUpdate,
  idParam,
} from '@gr8r/shared';
import { crud, ctxOf, validationHook, type Ctx } from '../crud';
import { forbidden, notFound } from '../errors';
import type { AppEnv } from '../types';
import { hasRole } from '../middleware';
import { customForCreate, customForUpdate } from '../meta/service';
import { attributionPatch } from './helpers';
import { assertRequisites } from './documents';

export const companyRoutes = crud({
  entity: 'company',
  table: companies,
  create: companyCreate,
  update: companyUpdate,
  query: companyQuery,
  sortable: { name: companies.name, industry: companies.industry, city: companies.city, createdAt: companies.createdAt },
  defaultSort: 'name',
  search: [companies.name, companies.industry, companies.city, companies.website, companies.inn],
  filters: q => [
    q.ownerId ? eq(companies.ownerId, q.ownerId) : undefined,
    q.industry ? eq(companies.industry, q.industry) : undefined,
    q.sourceId ? eq(companies.sourceId, q.sourceId) : undefined,
    q.campaignId ? eq(companies.campaignId, q.campaignId) : undefined,
  ],
  prepareCreate: async (ctx, body) => {
    assertRequisites(body);
    return { ownerId: body.ownerId ?? ctx.memberId, ...pickAttr(await attributionPatch(ctx, body)), ...(await customForCreate(ctx, 'company', body.custom)) };
  },
  prepareUpdate: async (ctx, existing, body) => {
    // реквизиты проверяются по итоговому состоянию: тип, ИНН, КПП и ОГРН зависят друг от друга
    assertRequisites({ kind: body.kind ?? existing.kind, inn: body.inn ?? existing.inn, kpp: body.kpp ?? existing.kpp, ogrn: body.ogrn ?? existing.ogrn });
    return { ...(await customForUpdate(ctx, 'company', existing.custom, body.custom, existing.id)), ...pickAttr(await attributionPatch(ctx, body, existing)) };
  },
  // смена режима взаиморасчётов пересчитывает зачёты проведённых документов в той же транзакции (закрытый период — 422)
  afterUpdate: async (ctx, before, after) => {
    if (before.settlementMode !== after.settlementMode) await recalcSettlementMode(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role }, after.id, before.settlementMode, after.settlementMode);
  },
});

export const contactRoutes = crud({
  entity: 'contact',
  table: contacts,
  create: contactCreate,
  update: contactUpdate,
  query: contactQuery,
  sortable: { name: contacts.name, createdAt: contacts.createdAt, title: contacts.title },
  defaultSort: 'name',
  search: [contacts.name, contacts.email, contacts.phone, contacts.title],
  filters: q => [q.companyId ? eq(contacts.companyId, q.companyId) : undefined, q.ownerId ? eq(contacts.ownerId, q.ownerId) : undefined],
  prepareCreate: async (ctx, body) => ({ ownerId: body.ownerId ?? ctx.memberId, ...(await customForCreate(ctx, 'contact', body.custom)) }),
  prepareUpdate: (ctx, existing, body) => customForUpdate(ctx, 'contact', existing.custom, body.custom, existing.id),
});

/** Только колонки атрибуции: у контрагента и сделки нет кэша названия источника */
const pickAttr = (a: { sourceId?: string | null; campaignId?: string | null; referrerCompanyId?: string | null; referrerContactId?: string | null }) =>
  'sourceId' in a ? { sourceId: a.sourceId, campaignId: a.campaignId, referrerCompanyId: a.referrerCompanyId, referrerContactId: a.referrerContactId } : {};

/** Источник сделки: явный, иначе — источник и кампания контрагента (задача 1177) */
async function dealAttribution(ctx: Ctx, body: { sourceId?: string | null; campaignId?: string | null; referrerCompanyId?: string | null; referrerContactId?: string | null; companyId?: string | null }) {
  if (body.sourceId || body.campaignId) return pickAttr(await attributionPatch(ctx, body));
  if (!body.companyId) return {};
  const [c] = await ctx.db
    .select({ sourceId: companies.sourceId, campaignId: companies.campaignId, referrerCompanyId: companies.referrerCompanyId, referrerContactId: companies.referrerContactId })
    .from(companies)
    .where(eq(companies.id, body.companyId))
    .limit(1);
  return c ?? {};
}

async function setDealContacts(ctx: Ctx, dealId: string, ids: string[]) {
  await ctx.db.delete(dealContacts).where(eq(dealContacts.dealId, dealId));
  const uniq = [...new Set(ids)];
  if (uniq.length) await ctx.db.insert(dealContacts).values(uniq.map(contactId => ({ workspaceId: ctx.workspaceId, dealId, contactId })));
}

/** Сделки, у которых превышен норматив дней на этапе (задача 1176) */
const overdueSql = sql`exists (select 1 from deal_stages s where s.id = ${deals.stageId} and s.category = 'in_progress' and s.sla_days is not null and ${deals.stageEnteredAt} + (s.sla_days * interval '1 day') < now())`;

const dealBase = crud({
  entity: 'deal',
  table: deals,
  create: dealCreate,
  update: dealUpdate,
  query: dealQuery,
  sortable: { name: deals.name, amount: deals.amount, closeDate: deals.closeDate, sortOrder: deals.sortOrder, stageEnteredAt: deals.stageEnteredAt, createdAt: deals.createdAt, updatedAt: deals.updatedAt },
  defaultSort: 'sortOrder',
  search: [deals.name],
  filters: q => [
    q.pipelineId ? eq(deals.pipelineId, q.pipelineId) : undefined,
    q.stageId ? eq(deals.stageId, q.stageId) : undefined,
    q.overdue === 'true' ? overdueSql : q.overdue === 'false' ? sql`not ${overdueSql}` : undefined,
    q.companyId ? eq(deals.companyId, q.companyId) : undefined,
    q.ownerId ? eq(deals.ownerId, q.ownerId) : undefined,
    q.closeFrom ? gte(deals.closeDate, q.closeFrom) : undefined,
    q.closeTo ? lte(deals.closeDate, q.closeTo) : undefined,
    q.sourceId ? eq(deals.sourceId, q.sourceId) : undefined,
    q.campaignId ? eq(deals.campaignId, q.campaignId) : undefined,
  ],
  prepareCreate: async (ctx, body) => {
    const attr = await dealAttribution(ctx, body);
    const custom = await customForCreate(ctx, 'deal', body.custom);
    // воронка и этап: проверка принадлежности, обязательные поля, причина проигрыша (задача 1176)
    const plan = await planStageChange(
      ctx.db,
      null,
      { stageId: body.stageId, pipelineId: body.pipelineId, lostReasonId: body.lostReasonId, closedAt: body.closedAt },
      { amount: body.amount, closeDate: body.closeDate, contactIds: body.contactIds ?? [], sourceId: (attr as { sourceId?: string | null }).sourceId ?? body.sourceId, custom: (custom as { custom?: Record<string, unknown> }).custom ?? {} },
    );
    const { sortOrder, ...stagePatch } = plan.patch;
    return { ownerId: body.ownerId ?? ctx.memberId, sortOrder: body.sortOrder ?? sortOrder, ...stagePatch, ...attr, ...custom };
  },
  afterCreate: async (ctx, row, body) => {
    if (body.contactIds) await setDealContacts(ctx, row.id, body.contactIds);
    await recordStageChange(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, row, { to: await loadStage(ctx.db, row.stageId), from: null });
  },
  prepareUpdate: async (ctx, existing, body) => {
    const custom = await customForUpdate(ctx, 'deal', existing.custom, body.custom, existing.id);
    const attr = pickAttr(await attributionPatch(ctx, body, existing));
    const contactIds = body.contactIds ?? (await ctx.db.select({ id: dealContacts.contactId }).from(dealContacts).where(eq(dealContacts.dealId, existing.id))).map(r => r.id);
    const plan = await planStageChange(
      ctx.db,
      existing,
      { stageId: body.stageId, pipelineId: body.pipelineId, lostReasonId: body.lostReasonId, closedAt: body.closedAt },
      {
        amount: body.amount ?? existing.amount,
        closeDate: body.closeDate === undefined ? existing.closeDate : body.closeDate,
        contactIds,
        sourceId: 'sourceId' in attr ? attr.sourceId : existing.sourceId,
        custom: custom.custom ?? existing.custom,
      },
    );
    const patch: Record<string, unknown> = { ...custom, ...attr, ...plan.patch };
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
    // причина проигрыша меняется только на этапе категории «проиграна»
    if (!plan.changed) patch.lostReasonId = plan.to.category === 'lost' ? body.lostReasonId : undefined;
    return patch;
  },
  afterUpdate: async (ctx, before, after, body) => {
    if (body.contactIds) await setDealContacts(ctx, after.id, body.contactIds);
    if (before.stageId !== after.stageId) {
      await recordStageChange(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, after, { to: await loadStage(ctx.db, after.stageId), from: await loadStage(ctx.db, before.stageId) });
    }
  },
  decorate: async (ctx, rows) => {
    if (!rows.length) return [];
    const dc = await ctx.db.select({ dealId: dealContacts.dealId, contactId: dealContacts.contactId }).from(dealContacts).where(inArray(dealContacts.dealId, rows.map(r => r.id)));
    return rows.map(r => ({ ...r, contactIds: dc.filter(x => x.dealId === r.id).map(x => x.contactId) }));
  },
});

/** История этапов сделки: из/в этап и воронку, кто и когда (новые сверху) */
export const dealRoutes = new Hono<AppEnv>()
  .get('/:id/stage-history', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const [d] = await ctx.db.select({ id: deals.id }).from(deals).where(eq(deals.id, id)).limit(1);
    if (!d) throw notFound('deal');
    const items = await ctx.db.select().from(dealStageHistory).where(eq(dealStageHistory.dealId, id)).orderBy(desc(dealStageHistory.createdAt), desc(dealStageHistory.id));
    return c.json({ items });
  })
  .route('/', dealBase);

export const crmActivityRoutes = crud({
  entity: 'crm_activity',
  table: crmActivities,
  create: crmActivityCreate,
  update: crmActivityUpdate,
  query: crmActivityQuery,
  sortable: { createdAt: crmActivities.createdAt, dueDate: crmActivities.dueDate },
  defaultSort: '-createdAt',
  search: [crmActivities.subject, crmActivities.body],
  filters: q => [
    q.type ? eq(crmActivities.type, q.type) : undefined,
    q.dealId ? eq(crmActivities.dealId, q.dealId) : undefined,
    q.companyId ? eq(crmActivities.companyId, q.companyId) : undefined,
    q.contactId ? eq(crmActivities.contactId, q.contactId) : undefined,
    q.leadId ? eq(crmActivities.leadId, q.leadId) : undefined,
  ],
  prepareCreate: async (ctx, body) => {
    // Компания берётся из сделки, если не указана
    let companyId = body.companyId;
    if (!companyId && body.dealId) companyId = (await ctx.db.select({ c: deals.companyId }).from(deals).where(eq(deals.id, body.dealId)).limit(1))[0]?.c ?? null;
    return { authorId: ctx.memberId, companyId, done: body.type === 'task' ? (body.done ?? false) : null, system: false };
  },
  prepareUpdate: (ctx, existing) => {
    if (existing.system) throw forbidden('System records cannot be edited');
    if (existing.authorId !== ctx.memberId && !hasRole(ctx.c, 'admin')) throw forbidden('Only the author or an admin can change this record');
    return {};
  },
  beforeDelete: (ctx, row) => {
    if (row.system) throw forbidden('System records cannot be deleted');
    if (row.authorId !== ctx.memberId && !hasRole(ctx.c, 'admin')) throw forbidden('Only the author or an admin can change this record');
  },
});
