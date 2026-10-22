/* Заказ на производство и выпуск продукции: снимок развёрнутой спецификации, списание материалов и полуфабрикатов,
   приход продукции по фактической себестоимости (материалы по средней + работы + накладные), автоматический резерв
   выпущенной продукции под связанный заказ покупателя и «один документ выпуска за день на участок».

   Модель: заказ на производство (`production_order`) и выпуск (`production`) — обычные документы, а производственные данные
   лежат рядом: production_items (что выпускаем), production_components (снимок состава), production_headers (изготовитель и сроки).
   Правила — в docs/architecture.md, раздел «Производство». */
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { computeBomCost, dec, div, explodeBom, fmt, FULFIL_TYPES, mul, resolveMaterialPrice, roundDiv, type BomItemInput, type Explosion } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { DOCUMENT_HOOKS } from './document-hooks';
import { createDocument, postDocument, unpostDocument, type DocCtx } from './documents';
import { recordEvent } from './events';
import { applyStockMoves, loadAvgCosts, loadInventorySettings, type MoveRequest } from './stock';
import { bomLines, companies, documentLines, documents, manufacturedItems, productManufacturing, productionComponents, productionHeaders, productionItems, products, stockReservations, warehouses, workCenters, workspaces } from './schema';
import { uuidv7 } from './uuid';

export type ItemRow = typeof manufacturedItems.$inferSelect;

/* ---------------- справочники и план ---------------- */

/** Строка состава выпуска: материал, полуфабрикат или работа */
export interface PlannedComponent {
  kind: 'material' | 'semi' | 'work';
  /** Материал или полуфабрикат на складе */
  productId: string | null;
  /** Продукция (для полуфабриката) */
  itemId: string | null;
  /** Участок (работа) */
  workCenterId: string | null;
  /** Название работы */
  operation: string;
  qty: string;
  hours: string;
  /** Ставка за час из строки спецификации; пусто — ставка участка */
  rate: string | null;
  fixedCost: string | null;
  /** Плановая стоимость строки */
  plannedCost: string;
}

/** Источник цены материала — настройка воркспейса */
export async function loadPriceSource(db: Db, workspaceId: string): Promise<'purchase' | 'price' | 'avg_cost'> {
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const v = ws?.settings?.materialPriceSource;
  return v === 'price' || v === 'avg_cost' ? v : 'purchase';
}

/** Продукция со строками спецификаций, участки и товары: всё, что нужно планированию и расчёту себестоимости */
export async function loadProductionGraph(db: Db) {
  const items = await db.select().from(manufacturedItems).where(isNull(manufacturedItems.archivedAt)).orderBy(asc(manufacturedItems.name));
  const lines = await db.select().from(bomLines).orderBy(asc(bomLines.itemId), asc(bomLines.sortOrder), asc(bomLines.createdAt));
  const centers = await db.select().from(workCenters);
  const productIds = [...new Set(lines.map(l => l.productId).filter((x): x is string => !!x))];
  const mats = productIds.length ? await db.select().from(products).where(inArray(products.id, productIds)) : [];
  const avg = productIds.length ? await loadAvgCosts(db, productIds) : new Map<string, string>();
  const byItem = new Map<string, typeof bomLines.$inferSelect[]>();
  for (const l of lines) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l]);
  const inputs: BomItemInput[] = items.map(i => ({
    id: i.id,
    name: i.name,
    unitCode: i.unitCode,
    productId: i.productId,
    batchQty: i.batchQty,
    overheadPct: i.overheadPct,
    lines: (byItem.get(i.id) ?? []).map(l => ({ id: l.id, kind: l.kind, qty: l.qty, productId: l.productId, scrapPct: l.scrapPct, unitCode: l.unitCode, childItemId: l.childItemId, semiMode: l.semiMode, operation: l.operation, workCenterId: l.workCenterId, hours: l.hours, rate: l.rate, fixedCost: l.fixedCost })),
  }));
  return { items, byItem, centers, mats, avg, inputs };
}

/** Себестоимость единицы изделия по спецификации (плановая) */
function unitCost(graph: Awaited<ReturnType<typeof loadProductionGraph>>, itemId: string, source: 'purchase' | 'price' | 'avg_cost'): string | null {
  try {
    const prod = new Map(graph.mats.map(p => [p.id, p]));
    const rates = new Map(graph.centers.map(w => [w.id, w.hourlyRate]));
    const tree = computeBomCost(graph.inputs, itemId, {
      materialPrice: pid => (prod.has(pid) ? resolveMaterialPrice(source, prod.get(pid)!, graph.avg.get(pid)) : null),
      workCenterRate: wid => rates.get(wid),
    });
    return tree.unit.total;
  } catch {
    return null;
  }
}

/** План состава выпуска: развёртка спецификации на количество с плановыми стоимостями */
export async function planComponents(db: Db, workspaceId: string, itemId: string, qty: string): Promise<PlannedComponent[]> {
  const graph = await loadProductionGraph(db);
  const source = await loadPriceSource(db, workspaceId);
  const prod = new Map(graph.mats.map(p => [p.id, p]));
  const rates = new Map(graph.centers.map(w => [w.id, w.hourlyRate]));
  let explosion: Explosion;
  try {
    explosion = explodeBom(graph.inputs, itemId, qty);
  } catch (e) {
    throw new DomainError(422, 'bom_cycle', e instanceof Error ? e.message : 'The bill of materials cannot be expanded');
  }
  const out: PlannedComponent[] = [];
  for (const m of explosion.materials) {
    const p = prod.get(m.productId);
    const price = p ? resolveMaterialPrice(source, p, graph.avg.get(m.productId)) : null;
    out.push({ kind: 'material', productId: m.productId, itemId: null, workCenterId: null, operation: '', qty: m.qty, hours: '0', rate: null, fixedCost: null, plannedCost: fmt(mul(dec(m.qty), dec(price ?? '0'))) });
  }
  for (const s of explosion.semis) {
    // полуфабрикат в режиме stock списывается со склада: нужен товар каталога
    if (!s.productId) throw new DomainError(422, 'item_not_stockable', `“${s.name}” has no product of the catalogue: it cannot be written off from stock`);
    const cost = unitCost(graph, s.itemId, source);
    out.push({ kind: 'semi', productId: s.productId, itemId: s.itemId, workCenterId: null, operation: '', qty: s.qty, hours: '0', rate: null, fixedCost: null, plannedCost: fmt(mul(dec(s.qty), dec(cost ?? '0'))) });
  }
  for (const w of explosion.works) {
    const rate = w.rate ?? (w.workCenterId ? (rates.get(w.workCenterId) ?? null) : null);
    const cost = mul(dec(w.hours), dec(rate ?? '0')) + dec(w.fixedCost ?? '0');
    out.push({ kind: 'work', productId: null, itemId: null, workCenterId: w.workCenterId, operation: w.operation, qty: '0', hours: w.hours, rate, fixedCost: w.fixedCost, plannedCost: fmt(cost) });
  }
  return out;
}

/* ---------------- заказ на производство ---------------- */

export interface ProductionOrderInput {
  id?: string;
  workCenterId?: string | null;
  warehouseId?: string | null;
  targetWarehouseId?: string | null;
  date?: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  comment?: string;
  parentDocumentId?: string | null;
  items: { itemId: string; qty: string; customerOrderLineId?: string | null }[];
}

