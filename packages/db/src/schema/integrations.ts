/* Интеграции оплат (задача 1174д): подключения банковских счетов к API банков и ЮКассе, ссылки на онлайн-оплату.
   Ключи доступа лежат в хранилище секретов (secrets.ts), здесь — только имя секрета. Правила — docs/architecture/payments.md. */
import { sql } from 'drizzle-orm';
import type { EnterpriseDataSchedule, IcSyncIssue } from '@erp/shared';
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, money, pk, ts, updatedAt } from './columns';
import { bankAccounts, documents } from './documents';
import { wsCol } from './tenant';

/** Подключение банковского счёта организации к API банка (tbank | tochka | sber) или ЮКассе (yookassa — счёт, на который приходит эквайринг) */
export const bankConnections = pgTable(
  'bank_connections',
  {
    id: pk(),
    workspaceId: wsCol(),
    bankAccountId: uuid('bank_account_id').notNull(),
    provider: text('provider', { enum: ['tbank', 'tochka', 'sber', 'yookassa'] }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Префикс имён секретов в workspace_secrets (по умолчанию имя провайдера: `tbank.token`, `sber.client_id`…); значений здесь нет */
    secretPrefix: text('secret_prefix').notNull(),
    /** Начало загрузки операций при первом запуске */
    syncFrom: date('sync_from', { mode: 'string' }),
    /** Проводить созданные документы сразу */
    autoPost: boolean('auto_post').notNull().default(true),
    /** Операции загружены по эту дату включительно */
    syncedThrough: date('synced_through', { mode: 'string' }),
    lastSyncAt: ts('last_sync_at'),
    lastStatus: text('last_status', { enum: ['ok', 'error'] }),
    lastError: text('last_error'),
    lastResult: jsonb('last_result').$type<Record<string, number | string>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('bank_connections_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('bank_connections_account_uq').on(t.workspaceId, t.bankAccountId),
    check('bank_connections_provider_chk', sql`${t.provider} in ('tbank','tochka','sber','yookassa')`),
    foreignKey({ columns: [t.workspaceId, t.bankAccountId], foreignColumns: [bankAccounts.workspaceId, bankAccounts.id], name: 'bank_connections_account_fk' }).onDelete('cascade'),
  ],
);

/** Ссылка на онлайн-оплату счёта или заказа (ЮКасса). Платёж ищется по provider_payment_id из вебхука */
export const paymentLinks = pgTable(
  'payment_links',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Документ, который оплачивают (счёт, заказ…) */
    documentId: uuid('document_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    amount: money('amount').notNull(),
    status: text('status', { enum: ['pending', 'succeeded', 'canceled'] }).notNull().default('pending'),
    providerPaymentId: text('provider_payment_id').notNull(),
    confirmationUrl: text('confirmation_url').notNull(),
    /** «Поступление на счёт», созданное по успешной оплате */
    receiptDocumentId: uuid('receipt_document_id'),
    createdBy: uuid('created_by'),
    paidAt: ts('paid_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('payment_links_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('payment_links_provider_uq').on(t.workspaceId, t.providerPaymentId),
    check('payment_links_status_chk', sql`${t.status} in ('pending','succeeded','canceled')`),
    check('payment_links_amount_chk', sql`${t.amount} > 0`),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'payment_links_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.connectionId], foreignColumns: [bankConnections.workspaceId, bankConnections.id], name: 'payment_links_connection_fk' }).onDelete('cascade'),
    index('payment_links_document_idx').on(t.documentId),
  ],
);
/* Соответствие наших объектов объектам 1С (задача 1226, docs/plans/2026-11-02-1c-exchange.md): основа всех обменов.
   GUID 1С хранится с конфигурацией-источником (buh3 / ut): базы разные, GUID не совпадают.
   Полиморфная привязка как у вложений: составного FK на объект нет, допустимые типы — реестр в packages/shared. */
export const integrations1cLinks = pgTable(
  'integrations_1c_links',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Конфигурация-источник GUID: Бухгалтерия 3.0, Управление торговлей или УНФ */
    source: text('source', { enum: ['buh3', 'ut', 'unf'] }).notNull(),
    /** Тип нашего объекта: organization, company, product, bank_account, document */
    entityType: text('entity_type', { enum: ['organization', 'company', 'product', 'bank_account', 'document', 'contract', 'warehouse', 'cash_register'] }).notNull(),
    /** Наш id (полиморфная привязка, FK нет — существование проверяет сервис) */
    entityId: uuid('entity_id').notNull(),
    /** GUID ссылки объекта в 1С */
    refUuid: text('ref_uuid').notNull(),
    /** Имя объекта 1С на момент сопоставления — показывать в интерфейсе без данных 1С */
    refName: text('ref_name').notNull().default(''),
    /** Как сопоставлено: вручную (приоритетнее, автопоиск не трогает) или автоматически */
    matchedBy: text('matched_by', { enum: ['manual', 'auto'] }).notNull().default('manual'),
    /** Правило автосопоставления (inn_kpp / inn / ogrn / sku / barcode / name / account / doc_number) — отчёт для UI */
    matchedRule: text('matched_rule'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('integrations_1c_links_ws_id_uq').on(t.workspaceId, t.id),
    // один наш объект ↔ один GUID 1С в пределах конфигурации, и наоборот
    unique('integrations_1c_links_entity_uq').on(t.workspaceId, t.source, t.entityType, t.entityId),
    unique('integrations_1c_links_ref_uq').on(t.workspaceId, t.source, t.entityType, t.refUuid),
    check('integrations_1c_links_source_chk', sql`${t.source} in ('buh3','ut','unf')`),
    check(
      'integrations_1c_links_entity_type_chk',
      sql`${t.entityType} in ('organization','company','product','bank_account','document','contract','warehouse','cash_register')`,
    ),
    index('integrations_1c_links_entity_idx').on(t.workspaceId, t.source, t.entityType),
    index('integrations_1c_links_ref_idx').on(t.workspaceId, t.refUuid),
  ],
);

/** Одно ежедневное расписание и последний готовый файл выгрузки на воркспейс. */
export const integrations1cSchedules = pgTable('integrations_1c_schedules', {
  workspaceId: wsCol().primaryKey(),
  options: jsonb('options').$type<EnterpriseDataSchedule>().notNull(),
  exportedDate: date('exported_date', { mode: 'string' }),
  xml: text('xml'),
  failedAt: ts('failed_at'),
});

export const integrations1cChannels = pgTable('integrations_1c_channels', {
  id: pk(),
  workspaceId: wsCol(),
  source: text('source', { enum: ['buh3', 'ut', 'unf'] }).notNull(),
  endpointUrl: text('endpoint_url').notNull(),
  nodeName: text('node_name').notNull(),
  localNodeName: text('local_node_name').notNull().default('ERP'),
  authType: text('auth_type', { enum: ['basic', 'bearer'] }).notNull(),
  username: text('username'),
  secretCiphertext: text('secret_ciphertext').notNull(),
  conflictPolicy: text('conflict_policy', { enum: ['1c_wins', 'erp_wins', 'manual'] }).notNull().default('1c_wins'),
  version: text('version', { enum: ['1.15', '1.17'] }).notNull().default('1.17'),
  intervalMinutes: integer('interval_minutes').notNull().default(60),
  enabled: boolean('enabled').notNull().default(false),
  registerFrom: ts('register_from').notNull().defaultNow(),
  lastSentMessageNo: integer('last_sent_message_no').notNull().default(0),
  lastReceivedMessageNo: integer('last_received_message_no').notNull().default(0),
  ackedSentMessageNo: integer('acked_sent_message_no').notNull().default(0),
  sentReceivedNo: integer('sent_received_no').notNull().default(0),
  lastDataReceivedNo: integer('last_data_received_no').notNull().default(0),
  pendingBlocked: boolean('pending_blocked').notNull().default(false),
  pendingXml: text('pending_xml'),
  pendingObjectCount: integer('pending_object_count').notNull().default(0),
  lastSyncAt: ts('last_sync_at'),
  lastError: text('last_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  unique('ic_channels_ws_id_uq').on(t.workspaceId, t.id),
  unique('ic_channels_ws_source_uq').on(t.workspaceId, t.source),
  index('ic_channels_enabled_idx').on(t.lastSyncAt).where(sql`${t.enabled}`),
  check('ic_channels_source_chk', sql`${t.source} in ('buh3','ut','unf')`),
  check('ic_channels_auth_chk', sql`(${t.authType} = 'basic' and ${t.username} is not null) or (${t.authType} = 'bearer' and ${t.username} is null)`),
  check('ic_channels_policy_chk', sql`${t.conflictPolicy} in ('1c_wins','erp_wins','manual')`),
  check('ic_channels_interval_chk', sql`${t.intervalMinutes} between 1 and 1440`),
  check('ic_channels_version_chk', sql`${t.version} in ('1.15','1.17')`),
  check('ic_channels_counters_chk', sql`${t.ackedSentMessageNo} between 0 and ${t.lastSentMessageNo} and ${t.sentReceivedNo} between 0 and ${t.lastReceivedMessageNo} and ${t.lastDataReceivedNo} between 0 and ${t.lastReceivedMessageNo}`),
]);

export const integrations1cChangeQueue = pgTable('integrations_1c_change_queue', {
  id: pk(),
  workspaceId: wsCol(),
  channelId: uuid('channel_id').notNull(),
  /** Outbox deduplication key. Retained independently from the event log. */
  eventId: uuid('event_id').notNull(),
  entityType: text('entity_type', { enum: ['organization', 'company', 'product', 'warehouse', 'document'] }).notNull(),
  entityId: uuid('entity_id').notNull(),
  action: text('action', { enum: ['upsert', 'remove'] }).notNull(),
  documentType: text('document_type'),
  updatedAt: updatedAt(),
  sentMessageNo: integer('sent_message_no'),
  ackedAt: ts('acked_at'),
  discardedAt: ts('discarded_at'),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.channelId], foreignColumns: [integrations1cChannels.workspaceId, integrations1cChannels.id], name: 'ic_queue_channel_fk' }).onDelete('cascade'),
  unique('ic_queue_event_uq').on(t.workspaceId, t.channelId, t.eventId),
  index('ic_queue_pending_idx').on(t.workspaceId, t.channelId, t.sentMessageNo, t.updatedAt).where(sql`${t.ackedAt} is null and ${t.discardedAt} is null`),
  index('ic_queue_entity_idx').on(t.workspaceId, t.channelId, t.entityType, t.entityId).where(sql`${t.ackedAt} is null and ${t.discardedAt} is null`),
  check('ic_queue_action_chk', sql`${t.action} in ('upsert','remove')`),
  check('ic_queue_type_chk', sql`${t.entityType} in ('organization','company','product','warehouse','document')`),
]);

export const integrations1cRuns = pgTable('integrations_1c_runs', {
  id: pk(),
  workspaceId: wsCol(),
  channelId: uuid('channel_id').notNull(),
  direction: text('direction', { enum: ['push', 'pull', 'both'] }).notNull(),
  status: text('status', { enum: ['ok', 'partial', 'error'] }).notNull(),
  sentMessageNo: integer('sent_message_no'),
  receivedMessageNo: integer('received_message_no'),
  objectsSent: integer('objects_sent').notNull().default(0),
  objectsReceived: integer('objects_received').notNull().default(0),
  conflictsCount: integer('conflicts_count').notNull().default(0),
  errorsJson: jsonb('errors_json').$type<IcSyncIssue[]>().notNull().default([]),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.channelId], foreignColumns: [integrations1cChannels.workspaceId, integrations1cChannels.id], name: 'ic_runs_channel_fk' }).onDelete('cascade'),
  index('ic_runs_channel_idx').on(t.workspaceId, t.channelId, t.startedAt),
  check('ic_runs_direction_chk', sql`${t.direction} in ('push','pull','both')`),
  check('ic_runs_status_chk', sql`${t.status} in ('ok','partial','error')`),
]);
