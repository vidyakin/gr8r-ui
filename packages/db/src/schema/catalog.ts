/* Каталог: единицы ОКЕИ, дерево категорий, характеристики категорий, товары и услуги.
   Таблицы арендатора (workspace_id + RLS); связи — составные внешние ключи (workspace_id, id). */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { FieldOptions } from '@gr8r/shared';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { companies } from './crm';
import { wsCol } from './people';
import { productKinds } from './positions';

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
    /** Вид номенклатуры: товар, услуга, работа (заказ-наряд) или операция (производство: не продаётся, склад не двигает). Список расширяют вместе с CHECK в БД */
    kind: text('kind', { enum: ['goods', 'service', 'work', 'operation'] }).notNull().default('goods'),
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
    /** Поставщик по умолчанию: заказы поставщикам по потребности создаются на него */
    defaultSupplierId: uuid('default_supplier_id'),
    /** Срок поставки, дней (для закупки): дата поступления в расчёте потребностей */
    leadDays: integer('lead_days').notNull().default(0),
    /** Товар-родитель: вариант товара (комбинация параметров с флажком «разрез склада») — обычная складская позиция */
    parentProductId: uuid('parent_product_id'),
    /** Значения параметров, дающих вариант: { цвет: 'white', размер: 'L' } */
    variantValues: jsonb('variant_values').$type<Record<string, string>>().notNull().default({}),
    /** Значения характеристик категории (по схеме категории с унаследованными) */
    attrs: jsonb('attrs').$type<Record<string, unknown>>().notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    /** Учёт по серийным номерам (задача 1099): складские документы требуют номера по количеству */
    trackSerials: boolean('track_serials').notNull().default(false),
    /** Гарантия, мес.: при продаже номер получает «гарантия до» = дата продажи + срок */
    warrantyMonths: integer('warranty_months'),
    /** Повторить продажу через, дн. (задача 1133): при продаже у компании ставится дата следующего контакта; пусто — нет */
    repeatSaleDays: integer('repeat_sale_days'),
    /** Длительность приёма, мин (задача 1171): услуга занимает столько слотов подряд; пусто — один слот */
    appointmentMinutes: integer('appointment_minutes'),
    /** Вес, кг (задача 1100): вес доставки = Σ количество × вес по строкам товаров */
    weightKg: numeric('weight_kg', { precision: 18, scale: 3 }),
    /** Вид номенклатуры (задача 1172, необязательный): тип вида совпадает с kind товара */
    productKindId: uuid('product_kind_id'),
    custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('products_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.categoryId], foreignColumns: [productCategories.workspaceId, productCategories.id], name: 'products_category_fk' }),
    foreignKey({ columns: [t.workspaceId, t.unitCode], foreignColumns: [units.workspaceId, units.code], name: 'products_unit_fk' }),
    foreignKey({ columns: [t.workspaceId, t.defaultSupplierId], foreignColumns: [companies.workspaceId, companies.id], name: 'products_default_supplier_fk' }),
    foreignKey({ columns: [t.workspaceId, t.parentProductId], foreignColumns: [t.workspaceId, t.id], name: 'products_parent_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productKindId], foreignColumns: [productKinds.workspaceId, productKinds.id], name: 'products_product_kind_fk' }),
    check('products_kind_chk', sql`${t.kind} in ('goods','service','work','operation')`),
    // вариант не может быть своим родителем (вложенность вариантов проверяет сервис)
    check('products_parent_chk', sql`${t.parentProductId} is null or ${t.parentProductId} <> ${t.id}`),
    check('products_vat_chk', sql`${t.vatRate} in ('none','0','5','7','10','20')`),
    check('products_price_chk', sql`${t.price} >= 0 and ${t.purchasePrice} >= 0`),
    check('products_lead_chk', sql`${t.leadDays} >= 0`),
    check('products_appointment_minutes_chk', sql`${t.appointmentMinutes} is null or ${t.appointmentMinutes} between 5 and 600`),
    check('products_repeat_days_chk', sql`${t.repeatSaleDays} is null or ${t.repeatSaleDays} between 1 and 3650`),
    check('products_weight_chk', sql`${t.weightKg} is null or ${t.weightKg} >= 0`),
    check('products_warranty_chk', sql`${t.warrantyMonths} is null or ${t.warrantyMonths} between 0 and 600`),
    uniqueIndex('products_ws_sku_uq').on(t.workspaceId, sql`lower(${t.sku})`).where(sql`${t.sku} <> ''`),
    uniqueIndex('products_ws_barcode_uq').on(t.workspaceId, t.barcode).where(sql`${t.barcode} <> ''`),
    // одна комбинация параметров у товара — один вариант (jsonb сравнивается без учёта порядка ключей)
    uniqueIndex('products_variant_uq').on(t.workspaceId, t.parentProductId, t.variantValues).where(sql`${t.parentProductId} is not null`),
    index('products_ws_category_idx').on(t.workspaceId, t.categoryId),
    index('products_parent_idx').on(t.workspaceId, t.parentProductId),
  ],
);
