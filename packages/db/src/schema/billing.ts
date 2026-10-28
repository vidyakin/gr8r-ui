/* Договоры, тарифные планы и биллинг (этап 8 «УНФ: Услуги»).
   Все таблицы арендаторские (workspace_id + RLS), связи внутри арендатора — составные внешние ключи (workspace_id, id). */
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { BillingBreakdownPayload } from '@gr8r/shared';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { products } from './catalog';
import { companies } from './crm';
import { documents, organizations } from './documents';
import { wsCol } from './people';

/** Тарифный план договора обслуживания: набор позиций и правило для номенклатуры вне плана */
export const tariffPlans = pgTable(
  'tariff_plans',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    /** Что делать при продаже номенклатуры, которой нет в плане: разрешить, предупредить, запретить */
    extraProductPolicy: text('extra_product_policy', { enum: ['allow', 'warn', 'forbid'] }).notNull().default('allow'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('tariff_plans_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('tariff_plans_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    check('tariff_plans_policy_chk', sql`${t.extraProductPolicy} in ('allow','warn','forbid')`),
  ],
);

/** Строка тарифного плана: номенклатура, количество, цена и признак абонплаты */
export const tariffPlanLines = pgTable(
  'tariff_plan_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    tariffPlanId: uuid('tariff_plan_id').notNull(),
    productId: uuid('product_id').notNull(),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('1'),
    price: money('price').notNull().default('0'),
    /** Включено в абонплату: выставляется каждый период по цене плана */
    isSubscription: boolean('is_subscription').notNull().default(false),
    /** Представление в счёте: в печатную форму попадает другая номенклатура */
    invoiceAsProductId: uuid('invoice_as_product_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('tariff_plan_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.tariffPlanId], foreignColumns: [tariffPlans.workspaceId, tariffPlans.id], name: 'tariff_plan_lines_plan_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'tariff_plan_lines_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.invoiceAsProductId], foreignColumns: [products.workspaceId, products.id], name: 'tariff_plan_lines_invoice_as_fk' }),
    check('tariff_plan_lines_qty_chk', sql`${t.qty} > 0 and ${t.price} >= 0`),
    index('tariff_plan_lines_plan_idx').on(t.workspaceId, t.tariffPlanId, t.sortOrder),
  ],
);

