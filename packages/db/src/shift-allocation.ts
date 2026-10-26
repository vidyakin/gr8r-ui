/* Распределение материалов по итогам смены (задача 1135, раздел docs/architecture/production-shift-allocation.md).

   Участок в режиме «по итогам смены»: выпуск проводится без списания материалов, а документ «Распределение материалов»
   списывает фактический расход смены со склада и делит его между выпусками участка за период пропорционально нормам.
   Строки документа — обычные строки списания (товар × количество), результат — `material_allocation_rows`.
   Стоимость доходит до продукции прибавкой к цене прихода (recomputeStockCosts в stock.ts): `production_items.alloc_cost`
   (материалы с накладными) — своя часть позиции, у промежуточного этапа она копится как НЗП и уходит в следующий этап. */
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { allocateShiftMaterials, costShares, dec, fmt, mul, pctOf, type Dec, type ShiftTarget } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { DOCUMENT_HOOKS } from './document-hooks';
import { applyDocumentMoves, createDocument, updateDocument, type DocCtx, type DocumentPatch } from './documents';
import { recomputeStockCosts, documentLineCosts } from './stock';
import { uuidv7 } from './uuid';
import { documentLines, documents, manufacturedItems, materialAllocationRows, materialAllocations, productionComponents, productionHeaders, productionItems, products, stockMoves, warehouses, workCenters } from './schema';

export interface AllocationLineInput {
  id?: string;
  productId: string;
  qty: string;
}

export interface AllocationInput {
  id?: string;
  workCenterId: string;
  /** Склад списания; пусто — склад-цех участка */
  warehouseId?: string | null;
  date?: string;
  periodFrom?: string;
  periodTo?: string;
  comment?: string;
  lines?: AllocationLineInput[];
}

/** Позиция выпуска, участвующая в распределении */
interface ReleaseTarget {
  itemId: string;
  releaseId: string;
  releaseNumber: string | null;
  releaseDate: string;
  name: string;
  qty: Dec;
  overheadPct: Dec;
  /** Норма по товарам материалов и плановая стоимость материалов позиции */
  norms: Map<string, Dec>;
  plannedCost: Dec;
}

/** Проведённые выпуски участка в режиме смены за период, ещё не вошедшие в другое проведённое распределение.
    Строки результата есть только у проведённых распределений, поэтому достаточно проверить их отсутствие */
async function loadTargets(db: Db, workCenterId: string, from: string, to: string, exceptDocId?: string): Promise<ReleaseTarget[]> {
  const items = await db
    .select({
      itemId: productionItems.id,
      releaseId: documents.id,
      number: documents.number,
      date: documents.date,
      qty: productionItems.qty,
      name: manufacturedItems.name,
      overheadPct: manufacturedItems.overheadPct,
    })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .innerJoin(productionHeaders, and(eq(productionHeaders.workspaceId, documents.workspaceId), eq(productionHeaders.documentId, documents.id)))
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionItems.itemId))
    .where(
      and(
        eq(documents.type, 'production'),
        eq(documents.status, 'posted'),
        eq(productionHeaders.workCenterId, workCenterId),
        eq(productionHeaders.materialMode, 'shift'),
        gte(documents.date, from),
        lte(documents.date, to),
        sql`not exists (select 1 from material_allocation_rows r where r.release_id = ${documents.id}${exceptDocId ? sql` and r.document_id <> ${exceptDocId}` : sql``})`,
      ),
    )
    .orderBy(asc(documents.date), asc(documents.createdAt), asc(productionItems.sortOrder));
  if (!items.length) return [];
  const comps = await db
    .select({ itemId: productionComponents.itemId, productId: productionComponents.productId, qty: productionComponents.qty, plannedCost: productionComponents.plannedCost })
    .from(productionComponents)
    .where(and(inArray(productionComponents.itemId, items.map(i => i.itemId)), inArray(productionComponents.kind, ['material', 'semi']), eq(productionComponents.ownerKind, 'own')));
  return items.map(i => {
    const own = comps.filter(c => c.itemId === i.itemId);
    const norms = new Map<string, Dec>();
    let plannedCost = 0n;
    for (const c of own) {
      norms.set(c.productId!, (norms.get(c.productId!) ?? 0n) + dec(c.qty));
      plannedCost += dec(c.plannedCost);
    }
    return { itemId: i.itemId, releaseId: i.releaseId, releaseNumber: i.number, releaseDate: i.date, name: i.name, qty: dec(i.qty), overheadPct: dec(i.overheadPct), norms, plannedCost };
  });
}

