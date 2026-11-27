/* Дополнительные расходы в себестоимость (задача 1385; «Дополнительные расходы» 1С УНФ).

   Документ — обычная запись `documents` типа `landed_cost` (номер, дата, статус, организация) плюс своя шапка
   `landed_costs` (способ распределения, контрагент-услуга, статья расходов, ссылка на счёт поставщика) и строки
   `landed_cost_lines` — доли по приходным строкам поступлений и выпусков продукции.

   Себестоимость: документ не пишет движений склада, а добавляет свою часть к цене прихода. Доли читает
   `recomputeStockCosts` (packages/db/src/stock.ts) из проведённых документов и складывает со своей частью закрытия
   месяца (`stock_cost_adjustments.own_delta`). Поэтому дорожает и остаток (средняя склада), и себестоимость уже
   списанного и отгруженного; отмена проведения возвращает прежние значения — пересчёт идёт по тем же правилам.

   Доли считает та же чистая функция, что и интерфейс (`allocateLandedCost`): копейки распределяются методом
   наибольших остатков, сумма долей строго равна сумме расходов. На единицу товара прибавка хранится с четырьмя
   знаками — так же, как цена движения (`stock_moves.cost`). */
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  allocateLandedCost,
  apportionKop,
  dec,
  fmt,
  fmtKop,
  isLandedCostBaseType,
  landedCostLineWeight,
  LANDED_COST_BASE_TYPES,
  manualLandedCostError,
  toKop,
  type LandedCostMethod,
} from '@erp/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { DOCUMENT_HOOKS } from './document-hooks';
import { recomputeStockCosts } from './stock';
import { createDocument, deleteDocument, updateDocument, type DocCtx, type DocumentPatch } from './documents';
import { companies, costItems, documents, documentLines, landedCostLines, landedCosts, organizations, products, stockMoves } from './schema';

/** Строка распределения в запросе: строка основания и (для ручного способа) её доля */
export interface LandedCostLineInput {
  id?: string;
  baseDocumentId: string;
  baseDocumentLineId: string;
  /** Доля строки; при способе «вручную» её вводит пользователь, иначе считает сервер */
  amount?: string | null;
}

export interface LandedCostInput {
  id?: string;
  organizationId?: string | null;
  date?: string;
  supplierId?: string | null;
  costItemId?: string | null;
  supplierDocumentId?: string | null;
  supplierDocument?: string;
  method?: LandedCostMethod;
  /** Общая сумма расходов; при способе «вручную» её даёт сумма строк */
  amount?: string | null;
  comment?: string;
  lines?: LandedCostLineInput[];
}

/** Снимок строки основания, по которому считается доля и цена единицы */
interface BaseLineSums {
  lineId: string;
  baseDocumentId: string;
  productId: string;
  qty: string;
  baseAmount: string;
  weight: string;
}

/* ---------------- основания ---------------- */

/** Документ-основание: проведённое поступление или выпуск продукции */
async function loadBaseDocuments(db: Db, workspaceId: string, ids: string[]) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map<string, { id: string; number: string | null; date: string; type: string; status: string; organizationId: string }>();
  const rows = await db
    .select({ id: documents.id, number: documents.number, date: documents.date, type: documents.type, status: documents.status, organizationId: documents.organizationId })
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), inArray(documents.id, uniq)));
  return new Map(rows.map(r => [r.id, r]));
}

/** Приходные строки документов-оснований: количество, стоимость строки и вес.
    Количество — факт прихода по строке из движений склада (у выпуска строка может дать два прихода: годное и брак),
    стоимость — сумма строки без НДС (у организации на УСН — с НДС, как она попала на склад), у выпуска — фактическая
    себестоимость прихода. Вес — количество × вес единицы товара из справочника. */
