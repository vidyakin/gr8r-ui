/* Переработка: приём давальческого сырья, выпуск из него, отчёт о переработке и возврат остатков;
   передача своего сырья стороннему переработчику и отчёт переработчика.

   Модель: давальческое сырьё и продукция из него живут в customer_stock_* (только количества), заказ на переработку —
   заказ покупателя с видом операции «Переработка», наши затраты выпуска (свои материалы, работы, накладные) —
   себестоимость услуги переработки. Своё сырьё у переработчика — обычный склад со ссылкой на контрагента. */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { dec, fmt, DOCUMENT_META, mul, type Dec } from '@gr8r/shared';
import type { Db } from './client';
import { applyCustomerStockMoves, customerStockRows, revertCustomerStockMoves, type CustomerMoveRequest, type CustomerStockKey } from './customer-stock';
import { DomainError } from './errors';
import { DOCUMENT_HOOKS } from './document-hooks';
import { assertProcessingOrder, createDocument, type DocCtx, type DocumentLineRow, type DocumentRow } from './documents';
import { recordEvent } from './events';
import { planComponents } from './production';
import { companies, customerStockBalances, documentLines, documents, manufacturedItems, processingServiceCosts, productionComponents, productionHeaders, productionItems, products, warehouses } from './schema';
import { uuidv7 } from './uuid';

/** Ключ давальческого сырья документа: склад, товар, давалец и заказ на переработку */
async function keyOfDocument(db: Db, doc: DocumentRow): Promise<{ ownerCompanyId: string; processingOrderId: string }> {
  if (!doc.tollingOrderId) throw new DomainError(422, 'tolling_order_required', 'Select a customer order with the processing kind of operation');
  const order = await assertProcessingOrder(db, doc.tollingOrderId);
  if (!order.counterpartyId) throw new DomainError(422, 'counterparty_required', 'Select a customer before posting');
  if (doc.counterpartyId && doc.counterpartyId !== order.counterpartyId) throw new DomainError(422, 'tolling_owner_mismatch', 'The counterparty of this document must be the owner of the customer materials');
  return { ownerCompanyId: order.counterpartyId, processingOrderId: order.id };
}

/** Строки-товары документа (услуги склад не двигают) */
async function goodsLines(db: Db, lines: DocumentLineRow[]): Promise<DocumentLineRow[]> {
  if (!lines.length) return [];
  const kinds = new Map((await db.select({ id: products.id, kind: products.kind }).from(products).where(inArray(products.id, [...new Set(lines.map(l => l.productId))]))).map(p => [p.id, p.kind]));
  return lines.filter(l => kinds.get(l.productId) === 'goods');
}

/* ---------------- приём в переработку и возврат ---------------- */