async function loadAllocation(db: Db, id: string, lock = false) {
  const q = db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const [doc] = lock ? await q.for('update') : await q;
  if (!doc || doc.type !== 'material_allocation') throw new DomainError(404, 'not_found', 'document not found');
  const [header] = await db.select().from(materialAllocations).where(eq(materialAllocations.documentId, id)).limit(1);
  if (!header) throw new DomainError(404, 'not_found', 'The allocation has no header');
  return { doc, header };
}

async function assertCenter(db: Db, workCenterId: string): Promise<{ warehouseId: string | null }> {
  const [wc] = await db.select({ warehouseId: workCenters.warehouseId, archivedAt: workCenters.archivedAt }).from(workCenters).where(eq(workCenters.id, workCenterId)).limit(1);
  if (!wc || wc.archivedAt) throw new DomainError(422, 'invalid_reference', 'The work center does not exist or is archived');
  return { warehouseId: wc.warehouseId };
}

/** Строки списания из пар «товар — количество»: только складские товары, количество больше нуля */
async function toLineInputs(db: Db, lines: AllocationLineInput[]) {
  const ids = [...new Set(lines.map(l => l.productId))];
  const rows = ids.length ? await db.select({ id: products.id, kind: products.kind, name: products.name, unitCode: products.unitCode }).from(products).where(inArray(products.id, ids)) : [];
  const by = new Map(rows.map(p => [p.id, p]));
  return lines.map(l => {
    const p = by.get(l.productId);
    if (!p) throw new DomainError(422, 'invalid_reference', 'A line refers to a product that does not exist');
    if (p.kind !== 'goods') throw new DomainError(422, 'item_not_stockable', 'Only goods can be allocated');
    if (dec(l.qty) <= 0n) throw new DomainError(422, 'invalid_qty', `"${p.name}": the quantity must be greater than zero`);
    return { id: l.id ?? uuidv7(), productId: l.productId, name: p.name, unitCode: p.unitCode, qty: l.qty, price: '0', discountPct: '0', vatRate: 'none' as const, stockRole: 'out' as const };
  });
}

/** Черновик документа «Распределение материалов» */
export async function createMaterialAllocation(db: Db, ctx: DocCtx, input: AllocationInput): Promise<string> {
  const center = await assertCenter(db, input.workCenterId);
  const date = input.date;
  const id = await createDocument(db, ctx, {
    ...(input.id ? { id: input.id } : {}),
    type: 'material_allocation',
    organizationId: null,
    workCenterId: input.workCenterId,
    warehouseId: input.warehouseId ?? center.warehouseId,
    date,
    comment: input.comment ?? '',
    lines: input.lines?.length ? await toLineInputs(db, input.lines) : undefined,
  });
  const [doc] = await db.select({ date: documents.date }).from(documents).where(eq(documents.id, id)).limit(1);
  const from = input.periodFrom ?? doc!.date;
  const to = input.periodTo ?? from;
  if (from > to) throw new DomainError(422, 'invalid_period', 'The period start is after its end');
  await db.insert(materialAllocations).values({ workspaceId: ctx.workspaceId, documentId: id, periodFrom: from, periodTo: to });
  return id;
}

export interface AllocationPatch {
  workCenterId?: string;
  warehouseId?: string | null;
  date?: string;
  periodFrom?: string;
  periodTo?: string;
  comment?: string;
  lines?: AllocationLineInput[];
}