async function loadBaseLineSums(db: Db, workspaceId: string, baseDocumentIds: string[]): Promise<Map<string, BaseLineSums>> {
  const out = new Map<string, BaseLineSums>();
  const ids = [...new Set(baseDocumentIds)];
  if (!ids.length) return out;
  const docs = await loadBaseDocuments(db, workspaceId, ids);
  const tax = new Map(
    (await db.select({ id: organizations.id, taxSystem: organizations.taxSystem }).from(organizations).where(and(eq(organizations.workspaceId, workspaceId), inArray(organizations.id, [...new Set([...docs.values()].map(d => d.organizationId))])))).map(o => [o.id, o.taxSystem]),
  );
  const lines = await db
    .select({ id: documentLines.id, documentId: documentLines.documentId, productId: documentLines.productId, net: documentLines.net, total: documentLines.total })
    .from(documentLines)
    .where(and(eq(documentLines.workspaceId, workspaceId), inArray(documentLines.documentId, ids)))
    .orderBy(asc(documentLines.sortOrder));
  // приход по строкам: количество и его фактическая стоимость (для выпуска — единственный источник стоимости строки)
  const moved = await db
    .select({ lineId: stockMoves.documentLineId, qty: sql<string>`sum(${stockMoves.qty})`, amount: sql<string>`sum(${stockMoves.qty} * ${stockMoves.cost})` })
    .from(stockMoves)
    .where(and(eq(stockMoves.workspaceId, workspaceId), inArray(stockMoves.documentId, ids), sql`${stockMoves.qty} > 0`))
    .groupBy(stockMoves.documentLineId);
  const movedBy = new Map(moved.filter(m => m.lineId).map(m => [m.lineId!, { qty: dec(m.qty), amount: dec(m.amount) }]));
  const weights = new Map(
    (await db.select({ id: products.id, weightKg: products.weightKg }).from(products).where(and(eq(products.workspaceId, workspaceId), inArray(products.id, [...new Set(lines.map(l => l.productId))])))).map(p => [p.id, p.weightKg]),
  );
  for (const l of lines) {
    const mv = movedBy.get(l.id);
    if (!mv || mv.qty <= 0n) continue;
    const doc = docs.get(l.documentId);
    if (!doc) continue;
    // у поступления стоимость — сумма строки документа (точнее, чем цена движения с 4 знаками); у выпуска — фактический приход
    const baseAmount = doc.type === 'receipt' ? (tax.get(doc.organizationId) === 'usn' ? dec(l.total) : dec(l.net)) : mv.amount;
    out.set(l.id, {
      lineId: l.id,
      baseDocumentId: l.documentId,
      productId: l.productId,
      qty: fmt(mv.qty, 3),
      baseAmount: fmt(baseAmount, 2),
      weight: landedCostLineWeight(fmt(mv.qty, 3), weights.get(l.productId) ?? null),
    });
  }
  return out;
}

/** Проверка, что строка основания существует, относится к указанному документу и приход по ней есть */
function resolveLine(sums: Map<string, BaseLineSums>, input: LandedCostLineInput): BaseLineSums {
  const s = sums.get(input.baseDocumentLineId);
  if (!s) throw new DomainError(422, 'no_stock_moves', 'The base line has no goods received on the warehouse: additional costs cannot be applied to it');
  if (s.baseDocumentId !== input.baseDocumentId) throw new DomainError(422, 'invalid_reference', 'The line does not belong to the selected base document');
  return s;
}

