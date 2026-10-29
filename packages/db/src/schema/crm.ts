/* CRM: компании, контакты, сделки, активности. Деньги — numeric(18,2) (строки в JSON). */
import { sql } from 'drizzle-orm';
import { boolean, check, date, doublePrecision, foreignKey, index, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { adCampaigns, leadSources } from './ad';
import { leads } from './leads';
import { members, wsCol } from './people';
import { dealLostReasons, dealPipelines, dealStages } from './pipelines';

export const companies = pgTable(
  'companies',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    industry: text('industry').notNull().default(''),
    size: text('size').notNull().default(''),
    ownerId: uuid('owner_id'),
    website: text('website').notNull().default(''),
    city: text('city').notNull().default(''),
    /** Реквизиты (Россия): тип контрагента, ИНН (проверяется контрольная сумма), КПП, ОГРН/ОГРНИП, адреса. Банковские счета — таблица bank_accounts */
    kind: text('kind', { enum: ['legal', 'sole_proprietor', 'individual'] }).notNull().default('legal'),
    inn: text('inn').notNull().default(''),
    kpp: text('kpp').notNull().default(''),
    ogrn: text('ogrn').notNull().default(''),
    legalAddress: text('legal_address').notNull().default(''),
    actualAddress: text('actual_address').notNull().default(''),
    /** Следующий контакт (задача 1133): ставится при продаже, воркер в этот день создаёт дело ответственному и очищает дату */
    /** Взаиморасчёты: по документам (долг по каждому счёту/заказу) или по контрагенту в целом (одно сальдо, зачёт FIFO) */
    /** Вид цен контрагента: подставляется в документы (задача 1178; внешний ключ ставит миграция 0051) */
    priceKindId: uuid('price_kind_id'),
    settlementMode: text('settlement_mode', { enum: ['by_documents', 'by_counterparty'] }).notNull().default('by_documents'),
    nextContactDate: date('next_contact_date', { mode: 'string' }),
    nextContactNote: text('next_contact_note').notNull().default(''),
    /** Источник привлечения и кампания (задача 1177); кто привёл — для источника-партнёра или контактного лица
        (внешние ключи с ON DELETE SET NULL (колонка) ставит миграция 0054) */
    sourceId: uuid('source_id'),
    campaignId: uuid('campaign_id'),
    referrerCompanyId: uuid('referrer_company_id'),
    referrerContactId: uuid('referrer_contact_id'),
    custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('companies_ws_id_uq').on(t.workspaceId, t.id),
    check('companies_settlement_mode_chk', sql`${t.settlementMode} in ('by_documents','by_counterparty')`),
    check('companies_kind_chk', sql`${t.kind} in ('legal','sole_proprietor','individual')`),
    foreignKey({ columns: [t.workspaceId, t.ownerId], foreignColumns: [members.workspaceId, members.id], name: 'companies_owner_fk' }),
    foreignKey({ columns: [t.workspaceId, t.sourceId], foreignColumns: [leadSources.workspaceId, leadSources.id], name: 'companies_source_fk' }),
    foreignKey({ columns: [t.workspaceId, t.campaignId], foreignColumns: [adCampaigns.workspaceId, adCampaigns.id], name: 'companies_campaign_fk' }),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: pk(),
    workspaceId: wsCol(),
    companyId: uuid('company_id'),
    name: text('name').notNull(),
    title: text('title').notNull().default(''),
    email: text('email').notNull().default(''),
    phone: text('phone').notNull().default(''),
    ownerId: uuid('owner_id'),
    custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('contacts_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'contacts_company_fk' }),
    foreignKey({ columns: [t.workspaceId, t.ownerId], foreignColumns: [members.workspaceId, members.id], name: 'contacts_owner_fk' }),
    index('contacts_company_idx').on(t.companyId),
  ],
);

export const deals = pgTable(
  'deals',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    companyId: uuid('company_id'),
    ownerId: uuid('owner_id'),
    amount: money('amount').notNull().default('0'),
    currency: text('currency').notNull().default('USD'),
    /** Воронка и этап (задача 1176); этап обязан принадлежать воронке сделки (составной внешний ключ) */
    pipelineId: uuid('pipeline_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    /** Когда сделка вошла в текущий этап; отметка о том, что просрочка норматива этапа уже объявлена */
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    stageOverdueNotifiedAt: timestamp('stage_overdue_notified_at', { withTimezone: true, mode: 'date' }),
    lostReasonId: uuid('lost_reason_id'),
    closeDate: date('close_date', { mode: 'string' }),
    closedAt: date('closed_at', { mode: 'string' }),
    lostReason: text('lost_reason'),
    /** Источник, кампания и кто привёл (задача 1177; внешние ключи «кто привёл» ставит миграция 0054); по умолчанию — от контрагента */
    sourceId: uuid('source_id'),
    campaignId: uuid('campaign_id'),
    referrerCompanyId: uuid('referrer_company_id'),
    referrerContactId: uuid('referrer_contact_id'),
    /** Порядок карточки внутри колонки воронки */
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('deals_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'deals_company_fk' }),
    foreignKey({ columns: [t.workspaceId, t.ownerId], foreignColumns: [members.workspaceId, members.id], name: 'deals_owner_fk' }),
    foreignKey({ columns: [t.workspaceId, t.sourceId], foreignColumns: [leadSources.workspaceId, leadSources.id], name: 'deals_source_fk' }),
    foreignKey({ columns: [t.workspaceId, t.campaignId], foreignColumns: [adCampaigns.workspaceId, adCampaigns.id], name: 'deals_campaign_fk' }),
    foreignKey({ columns: [t.workspaceId, t.pipelineId], foreignColumns: [dealPipelines.workspaceId, dealPipelines.id], name: 'deals_pipeline_fk' }),
    foreignKey({ columns: [t.workspaceId, t.pipelineId, t.stageId], foreignColumns: [dealStages.workspaceId, dealStages.pipelineId, dealStages.id], name: 'deals_stage_fk' }),
    foreignKey({ columns: [t.workspaceId, t.lostReasonId], foreignColumns: [dealLostReasons.workspaceId, dealLostReasons.id], name: 'deals_lost_reason_fk' }),
    index('deals_ws_stage_idx').on(t.workspaceId, t.pipelineId, t.stageId),
  ],
);

/** История этапов сделки: из/в этап и воронку, кто и когда. Идентификаторы этапов без внешних ключей — запись переживает удаление этапа */
export const dealStageHistory = pgTable(
  'deal_stage_history',
  {
    id: pk(),
    workspaceId: wsCol(),
    dealId: uuid('deal_id').notNull(),
    fromPipelineId: uuid('from_pipeline_id'),
    fromStageId: uuid('from_stage_id'),
    toPipelineId: uuid('to_pipeline_id').notNull(),
    toStageId: uuid('to_stage_id').notNull(),
    memberId: uuid('member_id'),
    createdAt: createdAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.dealId], foreignColumns: [deals.workspaceId, deals.id], name: 'dsh_deal_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'dsh_member_fk' }),
    index('deal_stage_history_deal_idx').on(t.workspaceId, t.dealId, t.createdAt),
    index('deal_stage_history_to_idx').on(t.workspaceId, t.toPipelineId, t.toStageId),
  ],
);

/** Контакты сделки (Deal.contacts) */
export const dealContacts = pgTable(
  'deal_contacts',
  {
    workspaceId: wsCol(),
    dealId: uuid('deal_id').notNull(),
    contactId: uuid('contact_id').notNull(),
  },
  t => [
    primaryKey({ columns: [t.dealId, t.contactId] }),
    foreignKey({ columns: [t.workspaceId, t.dealId], foreignColumns: [deals.workspaceId, deals.id], name: 'dc_deal_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.contactId], foreignColumns: [contacts.workspaceId, contacts.id], name: 'dc_contact_fk' }).onDelete('cascade'),
  ],
);

export const crmActivities = pgTable(
  'crm_activities',
  {
    id: pk(),
    workspaceId: wsCol(),
    type: text('type', { enum: ['call', 'email', 'meeting', 'note', 'task'] }).notNull(),
    subject: text('subject').notNull(),
    dealId: uuid('deal_id'),
    companyId: uuid('company_id'),
    contactId: uuid('contact_id'),
    /** Касание лида (задача 1175); при конвертации переезжает к контакту/сделке */
    leadId: uuid('lead_id'),
    authorId: uuid('author_id'),
    /** Служебная запись (смена этапа) */
    system: boolean('system').notNull().default(false),
    /** Для type=task: срок и отметка выполнения */
    dueDate: date('due_date', { mode: 'string' }),
    done: boolean('done'),
    body: text('body'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.dealId], foreignColumns: [deals.workspaceId, deals.id], name: 'ca_deal_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'ca_company_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.contactId], foreignColumns: [contacts.workspaceId, contacts.id], name: 'ca_contact_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.leadId], foreignColumns: [leads.workspaceId, leads.id], name: 'ca_lead_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.authorId], foreignColumns: [members.workspaceId, members.id], name: 'ca_author_fk' }),
    index('crm_activities_ws_created_idx').on(t.workspaceId, t.createdAt),
    index('crm_activities_lead_idx').on(t.leadId),
  ],
);

/** Журнал напоминаний о следующем контакте (задача 1133): одно дело на (компания, дата) — идемпотентность задачи воркера */
export const crmNextContactRuns = pgTable(
  'crm_next_contact_runs',
  {
    workspaceId: wsCol(),
    companyId: uuid('company_id').notNull(),
    contactDate: date('contact_date', { mode: 'string' }).notNull(),
    activityId: uuid('activity_id'),
    createdAt: createdAt(),
  },
  t => [
    primaryKey({ columns: [t.companyId, t.contactDate] }),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'cncr_company_fk' }).onDelete('cascade'),
  ],
);
