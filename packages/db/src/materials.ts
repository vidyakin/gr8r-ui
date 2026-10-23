/* Обеспечение материалов заказа на производство: резерв под заказ, размещение (заказы поставщикам и дочерние
   заказы на полуфабрикаты) и покрытие строки материала. Правила — docs/architecture.md, раздел «Склад». */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { dec, fmt, materialCoverage, type Dec, type MaterialCoverage, type MaterialOwner } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { DOCUMENT_HOOKS } from './document-hooks';
import { documentLines, documents, products, productionComponents, productionHeaders, productionPlacements, stockBalances, stockMoves, stockReservations, warehouses } from './schema';
import { customerStockBalances } from './schema';
import { lockFreeStock } from './stock';

const key = (warehouseId: string, productId: string) => `${warehouseId}:${productId}`;

/* ---------------- строки состава заказа ---------------- */

/** Строки состава заказа на производство: материалы и полуфабрикаты (то, что обеспечивается) */
export async function orderMaterialComponents(db: Db, orderId: string) {
  return db
    .select()
    .from(productionComponents)
    .where(and(eq(productionComponents.documentId, orderId), inArray(productionComponents.kind, ['material', 'semi'])))
    .orderBy(asc(productionComponents.sortOrder));
}

/** Сколько списано выпусками по каждой строке состава заказа (выпуск наследует состав заказа) */
async function writtenByComponent(db: Db, componentIds: string[]): Promise<Map<string, Dec>> {
  if (!componentIds.length) return new Map();
  const rows = await db
    .select({ source: productionComponents.sourceComponentId, qty: sql<string>`sum(coalesce(${productionComponents.actualQty}, 0))` })
    .from(productionComponents)
    .innerJoin(documents, eq(documents.id, productionComponents.documentId))
    .where(and(inArray(productionComponents.sourceComponentId, componentIds), eq(documents.type, 'production'), eq(documents.status, 'posted')))
    .groupBy(productionComponents.sourceComponentId);
  return new Map(rows.map(r => [r.source!, dec(r.qty)]));
}

/** Резерв по строкам состава заказа: количество по каждой строке */
async function reservedByComponent(db: Db, componentIds: string[]): Promise<Map<string, Dec>> {
  if (!componentIds.length) return new Map();
  const rows = await db
    .select({ component: stockReservations.productionComponentId, qty: sql<string>`sum(${stockReservations.qty})` })
    .from(stockReservations)
    .where(inArray(stockReservations.productionComponentId, componentIds))
    .groupBy(stockReservations.productionComponentId);
  return new Map(rows.map(r => [r.component!, dec(r.qty)]));
}

/** Остаток давальца по (склад, товар): сколько сырья заказа на переработку доступно под выпуск.
    Строки материала, которые даёт давалец, не считаются дефицитом — они обеспечены давальцем */
async function customerAvailability(db: Db, orderId: string, productIds: string[]): Promise<Map<string, Dec>> {
  const [header] = await db.select({ processingOrderId: productionHeaders.processingOrderId }).from(productionHeaders).where(eq(productionHeaders.documentId, orderId)).limit(1);
  const processingOrderId = header?.processingOrderId ?? null;
  if (!processingOrderId) return new Map();
  const [order] = await db.select({ counterpartyId: documents.counterpartyId, warehouseId: documents.warehouseId }).from(documents).where(eq(documents.id, processingOrderId)).limit(1);
  if (!order?.counterpartyId || !order.warehouseId || !productIds.length) return new Map();
  const rows = await db
    .select({ productId: customerStockBalances.productId, qty: sql<string>`sum(${customerStockBalances.qty})::text` })
    .from(customerStockBalances)
    .where(and(eq(customerStockBalances.warehouseId, order.warehouseId), eq(customerStockBalances.ownerCompanyId, order.counterpartyId), eq(customerStockBalances.processingOrderId, processingOrderId), inArray(customerStockBalances.productId, productIds)))
    .groupBy(customerStockBalances.productId);
  return new Map(rows.map(r => [r.productId, dec(r.qty)]));
}