/** Проверка оснований: проведённый документ разрешённого типа (поступление или выпуск) */
async function assertBases(db: Db, workspaceId: string, baseDocumentIds: string[]): Promise<void> {
  const docs = await loadBaseDocuments(db, workspaceId, baseDocumentIds);
  for (const id of baseDocumentIds) {
    const d = docs.get(id);
    if (!d) throw new DomainError(422, 'invalid_reference', 'The base document does not exist');
    if (!isLandedCostBaseType(d.type)) throw new DomainError(422, 'invalid_base_type', 'Additional costs can only be applied to a goods receipt or a production release');
    if (d.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the base document first: additional costs are applied to received goods');
  }
}

/* ---------------- строки распределения ---------------- */

/** Распределяет сумму по строкам оснований и перезаписывает строки документа.
    Снимки (количество, стоимость строки, вес) пересчитываются при каждом сохранении и проведении: если основание
    ещё правили черновиком, доли считаются по актуальным данным. Возвращает итог документа. */
async function writeAllocation(db: Db, ctx: DocCtx, documentId: string, method: LandedCostMethod, amount: string | null | undefined, inputs: LandedCostLineInput[]): Promise<string> {
  if (!inputs.length) throw new DomainError(422, 'no_lines', 'Add at least one base document line');
  const seen = new Set<string>();
  for (const l of inputs) {
    if (seen.has(l.baseDocumentLineId)) throw new DomainError(422, 'duplicate_base_line', 'The same base line is listed twice: sum its shares in one line');
    seen.add(l.baseDocumentLineId);
  }
  await assertBases(db, ctx.workspaceId, inputs.map(l => l.baseDocumentId));
  if (method !== 'manual' && toKop(amount ?? '0') <= 0n) throw new DomainError(422, 'invalid_amount', 'The total amount of additional costs must be greater than zero');
  const sums = await loadBaseLineSums(db, ctx.workspaceId, inputs.map(l => l.baseDocumentId));
  const rows = inputs.map(l => ({ id: l.baseDocumentLineId, ...resolveLine(sums, l), manualAmount: l.amount ?? null }));
  if (method === 'manual') {
    const err = manualLandedCostError(rows.map(r => ({ baseAmount: r.baseAmount, qty: r.qty, weight: r.weight, amount: r.manualAmount })));
    if (err === 'zero') throw new DomainError(422, 'invalid_amount', 'Every manual share is zero: enter the amount of at least one line');
    if (err === 'negative') throw new DomainError(422, 'invalid_amount', 'A share cannot be negative');
  }
  const allocation = allocateLandedCost({
    method,
    amount: method === 'manual' ? null : amount,
    lines: rows.map(r => ({ id: r.lineId, baseAmount: r.baseAmount, qty: r.qty, weight: r.weight, amount: r.manualAmount })),
  });
  // уникальный индекс (документ, строка основания) не даёт обновлять доли по одной — перезаписываем набор
  const keep = new Map(inputs.map(l => [l.baseDocumentLineId, l.id]));
  await db.delete(landedCostLines).where(and(eq(landedCostLines.workspaceId, ctx.workspaceId), eq(landedCostLines.documentId, documentId)));
  const shares = new Map(allocation.rows.map(r => [r.lineId, r]));
  await db.insert(landedCostLines).values(
    rows.map((r, i) => {
      const share = shares.get(r.lineId)!;
      const id = keep.get(r.lineId);
      return {
        ...(id ? { id } : {}),
        workspaceId: ctx.workspaceId,
        documentId,
        sortOrder: i,
        baseDocumentId: r.baseDocumentId,
        baseDocumentLineId: r.lineId,
        productId: r.productId,
        qty: r.qty,
        baseAmount: r.baseAmount,
        weight: r.weight,
        amount: share.amount,
      };
    }),
  );
  await writeTotals(db, documentId, allocation.total);
  return allocation.total;
}

/** Итог документа — сумма долей (НДС у доп. расходов не выделяется: сумма распределяется целиком) */
async function writeTotals(db: Db, documentId: string, total: string): Promise<void> {
  await db.update(documents).set({ amountNet: total, vatTotal: '0.00', total, updatedAt: new Date() }).where(eq(documents.id, documentId));
}

/* ---------------- шапка ---------------- */

/** Шапка предметной части документа: способ распределения, контрагент-услуга, статья, счёт поставщика */
async function saveHead(db: Db, ctx: DocCtx, documentId: string, input: LandedCostInput, method?: LandedCostMethod): Promise<void> {
  const [head] = await db.select().from(landedCosts).where(and(eq(landedCosts.workspaceId, ctx.workspaceId), eq(landedCosts.documentId, documentId))).limit(1);
  const values = {
    method: (method ?? input.method ?? (head?.method as LandedCostMethod) ?? 'by_amount') as LandedCostMethod,
    supplierId: input.supplierId !== undefined ? input.supplierId ?? null : (head?.supplierId ?? null),
    costItemId: input.costItemId !== undefined ? input.costItemId ?? null : (head?.costItemId ?? null),
    supplierDocumentId: input.supplierDocumentId !== undefined ? input.supplierDocumentId ?? null : (head?.supplierDocumentId ?? null),
    supplierDocument: input.supplierDocument !== undefined ? input.supplierDocument.trim().slice(0, 200) : (head?.supplierDocument ?? ''),
  };
  if (values.supplierId || values.costItemId || values.supplierDocumentId) await assertHeadRefs(db, ctx.workspaceId, values);
  await db
    .insert(landedCosts)
    .values({ workspaceId: ctx.workspaceId, documentId, ...values, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [landedCosts.workspaceId, landedCosts.documentId], set: { ...values, updatedAt: new Date() } });
}

/** Ссылки шапки: контрагент, статья расходов и документ поставщика должны существовать и принадлежать воркспейсу */
async function assertHeadRefs(db: Db, workspaceId: string, v: { supplierId: string | null; costItemId: string | null; supplierDocumentId: string | null }): Promise<void> {
  if (v.supplierId) {
    const [c] = await db.select({ id: companies.id, archivedAt: companies.archivedAt }).from(companies).where(and(eq(companies.workspaceId, workspaceId), eq(companies.id, v.supplierId))).limit(1);
    if (!c || c.archivedAt) throw new DomainError(422, 'invalid_reference', 'The supplier does not exist or is archived');
  }
  if (v.costItemId) {
    const [i] = await db.select({ id: costItems.id, kind: costItems.kind, archivedAt: costItems.archivedAt }).from(costItems).where(and(eq(costItems.workspaceId, workspaceId), eq(costItems.id, v.costItemId))).limit(1);
    if (!i || i.archivedAt) throw new DomainError(422, 'invalid_reference', 'The cost item does not exist or is archived');
    if (i.kind !== 'expense') throw new DomainError(422, 'cost_item_kind_mismatch', 'Additional costs need an expense cost item');
  }
  if (v.supplierDocumentId) {
    const [d] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, v.supplierDocumentId))).limit(1);
    if (!d) throw new DomainError(422, 'invalid_reference', 'The supplier document does not exist');
  }
}

