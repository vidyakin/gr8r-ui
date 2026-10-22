/* Калькуляция заказа покупателя (этап 7 «УНФ: Производство»): плановая себестоимость изделий по спецификациям
   с параметрами + разовые расходы (доставка и т. п.), источник цены себестоимости и наценка.
   Таблицы арендаторские (workspace_id + RLS), связи внутри арендатора — составные внешние ключи (workspace_id, id). */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { CalcLineType, CostPriceSource } from '@gr8r/shared';
import { createdAt, money, pk, updatedAt } from './columns';
import { products } from './catalog';
import { documentLines, documents } from './documents';
import { wsCol } from './people';

/** Калькуляция заказа: одна на заказ покупателя */
export const orderCalculations = pgTable(
  'order_calculations',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Заказ покупателя */
    documentId: uuid('document_id').notNull(),
    /** Источник цены себестоимости: средняя склада, последняя цена закупки или закупочная цена товара.
        Нет цены по выбранному способу — берётся следующий по порядку */
    priceSource: text('price_source', { enum: ['avg', 'last_purchase', 'purchase_price'] }).notNull().default('avg'),
    /** Наценка, % от себестоимости (цена строки заказа = себестоимость единицы × (1 + наценка)) */
    markupPct: numeric('markup_pct', { precision: 7, scale: 2 }).notNull().default('0'),
    /** Себестоимость состава заказа (материалы, работы, расходы и разовые расходы) */
    costTotal: money('cost_total').notNull().default('0'),
    /** Себестоимость по строкам заказа (только его изделий) — из неё считается цена строк */
    lineCostTotal: money('line_cost_total').notNull().default('0'),
    /** Расчётная цена строк заказа по наценке */
    priceTotal: money('price_total').notNull().default('0'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('order_calculations_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'order_calculations_document_fk' }).onDelete('cascade'),
    check('order_calculations_source_chk', sql`${t.priceSource} in ('avg','last_purchase','purchase_price')`),
    check('order_calculations_markup_chk', sql`${t.markupPct} >= 0`),
    // калькуляция одна на заказ
    uniqueIndex('order_calculations_document_uq').on(t.workspaceId, t.documentId),
  ],
);

/** Строка калькуляции: материал, полуфабрикат, работа, расход по спецификации или разовый расход */
export const orderCalculationLines = pgTable(
  'order_calculation_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Калькуляция */
    calculationId: uuid('calculation_id').notNull(),
    /** Строка заказа покупателя (пусто — разовый расход) */
    documentLineId: uuid('document_line_id'),
    /** extra — разовый расход (доставка); остальное — состав спецификации строки заказа */
    kind: text('kind', { enum: ['material', 'semi', 'work', 'expense', 'extra'] }).notNull(),
    /** Товар каталога (у работы и разового расхода — пусто) */
    productId: uuid('product_id'),
    /** Название позиции */
    name: text('name').notNull(),
    unitCode: text('unit_code').notNull().default('796'),
    /** Количество */
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Цена единицы по выбранному источнику (у работы и разового расхода — задаётся вручную) */
    price: money('price').notNull().default('0'),
    /** Сумма строки */
    amount: money('amount').notNull().default('0'),
    /** Себестоимость единицы по спецификации (для цены строки заказа) */
    unitCost: money('unit_cost'),
    note: text('note').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    unique('order_calculation_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.calculationId], foreignColumns: [orderCalculations.workspaceId, orderCalculations.id], name: 'order_calculation_lines_calculation_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.documentLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'order_calculation_lines_line_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'order_calculation_lines_product_fk' }),
    check('order_calculation_lines_kind_chk', sql`${t.kind} in ('material','semi','work','expense','extra')`),
    check('order_calculation_lines_qty_chk', sql`${t.qty} >= 0`),
    index('order_calculation_lines_calculation_idx').on(t.calculationId, t.sortOrder),
    index('order_calculation_lines_line_idx').on(t.documentLineId),
  ],
);

/** Типы строк калькуляции и источники цены — те же, что в shared */
export type OrderCalcLineType = CalcLineType;
export type OrderCalcPriceSource = CostPriceSource;