/** Размещение строки материала: заказы поставщикам (по строке заказа) и дочерние заказы на полуфабрикаты */
export interface PlacementRow {
  documentId: string;
  documentType: string;
  number: string | null;
  date: string;
  /** Строка документа (заказа поставщику); у дочернего заказа — пусто */
  documentLineId: string | null;
  /** Размещённое количество */
  qty: Dec;
  /** Уже получено по заказу поставщику */
  received: Dec;
}

/** Размещение по строкам состава: что заказано и что уже получено */
async function placementsByComponent(db: Db, componentIds: string[]): Promise<Map<string, PlacementRow[]>> {
  if (!componentIds.length) return new Map();
  const rows = await db
    .select({ p: productionPlacements, doc: documents })
    .from(productionPlacements)
    .innerJoin(documents, eq(documents.id, productionPlacements.documentId))
    .where(inArray(productionPlacements.componentId, componentIds))
    .orderBy(asc(documents.date));
  // получено по заказам поставщикам: строки поступлений ссылаются на строку заказа
  const supplierLineIds = rows.filter(r => r.p.documentLineId).map(r => r.p.documentLineId!);
  const received = new Map<string, Dec>();
  if (supplierLineIds.length) {
    const got = await db
      .select({ source: documentLines.sourceLineId, qty: sql<string>`sum(${documentLines.qty})` })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .where(and(inArray(documentLines.sourceLineId, supplierLineIds), eq(documents.type, 'receipt'), eq(documents.status, 'posted')))
      .groupBy(documentLines.sourceLineId);
    for (const r of got) received.set(r.source!, dec(r.qty));
  }
  const out = new Map<string, PlacementRow[]>();
  for (const r of rows) {
    const list = out.get(r.p.componentId) ?? [];
    list.push({
      documentId: r.p.documentId,
      documentType: r.doc.type,
      number: r.doc.number,
      date: r.doc.date,
      documentLineId: r.p.documentLineId,
      qty: dec(r.p.qty),
      received: r.p.documentLineId ? (received.get(r.p.documentLineId) ?? 0n) : 0n,
    });
    out.set(r.p.componentId, list);
  }
  return out;
}

/** К поступлению: свободные заказы поставщикам по товару — не привязанные ни к одному заказу на производство
    (размещённое под другой заказ уже не свободно, своё размещение — в колонке «Размещено») */
async function incomingByProduct(db: Db, productId: string): Promise<{ documentId: string; documentType: string; number: string | null; date: string; qty: Dec }[]> {
  const all = await db
    .select({ line: documentLines, doc: documents })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(eq(documentLines.productId, productId), eq(documents.type, 'supplier_order'), sql`${documents.status} <> 'cancelled'`))
    .orderBy(asc(documents.date));
  const placedLines = all.length
    ? new Set((await db.select({ id: productionPlacements.documentLineId }).from(productionPlacements).where(inArray(productionPlacements.documentLineId, all.map(l => l.line.id)))).map(r => r.id))
    : new Set<string | null>();
  const lines = all.filter(l => !placedLines.has(l.line.id));
  const ids = lines.map(l => l.line.id);
  if (!ids.length) return [];
  const got = await db
    .select({ source: documentLines.sourceLineId, qty: sql<string>`sum(${documentLines.qty})` })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(inArray(documentLines.sourceLineId, ids), eq(documents.type, 'receipt'), eq(documents.status, 'posted')))
    .groupBy(documentLines.sourceLineId);
  const received = new Map(got.map(r => [r.source!, dec(r.qty)]));
  const out: { documentId: string; documentType: string; number: string | null; date: string; qty: Dec }[] = [];
  for (const l of lines) {
    const left = dec(l.line.qty) - (received.get(l.line.id) ?? 0n);
    if (left <= 0n) continue;
    out.push({ documentId: l.doc.id, documentType: l.doc.type, number: l.doc.number, date: l.doc.date, qty: left });
  }
  return out;
}

/* ---------------- покрытие строки материала ---------------- */

