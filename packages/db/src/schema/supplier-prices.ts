/* Загрузка прайсов поставщиков (миграция 0117, docs/superpowers/specs/2026-11-11-supplier-price-upload-design.md):
   профили формата файла, загруженные прайсы и их строки. Таблицы арендатора, связи — составные FK. */
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, ts, updatedAt } from './columns';
import { attachments } from './attachments';
import { products } from './catalog';
import { companies } from './crm';
import { members, wsCol } from './people';
import { priceKinds } from './pricing';

/** Профиль формата файла прайса поставщика: с какой строки данные и в каких колонках артикул/наименование/цена/единица (1-based) */
export const supplierPriceProfiles = pgTable(
  'supplier_price_profiles',
  {
    id: pk(),
    workspaceId: wsCol(),
    companyId: uuid('company_id').notNull(),
    name: text('name').notNull(),
    firstRow: integer('first_row').notNull().default(1),
    articleCol: integer('article_col').notNull(),
    nameCol: integer('name_col'),
    priceCol: integer('price_col').notNull(),
    unitCol: integer('unit_col'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('supplier_price_profiles_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'supplier_price_profiles_company_fk' }),
    check('supplier_price_profiles_cols_chk', sql`${t.firstRow} >= 1 and ${t.articleCol} >= 1 and ${t.priceCol} >= 1 and (${t.nameCol} is null or ${t.nameCol} >= 1) and (${t.unitCol} is null or ${t.unitCol} >= 1)`),
    uniqueIndex('supplier_price_profiles_name_uq').on(t.workspaceId, t.companyId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    index('supplier_price_profiles_company_idx').on(t.workspaceId, t.companyId),
  ],
);

/** Загруженный прайс поставщика: draft → applied. Файл — вложение (entity_type = supplier_price) */
export const supplierPrices = pgTable(
  'supplier_prices',
  {
    id: pk(),
    workspaceId: wsCol(),
    companyId: uuid('company_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    name: text('name').notNull(),
    /** Вид цен поставщика, в который пишутся цены при применении */
    kindId: uuid('kind_id').notNull(),
    /** Дата действия цен */
    date: date('date', { mode: 'string' }).notNull(),
    status: text('status', { enum: ['draft', 'applied'] }).notNull().default('draft'),
    /** Цены в файле указаны с НДС */
    pricesIncludeVat: boolean('prices_include_vat').notNull().default(true),
    attachmentId: uuid('attachment_id'),
    fileName: text('file_name').notNull().default(''),
    fileSize: integer('file_size').notNull().default(0),
    linesTotal: integer('lines_total').notNull().default(0),
    linesMatched: integer('lines_matched').notNull().default(0),
    linesUnmatched: integer('lines_unmatched').notNull().default(0),
    linesConflict: integer('lines_conflict').notNull().default(0),
    createdAt: createdAt(),
    createdBy: uuid('created_by'),
    appliedAt: ts('applied_at'),
  },
  t => [
    unique('supplier_prices_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'supplier_prices_company_fk' }),
    foreignKey({ columns: [t.workspaceId, t.profileId], foreignColumns: [supplierPriceProfiles.workspaceId, supplierPriceProfiles.id], name: 'supplier_prices_profile_fk' }),
    foreignKey({ columns: [t.workspaceId, t.kindId], foreignColumns: [priceKinds.workspaceId, priceKinds.id], name: 'supplier_prices_kind_fk' }),
    foreignKey({ columns: [t.workspaceId, t.attachmentId], foreignColumns: [attachments.workspaceId, attachments.id], name: 'supplier_prices_attachment_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.createdBy], foreignColumns: [members.workspaceId, members.id], name: 'supplier_prices_created_by_fk' }).onDelete('set null'),
    check('supplier_prices_status_chk', sql`${t.status} in ('draft','applied')`),
    index('supplier_prices_company_idx').on(t.workspaceId, t.companyId, t.createdAt),
  ],
);

/** Строка прайса: что в файле и с каким нашим товаром сопоставлена */
export const supplierPriceLines = pgTable(
  'supplier_price_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    priceId: uuid('price_id').notNull(),
    /** Номер строки в файле (1-based) */
    rowNo: integer('row_no').notNull(),
    article: text('article').notNull().default(''),
    name: text('name').notNull().default(''),
    /** Единица (код ОКЕИ), распознанная из файла */
    unitCode: text('unit_code'),
    /** Цена из файла; null — не разобрана (строка skipped) */
    price: money('price'),
    productId: uuid('product_id'),
    status: text('status', { enum: ['matched', 'unmatched', 'conflict', 'skipped'] }).notNull(),
    /** Причина пропуска (price_invalid, manual, vat_rate_none…) */
    note: text('note').notNull().default(''),
    /** id наших товаров с тем же артикулом (conflict) или тем же названием — для ручного выбора */
    candidates: jsonb('candidates').$type<string[]>().notNull().default([]),
  },
  t => [
    unique('supplier_price_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.priceId], foreignColumns: [supplierPrices.workspaceId, supplierPrices.id], name: 'supplier_price_lines_price_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'supplier_price_lines_product_fk' }).onDelete('set null'),
    check('supplier_price_lines_status_chk', sql`${t.status} in ('matched','unmatched','conflict','skipped')`),
    index('supplier_price_lines_price_idx').on(t.priceId, t.rowNo),
  ],
);
