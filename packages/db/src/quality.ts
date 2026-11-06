/* Контроль качества (задача 1186): справочник причин брака, анализы партий (входной контроль),
   блокировка расхода с карантинного склада, переделка брака и статистика брака.
   Раздел docs/architecture/quality.md. ОТК выпуска опирается на брак задачи 1136
   (production_items.defect_qty / defect_mode), здесь добавляются причина, виновный и примечание. */
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { dec, div, fmt, mul, type Dec } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { batchAnalyses, defectReasons, documents, manufacturedItems, members, productionHeaders, productionItems, stockBatches, workCenters } from './schema';
import { createProductionOrder } from './production';
import type { DocCtx } from './documents';

/* ---------------- справочник причин брака ---------------- */

/* ---------------- переделка брака ---------------- */

/** Заказ на производство на переделку брака позиции проведённого выпуска: то же изделие, количество = брак (или его часть) */
export async function createReworkOrder(db: Db, ctx: DocCtx, releaseId: string, itemId: string, input: { date?: string; workCenterId?: string | null; qty?: string }): Promise<string> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, releaseId)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  if (doc.type !== 'production') throw new DomainError(422, 'invalid_type', 'Rework is created from a production release');
  if (doc.status !== 'posted') throw new DomainError(422, 'not_posted', 'Post the production release first');
  const [it] = await db.select().from(productionItems).where(and(eq(productionItems.workspaceId, ctx.workspaceId), eq(productionItems.id, itemId))).limit(1);
  if (!it || it.documentId !== releaseId) throw new DomainError(422, 'invalid_reference', 'The position does not belong to this document');
  const defect = dec(it.defectQty);
  if (defect <= 0n) throw new DomainError(422, 'no_defects', 'This position has no defects to rework');
  const qty = input.qty ? dec(input.qty) : defect;
  if (qty <= 0n || qty > defect) throw new DomainError(422, 'invalid_quantity', `Rework quantity must be between 0 and the defect quantity (${fmt(defect, 3)})`);
  const [header] = await db.select({ workCenterId: productionHeaders.workCenterId }).from(productionHeaders).where(eq(productionHeaders.documentId, releaseId)).limit(1);
  const workCenterId = input.workCenterId ?? header?.workCenterId ?? null;
  const [item] = await db.select({ name: manufacturedItems.name }).from(manufacturedItems).where(eq(manufacturedItems.id, it.itemId)).limit(1);
  // примечание — данные документа, как и демо-данные, по-русски
  const comment = `Переделка брака по выпуску ${doc.number ?? ''}: ${item?.name ?? ''}`.trim();
  return createProductionOrder(db, ctx, {
    workCenterId,
    ...(input.date ? { date: input.date } : {}),
    comment,
    items: [{ itemId: it.itemId, qty: fmt(qty, 3), ...(it.params ? { params: it.params } : {}) }],
  });
}

/* ---------------- статистика брака ---------------- */

export interface DefectReportRow {
  /** Участок (null — выпуск без участка) */
  workCenterId: string | null;
  workCenterName: string | null;
  /** Виновный сотрудник (null — виновный не указан) */
  memberId: string | null;
  memberName: string | null;
  /** Причина брака (null — не указана) */
  reasonId: string | null;
  reasonName: string | null;
  /** Брак, шт. */
  defectQty: string;
  /** Выпуск (годное + брак) за период по участку — база процента */
  releasedQty: string;
  /** Доля брака, % */
  defectPct: string;
}

export interface DefectReport {
  from: string;
  to: string;
  rows: DefectReportRow[];
}

/** Статистика брака за период: по участкам, виновным исполнителям и причинам (шт. и % от выпуска).
    Данные — проведённые выпуски финального этапа (как в отчёте «Выпуск»); строка без виновного
    и без причины группируется отдельно (member_id = null, reason_id = null). */