/** Строка материала заказа на производство с обеспечением и расшифровками */
export interface MaterialRow extends MaterialCoverage {
  componentId: string;
  productId: string;
  productName: string;
  unitCode: string;
  kind: 'material' | 'semi';
  /** Чей материал: наш или давальца (у давальца потребность обеспечивает сам давалец) */
  ownerKind: MaterialOwner;
  /** Склад резерва (если резерв есть) */
  reserveWarehouseId: string | null;
  /** Свободно для резерва на складе резерва */
  freeAtReserve: string;
  /** Резервы по складам */
  reserves: { warehouseId: string; warehouseName: string; qty: string; orderNumber: string | null }[];
  /** Размещение по документам */
  placements: { documentId: string; documentType: string; number: string | null; date: string; qty: string }[];
  /** К поступлению по документам */
  incomingDocs: { documentId: string; documentType: string; number: string | null; date: string; qty: string }[];
}

/** Обеспечение материалов заказа на производство: покрытие по каждой строке состава и расшифровки */
export async function materialRows(db: Db, orderId: string): Promise<MaterialRow[]> {
  const comps = (await orderMaterialComponents(db, orderId)).filter(c => c.productId);
  if (!comps.length) return [];
  const ids = comps.map(c => c.id);
  const productIds = [...new Set(comps.map(c => c.productId!))];
  const prodRows = await db.select({ id: products.id, name: products.name, unitCode: products.unitCode }).from(products).where(inArray(products.id, productIds));
  const byProduct = new Map(prodRows.map(p => [p.id, p]));
  const [written, reserved, placements] = await Promise.all([writtenByComponent(db, ids), reservedByComponent(db, ids), placementsByComponent(db, ids)]);
  // давальское сырьё заказа на переработку обеспечивает давалец: свой резерв и дефицит по нему не считаем
  const customerQty = await customerAvailability(db, orderId, productIds);
  const customerComponents = new Set(comps.filter(c => c.ownerKind === 'customer').map(c => c.id));
  // остатки и резерв по товарам
  const balances = await db.select({ warehouseId: stockBalances.warehouseId, productId: stockBalances.productId, qty: stockBalances.qty }).from(stockBalances).where(inArray(stockBalances.productId, productIds));
  const allRes = await db.select({ warehouseId: stockReservations.warehouseId, productId: stockReservations.productId, qty: sql<string>`sum(${stockReservations.qty})` }).from(stockReservations).where(inArray(stockReservations.productId, productIds)).groupBy(stockReservations.warehouseId, stockReservations.productId);
  const onHand = new Map<string, Dec>();
  for (const b of balances) onHand.set(key(b.warehouseId, b.productId), (onHand.get(key(b.warehouseId, b.productId)) ?? 0n) + dec(b.qty));
  const resByProduct = new Map<string, Dec>();
  for (const r of allRes) resByProduct.set(r.productId, (resByProduct.get(r.productId) ?? 0n) + dec(r.qty));
  // резервы по складам (расшифровка)
  const resRows = await db
    .select({ r: stockReservations, doc: documents })
    .from(stockReservations)
    .innerJoin(documents, eq(documents.id, stockReservations.documentId))
    .where(inArray(stockReservations.productionComponentId, ids))
    .orderBy(asc(stockReservations.warehouseId));
  const whRows = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses);
  const whName = new Map(whRows.map(w => [w.id, w.name]));
  const out: MaterialRow[] = [];
  for (const c of comps) {
    const list = placements.get(c.id) ?? [];
    const placed = list.reduce((s, p) => s + (p.documentLineId ? (p.qty > p.received ? p.qty - p.received : 0n) : p.qty), 0n);
    const incomingRows = await incomingByProduct(db, c.productId!);
    const incoming = incomingRows.reduce((s, p) => s + p.qty, 0n);
    const res = customerComponents.has(c.id) ? 0n : (reserved.get(c.id) ?? 0n);
    const own = customerComponents.has(c.id) ? [] : resRows.filter(r => r.r.productionComponentId === c.id);
    const totalHand = [...onHand.entries()].filter(([k]) => k.endsWith(`:${c.productId}`)).reduce((s, [, v]) => s + v, 0n);
    // потребность давальческого сырья уменьшается на остаток давальца по этому заказу
    const need = customerComponents.has(c.id) ? (dec(c.qty) > (customerQty.get(c.productId!) ?? 0n) ? dec(c.qty) - (customerQty.get(c.productId!) ?? 0n) : 0n) : dec(c.qty);
    const coverage = materialCoverage({
      need: fmt(need, 3),
      written: fmt(written.get(c.id) ?? 0n, 3),
      reserved: fmt(res, 3),
      placed: fmt(placed, 3),
      incoming: fmt(incoming, 3),
      onHand: fmt(totalHand, 3),
      reservedTotal: fmt(resByProduct.get(c.productId!) ?? 0n, 3),
    });
    const reserveWarehouseId = own[0]?.r.warehouseId ?? null;
    // свободно для резерва на складе резерва: остаток минус все резервы этого склада
    const freeAtReserve = reserveWarehouseId
      ? (onHand.get(key(reserveWarehouseId, c.productId!)) ?? 0n) - allRes.filter(r => r.warehouseId === reserveWarehouseId && r.productId === c.productId).reduce((s, r) => s + dec(r.qty), 0n)
      : 0n;
    out.push({
      ...coverage,
      componentId: c.id,
      productId: c.productId!,
      productName: byProduct.get(c.productId!)?.name ?? '',
      unitCode: byProduct.get(c.productId!)?.unitCode ?? '796',
      kind: c.kind as 'material' | 'semi',
      ownerKind: (c.ownerKind ?? 'own') as MaterialOwner,
      reserveWarehouseId,
      freeAtReserve: fmt(freeAtReserve, 3),
      reserves: own.map(r => ({ warehouseId: r.r.warehouseId, warehouseName: whName.get(r.r.warehouseId) ?? '', qty: fmt(dec(r.r.qty), 3), orderNumber: r.doc.number })),
      placements: list.map(p => ({ documentId: p.documentId, documentType: p.documentType, number: p.number, date: p.date, qty: fmt(p.documentLineId ? (p.qty > p.received ? p.qty - p.received : 0n) : p.qty, 3) })),
      incomingDocs: incomingRows.map(p => ({ documentId: p.documentId, documentType: p.documentType, number: p.number, date: p.date, qty: fmt(p.qty, 3) })),
    });
  }
  return out;
}

