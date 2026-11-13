/* Смета объекта (задача 1269, docs/architecture/construction.md): основная смета объекта, разделы и позиции,
   согласование (снимок цен и норм), допработы, импорт строк, заказы из позиций и план-факт.
   Всё в транзакции вызывающего; изменение + событие — в одной транзакции. Внутренние стоимости (себестоимость,
   маржа, плановая стоимость единицы) отдаются только owner/admin (`canSeeCost`), остальным — null. */
import { and, asc, count, desc, eq, inArray, isNull, ne, sql as dsql } from 'drizzle-orm';
import {
  computeEstimateTotals,
  estimatePlanFact,
  type EstimateLineTotals,
  type EstimateChangeCreate,
  type EstimateContentInput,
  type EstimateCopy,
  type EstimateCreate,
  type EstimateAiResult,
  type EstimateImportRow,
  type EstimateImportExtract,
  type EstimateTableFile,
  type EstimateItemKind,
  type EstimateProductionOrder,
  type EstimateSupplierOrder,
  type EstimateTotals,
  type EstimateUpdate,
  type Role,
  dec,
} from '@gr8r/shared';
import type { Db } from './client';
import { canSeeCost } from './cost';
import { createDocument, type DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { createProductionOrder } from './production';
import { resolvePrices } from './pricing';
import { assertObjectRef } from './objects';
import { objectCostFacts } from './object-budget';
import { objectHasFacts } from './object-forecast';
import {
  companies,
  estimateImports,
  documents,
  jobs,
  manufacturedItems,
  members,
  objectEstimateItems,
  objectEstimateSections,
  objectEstimates,
  objects,
  priceKinds,
  productionItems,
  products,
  units,
} from './schema';

export type EstimateRow = typeof objectEstimates.$inferSelect;
export type EstimateSectionRow = typeof objectEstimateSections.$inferSelect;
export type EstimateItemRow = typeof objectEstimateItems.$inferSelect;

/** Контекст записи: воркспейс, автор и его роль (роль решает, видит ли он внутренние стоимости) */
export interface EstimateCtx extends DocCtx {
  role?: Role;
}

/** Позиция с подписями товара и изделия производства; плановая стоимость — только owner/admin */
export interface EstimateItemView extends Omit<EstimateItemRow, 'costPrice' | 'supplierId' | 'locked'> {
  costPrice: string | null;
  /** Поставщик и замок строки — тоже только owner/admin (иначе null) */
  supplierId: string | null;
  locked: boolean | null;
  productName: string | null;
  manufacturedItemName: string | null;
  /** Заказы на производство, созданные из строки */
  productionOrders: { id: string; number: string | null }[];
  totals: { revenue: string; cost: string | null; hours: string };
}

/** Итоги сметы для интерфейса: себестоимость и маржа скрыты от участников */
export interface EstimateTotalsView {
  revenue: string;
  cost: string | null;
  hours: string;
  margin: string | null;
  marginPct: string | null;
}

export interface EstimateSummary extends Omit<EstimateRow, 'approvedBy'> {
  approvedByName: string | null;
  totals: EstimateTotalsView;
  itemCount: number;
  sectionCount: number;
}

/** Строка план-факта для интерфейса: себестоимость скрыта от участников без права видеть стоимость */
export interface EstimatePlanFactView {
  id: string | null;
  plan: { revenue: string; cost: string | null; hours: string };
  fact: { revenue: string; cost: string | null; hours: string };
  remaining: { revenue: string; cost: string | null; hours: string };
}

export interface EstimateDetail extends EstimateSummary {
  sections: EstimateSectionRow[];
  items: EstimateItemView[];
  planFact: EstimatePlanFactView[];
  /** Родительская (основная) смета у допработ */
  parent: { id: string; number: string; name: string; status: EstimateRow['status'] } | null;
  canSeeCost: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- маскирование внутренних стоимостей ---------------- */

const maskTotals = (t: EstimateTotals, showCost: boolean): EstimateTotalsView => ({
  revenue: t.revenue,
  cost: showCost ? t.cost : null,
  hours: t.hours,
  margin: showCost ? t.margin : null,
  marginPct: showCost ? t.marginPct : null,
});

/* ---------------- загрузка и проверки ---------------- */

async function loadEstimate(db: Db, id: string): Promise<EstimateRow> {
  const [row] = await db.select().from(objectEstimates).where(eq(objectEstimates.id, id)).limit(1).for('update');
  if (!row) throw new DomainError(404, 'not_found', 'estimate not found');
  return row;
}

async function loadSections(db: Db, estimateId: string): Promise<EstimateSectionRow[]> {
  return db.select().from(objectEstimateSections).where(eq(objectEstimateSections.estimateId, estimateId)).orderBy(asc(objectEstimateSections.sortOrder), asc(objectEstimateSections.id));
}

async function loadItems(db: Db, estimateId: string): Promise<EstimateItemRow[]> {
  return db.select().from(objectEstimateItems).where(eq(objectEstimateItems.estimateId, estimateId)).orderBy(asc(objectEstimateItems.sortOrder), asc(objectEstimateItems.id));
}

/** Согласованная смета — снимок цен и норм: состав не правится */
function assertDraft(row: EstimateRow): void {
  if (row.status === 'approved') throw new DomainError(422, 'estimate_approved', 'An approved estimate cannot be changed: return it to draft first');
}

/** Выполненный объём не больше объёма позиции (422 done_qty_exceeds) */
function assertDoneQty(qty: string, doneQty: string): void {
  if (dec(doneQty) > dec(qty)) throw new DomainError(422, 'done_qty_exceeds', 'The completed quantity cannot exceed the line quantity', { qty, doneQty });
  if (dec(doneQty) < 0n) throw new DomainError(422, 'invalid_value', 'The completed quantity cannot be negative');
}

/** Товар и изделие производства должны быть своего воркспейса и не в архиве; единица — из справочника ОКЕИ воркспейса */
async function assertItemRefs(db: Db, input: EstimateContentInput): Promise<void> {
  const productIds = [...new Set(input.items.map(i => i.productId).filter((x): x is string => !!x))];
  if (productIds.length) {
    const rows = await db.select({ id: products.id, archivedAt: products.archivedAt }).from(products).where(inArray(products.id, productIds));
    if (rows.length !== productIds.length || rows.some(r => r.archivedAt)) throw new DomainError(422, 'invalid_reference', 'A product does not exist or is archived');
  }
  const itemIds = [...new Set(input.items.map(i => i.manufacturedItemId).filter((x): x is string => !!x))];
  if (itemIds.length) {
    const rows = await db.select({ id: manufacturedItems.id, archivedAt: manufacturedItems.archivedAt }).from(manufacturedItems).where(inArray(manufacturedItems.id, itemIds));
    if (rows.length !== itemIds.length || rows.some(r => r.archivedAt)) throw new DomainError(422, 'invalid_reference', 'A manufactured item does not exist or is archived');
  }
  const codes = [...new Set(input.items.map(i => i.unitCode))];
  const unitRows = await db.select({ code: units.code }).from(units).where(inArray(units.code, codes));
  if (unitRows.length !== codes.length) throw new DomainError(422, 'invalid_reference', 'The unit is not in the OKЕИ list');
  const supplierIds = [...new Set(input.items.map(i => i.supplierId).filter((x): x is string => !!x))];
  if (supplierIds.length) {
    const rows = await db.select({ id: companies.id }).from(companies).where(inArray(companies.id, supplierIds));
    if (rows.length !== supplierIds.length) throw new DomainError(422, 'invalid_reference', 'A supplier does not exist');
  }
}

/** Разделы, на которые ссылаются позиции: только разделы этой сметы (или разделы из этого же пакета) */
function assertItemSections(input: EstimateContentInput): void {
  const sectionIds = new Set(input.sections.map(s => s.id).filter((x): x is string => !!x));
  for (const i of input.items) if (i.sectionId && !sectionIds.has(i.sectionId)) throw new DomainError(422, 'invalid_reference', 'A section of the estimate does not exist');
}

/** Номер сметы по умолчанию: СМ-001, СМ-002… в пределах объекта */
async function nextEstimateNumber(db: Db, objectId: string): Promise<string> {
  const [{ n }] = await db.select({ n: count() }).from(objectEstimates).where(eq(objectEstimates.objectId, objectId));
  return `СМ-${String(n + 1).padStart(3, '0')}`;
}

/* ---------------- чтение ---------------- */

async function estimateViews(db: Db, rows: EstimateRow[], role: Role | undefined): Promise<EstimateSummary[]> {
  if (!rows.length) return [];
  const showCost = canSeeCost(role);
  const ids = rows.map(r => r.id);
  const [sections, items, approvers] = await Promise.all([
    db.select().from(objectEstimateSections).where(inArray(objectEstimateSections.estimateId, ids)).orderBy(asc(objectEstimateSections.sortOrder)),
    db.select().from(objectEstimateItems).where(inArray(objectEstimateItems.estimateId, ids)).orderBy(asc(objectEstimateItems.sortOrder)),
    db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(inArray(members.id, rows.map(r => r.approvedBy).filter((x): x is string => !!x).concat('00000000-0000-0000-0000-000000000000'))),
  ]);
  const approverName = new Map(approvers.map(a => [a.id, a.name]));
  return rows.map(r => {
    const own = items.filter(i => i.estimateId === r.id);
    const { approvedBy, ...rest } = r;
    return {
      ...rest,
      // единая наценка — внутренняя величина: участники её не видят
      markupPct: showCost ? r.markupPct : null,
      approvedByName: approvedBy ? (approverName.get(approvedBy) ?? null) : null,
      totals: maskTotals(computeEstimateTotals(own), showCost),
      itemCount: own.length,
      sectionCount: sections.filter(s => s.estimateId === r.id).length,
    };
  });
}

/** Сметы объекта: основная первой, затем допработы (новые сверху) */
export async function listObjectEstimates(db: Db, objectId: string, role: Role | undefined): Promise<EstimateSummary[]> {
  // чужой и архивный объект — 422: список смет без объекта не имеет смысла
  await assertObjectRef(db, objectId);
  const rows = await db
    .select()
    .from(objectEstimates)
    .where(eq(objectEstimates.objectId, objectId))
    .orderBy(asc(objectEstimates.kind), desc(objectEstimates.createdAt));
  return estimateViews(db, rows, role);
}

/** Карточка сметы: разделы, позиции, итоги и план-факт. Чужая смета — 404 (RLS и фильтр по воркспейсу) */
export async function getEstimate(db: Db, id: string, role: Role | undefined): Promise<EstimateDetail> {
  const [row] = await db.select().from(objectEstimates).where(eq(objectEstimates.id, id)).limit(1);
  if (!row) throw new DomainError(404, 'not_found', 'estimate not found');
  const showCost = canSeeCost(role);
  const [summary] = await estimateViews(db, [row], role);
  const [sections, itemRows, parent] = await Promise.all([
    loadSections(db, id),
    loadItems(db, id),
    row.parentId
      ? db
          .select({ id: objectEstimates.id, number: objectEstimates.number, name: objectEstimates.name, status: objectEstimates.status })
          .from(objectEstimates)
          .where(eq(objectEstimates.id, row.parentId))
          .limit(1)
          .then(r => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  // подписи товара и изделия производства
  const productIds = [...new Set(itemRows.map(i => i.productId).filter((x): x is string => !!x))];
  const manufacturedIds = [...new Set(itemRows.map(i => i.manufacturedItemId).filter((x): x is string => !!x))];
  const [prods, manufs] = await Promise.all([
    productIds.length ? db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds)) : [],
    manufacturedIds.length ? db.select({ id: manufacturedItems.id, name: manufacturedItems.name }).from(manufacturedItems).where(inArray(manufacturedItems.id, manufacturedIds)) : [],
  ]);
  // заказы на производство по строкам сметы (отменённые не показываем)
  const orderRows = itemRows.length
    ? await db
        .select({ estimateItemId: productionItems.estimateItemId, id: documents.id, number: documents.number, createdAt: documents.createdAt })
        .from(productionItems)
        .innerJoin(documents, eq(documents.id, productionItems.documentId))
        .where(and(inArray(productionItems.estimateItemId, itemRows.map(i => i.id)), eq(documents.type, 'production_order'), ne(documents.status, 'cancelled')))
        .orderBy(asc(documents.createdAt))
    : [];
  const ordersByItem = new Map<string, { id: string; number: string | null }[]>();
  for (const o of orderRows) {
    const list = ordersByItem.get(o.estimateItemId!) ?? [];
    if (!list.some(x => x.id === o.id)) list.push({ id: o.id, number: o.number });
    ordersByItem.set(o.estimateItemId!, list);
  }
  const productName = new Map(prods.map(p => [p.id, p.name]));
  const manufName = new Map(manufs.map(m => [m.id, m.name]));
  const items: EstimateItemView[] = itemRows.map(i => {
    const line = computeEstimateTotals([i]);
    return {
      ...i,
      costPrice: showCost ? i.costPrice : null,
      supplierId: showCost ? i.supplierId : null,
      locked: showCost ? i.locked : null,
      productName: i.productId ? (productName.get(i.productId) ?? null) : null,
      manufacturedItemName: i.manufacturedItemId ? (manufName.get(i.manufacturedItemId) ?? null) : null,
      productionOrders: ordersByItem.get(i.id) ?? [],
      totals: { revenue: line.revenue, cost: showCost ? line.cost : null, hours: line.hours },
    };
  });
  const facts = await estimateFacts(db, id);
  const planFact = estimatePlanFact(itemRows, showCost ? facts : {}).map(r => ({
    id: r.id,
    plan: { ...r.plan, cost: showCost ? r.plan.cost : null },
    fact: { ...r.fact, cost: showCost ? r.fact.cost : null },
    remaining: { ...r.remaining, cost: showCost ? r.remaining.cost : null },
  }));
  return {
    ...summary!,
    sections,
    items,
    planFact,
    parent,
    canSeeCost: showCost,
  };
}

/** Точка расширения план-факта: фактические суммы и часы по позициям сметы.
    Факт задачи 1270 считается по категориям объекта (`objectCostFacts`) и по позициям пока не распределяется: вкладка
    «Смета» показывает его в итогах по категориям, а у строк факт нулевой (распределение — задачи 1271/1274/1275). */
export async function estimateFacts(db: Db, estimateId: string): Promise<Record<string, EstimateLineTotals>> {
  const [row] = await db.select({ objectId: objectEstimates.objectId }).from(objectEstimates).where(eq(objectEstimates.id, estimateId)).limit(1);
  if (row) await objectCostFacts(db, row.objectId);
  return {};
}

/* ---------------- смета ---------------- */

/** Создание основной сметы объекта: у объекта она одна (409 estimate_exists) */
export async function createEstimate(db: Db, ctx: EstimateCtx, objectId: string, input: EstimateCreate): Promise<EstimateRow> {
  await assertObjectRef(db, objectId);
  const [exists] = await db
    .select({ id: objectEstimates.id })
    .from(objectEstimates)
    .where(and(eq(objectEstimates.objectId, objectId), eq(objectEstimates.kind, 'main')))
    .limit(1);
  if (exists) throw new DomainError(409, 'estimate_exists', 'The object already has a main estimate');
  const [row] = await db
    .insert(objectEstimates)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      objectId,
      number: input.number.trim() || (await nextEstimateNumber(db, objectId)),
      name: input.name.trim(),
      kind: 'main',
      status: 'draft',
      note: input.note,
    })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_estimate.created', entity: 'object_estimate', recordId: row!.id, actorId: ctx.memberId, payload: { objectId, number: row!.number } });
  return row!;
}

/** Правка шапки сметы: undefined — не трогать. Согласованную смету правит только owner/admin (возврат в черновик) */
export async function updateEstimate(db: Db, ctx: EstimateCtx, id: string, input: EstimateUpdate): Promise<EstimateRow> {
  const row = await loadEstimate(db, id);
  assertDraft(row);
  const set: Partial<typeof objectEstimates.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.number !== undefined) set.number = input.number.trim();
  if (input.note !== undefined) set.note = input.note;
  const [updated] = await db.update(objectEstimates).set(set).where(eq(objectEstimates.id, id)).returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_estimate.updated', entity: 'object_estimate', recordId: id, actorId: ctx.memberId, payload: { fields: Object.keys(input) } });
  return updated!;
}