/** Договор: общий справочник (с покупателем, с поставщиком, прочее). Договор обслуживания включает биллинг */
export const contracts = pgTable(
  'contracts',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Контрагент */
    companyId: uuid('company_id').notNull(),
    /** Организация (кто выставляет) */
    organizationId: uuid('organization_id').notNull(),
    /** Номер договора: не уникальный — совпадение только предупреждение */
    number: text('number').notNull().default(''),
    date: date('date', { mode: 'string' }).notNull(),
    kind: text('kind', { enum: ['customer', 'supplier', 'other'] }).notNull().default('customer'),
    /** Категория (произвольная группа для отбора) */
    category: text('category').notNull().default(''),
    /** Договор подписан */
    isSigned: boolean('is_signed').notNull().default(false),
    /** Договор по умолчанию контрагента — подставляется в документы */
    isDefault: boolean('is_default').notNull().default(false),
    /** Срок действия */
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    /** Конец срока действия: пусто — бессрочный договор */
    validTo: date('valid_to', { mode: 'string' }),
    /** Срок оплаты (дней отсрочки) — подставляется в документы */
    paymentDays: integer('payment_days').notNull().default(0),
    /** Вид цен — подставляется в документы */
    priceType: text('price_type').notNull().default(''),
    /** Вид цен из справочника (задача 1178; внешний ключ ставит миграция 0051). Текстовый priceType оставлен для совместимости */
    priceKindId: uuid('price_kind_id'),
    /** Договор обслуживания: регулярные услуги с периодичностью */
    isService: boolean('is_service').notNull().default(false),
    /** Тарифный план (обязателен для договора обслуживания) */
    tariffPlanId: uuid('tariff_plan_id'),
    /** Периодичность биллинга */
    periodicity: text('periodicity', { enum: ['month', 'quarter', 'year'] }),
    /** День выставления счёта (1..31) */
    billingDay: integer('billing_day').notNull().default(1),
    /** Пакет документов: только счёт или счёт и акт */
    documentPackage: text('document_package', { enum: ['invoice', 'invoice_act'] }).notNull().default('invoice'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('contracts_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'contracts_company_fk' }),
    foreignKey({ columns: [t.workspaceId, t.organizationId], foreignColumns: [organizations.workspaceId, organizations.id], name: 'contracts_organization_fk' }),
    foreignKey({ columns: [t.workspaceId, t.tariffPlanId], foreignColumns: [tariffPlans.workspaceId, tariffPlans.id], name: 'contracts_tariff_plan_fk' }),
    check('contracts_kind_chk', sql`${t.kind} in ('customer','supplier','other')`),
    check('contracts_periodicity_chk', sql`${t.periodicity} is null or ${t.periodicity} in ('month','quarter','year')`),
    check('contracts_package_chk', sql`${t.documentPackage} in ('invoice','invoice_act')`),
    check('contracts_billing_day_chk', sql`${t.billingDay} between 1 and 31`),
    check('contracts_valid_range_chk', sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
    // договор обслуживания: тарифный план и периодичность обязательны
    check('contracts_service_chk', sql`(not ${t.isService}) or (${t.tariffPlanId} is not null and ${t.periodicity} is not null)`),
    // договор по умолчанию — один на контрагента
    uniqueIndex('contracts_default_uq').on(t.workspaceId, t.companyId).where(sql`${t.isDefault} and ${t.archivedAt} is null`),
    index('contracts_company_idx').on(t.workspaceId, t.companyId),
    index('contracts_service_idx').on(t.workspaceId, t.isService),
  ],
);

/** Запуск биллинга: один счёт на договор и период (идемпотентность) */
export const billingRuns = pgTable(
  'billing_runs',
  {
    id: pk(),
    workspaceId: wsCol(),
    contractId: uuid('contract_id').notNull(),
    /** Ключ периода: «2026-10», «2026-Q3», «2026» */
    period: text('period').notNull(),
    /** Счёт, созданный запуском */
    documentId: uuid('document_id'),
    createdAt: createdAt(),
  },
  t => [
    unique('billing_runs_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.contractId], foreignColumns: [contracts.workspaceId, contracts.id], name: 'billing_runs_contract_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'billing_runs_document_fk' }).onDelete('set null'),
    uniqueIndex('billing_runs_contract_period_uq').on(t.workspaceId, t.contractId, t.period),
    index('billing_runs_contract_idx').on(t.workspaceId, t.contractId),
  ],
);

/** Уже выставленные первичные документы: каждый попадает в счёт ровно один раз */
export const billingSources = pgTable(
  'billing_sources',
  {
    id: pk(),
    workspaceId: wsCol(),
    contractId: uuid('contract_id').notNull(),
    /** Вид первички: заказ-наряд, запись времени, отгрузка */
    sourceKind: text('source_kind', { enum: ['work_order', 'time_log', 'realization'] }).notNull(),
    sourceId: uuid('source_id').notNull(),
    /** Счёт, в который источник попал */
    documentId: uuid('document_id').notNull(),
    createdAt: createdAt(),
  },
  t => [
    unique('billing_sources_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.contractId], foreignColumns: [contracts.workspaceId, contracts.id], name: 'billing_sources_contract_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'billing_sources_document_fk' }).onDelete('cascade'),
    check('billing_sources_kind_chk', sql`${t.sourceKind} in ('work_order','time_log','realization')`),
    // источник выставляется один раз
    uniqueIndex('billing_sources_source_uq').on(t.workspaceId, t.sourceKind, t.sourceId),
    index('billing_sources_contract_idx').on(t.workspaceId, t.contractId),
  ],
);

/** Расшифровка биллинга счёта (вкладка «Billing breakdown») */
export const billingBreakdowns = pgTable(
  'billing_breakdowns',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Счёт */
    documentId: uuid('document_id').notNull(),
    payload: jsonb('payload').$type<BillingBreakdownPayload>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('billing_breakdowns_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'billing_breakdowns_document_fk' }).onDelete('cascade'),
    uniqueIndex('billing_breakdowns_document_uq').on(t.workspaceId, t.documentId),
  ],
);