/** Приём давальческого сырья: приход на остаток давальца (собственный склад не меняется) */
async function receiveMaterials(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  const goods = await goodsLines(db, lines);
  if (!goods.length) throw new DomainError(422, 'no_lines', 'Add at least one goods line before posting');
  if (!doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse before posting');
  const { ownerCompanyId, processingOrderId } = await keyOfDocument(db, doc);
  await applyCustomerStockMoves(
    db,
    ctx.workspaceId,
    { id: doc.id, date: doc.date },
    goods.map(l => ({ warehouseId: doc.warehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'in', ownerCompanyId, processingOrderId })),
  );
}

/** Возврат неиспользованного сырья давальцу: списание с остатка давальца (товар физически остаётся у нас) */
async function returnMaterials(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  const goods = await goodsLines(db, lines);
  if (!goods.length) throw new DomainError(422, 'no_lines', 'Add at least one goods line before posting');
  if (!doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse before posting');
  const { ownerCompanyId, processingOrderId } = await keyOfDocument(db, doc);
  await applyCustomerStockMoves(
    db,
    ctx.workspaceId,
    { id: doc.id, date: doc.date },
    goods.map(l => ({ warehouseId: doc.warehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'out', ownerCompanyId, processingOrderId })),
  );
}

/* ---------------- себестоимость услуги переработки ---------------- */

/** Накопленная себестоимость услуги переработки по заказу: затраты выпусков из давальческого сырья
    (свои материалы по средней + работы + накладные) и доли косвенных затрат закрытий месяца на эти выпуски.
    Продукция при этом на нашем складе не появляется */
export async function processingOrderCost(db: Db, processingOrderId: string): Promise<string> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${productionItems.stageCost}), 0)::text` })
    .from(productionItems)
    .innerJoin(productionHeaders, and(eq(productionHeaders.workspaceId, productionItems.workspaceId), eq(productionHeaders.documentId, productionItems.documentId)))
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .where(and(eq(productionHeaders.processingOrderId, processingOrderId), eq(documents.type, 'production'), eq(documents.status, 'posted')));
  const [closed] = await db
    .select({ total: sql<string>`coalesce(sum(${processingServiceCosts.amount}), 0)::text` })
    .from(processingServiceCosts)
    .where(and(eq(processingServiceCosts.processingOrderId, processingOrderId), sql`${processingServiceCosts.closingId} is not null`));
  return fmt(dec(row?.total ?? '0') + dec(closed?.total ?? '0'), 2);
}

/** Отчёт о переработке: продукция и использованное сырьё списываются с остатка давальца, отходы возвращаются ему.
    Накопленная себестоимость услуги записывается на отчёт — с неё делается акт услуги */
async function reportProcessing(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  const goods = await goodsLines(db, lines);
  const products_ = goods.filter(l => (l.tollingRole ?? 'product') === 'product');
  const materials = goods.filter(l => l.tollingRole === 'material');
  const waste = goods.filter(l => l.tollingRole === 'waste');
  if (!products_.length) throw new DomainError(422, 'no_lines', 'Add at least one product line before posting');
  if (!doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse before posting');
  const { ownerCompanyId, processingOrderId } = await keyOfDocument(db, doc);
  const move = (l: DocumentLineRow, direction: 'in' | 'out'): CustomerMoveRequest => ({ warehouseId: doc.warehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction, ownerCompanyId, processingOrderId });
  await applyCustomerStockMoves(db, ctx.workspaceId, { id: doc.id, date: doc.date }, [...products_, ...materials].map(l => move(l, 'out')) .concat(waste.map(l => move(l, 'in'))));
  // себестоимость отчёта — затраты выпусков по заказу, ещё не отнесённые на прежние отчёты: при частичных отчётах
  // каждый получает свою партию, а не накопленную сумму заказа
  const total = dec(await processingOrderCost(db, processingOrderId));
  const [prev] = await db
    .select({ amount: sql<string>`coalesce(sum(${processingServiceCosts.amount}), 0)::text` })
    .from(processingServiceCosts)
    .where(
      and(
        eq(processingServiceCosts.processingOrderId, processingOrderId),
        sql`${processingServiceCosts.documentId} <> ${doc.id}`,
        // прежние отчёты заказа: их записи и доли закрытий, уже добавленные к ним
        sql`exists (select 1 from documents r where r.id = coalesce(${processingServiceCosts.reportId}, ${processingServiceCosts.documentId}) and r.type = 'tolling_report' and r.status = 'posted' and r.id <> ${doc.id})`,
      ),
    );
  const rest = total - dec(prev?.amount ?? '0');
  const cost = fmt(rest > 0n ? rest : 0n, 2);
  await db.insert(processingServiceCosts).values({ workspaceId: ctx.workspaceId, documentId: doc.id, processingOrderId, amount: cost }).onConflictDoUpdate({ target: [processingServiceCosts.workspaceId, processingServiceCosts.documentId], set: { amount: cost, updatedAt: new Date() } });
}

/** Себестоимость услуги документа: у отчёта о переработке — затраты его партии плюс доли закрытий месяца,
    добавленные к нему; у акта — себестоимость его отчёта */
export async function documentServiceCost(db: Db, documentId: string): Promise<string> {
  const [doc] = await db.select({ type: documents.type, basedOnId: documents.basedOnId }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (doc?.type === 'act') return doc.basedOnId ? documentServiceCost(db, doc.basedOnId) : '0.00';
  const [row] = await db
    .select({ amount: sql<string>`coalesce(sum(${processingServiceCosts.amount}), 0)::text` })
    .from(processingServiceCosts)
    .where(sql`${processingServiceCosts.documentId} = ${documentId} or ${processingServiceCosts.reportId} = ${documentId}`);
  return fmt(dec(row?.amount ?? '0'), 2);
}

/** Акт услуги по отчёту о переработке: строки продукции отчёта становятся услугой, себестоимость переносится на акт */
export async function createServiceAct(db: Db, ctx: DocCtx, reportId: string, input: { date?: string } = {}): Promise<string> {
  const [report] = await db.select().from(documents).where(eq(documents.id, reportId)).limit(1);
  if (!report || report.type !== 'tolling_report') throw new DomainError(404, 'not_found', 'Processing report not found');
  if (report.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the processing report first');
  if (!report.tollingOrderId) throw new DomainError(422, 'tolling_order_required', 'The report has no customer order with the processing kind of operation');
  // строки вкладки «Продукция» становятся услугой переработки: цена берётся из отчёта
  const src = (await db.select().from(documentLines).where(eq(documentLines.documentId, reportId)).orderBy(asc(documentLines.sortOrder))).filter(l => (l.tollingRole ?? 'product') === 'product');
  if (!src.length) throw new DomainError(422, 'nothing_to_create', 'The report has no product lines');
  const id = await createDocument(db, ctx, {
    type: 'act',
    counterpartyId: report.counterpartyId,
    warehouseId: report.warehouseId ?? undefined,
    date: input.date ?? report.date,
    comment: report.comment,
    lines: src.map(l => ({ productId: l.productId, name: l.name, unitCode: l.unitCode, qty: l.qty, price: l.price, discountPct: l.discountPct, vatRate: l.vatRate as never })),
  });
  await db.update(documents).set({ basedOnId: reportId, tollingOrderId: null }).where(eq(documents.id, id));
  // себестоимость акта не хранится отдельно: это себестоимость его отчёта (documentServiceCost по основанию)
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'act' } });
  return id;
}

/* ---------------- регистрация хуков ---------------- */

DOCUMENT_HOOKS.tolling_receipt = {
  check: async (db, _ctx, doc, lines) => {
    await keyOfDocument(db, doc);
    if (!(await goodsLines(db, lines)).length) throw new DomainError(422, 'no_lines', 'Add at least one goods line before posting');
    if (!doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse before posting');
  },
  post: receiveMaterials,
  afterUnpost: async (db, ctx, doc) => revertCustomerStockMoves(db, ctx.workspaceId, doc.id),
};

DOCUMENT_HOOKS.tolling_return = {
  check: async (db, _ctx, doc, lines) => {
    await keyOfDocument(db, doc);
    if (!(await goodsLines(db, lines)).length) throw new DomainError(422, 'no_lines', 'Add at least one goods line before posting');
    if (!doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse before posting');
  },
  post: returnMaterials,
  afterUnpost: async (db, ctx, doc) => revertCustomerStockMoves(db, ctx.workspaceId, doc.id),
};

DOCUMENT_HOOKS.tolling_report = {
  check: async (db, _ctx, doc, lines) => {
    await keyOfDocument(db, doc);
    if (!doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse before posting');
    if (!lines.some(l => (l.tollingRole ?? 'product') === 'product')) throw new DomainError(422, 'no_lines', 'Add at least one product line before posting');
  },
  post: reportProcessing,
  afterUnpost: async (db, ctx, doc) => {
    await revertCustomerStockMoves(db, ctx.workspaceId, doc.id);
    await db.delete(processingServiceCosts).where(eq(processingServiceCosts.documentId, doc.id));
    // доли закрытий, добавленные к отчёту, возвращаются заказу: их получит следующий отчёт
    await db.update(processingServiceCosts).set({ reportId: null, updatedAt: new Date() }).where(eq(processingServiceCosts.reportId, doc.id));
  },
};

/* ---------------- своё сырьё у переработчика ---------------- */

/** Склад контрагента (переработчика): обычный склад со ссылкой на контрагента */
export async function processorWarehouse(db: Db, counterpartyId: string): Promise<string | null> {
  const [row] = await db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.counterpartyId, counterpartyId), isNull(warehouses.archivedAt))).limit(1);
  return row?.id ?? null;
}

/** Передача своего сырья переработчику: обычное перемещение на склад контрагента (товар едет по своей средней) */
export async function createProcessorTransfer(db: Db, ctx: DocCtx, supplierOrderId: string, input: { date?: string; comment?: string } = {}): Promise<string> {
  const [order] = await db.select().from(documents).where(eq(documents.id, supplierOrderId)).limit(1);
  if (!order || order.type !== 'supplier_order') throw new DomainError(404, 'not_found', 'Supplier order not found');
  if (order.operation !== 'processing') throw new DomainError(422, 'invalid_type', 'The supplier order has no processing kind of operation');
  if (order.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the supplier order first');
  if (!order.counterpartyId) throw new DomainError(422, 'counterparty_required', 'Select a supplier before posting');
  const target = await processorWarehouse(db, order.counterpartyId);
  if (!target) throw new DomainError(422, 'processor_warehouse_required', 'Create a counterparty warehouse for this supplier first: the materials are stored there');
  if (!order.warehouseId) throw new DomainError(422, 'warehouse_required', 'The supplier order has no warehouse to move the materials from');
  const src = await db.select().from(documentLines).where(eq(documentLines.documentId, supplierOrderId)).orderBy(asc(documentLines.sortOrder));
  if (!src.length) throw new DomainError(422, 'nothing_to_create', 'The supplier order has no lines');
  const kinds = new Map((await db.select({ id: products.id, kind: products.kind }).from(products).where(inArray(products.id, [...new Set(src.map(l => l.productId))]))).map(p => [p.id, p.kind]));
  const goods = src.filter(l => kinds.get(l.productId) === 'goods');
  if (!goods.length) throw new DomainError(422, 'nothing_to_create', 'The supplier order has no goods to move');
  const id = await createDocument(db, ctx, {
    type: 'stock_transfer',
    warehouseId: order.warehouseId,
    targetWarehouseId: target,
    date: input.date ?? order.date,
    comment: input.comment?.trim() || `To the processor: ${order.number ?? ''}`.trim(),
    lines: goods.map(l => ({ productId: l.productId, name: l.name, unitCode: l.unitCode, qty: l.qty, price: '0', discountPct: '0', vatRate: 'none' as const })),
  });
  await db.update(documents).set({ basedOnId: supplierOrderId }).where(eq(documents.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'stock_transfer' } });
  return id;
}

export interface ProcessorReportInput {
  /** Изделие, которое вернул переработчик */
  itemId: string;
  qty: string;
  /** Склад переработчика (склад контрагента): оттуда списываются материалы */
  processorWarehouseId: string;
  /** Наш склад: куда приходит продукция */
  warehouseId: string;
  workCenterId?: string | null;
  date?: string;
  comment?: string;
  /** Заказ поставщику с видом операции «Переработка» (основание отчёта) */
  basedOnId?: string | null;
  /** Услуги переработчика: в себестоимость продукции (не в периодические затраты) */
  services?: { productId: string; qty: string; price: string }[];
  /** Материалы по факту; без них берётся спецификация изделия */
  materials?: { productId: string; qty: string }[];
}

/** Отчёт переработчика: выпуск на складе переработчика — материалы списываются с его склада по средней,
    услуга переработчика идёт в себестоимость продукции, продукция приходуется на наш склад */
export async function createProcessorReport(db: Db, ctx: DocCtx, input: ProcessorReportInput): Promise<string> {
  const [wh] = await db.select({ id: warehouses.id, counterpartyId: warehouses.counterpartyId }).from(warehouses).where(eq(warehouses.id, input.processorWarehouseId)).limit(1);
  if (!wh?.counterpartyId) throw new DomainError(422, 'processor_warehouse_required', 'Select a counterparty warehouse: it holds your materials at the processor');
  const [item] = await db.select().from(manufacturedItems).where(eq(manufacturedItems.id, input.itemId)).limit(1);
  if (!item) throw new DomainError(422, 'invalid_reference', 'The product does not exist');
  const productId = item.productId;
  if (!productId) throw new DomainError(422, 'item_not_stockable', `“${item.name}” has no product of the catalogue: it cannot be produced to stock`);
  const qty = dec(input.qty);
  if (qty <= 0n) throw new DomainError(422, 'invalid_quantity', 'The quantity must be greater than zero');
  // состав: фактические материалы отчёта или развёртка спецификации
  const plan = input.materials?.length
    ? input.materials.map(m => ({ kind: 'material' as const, productId: m.productId, itemId: null, workCenterId: null, operation: '', operationId: null, qty: m.qty, hours: '0', rate: null, fixedCost: null, plannedCost: '0', stageId: null }))
    : await planComponents(db, ctx.workspaceId, item.id, fmt(qty, 3), null);
  const mats = plan.filter(c => c.kind === 'material' || c.kind === 'semi');
  if (!mats.length && !(input.services?.length ?? 0)) throw new DomainError(422, 'no_lines', 'Add the materials used or the processor services');
  const productRows = await db.select({ id: products.id, name: products.name, unitCode: products.unitCode, kind: products.kind }).from(products).where(inArray(products.id, [productId, ...mats.map(m => m.productId!), ...(input.services ?? []).map(s => s.productId)]));
  const byProduct = new Map(productRows.map(p => [p.id, p]));
  // строки документа: продукция (приход), материалы (расход со склада переработчика), услуги (склад не двигают)
  const lines: { id: string; productId: string; name: string; unitCode: string; qty: string; price: string; role: 'in' | 'out' }[] = [{ id: uuidv7(), productId, name: byProduct.get(productId)?.name ?? item.name, unitCode: item.unitCode, qty: fmt(qty, 3), price: '0', role: 'in' }];
  const comps: { id: string; kind: 'material' | 'semi' | 'expense'; productId: string; qty: string; lineId: string | null; plannedCost: string }[] = [];
  for (const m of mats) {
    const p = byProduct.get(m.productId!);
    const lineId = uuidv7();
    lines.push({ id: lineId, productId: m.productId!, name: p?.name ?? '', unitCode: p?.unitCode ?? '796', qty: m.qty, price: '0', role: 'out' });
    comps.push({ id: uuidv7(), kind: m.kind as 'material' | 'semi', productId: m.productId!, qty: m.qty, lineId, plannedCost: m.plannedCost });
  }
  for (const s of input.services ?? []) {
    const p = byProduct.get(s.productId);
    if (!p) throw new DomainError(422, 'invalid_reference', 'The processor service does not exist');
    if (p.kind === 'goods') throw new DomainError(422, 'service_line_only', 'The processor reports services, not goods');
    const lineId = uuidv7();
    lines.push({ id: lineId, productId: s.productId, name: p.name, unitCode: p.unitCode, qty: s.qty, price: s.price, role: 'out' });
    comps.push({ id: uuidv7(), kind: 'expense', productId: s.productId, qty: s.qty, lineId, plannedCost: fmt(mul(dec(s.qty), dec(s.price))) });
  }
  const docId = await createDocument(db, ctx, {
    type: 'production',
    organizationId: null,
    operation: 'processing',
    warehouseId: wh.id,
    targetWarehouseId: input.warehouseId,
    workCenterId: input.workCenterId ?? null,
    date: input.date,
    comment: input.comment?.trim() || `Processor report: ${byProduct.get(productId)?.name ?? item.name}`,
    lines: lines.map(l => ({ id: l.id, productId: l.productId, name: l.name, unitCode: l.unitCode, qty: l.qty, price: l.price, discountPct: '0', vatRate: 'none' as const, stockRole: l.role })),
  });
  await db.insert(productionHeaders).values({ workspaceId: ctx.workspaceId, documentId: docId, workCenterId: input.workCenterId ?? null, plannedStart: null, plannedEnd: null, parentDocumentId: null, stageId: null });
  const [pos] = await db.insert(productionItems).values({ workspaceId: ctx.workspaceId, documentId: docId, itemId: item.id, qty: fmt(qty, 3), unitCode: item.unitCode, documentLineId: lines[0]!.id, sortOrder: 0 }).returning({ id: productionItems.id });
  await db.insert(productionComponents).values(
    comps.map((c, n) => ({
      workspaceId: ctx.workspaceId,
      documentId: docId,
      itemId: pos!.id,
      kind: c.kind,
      productId: c.productId,
      qty: c.qty,
      hours: '0',
      plannedCost: c.plannedCost,
      documentLineId: c.lineId,
      sortOrder: n,
    })),
  );
  if (input.basedOnId) await db.update(documents).set({ basedOnId: input.basedOnId }).where(eq(documents.id, docId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: docId, actorId: ctx.memberId, payload: { documentType: 'production' } });
  return docId;
}

/* ---------------- отчёт и остатки для интерфейса ---------------- */

/** Отчёт «Запасы, принятые в переработку» + остатки давальцев по заказу */
export async function tollingReport(db: Db, filters: Parameters<typeof customerStockRows>[1]) {
  return customerStockRows(db, filters);
}

/** Остаток давальца по (склад, товар) — сколько сырья заказа доступно под выпуск */
export async function customerAvailability(db: Db, warehouseId: string, ownerCompanyId: string, processingOrderId: string | null, productIds: string[]): Promise<Map<string, Dec>> {
  if (!productIds.length) return new Map();
  const rows = await db
    .select({ productId: customerStockBalances.productId, qty: sql<string>`sum(${customerStockBalances.qty})::text` })
    .from(customerStockBalances)
    .where(
      and(
        eq(customerStockBalances.warehouseId, warehouseId),
        eq(customerStockBalances.ownerCompanyId, ownerCompanyId),
        processingOrderId ? eq(customerStockBalances.processingOrderId, processingOrderId) : isNull(customerStockBalances.processingOrderId),
        inArray(customerStockBalances.productId, productIds),
      ),
    )
    .groupBy(customerStockBalances.productId);
  return new Map(rows.map(r => [r.productId, dec(r.qty)]));
}

/** Давалец и склад заказа на переработку — для карточек документов переработки */
export async function processingOrderContext(db: Db, processingOrderId: string): Promise<{ counterpartyId: string | null; counterpartyName: string | null; warehouseId: string | null }> {
  const [order] = await db.select({ counterpartyId: documents.counterpartyId, warehouseId: documents.warehouseId }).from(documents).where(eq(documents.id, processingOrderId)).limit(1);
  const [cp] = order?.counterpartyId ? await db.select({ name: companies.name }).from(companies).where(eq(companies.id, order.counterpartyId)).limit(1) : [];
  return { counterpartyId: order?.counterpartyId ?? null, counterpartyName: cp?.name ?? null, warehouseId: order?.warehouseId ?? null };
}

/** Типы документов переработки (экран «Документы переработки») */
export const tollingDocumentTypes = (): string[] => Object.entries(DOCUMENT_META).filter(([, m]) => m.tolling).map(([t]) => t);

/** Заказы на переработку: заказы покупателей с видом операции «Переработка» */
export async function listProcessingOrders(db: Db, params: { status?: string; q?: string; limit: number; offset: number }) {
  const conds = [eq(documents.type, 'customer_order'), eq(documents.operation, 'processing'), params.status ? eq(documents.status, params.status as 'draft' | 'posted' | 'cancelled') : undefined, params.q ? sql`(${documents.number} ilike ${'%' + params.q + '%'} or ${documents.comment} ilike ${'%' + params.q + '%'})` : undefined];
  const rows = await db
    .select()
    .from(documents)
    .where(and(...conds))
    .orderBy(desc(documents.date), desc(documents.createdAt))
    .limit(params.limit)
    .offset(params.offset);
  const ids = rows.map(r => r.id);
  const lines = ids.length ? await db.select().from(documentLines).where(inArray(documentLines.documentId, ids)) : [];
  const owners = [...new Set(rows.map(r => r.counterpartyId).filter((x): x is string => !!x))];
  const ownersRows = owners.length ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, owners)) : [];
  const ownerName = new Map(ownersRows.map(c => [c.id, c.name]));
  const [count] = await db.select({ n: sql<number>`count(*)` }).from(documents).where(and(...conds));
  return {
    items: rows.map(r => ({ ...r, ownerName: r.counterpartyId ? (ownerName.get(r.counterpartyId) ?? null) : null, lineCount: lines.filter(l => l.documentId === r.id).length })),
    total: Number(count?.n ?? 0),
  };
}

export type { CustomerStockKey };
export { customerStockRows };