/* CRM: компании, контакты, сделки, активности. Деньги — numeric(18,2) (строки в JSON). */
import { sql } from 'drizzle-orm';
import { boolean, check, date, doublePrecision, foreignKey, index, jsonb, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { leads } from './leads';
import { members, wsCol } from './people';

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
    settlementMode: text('settlement_mode', { enum: ['by_documents', 'by_counterparty'] }).notNull().default('by_documents'),
    nextContactDate: date('next_contact_date', { mode: 'string' }),
    nextContactNote: text('next_contact_note').notNull().default(''),
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
    stage: text('stage', { enum: ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] }).notNull().default('lead'),
    closeDate: date('close_date', { mode: 'string' }),
    closedAt: date('closed_at', { mode: 'string' }),
    lostReason: text('lost_reason'),
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
    check('deals_stage_chk', sql`${t.stage} in ('lead','qualified','proposal','negotiation','won','lost')`),
    index('deals_ws_stage_idx').on(t.workspaceId, t.stage),
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
