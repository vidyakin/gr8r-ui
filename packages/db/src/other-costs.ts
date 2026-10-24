/* Документ «Прочие затраты» (этап 6) — ручной источник косвенных затрат месяца.

   У документа нет товаров и склада: строки — статья затрат, участок (необязателен) и сумма. Поэтому у него своя
   таблица строк `other_cost_lines`, как у производственных документов (`production_items` / `production_components`):
   строка документа — всегда товар каталога, а косвенной затрате товар не нужен.
   Проведение и нумерация — общие (хук типа в cost-closing.ts), закрытие периода забирает накопленные суммы. */
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { dec, fmt } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { otherCostsTotal } from './cost-closing';
import { createDocument, updateDocument, type DocCtx, type DocumentPatch } from './documents';
import { costItems, documents, investmentProjects, organizations, otherCostLines, workCenters } from './schema';

export interface OtherCostLineInput {
  id?: string;
  /** Статья затрат (обязательна) */
  costItemId: string;
  /** Участок: пусто — затрата идёт на общий выпуск */
  workCenterId?: string | null;
  amount: string;
  comment?: string;
}

export interface OtherCostsInput {
  id?: string;
  organizationId?: string | null;
  date?: string;
  investmentProjectId?: string | null;
  comment?: string;
  lines: OtherCostLineInput[];
}

/** Статьи должны быть расходными и неархивными, участки — существующими */
async function assertLines(db: Db, lines: OtherCostLineInput[]): Promise<void> {
  if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one cost line');
  const items = new Map(
    (await db.select({ id: costItems.id, kind: costItems.kind, archivedAt: costItems.archivedAt }).from(costItems).where(inArray(costItems.id, [...new Set(lines.map(l => l.costItemId))]))).map(i => [i.id, i]),
  );
  for (const l of lines) {
    const item = items.get(l.costItemId);
    if (!item || item.archivedAt) throw new DomainError(422, 'invalid_reference', 'The cost item does not exist or is archived');
    if (item.kind !== 'expense') throw new DomainError(422, 'cost_item_kind_mismatch', 'Other costs accept expense cost items only');
    if (dec(l.amount) <= 0n) throw new DomainError(422, 'invalid_amount', 'The amount must be greater than zero');
    if (l.workCenterId) {
      const [w] = await db.select({ id: workCenters.id, archivedAt: workCenters.archivedAt }).from(workCenters).where(eq(workCenters.id, l.workCenterId)).limit(1);
      if (!w || w.archivedAt) throw new DomainError(422, 'invalid_reference', 'The work center does not exist or is archived');
    }
  }
}

/** Строки документа сохраняются списком: существующие по id обновляются, новые добавляются, отсутствующие удаляются */
async function saveLines(db: Db, ctx: DocCtx, documentId: string, inputs: OtherCostLineInput[]): Promise<void> {
  await assertLines(db, inputs);
  const existing = await db.select({ id: otherCostLines.id }).from(otherCostLines).where(eq(otherCostLines.documentId, documentId));
  const existingIds = new Set(existing.map(e => e.id));
  const keep = new Set(inputs.map(l => l.id).filter((x): x is string => !!x));
  const drop = [...existingIds].filter(id => !keep.has(id));
  if (drop.length) await db.delete(otherCostLines).where(inArray(otherCostLines.id, drop));
  for (const [i, l] of inputs.entries()) {
    const values = { sortOrder: i, costItemId: l.costItemId, workCenterId: l.workCenterId ?? null, amount: fmt(dec(l.amount), 2), comment: l.comment?.trim() ?? '' };
    if (l.id && existingIds.has(l.id)) await db.update(otherCostLines).set(values).where(eq(otherCostLines.id, l.id));
    else await db.insert(otherCostLines).values({ ...values, workspaceId: ctx.workspaceId, documentId, ...(l.id ? { id: l.id } : {}) });
  }
}

/** Итоги документа — сумма строк (товаров и НДС у документа нет) */
async function writeTotals(db: Db, documentId: string): Promise<void> {
  const total = await otherCostsTotal(db, documentId);
  await db.update(documents).set({ amountNet: total, vatTotal: '0.00', total, updatedAt: new Date() }).where(eq(documents.id, documentId));
}

