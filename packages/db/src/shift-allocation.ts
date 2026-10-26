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
import { documentLines, documents, manufacturedItems, materialAllocationItems, materialAllocationRows, materialAllocations, productionComponents, productionHeaders, productionItems, products, stockMoves, warehouses, workCenters } from './schema';

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
  /** Начало периода; пусто — дата документа. Конец периода всегда равен дате документа */
  periodFrom?: string;
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

/** Позиции проведённых выпусков с нормами материалов: по условию отбора */
async function selectTargets(db: Db, cond: ReturnType<typeof and>): Promise<ReleaseTarget[]> {
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
    .where(cond)
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

/** Позиция уже вошла в другое проведённое распределение */
const inOtherPosted = (exceptDocId?: string) =>
  sql`exists (select 1 from material_allocation_items i join documents d on d.id = i.document_id where i.release_item_id = ${productionItems.id} and d.status = 'posted'${exceptDocId ? sql` and i.document_id <> ${exceptDocId}` : sql``})`;

/** Проведённые выпуски участка в режиме смены за период, ещё не вошедшие в другое проведённое распределение */
async function loadEligible(db: Db, workCenterId: string, from: string, to: string, exceptDocId?: string): Promise<ReleaseTarget[]> {
  return selectTargets(
    db,
    and(
      eq(documents.type, 'production'),
      eq(documents.status, 'posted'),
      eq(productionHeaders.workCenterId, workCenterId),
      eq(productionHeaders.materialMode, 'shift'),
      gte(documents.date, from),
      lte(documents.date, to),
      sql`not ${inOtherPosted(exceptDocId)}`,
    ),
  );
}

/** Позиции вкладки «Продукция» документа */
async function loadItems(db: Db, docId: string): Promise<ReleaseTarget[]> {
  const stored = await db.select({ itemId: materialAllocationItems.releaseItemId }).from(materialAllocationItems).where(eq(materialAllocationItems.documentId, docId)).orderBy(asc(materialAllocationItems.sortOrder));
  if (!stored.length) return [];
  const targets = await selectTargets(db, inArray(productionItems.id, stored.map(s => s.itemId)));
  const order = new Map(stored.map((s, i) => [s.itemId, i]));
  return targets.sort((a, b) => order.get(a.itemId)! - order.get(b.itemId)!);
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

/** Начало периода не позже даты документа (она же конец периода) */
function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError(422, 'invalid_period', 'The period start is after the document date');
}

/** Черновик документа «Распределение материалов»: окончание периода — дата документа, начало по умолчанию — она же */
export async function createMaterialAllocation(db: Db, ctx: DocCtx, input: AllocationInput): Promise<string> {
  const center = await assertCenter(db, input.workCenterId);
  const id = await createDocument(db, ctx, {
    ...(input.id ? { id: input.id } : {}),
    type: 'material_allocation',
    organizationId: null,
    workCenterId: input.workCenterId,
    warehouseId: input.warehouseId ?? center.warehouseId,
    date: input.date,
    comment: input.comment ?? '',
    lines: input.lines?.length ? await toLineInputs(db, input.lines) : undefined,
  });
  const [doc] = await db.select({ date: documents.date }).from(documents).where(eq(documents.id, id)).limit(1);
  const from = input.periodFrom ?? doc!.date;
  assertPeriod(from, doc!.date);
  await db.insert(materialAllocations).values({ workspaceId: ctx.workspaceId, documentId: id, periodFrom: from, periodTo: doc!.date });
  return id;
}

export interface AllocationPatch {
  workCenterId?: string;
  warehouseId?: string | null;
  date?: string;
  periodFrom?: string;
  comment?: string;
  lines?: AllocationLineInput[];
  /** Вкладка «Продукция» целиком */
  items?: { releaseItemId: string }[];
  /** Таблица «Распределение» целиком */
  rows?: { releaseItemId: string; productId: string; qty: string }[];
}

/** Правка черновика: шапка и период, материалы, продукция и распределение */
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
  const from = patch.periodFrom ?? header.periodFrom;
  const to = patch.date ?? doc.date;
  assertPeriod(from, to);
  if (Object.keys(docPatch).length) await updateDocument(db, ctx, id, docPatch);
  if (from !== header.periodFrom || to !== header.periodTo) await db.update(materialAllocations).set({ periodFrom: from, periodTo: to, updatedAt: new Date() }).where(eq(materialAllocations.documentId, id));
  if (patch.items) await saveItems(db, ctx, id, patch.items.map(i => i.releaseItemId));
  if (patch.rows) await saveRows(db, ctx, id, patch.rows);
}

