/* Прослеживаемость партий (задача 1253): отдельная сущность связей партий.
   НЕ переиспользуем serial_numbers — это самостоятельные рёбра графа «партия-источник → партия-результат»
   по документу (выпуск продукции, перемещение, переработка давальческого сырья).

   Одно ребро — одна пара «вход → выход»:
   - production: input_batch_id — списанная партия сырья/полуфабриката, output_batch_id — выпущенная партия продукции;
   - transfer:   input_batch_id — партия на складе-источнике, output_batch_id — партия на складе-получателе;
   - processing: давальческое сырьё и продукция идут через customer_stock_moves (без партий своего склада),
                 поэтому партия-источник/результат может быть null, а связь держится за заказ на переработку.
   Остаток и себестоимость связи не двигают — это только граф прослеживаемости. */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, numeric, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './columns';
import { companies } from './crm';
import { products } from './catalog';
import { documentLines, documents, stockBatches } from './documents';
import { wsCol } from './people';

export const stockBatchLinks = pgTable(
  'stock_batch_links',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Документ, породивший связь: выпуск продукции, перемещение, отчёт о переработке */
    documentId: uuid('document_id').notNull(),
    /** Вид связи: выпуск, перемещение или переработка давальческого сырья */
    kind: text('kind', { enum: ['production', 'transfer', 'processing'] }).notNull(),
    /** Партия-источник (сырьё/склад-источник); у переработки может быть null */
    inputBatchId: uuid('input_batch_id'),
    /** Партия-результат (продукция/склад-получатель); у переработки и незавершённой приёмки может быть null */
    outputBatchId: uuid('output_batch_id'),
    /** Строки документа, между которыми связь */
    inputLineId: uuid('input_line_id'),
    outputLineId: uuid('output_line_id'),
    /** Товары входа и выхода (для узлов дерева без партии) */
    inputProductId: uuid('input_product_id'),
    outputProductId: uuid('output_product_id'),
    /** Чей материал: собственный или давальца */
    ownerKind: text('owner_kind', { enum: ['own', 'customer'] }).notNull().default('own'),
    /** Давалец (для переработки) */
    ownerCompanyId: uuid('owner_company_id'),
    /** Заказ на переработку (для переработки) */
    processingOrderId: uuid('processing_order_id'),
    /** Количество по связи (списанное/переданное/принятое) */
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    createdAt: createdAt(),
  },
  t => [
    unique('stock_batch_links_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'stock_batch_links_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.inputBatchId], foreignColumns: [stockBatches.workspaceId, stockBatches.id], name: 'stock_batch_links_input_batch_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.outputBatchId], foreignColumns: [stockBatches.workspaceId, stockBatches.id], name: 'stock_batch_links_output_batch_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.inputLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'stock_batch_links_input_line_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.outputLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'stock_batch_links_output_line_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.inputProductId], foreignColumns: [products.workspaceId, products.id], name: 'stock_batch_links_input_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.outputProductId], foreignColumns: [products.workspaceId, products.id], name: 'stock_batch_links_output_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.ownerCompanyId], foreignColumns: [companies.workspaceId, companies.id], name: 'stock_batch_links_owner_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.processingOrderId], foreignColumns: [documents.workspaceId, documents.id], name: 'stock_batch_links_order_fk' }).onDelete('set null'),
    check('stock_batch_links_kind_chk', sql`${t.kind} in ('production','transfer','processing')`),
    check('stock_batch_links_owner_chk', sql`${t.ownerKind} in ('own','customer')`),
    check('stock_batch_links_qty_chk', sql`${t.qty} >= 0`),
    // хотя бы один конец связи задан: ребро без обеих партий осмысленно только у переработки давальца
    check('stock_batch_links_endpoint_chk', sql`${t.inputBatchId} is not null or ${t.outputBatchId} is not null or ${t.ownerKind} = 'customer'`),
    index('stock_batch_links_output_idx').on(t.workspaceId, t.outputBatchId).where(sql`${t.outputBatchId} is not null`),
    index('stock_batch_links_input_idx').on(t.workspaceId, t.inputBatchId).where(sql`${t.inputBatchId} is not null`),
    index('stock_batch_links_document_idx').on(t.workspaceId, t.documentId),
    index('stock_batch_links_order_idx').on(t.workspaceId, t.processingOrderId).where(sql`${t.processingOrderId} is not null`),
  ],
);
