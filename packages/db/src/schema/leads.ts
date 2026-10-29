/* Лиды (задача 1175, docs/architecture/leads.md): статусы с категориями, формы сайта (вебхук), сами лиды, курсор «по кругу».
   Таблицы арендатора: workspace_id + составные FK + RLS. */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { LEAD_STATUS_CATEGORIES } from '@gr8r/shared';
import { archivedAt, createdAt, pk, updatedAt } from './columns';
import { adCampaigns, leadSources } from './ad';
import { companies, contacts, deals } from './crm';
import { members } from './people';
import { wsCol } from './tenant';

/** Статус лида: настраиваемый, с категорией (механизм общий — этапы воронок 1176 переиспользуют его) */
export const leadStatuses = pgTable(
  'lead_statuses',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    category: text('category', { enum: LEAD_STATUS_CATEGORIES }).notNull().default('in_progress'),
    color: text('color').notNull().default('gray'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('lead_statuses_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('lead_statuses_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`),
    check('lead_statuses_category_chk', sql`${t.category} in ('new','in_progress','converted','rejected')`),
  ],
);

/** Форма сайта: токен в адресе вебхука, источник и ответственный по умолчанию */
export const leadForms = pgTable(
  'lead_forms',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    /** Секретная часть токена; полный токен вебхука — `<workspace_id>.<token>` */
    token: text('token').notNull(),
    source: text('source').notNull().default(''),
    /** Источник и кампания заявок формы (задача 1177); `source` — кэш названия источника */
    sourceId: uuid('source_id'),
    campaignId: uuid('campaign_id'),
    defaultOwnerId: uuid('default_owner_id'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('lead_forms_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('lead_forms_token_uq').on(t.token),
    foreignKey({ columns: [t.workspaceId, t.defaultOwnerId], foreignColumns: [members.workspaceId, members.id], name: 'lead_forms_owner_fk' }),
    foreignKey({ columns: [t.workspaceId, t.sourceId], foreignColumns: [leadSources.workspaceId, leadSources.id], name: 'lead_forms_source_fk' }),
    foreignKey({ columns: [t.workspaceId, t.campaignId], foreignColumns: [adCampaigns.workspaceId, adCampaigns.id], name: 'lead_forms_campaign_fk' }),
  ],
);

export const leads = pgTable(
  'leads',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    /** Компания текстом (до появления контрагента) */
    companyName: text('company_name').notNull().default(''),
    phone: text('phone').notNull().default(''),
    /** Нормализованный телефон E.164 и email в нижнем регистре — для поиска дублей */
    phoneNorm: text('phone_norm').notNull().default(''),
    email: text('email').notNull().default(''),
    emailNorm: text('email_norm').notNull().default(''),
    comment: text('comment').notNull().default(''),
    /** Кэш названия источника (для подстановок автоматизаций); пишет только сервер по `source_id` (задача 1177) */
    source: text('source').notNull().default(''),
    sourceId: uuid('source_id'),
    campaignId: uuid('campaign_id'),
    /** Кто привёл — для источника-партнёра (контрагент) или контактного лица; внешние ключи ставит миграция 0054 */
    referrerCompanyId: uuid('referrer_company_id'),
    referrerContactId: uuid('referrer_contact_id'),
    ownerId: uuid('owner_id'),
    statusId: uuid('status_id').notNull(),
    rejectReason: text('reject_reason').notNull().default(''),
    formId: uuid('form_id'),
    custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    convertedAt: timestamp('converted_at', { withTimezone: true, mode: 'date' }),
    companyId: uuid('company_id'),
    contactId: uuid('contact_id'),
    dealId: uuid('deal_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('leads_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.ownerId], foreignColumns: [members.workspaceId, members.id], name: 'leads_owner_fk' }),
    foreignKey({ columns: [t.workspaceId, t.statusId], foreignColumns: [leadStatuses.workspaceId, leadStatuses.id], name: 'leads_status_fk' }),
    foreignKey({ columns: [t.workspaceId, t.formId], foreignColumns: [leadForms.workspaceId, leadForms.id], name: 'leads_form_fk' }),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'leads_company_fk' }),
    foreignKey({ columns: [t.workspaceId, t.contactId], foreignColumns: [contacts.workspaceId, contacts.id], name: 'leads_contact_fk' }),
    foreignKey({ columns: [t.workspaceId, t.dealId], foreignColumns: [deals.workspaceId, deals.id], name: 'leads_deal_fk' }),
    foreignKey({ columns: [t.workspaceId, t.sourceId], foreignColumns: [leadSources.workspaceId, leadSources.id], name: 'leads_source_fk' }),
    foreignKey({ columns: [t.workspaceId, t.campaignId], foreignColumns: [adCampaigns.workspaceId, adCampaigns.id], name: 'leads_campaign_fk' }),
    index('leads_ws_source_idx').on(t.workspaceId, t.sourceId, t.createdAt),
    index('leads_ws_status_idx').on(t.workspaceId, t.statusId),
    index('leads_ws_phone_idx').on(t.workspaceId, t.phoneNorm),
    index('leads_ws_email_idx').on(t.workspaceId, t.emailNorm),
  ],
);

/** Курсор распределения «по кругу»: кому назначен последний лид */
export const leadAssignCursor = pgTable(
  'lead_assign_cursor',
  {
    workspaceId: wsCol().primaryKey(),
    lastMemberId: uuid('last_member_id'),
    updatedAt: updatedAt(),
  },
  t => [foreignKey({ columns: [t.workspaceId, t.lastMemberId], foreignColumns: [members.workspaceId, members.id], name: 'lead_cursor_member_fk' })],
);