/* ---------------- CRUD ---------------- */

/** Черновик «Дополнительных расходов»: шапка документа, шапка предметной части и распределение по строкам оснований */
export async function createLandedCost(db: Db, ctx: DocCtx, input: LandedCostInput): Promise<string> {
  const id = await createDocument(db, ctx, {
    ...(input.id ? { id: input.id } : {}),
    type: 'landed_cost',
    organizationId: input.organizationId ?? null,
    ...(input.date ? { date: input.date } : {}),
    comment: input.comment ?? '',
  });
  await saveHead(db, ctx, id, input, input.method ?? 'by_amount');
  await writeAllocation(db, ctx, id, input.method ?? 'by_amount', input.amount ?? null, input.lines ?? []);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'landed_cost' } });
  return id;
}

/** Правка черновика: отсутствующее поле не трогаем (undefined), пустое — очищаем (null) */
export async function updateLandedCost(db: Db, ctx: DocCtx, id: string, input: LandedCostInput): Promise<void> {
  const [doc] = await db.select({ id: documents.id, status: documents.status }).from(documents).where(and(eq(documents.workspaceId, ctx.workspaceId), eq(documents.id, id))).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'Additional costs document not found');
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Unpost the document before changing it');
  const patch: DocumentPatch = {};
  if (input.organizationId !== undefined) patch.organizationId = input.organizationId;
  if (input.date !== undefined) patch.date = input.date;
  if (input.comment !== undefined) patch.comment = input.comment;
  if (Object.keys(patch).length) await updateDocument(db, ctx, id, patch);
  const [head] = await db.select().from(landedCosts).where(and(eq(landedCosts.workspaceId, ctx.workspaceId), eq(landedCosts.documentId, id))).limit(1);
  const method = (input.method ?? (head?.method as LandedCostMethod) ?? 'by_amount') as LandedCostMethod;
  await saveHead(db, ctx, id, input, method);
  if (input.lines || input.method !== undefined || input.amount !== undefined) {
    // распределение пересчитывается целиком: строки, способ и сумма зависят друг от друга
    const lines = input.lines ?? (await readLineInputs(db, ctx.workspaceId, id));
    const amount = input.amount !== undefined ? input.amount : (await currentTotal(db, id));
    await writeAllocation(db, ctx, id, method, amount, lines);
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'landed_cost' } });
}

/** Текущие строки документа в формате входа (для пересчёта при смене способа или суммы) */
async function readLineInputs(db: Db, workspaceId: string, documentId: string): Promise<LandedCostLineInput[]> {
  const rows = await db.select().from(landedCostLines).where(and(eq(landedCostLines.workspaceId, workspaceId), eq(landedCostLines.documentId, documentId))).orderBy(asc(landedCostLines.sortOrder));
  return rows.map(r => ({ id: r.id, baseDocumentId: r.baseDocumentId, baseDocumentLineId: r.baseDocumentLineId, amount: r.amount }));
}

