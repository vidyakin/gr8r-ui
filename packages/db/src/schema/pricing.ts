/* Виды цен и прайс-листы (задача 1178, миграция 0051_price_kinds): справочник видов цен, история цен по товарам,
   строки документа «Установка цен» и публичные ссылки на прайс-лист. Таблицы арендатора, связи — составные FK.
   Колонки price_kind_id в documents / contracts / companies / work_order_kinds — без внешнего ключа в схеме Drizzle
   (схемы ссылаются друг на друга), внешние ключи ставит миграция. Правила — docs/architecture/pricing.md. */
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, ts, updatedAt } from './columns';
import { products } from './catalog';
import { companies } from './crm';
import { documents } from './documents';
import { wsCol } from './people';

/** Вид цен. Системные: «Розничная» (retail) и «Закупочная» (purchase) — ручные, от поступлений */
export const priceKinds = pgTable(
  'price_kinds',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    /** manual — цены вводятся; derived — от другого вида ± процент; cost_based — от себестоимости или закупки + наценка */
    method: text('method', { enum: ['manual', 'derived', 'cost_based'] }).notNull().default('manual'),
    systemKey: text('system_key'),
    baseKindId: uuid('base_kind_id'),
    /** Наценка (+) или скидка (−), % */
    markupPct: numeric('markup_pct', { precision: 7, scale: 2 }).notNull().default('0'),
    costBasis: text('cost_basis', { enum: ['avg_cost', 'last_purchase'] }),
    roundingStep: numeric('rounding_step', { precision: 10, scale: 2 }).notNull().default('0.01'),
    roundingMode: text('rounding_mode', { enum: ['math', 'up'] }).notNull().default('math'),
    roundToNine: boolean('round_to_nine').notNull().default(false),
    includesVat: boolean('includes_vat').notNull().default(true),
    /** Вид цен поставщика: контрагент-поставщик */
    supplierId: uuid('supplier_id'),
    updateFromReceipts: boolean('update_from_receipts').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('price_kinds_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.baseKindId], foreignColumns: [t.workspaceId, t.id], name: 'price_kinds_base_fk' }),
    foreignKey({ columns: [t.workspaceId, t.supplierId], foreignColumns: [companies.workspaceId, companies.id], name: 'price_kinds_supplier_fk' }),
    check('price_kinds_method_chk', sql`${t.method} in ('manual','derived','cost_based')`),
    check('price_kinds_basis_chk', sql`${t.costBasis} is null or ${t.costBasis} in ('avg_cost','last_purchase')`),
    check('price_kinds_rounding_chk', sql`${t.roundingStep} in (0.01, 1, 10, 100) and ${t.roundingMode} in ('math','up')`),
    check('price_kinds_rule_chk', sql`(${t.method} <> 'derived' or ${t.baseKindId} is not null) and (${t.method} <> 'cost_based' or ${t.costBasis} is not null)`),
    check('price_kinds_base_self_chk', sql`${t.baseKindId} is null or ${t.baseKindId} <> ${t.id}`),
    uniqueIndex('price_kinds_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    uniqueIndex('price_kinds_system_uq').on(t.workspaceId, t.systemKey).where(sql`${t.systemKey} is not null`),
  ],
);

/** История цен: запись «с этой даты цена такая». Цена на дату — последняя запись с date <= даты (дата, затем id: uuid v7 растёт со временем).
    Записи, созданные документом «Установка цен», несут document_id — отмена проведения удаляет их */
export const productPrices = pgTable(
  'product_prices',
  {
    id: pk(),
    workspaceId: wsCol(),
    priceKindId: uuid('price_kind_id').notNull(),
    productId: uuid('product_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    price: money('price').notNull(),
    documentId: uuid('document_id'),
    lineId: uuid('line_id'),
    createdAt: createdAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.priceKindId], foreignColumns: [priceKinds.workspaceId, priceKinds.id], name: 'product_prices_kind_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'product_prices_product_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'product_prices_document_fk' }).onDelete('cascade'),
    check('product_prices_price_chk', sql`${t.price} >= 0`),
    index('product_prices_lookup_idx').on(t.workspaceId, t.priceKindId, t.productId, t.date),
    index('product_prices_product_idx').on(t.workspaceId, t.productId),
    index('product_prices_document_idx').on(t.documentId),
  ],
);

/** Строки документа «Установка цен» (price_setting): товар × вид цен → цена; old_price — цена до установки (на дату документа) */
export const priceSettingLines = pgTable(
  'price_setting_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    productId: uuid('product_id').notNull(),
    priceKindId: uuid('price_kind_id').notNull(),
    price: money('price').notNull(),
    oldPrice: money('old_price'),
  },
  t => [
    unique('price_setting_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'price_setting_lines_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'price_setting_lines_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.priceKindId], foreignColumns: [priceKinds.workspaceId, priceKinds.id], name: 'price_setting_lines_kind_fk' }),
    check('price_setting_lines_price_chk', sql`${t.price} >= 0`),
    uniqueIndex('price_setting_lines_uq').on(t.documentId, t.productId, t.priceKindId),
    index('price_setting_lines_document_idx').on(t.documentId, t.sortOrder),
  ],
);

/** Публичная ссылка на прайс-лист: в базе только хэш секрета, сам токен виден один раз при создании.
    Виды цен — только публикуемые (не закупочные, не от себестоимости, не цены поставщиков) */
export const priceListLinks = pgTable(
  'price_list_links',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    priceKindIds: jsonb('price_kind_ids').$type<string[]>().notNull().default([]),
    categoryIds: jsonb('category_ids').$type<string[]>().notNull().default([]),
    inStockOnly: boolean('in_stock_only').notNull().default(false),
    expiresAt: date('expires_at', { mode: 'string' }),
    revokedAt: ts('revoked_at'),
    viewCount: integer('view_count').notNull().default(0),
    lastViewedAt: ts('last_viewed_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('price_list_links_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('price_list_links_hash_uq').on(t.tokenHash),
    index('price_list_links_ws_idx').on(t.workspaceId, t.createdAt),
  ],
);