/** Правка черновика: шапка, период и строки материалов */
export async function updateMaterialAllocation(db: Db, ctx: DocCtx, id: string, patch: AllocationPatch): Promise<void> {
  const { doc, header } = await loadAllocation(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  const docPatch: DocumentPatch = {};
  if (patch.workCenterId !== undefined) {
    await assertCenter(db, patch.workCenterId);
    docPatch.workCenterId = patch.workCenterId;
  }
  if (patch.warehouseId !== undefined) docPatch.warehouseId = patch.warehouseId;
  if (patch.date !== undefined) docPatch.date = patch.date;
  if (patch.comment !== undefined) docPatch.comment = patch.comment;
  if (patch.lines) docPatch.lines = await toLineInputs(db, patch.lines);
  if (Object.keys(docPatch).length) await updateDocument(db, ctx, id, docPatch);
  const from = patch.periodFrom ?? header.periodFrom;
  const to = patch.periodTo ?? header.periodTo;
  if (from > to) throw new DomainError(422, 'invalid_period', 'The period start is after its end');
  if (from !== header.periodFrom || to !== header.periodTo) await db.update(materialAllocations).set({ periodFrom: from, periodTo: to, updatedAt: new Date() }).where(eq(materialAllocations.documentId, id));
}

/** Материалы по товарам из строк документа */
function materialsOf(lines: { productId: string; qty: string }[]): { key: string; qty: Dec }[] {
  const by = new Map<string, Dec>();
  for (const l of lines) by.set(l.productId, (by.get(l.productId) ?? 0n) + dec(l.qty));
  return [...by].map(([key, qty]) => ({ key, qty }));
}

function toShiftTargets(targets: ReleaseTarget[]): ShiftTarget[] {
  return targets.map(t => ({ id: t.itemId, qty: t.qty, plannedCost: t.plannedCost, norms: t.norms }));
}

/** «Заполнить по нормам»: сумма норм материалов всех выпусков периода (строки заменяются) */
export async function fillAllocationByNorms(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const { doc, header } = await loadAllocation(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  const targets = await loadTargets(db, doc.workCenterId!, header.periodFrom, header.periodTo, id);
  if (!targets.length) throw new DomainError(422, 'no_releases', 'There are no shift-mode releases of this work center in the period');
  const sum = new Map<string, Dec>();
  for (const t of targets) for (const [p, q] of t.norms) sum.set(p, (sum.get(p) ?? 0n) + q);
  const lines = [...sum].filter(([, q]) => q > 0n).map(([productId, q]) => ({ productId, qty: fmt(q, 3) }));
  if (!lines.length) throw new DomainError(422, 'nothing_to_fill', 'The releases of the period have no materials in their norms');
  await updateDocument(db, ctx, id, { lines: await toLineInputs(db, await keepLineIds(db, id, lines)) });
}

/** «Заполнить по остатку цеха»: остаток склада списания на конец периода по материалам норм выпусков периода */
export async function fillAllocationByStock(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const { doc, header } = await loadAllocation(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  if (!doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse for the materials first');
  const targets = await loadTargets(db, doc.workCenterId!, header.periodFrom, header.periodTo, id);
  if (!targets.length) throw new DomainError(422, 'no_releases', 'There are no shift-mode releases of this work center in the period');
  const productIds = [...new Set(targets.flatMap(t => [...t.norms.keys()]))];
  if (!productIds.length) throw new DomainError(422, 'nothing_to_fill', 'The releases of the period have no materials in their norms');
  const rows = await db
    .select({ productId: stockMoves.productId, qty: sql<string>`coalesce(sum(${stockMoves.qty}), 0)::text` })
    .from(stockMoves)
    .where(and(eq(stockMoves.warehouseId, doc.warehouseId), inArray(stockMoves.productId, productIds), lte(stockMoves.movedAt, header.periodTo)))
    .groupBy(stockMoves.productId);
  const lines = rows.filter(r => dec(r.qty) > 0n).map(r => ({ productId: r.productId, qty: fmt(dec(r.qty), 3) }));
  if (!lines.length) throw new DomainError(422, 'nothing_to_fill', 'The warehouse has no stock of these materials at the end of the period');
  await updateDocument(db, ctx, id, { lines: await toLineInputs(db, await keepLineIds(db, id, lines)) });
}

/** Существующие строки с тем же товаром сохраняют id (ссылки потомков остаются на месте) */
async function keepLineIds(db: Db, id: string, lines: AllocationLineInput[]): Promise<AllocationLineInput[]> {
  const old = await db.select({ id: documentLines.id, productId: documentLines.productId }).from(documentLines).where(eq(documentLines.documentId, id));
  const byProduct = new Map(old.map(o => [o.productId, o.id]));
  return lines.map(l => ({ ...l, id: byProduct.get(l.productId) }));
}

/** Карточка: шапка, материалы, выпуски периода и результат (у проведённого — записанный, у черновика — расчёт количеств) */
export async function allocationDetail(db: Db, id: string) {
  const { doc, header } = await loadAllocation(db, id);
  const [wc] = doc.workCenterId ? await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(eq(workCenters.id, doc.workCenterId)).limit(1) : [];
  const [wh] = doc.warehouseId ? await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, doc.warehouseId)).limit(1) : [];
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, id)).orderBy(asc(documentLines.sortOrder));
  const posted = doc.status === 'posted';
  const savedRows = await db.select().from(materialAllocationRows).where(eq(materialAllocationRows.documentId, id)).orderBy(asc(materialAllocationRows.sortOrder));
  // выпуски: у проведённого — те, что вошли в результат, у черновика — подходящие под период
  let targets: ReleaseTarget[];
  if (posted) {
    const itemIds = [...new Set(savedRows.map(r => r.releaseItemId))];
    targets = itemIds.length ? await loadPostedTargets(db, itemIds) : [];
  } else targets = doc.workCenterId ? await loadTargets(db, doc.workCenterId, header.periodFrom, header.periodTo, id) : [];
  const productIds = [...new Set([...lines.map(l => l.productId), ...savedRows.map(r => r.productId)])];
  const names = new Map((productIds.length ? await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds)) : []).map(p => [p.id, p.name]));
  let result: { releaseId: string; releaseItemId: string; productId: string; qty: string; cost: string | null }[];
  if (posted) result = savedRows.map(r => ({ releaseId: r.releaseId, releaseItemId: r.releaseItemId, productId: r.productId, qty: r.qty, cost: r.cost }));
  else {
    const shares = allocateShiftMaterials(materialsOf(lines), toShiftTargets(targets));
    const targetOf = new Map(targets.map(t => [t.itemId, t]));
    result = shares.map(s => ({ releaseId: targetOf.get(s.targetId)!.releaseId, releaseItemId: s.targetId, productId: s.materialKey, qty: fmt(s.qty, 6), cost: null }));
  }
  const targetById = new Map(targets.map(t => [t.itemId, t]));
  return {
    ...doc,
    workCenter: wc ?? null,
    warehouse: wh ?? null,
    periodFrom: header.periodFrom,
    periodTo: header.periodTo,
    lines: lines.map(l => ({ id: l.id, productId: l.productId, name: l.name, unitCode: l.unitCode, qty: l.qty })),
    releases: targets.map(t => ({ itemId: t.itemId, releaseId: t.releaseId, number: t.releaseNumber, date: t.releaseDate, name: t.name, qty: fmt(t.qty, 3) })),
    result: result.map(r => ({ ...r, productName: names.get(r.productId) ?? '', releaseNumber: targetById.get(r.releaseItemId)?.releaseNumber ?? null, itemName: targetById.get(r.releaseItemId)?.name ?? '' })),
  };
}