export async function defectReport(db: Db, workspaceId: string, q: { from: string; to: string; workCenterId?: string | undefined }): Promise<DefectReport> {
  if (q.from > q.to) throw new DomainError(422, 'report_period_invalid', 'The period start is after its end');
  const rows = await db
    .select({
      center: productionHeaders.workCenterId,
      member: productionItems.defectMemberId,
      reason: productionItems.defectReasonId,
      defect: sql<string>`sum(${productionItems.defectQty})`,
    })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .leftJoin(productionHeaders, and(eq(productionHeaders.workspaceId, workspaceId), eq(productionHeaders.documentId, documents.id)))
    .where(
      and(
        eq(productionItems.workspaceId, workspaceId),
        eq(documents.type, 'production'),
        eq(documents.status, 'posted'),
        gte(documents.date, q.from),
        lte(documents.date, q.to),
        q.workCenterId ? eq(productionHeaders.workCenterId, q.workCenterId) : undefined,
      ),
    )
    .groupBy(productionHeaders.workCenterId, productionItems.defectMemberId, productionItems.defectReasonId);
  // база процента — весь выпуск периода по участку (годное + брак)
  const totals = await db
    .select({ center: productionHeaders.workCenterId, released: sql<string>`sum(${productionItems.qty})` })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .leftJoin(productionHeaders, and(eq(productionHeaders.workspaceId, workspaceId), eq(productionHeaders.documentId, documents.id)))
    .where(
      and(
        eq(productionItems.workspaceId, workspaceId),
        eq(documents.type, 'production'),
        eq(documents.status, 'posted'),
        gte(documents.date, q.from),
        lte(documents.date, q.to),
        q.workCenterId ? eq(productionHeaders.workCenterId, q.workCenterId) : undefined,
      ),
    )
    .groupBy(productionHeaders.workCenterId);
  const centers = new Map((await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(eq(workCenters.workspaceId, workspaceId))).map(c => [c.id, c.name]));
  const memberNames = new Map((await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.workspaceId, workspaceId))).map(m => [m.id, m.name]));
  const reasonNames = new Map((await db.select({ id: defectReasons.id, name: defectReasons.name }).from(defectReasons).where(eq(defectReasons.workspaceId, workspaceId))).map(r => [r.id, r.name]));
  const base = new Map<string, Dec>(totals.map(t => [t.center ?? '', dec(t.released)]));
  const out: DefectReportRow[] = [];
  for (const r of rows) {
    const defect = dec(r.defect);
    if (defect <= 0n) continue; // строки без брака в отчёт не попадают, но участвуют в базе процента
    const released = base.get(r.center ?? '') ?? 0n;
    out.push({
      workCenterId: r.center,
      workCenterName: r.center ? (centers.get(r.center) ?? null) : null,
      memberId: r.member,
      memberName: r.member ? (memberNames.get(r.member) ?? null) : null,
      reasonId: r.reason,
      reasonName: r.reason ? (reasonNames.get(r.reason) ?? null) : null,
      defectQty: fmt(defect, 3),
      releasedQty: fmt(released, 3),
      defectPct: released > 0n ? fmt(div(mul(defect, 1000n), released), 1) : '0',
    });
  }
  out.sort((a, b) => (a.workCenterName ?? '').localeCompare(b.workCenterName ?? '') || (a.memberName ?? '').localeCompare(b.memberName ?? '') || (a.reasonName ?? '').localeCompare(b.reasonName ?? ''));
  return { from: q.from, to: q.to, rows: out };
}

/* ---------------- анализы партий (входной контроль) ---------------- */

/** Партия должна существовать в воркспейсе */
export async function assertBatch(db: Db, workspaceId: string, batchId: string): Promise<void> {
  const [b] = await db.select({ id: stockBatches.id }).from(stockBatches).where(and(eq(stockBatches.workspaceId, workspaceId), eq(stockBatches.id, batchId))).limit(1);
  if (!b) throw new DomainError(404, 'not_found', 'batch not found');
}