/** Сохранённый итог документа (сумма расходов) — из шапки документа */
async function currentTotal(db: Db, documentId: string): Promise<string> {
  const [d] = await db.select({ total: documents.total }).from(documents).where(eq(documents.id, documentId)).limit(1);
  return d?.total ?? '0.00';
}

/** Удаление черновика — общим кодом документов (строки и шапка уходят каскадом) */
export async function deleteLandedCost(db: Db, ctx: DocCtx, id: string): Promise<void> {
  await deleteDocument(db, ctx, id);
}

/** Журнал «Дополнительных расходов» */
export async function listLandedCosts(db: Db, workspaceId: string, params: { from?: string; to?: string; q?: string; limit: number; offset: number }) {
  const conds = [
    eq(documents.workspaceId, workspaceId),
    eq(documents.type, 'landed_cost'),
    params.from ? gte(documents.date, params.from) : undefined,
    params.to ? lte(documents.date, params.to) : undefined,
    params.q ? sql`(${documents.number} ilike ${'%' + params.q + '%'} or ${documents.comment} ilike ${'%' + params.q + '%'})` : undefined,
  ];
  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      date: documents.date,
      status: documents.status,
      total: documents.total,
      comment: documents.comment,
      method: landedCosts.method,
      supplierName: companies.name,
      costItemName: costItems.name,
      supplierDocument: landedCosts.supplierDocument,
    })
    .from(documents)
    .leftJoin(landedCosts, and(eq(landedCosts.workspaceId, workspaceId), eq(landedCosts.documentId, documents.id)))
    .leftJoin(companies, and(eq(companies.workspaceId, workspaceId), eq(companies.id, landedCosts.supplierId)))
    .leftJoin(costItems, and(eq(costItems.workspaceId, workspaceId), eq(costItems.id, landedCosts.costItemId)))
    .where(and(...conds))
    .orderBy(desc(documents.date), desc(documents.createdAt))
    .limit(params.limit)
    .offset(params.offset);
  const ids = rows.map(r => r.id);
  const lineRows = ids.length ? await db.select({ documentId: landedCostLines.documentId }).from(landedCostLines).where(and(eq(landedCostLines.workspaceId, workspaceId), inArray(landedCostLines.documentId, ids))) : [];
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(...conds));
  const [sum] = await db.select({ total: sql<string>`coalesce(sum(${documents.total}), 0)::text` }).from(documents).where(and(...conds));
  return {
    items: rows.map(r => ({ ...r, lineCount: lineRows.filter(l => l.documentId === r.id).length, total: r.total })),
    total: Number(count?.n ?? 0),
    amount: fmt(dec(sum?.total ?? '0'), 2),
  };
}

