/* Обращения клиентов (docs/architecture/cases.md): обращения, правила SLA, формы сайта, счётчик номеров, курсор «по кругу».
   Таблицы арендатора: workspace_id + составные FK + RLS. Внешние ключи от email_messages / crm_activities / documents на cases — только в миграции 0129. */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { CASE_CHANNELS, CASE_PRIORITIES, CASE_STATUSES } from '@erp/shared';
import { createdAt, pk, ts, updatedAt } from './columns';
import { companies, contacts, deals } from './crm';
import { documents } from './documents';
import { leads } from './leads';
import { mailboxes } from './email';
import { members } from './people';
import { wsCol } from './tenant';

export const cases = pgTable(
  'cases',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** «ОБ-2026-00001»: сквозная нумерация воркспейса по годам */
    number: text('number').notNull(),
    subject: text('subject').notNull(),
    description: text('description').notNull().default(''),
    status: text('status', { enum: CASE_STATUSES }).notNull().default('new'),
    priority: text('priority', { enum: CASE_PRIORITIES }).notNull().default('normal'),
    channel: text('channel', { enum: CASE_CHANNELS }).notNull().default('manual'),
    companyId: uuid('company_id'),
    contactId: uuid('contact_id'),
    leadId: uuid('lead_id'),
    ownerId: uuid('owner_id'),
    dealId: uuid('deal_id'),
    workOrderId: uuid('work_order_id'),
    mailboxId: uuid('mailbox_id'),
    formId: uuid('form_id'),
    firstResponseDueAt: ts('first_response_due_at'),
    resolveDueAt: ts('resolve_due_at'),
    firstRespondedAt: ts('first_responded_at'),
    resolvedAt: ts('resolved_at'),
    closedAt: ts('closed_at'),
    /** Отметки нарушения срока: событие case.sla_breached уходит один раз на каждый срок */
    firstResponseBreachedAt: ts('first_response_breached_at'),
    resolveBreachedAt: ts('resolve_breached_at'),
    custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('cases_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('cases_ws_number_uq').on(t.workspaceId, t.number),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'cases_company_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.contactId], foreignColumns: [contacts.workspaceId, contacts.id], name: 'cases_contact_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.leadId], foreignColumns: [leads.workspaceId, leads.id], name: 'cases_lead_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.ownerId], foreignColumns: [members.workspaceId, members.id], name: 'cases_owner_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.dealId], foreignColumns: [deals.workspaceId, deals.id], name: 'cases_deal_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.workOrderId], foreignColumns: [documents.workspaceId, documents.id], name: 'cases_work_order_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.mailboxId], foreignColumns: [mailboxes.workspaceId, mailboxes.id], name: 'cases_mailbox_fk' }).onDelete('set null'),
    index('cases_ws_status_idx').on(t.workspaceId, t.status),
    index('cases_ws_company_idx').on(t.workspaceId, t.companyId),
    index('cases_ws_contact_idx').on(t.workspaceId, t.contactId),
    index('cases_ws_created_idx').on(t.workspaceId, t.createdAt),
    check('cases_status_chk', sql`${t.status} in ('new','in_progress','waiting','resolved','closed')`),
    check('cases_priority_chk', sql`${t.priority} in ('low','normal','high','urgent')`),
    check('cases_channel_chk', sql`${t.channel} in ('email','manual','web_form')`),
  ],
);

/** Правила SLA по приоритету; нет строки — действует значение по умолчанию из `DEFAULT_CASE_SLA` */
export const caseSlaRules = pgTable(
  'case_sla_rules',
  {
    workspaceId: wsCol(),
    priority: text('priority', { enum: CASE_PRIORITIES }).notNull(),
    firstResponseHours: integer('first_response_hours').notNull(),
    resolveHours: integer('resolve_hours').notNull(),
    updatedAt: updatedAt(),
  },
  t => [primaryKey({ columns: [t.workspaceId, t.priority], name: 'case_sla_rules_pk' }), check('case_sla_rules_hours_chk', sql`${t.firstResponseHours} > 0 and ${t.resolveHours} > 0`)],
);

/** Форма обращений на сайте: токен вебхука, ответственный по умолчанию */
export const caseForms = pgTable(
  'case_forms',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    token: text('token').notNull(),
    defaultOwnerId: uuid('default_owner_id'),
    enabled: boolean('enabled').notNull().default(true),
    /** Имя поля-ловушки для ботов; пусто — проверка выключена */
    honeypotField: text('honeypot_field').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('case_forms_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('case_forms_token_uq').on(t.token),
    foreignKey({ columns: [t.workspaceId, t.defaultOwnerId], foreignColumns: [members.workspaceId, members.id], name: 'case_forms_owner_fk' }).onDelete('set null'),
  ],
);

/** Счётчик номеров (воркспейс, год) */
export const caseCounters = pgTable(
  'case_counters',
  {
    workspaceId: wsCol(),
    year: integer('year').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  t => [primaryKey({ columns: [t.workspaceId, t.year], name: 'case_counters_pk' })],
);

/** Курсор распределения «по кругу» */
export const caseAssignCursor = pgTable(
  'case_assign_cursor',
  {
    workspaceId: wsCol().primaryKey(),
    lastMemberId: uuid('last_member_id'),
    updatedAt: updatedAt(),
  },
  t => [foreignKey({ columns: [t.workspaceId, t.lastMemberId], foreignColumns: [members.workspaceId, members.id], name: 'case_cursor_member_fk' }).onDelete('set null')],
);
