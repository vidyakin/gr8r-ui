/* Источники привлечения, рекламные кампании, расходы и отчёт по каналам (задача 1177, docs/architecture/ad-campaigns.md).
   Справочники и расходы правят admin+, отчёт видят все участники. Логика атрибуции — `packages/db/src/ad.ts`. */
import { zValidator } from '@hono/zod-validator';
import { and, count, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { adCampaignExpenses, adCampaigns, adReportData, companies, deals, leadForms, leadSources, leads } from '@gr8r/db';
import {
  adCampaignCreate,
  adCampaignQuery,
  adCampaignUpdate,
  adExpenseCreate,
  adExpenseQuery,
  adExpenseUpdate,
  adReportQuery,
  buildAdReport,
  leadSourceCreate,
  leadSourceQuery,
  leadSourceUpdate,
} from '@gr8r/shared';
import { crud, ctxOf, validationHook } from '../crud';
import { AppError } from '../errors';
import type { AppEnv } from '../types';

export const leadSourceRoutes = crud({
  entity: 'lead_source',
  table: leadSources,
  create: leadSourceCreate,
  update: leadSourceUpdate,
  query: leadSourceQuery,
  sortable: { sortOrder: leadSources.sortOrder, name: leadSources.name },
  defaultSort: 'sortOrder',
  search: [leadSources.name],
  writeRole: 'admin',
  prepareCreate: async (ctx, body) => {
    if (body.sortOrder !== undefined) return {};
    const [r] = await ctx.db.select({ n: count() }).from(leadSources);
    return { sortOrder: r?.n ?? 0 };
  },
  // переименование обновляет кэш названия у лидов и форм
  afterUpdate: async (ctx, before, after) => {
    if (before.name === after.name) return;
    await ctx.db.update(leads).set({ source: after.name }).where(eq(leads.sourceId, after.id));
    await ctx.db.update(leadForms).set({ source: after.name }).where(eq(leadForms.sourceId, after.id));
  },
  beforeDelete: async (ctx, row) => {
    const [c] = await ctx.db.select({ n: count() }).from(adCampaigns).where(and(eq(adCampaigns.sourceId, row.id), isNull(adCampaigns.archivedAt)));
    if ((c?.n ?? 0) > 0) throw new AppError(409, 'lead_source_in_use', 'The source has active campaigns');
  },
});

export const adCampaignRoutes = crud({
  entity: 'ad_campaign',
  table: adCampaigns,
  create: adCampaignCreate,
  update: adCampaignUpdate,
  query: adCampaignQuery,
  sortable: { name: adCampaigns.name, startDate: adCampaigns.startDate, createdAt: adCampaigns.createdAt },
  defaultSort: '-createdAt',
  search: [adCampaigns.name, adCampaigns.utmCampaign, adCampaigns.comment],
  filters: q => [q.sourceId ? eq(adCampaigns.sourceId, q.sourceId) : undefined],
  writeRole: 'admin',
  prepareCreate: (ctx, body) => {
    assertPeriod(body.startDate, body.endDate);
    return { ownerId: body.ownerId ?? ctx.memberId };
  },
  prepareUpdate: (_ctx, existing, body) => {
    assertPeriod(body.startDate !== undefined ? body.startDate : existing.startDate, body.endDate !== undefined ? body.endDate : existing.endDate);
    return {};
  },
  // смена источника кампании переносит её записи вслед: кампания задаёт источник
  afterUpdate: async (ctx, before, after) => {
    if (before.sourceId === after.sourceId) return;
    const [s] = await ctx.db.select({ name: leadSources.name }).from(leadSources).where(eq(leadSources.id, after.sourceId)).limit(1);
    await ctx.db.update(leads).set({ sourceId: after.sourceId, source: s?.name ?? '' }).where(eq(leads.campaignId, after.id));
    await ctx.db.update(leadForms).set({ sourceId: after.sourceId, source: s?.name ?? '' }).where(eq(leadForms.campaignId, after.id));
    await ctx.db.update(companies).set({ sourceId: after.sourceId }).where(eq(companies.campaignId, after.id));
    await ctx.db.update(deals).set({ sourceId: after.sourceId }).where(eq(deals.campaignId, after.id));
  },
  // потрачено за всё время — в списке кампаний
  decorate: async (ctx, rows) => {
    if (!rows.length) return [];
    const sums = await ctx.db
      .select({ id: adCampaignExpenses.campaignId, spent: sql<string>`coalesce(sum(${adCampaignExpenses.amount}), 0)::text` })
      .from(adCampaignExpenses)
      .where(inArray(adCampaignExpenses.campaignId, rows.map(r => r.id)))
      .groupBy(adCampaignExpenses.campaignId);
    const by = new Map(sums.map(s => [s.id, s.spent]));
    return rows.map(r => ({ ...r, spent: by.get(r.id) ?? '0' }));
  },
});

function assertPeriod(start: string | null | undefined, end: string | null | undefined) {
  if (start && end && end < start) throw new AppError(422, 'campaign_period_invalid', 'The campaign end date is before its start date');
}

export const adExpenseRoutes = crud({
  entity: 'ad_expense',
  table: adCampaignExpenses,
  create: adExpenseCreate,
  update: adExpenseUpdate,
  query: adExpenseQuery,
  sortable: { date: adCampaignExpenses.date, amount: adCampaignExpenses.amount, createdAt: adCampaignExpenses.createdAt },
  defaultSort: '-date',
  search: [adCampaignExpenses.comment],
  filters: q => [
    q.campaignId ? eq(adCampaignExpenses.campaignId, q.campaignId) : undefined,
    q.from ? gte(adCampaignExpenses.date, q.from) : undefined,
    q.to ? lte(adCampaignExpenses.date, q.to) : undefined,
  ],
  writeRole: 'admin',
});

export const adReportRoutes = new Hono<AppEnv>().get('/', zValidator('query', adReportQuery, validationHook), async c => {
  const ctx = ctxOf(c);
  const q = c.req.valid('query');
  if (q.to < q.from) throw new AppError(422, 'validation_error', 'The period end is before its start');
  const raw = await adReportData(ctx.db, q);
  // названия разреза: источники (и источник кампании)
  const srcs = await ctx.db.select({ id: leadSources.id, name: leadSources.name, color: leadSources.color }).from(leadSources);
  const camps = q.groupBy === 'campaign' ? await ctx.db.select({ id: adCampaigns.id, name: adCampaigns.name, sourceId: adCampaigns.sourceId }).from(adCampaigns) : [];
  const report = buildAdReport(raw.rows);
  const named = report.rows.map(r => {
    if (q.groupBy === 'source') {
      const s = srcs.find(x => x.id === r.key);
      return { ...r, name: s?.name ?? null, color: s?.color ?? null, sourceName: s?.name ?? null };
    }
    const cmp = camps.find(x => x.id === r.key);
    const s = cmp ? srcs.find(x => x.id === cmp.sourceId) : undefined;
    return { ...r, name: cmp?.name ?? null, color: s?.color ?? null, sourceName: s?.name ?? null };
  });
  // без источника — в конце, остальные по выручке
  named.sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : Number(b.revenue) - Number(a.revenue) || Number(b.expense) - Number(a.expense) || b.leads - a.leads));
  return c.json({ from: q.from, to: q.to, groupBy: q.groupBy, rows: named, total: report.total, currencies: raw.currencies });
});
