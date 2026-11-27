/* Дополнительные расходы в себестоимость (задача 1385, «Дополнительные расходы» 1С УНФ).

   Документ — обычная запись `documents` с типом `landed_cost` (номер, дата, статус, организация, статья и контрагент
   берутся у неё), здесь только то, чего нет у документов:
   - `landed_costs` — шапка предметной части: способ распределения и ссылка на счёт поставщика услуги;
   - `landed_cost_lines` — распределение по строкам документов-оснований (поступление, выпуск продукции).

   Движений склада документ не делает: он меняет себестоимость единицы уже записанного прихода. Прибавка живёт
   в `stock_cost_adjustments.own_delta` (как косвенные закрытия месяца) и разносится по цепочке движений
   `recomputeStockCosts` — дорожает остаток и себестоимость уже списанного и отгруженного. */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { LANDED_COST_METHODS } from '@erp/shared';
import { createdAt, money, pk, updatedAt } from './columns';
import { products } from './catalog';
import { costItems, documentLines, documents } from './documents';
import { companies } from './crm';
import { wsCol } from './people';

/** Документ «Дополнительные расходы»: способ распределения и счёт поставщика услуги */
export const landedCosts = pgTable(
  'landed_costs',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Документ-шапка (documents.type = 'landed_cost') */
    documentId: uuid('document_id').notNull(),
    /** Способ распределения суммы по строкам оснований */
    method: text('method', { enum: LANDED_COST_METHODS }).notNull().default('by_amount'),
    /** Контрагент-исполнитель услуги (перевозчик, брокер): у документа он необязателен, поэтому живёт здесь */
    supplierId: uuid('supplier_id'),
    /** Статья расходов (доставка, пошлина, погрузка): природа расхода для отчёта */
    costItemId: uuid('cost_item_id'),
    /** Счёт или документ поставщика услуги, если он заведён в системе (поступление услуг) */
    supplierDocumentId: uuid('supplier_document_id'),
    /** Номер и дата счёта поставщика строкой — когда документа в системе нет */
    supplierDocument: text('supplier_document').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('landed_costs_ws_id_uq').on(t.workspaceId, t.id),
    // предметная часть ровно одна на документ
    uniqueIndex('landed_costs_document_uq').on(t.workspaceId, t.documentId),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'landed_costs_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.supplierId], foreignColumns: [companies.workspaceId, companies.id], name: 'landed_costs_supplier_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.costItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'landed_costs_cost_item_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.supplierDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'landed_costs_supplier_document_fk' }).onDelete('set null'),
    check('landed_costs_method_chk', sql`${t.method} in ('by_amount','by_qty','by_weight','manual')`),
  ],
);

/** Строка распределения: сколько доп. расходов приходится на строку документа-основания.
    Снимок количества, стоимости строки и веса хранится рядом: отчёт и повторное открытие документа не зависят
    от того, что стало с базовым документом, а распределение остаётся объяснимым задним числом. */
export const landedCostLines = pgTable(
  'landed_cost_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Документ «Дополнительные расходы» */
    documentId: uuid('document_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Документ-основание: поступление или выпуск продукции */
    baseDocumentId: uuid('base_document_id').notNull(),
    /** Строка-товар основания, приход которой удорожается */
    baseDocumentLineId: uuid('base_document_line_id').notNull(),
    /** Товар строки (снимок): отчёт по доп. расходам в разрезе номенклатуры */
    productId: uuid('product_id').notNull(),
    /** Количество прихода по строке основания (базовые единицы) — база цены за единицу и распределения «по количеству» */
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Стоимость строки основания — база распределения «по сумме» */
    baseAmount: money('base_amount').notNull().default('0'),
    /** Вес строки (количество × вес единицы товара) — база распределения «по весу» */
    weight: numeric('weight', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Доля строки в сумме расходов документа */
    amount: money('amount').notNull().default('0'),
    createdAt: createdAt(),
  },
  t => [
    unique('landed_cost_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'landed_cost_lines_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.baseDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'landed_cost_lines_base_document_fk' }).onDelete('cascade'),
    // удаление строки основания (черновик документа) уносит и её долю: удорожать нечего
    foreignKey({ columns: [t.workspaceId, t.baseDocumentLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'landed_cost_lines_base_line_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'landed_cost_lines_product_fk' }),
    // строка основания встречается в документе один раз: две доли одной строки распределялись бы дважды
    uniqueIndex('landed_cost_lines_base_line_uq').on(t.workspaceId, t.documentId, t.baseDocumentLineId),
    check('landed_cost_lines_qty_chk', sql`${t.qty} >= 0 and ${t.baseAmount} >= 0 and ${t.weight} >= 0`),
    index('landed_cost_lines_document_idx').on(t.workspaceId, t.documentId, t.sortOrder),
    index('landed_cost_lines_base_idx').on(t.workspaceId, t.baseDocumentId),
    index('landed_cost_lines_base_line_idx').on(t.workspaceId, t.baseDocumentLineId),
  ],
);