/* ---------------- резерв ---------------- */

/** Автоматический резерв материалов при проведении заказа на производство: резервируется столько, сколько свободно
    на складе материалов (не больше «нужно − списано выпусками»). Остатки блокируются — два заказа не займут одно и то же */
export async function reserveOrderMaterials(db: Db, workspaceId: string, orderId: string): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, orderId)).limit(1);
  if (!doc || !doc.warehouseId) return;
  // давальское сырьё со своего склада не резервируется: его обеспечивает давалец
  const comps = (await orderMaterialComponents(db, orderId)).filter(c => c.productId && c.ownerKind !== 'customer');
  if (!comps.length) return;
  const free = await lockFreeStock(db, workspaceId, comps.map(c => ({ warehouseId: doc.warehouseId!, productId: c.productId! })));
  for (const c of comps) {
    const [own] = await db
      .select({ id: stockReservations.id })
      .from(stockReservations)
      .where(and(eq(stockReservations.productionComponentId, c.id), eq(stockReservations.warehouseId, doc.warehouseId)))
      .limit(1);
    if (own) continue; // резерв этой строки уже есть — ручную правку не перетираем
    const f = free.get(key(doc.warehouseId, c.productId!));
    if (!f || f.free <= 0n) continue;
    const want = dec(c.qty);
    const qty = want < f.free ? want : f.free;
    if (qty <= 0n) continue;
    await db.insert(stockReservations).values({ workspaceId, documentId: orderId, productionComponentId: c.id, warehouseId: doc.warehouseId, productId: c.productId!, qty: fmt(qty, 3) });
  }
}

