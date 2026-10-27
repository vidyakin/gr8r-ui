/* Интеграции оплат (задача 1174д): подключения банковских счетов к API банков и ЮКассе, ссылки на онлайн-оплату.
   Ключи доступа лежат в хранилище секретов (secrets.ts), здесь — только имя секрета. Правила — docs/architecture/payments.md. */
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, jsonb, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