/** Позиции заказа: что выпускаем */
export async function createProductionOrder(db: Db, ctx: DocCtx, input: ProductionOrderInput): Promise<string> {
  const itemIds = [...new Set(input.items.map(i => i.itemId))];
  const items = itemIds.length ? await db.select().from(manufacturedItems).where(inArray(manufacturedItems.id, itemIds)) : [];
  const byItem = new Map(items.map(i => [i.id, i]));
  for (const i of input.items) {
    const it = byItem.get(i.itemId);
    if (!it || it.archivedAt) throw new DomainError(422, 'invalid_reference', 'The product does not exist or is archived');
    if (dec(i.qty) <= 0n) throw new DomainError(422, 'invalid_quantity', 'The quantity must be greater than zero');
  }
  // строка заказа покупателя: должна быть у проведённого заказа покупателя
  for (const i of input.items) {
    if (i.customerOrderLineId) await assertCustomerOrderLine(db, i.customerOrderLineId);
  }
  if (input.workCenterId) await assertWorkCenter(db, input.workCenterId);
  const id = await createDocument(db, ctx, {
    ...(input.id ? { id: input.id } : {}),
    type: 'production_order',
    organizationId: null,
    warehouseId: input.warehouseId ?? undefined,
    targetWarehouseId: input.targetWarehouseId ?? undefined,
    date: input.date,
    comment: input.comment ?? '',
    lines: [],
  });
  await db.insert(productionHeaders).values({
    workspaceId: ctx.workspaceId,
    documentId: id,
    workCenterId: input.workCenterId ?? null,
    plannedStart: input.plannedStart ? new Date(input.plannedStart) : null,
    plannedEnd: input.plannedEnd ? new Date(input.plannedEnd) : null,
    parentDocumentId: input.parentDocumentId ?? null,
  });
  // новый заказ сразу в состоянии «запланирован»
  await db.update(documents).set({ state: 'planned' }).where(eq(documents.id, id));
  if (input.items.length) {
    await db.insert(productionItems).values(
      input.items.map((i, n) => ({
        workspaceId: ctx.workspaceId,
        documentId: id,
        itemId: i.itemId,
        qty: i.qty,
        unitCode: byItem.get(i.itemId)!.unitCode,
        customerOrderLineId: i.customerOrderLineId ?? null,
        sortOrder: n,
      })),
    );
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'production_order' } });
  return id;
}

export interface ProductionOrderPatch {
  workCenterId?: string | null;
  warehouseId?: string | null;
  targetWarehouseId?: string | null;
  date?: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  comment?: string;
  parentDocumentId?: string | null;
  items?: { itemId: string; qty: string; customerOrderLineId?: string | null }[];
}

/** Правка заказа на производство: шапка и позиции */
export async function updateProductionOrder(db: Db, ctx: DocCtx, id: string, patch: ProductionOrderPatch): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1).for('update');
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  if (doc.type !== 'production_order') throw new DomainError(422, 'invalid_type', 'This is not a production order');
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  const [header] = await db.select().from(productionHeaders).where(eq(productionHeaders.documentId, id)).limit(1);
  if (patch.workCenterId !== undefined && patch.workCenterId) await assertWorkCenter(db, patch.workCenterId);
  const set: Partial<typeof productionHeaders.$inferInsert> = { updatedAt: new Date() };
  if (patch.workCenterId !== undefined) set.workCenterId = patch.workCenterId;
  if (patch.plannedStart !== undefined) set.plannedStart = patch.plannedStart ? new Date(patch.plannedStart) : null;
  if (patch.plannedEnd !== undefined) set.plannedEnd = patch.plannedEnd ? new Date(patch.plannedEnd) : null;
  if (patch.parentDocumentId !== undefined) set.parentDocumentId = patch.parentDocumentId;
  if (header) await db.update(productionHeaders).set(set).where(eq(productionHeaders.documentId, id));
  else await db.insert(productionHeaders).values({ workspaceId: ctx.workspaceId, documentId: id, workCenterId: patch.workCenterId ?? null, plannedStart: patch.plannedStart ? new Date(patch.plannedStart) : null, plannedEnd: patch.plannedEnd ? new Date(patch.plannedEnd) : null, parentDocumentId: patch.parentDocumentId ?? null });
  const docSet: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  if (patch.warehouseId !== undefined) docSet.warehouseId = patch.warehouseId;
  if (patch.targetWarehouseId !== undefined) docSet.targetWarehouseId = patch.targetWarehouseId;
  if (patch.date) docSet.date = patch.date;
  if (patch.comment !== undefined) docSet.comment = patch.comment;
  await db.update(documents).set(docSet).where(eq(documents.id, id));
  if (patch.items) {
    const itemIds = [...new Set(patch.items.map(i => i.itemId))];
    const items = itemIds.length ? await db.select().from(manufacturedItems).where(inArray(manufacturedItems.id, itemIds)) : [];
    const byItem = new Map(items.map(i => [i.id, i]));
    for (const i of patch.items) {
      if (!byItem.has(i.itemId)) throw new DomainError(422, 'invalid_reference', 'The product does not exist');
      if (i.customerOrderLineId) await assertCustomerOrderLine(db, i.customerOrderLineId);
    }
    await db.delete(productionItems).where(eq(productionItems.documentId, id));
    if (patch.items.length)
      await db.insert(productionItems).values(
        patch.items.map((i, n) => ({
          workspaceId: ctx.workspaceId,
          documentId: id,
          itemId: i.itemId,
          qty: i.qty,
          unitCode: byItem.get(i.itemId)!.unitCode,
          customerOrderLineId: i.customerOrderLineId ?? null,
          sortOrder: n,
        })),
      );
    // снимок состава больше не соответствует позициям — пересобирается по кнопке
    await db.delete(productionComponents).where(eq(productionComponents.documentId, id));
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(patch) } });
}

/** Снимок спецификации в заказ: состав по каждой позиции (развёртка на количество позиции) */
export async function fillOrderFromBom(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  if (doc.type !== 'production_order') throw new DomainError(422, 'invalid_type', 'This is not a production order');
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  const items = await db.select().from(productionItems).where(eq(productionItems.documentId, id)).orderBy(asc(productionItems.sortOrder));
  if (!items.length) throw new DomainError(422, 'no_items', 'Add products to produce first');
  await db.delete(productionComponents).where(eq(productionComponents.documentId, id));
  const graph = await loadProductionGraph(db);
  const source = await loadPriceSource(db, ctx.workspaceId);
  const rows: (typeof productionComponents.$inferInsert)[] = [];
  for (const it of items) {
    const plan = await planComponents(db, ctx.workspaceId, it.itemId, it.qty);
    for (const c of plan) rows.push({ workspaceId: ctx.workspaceId, documentId: id, itemId: it.id, kind: c.kind, productId: c.productId, workCenterId: c.workCenterId, operation: c.operation, qty: c.qty, hours: c.hours, rate: c.rate, fixedCost: c.fixedCost, plannedCost: c.plannedCost, sortOrder: rows.length });
    const cost = unitCost(graph, it.itemId, source);
    if (cost) await db.update(productionItems).set({ plannedUnitCost: cost }).where(eq(productionItems.id, it.id));
  }
  if (rows.length) await db.insert(productionComponents).values(rows);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { changes: ['components'] } });
}

/* ---------------- выпуск ---------------- */

export interface ProductionLineInput {
  /** Позиция заказа на производство, которую выполняет выпуск */
  orderItemId?: string | null;
  /** Строка заказа покупателя (выпуск прямо из заказа покупателя) */
  customerOrderLineId?: string | null;
  qty: string;
}

export interface ProductionInput {
  /** Заказ на производство */
  orderId?: string | null;
  /** Заказ покупателя */
  customerOrderId?: string | null;
  date?: string;
  workCenterId?: string | null;
  warehouseId?: string | null;
  targetWarehouseId?: string | null;
  lines: ProductionLineInput[];
}

/** План выпуска: что производим (продукция и количество) и из чего (состав) */
export interface ProductionPlan {
  itemId: string;
  qty: string;
  /** Позиция заказа на производство, которую выполняет выпуск */
  sourceItemId: string | null;
  /** Строка заказа покупателя, которую выполняет выпуск */
  customerOrderLineId: string | null;
  components: PlannedComponent[];
}