/** Снятие резерва материалов заказа: отмена проведения или закрытие заказа */
export async function releaseOrderMaterials(db: Db, orderId: string): Promise<void> {
  const comps = await orderMaterialComponents(db, orderId);
  const ids = comps.map(c => c.id);
  if (!ids.length) return;
  await db.delete(stockReservations).where(inArray(stockReservations.productionComponentId, ids));
}

/** Уменьшение резерва на списанное выпуском количество */
export async function reduceReservation(db: Db, componentId: string, qty: Dec): Promise<void> {
  if (qty <= 0n) return;
  const rows = await db.select().from(stockReservations).where(eq(stockReservations.productionComponentId, componentId)).orderBy(asc(stockReservations.warehouseId));
  let left = qty;
  for (const r of rows) {
    if (left <= 0n) break;
    const have = dec(r.qty);
    const take = have < left ? have : left;
    left -= take;
    if (take >= have) await db.delete(stockReservations).where(eq(stockReservations.id, r.id));
    else await db.update(stockReservations).set({ qty: fmt(have - take, 3), updatedAt: new Date() }).where(eq(stockReservations.id, r.id));
  }
}

/** Правка резерва строки материала: сколько в резерв и на каком складе. Резерв строки держится на одном складе:
    уменьшить можно всегда, увеличить — в пределах свободного остатка этого склада (иначе 422) */
export async function setMaterialReservation(
  db: Db,
  workspaceId: string,
  orderId: string,
  componentId: string,
  input: { qty: string; warehouseId: string },
): Promise<void> {
  const [comp] = await db.select().from(productionComponents).where(eq(productionComponents.id, componentId)).limit(1);
  if (!comp || comp.documentId !== orderId || !comp.productId) throw new DomainError(404, 'not_found', 'The material line does not exist');
  const [wh] = await db.select().from(warehouses).where(eq(warehouses.id, input.warehouseId)).limit(1);
  if (!wh) throw new DomainError(422, 'invalid_reference', 'The warehouse does not exist');
  const rows = await db.select().from(stockReservations).where(eq(stockReservations.productionComponentId, componentId)).orderBy(asc(stockReservations.warehouseId));
  const want = dec(input.qty);
  const target = rows.find(r => r.warehouseId === input.warehouseId);
  const ownAtTarget = target ? dec(target.qty) : 0n;
  // резерв строки держится на одном складе: он не должен превышать остаток склада минус резервы других заказов
  const free = await lockFreeStock(db, workspaceId, [{ warehouseId: input.warehouseId, productId: comp.productId }]);
  const f = free.get(key(input.warehouseId, comp.productId))!;
  const maxOnWarehouse = f.free + ownAtTarget;
  if (want > maxOnWarehouse) {
    throw new DomainError(422, 'insufficient_free', `Not enough free stock in “${wh.name}”: ${fmt(maxOnWarehouse, 3)} is available`, { available: fmt(maxOnWarehouse, 3), needed: fmt(want, 3) });
  }
  // резерв строки держится на одном складе: остальные склады очищаются
  for (const r of rows) if (r.id !== target?.id) await db.delete(stockReservations).where(eq(stockReservations.id, r.id));
  if (want <= 0n) {
    if (target) await db.delete(stockReservations).where(eq(stockReservations.id, target.id));
    return;
  }
  if (target) await db.update(stockReservations).set({ qty: fmt(want, 3), updatedAt: new Date() }).where(eq(stockReservations.id, target.id));
  else await db.insert(stockReservations).values({ workspaceId, documentId: orderId, productionComponentId: componentId, warehouseId: input.warehouseId, productId: comp.productId, qty: fmt(want, 3) });
}

/** Возврат резерва: списанное выпуском количество возвращается в резерв (отмена проведения выпуска) */
export async function restoreReservation(db: Db, workspaceId: string, componentId: string, qty: Dec, warehouseId: string | null): Promise<void> {
  if (qty <= 0n) return;
  const rows = await db.select().from(stockReservations).where(eq(stockReservations.productionComponentId, componentId)).orderBy(asc(stockReservations.warehouseId));
  const target = rows[0];
  if (target) {
    await db.update(stockReservations).set({ qty: fmt(dec(target.qty) + qty, 3), updatedAt: new Date() }).where(eq(stockReservations.id, target.id));
    return;
  }
  const [comp] = await db.select().from(productionComponents).where(eq(productionComponents.id, componentId)).limit(1);
  if (!comp || !comp.productId || !warehouseId) return;
  await db.insert(stockReservations).values({ workspaceId, documentId: comp.documentId, productionComponentId: componentId, warehouseId, productId: comp.productId, qty: fmt(qty, 3) });
}

