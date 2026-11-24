/* CRM: компании, контакты, сделки, активности. */
import { zValidator } from '@hono/zod-validator';
import { desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { aiChatSessions, companies, contacts, crmActivities, leads, loadCase, markFirstResponse, dealContacts, dealStageHistory, deals, loadStage, planStageChange, recalcSettlementMode, recordStageChange } from '@erp/db';
import {
  assertNoHiddenFieldWrite,
  maskFields,
  maskRows,
  companyCreate,
  companyQuery,
  companyUpdate,
  contactCreate,
  contactQuery,
  contactUpdate,
  crmActivityCreate,
  crmActivityQuery,
  crmActivityUpdate,
  crmAnalyzeWebsiteBody,
  crmDraftOutreachBody,
  dealCreate,
  dealQuery,
  dealUpdate,
  idParam,
} from '@erp/shared';
import { crud, ctxOf, validationHook, type Ctx } from '../crud';
import { AppError, forbidden, notFound } from '../errors';
import type { AppEnv } from '../types';
import { hasRole, requireRole } from '../middleware';
import { analyzeWebsiteWithAi, draftOutreachWithAi } from '../crm/website-ai';
import { scrapeWebsite } from '../crm/website-scraper';
import { customForCreate, customForUpdate } from '../meta/service';
import { hiddenFieldsOf, requireVisibleFields } from '../field-access';
import { assertOwnerAssignment, attributionPatch } from './helpers';
import { assertRequisites } from './documents';

export const companyRoutes = crud({
  entity: 'company',
  table: companies,
  create: companyCreate,
  update: companyUpdate,
  query: companyQuery,
  sortable: { name: companies.name, industry: companies.industry, city: companies.city, createdAt: companies.createdAt },
  defaultSort: 'name',
  search: async ctx => {
    const hidden = await hiddenFieldsOf(ctx);
    return [companies.name, companies.industry, companies.city, companies.website, ...(!hidden.includes('company.requisites') ? [companies.inn] : [])];
  },
  decorate: async (ctx, rows) => maskRows('company', rows, await hiddenFieldsOf(ctx)),
  filters: q => [
    q.ownerId ? eq(companies.ownerId, q.ownerId) : undefined,
    q.industry ? eq(companies.industry, q.industry) : undefined,
    q.sourceId ? eq(companies.sourceId, q.sourceId) : undefined,
    q.campaignId ? eq(companies.campaignId, q.campaignId) : undefined,
    q.role === 'supplier' ? eq(companies.isSupplier, true) : q.role === 'customer' ? eq(companies.isCustomer, true) : undefined,
  ],
  prepareCreate: async (ctx, body) => {
    requireVisibleFields(assertNoHiddenFieldWrite('company', await ctx.c.req.json(), await hiddenFieldsOf(ctx)));
    await assertOwnerAssignment(ctx, body.ownerId);
    assertRequisites(body);
    return { ownerId: body.ownerId ?? ctx.memberId, ...pickAttr(await attributionPatch(ctx, body)), ...(await customForCreate(ctx, 'company', body.custom)) };
  },
  prepareUpdate: async (ctx, existing, body) => {
    requireVisibleFields(assertNoHiddenFieldWrite('company', await ctx.c.req.json(), await hiddenFieldsOf(ctx)));
    await assertOwnerAssignment(ctx, body.ownerId, existing.ownerId);
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
  search: async ctx => {
    const hidden = await hiddenFieldsOf(ctx);
    return [contacts.name, contacts.title, ...(!hidden.includes('contact.email') ? [contacts.email] : []), ...(!hidden.includes('contact.phone') ? [contacts.phone] : [])];
  },
  decorate: async (ctx, rows) => maskRows('contact', rows, await hiddenFieldsOf(ctx)),
  filters: q => [q.companyId ? eq(contacts.companyId, q.companyId) : undefined, q.ownerId ? eq(contacts.ownerId, q.ownerId) : undefined],
  prepareCreate: async (ctx, body) => {
    requireVisibleFields(assertNoHiddenFieldWrite('contact', await ctx.c.req.json(), await hiddenFieldsOf(ctx)));
    await assertOwnerAssignment(ctx, body.ownerId);
    return { ownerId: body.ownerId ?? ctx.memberId, ...(await customForCreate(ctx, 'contact', body.custom)) };
  },
  prepareUpdate: async (ctx, existing, body) => {
    requireVisibleFields(assertNoHiddenFieldWrite('contact', await ctx.c.req.json(), await hiddenFieldsOf(ctx)));
    await assertOwnerAssignment(ctx, body.ownerId, existing.ownerId);
    return customForUpdate(ctx, 'contact', existing.custom, body.custom, existing.id);
  },
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
  hiddenSortKeys: async ctx => (await hiddenFieldsOf(ctx)).includes('deal.amount') ? ['amount'] : [],
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
    requireVisibleFields(assertNoHiddenFieldWrite('deal', await ctx.c.req.json(), await hiddenFieldsOf(ctx)));
    await assertOwnerAssignment(ctx, body.ownerId);
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
    requireVisibleFields(assertNoHiddenFieldWrite('deal', await ctx.c.req.json(), await hiddenFieldsOf(ctx)));
    await assertOwnerAssignment(ctx, body.ownerId, existing.ownerId);
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
    return maskRows('deal', rows.map(r => ({ ...r, contactIds: dc.filter(x => x.dealId === r.id).map(x => x.contactId) })), await hiddenFieldsOf(ctx));
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
    q.caseId ? eq(crmActivities.caseId, q.caseId) : undefined,
  ],
  prepareCreate: async (ctx, body) => {
    // Компания берётся из сделки, если не указана
    let companyId = body.companyId;
    if (!companyId && body.dealId) companyId = (await ctx.db.select({ c: deals.companyId }).from(deals).where(eq(deals.id, body.dealId)).limit(1))[0]?.c ?? null;
    // закрытое обращение принимает только заметки; ответом клиенту считается звонок или письмо с отметкой response
    if (body.caseId) {
      const row = await loadCase(ctx.db, body.caseId);
      if (row.status === 'closed' && body.type !== 'note') throw new AppError(409, 'case_closed', 'A closed case accepts only notes');
    }
    return { authorId: ctx.memberId, companyId, done: body.type === 'task' ? (body.done ?? false) : null, system: false };
  },
  afterCreate: async (ctx, row, body) => {
    if (row.caseId && body.response && (row.type === 'call' || row.type === 'email')) await markFirstResponse(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, row.caseId);
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

/** ИИ-инструменты CRM: анализ сайта клиента и генерация первичного письма (/crm/ai/*) */
export const crmAiRoutes = new Hono<AppEnv>()
  .post('/ai/analyze-website', requireRole('member'), zValidator('json', crmAnalyzeWebsiteBody, validationHook), async c => {
    const body = c.req.valid('json');
    const cfg = c.get('config').landingAi;
    if (body.manualText) {
      const result = await analyzeWebsiteWithAi(cfg, body.manualText);
      return c.json(result);
    }
    let scraped;
    try {
      scraped = await scrapeWebsite(body.url!);
    } catch (e) {
      throw new AppError(400, 'invalid_url', e instanceof Error ? e.message : 'Invalid or blocked URL');
    }
    if (!scraped.ok) {
      return c.json({ fallbackNeeded: true as const, reason: scraped.reason, rawTextLength: scraped.rawTextLength });
    }
    const result = await analyzeWebsiteWithAi(cfg, scraped.text);
    return c.json(result);
  })
  .post('/ai/draft-outreach', requireRole('member'), zValidator('json', crmDraftOutreachBody, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const [company] = body.companyId
      ? await ctx.db
          .select({ name: companies.name, industry: companies.industry, website: companies.website, city: companies.city })
          .from(companies)
          .where(eq(companies.id, body.companyId))
          .limit(1)
      : [];
    const [lead] = body.leadId
      ? await ctx.db
          .select({ name: leads.name, companyName: leads.companyName, email: leads.email, phone: leads.phone, comment: leads.comment, source: leads.source })
          .from(leads)
          .where(eq(leads.id, body.leadId))
          .limit(1)
      : [];
    const sessions = body.leadId
      ? await ctx.db
          .select({ messages: aiChatSessions.messages })
          .from(aiChatSessions)
          .where(eq(aiChatSessions.leadId, body.leadId))
          .orderBy(desc(aiChatSessions.updatedAt))
          .limit(3)
      : [];
    const chatMessages = sessions.flatMap(s => s.messages);
    const draft = await draftOutreachWithAi(c.get('config').landingAi, {
      channel: body.channel,
      tone: body.tone,
      company: company ?? null,
      lead: lead ? maskFields('lead', lead, await hiddenFieldsOf(ctx)) : null,
      chatMessages,
      websiteSummary: body.websiteSummary,
      customContext: body.customContext,
    });
    return c.json(draft);
  });
