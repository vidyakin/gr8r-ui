/* Источники привлечения и рекламные кампании (задача 1177, docs/architecture/ad-campaigns.md): атрибуция записи
   (кампания задаёт источник), поиск источника по названию, кампании по utm_campaign, агрегаты отчёта по каналам.
   Всё идёт в транзакции вызывающего; права проверяют маршруты. */
import { and, eq, gte, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { AdReportInput, LeadSourceKind } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { adCampaignExpenses, adCampaigns, companies, contacts, deals, leadSources, leads } from './schema';

export interface Attribution {
  sourceId: string | null;
  campaignId: string | null;
  /** Название источника — кэш `leads.source` / `lead_forms.source` */
  source: string;
  /** Кто привёл: контрагент — у источника-партнёра, контакт — у источника «контактное лицо»; у канала — пусто */
  referrerCompanyId: string | null;
  referrerContactId: string | null;
}

export interface AttributionState {
  sourceId: string | null;
  campaignId: string | null;
  referrerCompanyId?: string | null;
  referrerContactId?: string | null;
}

/** Изменение атрибуции: undefined — поле не меняется, null — очистить; `sourceName` — источник по названию (создаётся, если нет) */
export interface AttributionInput {
  sourceId?: string | null | undefined;
  campaignId?: string | null | undefined;
  sourceName?: string | undefined;
  referrerCompanyId?: string | null | undefined;
  referrerContactId?: string | null | undefined;
}

/** Источник по названию без учёта регистра; нет — создаётся в конце списка.
    Сравнение в JS: `lower()` в БД с локалью C не меняет регистр кириллицы, а справочник маленький. */
async function sourceByName(db: Db, name: string) {
  const key = name.toLocaleLowerCase('ru');
  return (await db.select({ id: leadSources.id, name: leadSources.name }).from(leadSources)).find(s => s.name.toLocaleLowerCase('ru') === key);
}

export async function findOrCreateSource(db: Db, workspaceId: string, name: string): Promise<{ id: string; name: string }> {
  const n = name.trim();
  const found = await sourceByName(db, n);
  if (found) return found;
  const [{ max } = { max: -1 }] = await db.select({ max: sql<number>`coalesce(max(${leadSources.sortOrder}), -1)::int` }).from(leadSources);
  const [row] = await db
    .insert(leadSources)
    .values({ workspaceId, name: n, sortOrder: max + 1 })
    .onConflictDoNothing()
    .returning({ id: leadSources.id, name: leadSources.name });
  if (row) return row;
  // параллельная вставка того же названия
  return (await sourceByName(db, n))!;
}

/** Кампания по коду utm_campaign (без учёта регистра); архивные не сопоставляются */
export async function campaignByUtm(db: Db, utm: string): Promise<{ id: string; sourceId: string } | null> {
  const u = utm.trim();
  if (!u) return null;
  const [c] = await db
    .select({ id: adCampaigns.id, sourceId: adCampaigns.sourceId })
    .from(adCampaigns)
    .where(and(sql`lower(${adCampaigns.utmCampaign}) = lower(${u})`, isNull(adCampaigns.archivedAt)))
    .limit(1);
  return c ?? null;
}

/** Итоговая атрибуция: кампания задаёт источник (явный другой источник — 422 `campaign_source_mismatch`);
    смена источника сбрасывает кампанию другого источника. «Кто привёл» остаётся только тот, что подходит типу источника. */
export async function resolveAttribution(db: Db, workspaceId: string, input: AttributionInput, existing: AttributionState = { sourceId: null, campaignId: null }): Promise<Attribution> {
  let sourceId = input.sourceId !== undefined ? input.sourceId : existing.sourceId;
  let campaignId = input.campaignId !== undefined ? input.campaignId : existing.campaignId;
  const sourceGiven = input.sourceId !== undefined || input.sourceName !== undefined;
  if (input.sourceId === undefined && input.sourceName !== undefined) sourceId = input.sourceName.trim() ? (await findOrCreateSource(db, workspaceId, input.sourceName)).id : null;

  if (campaignId) {
    const [c] = await db.select({ sourceId: adCampaigns.sourceId }).from(adCampaigns).where(eq(adCampaigns.id, campaignId)).limit(1);
    if (!c) throw new DomainError(422, 'invalid_reference', 'Campaign not found');
    if (input.campaignId) {
      if (sourceGiven && sourceId && sourceId !== c.sourceId) throw new DomainError(422, 'campaign_source_mismatch', 'The campaign belongs to another source');
      sourceId = c.sourceId;
    } else if (c.sourceId !== sourceId) campaignId = null;
  }

  let source = '';
  let kind: LeadSourceKind = 'channel';
  if (sourceId) {
    const [s] = await db.select({ name: leadSources.name, kind: leadSources.kind }).from(leadSources).where(eq(leadSources.id, sourceId)).limit(1);
    if (!s) throw new DomainError(422, 'invalid_reference', 'Lead source not found');
    source = s.name;
    kind = s.kind;
  }

  const referrerCompanyId = kind === 'partner' ? (input.referrerCompanyId !== undefined ? input.referrerCompanyId : (existing.referrerCompanyId ?? null)) : null;
  const referrerContactId = kind === 'contact' ? (input.referrerContactId !== undefined ? input.referrerContactId : (existing.referrerContactId ?? null)) : null;
  if (referrerCompanyId && !(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, referrerCompanyId)).limit(1)).length) throw new DomainError(422, 'invalid_reference', 'Referrer company not found');
  if (referrerContactId && !(await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, referrerContactId)).limit(1)).length) throw new DomainError(422, 'invalid_reference', 'Referrer contact not found');
  return { sourceId, campaignId, source, referrerCompanyId, referrerContactId };
}

