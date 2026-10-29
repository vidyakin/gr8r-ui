/* Источники привлечения и рекламные кампании (задача 1177, docs/architecture/ad-campaigns.md): справочник источников,
   кампании с кодом utm_campaign, расходы кампаний. Таблицы арендатора: workspace_id + составные FK + RLS. */
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { LEAD_SOURCE_KINDS } from '@gr8r/shared';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { members } from './people';
import { wsCol } from './tenant';

/** Источник привлечения (канал): «Сайт», «Яндекс.Директ», «Рекомендация»… */
export const leadSources = pgTable(
  'lead_sources',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    color: text('color').notNull().default('gray'),
    /** Тип (как в 1С:ERP): канал; партнёр или контактное лицо — у записи указывается, кто именно привёл */
    kind: text('kind', { enum: LEAD_SOURCE_KINDS }).notNull().default('channel'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('lead_sources_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('lead_sources_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`),
    check('lead_sources_kind_chk', sql`${t.kind} in ('channel','partner','contact')`),
  ],
);

/** Рекламная кампания: всегда внутри источника; код utm_campaign сопоставляет заявки с сайта */
export const adCampaigns = pgTable(
  'ad_campaigns',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    sourceId: uuid('source_id').notNull(),
    utmCampaign: text('utm_campaign').notNull().default(''),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    budget: money('budget').notNull().default('0'),
    comment: text('comment').notNull().default(''),
    ownerId: uuid('owner_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('ad_campaigns_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.sourceId], foreignColumns: [leadSources.workspaceId, leadSources.id], name: 'ad_campaigns_source_fk' }),
    foreignKey({ columns: [t.workspaceId, t.ownerId], foreignColumns: [members.workspaceId, members.id], name: 'ad_campaigns_owner_fk' }),
    uniqueIndex('ad_campaigns_ws_utm_uq').on(t.workspaceId, sql`lower(${t.utmCampaign})`).where(sql`${t.utmCampaign} <> ''`),
    index('ad_campaigns_ws_source_idx').on(t.workspaceId, t.sourceId),
  ],
);

/** Расход кампании за дату (вводится вручную) */
export const adCampaignExpenses = pgTable(
  'ad_campaign_expenses',
  {
    id: pk(),
    workspaceId: wsCol(),
    campaignId: uuid('campaign_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    amount: money('amount').notNull(),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('ad_campaign_expenses_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.campaignId], foreignColumns: [adCampaigns.workspaceId, adCampaigns.id], name: 'ad_expenses_campaign_fk' }).onDelete('cascade'),
    index('ad_expenses_ws_date_idx').on(t.workspaceId, t.date),
  ],
);