/* ---------------- резервы по поступлениям и выпускам ---------------- */

/** Приход по заказу поставщику, привязанному к заказу на производство: товар сразу резервируется под заказ */
export async function reserveReceivedMaterials(db: Db, workspaceId: string, receiptId: string): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, receiptId)).limit(1);
  if (!doc || !doc.warehouseId) return;
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, receiptId));
  const withSource = lines.filter(l => l.sourceLineId);
  if (!withSource.length) return;
  const placements = await db
    .select()
    .from(productionPlacements)
    .where(inArray(productionPlacements.documentLineId, withSource.map(l => l.sourceLineId!)));
  if (!placements.length) return;
  const compIds = [...new Set(placements.map(p => p.componentId))];
  const comps = await db.select().from(productionComponents).where(inArray(productionComponents.id, compIds));
  const byComp = new Map(comps.map(c => [c.id, c]));
  for (const l of withSource) {
    const placement = placements.find(p => p.documentLineId === l.sourceLineId);
    if (!placement) continue;
    const comp = byComp.get(placement.componentId);
    if (!comp || !comp.productId) continue;
    // сколько ещё можно зарезервировать: нужно − списано − уже в резерве
    const written = (await writtenByComponent(db, [comp.id])).get(comp.id) ?? 0n;
    const reserved = (await reservedByComponent(db, [comp.id])).get(comp.id) ?? 0n;
    const want = dec(comp.qty) - written;
    const left = want - reserved;
    if (left <= 0n) continue;
    const qty = dec(l.qty) < left ? dec(l.qty) : left;
    if (qty <= 0n) continue;
    const free = await lockFreeStock(db, workspaceId, [{ warehouseId: doc.warehouseId, productId: comp.productId }]);
    const f = free.get(key(doc.warehouseId, comp.productId))!;
    if (f.free <= 0n) continue;
    const take = qty < f.free ? qty : f.free;
    const [own] = await db
      .select({ id: stockReservations.id, qty: stockReservations.qty })
      .from(stockReservations)
      .where(and(eq(stockReservations.productionComponentId, comp.id), eq(stockReservations.warehouseId, doc.warehouseId)))
      .limit(1);
    if (own) await db.update(stockReservations).set({ qty: fmt(dec(own.qty) + take, 3), updatedAt: new Date() }).where(eq(stockReservations.id, own.id));
    else await db.insert(stockReservations).values({ workspaceId, documentId: comp.documentId, productionComponentId: comp.id, warehouseId: doc.warehouseId, productId: comp.productId, qty: fmt(take, 3) });
  }
}