/** Карточка «Дополнительных расходов»: шапка, шапка предметной части и распределение по строкам оснований */
export async function landedCostDetail(db: Db, workspaceId: string, id: string) {
  const [doc] = await db.select().from(documents).where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, id))).limit(1);
  if (!doc || doc.type !== 'landed_cost') throw new DomainError(404, 'not_found', 'Additional costs document not found');
  const [head] = await db.select().from(landedCosts).where(and(eq(landedCosts.workspaceId, workspaceId), eq(landedCosts.documentId, id))).limit(1);
  const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.workspaceId, workspaceId), eq(organizations.id, doc.organizationId))).limit(1);
  const lines = await db.select().from(landedCostLines).where(and(eq(landedCostLines.workspaceId, workspaceId), eq(landedCostLines.documentId, id))).orderBy(asc(landedCostLines.sortOrder));
  const bases = await loadBaseDocuments(db, workspaceId, lines.map(l => l.baseDocumentId));
  const goods = new Map(
    (await db.select({ id: products.id, name: products.name, sku: products.sku, unitCode: products.unitCode, weightKg: products.weightKg }).from(products).where(and(eq(products.workspaceId, workspaceId), inArray(products.id, [...new Set(lines.map(l => l.productId))])))).map(p => [p.id, p]),
  );
  const [supplier] = head?.supplierId ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(and(eq(companies.workspaceId, workspaceId), eq(companies.id, head.supplierId))).limit(1) : [];
  const [costItem] = head?.costItemId ? await db.select({ id: costItems.id, name: costItems.name }).from(costItems).where(and(eq(costItems.workspaceId, workspaceId), eq(costItems.id, head.costItemId))).limit(1) : [];
  const [supplierDoc] = head?.supplierDocumentId
    ? await db.select({ id: documents.id, number: documents.number, date: documents.date, type: documents.type, total: documents.total }).from(documents).where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, head.supplierDocumentId))).limit(1)
    : [];
  // проценты долей — тем же методом наибольших остатков, что и суммы: сумма процентов равна 100.00
  const lineKop = lines.map(l => toKop(l.amount));
  const sharePcts = apportionKop(10_000n, lineKop);
  return {
    id: doc.id,
    number: doc.number,
    date: doc.date,
    status: doc.status,
    comment: doc.comment,
    organizationId: doc.organizationId,
    organizationName: org?.name ?? null,
    method: (head?.method as LandedCostMethod) ?? 'by_amount',
    supplierId: head?.supplierId ?? null,
    supplierName: supplier?.name ?? null,
    costItemId: head?.costItemId ?? null,
    costItemName: costItem?.name ?? null,
    supplierDocumentId: head?.supplierDocumentId ?? null,
    supplierDocument: head?.supplierDocument ?? '',
    supplierDocumentRef: supplierDoc ?? null,
    total: fmt(dec(doc.total), 2),
    lines: lines.map((l, i) => {
      const b = bases.get(l.baseDocumentId);
      const p = goods.get(l.productId);
      return {
        id: l.id,
        baseDocumentId: l.baseDocumentId,
        baseDocumentNumber: b?.number ?? null,
        baseDocumentDate: b?.date ?? null,
        baseDocumentType: b?.type ?? null,
        baseDocumentLineId: l.baseDocumentLineId,
        productId: l.productId,
        productName: p?.name ?? '',
        sku: p?.sku ?? '',
        unitCode: p?.unitCode ?? '796',
        qty: l.qty,
        baseAmount: l.baseAmount,
        weight: l.weight,
        amount: l.amount,
        sharePct: lineKop.some(k => k > 0n) ? fmtKop(sharePcts[i]!) : '0.00',
      };
    }),
  };
}

/* ---------------- основания для формы ---------------- */

/** Проведённые поступления и выпуски за период — из чего выбирают основание (со ссылкой на уже начисленные доп. расходы) */
export async function landedCostBases(db: Db, workspaceId: string, params: { from?: string; to?: string; type?: string; q?: string; limit: number }) {
  const types = params.type && isLandedCostBaseType(params.type) ? [params.type] : [...LANDED_COST_BASE_TYPES];
  const conds = [
    eq(documents.workspaceId, workspaceId),
    inArray(documents.type, types),
    eq(documents.status, 'posted'),
    params.from ? gte(documents.date, params.from) : undefined,
    params.to ? lte(documents.date, params.to) : undefined,
    params.q ? sql`(${documents.number} ilike ${'%' + params.q + '%'})` : undefined,
  ];
  const rows = await db
    .select({ id: documents.id, number: documents.number, date: documents.date, type: documents.type, total: documents.total, counterpartyName: companies.name })
    .from(documents)
    .leftJoin(companies, and(eq(companies.workspaceId, workspaceId), eq(companies.id, documents.counterpartyId)))
    .where(and(...conds))
    .orderBy(desc(documents.date), desc(documents.createdAt))
    .limit(params.limit);
  const ids = rows.map(r => r.id);
  if (!ids.length) return { items: [] };
  // уже отнесённые на документ доп. расходы (проведёнными документами): видно, что основание не «чистое»
  const applied = await db
    .select({ baseDocumentId: landedCostLines.baseDocumentId, amount: sql<string>`sum(${landedCostLines.amount})` })
    .from(landedCostLines)
    .innerJoin(documents, eq(documents.id, landedCostLines.documentId))
    .where(and(eq(landedCostLines.workspaceId, workspaceId), inArray(landedCostLines.baseDocumentId, ids), eq(documents.status, 'posted')))
    .groupBy(landedCostLines.baseDocumentId);
  const appliedBy = new Map(applied.map(a => [a.baseDocumentId, a.amount]));
  return { items: rows.map(r => ({ ...r, landedAmount: appliedBy.get(r.id) ?? null })) };
}

