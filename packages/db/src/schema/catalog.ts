/* Каталог: единицы ОКЕИ, дерево категорий, характеристики категорий, товары и услуги.
   Таблицы арендатора (workspace_id + RLS); связи — составные внешние ключи (workspace_id, id). */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { FieldOptions } from '@gr8r/shared';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { wsCol } from './people';

/** Справочник единиц: базовый набор ОКЕИ воркспейс получает при создании, свои единицы добавляются рядом */
export const units = pgTable(
  'units',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Код ОКЕИ ('796' — штука); не меняется: на него ссылаются товары и спецификации */
    code: text('code').notNull(),
    name: text('name').notNull(),
    symbol: text('symbol').notNull(),
    isBase: boolean('is_base').notNull().default(false),
    createdAt: createdAt(),
  },
  t => [unique('units_ws_code_uq').on(t.workspaceId, t.code)],
);

/** Дерево категорий. path — материализованный путь из id предков и самой категории через «/» (выборка поддерева — по префиксу) */
export const productCategories = pgTable(
  'product_categories',
  {
    id: pk(),
    workspaceId: wsCol(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    path: text('path').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('product_categories_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.parentId], foreignColumns: [t.workspaceId, t.id], name: 'product_categories_parent_fk' }),
    index('product_categories_path_idx').on(t.workspaceId, t.path.op('text_pattern_ops')),
  ],
);

/** Характеристика категории; наследуется всеми потомками (ключ уникален вдоль цепочки предков) */
export const attributeDefs = pgTable(
  'attribute_defs',
  {
    id: pk(),
    workspaceId: wsCol(),
    categoryId: uuid('category_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    required: boolean('required').notNull().default(false),
    unit: text('unit').notNull().default(''),
    options: jsonb('options').$type<FieldOptions>().notNull().default({}),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('attribute_defs_cat_key_uq').on(t.categoryId, t.key),
    foreignKey({ columns: [t.workspaceId, t.categoryId], foreignColumns: [productCategories.workspaceId, productCategories.id], name: 'attribute_defs_category_fk' }).onDelete('cascade'),
  ],
);

export const products = pgTable(
  'products',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Вид номенклатуры: товар, услуга или работа (заказ-наряд). Список расширяют вместе с CHECK в БД */
    kind: text('kind', { enum: ['goods', 'service', 'work'] }).notNull().default('goods'),
    sku: text('sku').notNull().default(''),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    barcode: text('barcode').notNull().default(''),
    unitCode: text('unit_code').notNull().default('796'),
    /** 'none' | '0' | '5' | '7' | '10' | '20' */
    vatRate: text('vat_rate').notNull().default('20'),
    /** Цена продажи */
    price: money('price').notNull().default('0'),
    purchasePrice: money('purchase_price').notNull().default('0'),
    categoryId: uuid('category_id'),
    /** Значения характеристик категории (по схеме категории с унаследованными) */
    attrs: jsonb('attrs').$type<Record<string, unknown>>().notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('products_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.categoryId], foreignColumns: [productCategories.workspaceId, productCategories.id], name: 'products_category_fk' }),
    foreignKey({ columns: [t.workspaceId, t.unitCode], foreignColumns: [units.workspaceId, units.code], name: 'products_unit_fk' }),
    check('products_kind_chk', sql`${t.kind} in ('goods','service','work')`),
    check('products_vat_chk', sql`${t.vatRate} in ('none','0','5','7','10','20')`),
    check('products_price_chk', sql`${t.price} >= 0 and ${t.purchasePrice} >= 0`),
    uniqueIndex('products_ws_sku_uq').on(t.workspaceId, sql`lower(${t.sku})`).where(sql`${t.sku} <> ''`),
    uniqueIndex('products_ws_barcode_uq').on(t.workspaceId, t.barcode).where(sql`${t.barcode} <> ''`),
    index('products_ws_category_idx').on(t.workspaceId, t.categoryId),
  ],
);