/** Позиции проведённых выпусков по идентификаторам (карточка проведённого распределения) */
async function loadPostedTargets(db: Db, itemIds: string[]): Promise<ReleaseTarget[]> {
  const rows = await db
    .select({ itemId: productionItems.id, releaseId: documents.id, number: documents.number, date: documents.date, qty: productionItems.qty, name: manufacturedItems.name, overheadPct: manufacturedItems.overheadPct })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionItems.itemId))
    .where(inArray(productionItems.id, itemIds))
    .orderBy(asc(documents.date), asc(productionItems.sortOrder));
  return rows.map(i => ({ itemId: i.itemId, releaseId: i.releaseId, releaseNumber: i.number, releaseDate: i.date, name: i.name, qty: dec(i.qty), overheadPct: dec(i.overheadPct), norms: new Map(), plannedCost: 0n }));
}

/** Журнал распределений */
export async function listMaterialAllocations(db: Db, workspaceId: string, params: { from?: string; to?: string; q?: string; limit: number; offset: number }) {
  const conds = [
    eq(documents.workspaceId, workspaceId),
    eq(documents.type, 'material_allocation'),
    params.from ? gte(documents.date, params.from) : undefined,
    params.to ? lte(documents.date, params.to) : undefined,
    params.q ? sql`${documents.comment} ilike ${'%' + params.q + '%'}` : undefined,
  ];
  const rows = await db
    .select({ doc: documents, periodFrom: materialAllocations.periodFrom, periodTo: materialAllocations.periodTo, workCenterName: workCenters.name })
    .from(documents)
    .leftJoin(materialAllocations, eq(materialAllocations.documentId, documents.id))
    .leftJoin(workCenters, eq(workCenters.id, documents.workCenterId))
    .where(and(...conds))
    .orderBy(desc(documents.date), desc(documents.createdAt))
    .limit(params.limit)
    .offset(params.offset);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(...conds));
  return { items: rows.map(r => ({ ...r.doc, periodFrom: r.periodFrom, periodTo: r.periodTo, workCenterName: r.workCenterName })), total: Number(count?.n ?? 0) };
}