/** Список анализов партии */
export async function listBatchAnalyses(db: Db, workspaceId: string, batchId: string) {
  await assertBatch(db, workspaceId, batchId);
  const rows = await db
    .select({
      id: batchAnalyses.id,
      batchId: batchAnalyses.batchId,
      indicator: batchAnalyses.indicator,
      result: batchAnalyses.result,
      norm: batchAnalyses.norm,
      passed: batchAnalyses.passed,
      analyzedAt: batchAnalyses.analyzedAt,
      note: batchAnalyses.note,
      createdByName: members.name,
      createdAt: batchAnalyses.createdAt,
    })
    .from(batchAnalyses)
    .leftJoin(members, and(eq(members.workspaceId, workspaceId), eq(members.id, batchAnalyses.createdBy)))
    .where(and(eq(batchAnalyses.workspaceId, workspaceId), eq(batchAnalyses.batchId, batchId)))
    .orderBy(desc(batchAnalyses.analyzedAt), asc(batchAnalyses.createdAt));
  return rows;
}

/** Ввод анализа: за автора берётся текущий участник */
export async function createBatchAnalysis(db: Db, ctx: DocCtx, batchId: string, input: { id?: string; indicator: string; result?: string; norm?: string; passed?: boolean | null; analyzedAt?: string; note?: string }): Promise<string> {
  await assertBatch(db, ctx.workspaceId, batchId);
  const [row] = await db
    .insert(batchAnalyses)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      batchId,
      indicator: input.indicator,
      result: input.result ?? '',
      norm: input.norm ?? '',
      passed: input.passed ?? null,
      analyzedAt: input.analyzedAt ?? new Date().toISOString().slice(0, 10),
      createdBy: ctx.memberId,
      note: input.note ?? '',
    })
    .returning({ id: batchAnalyses.id });
  return row!.id;
}

/** Правка анализа */
export async function updateBatchAnalysis(db: Db, ctx: DocCtx, batchId: string, id: string, patch: { indicator?: string; result?: string; norm?: string; passed?: boolean | null; analyzedAt?: string; note?: string }): Promise<void> {
  const [row] = await db.select().from(batchAnalyses).where(and(eq(batchAnalyses.workspaceId, ctx.workspaceId), eq(batchAnalyses.batchId, batchId), eq(batchAnalyses.id, id))).limit(1).for('update');
  if (!row) throw new DomainError(404, 'not_found', 'analysis not found');
  await db
    .update(batchAnalyses)
    .set({
      ...(patch.indicator !== undefined ? { indicator: patch.indicator } : {}),
      ...(patch.result !== undefined ? { result: patch.result } : {}),
      ...(patch.norm !== undefined ? { norm: patch.norm } : {}),
      ...(patch.passed !== undefined ? { passed: patch.passed ?? null } : {}),
      ...(patch.analyzedAt !== undefined ? { analyzedAt: patch.analyzedAt } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      updatedAt: new Date(),
    })
    .where(eq(batchAnalyses.id, id));
}

/** Удаление анализа */
export async function deleteBatchAnalysis(db: Db, ctx: DocCtx, batchId: string, id: string): Promise<void> {
  const deleted = await db.delete(batchAnalyses).where(and(eq(batchAnalyses.workspaceId, ctx.workspaceId), eq(batchAnalyses.batchId, batchId), eq(batchAnalyses.id, id))).returning({ id: batchAnalyses.id });
  if (!deleted.length) throw new DomainError(404, 'not_found', 'analysis not found');
}

/* ---------------- статус партии ---------------- */

/** Смена статуса партии входного контроля (ok | quarantine | rejected) */
export async function setBatchStatus(db: Db, ctx: DocCtx, batchId: string, status: 'ok' | 'quarantine' | 'rejected'): Promise<void> {
  await assertBatch(db, ctx.workspaceId, batchId);
  await db.update(stockBatches).set({ status, updatedAt: new Date() }).where(and(eq(stockBatches.workspaceId, ctx.workspaceId), eq(stockBatches.id, batchId)));
}

/* ---------------- карантин ---------------- */

/** Проверка расхода с карантинного склада. Реализация — в quarantine.ts (лист, без циклических импортов):
    перемещение из карантина разрешено и снимает карантин. */
export { assertNoQuarantineOut, quarantineWarehouses } from './quarantine';