/** Смена типа источника: у его записей остаётся только подходящая ссылка «кто привёл» */
export async function clearMismatchedReferrers(db: Db, sourceId: string, kind: LeadSourceKind) {
  const patch = { ...(kind !== 'partner' ? { referrerCompanyId: null } : {}), ...(kind !== 'contact' ? { referrerContactId: null } : {}) };
  for (const t of [leads, companies, deals] as const) await db.update(t).set(patch).where(eq(t.sourceId, sourceId));
}

/* ---------------- отчёт по каналам ---------------- */

export interface AdReportRaw {
  rows: AdReportInput[];
  /** Валюты выигранных сделок периода: больше одной — суммы складываются как есть */
  currencies: string[];
}

type AttrCols = { sourceId: PgColumn; campaignId: PgColumn; referrerCompanyId: PgColumn; referrerContactId: PgColumn };

/** Агрегаты по источникам, кампаниям или тем, кто привёл (контрагент или контакт), за период [from, to] (даты включительно).
    В разрезе «кто привёл» строк без рекомендателя и расходов нет. */
export async function adReportData(db: Db, q: { from: string; to: string; groupBy: 'source' | 'campaign' | 'referrer' }): Promise<AdReportRaw> {
  const bySource = q.groupBy === 'source';
  const byReferrer = q.groupBy === 'referrer';
  const keyOf = (t: AttrCols): SQL<string | null> =>
    bySource ? sql<string | null>`${t.sourceId}` : byReferrer ? sql<string | null>`coalesce(${t.referrerCompanyId}, ${t.referrerContactId})` : sql<string | null>`${t.campaignId}`;
  const onlyReferred = (t: AttrCols) => (byReferrer ? sql`coalesce(${t.referrerCompanyId}, ${t.referrerContactId}) is not null` : undefined);
  const start = sql`${q.from}::date`;
  const end = sql`(${q.to}::date + 1)`;
  const rows = new Map<string | null, AdReportInput>();
  const row = (key: string | null) => {
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { key, leads: 0, converted: 0, newClients: 0, wonDeals: 0, revenue: '0', expense: '0' }));
    return r;
  };

  const leadKey = keyOf(leads);
  for (const r of await db
    .select({ key: leadKey, n: sql<number>`count(*)::int`, conv: sql<number>`count(${leads.convertedAt})::int` })
    .from(leads)
    .where(and(isNull(leads.archivedAt), gte(leads.createdAt, start), lt(leads.createdAt, end), onlyReferred(leads)))
    .groupBy(leadKey)) {
    Object.assign(row(r.key), { leads: r.n, converted: r.conv });
  }

  const companyKey = keyOf(companies);
  for (const r of await db
    .select({ key: companyKey, n: sql<number>`count(*)::int` })
    .from(companies)
    .where(and(isNull(companies.archivedAt), gte(companies.createdAt, start), lt(companies.createdAt, end), onlyReferred(companies)))
    .groupBy(companyKey)) {
    row(r.key).newClients = r.n;
  }

  const dealKey = keyOf(deals);
  // «Выиграна» — этап won (после воронок 1176 — категория этапа)
  const wonWhere = and(isNull(deals.archivedAt), eq(deals.stage, 'won'), gte(deals.closedAt, q.from), lte(deals.closedAt, q.to), onlyReferred(deals));
  for (const r of await db
    .select({ key: dealKey, n: sql<number>`count(*)::int`, sum: sql<string>`coalesce(sum(${deals.amount}), 0)::text` })
    .from(deals)
    .where(wonWhere)
    .groupBy(dealKey)) {
    Object.assign(row(r.key), { wonDeals: r.n, revenue: r.sum });
  }
  const currencies = (await db.selectDistinct({ c: deals.currency }).from(deals).where(wonWhere)).map(r => r.c).sort();

  if (byReferrer) return { rows: [...rows.values()], currencies };
  const expKey = bySource ? adCampaigns.sourceId : adCampaigns.id;
  for (const r of await db
    .select({ key: expKey, sum: sql<string>`coalesce(sum(${adCampaignExpenses.amount}), 0)::text` })
    .from(adCampaignExpenses)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCampaignExpenses.campaignId))
    .where(and(gte(adCampaignExpenses.date, q.from), lte(adCampaignExpenses.date, q.to)))
    .groupBy(expKey)) {
    row(r.key).expense = r.sum;
  }

  return { rows: [...rows.values()], currencies };
}