/** Удаление черновика: согласованную смету сначала возвращают в черновик */
export async function deleteEstimate(db: Db, ctx: EstimateCtx, id: string): Promise<void> {
  const row = await loadEstimate(db, id);
  if (row.status === 'approved') throw new DomainError(422, 'estimate_approved', 'An approved estimate cannot be deleted: return it to draft first');
  if (row.kind === 'main') {
    const [child] = await db
      .select({ id: objectEstimates.id })
      .from(objectEstimates)
      .where(and(eq(objectEstimates.parentId, id), eq(objectEstimates.status, 'approved')))
      .limit(1);
    if (child) throw new DomainError(422, 'estimate_has_changes', 'The estimate has approved change orders: delete them first');
  }
  await db.delete(objectEstimates).where(eq(objectEstimates.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_estimate.deleted', entity: 'object_estimate', recordId: id, actorId: ctx.memberId, payload: { objectId: row.objectId } });
}

/** Пакетное сохранение содержимого: разделы и позиции заменяются списками (как строки документа).
    Существующие строки обновляются по id, чтобы ссылки не терялись; id новых приходят от клиента (clientId). */
export async function saveEstimateContent(db: Db, ctx: EstimateCtx, id: string, input: EstimateContentInput): Promise<EstimateDetail> {
  const row = await loadEstimate(db, id);
  assertDraft(row);
  assertItemSections(input);
  await assertItemRefs(db, input);
  const showCost = canSeeCost(ctx.role);

  const existingSections = await loadSections(db, id);
  const keepSections = new Set(input.sections.map(s => s.id).filter((x): x is string => !!x));
  const dropSections = existingSections.filter(s => !keepSections.has(s.id)).map(s => s.id);
  if (dropSections.length) await db.delete(objectEstimateSections).where(inArray(objectEstimateSections.id, dropSections));
  for (const [n, s] of input.sections.entries()) {
    if (s.id && existingSections.some(e => e.id === s.id)) await db.update(objectEstimateSections).set({ name: s.name.trim(), sortOrder: n }).where(eq(objectEstimateSections.id, s.id));
    else await db.insert(objectEstimateSections).values({ ...(s.id ? { id: s.id } : {}), workspaceId: ctx.workspaceId, estimateId: id, name: s.name.trim(), sortOrder: n });
  }

  const existingItems = await loadItems(db, id);
  const keepItems = new Set(input.items.map(i => i.id).filter((x): x is string => !!x));
  const dropItems = existingItems.filter(i => !keepItems.has(i.id)).map(i => i.id);
  if (dropItems.length) await db.delete(objectEstimateItems).where(inArray(objectEstimateItems.id, dropItems));
  for (const [n, i] of input.items.entries()) {
    const prev = existingItems.find(e => e.id === i.id);
    // выполненный объём — факт (задача 1272): не указан — сохраняем прежний, больше объёма — 422
    const doneQty = i.doneQty ?? prev?.doneQty ?? '0';
    assertDoneQty(i.qty, doneQty);
    // себестоимость, поставщик и замок — внутренние: участник их не меняет (у новой строки — значения по умолчанию)
    const internal = showCost
      ? { costPrice: i.costPrice, supplierId: i.supplierId === undefined ? (prev?.supplierId ?? null) : i.supplierId, locked: i.locked ?? prev?.locked ?? false }
      : { costPrice: prev?.costPrice ?? '0', supplierId: prev?.supplierId ?? null, locked: prev?.locked ?? false };
    const values = {
      sectionId: i.sectionId ?? null,
      sortOrder: n,
      kind: i.kind,
      name: i.name.trim(),
      productId: i.productId ?? null,
      unitCode: i.unitCode,
      qty: i.qty,
      price: i.price,
      vatRate: i.vatRate,
      ...internal,
      laborHours: i.laborHours,
      doneQty,
      manufacturedItemId: i.manufacturedItemId ?? null,
      note: i.note,
    };
    if (i.id && existingItems.some(e => e.id === i.id)) await db.update(objectEstimateItems).set(values).where(eq(objectEstimateItems.id, i.id));
    else await db.insert(objectEstimateItems).values({ ...(i.id ? { id: i.id } : {}), workspaceId: ctx.workspaceId, estimateId: id, ...values });
  }
  // единая наценка: undefined — не трогать, null — снять; участник её не меняет
  await db.update(objectEstimates).set({ updatedAt: new Date(), ...(showCost && input.markupPct !== undefined ? { markupPct: input.markupPct } : {}) }).where(eq(objectEstimates.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_estimate.updated', entity: 'object_estimate', recordId: id, actorId: ctx.memberId, payload: { items: input.items.length, sections: input.sections.length } });
  return getEstimate(db, id, ctx.role);
}

/** Выполненные объёмы позиций сметы: правится и у согласованной сметы — это факт, а не состав.
    Пока вводится вручную во вкладке «Смета»; позже обновится сменным отчётом (задача 1271). */
export async function saveEstimateDoneQty(db: Db, ctx: EstimateCtx, id: string, items: { id: string; doneQty: string }[]): Promise<EstimateDetail> {
  const estimate = await loadEstimate(db, id);
  const rows = await loadItems(db, id);
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const i of items) {
    const row = byId.get(i.id);
    if (!row) throw new DomainError(422, 'invalid_reference', 'An estimate line of this estimate does not exist');
    assertDoneQty(row.qty, i.doneQty);
    if (row.doneQty !== i.doneQty) await db.update(objectEstimateItems).set({ doneQty: i.doneQty }).where(eq(objectEstimateItems.id, i.id));
  }
  await db.update(objectEstimates).set({ updatedAt: new Date() }).where(eq(objectEstimates.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_estimate.updated', entity: 'object_estimate', recordId: id, actorId: ctx.memberId, payload: { doneQty: items.length, objectId: estimate.objectId } });
  return getEstimate(db, id, ctx.role);
}

/** Цены поставщика на сегодня: неархивный вид цен с supplier_id = поставщик, цены — через resolvePrices.
    Нет вида или цены — товара нет в ответе. Только owner/admin (403): цена закупки — внутренняя величина. */
export async function supplierProductPrices(db: Db, ctx: EstimateCtx, supplierId: string, productIds: string[]): Promise<{ productId: string; price: string }[]> {
  if (!canSeeCost(ctx.role)) throw new DomainError(403, 'forbidden', 'Only the owner or an admin can see supplier prices');
  const [kind] = await db
    .select({ id: priceKinds.id })
    .from(priceKinds)
    .where(and(eq(priceKinds.workspaceId, ctx.workspaceId), eq(priceKinds.supplierId, supplierId), isNull(priceKinds.archivedAt)))
    .orderBy(asc(priceKinds.sortOrder), asc(priceKinds.createdAt))
    .limit(1);
  if (!kind || !productIds.length) return [];
  const prices = await resolvePrices(db, ctx.workspaceId, kind.id, [...new Set(productIds)], today());
  const out: { productId: string; price: string }[] = [];
  for (const [productId, r] of prices) if (r.price !== null) out.push({ productId, price: r.price });
  return out;
}

/* ---------------- согласование ---------------- */

/** Согласование: снимок цен и норм — база план-факта; без позиций смету не согласовать */
export async function approveEstimate(db: Db, ctx: EstimateCtx, id: string): Promise<EstimateRow> {
  const row = await loadEstimate(db, id);
  if (row.status === 'approved') throw new DomainError(422, 'invalid_status', 'The estimate is already approved');
  const [{ n }] = await db.select({ n: count() }).from(objectEstimateItems).where(eq(objectEstimateItems.estimateId, id));
  if (!n) throw new DomainError(422, 'no_items', 'Add estimate lines before approving');
  if (row.kind === 'change' && row.changeStatus === 'rejected') throw new DomainError(422, 'invalid_status', 'The change order is rejected');
  const [updated] = await db
    .update(objectEstimates)
    .set({
      status: 'approved',
      approvedAt: new Date(),
      approvedBy: ctx.memberId,
      ...(row.kind === 'change' ? { changeStatus: 'approved' as const } : {}),
      updatedAt: new Date(),
    })
    .where(eq(objectEstimates.id, id))
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_estimate.approved', entity: 'object_estimate', recordId: id, actorId: ctx.memberId, payload: { kind: row.kind } });
  return updated!;
}

/** Возврат в черновик: только owner/admin (маршрут требует admin+).
    Запрещён, если по объекту уже есть факт (задача 1275): подтверждённые смены, принятые акты субподряда или
    подписанные акты заказчику — иначе снимок цен и норм разошёлся бы с уже учтёнными затратами. */
export async function unapproveEstimate(db: Db, ctx: EstimateCtx, id: string): Promise<EstimateRow> {
  if (!canSeeCost(ctx.role)) throw new DomainError(403, 'forbidden', 'Only the owner or an admin can return an estimate to draft');
  const row = await loadEstimate(db, id);
  if (row.status !== 'approved') throw new DomainError(422, 'invalid_status', 'The estimate is not approved');
  if (await objectHasFacts(db, row.objectId))
    throw new DomainError(422, 'estimate_has_facts', 'The estimate cannot be returned to draft: the object already has facts');
  const [updated] = await db
    .update(objectEstimates)
    .set({ status: 'draft', approvedAt: null, approvedBy: null, ...(row.kind === 'change' ? { changeStatus: 'draft' as const } : {}), updatedAt: new Date() })
    .where(eq(objectEstimates.id, id))
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_estimate.unapproved', entity: 'object_estimate', recordId: id, actorId: ctx.memberId, payload: { kind: row.kind } });
  return updated!;
}

/** Допработы создаются только к согласованной основной смете (422 estimate_not_approved) */
export async function createEstimateChange(db: Db, ctx: EstimateCtx, mainId: string, input: EstimateChangeCreate): Promise<EstimateRow> {
  const main = await loadEstimate(db, mainId);
  if (main.kind !== 'main') throw new DomainError(422, 'invalid_reference', 'Change orders are created for the main estimate');
  if (main.status !== 'approved') throw new DomainError(422, 'estimate_not_approved', 'Approve the main estimate before adding change orders');
  const [row] = await db
    .insert(objectEstimates)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      objectId: main.objectId,
      number: `${main.number || 'СМ'}-Д${(await db.select({ n: count() }).from(objectEstimates).where(eq(objectEstimates.parentId, main.id)))[0]!.n + 1}`,
      name: input.name.trim(),
      kind: 'change',
      status: 'draft',
      changeStatus: 'draft',
      parentId: main.id,
      note: input.note,
    })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_estimate.created', entity: 'object_estimate', recordId: row!.id, actorId: ctx.memberId, payload: { objectId: main.objectId, kind: 'change', number: row!.number } });
  return row!;
}

/** Копирование сметы другого объекта: разделы и позиции копируются в новую основную смету объекта */
export async function copyEstimateToObject(db: Db, ctx: EstimateCtx, objectId: string, input: EstimateCopy): Promise<EstimateRow> {
  const [source] = await db.select().from(objectEstimates).where(eq(objectEstimates.id, input.estimateId)).limit(1);
  if (!source) throw new DomainError(404, 'not_found', 'estimate not found');
  const created = await createEstimate(db, ctx, objectId, { name: input.name?.trim() || source.name, number: '', note: source.note });
  if (source.markupPct != null) await db.update(objectEstimates).set({ markupPct: source.markupPct }).where(eq(objectEstimates.id, created.id));
  const sections = await loadSections(db, source.id);
  const items = await loadItems(db, source.id);
  const sectionMap = new Map<string, string>();
  for (const [n, s] of sections.entries()) {
    const [row] = await db.insert(objectEstimateSections).values({ workspaceId: ctx.workspaceId, estimateId: created.id, name: s.name, sortOrder: n }).returning({ id: objectEstimateSections.id });
    sectionMap.set(s.id, row!.id);
  }
  if (items.length)
    await db.insert(objectEstimateItems).values(
      items.map((i, n) => ({
        workspaceId: ctx.workspaceId,
        estimateId: created.id,
        sectionId: i.sectionId ? (sectionMap.get(i.sectionId) ?? null) : null,
        sortOrder: n,
        kind: i.kind,
        name: i.name,
        productId: i.productId,
        unitCode: i.unitCode,
        qty: i.qty,
        price: i.price,
        vatRate: i.vatRate,
        costPrice: i.costPrice,
        supplierId: i.supplierId,
        locked: i.locked,
        laborHours: i.laborHours,
        manufacturedItemId: i.manufacturedItemId,
        note: i.note,
      })),
    );
  return created;
}

/* ---------------- импорт ---------------- */

/** Единица из справочника по коду ОКЕИ, обозначению или названию; неизвестная — базовая (796) с пометкой в примечании */
async function resolveUnit(db: Db, raw: string | undefined): Promise<{ code: string; unknown: string | null }> {
  if (!raw?.trim()) return { code: '796', unknown: null };
  const text = raw.trim();
  const rows = await db.select({ code: units.code, name: units.name, symbol: units.symbol }).from(units);
  const hit = rows.find(u => u.code === text) ?? rows.find(u => u.symbol.toLowerCase() === text.toLowerCase()) ?? rows.find(u => u.name.toLowerCase() === text.toLowerCase());
  return hit ? { code: hit.code, unknown: null } : { code: '796', unknown: text };
}

/** Импорт строк из Excel: разделы по названию (создаются при необходимости), позиции добавляются в конец */
export async function importEstimateRows(db: Db, ctx: EstimateCtx, id: string, rows: EstimateImportRow[]): Promise<EstimateDetail> {
  const estimate = await loadEstimate(db, id);
  assertDraft(estimate);
  if (!rows.length) throw new DomainError(422, 'no_items', 'The file has no rows to import');
  const sections = await loadSections(db, id);
  const sectionId = new Map(sections.map(s => [s.name.toLowerCase(), s.id]));
  const [{ n: current }] = await db.select({ n: count() }).from(objectEstimateItems).where(eq(objectEstimateItems.estimateId, id));
  const [{ n: sectionCount }] = await db.select({ n: count() }).from(objectEstimateSections).where(eq(objectEstimateSections.estimateId, id));
  let order = current;
  let sectionOrder = sectionCount;
  for (const r of rows) {
    let section: string | null = null;
    const name = r.section?.trim();
    if (name) {
      const key = name.toLowerCase();
      section = sectionId.get(key) ?? null;
      if (!section) {
        const [created] = await db
          .insert(objectEstimateSections)
          .values({ workspaceId: ctx.workspaceId, estimateId: id, name, sortOrder: sectionOrder++ })
          .returning({ id: objectEstimateSections.id });
        section = created!.id;
        sectionId.set(key, section);
      }
    }
    const unit = await resolveUnit(db, r.unit);
    await db.insert(objectEstimateItems).values({
      workspaceId: ctx.workspaceId,
      estimateId: id,
      sectionId: section,
      sortOrder: order++,
      kind: (r.kind ?? 'work') as EstimateItemKind,
      name: r.name.trim(),
      unitCode: unit.code,
      qty: r.qty,
      price: r.price,
      costPrice: r.costPrice ?? '0',
      laborHours: r.laborHours ?? '0',
      note: unit.unknown ? `Единица «${unit.unknown}» не найдена в справочнике` : '',
    });
  }
  await db.update(objectEstimates).set({ updatedAt: new Date() }).where(eq(objectEstimates.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_estimate.imported', entity: 'object_estimate', recordId: id, actorId: ctx.memberId, payload: { rows: rows.length } });
  return getEstimate(db, id, ctx.role);
}

/* ---------------- импорт сметы из документа (docx) ---------------- */

/** Задача воркера: ИИ-разметка строк импорта сметы из документа */
export const ESTIMATE_AI_JOB = 'estimate.ai_extract';

/** Импорт документа: таблица извлечена маршрутом. ready (PDF) — задача не ставится, её поставит
 * runEstimateImportExtract после выбора страниц и подсказки; иначе разметку сразу делает ESTIMATE_AI_JOB */
export async function createEstimateImport(
  db: Db,
  ctx: EstimateCtx,
  input: { estimateId: string | null; fileName: string; table: EstimateTableFile; status?: 'ready' | 'pending'; meta?: Record<string, unknown>; source?: { page: number; markdown: string }[] },
): Promise<string> {
  const [row] = await db
    .insert(estimateImports)
    .values({ workspaceId: ctx.workspaceId, estimateId: input.estimateId, fileName: input.fileName.slice(0, 200), table: input.table, status: input.status ?? 'pending', meta: input.meta, source: input.source })
    .returning({ id: estimateImports.id });
  const id = row!.id;
  if ((input.status ?? 'pending') === 'pending') await db.insert(jobs).values({ workspaceId: ctx.workspaceId, type: ESTIMATE_AI_JOB, payload: { importId: id } });
  return id;
}

/** Импорт документа со своего воркспейса: таблица и результат ИИ-разметки */
export async function getEstimateImport(db: Db, workspaceId: string, id: string): Promise<EstimateImportDoc> {
  const [row] = await db.select().from(estimateImports).where(and(eq(estimateImports.workspaceId, workspaceId), eq(estimateImports.id, id))).limit(1);
  if (!row) throw new DomainError(404, 'not_found', 'Estimate import not found');
  const [job] = await db.select({
    status: jobs.status, attempt: jobs.attempts, maxAttempts: jobs.maxAttempts,
    retryAt: jobs.runAt, error: jobs.lastError,
  }).from(jobs).where(and(
    eq(jobs.workspaceId, workspaceId), eq(jobs.type, ESTIMATE_AI_JOB),
    dsql`${jobs.payload}->>'importId' = ${id}`,
  )).orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(1);
  return { ...row, status: row.status === 'pending' && job?.status === 'failed' ? 'failed' : row.status, job: job ?? null };
}

/** Запуск разметки PDF (готовый к выбору страниц импорт): строки фильтруются по страницам,
 * подсказка сохраняется и уходит в промпт, ставится задача ИИ */
export async function runEstimateImportExtract(db: Db, ctx: EstimateCtx, id: string, input: EstimateImportExtract): Promise<void> {
  await db.select({ id: estimateImports.id }).from(estimateImports)
    .where(and(eq(estimateImports.workspaceId, ctx.workspaceId), eq(estimateImports.id, id))).for('update');
  const row = await getEstimateImport(db, ctx.workspaceId, id);
  const retry = (row.status === 'done' || row.status === 'failed') && !(row.aiResult as EstimateAiResult | null)?.rows?.length;
  if (row.status !== 'ready' && !retry) throw new DomainError(422, 'import_not_ready', 'The import is already being marked up');
  let table = row.table as EstimateTableFile;
  const sourceMeta = (row.meta ?? {}) as { pageCount?: number; selectedPages?: number[] | null };
  if (input.regions) {
    const pageCount = sourceMeta.pageCount;
    if (!pageCount || input.regions.some(region => region.page > pageCount)) {
      throw new DomainError(422, 'import_file_invalid', 'A selected area is outside the PDF');
    }
    table = { header: [], rows: [], rowPages: [] };
  } else if (!table.rows.length) {
    throw new DomainError(422, 'import_pdf_scanned', 'Select areas for image recognition on this PDF');
  } else if (input.pages?.length && table.rowPages?.length) {
    const keep = new Set(input.pages);
    const idx = table.rows.map((_, i) => i).filter(i => keep.has(table.rowPages![i]!));
    table = { ...table, rows: idx.map(i => table.rows[i]!), rowPages: idx.map(i => table.rowPages![i]!) };
    if (table.rows.length < 2) throw new DomainError(422, 'import_file_invalid', 'The selected pages have no data rows');
  }
  const selectedPages = input.regions ? [...new Set(input.regions.map(region => region.page))] : input.pages ?? (retry ? sourceMeta.selectedPages ?? null : null);
  const meta = { ...sourceMeta, selectedPages, visual: !!input.regions };
  const [updated] = await db
    .update(estimateImports)
    .set({ status: 'pending', hint: input.hint ?? row.hint ?? null, table, meta, aiError: null, error: null, aiResult: null, finishedAt: null })
    .where(and(eq(estimateImports.workspaceId, ctx.workspaceId), eq(estimateImports.id, id)))
    .returning({ id: estimateImports.id });
  if (!updated) throw new DomainError(422, 'import_not_ready', 'The import is already being marked up');
  await db.insert(jobs).values({
    workspaceId: ctx.workspaceId, type: ESTIMATE_AI_JOB,
    payload: { importId: id, ...(input.regions ? { regions: input.regions } : {}) },
  });
}

/** Исходный markdown импорта документа (pdf): страницы как их разобрал pdf-inspector */
export async function getEstimateImportSource(db: Db, workspaceId: string, id: string): Promise<{ page: number; markdown: string }[]> {
  const [row] = await db.select({ source: estimateImports.source }).from(estimateImports).where(and(eq(estimateImports.workspaceId, workspaceId), eq(estimateImports.id, id))).limit(1);
  if (!row) throw new DomainError(404, 'not_found', 'Estimate import not found');
  return (row.source as { page: number; markdown: string }[] | null) ?? [];
}

/** Записать результат ИИ-разметки (задача воркера): null + причина — fallback на сопоставление колонок */
export async function saveEstimateImportAi(db: Db, workspaceId: string, id: string, aiResult: EstimateAiResult | null, aiError: string | null): Promise<void> {
  await db
    .update(estimateImports)
    .set({ status: 'done', aiResult, aiError: aiError?.slice(0, 500) ?? null, finishedAt: new Date() })
    .where(and(eq(estimateImports.workspaceId, workspaceId), eq(estimateImports.id, id)));
}

export type EstimateImportDoc = typeof estimateImports.$inferSelect & {
  job: {
    status: 'queued' | 'running' | 'done' | 'failed';
    attempt: number;
    maxAttempts: number;
    retryAt: Date;
    error: string | null;
  } | null;
};

/* ---------------- заказы из позиций ---------------- */

/** Позиции для заказа: выбранные (или все подходящие) с заполненной ссылкой */
async function orderItems(db: Db, estimateId: string, kinds: readonly EstimateItemKind[], field: 'productId' | 'manufacturedItemId', itemIds?: string[]) {
  const rows = await loadItems(db, estimateId);
  const wanted = itemIds?.length ? new Set(itemIds) : null;
  return rows.filter(i => kinds.includes(i.kind as EstimateItemKind) && !!i[field] && dec(i.qty) > 0n && (!wanted || wanted.has(i.id)));
}

/** Заказ поставщику из позиций сметы: материалы и субподряд с товаром каталога, объект — объект сметы */
export async function createSupplierOrderFromEstimate(db: Db, ctx: EstimateCtx, estimateId: string, input: EstimateSupplierOrder): Promise<{ id: string; lines: number }> {
  const estimate = await loadEstimate(db, estimateId);
  const object = await assertObjectRef(db, estimate.objectId);
  const lines = await orderItems(db, estimateId, ['material', 'subcontract'], 'productId', input.itemIds);
  if (!lines.length) throw new DomainError(422, 'nothing_to_create', 'The estimate has no materials or subcontract lines with a catalog product');
  const ids = [...new Set(lines.map(l => l.productId!))];
  const prices = await db.select({ id: products.id, purchasePrice: products.purchasePrice }).from(products).where(inArray(products.id, ids));
  const price = new Map(prices.map(p => [p.id, p.purchasePrice]));
  const id = await createDocument(
    db,
    { workspaceId: ctx.workspaceId, memberId: ctx.memberId, ...(ctx.role ? { role: ctx.role } : {}) },
    {
      type: 'supplier_order',
      counterpartyId: input.supplierId,
      warehouseId: object.warehouseId ?? undefined,
      objectId: object.id,
      date: input.date ?? today(),
      comment: input.comment?.trim() || `Смета ${estimate.number} — ${object.name}`.trim(),
      lines: lines.map(l => ({ productId: l.productId!, qty: l.qty, price: price.get(l.productId!) ?? '0', discountPct: '0' })),
    },
  );
  await db.update(objects).set({ updatedAt: new Date() }).where(eq(objects.id, object.id));
  return { id, lines: lines.length };
}

/** Заказ на производство из позиций сметы: щиты собственного производства, объект — объект сметы */
export async function createProductionOrderFromEstimate(db: Db, ctx: EstimateCtx, estimateId: string, input: EstimateProductionOrder): Promise<{ id: string; lines: number }> {
  const estimate = await loadEstimate(db, estimateId);
  const object = await assertObjectRef(db, estimate.objectId);
  let items: { itemId: string; qty: string; estimateItemId: string; params?: Record<string, unknown> }[];
  if (input.lines?.length) {
    // строки окна «Заказ на производство» строки сметы: каждая должна быть щитом этой сметы
    const own = new Map((await loadItems(db, estimateId)).map(i => [i.id, i]));
    for (const l of input.lines) {
      const row = own.get(l.estimateItemId);
      if (!row || row.kind !== 'panel') throw new DomainError(422, 'invalid_reference', 'The line does not belong to this estimate or is not a panel');
    }
    items = input.lines.map(l => ({ itemId: l.manufacturedItemId, qty: l.qty, estimateItemId: l.estimateItemId, ...(l.params ? { params: l.params } : {}) }));
  } else {
    const lines = await orderItems(db, estimateId, ['panel'], 'manufacturedItemId', input.itemIds);
    items = lines.map(l => ({ itemId: l.manufacturedItemId!, qty: l.qty, estimateItemId: l.id }));
  }
  if (!items.length) throw new DomainError(422, 'nothing_to_create', 'The estimate has no panel lines with a production item');
  const id = await createProductionOrder(
    db,
    { workspaceId: ctx.workspaceId, memberId: ctx.memberId, ...(ctx.role ? { role: ctx.role } : {}) },
    {
      ...(input.workCenterId ? { workCenterId: input.workCenterId } : {}),
      date: input.date ?? today(),
      comment: input.comment?.trim() || `Смета ${estimate.number} — ${object.name}`.trim(),
      objectId: object.id,
      items,
    },
  );
  return { id, lines: items.length };
}