/** Вкладка «Продукция» заменяется списком; строки распределения удалённых позиций уходят вместе с ними */
async function saveItems(db: Db, ctx: DocCtx, id: string, itemIds: string[]): Promise<void> {
  const unique = [...new Set(itemIds)];
  const found = unique.length ? await db.select({ id: productionItems.id, releaseId: productionItems.documentId }).from(productionItems).where(inArray(productionItems.id, unique)) : [];
  if (found.length !== unique.length) throw new DomainError(422, 'invalid_reference', 'A position of a release does not exist');
  const byId = new Map(found.map(f => [f.id, f.releaseId]));
  await db.delete(materialAllocationItems).where(eq(materialAllocationItems.documentId, id));
  if (unique.length) await db.insert(materialAllocationItems).values(unique.map((itemId, i) => ({ workspaceId: ctx.workspaceId, documentId: id, releaseId: byId.get(itemId)!, releaseItemId: itemId, sortOrder: i })));
  const rows = await db.select({ id: materialAllocationRows.id, itemId: materialAllocationRows.releaseItemId }).from(materialAllocationRows).where(eq(materialAllocationRows.documentId, id));
  const gone = rows.filter(r => !unique.includes(r.itemId)).map(r => r.id);
  if (gone.length) await db.delete(materialAllocationRows).where(inArray(materialAllocationRows.id, gone));
}

/** Таблица «Распределение» заменяется списком: только позиции вкладки «Продукция», нулевые количества не хранятся */
async function saveRows(db: Db, ctx: DocCtx, id: string, rows: { releaseItemId: string; productId: string; qty: string }[]): Promise<void> {
  const items = await db.select({ itemId: materialAllocationItems.releaseItemId, releaseId: materialAllocationItems.releaseId }).from(materialAllocationItems).where(eq(materialAllocationItems.documentId, id));
  const releaseOf = new Map(items.map(i => [i.itemId, i.releaseId]));
  const keep = rows.filter(r => dec(r.qty) !== 0n);
  for (const r of keep) {
    if (!releaseOf.has(r.releaseItemId)) throw new DomainError(422, 'allocation_row_invalid', 'The distribution refers to a product that is not on the “Products” tab');
    if (dec(r.qty) < 0n) throw new DomainError(422, 'invalid_qty', 'The quantity cannot be negative');
  }
  const products_ = [...new Set(keep.map(r => r.productId))];
  if (products_.length) {
    const found = await db.select({ id: products.id }).from(products).where(inArray(products.id, products_));
    if (found.length !== products_.length) throw new DomainError(422, 'invalid_reference', 'A row refers to a product that does not exist');
  }
  await db.delete(materialAllocationRows).where(eq(materialAllocationRows.documentId, id));
  if (keep.length) await db.insert(materialAllocationRows).values(keep.map((r, i) => ({ workspaceId: ctx.workspaceId, documentId: id, releaseId: releaseOf.get(r.releaseItemId)!, releaseItemId: r.releaseItemId, productId: r.productId, qty: fmt(dec(r.qty), 6), cost: '0', sortOrder: i })));
}

/** Материалы по товарам из строк документа */
function materialsOf(lines: { productId: string; qty: string }[]): { key: string; qty: Dec }[] {
  const by = new Map<string, Dec>();
  for (const l of lines) by.set(l.productId, (by.get(l.productId) ?? 0n) + dec(l.qty));
  return [...by].map(([key, qty]) => ({ key, qty }));
}

function toShiftTargets(targets: ReleaseTarget[], method: 'norms' | 'qty'): ShiftTarget[] {
  // «по количеству»: без норм и плановой стоимости алгоритм делит пропорционально количеству выпуска
  return targets.map(t => ({ id: t.itemId, qty: t.qty, plannedCost: method === 'norms' ? t.plannedCost : 0n, norms: method === 'norms' ? t.norms : new Map<string, Dec>() }));
}