/** Выпуск по заказу на производство: одна позиция заказа — одна продукция выпуска */
export async function createProductionFromOrder(db: Db, ctx: DocCtx, orderId: string, input: ProductionInput): Promise<string> {
  const [order] = await db.select().from(documents).where(eq(documents.id, orderId)).limit(1);
  if (!order) throw new DomainError(404, 'not_found', 'document not found');
  if (order.type !== 'production_order') throw new DomainError(422, 'invalid_type', 'This is not a production order');
  if (order.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the production order first');
  const [header] = await db.select().from(productionHeaders).where(eq(productionHeaders.documentId, orderId)).limit(1);
  const plans = await orderPlans(db, ctx, orderId, input.lines.map(l => ({ orderItemId: l.orderItemId ?? '', qty: l.qty })));
  return createOrAppendProduction(db, ctx, {
    date: input.date ?? order.date,
    workCenterId: input.workCenterId ?? header?.workCenterId ?? null,
    warehouseId: input.warehouseId ?? null,
    targetWarehouseId: input.targetWarehouseId ?? null,
    fallbackWarehouseId: order.warehouseId,
    fallbackTargetWarehouseId: order.targetWarehouseId,
    basedOnId: orderId,
    plans,
  });
}

/** Планы выпуска по позициям заказа на производство: состав — снимок заказа (пропорционально количеству) или развёртка спецификации.
    Без количества — весь остаток к выпуску */
async function orderPlans(db: Db, ctx: DocCtx, orderId: string, requested: { orderItemId: string; qty?: string }[]): Promise<ProductionPlan[]> {
  const [order] = await db.select().from(documents).where(eq(documents.id, orderId)).limit(1);
  if (!order) throw new DomainError(404, 'not_found', 'document not found');
  if (order.type !== 'production_order') throw new DomainError(422, 'invalid_type', 'This is not a production order');
  if (order.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the production order first');
  const orderItems = await db.select().from(productionItems).where(eq(productionItems.documentId, orderId)).orderBy(asc(productionItems.sortOrder));
  const byId = new Map(orderItems.map(i => [i.id, i]));
  const snapshot = await db.select().from(productionComponents).where(eq(productionComponents.documentId, orderId)).orderBy(asc(productionComponents.sortOrder));
  const produced = await producedQty(db, ctx.workspaceId, orderItems.map(i => i.id));
  const plans: ProductionPlan[] = [];
  for (const l of requested) {
    const src = l.orderItemId ? byId.get(l.orderItemId) : undefined;
    if (!src) throw new DomainError(422, 'invalid_reference', 'The position does not belong to this production order');
    const left = dec(src.qty) - (produced.get(src.id) ?? 0n);
    const qty = l.qty ? dec(l.qty) : left;
    if (qty <= 0n) continue;
    if (qty > left) throw new DomainError(422, 'over_fulfilment', `“${src.itemId}”: only ${fmt(left, 3)} of ${fmt(dec(src.qty), 3)} is left to produce`);
    // состав: снимок заказа (пропорционально количеству) или развёртка спецификации
    const scale = div(qty, dec(src.qty));
    const own = snapshot.filter(c => c.itemId === src.id);
    const components: PlannedComponent[] = own.length
      ? own.map(c => ({
          kind: c.kind,
          productId: c.productId,
          itemId: null,
          workCenterId: c.workCenterId,
          operation: c.operation,
          qty: c.kind === 'work' ? c.qty : fmt(mul(dec(c.qty), scale), 3),
          // часы работы тоже пропорциональны количеству
          hours: c.kind === 'work' ? fmt(mul(dec(c.hours), scale), 3) : c.hours,
          rate: c.rate,
          fixedCost: c.fixedCost,
          plannedCost: fmt(mul(dec(c.plannedCost), scale)),
        }))
      : await planComponents(db, ctx.workspaceId, src.itemId, fmt(qty, 3));
    plans.push({ itemId: src.itemId, qty: fmt(qty, 3), sourceItemId: src.id, customerOrderLineId: src.customerOrderLineId, components });
  }
  return plans;
}

/** Выпуск прямо из заказа покупателя: товар с способом пополнения «производство» */
export async function createProductionFromCustomerOrder(db: Db, ctx: DocCtx, input: ProductionInput & { customerOrderId: string }): Promise<string> {
  const [order] = await db.select().from(documents).where(eq(documents.id, input.customerOrderId)).limit(1);
  if (!order) throw new DomainError(404, 'not_found', 'document not found');
  if (order.type !== 'customer_order') throw new DomainError(422, 'invalid_type', 'This is not a customer order');
  if (order.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the customer order first');
  // строки по умолчанию — все производимые строки заказа, по остатку
  const wanted = input.lines.length ? input.lines : await producibleLines(db, ctx, order.id);
  const plans = await customerPlans(db, ctx, order.id, wanted.map(l => ({ customerOrderLineId: l.customerOrderLineId ?? '', qty: l.qty })));
  if (!plans.length) throw new DomainError(422, 'nothing_to_create', 'Everything from this customer order is already produced');
  return createOrAppendProduction(db, ctx, {
    date: input.date ?? order.date,
    workCenterId: input.workCenterId ?? null,
    warehouseId: input.warehouseId ?? null,
    targetWarehouseId: input.targetWarehouseId ?? null,
    fallbackWarehouseId: order.warehouseId,
    basedOnId: order.id,
    plans,
  });
}

/** Планы выпуска по строкам заказа покупателя: производится товар со способом пополнения «производство» */
async function customerPlans(db: Db, ctx: DocCtx, customerOrderId: string, requested: { customerOrderLineId: string; qty?: string }[]): Promise<ProductionPlan[]> {
  const [order] = await db.select().from(documents).where(eq(documents.id, customerOrderId)).limit(1);
  if (!order) throw new DomainError(404, 'not_found', 'document not found');
  if (order.type !== 'customer_order') throw new DomainError(422, 'invalid_type', 'This is not a customer order');
  if (order.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the customer order first');
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, order.id));
  const byId = new Map(lines.map(l => [l.id, l]));
  const produced = await producedByCustomerLine(db, ctx.workspaceId, lines.map(l => l.id));
  const shipped = await shippedQty(db, ctx.workspaceId, lines.map(l => l.id));
  const settings = await db.select().from(productManufacturing);
  const byProduct = new Map(settings.map(s => [s.productId, s]));
  const plans: ProductionPlan[] = [];
  for (const l of requested) {
    const src = l.customerOrderLineId ? byId.get(l.customerOrderLineId) : undefined;
    if (!src) throw new DomainError(422, 'invalid_reference', 'The line does not belong to this customer order');
    const setting = byProduct.get(src.productId);
    if (!setting || setting.replenishment !== 'production' || !setting.defaultItemId) throw new DomainError(422, 'not_produced', `“${src.name}” is not produced: set the way it is replenished and the default specification`);
    const left = dec(src.qty) - (shipped.get(src.id) ?? 0n) - (produced.get(src.id) ?? 0n);
    const qty = l.qty ? dec(l.qty) : left;
    if (qty <= 0n) continue;
    if (qty > left) throw new DomainError(422, 'over_fulfilment', `“${src.name}”: only ${fmt(left, 3)} of ${fmt(dec(src.qty), 3)} is left to produce`);
    const components = await planComponents(db, ctx.workspaceId, setting.defaultItemId, fmt(qty, 3));
    plans.push({ itemId: setting.defaultItemId, qty: fmt(qty, 3), sourceItemId: null, customerOrderLineId: src.id, components });
  }
  return plans;
}

/** Строки заказа покупателя, которые производятся: товар с пополнением «производство» и остаток к выпуску */
async function producibleLines(db: Db, ctx: DocCtx, customerOrderId: string): Promise<{ customerOrderLineId: string; qty: string }[]> {
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, customerOrderId));
  const settings = await db.select().from(productManufacturing);
  const byProduct = new Map(settings.map(s => [s.productId, s]));
  const produced = await producedByCustomerLine(db, ctx.workspaceId, lines.map(l => l.id));
  const shipped = await shippedQty(db, ctx.workspaceId, lines.map(l => l.id));
  const out: { customerOrderLineId: string; qty: string }[] = [];
  for (const l of lines) {
    const s = byProduct.get(l.productId);
    if (!s || s.replenishment !== 'production' || !s.defaultItemId) continue;
    const left = dec(l.qty) - (shipped.get(l.id) ?? 0n) - (produced.get(l.id) ?? 0n);
    if (left <= 0n) continue;
    out.push({ customerOrderLineId: l.id, qty: fmt(left, 3) });
  }
  return out;
}