/** Приходные строки основания, на которые можно отнести доп. расходы: товар, количество прихода, стоимость, вес */
export async function landedCostBaseLines(db: Db, workspaceId: string, documentId: string) {
  const [doc] = await db.select({ id: documents.id, type: documents.type, status: documents.status, number: documents.number, date: documents.date }).from(documents).where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId))).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'Base document not found');
  if (!isLandedCostBaseType(doc.type)) throw new DomainError(422, 'invalid_base_type', 'Additional costs can only be applied to a goods receipt or a production release');
  if (doc.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the base document first: additional costs are applied to received goods');
  const sums = await loadBaseLineSums(db, workspaceId, [documentId]);
  const goods = new Map(
    (await db.select({ id: products.id, name: products.name, sku: products.sku, unitCode: products.unitCode, weightKg: products.weightKg }).from(products).where(and(eq(products.workspaceId, workspaceId), inArray(products.id, [...new Set([...sums.values()].map(s => s.productId))])))).map(p => [p.id, p]),
  );
  return {
    document: { id: doc.id, number: doc.number, date: doc.date, type: doc.type },
    lines: [...sums.values()].map(s => {
      const p = goods.get(s.productId);
      return { ...s, productName: p?.name ?? '', sku: p?.sku ?? '', unitCode: p?.unitCode ?? '796', weightKg: p?.weightKg ?? null };
    }),
  };
}

/* ---------------- отчёт ---------------- */

/** Отчёт по доп. расходам за период: документы, по статьям, по основаниям и по товарам (что подорожало) */
export async function landedCostReport(db: Db, workspaceId: string, from: string, to: string) {
  const docs = await db
    .select({
      id: documents.id,
      number: documents.number,
      date: documents.date,
      status: documents.status,
      total: documents.total,
      method: landedCosts.method,
      supplierName: companies.name,
      costItemId: landedCosts.costItemId,
      costItemName: costItems.name,
    })
    .from(documents)
    .leftJoin(landedCosts, and(eq(landedCosts.workspaceId, workspaceId), eq(landedCosts.documentId, documents.id)))
    .leftJoin(companies, and(eq(companies.workspaceId, workspaceId), eq(companies.id, landedCosts.supplierId)))
    .leftJoin(costItems, and(eq(costItems.workspaceId, workspaceId), eq(costItems.id, landedCosts.costItemId)))
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.type, 'landed_cost'), gte(documents.date, from), lte(documents.date, to)))
    .orderBy(desc(documents.date), desc(documents.createdAt));
  const ids = docs.map(d => d.id);
  if (!ids.length) return { from, to, documents: [], byCostItem: [], byBase: [], byProduct: [], total: '0.00', postedTotal: '0.00' };
  const lines = await db
    .select({ documentId: landedCostLines.documentId, baseDocumentId: landedCostLines.baseDocumentId, productId: landedCostLines.productId, qty: landedCostLines.qty, amount: landedCostLines.amount })
    .from(landedCostLines)
    .where(and(eq(landedCostLines.workspaceId, workspaceId), inArray(landedCostLines.documentId, ids)));
  const posted = new Map(docs.map(d => [d.id, d.status === 'posted']));
  const bases = await loadBaseDocuments(db, workspaceId, lines.map(l => l.baseDocumentId));
  const goods = new Map((await db.select({ id: products.id, name: products.name, sku: products.sku }).from(products).where(and(eq(products.workspaceId, workspaceId), inArray(products.id, [...new Set(lines.map(l => l.productId))])))).map(p => [p.id, p]));
  // в суммы идут только проведённые документы: черновик себестоимость не меняет
  const amountOf = (l: (typeof lines)[number]) => (posted.get(l.documentId) ? toKop(l.amount) : 0n);
  const byCostItem = new Map<string, { costItemId: string; name: string; amount: bigint }>();
  for (const d of docs) {
    if (!posted.get(d.id)) continue;
    const key = d.costItemId ?? '';
    const cur = byCostItem.get(key) ?? { costItemId: key, name: d.costItemName ?? '', amount: 0n };
    cur.amount += toKop(d.total);
    byCostItem.set(key, cur);
  }
  const byBase = new Map<string, { baseDocumentId: string; number: string | null; date: string; type: string; amount: bigint; linesCount: number }>();
  const byProduct = new Map<string, { productId: string; name: string; sku: string; qty: bigint; amount: bigint }>();
  for (const l of lines) {
    const b = bases.get(l.baseDocumentId);
    const cur = byBase.get(l.baseDocumentId) ?? { baseDocumentId: l.baseDocumentId, number: b?.number ?? null, date: b?.date ?? '', type: b?.type ?? '', amount: 0n, linesCount: 0 };
    cur.amount += amountOf(l);
    cur.linesCount += 1;
    byBase.set(l.baseDocumentId, cur);
    const p = goods.get(l.productId);
    const prod = byProduct.get(l.productId) ?? { productId: l.productId, name: p?.name ?? '', sku: p?.sku ?? '', qty: 0n, amount: 0n };
    prod.qty += dec(l.qty);
    prod.amount += amountOf(l);
    byProduct.set(l.productId, prod);
  }
  const totalKop = docs.reduce((s, d) => s + toKop(d.total), 0n);
  const postedKop = docs.filter(d => posted.get(d.id)).reduce((s, d) => s + toKop(d.total), 0n);
  return {
    from,
    to,
    documents: docs.map(d => ({ ...d, lineCount: lines.filter(l => l.documentId === d.id).length, total: fmt(dec(d.total), 2) })),
    byCostItem: [...byCostItem.values()].sort((a, b) => Number(b.amount - a.amount)).map(g => ({ ...g, amount: fmtKop(g.amount) })),
    byBase: [...byBase.values()].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0)).map(g => ({ ...g, amount: fmtKop(g.amount) })),
    byProduct: [...byProduct.values()].sort((a, b) => Number(b.amount - a.amount)).map(g => ({ ...g, qty: fmt(g.qty, 3), amount: fmtKop(g.amount) })),
    total: fmtKop(totalKop),
    postedTotal: fmtKop(postedKop),
  };
}