/** Черновик «Прочих затрат» */
export async function createOtherCosts(db: Db, ctx: DocCtx, input: OtherCostsInput): Promise<string> {
  const id = await createDocument(db, ctx, { ...(input.id ? { id: input.id } : {}), type: 'other_costs', organizationId: input.organizationId ?? null, date: input.date, investmentProjectId: input.investmentProjectId ?? null, comment: input.comment ?? '' });
  await saveLines(db, ctx, id, input.lines);
  await writeTotals(db, id);
  return id;
}

/** Правка черновика: шапка — общим кодом документов, строки — своей таблицей */
export async function updateOtherCosts(db: Db, ctx: DocCtx, id: string, input: Partial<OtherCostsInput>): Promise<void> {
  const patch: DocumentPatch = {};
  if (input.organizationId !== undefined) patch.organizationId = input.organizationId;
  if (input.date !== undefined) patch.date = input.date;
  if (input.investmentProjectId !== undefined) patch.investmentProjectId = input.investmentProjectId;
  if (input.comment !== undefined) patch.comment = input.comment;
  if (Object.keys(patch).length) await updateDocument(db, ctx, id, patch);
  if (input.lines) {
    await saveLines(db, ctx, id, input.lines);
    await writeTotals(db, id);
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'other_costs' } });
}

/** Карточка «Прочих затрат»: шапка, строки и итог */
export async function otherCostsDetail(db: Db, id: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc || doc.type !== 'other_costs') throw new DomainError(404, 'not_found', 'document not found');
  const [org] = doc.organizationId ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, doc.organizationId)).limit(1) : [];
  const lines = await db.select().from(otherCostLines).where(eq(otherCostLines.documentId, id)).orderBy(asc(otherCostLines.sortOrder));
  const items = new Map((await db.select({ id: costItems.id, name: costItems.name }).from(costItems).where(inArray(costItems.id, [...new Set(lines.map(l => l.costItemId))]))).map(i => [i.id, i.name]));
  const centers = new Map((await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(inArray(workCenters.id, [...new Set(lines.map(l => l.workCenterId).filter((x): x is string => !!x))]))).map(w => [w.id, w.name]));
  return {
    ...doc,
    organizationName: org?.name ?? null,
    investmentProject: doc.investmentProjectId ? ((await db.select({ id: investmentProjects.id, name: investmentProjects.name }).from(investmentProjects).where(eq(investmentProjects.id, doc.investmentProjectId)).limit(1))[0] ?? null) : null,
    lines: lines.map(l => ({ ...l, costItemName: items.get(l.costItemId) ?? '', workCenterName: l.workCenterId ? (centers.get(l.workCenterId) ?? null) : null })),
    total: await otherCostsTotal(db, id),
  };
}

/** Журнал «Прочих затрат» */
export async function listOtherCosts(db: Db, workspaceId: string, params: { from?: string; to?: string; q?: string; limit: number; offset: number }) {
  const conds = [
    eq(documents.workspaceId, workspaceId),
    eq(documents.type, 'other_costs'),
    params.from ? gte(documents.date, params.from) : undefined,
    params.to ? lte(documents.date, params.to) : undefined,
    params.q ? sql`(${documents.comment} ilike ${'%' + params.q + '%'} or exists (select 1 from other_cost_lines l where l.document_id = ${documents.id} and l.comment ilike ${'%' + params.q + '%'}))` : undefined,
  ];
  const rows = await db
    .select()
    .from(documents)
    .where(and(...conds))
    .orderBy(desc(documents.date), desc(documents.createdAt))
    .limit(params.limit)
    .offset(params.offset);
  const ids = rows.map(r => r.id);
  const lines = ids.length ? await db.select().from(otherCostLines).where(inArray(otherCostLines.documentId, ids)) : [];
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(...conds));
  const [sum] = await db.select({ total: sql<string>`coalesce(sum(${documents.total}), 0)::text` }).from(documents).where(and(...conds));
  return {
    items: rows.map(r => ({ ...r, lineCount: lines.filter(l => l.documentId === r.id).length })),
    total: Number(count?.n ?? 0),
    amount: fmt(dec(sum?.total ?? '0'), 2),
  };
}