/** Выпуск дочернего заказа: полуфабрикат резервируется под строку материала родительского заказа */
export async function reserveChildOutput(db: Db, workspaceId: string, releaseId: string): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, releaseId)).limit(1);
  if (!doc || !doc.basedOnId || !doc.targetWarehouseId) return;
  const placements = await db.select().from(productionPlacements).where(and(eq(productionPlacements.documentId, doc.basedOnId), sql`${productionPlacements.documentLineId} is null`));
  if (!placements.length) return;
  const comps = await db.select().from(productionComponents).where(inArray(productionComponents.id, placements.map(p => p.componentId)));
  const byComp = new Map(comps.map(c => [c.id, c]));
  const lines = await db.select().from(documentLines).where(and(eq(documentLines.documentId, releaseId), eq(documentLines.stockRole, 'in')));
  for (const l of lines) {
    for (const p of placements) {
      const comp = byComp.get(p.componentId);
      if (!comp || !comp.productId || comp.productId !== l.productId) continue;
      const written = (await writtenByComponent(db, [comp.id])).get(comp.id) ?? 0n;
      const reserved = (await reservedByComponent(db, [comp.id])).get(comp.id) ?? 0n;
      const want = dec(comp.qty) - written;
      const left = want - reserved;
      if (left <= 0n) continue;
      const qty = dec(l.qty) < left ? dec(l.qty) : left;
      const free = await lockFreeStock(db, workspaceId, [{ warehouseId: doc.targetWarehouseId, productId: comp.productId }]);
      const f = free.get(key(doc.targetWarehouseId, comp.productId))!;
      if (f.free <= 0n) continue;
      const take = qty < f.free ? qty : f.free;
      const [own] = await db
        .select({ id: stockReservations.id, qty: stockReservations.qty })
        .from(stockReservations)
        .where(and(eq(stockReservations.productionComponentId, comp.id), eq(stockReservations.warehouseId, doc.targetWarehouseId)))
        .limit(1);
      if (own) await db.update(stockReservations).set({ qty: fmt(dec(own.qty) + take, 3), updatedAt: new Date() }).where(eq(stockReservations.id, own.id));
      else await db.insert(stockReservations).values({ workspaceId, documentId: comp.documentId, productionComponentId: comp.id, warehouseId: doc.targetWarehouseId, productId: comp.productId, qty: fmt(take, 3) });
    }
  }
}

/* ---------------- поставщик по умолчанию ---------------- */

/** Поставщик товара: сначала поставщик по умолчанию из карточки товара, иначе — поставщик последнего проведённого поступления */
export async function supplierForProduct(db: Db, productId: string): Promise<string | null> {
  const [p] = await db.select({ supplierId: products.defaultSupplierId }).from(products).where(eq(products.id, productId)).limit(1);
  if (p?.supplierId) return p.supplierId;
  const [m] = await db
    .select({ counterpartyId: documents.counterpartyId })
    .from(stockMoves)
    .innerJoin(documents, eq(documents.id, stockMoves.documentId))
    .where(and(eq(stockMoves.productId, productId), eq(documents.type, 'receipt'), eq(documents.status, 'posted')))
    .orderBy(desc(stockMoves.seq))
    .limit(1);
  return m?.counterpartyId ?? null;
}

/** Отмена проведения поступления: резерв, который оно дало заказу на производство, снимается — товара больше нет */
export async function unreserveReceivedMaterials(db: Db, receiptId: string): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, receiptId)).limit(1);
  if (!doc || !doc.warehouseId) return;
  const lines = (await db.select().from(documentLines).where(eq(documentLines.documentId, receiptId))).filter(l => l.sourceLineId);
  if (!lines.length) return;
  const placements = await db.select().from(productionPlacements).where(inArray(productionPlacements.documentLineId, lines.map(l => l.sourceLineId!)));
  for (const l of lines) {
    const placement = placements.find(p => p.documentLineId === l.sourceLineId);
    if (!placement) continue;
    const [own] = await db
      .select({ id: stockReservations.id, qty: stockReservations.qty })
      .from(stockReservations)
      .where(and(eq(stockReservations.productionComponentId, placement.componentId), eq(stockReservations.warehouseId, doc.warehouseId)))
      .limit(1);
    if (!own) continue;
    const left = dec(own.qty) - dec(l.qty);
    if (left > 0n) await db.update(stockReservations).set({ qty: fmt(left, 3), updatedAt: new Date() }).where(eq(stockReservations.id, own.id));
    else await db.delete(stockReservations).where(eq(stockReservations.id, own.id));
  }
}

/* ---------------- хук поступления ---------------- */

/** Поступление по заказу поставщику: привязанный к заказу на производство товар сразу резервируется,
    отмена проведения поступления этот резерв снимает */
DOCUMENT_HOOKS.receipt = {
  afterPost: async (db, ctx, doc) => {
    await reserveReceivedMaterials(db, ctx.workspaceId, doc.id);
  },
  afterUnpost: async (db, _ctx, doc) => {
    await unreserveReceivedMaterials(db, doc.id);
  },
};