/** «Заполнить по выпуску»: вкладка «Продукция» — выпуски участка в режиме смены за период, не вошедшие в другое проведённое распределение */
export async function fillAllocationItems(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const { doc, header } = await loadAllocation(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  if (!doc.workCenterId) throw new DomainError(422, 'work_center_required', 'Select a work center first');
  const targets = await loadEligible(db, doc.workCenterId, header.periodFrom, doc.date, id);
  if (!targets.length) throw new DomainError(422, 'no_releases', 'There are no shift-mode releases of this work center in the period');
  await saveItems(db, ctx, id, targets.map(t => t.itemId));
}

/** «Распределить по нормативам / по количеству»: таблица «Распределение» считается по материалам и позициям вкладки «Продукция» */
export async function distributeAllocation(db: Db, ctx: DocCtx, id: string, method: 'norms' | 'qty'): Promise<void> {
  const { doc } = await loadAllocation(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  const lines = await db.select({ productId: documentLines.productId, qty: documentLines.qty }).from(documentLines).where(eq(documentLines.documentId, id));
  const targets = await loadItems(db, id);
  if (!targets.length) throw new DomainError(422, 'no_releases', 'Fill the “Products” tab first');
  if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one material first');
  const shares = allocateShiftMaterials(materialsOf(lines), toShiftTargets(targets, method));
  await saveRows(db, ctx, id, shares.map(s => ({ releaseItemId: s.targetId, productId: s.materialKey, qty: fmt(s.qty, 6) })));
}

/** «Заполнить по нормам»: сумма норм материалов позиций вкладки «Продукция» (строки заменяются) */
export async function fillAllocationByNorms(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const { doc } = await loadAllocation(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  const targets = await loadItems(db, id);
  if (!targets.length) throw new DomainError(422, 'no_releases', 'Fill the “Products” tab first');
  const sum = new Map<string, Dec>();
  for (const t of targets) for (const [p, q] of t.norms) sum.set(p, (sum.get(p) ?? 0n) + q);
  const lines = [...sum].filter(([, q]) => q > 0n).map(([productId, q]) => ({ productId, qty: fmt(q, 3) }));
  if (!lines.length) throw new DomainError(422, 'nothing_to_fill', 'The releases of the period have no materials in their norms');
  await updateDocument(db, ctx, id, { lines: await toLineInputs(db, await keepLineIds(db, id, lines)) });
}

/** «Заполнить по остатку цеха»: остаток склада списания на конец периода по материалам норм позиций вкладки «Продукция» */
export async function fillAllocationByStock(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const { doc } = await loadAllocation(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  if (!doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse for the materials first');
  const targets = await loadItems(db, id);
  if (!targets.length) throw new DomainError(422, 'no_releases', 'Fill the “Products” tab first');
  const productIds = [...new Set(targets.flatMap(t => [...t.norms.keys()]))];
  if (!productIds.length) throw new DomainError(422, 'nothing_to_fill', 'The releases of the period have no materials in their norms');
  const rows = await db
    .select({ productId: stockMoves.productId, qty: sql<string>`coalesce(sum(${stockMoves.qty}), 0)::text` })
    .from(stockMoves)
    .where(and(eq(stockMoves.warehouseId, doc.warehouseId), inArray(stockMoves.productId, productIds), lte(stockMoves.movedAt, doc.date)))
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

/** Карточка: шапка, материалы, продукция и распределение (стоимость — после проведения) */
export async function allocationDetail(db: Db, id: string) {
  const { doc, header } = await loadAllocation(db, id);
  const [wc] = doc.workCenterId ? await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(eq(workCenters.id, doc.workCenterId)).limit(1) : [];
  const [wh] = doc.warehouseId ? await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, doc.warehouseId)).limit(1) : [];
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, id)).orderBy(asc(documentLines.sortOrder));
  const items = await loadItems(db, id);
  const rows = await db.select().from(materialAllocationRows).where(eq(materialAllocationRows.documentId, id)).orderBy(asc(materialAllocationRows.sortOrder));
  const productIds = [...new Set([...lines.map(l => l.productId), ...rows.map(r => r.productId)])];
  const names = new Map((productIds.length ? await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds)) : []).map(p => [p.id, p.name]));
  const itemOf = new Map(items.map(t => [t.itemId, t]));
  return {
    ...doc,
    workCenter: wc ?? null,
    warehouse: wh ?? null,
    periodFrom: header.periodFrom,
    periodTo: doc.date,
    lines: lines.map(l => ({ id: l.id, productId: l.productId, name: l.name, unitCode: l.unitCode, qty: l.qty })),
    items: items.map(t => ({ itemId: t.itemId, releaseId: t.releaseId, number: t.releaseNumber, date: t.releaseDate, name: t.name, qty: fmt(t.qty, 3) })),
    rows: rows.map(r => ({ id: r.id, releaseId: r.releaseId, releaseItemId: r.releaseItemId, productId: r.productId, productName: names.get(r.productId) ?? '', releaseNumber: itemOf.get(r.releaseItemId)?.releaseNumber ?? null, itemName: itemOf.get(r.releaseItemId)?.name ?? '', qty: r.qty, cost: doc.status === 'posted' ? r.cost : (null as string | null) })),
  };
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
    const targets = await loadItems(db, doc.id);
    if (!targets.length) throw new DomainError(422, 'no_releases', 'Fill the “Products” tab before posting');
    // каждая позиция: проведённый выпуск режима смены того же участка, дата в периоде, не в другом проведённом распределении
    const valid = new Set((await loadEligible(db, doc.workCenterId, header.periodFrom, doc.date, doc.id)).map(t => t.itemId));
    const bad = targets.filter(t => !valid.has(t.itemId));
    if (bad.length) throw new DomainError(422, 'release_not_allocatable', `The release is not suitable for this allocation: ${bad.map(b => b.releaseNumber ?? b.name).join(', ')}`, { items: bad.map(b => ({ itemId: b.itemId, number: b.releaseNumber, name: b.name })) });
  },
  post: async (db, ctx, doc, lines) => {
    const targets = await loadItems(db, doc.id);
    const targetOf = new Map(targets.map(t => [t.itemId, t]));
    // пустое распределение заполняется по нормативам
    const stored = await db.select({ id: materialAllocationRows.id }).from(materialAllocationRows).where(eq(materialAllocationRows.documentId, doc.id)).limit(1);
    if (!stored.length) await distributeAllocation(db, ctx, doc.id, 'norms');
    const rows = await db.select().from(materialAllocationRows).where(eq(materialAllocationRows.documentId, doc.id)).orderBy(asc(materialAllocationRows.sortOrder));
    // сумма по каждому материалу равна факту смены
    const fact = new Map(materialsOf(lines).map(m => [m.key, m.qty]));
    const sums = new Map<string, Dec>();
    for (const r of rows) {
      if (!targetOf.has(r.releaseItemId)) throw new DomainError(422, 'allocation_row_invalid', 'The distribution refers to a product that is not on the “Products” tab');
      sums.set(r.productId, (sums.get(r.productId) ?? 0n) + dec(r.qty));
    }
    const mismatch = [...new Set([...fact.keys(), ...sums.keys()])].filter(k => (fact.get(k) ?? 0n) !== (sums.get(k) ?? 0n));
    if (mismatch.length) {
      const names = new Map((await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, mismatch))).map(p => [p.id, p.name]));
      throw new DomainError(422, 'allocation_mismatch', `The distribution does not match the fact: ${mismatch.map(k => `${names.get(k) ?? k} (${fmt(sums.get(k) ?? 0n, 3)} of ${fmt(fact.get(k) ?? 0n, 3)})`).join(', ')}`, {
        products: mismatch.map(k => ({ productId: k, name: names.get(k) ?? '', distributed: fmt(sums.get(k) ?? 0n, 6), fact: fmt(fact.get(k) ?? 0n, 6) })),
      });
    }
    // 1. расход материалов со склада по средней (нехватка остатка — обычная ошибка остатков)
    await applyDocumentMoves(db, ctx, doc, lines);
    const unit = await documentLineCosts(db, doc.id);
    // 2. стоимость: полная стоимость материала делится по долям количества
    const totalCost = new Map<string, Dec>();
    for (const l of lines) totalCost.set(l.productId, (totalCost.get(l.productId) ?? 0n) + mul(dec(l.qty), dec(unit.get(l.id) ?? '0')));
    const shares = costShares(rows.map(r => ({ materialKey: r.productId, targetId: r.releaseItemId, qty: dec(r.qty) })), k => totalCost.get(k) ?? 0n);
    const lineOfProduct = new Map<string, string>();
    for (const l of lines) if (!lineOfProduct.has(l.productId)) lineOfProduct.set(l.productId, l.id);
    for (const [i, s] of shares.entries()) await db.update(materialAllocationRows).set({ cost: fmt(s.cost, 4), documentLineId: lineOfProduct.get(s.materialKey) ?? null }).where(eq(materialAllocationRows.id, rows[i]!.id));
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
  /** Доли уходят до возврата движений: пересчёт цепочки при откате расхода уже не увидит их стоимость; сами строки остаются (с нулевой стоимостью) */
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
    await db.update(materialAllocationRows).set({ cost: '0', documentLineId: null }).where(eq(materialAllocationRows.documentId, doc.id));
  },
  afterUnpost: async (db, ctx) => {
    await recomputeStockCosts(db, ctx.workspaceId);
  },
};