/** Заказ на производство по заказу покупателя: позиции — производимые строки заказа */
export async function createProductionOrderFromCustomerOrder(
  db: Db,
  ctx: DocCtx,
  input: { customerOrderId: string; date?: string; workCenterId?: string | null; warehouseId?: string | null; targetWarehouseId?: string | null },
): Promise<string> {
  const [order] = await db.select().from(documents).where(eq(documents.id, input.customerOrderId)).limit(1);
  if (!order) throw new DomainError(404, 'not_found', 'document not found');
  if (order.type !== 'customer_order') throw new DomainError(422, 'invalid_type', 'This is not a customer order');
  if (order.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the customer order first');
  const lines = await producibleLines(db, ctx, input.customerOrderId);
  if (!lines.length) throw new DomainError(422, 'nothing_to_create', 'None of the products of this customer order is produced: set the way it is replenished and the default specification');
  const settings = await db.select().from(productManufacturing);
  const byProduct = new Map(settings.map(s => [s.productId, s]));
  const docLines = await db.select().from(documentLines).where(eq(documentLines.documentId, input.customerOrderId));
  const byLine = new Map(docLines.map(l => [l.id, l]));
  const items = lines.flatMap(l => {
    const src = byLine.get(l.customerOrderLineId);
    const s = src ? byProduct.get(src.productId) : undefined;
    if (!s?.defaultItemId) return [];
    return [{ itemId: s.defaultItemId, qty: l.qty, customerOrderLineId: l.customerOrderLineId }];
  });
  return createProductionOrder(db, ctx, {
    workCenterId: input.workCenterId,
    warehouseId: input.warehouseId ?? order.warehouseId,
    targetWarehouseId: input.targetWarehouseId,
    date: input.date,
    comment: `Production for customer order ${order.number ?? ''}`.trim(),
    items,
  });
}

/** Создание (или дополнение) документа выпуска: строки продукции, материалов и работы */
async function writeProduction(
  db: Db,
  ctx: DocCtx,
  input: {
    date?: string;
    workCenterId?: string | null;
    warehouseId?: string | null;
    targetWarehouseId?: string | null;
    /** Склад заказа — запасной вариант, если участок своих складов не задал */
    fallbackWarehouseId?: string | null;
    fallbackTargetWarehouseId?: string | null;
    basedOnId: string | null;
    plans: ProductionPlan[];
  },
): Promise<string> {
  if (!input.plans.length) throw new DomainError(422, 'no_items', 'Add products to produce');
  const { warehouseId, targetWarehouseId } = await resolveWarehouses(db, input.workCenterId, input.warehouseId, input.targetWarehouseId, input.fallbackWarehouseId, input.fallbackTargetWarehouseId);
  const rows = await buildProductionRows(db, input.plans);
  const docId = await createDocument(db, ctx, {
    type: 'production',
    organizationId: null,
    warehouseId,
    targetWarehouseId,
    date: input.date,
    lines: rows.docLines.map(l => ({ id: l.id, productId: l.productId, name: l.name, unitCode: l.unitCode, qty: l.qty, price: '0', discountPct: '0', vatRate: 'none' as const, stockRole: l.stockRole })),
  });
  await db.insert(productionHeaders).values({ workspaceId: ctx.workspaceId, documentId: docId, workCenterId: input.workCenterId ?? null, plannedStart: null, plannedEnd: null, parentDocumentId: null });
  const itemRows = await db.insert(productionItems).values(
    rows.itemLines.map((l, n) => ({ workspaceId: ctx.workspaceId, documentId: docId, itemId: l.itemId, qty: l.qty, unitCode: l.unitCode, customerOrderLineId: l.customerOrderLineId, sourceItemId: l.sourceItemId, documentLineId: l.id, sortOrder: n })),
  ).returning();
  const itemIdByLine = new Map(itemRows.map(i => [i.documentLineId!, i.id]));
  await db.insert(productionComponents).values(
    rows.componentLines.map((c, n) => ({ workspaceId: ctx.workspaceId, documentId: docId, itemId: itemIdByLine.get(c.itemId) ?? null, kind: c.kind, productId: c.productId, workCenterId: c.workCenterId, operation: c.operation, qty: c.qty, hours: c.hours, rate: c.rate, fixedCost: c.fixedCost, plannedCost: c.plannedCost, documentLineId: c.documentLineId, sortOrder: n })),
  );
  if (input.basedOnId) await db.update(documents).set({ basedOnId: input.basedOnId }).where(eq(documents.id, docId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: docId, actorId: ctx.memberId, payload: { documentType: 'production' } });
  return docId;
}

/** Строки выпуска: продукция (приход), материалы (расход) и работы */
async function buildProductionRows(
  db: Db,
  plans: ProductionPlan[],
): Promise<{
  warehouseId: string | null;
  targetWarehouseId: string | null;
  docLines: { id: string; productId: string; name: string; unitCode: string; qty: string; stockRole: 'in' | 'out' }[];
  itemLines: { id: string; itemId: string; qty: string; sourceItemId: string | null; customerOrderLineId: string | null; productId: string; name: string; unitCode: string }[];
  componentLines: { id: string; itemId: string; kind: 'material' | 'semi' | 'work'; productId: string | null; workCenterId: string | null; operation: string; qty: string; hours: string; rate: string | null; fixedCost: string | null; plannedCost: string; documentLineId: string | null }[];
}> {
  const itemIds = [...new Set(plans.map(p => p.itemId))];
  const products_ = await db.select().from(manufacturedItems).where(inArray(manufacturedItems.id, itemIds));
  const byItem = new Map(products_.map(i => [i.id, i]));
  for (const p of plans) {
    const it = byItem.get(p.itemId);
    if (!it) throw new DomainError(422, 'invalid_reference', 'The product does not exist');
    if (!it.productId) throw new DomainError(422, 'item_not_stockable', `“${it.name}” has no product of the catalogue: it cannot be produced to stock`);
  }
  const docLines: { id: string; productId: string; name: string; unitCode: string; qty: string; stockRole: 'in' | 'out' }[] = [];
  const itemLines: { id: string; itemId: string; qty: string; sourceItemId: string | null; customerOrderLineId: string | null; productId: string; name: string; unitCode: string }[] = [];
  const componentLines: { id: string; itemId: string; kind: 'material' | 'semi' | 'work'; productId: string | null; workCenterId: string | null; operation: string; qty: string; hours: string; rate: string | null; fixedCost: string | null; plannedCost: string; documentLineId: string | null }[] = [];
  for (const p of plans) {
    const it = byItem.get(p.itemId)!;
    const lineId = uuidv7();
    docLines.push({ id: lineId, productId: it.productId!, name: it.name, unitCode: it.unitCode, qty: p.qty, stockRole: 'in' });
    itemLines.push({ id: lineId, itemId: p.itemId, qty: p.qty, sourceItemId: p.sourceItemId, customerOrderLineId: p.customerOrderLineId, productId: it.productId!, name: it.name, unitCode: it.unitCode });
    for (const c of p.components) {
      if (c.kind === 'work') {
        componentLines.push({ id: uuidv7(), itemId: lineId, kind: 'work', productId: null, workCenterId: c.workCenterId, operation: c.operation, qty: '0', hours: c.hours, rate: c.rate, fixedCost: c.fixedCost, plannedCost: c.plannedCost, documentLineId: null });
        continue;
      }
      const materialLineId = uuidv7();
      const prod = await db.select({ name: products.name, unitCode: products.unitCode }).from(products).where(eq(products.id, c.productId!)).limit(1);
      docLines.push({ id: materialLineId, productId: c.productId!, name: prod[0]?.name ?? '', unitCode: prod[0]?.unitCode ?? '796', qty: c.qty, stockRole: 'out' });
      componentLines.push({ id: uuidv7(), itemId: lineId, kind: c.kind, productId: c.productId, workCenterId: null, operation: '', qty: c.qty, hours: '0', rate: null, fixedCost: null, plannedCost: c.plannedCost, documentLineId: materialLineId });
    }
  }
  return { warehouseId: null, targetWarehouseId: null, docLines, itemLines, componentLines };
}

/** Склады выпуска: участок задаёт свои склады, потом запасной вариант (склад заказа), потом склад по умолчанию */
async function resolveWarehouses(db: Db, workCenterId: string | null | undefined, warehouseId: string | null | undefined, targetWarehouseId: string | null | undefined, fallbackFrom?: string | null, fallbackTo?: string | null): Promise<{ warehouseId: string | null; targetWarehouseId: string | null }> {
  let from = warehouseId ?? null;
  let to = targetWarehouseId ?? null;
  if (workCenterId) {
    const [wc] = await db.select().from(workCenters).where(eq(workCenters.id, workCenterId)).limit(1);
    if (!wc) throw new DomainError(422, 'invalid_reference', 'The work center does not exist');
    from = warehouseId ?? wc.warehouseId ?? fallbackFrom ?? null;
    to = targetWarehouseId ?? wc.outputWarehouseId ?? fallbackTo ?? null;
  } else {
    from = from ?? fallbackFrom ?? null;
    to = to ?? fallbackTo ?? null;
  }
  if (!to) {
    const [def] = await db.select({ id: warehouses.id }).from(warehouses).orderBy(sql`${warehouses.isDefault} desc`).limit(1);
    to = def?.id ?? null;
  }
  return { warehouseId: from, targetWarehouseId: to };
}

/** Документ выпуска за эту дату и участок: в него дописываются новые строки (как в 1С — один документ за день) */
async function findDayDocument(db: Db, _workspaceId: string, date: string, workCenterId: string | null): Promise<string | null> {
  if (!workCenterId) return null;
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(productionHeaders, eq(productionHeaders.documentId, documents.id))
    .where(and(eq(documents.type, 'production'), eq(documents.date, date), eq(productionHeaders.workCenterId, workCenterId), ne(documents.status, 'cancelled')))
    .orderBy(asc(documents.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Дополнение существующего документа выпуска: снимаем проведение, добавляем строки и проводим заново */
async function appendProduction(
  db: Db,
  ctx: DocCtx,
  docId: string,
  input: { date?: string; workCenterId?: string | null; warehouseId?: string | null; targetWarehouseId?: string | null; plans: ProductionPlan[] },
): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, docId)).limit(1).for('update');
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  const wasPosted = doc.status === 'posted';
  if (wasPosted) await unpostDocument(db, ctx, docId);
  const rows = await buildProductionRows(db, input.plans);
  const [last] = await db.select({ m: sql<number>`coalesce(max(${documentLines.sortOrder}), -1)` }).from(documentLines).where(eq(documentLines.documentId, docId));
  const sortOrder = Number(last?.m ?? -1) + 1;
  await db.insert(documentLines).values(
    rows.docLines.map((l, n) => ({
      id: l.id,
      workspaceId: ctx.workspaceId,
      documentId: docId,
      sortOrder: sortOrder + n,
      productId: l.productId,
      name: l.name,
      unitCode: l.unitCode,
      qty: l.qty,
      price: '0',
      discountPct: '0',
      vatRate: 'none',
      net: '0',
      vatAmount: '0',
      total: '0',
      stockRole: l.stockRole,
    })),
  );
  const [lastItem] = await db.select({ m: sql<number>`coalesce(max(${productionItems.sortOrder}), -1)` }).from(productionItems).where(eq(productionItems.documentId, docId));
  const itemRows = await db
    .insert(productionItems)
    .values(rows.itemLines.map((l, n) => ({ workspaceId: ctx.workspaceId, documentId: docId, itemId: l.itemId, qty: l.qty, unitCode: l.unitCode, customerOrderLineId: l.customerOrderLineId, sourceItemId: l.sourceItemId, documentLineId: l.id, sortOrder: Number(lastItem?.m ?? -1) + 1 + n })))
    .returning();
  const itemIdByLine = new Map(itemRows.map(i => [i.documentLineId!, i.id]));
  await db.insert(productionComponents).values(
    rows.componentLines.map((c, n) => ({ workspaceId: ctx.workspaceId, documentId: docId, itemId: itemIdByLine.get(c.itemId) ?? null, kind: c.kind, productId: c.productId, workCenterId: c.workCenterId, operation: c.operation, qty: c.qty, hours: c.hours, rate: c.rate, fixedCost: c.fixedCost, plannedCost: c.plannedCost, documentLineId: c.documentLineId, sortOrder: n })),
  );
  if (wasPosted) await postDocument(db, ctx, docId);
}

/** Выпуск за дату и участок: дописывается в существующий документ дня или создаётся новый */
async function createOrAppendProduction(
  db: Db,
  ctx: DocCtx,
  input: { date?: string; workCenterId?: string | null; warehouseId?: string | null; targetWarehouseId?: string | null; fallbackWarehouseId?: string | null; fallbackTargetWarehouseId?: string | null; basedOnId: string | null; plans: ProductionPlan[] },
): Promise<string> {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const existing = await findDayDocument(db, ctx.workspaceId, date, input.workCenterId ?? null);
  if (existing) {
    await appendProduction(db, ctx, existing, { ...input, date });
    return existing;
  }
  return writeProduction(db, ctx, { ...input, date });
}

/* ---------------- рабочее место «Выпуск продукции» ---------------- */

/** Строка рабочего места: что и сколько осталось выпустить */
export interface WorkbenchRow {
  /** Строка заказа: позиция заказа на производство или строка заказа покупателя */
  id: string;
  /** Источник строки */
  source: 'customer_order' | 'production_order';
  /** Заказ, которому строка принадлежит */
  orderId: string;
  /** Товар каталога */
  productId: string;
  /** Название товара */
  productName: string;
  /** Продукция (спецификация), которую выпускаем */
  itemId: string;
  /** Название продукции */
  itemName: string;
  unitCode: string;
  /** Заказано */
  qty: string;
  /** Уже выпущено */
  produced: string;
  /** Отгружено покупателю (у заказа покупателя) */
  shipped: string;
  /** Осталось к выпуску */
  remaining: string;
  /** Этап выпуска: пока один — «Завершение производства» */
  stage: 'final';
}

/** Заказ рабочего места с его строками */
export interface WorkbenchOrder {
  id: string;
  type: 'customer_order' | 'production_order';
  number: string | null;
  date: string;
  state: string | null;
  comment: string;
  counterparty: { id: string; name: string } | null;
  /** Плановый срок: у заказа покупателя — срок, у заказа на производство — плановый финиш */
  dueDate: string | null;
  /** Участок-изготовитель (у заказа на производство) */
  workCenterId: string | null;
  workCenterName: string | null;
  rows: WorkbenchRow[];
}

export interface WorkbenchFilters {
  customerOrderId?: string;
  productionOrderId?: string;
  counterpartyId?: string;
  productId?: string;
  state?: string;
  from?: string;
  to?: string;
  q?: string;
  limit: number;
  offset: number;
}

/** Заказы рабочего места: заказы покупателей и заказы на производство с остатком к выпуску */
export async function listWorkbench(db: Db, workspaceId: string, filters: WorkbenchFilters) {
  const centers = await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(isNull(workCenters.archivedAt));
  const byCenter = new Map(centers.map(c => [c.id, c.name]));
  const items = await db.select().from(manufacturedItems);
  const byItem = new Map(items.map(i => [i.id, i]));
  // производимые товары: пополнение «производство» со спецификацией по умолчанию
  const settings = await db.select().from(productManufacturing).where(eq(productManufacturing.replenishment, 'production'));
  const producible = new Map(settings.filter(s => s.defaultItemId).map(s => [s.productId, s.defaultItemId!]));
  const orders: WorkbenchOrder[] = [];

  /* --- заказы покупателей --- */
  const customerDocs = await db.select().from(documents).where(and(eq(documents.type, 'customer_order'), eq(documents.status, 'posted')));
  const customerIds = customerDocs.map(d => d.id);
  const customerLines = customerIds.length ? await db.select().from(documentLines).where(inArray(documentLines.documentId, customerIds)) : [];
  const producedByLine = await producedByCustomerLine(db, workspaceId, customerLines.map(l => l.id));
  const shippedByLine = await shippedQty(db, workspaceId, customerLines.map(l => l.id));
  const coveredByLine = await coveredByOrders(db, workspaceId, customerLines.map(l => l.id));
  const counterparties = new Map((await db.select({ id: companies.id, name: companies.name }).from(companies)).map(c => [c.id, c.name]));
  for (const doc of customerDocs) {
    if (filters.customerOrderId && doc.id !== filters.customerOrderId) continue;
    if (filters.counterpartyId && doc.counterpartyId !== filters.counterpartyId) continue;
    if (filters.productionOrderId) continue;
    if (filters.state) continue; // состояние — только у заказа на производство
    if (filters.q && !`${doc.number ?? ''} ${doc.comment}`.toLowerCase().includes(filters.q.toLowerCase())) continue;
    if (filters.from && !(doc.dueDate && doc.dueDate >= filters.from)) continue;
    if (filters.to && !(doc.dueDate && doc.dueDate <= filters.to)) continue;
    const rows: WorkbenchRow[] = [];
    for (const line of customerLines.filter(l => l.documentId === doc.id)) {
      const itemId = producible.get(line.productId);
      if (!itemId) continue;
      const item = byItem.get(itemId);
      if (!item?.productId) continue; // изделие без товара каталога на склад не приходуется
      const produced = producedByLine.get(line.id) ?? 0n;
      const shipped = shippedByLine.get(line.id) ?? 0n;
      const covered = coveredByLine.get(line.id) ?? 0n;
      const left = dec(line.qty) - produced - shipped - covered;
      if (left <= 0n) continue;
      if (filters.productId && line.productId !== filters.productId) continue;
      rows.push({
        id: line.id,
        source: 'customer_order',
        orderId: doc.id,
        productId: line.productId,
        productName: line.name,
        itemId,
        itemName: item.name,
        unitCode: line.unitCode,
        qty: fmt(dec(line.qty), 3),
        produced: fmt(produced, 3),
        shipped: fmt(shipped, 3),
        remaining: fmt(left, 3),
        stage: 'final',
      });
    }
    if (!rows.length) continue;
    orders.push({
      id: doc.id,
      type: 'customer_order',
      number: doc.number,
      date: doc.date,
      state: null,
      comment: doc.comment,
      counterparty: doc.counterpartyId ? { id: doc.counterpartyId, name: counterparties.get(doc.counterpartyId) ?? '' } : null,
      dueDate: doc.dueDate,
      workCenterId: null,
      workCenterName: null,
      rows,
    });
  }

  /* --- заказы на производство --- */
  const orderDocs = await db.select().from(documents).where(and(eq(documents.type, 'production_order'), eq(documents.status, 'posted')));
  const orderIds = orderDocs.map(d => d.id);
  const headers = orderIds.length ? await db.select().from(productionHeaders).where(inArray(productionHeaders.documentId, orderIds)) : [];
  const byHeader = new Map(headers.map(h => [h.documentId, h]));
  const orderItems = orderIds.length ? await db.select().from(productionItems).where(inArray(productionItems.documentId, orderIds)) : [];
  const producedByItem = await producedQty(db, workspaceId, orderItems.map(i => i.id));
  for (const doc of orderDocs) {
    if (filters.customerOrderId) continue;
    if (filters.productionOrderId && doc.id !== filters.productionOrderId) continue;
    if (filters.counterpartyId) continue;
    if (filters.state ? doc.state !== filters.state : doc.state === 'done' || doc.state === 'closed') continue;
    if (filters.q && !`${doc.number ?? ''} ${doc.comment}`.toLowerCase().includes(filters.q.toLowerCase())) continue;
    const header = byHeader.get(doc.id);
    const plannedEnd = header?.plannedEnd ? new Date(header.plannedEnd).toISOString().slice(0, 10) : null;
    if (filters.from && !(plannedEnd && plannedEnd >= filters.from)) continue;
    if (filters.to && !(plannedEnd && plannedEnd <= filters.to)) continue;
    const rows: WorkbenchRow[] = [];
    for (const item of orderItems.filter(i => i.documentId === doc.id)) {
      const made = byItem.get(item.itemId);
      if (!made?.productId) continue;
      const produced = producedByItem.get(item.id) ?? 0n;
      const left = dec(item.qty) - produced;
      if (left <= 0n) continue;
      if (filters.productId && made.productId !== filters.productId) continue;
      rows.push({
        id: item.id,
        source: 'production_order',
        orderId: doc.id,
        productId: made.productId,
        productName: made.name,
        itemId: made.id,
        itemName: made.name,
        unitCode: item.unitCode,
        qty: fmt(dec(item.qty), 3),
        produced: fmt(produced, 3),
        shipped: '0.000',
        remaining: fmt(left, 3),
        stage: 'final',
      });
    }
    if (!rows.length) continue;
    orders.push({
      id: doc.id,
      type: 'production_order',
      number: doc.number,
      date: doc.date,
      state: doc.state,
      comment: doc.comment,
      counterparty: null,
      dueDate: plannedEnd,
      workCenterId: header?.workCenterId ?? null,
      workCenterName: header?.workCenterId ? (byCenter.get(header.workCenterId) ?? null) : null,
      rows,
    });
  }

  orders.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  const total = orders.length;
  const page = orders.slice(filters.offset, filters.offset + filters.limit);
  return { orders: page, total, workCenters: centers };
}

/** Сколько закрыто открытыми заказами на производство: строка заказа покупателя не показывается дважды */
async function coveredByOrders(db: Db, _workspaceId: string, customerLineIds: string[]): Promise<Map<string, bigint>> {
  if (!customerLineIds.length) return new Map();
  const rows = await db
    .select({ line: productionItems.customerOrderLineId, qty: sql<string>`sum(${productionItems.qty})` })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .where(and(inArray(productionItems.customerOrderLineId, customerLineIds), eq(documents.type, 'production_order'), eq(documents.status, 'posted'), notInArray(documents.state, ['done', 'closed'])))
    .groupBy(productionItems.customerOrderLineId);
  return new Map(rows.map(r => [r.line!, dec(r.qty)]));
}

/** Строка рабочего места, которую надо выпустить */
export interface WorkbenchExecuteRow {
  orderId: string;
  source: 'customer_order' | 'production_order';
  lineId: string;
  /** Количество (расширенный режим); пусто — весь остаток */
  qty?: string;
  /** Участок-изготовитель; пусто — участок заказа на производство */
  workCenterId?: string | null;
}

/** Выполнение рабочего места: на участок и дату — один документ выпуска, строки — из отмеченных заказов */
export async function executeWorkbench(
  db: Db,
  ctx: DocCtx,
  input: { date?: string; mode: 'simple' | 'extended'; rows: WorkbenchExecuteRow[] },
): Promise<{ id: string; number: string | null; workCenterId: string; qty: string }[]> {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  // группируем строки по участку: на участок и дату — один документ выпуска
  const groups = new Map<string, WorkbenchExecuteRow[]>();
  for (const row of input.rows) {
    const centerId = row.workCenterId ?? (await orderWorkCenter(db, row)) ?? null;
    if (!centerId) throw new DomainError(422, 'work_center_required', 'Choose a work center for every line');
    await assertWorkCenter(db, centerId);
    groups.set(centerId, [...(groups.get(centerId) ?? []), row]);
  }
  const out: { id: string; number: string | null; workCenterId: string; qty: string }[] = [];
  // строка заказа покупателя, закрытая открытым заказом на производство, в выпуск не идёт
  const customerRows = input.rows.filter(r => r.source === 'customer_order');
  if (customerRows.length) {
    const covered = await coveredByOrders(db, ctx.workspaceId, customerRows.map(r => r.lineId));
    if (customerRows.some(r => (covered.get(r.lineId) ?? 0n) > 0n)) throw new DomainError(422, 'already_ordered', 'The line is already covered by a production order: release it from that order');
  }
  for (const [centerId, rows] of groups) {
    const plans: ProductionPlan[] = [];
    const orderIds = [...new Set(rows.map(r => `${r.orderId}:${r.source}`))];
    for (const key of orderIds) {
      const [orderId, source] = key.split(':');
      const own = rows.filter(r => r.orderId === orderId && r.source === source);
      const qty = (r: WorkbenchExecuteRow) => {
        if (input.mode !== 'extended') return undefined;
        if (!r.qty) throw new DomainError(422, 'quantity_required', 'Set the quantity of every line in the extended mode');
        return r.qty;
      };
      if (source === 'production_order') plans.push(...(await orderPlans(db, ctx, orderId, own.map(r => ({ orderItemId: r.lineId, qty: qty(r) })))));
      else plans.push(...(await customerPlans(db, ctx, orderId, own.map(r => ({ customerOrderLineId: r.lineId, qty: qty(r) })))));
    }
    if (!plans.length) continue;
    const docId = await createOrAppendProduction(db, ctx, { date, workCenterId: centerId, basedOnId: rows[0]?.orderId ?? null, plans });
    const [doc] = await db.select({ status: documents.status, number: documents.number }).from(documents).where(eq(documents.id, docId)).limit(1);
    // документ дня мог быть уже проведён — дописывание перепроводит его само
    if (doc?.status === 'draft') await postDocument(db, ctx, docId);
    const [after] = await db.select({ number: documents.number }).from(documents).where(eq(documents.id, docId)).limit(1);
    out.push({ id: docId, number: after?.number ?? null, workCenterId: centerId, qty: fmt(plans.reduce((sum, p) => sum + dec(p.qty), 0n), 3) });
  }
  return out;
}

/** Участок заказа на производство: участок строки рабочего места по умолчанию */
async function orderWorkCenter(db: Db, row: WorkbenchExecuteRow): Promise<string | null> {
  if (row.source !== 'production_order') return null;
  const [header] = await db.select({ workCenterId: productionHeaders.workCenterId }).from(productionHeaders).where(eq(productionHeaders.documentId, row.orderId)).limit(1);
  return header?.workCenterId ?? null;
}

/* ---------------- помощники ---------------- */

async function assertWorkCenter(db: Db, id: string): Promise<void> {
  const [wc] = await db.select({ id: workCenters.id }).from(workCenters).where(eq(workCenters.id, id)).limit(1);
  if (!wc) throw new DomainError(422, 'invalid_reference', 'The work center does not exist');
}

/** Строка заказа покупателя: должна быть у проведённого заказа покупателя */
async function assertCustomerOrderLine(db: Db, lineId: string): Promise<void> {
  const [row] = await db
    .select({ id: documentLines.id, type: documents.type, status: documents.status })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(eq(documentLines.id, lineId))
    .limit(1);
  if (!row || row.type !== 'customer_order') throw new DomainError(422, 'invalid_reference', 'The customer order line does not exist');
  if (row.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the customer order first');
}

/** Сколько уже выпущено по позициям заказа на производство */
async function producedQty(db: Db, _workspaceId: string, orderItemIds: string[]): Promise<Map<string, bigint>> {
  if (!orderItemIds.length) return new Map();
  const rows = await db
    .select({ source: productionItems.sourceItemId, qty: sql<string>`sum(${productionItems.qty})` })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .where(and(inArray(productionItems.sourceItemId, orderItemIds), eq(documents.status, 'posted')))
    .groupBy(productionItems.sourceItemId);
  return new Map(rows.map(r => [r.source!, dec(r.qty)]));
}

/** Сколько уже выпущено по строкам заказа покупателя */
async function producedByCustomerLine(db: Db, _workspaceId: string, customerLineIds: string[]): Promise<Map<string, bigint>> {
  if (!customerLineIds.length) return new Map();
  const rows = await db
    .select({ line: productionItems.customerOrderLineId, qty: sql<string>`sum(${productionItems.qty})` })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .where(and(inArray(productionItems.customerOrderLineId, customerLineIds), eq(documents.status, 'posted')))
    .groupBy(productionItems.customerOrderLineId);
  return new Map(rows.map(r => [r.line!, dec(r.qty)]));
}

/** Сколько отгружено по строкам заказа покупателя (проведённые документы-исполнители цепочки) */
async function shippedQty(db: Db, _workspaceId: string, customerLineIds: string[]): Promise<Map<string, bigint>> {
  if (!customerLineIds.length) return new Map();
  const rows = await db
    .select({ line: documentLines.originLineId, qty: sql<string>`sum(${documentLines.qty})` })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(inArray(documentLines.originLineId, customerLineIds), eq(documents.status, 'posted'), inArray(documents.type, FULFIL_TYPES)))
    .groupBy(documentLines.originLineId);
  return new Map(rows.map(r => [r.line!, dec(r.qty)]));
}

/* ---------------- проведение выпуска ---------------- */

/** План выпуска: что производим (позиции документа) и из чего (состав) */
async function loadPlan(db: Db, documentId: string) {
  const items = await db.select().from(productionItems).where(eq(productionItems.documentId, documentId)).orderBy(asc(productionItems.sortOrder));
  const components = await db.select().from(productionComponents).where(eq(productionComponents.documentId, documentId)).orderBy(asc(productionComponents.sortOrder));
  return { items, components };
}

/** Себестоимость позиции выпуска: материалы (факт — по списанной строке) + работы + накладные */
function itemCost(item: typeof productionItems.$inferSelect, components: (typeof productionComponents.$inferSelect)[], outCost: Map<string, bigint>, overheadPct: bigint, lineQty: Map<string, bigint>): bigint {
  const own = components.filter(c => c.itemId === item.id);
  let materials = 0n;
  let works = 0n;
  for (const c of own) {
    if (c.kind === 'work') {
      works += mul(dec(c.hours), dec(c.rate ?? '0')) + dec(c.fixedCost ?? '0');
      continue;
    }
    // фактическое количество — по строке документа (её и списывают), плановое — из снимка
    const qty = c.documentLineId ? (lineQty.get(c.documentLineId) ?? dec(c.qty)) : dec(c.qty);
    const unit = c.documentLineId ? (outCost.get(c.documentLineId) ?? 0n) : 0n;
    materials += mul(qty, unit);
  }
  const overhead = roundDiv((materials + works) * overheadPct, 100n * 1_000_000n);
  return materials + works + overhead;
}

DOCUMENT_HOOKS.production_order = {
  /** У заказа на производство нет строк документа: состав проверяет сам */
  check: async (db, _ctx, doc) => {    const { items } = await loadPlan(db, doc.id);
    if (!items.length) throw new DomainError(422, 'no_items', 'Add products to produce before posting');
  },
};

DOCUMENT_HOOKS.production = {
  /** Проверки до проведения: состав документа и превышение заказанного */
  check: async (db, ctx, doc, lines) => {
    const { items } = await loadPlan(db, doc.id);
    if (!items.length) throw new DomainError(422, 'no_items', 'Add products to produce before posting');
    const producedLines = items.map(i => i.documentLineId).filter((x): x is string => !!x);
    for (const l of lines) {
      if (l.stockRole !== 'in') continue;
      if (!producedLines.includes(l.id)) throw new DomainError(422, 'production_item_required', 'The produced line must belong to a position of the production document');
    }
    if (!doc.targetWarehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse for the finished goods before posting');
    if (lines.some(l => l.stockRole === 'out') && !doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse for the materials before posting');
    // продукция должна быть складским товаром
    const prodIds = [...new Set(lines.filter(l => l.stockRole === 'in').map(l => l.productId))];
    if (prodIds.length) {
      const kinds = await db.select({ id: products.id, kind: products.kind }).from(products).where(inArray(products.id, prodIds));
      const bad = kinds.find(p => p.kind !== 'goods');
      if (bad) throw new DomainError(422, 'item_not_stockable', 'Only goods can be produced to stock');
    }
    // нельзя выпустить больше заказанного
    const sources = items.map(i => i.sourceItemId).filter((x): x is string => !!x);
    const customers = items.map(i => i.customerOrderLineId).filter((x): x is string => !!x);
    if (sources.length || customers.length) {
      const rows = await db
        .select({ source: productionItems.sourceItemId, customer: productionItems.customerOrderLineId, qty: sql<string>`sum(${productionItems.qty})` })
        .from(productionItems)
        .innerJoin(documents, eq(documents.id, productionItems.documentId))
        .where(and(eq(documents.status, 'posted'), ne(documents.id, doc.id), or(inArray(productionItems.sourceItemId, sources), inArray(productionItems.customerOrderLineId, customers))))
        .groupBy(productionItems.sourceItemId, productionItems.customerOrderLineId);
      const done = new Map<string, bigint>();
      for (const r of rows) {
        if (r.source) done.set(`s:${r.source}`, (done.get(`s:${r.source}`) ?? 0n) + dec(r.qty));
        if (r.customer) done.set(`c:${r.customer}`, (done.get(`c:${r.customer}`) ?? 0n) + dec(r.qty));
      }
      for (const it of items) {
        if (it.sourceItemId) {
          const [src] = await db.select({ qty: productionItems.qty }).from(productionItems).where(eq(productionItems.id, it.sourceItemId)).limit(1);
          const total = (done.get(`s:${it.sourceItemId}`) ?? 0n) + dec(it.qty);
          if (src && total > dec(src.qty)) throw new DomainError(422, 'over_fulfilment', 'More is produced than ordered');
        } else if (it.customerOrderLineId) {
          const [src] = await db.select({ qty: documentLines.qty, name: documentLines.name }).from(documentLines).where(eq(documentLines.id, it.customerOrderLineId)).limit(1);
          const shipped = (await shippedQty(db, ctx.workspaceId, [it.customerOrderLineId])).get(it.customerOrderLineId) ?? 0n;
          const total = (done.get(`c:${it.customerOrderLineId}`) ?? 0n) + dec(it.qty) + shipped;
          if (src && total > dec(src.qty)) throw new DomainError(422, 'over_fulfilment', `“${src.name}”: more is produced than ordered`);
        }
      }
    }
  },
  /** Проведение: списание материалов по средней и приход продукции по себестоимости */
  post: async (db, ctx, doc, lines) => {
    const { items, components } = await loadPlan(db, doc.id);
    const reqs: MoveRequest[] = [];
    for (const l of lines) {
      if (l.stockRole === 'out') reqs.push({ warehouseId: doc.warehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'out' });
      else if (l.stockRole === 'in') reqs.push({ warehouseId: doc.targetWarehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'in' });
    }
    // цена прихода продукции: себестоимость её позиции (материалы по факту + работы + накладные)
    const itemByLine = new Map(items.filter(i => i.documentLineId).map(i => [i.documentLineId!, i]));
    const qtyByItem = new Map<string, bigint>();
    for (const l of lines) {
      const it = itemByLine.get(l.id);
      if (it) qtyByItem.set(it.id, (qtyByItem.get(it.id) ?? 0n) + dec(l.qty));
    }
    // накладные берём из спецификации продукции: overhead_pct её изделия
    const prodIds = [...new Set(items.map(i => i.itemId))];
    const overheads = prodIds.length ? await db.select({ id: manufacturedItems.id, overheadPct: manufacturedItems.overheadPct }).from(manufacturedItems).where(inArray(manufacturedItems.id, prodIds)) : [];
    const overheadByItem = new Map(overheads.map(o => [o.id, dec(o.overheadPct)]));
    const lineQty = new Map(lines.map(l => [l.id, dec(l.qty)]));
    const outCost = await applyStockMoves(db, ctx.workspaceId, { id: doc.id, date: doc.date }, reqs, await loadInventorySettings(db, ctx.workspaceId), {
      inCost: (lineId, costs) => {
        const it = itemByLine.get(lineId);
        if (!it) return undefined;
        const cost = itemCost(it, components, costs, overheadByItem.get(it.itemId) ?? 0n, lineQty);
        const qty = qtyByItem.get(it.id) ?? 0n;
        if (qty <= 0n) return undefined;
        return div(cost, qty);
      },
    });
    // факт по составу: списанное количество и себестоимость строки
    for (const c of components) {
      if (c.kind === 'work' || !c.documentLineId) continue;
      const qty = lineQty.get(c.documentLineId) ?? dec(c.qty);
      const unit = outCost.get(c.documentLineId) ?? 0n;
      await db.update(productionComponents).set({ actualQty: fmt(qty), actualCost: fmt(mul(qty, unit)) }).where(eq(productionComponents.id, c.id));
    }
  },
  /** После проведения: выпущенная продукция резервируется под связанный заказ покупателя */
  afterPost: async (db, ctx, doc) => {
    const { items } = await loadPlan(db, doc.id);
    const customerLines = items.filter(i => i.customerOrderLineId && i.documentLineId);
    if (!customerLines.length) return;
    const already = await producedByCustomerLine(db, ctx.workspaceId, customerLines.map(i => i.customerOrderLineId!));
    for (const it of customerLines) {
      const [src] = await db.select({ qty: documentLines.qty, productId: documentLines.productId, name: documentLines.name }).from(documentLines).where(eq(documentLines.id, it.customerOrderLineId!)).limit(1);
      if (!src) continue;
      const shipped = (await shippedQty(db, ctx.workspaceId, [it.customerOrderLineId!])).get(it.customerOrderLineId!) ?? 0n;
      // produced считает и этот выпуск — вычитаем его
      const other = (already.get(it.customerOrderLineId!) ?? 0n) - dec(it.qty);
      const want = dec(src.qty) - shipped - other;
      if (want <= 0n) continue;
      // если заказ покупателя уже резервирует товар на этом складе, второй резерв не нужен
      const [own] = await db
        .select({ id: stockReservations.id })
        .from(stockReservations)
        .where(and(eq(stockReservations.documentLineId, it.customerOrderLineId!), eq(stockReservations.warehouseId, doc.targetWarehouseId!), eq(stockReservations.productId, src.productId)))
        .limit(1);
      if (own) continue;
      const qty = dec(it.qty) < want ? dec(it.qty) : want;
      await db
        .insert(stockReservations)
        .values({ workspaceId: ctx.workspaceId, documentId: doc.id, productionLineId: it.documentLineId!, warehouseId: doc.targetWarehouseId!, productId: src.productId, qty: fmt(qty, 3) })
        .onConflictDoNothing();
    }
  },
  /** После отмены проведения: резерв снимается, факт по составу обнуляется */
  afterUnpost: async (db, _ctx, doc) => {
    const { items, components } = await loadPlan(db, doc.id);
    const ids = items.map(i => i.documentLineId).filter((x): x is string => !!x);
    if (ids.length) await db.delete(stockReservations).where(inArray(stockReservations.productionLineId, ids));
    for (const c of components) if (c.actualQty !== null || c.actualCost !== null) await db.update(productionComponents).set({ actualQty: null, actualCost: null }).where(eq(productionComponents.id, c.id));
  },
};

/* ---------------- карточка и журнал ---------------- */

/** Карточка производственного документа: позиции, состав, выпуски */
export async function productionDetail(db: Db, id: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  const [header] = await db.select().from(productionHeaders).where(eq(productionHeaders.documentId, id)).limit(1);
  const { items, components } = await loadPlan(db, id);
  const prodIds = [...new Set(items.map(i => i.itemId))];
  const prods = prodIds.length ? await db.select().from(manufacturedItems).where(inArray(manufacturedItems.id, prodIds)) : [];
  const byProd = new Map(prods.map(p => [p.id, p]));
  const [workCenter] = header?.workCenterId ? await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(eq(workCenters.id, header.workCenterId)).limit(1) : [];
  const produced = await producedQty(db, doc.workspaceId, items.map(i => i.id));
  const outputs = await db
    .select({ id: documents.id, number: documents.number, status: documents.status, date: documents.date })
    .from(documents)
    .where(eq(documents.basedOnId, id))
    .orderBy(asc(documents.createdAt));
  return {
    ...doc,
    workCenter: workCenter ?? null,
    plannedStart: header?.plannedStart ?? null,
    plannedEnd: header?.plannedEnd ?? null,
    parentDocumentId: header?.parentDocumentId ?? null,
    items: items.map(i => ({ ...i, name: byProd.get(i.itemId)?.name ?? '', productId: byProd.get(i.itemId)?.productId ?? null, produced: fmt(produced.get(i.id) ?? 0n, 3) })),
    components: components.map(c => ({ ...c })),
    outputs,
  };
}

/** Журнал заказов на производство */
export async function listProductionOrders(db: Db, _workspaceId: string, params: { state?: string; from?: string; to?: string; q?: string; limit: number; offset: number }) {
  const conds = [
    eq(documents.type, 'production_order'),
    params.state ? eq(documents.state, params.state) : undefined,
    params.from ? sql`${productionHeaders.plannedStart} is not null and ${productionHeaders.plannedStart} >= ${params.from}` : undefined,
    params.to ? sql`${productionHeaders.plannedEnd} is not null and ${productionHeaders.plannedEnd} <= ${params.to}` : undefined,
    params.q ? sql`${documents.comment} ilike ${'%' + params.q + '%'}` : undefined,
  ];
  const rows = await db
    .select({ doc: documents, header: productionHeaders })
    .from(documents)
    .leftJoin(productionHeaders, eq(productionHeaders.documentId, documents.id))
    .where(and(...conds))
    .orderBy(desc(documents.date), desc(documents.createdAt))
    .limit(params.limit)
    .offset(params.offset);
  const ids = rows.map(r => r.doc.id);
  const items = ids.length ? await db.select().from(productionItems).where(inArray(productionItems.documentId, ids)) : [];
  const centers = await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters);
  const byCenter = new Map(centers.map(c => [c.id, c.name]));
  const count = await db.select({ n: sql<number>`count(*)` }).from(documents).leftJoin(productionHeaders, eq(productionHeaders.documentId, documents.id)).where(and(...conds));
  return {
    items: rows.map(r => ({ ...r.doc, workCenterName: r.header?.workCenterId ? (byCenter.get(r.header.workCenterId) ?? null) : null, plannedStart: r.header?.plannedStart ?? null, plannedEnd: r.header?.plannedEnd ?? null, itemCount: items.filter(i => i.documentId === r.doc.id).length })),
    total: Number(count[0]?.n ?? 0),
  };
}