/* ---------------- проведение и отмена ---------------- */

DOCUMENT_HOOKS.landed_cost = {
  /** Проверки до проведения: строки распределения есть, основания проведены, приход по строкам есть */
  check: async (db, ctx, doc) => {
    const rows = await db.select({ id: landedCostLines.id, baseDocumentLineId: landedCostLines.baseDocumentLineId, baseDocumentId: landedCostLines.baseDocumentId }).from(landedCostLines).where(and(eq(landedCostLines.workspaceId, ctx.workspaceId), eq(landedCostLines.documentId, doc.id)));
    if (!rows.length) throw new DomainError(422, 'no_lines', 'Add at least one base document line before posting');
    await assertBases(db, ctx.workspaceId, rows.map(r => r.baseDocumentId));
    const sums = await loadBaseLineSums(db, ctx.workspaceId, rows.map(r => r.baseDocumentId));
    for (const r of rows) if (!sums.has(r.baseDocumentLineId)) throw new DomainError(422, 'no_stock_moves', 'The base line has no goods received on the warehouse: additional costs cannot be applied to it');
    // статья и контрагент могли быть архивированы после сохранения черновика
    const [head] = await db.select().from(landedCosts).where(and(eq(landedCosts.workspaceId, ctx.workspaceId), eq(landedCosts.documentId, doc.id))).limit(1);
    if (head) await assertHeadRefs(db, ctx.workspaceId, { supplierId: head.supplierId ?? null, costItemId: head.costItemId ?? null, supplierDocumentId: head.supplierDocumentId ?? null });
  },
  /** Проведение: распределение пересчитывается по актуальным данным оснований (их могли поправить после сохранения) */
  post: async (db, ctx, doc) => {
    const [head] = await db.select().from(landedCosts).where(and(eq(landedCosts.workspaceId, ctx.workspaceId), eq(landedCosts.documentId, doc.id))).limit(1);
    const inputs = await readLineInputs(db, ctx.workspaceId, doc.id);
    await writeAllocation(db, ctx, doc.id, ((head?.method as LandedCostMethod) ?? 'by_amount'), doc.total, inputs);
  },
  /** После проведения — пересчёт цепочки себестоимости: остаток и уже списанное дорожают на доли расходов */
  afterPost: async (db, ctx) => {
    await recomputeStockCosts(db, ctx.workspaceId);
  },
  /** Отмена проведения: документ перестаёт быть проведённым, пересчёт возвращает прежнюю себестоимость */
  afterUnpost: async (db, ctx) => {
    await recomputeStockCosts(db, ctx.workspaceId);
  },
};