DOCUMENT_HOOKS.material_allocation = {
  check: async (db, _ctx, doc, lines) => {
    if (!doc.workCenterId) throw new DomainError(422, 'work_center_required', 'Select a work center before posting');
    if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one material before posting');
    if (!doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse for the materials before posting');
    const { header } = await loadAllocation(db, doc.id);
    const targets = await loadTargets(db, doc.workCenterId, header.periodFrom, header.periodTo, doc.id);
    if (!targets.length) throw new DomainError(422, 'no_releases', 'There are no shift-mode releases of this work center in the period');
  },
  post: async (db, ctx, doc, lines) => {
    const { header } = await loadAllocation(db, doc.id);
    const targets = await loadTargets(db, doc.workCenterId!, header.periodFrom, header.periodTo, doc.id);
    // 1. расход материалов со склада по средней (нехватка остатка — обычная ошибка остатков)
    await applyDocumentMoves(db, ctx, doc, lines);
    const unit = await documentLineCosts(db, doc.id);
    // 2. распределение по нормам: количество и стоимость (полная стоимость материала делится по долям количества)
    const materials = materialsOf(lines);
    const totalCost = new Map<string, Dec>();
    for (const l of lines) totalCost.set(l.productId, (totalCost.get(l.productId) ?? 0n) + mul(dec(l.qty), dec(unit.get(l.id) ?? '0')));
    const shares = costShares(allocateShiftMaterials(materials, toShiftTargets(targets)), k => totalCost.get(k) ?? 0n);
    const lineOfProduct = new Map<string, string>();
    for (const l of lines) if (!lineOfProduct.has(l.productId)) lineOfProduct.set(l.productId, l.id);
    const targetOf = new Map(targets.map(t => [t.itemId, t]));
    if (shares.length)
      await db.insert(materialAllocationRows).values(
        shares.map((s, i) => ({ workspaceId: ctx.workspaceId, documentId: doc.id, releaseId: targetOf.get(s.targetId)!.releaseId, releaseItemId: s.targetId, productId: s.materialKey, documentLineId: lineOfProduct.get(s.materialKey) ?? null, qty: fmt(s.qty, 6), cost: fmt(s.cost, 4), sortOrder: i })),
      );
    // 3. прямые затраты позиций: материалы + накладные спецификации (в stage_cost и в alloc_cost)
    const byItem = new Map<string, Dec>();
    for (const s of shares) byItem.set(s.targetId, (byItem.get(s.targetId) ?? 0n) + s.cost);
    for (const [itemId, cost] of byItem) {
      const t = targetOf.get(itemId)!;
      const add = cost + pctOf(cost, t.overheadPct);
      await db
        .update(productionItems)
        .set({ allocCost: sql`${productionItems.allocCost} + ${fmt(add, 4)}`, stageCost: sql`coalesce(${productionItems.stageCost}, 0) + ${fmt(add, 4)}` })
        .where(eq(productionItems.id, itemId));
    }
    // 4. цепочка: приход продукции дорожает, отгруженное и следующий этап получают корректировку
    await recomputeStockCosts(db, ctx.workspaceId);
  },
  /** Результат уходит до возврата движений: пересчёт цепочки при откате расхода уже не увидит доли */
  beforeUnpost: async (db, _ctx, doc) => {
    const rows = await db.select().from(materialAllocationRows).where(eq(materialAllocationRows.documentId, doc.id));
    const byItem = new Map<string, Dec>();
    for (const r of rows) byItem.set(r.releaseItemId, (byItem.get(r.releaseItemId) ?? 0n) + dec(r.cost));
    if (byItem.size) {
      const items = await db.select({ id: productionItems.id, itemId: productionItems.itemId }).from(productionItems).where(inArray(productionItems.id, [...byItem.keys()]));
      const pct = new Map((await db.select({ id: manufacturedItems.id, p: manufacturedItems.overheadPct }).from(manufacturedItems).where(inArray(manufacturedItems.id, items.map(i => i.itemId)))).map(m => [m.id, dec(m.p)]));
      for (const it of items) {
        const cost = byItem.get(it.id)!;
        const sub = cost + pctOf(cost, pct.get(it.itemId) ?? 0n);
        await db
          .update(productionItems)
          .set({ allocCost: sql`${productionItems.allocCost} - ${fmt(sub, 4)}`, stageCost: sql`coalesce(${productionItems.stageCost}, 0) - ${fmt(sub, 4)}` })
          .where(eq(productionItems.id, it.id));
      }
    }
    await db.delete(materialAllocationRows).where(eq(materialAllocationRows.documentId, doc.id));
  },
  afterUnpost: async (db, ctx) => {
    await recomputeStockCosts(db, ctx.workspaceId);
  },
};
