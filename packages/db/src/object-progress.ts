/* Процент выполнения объекта и вехи (задача 1272, docs/architecture/construction.md).
   Процент не хранится: он считается на лету по способу объекта (`objects.progress_mode`) чистой функцией
   `computeObjectProgress` из @gr8r/shared — задачи объекта, объёмы согласованной сметы или ручное значение.
   Вехи — таблица `object_milestones`: этап (выполнение) или аванс (деньги вперёд), сумма или процент стоимости договора.
   Деньги вех (цена заказчику) видят все участники. Всё в транзакции вызывающего; изменение + событие — в одной транзакции. */
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import {
  computeObjectProgress,
  dec,
  estimateLineTotals,
  fmt,
  milestoneAmount,
  summarizeMilestones,
  type MilestoneKind,
  type ObjectMilestonesSummary,
  type ObjectProgressBase,
  type ObjectProgressMode,
} from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { objectEstimateItems, objectEstimates, objectMilestones, objects, tasks } from './schema';

export type ObjectMilestoneRow = typeof objectMilestones.$inferSelect;

/** Контекст записи: чей воркспейс и кто автор (для события) */
export interface MilestoneCtx {
  workspaceId: string;
  memberId: string | null;
}

/** Объект своего воркспейса и не в архиве: чужая или архивная карточка — 404 (как GET /objects/:id) */
async function assertLiveObject(db: Db, objectId: string): Promise<typeof objects.$inferSelect> {
  const [row] = await db.select().from(objects).where(eq(objects.id, objectId)).limit(1);
  if (!row || row.archivedAt) throw new DomainError(404, 'not_found', 'object not found');
  return row;
}

/* ---------------- процент выполнения ---------------- */

export interface ObjectProgressView {
  objectId: string;
  /** Способ расчёта */
  mode: ObjectProgressMode;
  /** Ручной процент 0–100 (только для режима manual) */
  progressManual: string | null;
  /** Процент с одним знаком после запятой; null — базы расчёта нет */
  percent: string | null;
  /** База расчёта: задачи и суммы согласованной сметы */
  base: ObjectProgressBase;
  /** Стоимость договора: согласованная основная смета и согласованные допработы без НДС; null — нет сметы */
  contractValue: string | null;
}

/** Позиции согласованной сметы объекта: основная согласованная и согласованные допработы */
async function approvedEstimateItems(db: Db, objectId: string): Promise<{ qty: string; price: string; doneQty: string }[] | null> {
  const rows = await db
    .select({ qty: objectEstimateItems.qty, price: objectEstimateItems.price, doneQty: objectEstimateItems.doneQty })
    .from(objectEstimateItems)
    .innerJoin(objectEstimates, and(eq(objectEstimates.workspaceId, objectEstimateItems.workspaceId), eq(objectEstimates.id, objectEstimateItems.estimateId)))
    .where(
      and(
        eq(objectEstimates.objectId, objectId),
        or(
          and(eq(objectEstimates.kind, 'main'), eq(objectEstimates.status, 'approved')),
          and(eq(objectEstimates.kind, 'change'), eq(objectEstimates.changeStatus, 'approved')),
        ),
      ),
    )
    .orderBy(asc(objectEstimates.kind), asc(objectEstimateItems.sortOrder));
  // нет ни одной согласованной сметы — базы для расчёта по объёмам нет
  if (!rows.length) return null;
  return rows;
}

/** Стоимость договора: сумма заказчику по согласованной смете и согласованным допработам без НДС; null — сметы нет */
export async function objectContractValue(db: Db, objectId: string): Promise<string | null> {
  const items = await approvedEstimateItems(db, objectId);
  if (!items) return null;
  let sum = 0n;
  for (const i of items) sum += dec(estimateLineTotals({ kind: 'work', qty: i.qty, price: i.price, costPrice: '0', laborHours: '0' }).revenue);
  return fmt(sum, 2);
}

/** Процент выполнения объекта по его способу расчёта */
export async function objectProgress(db: Db, objectId: string): Promise<ObjectProgressView> {
  const object = await assertLiveObject(db, objectId);
  const [taskRows, estimateItems, contractValue] = await Promise.all([
    db.select({ status: tasks.status, weight: tasks.weight }).from(tasks).where(and(eq(tasks.objectId, objectId), isNull(tasks.archivedAt))),
    approvedEstimateItems(db, objectId),
    objectContractValue(db, objectId),
  ]);
  const result = computeObjectProgress({
    mode: object.progressMode,
    manual: object.progressManual,
    tasks: taskRows,
    estimateItems,
  });
  return {
    objectId,
    mode: object.progressMode,
    progressManual: object.progressManual,
    percent: result.percent,
    base: result.base,
    contractValue,
  };
}

/* ---------------- вехи: чтение ---------------- */

/** Веха для интерфейса: сумма для отображения и отметки; «выставлено»/«оплачено» появятся с задачей 1273 */
export interface ObjectMilestoneView extends ObjectMilestoneRow {
  /** Сумма вехи: amount или pct × стоимость договора; null — у процента нет стоимости договора */
  value: string | null;
  /** Выставлено и оплачено — задача 1273 (акты и счета), здесь не хранятся */
  invoiced: null;
  paid: null;
}

export interface ObjectMilestonesView {
  objectId: string;
  /** Стоимость договора для вех-процентов */
  contractValue: string | null;
  items: ObjectMilestoneView[];
  summary: ObjectMilestonesSummary;
}

const toView = (row: ObjectMilestoneRow, contractValue: string | null): ObjectMilestoneView => ({
  ...row,
  value: milestoneAmount(row, contractValue),
  invoiced: null,
  paid: null,
});

/** Вехи объекта с суммой каждой и сводкой «выполнено / принято / выставлено / оплачено» (этапы и аванс отдельно) */
export async function objectMilestonesView(db: Db, objectId: string): Promise<ObjectMilestonesView> {
  await assertLiveObject(db, objectId);
  const [rows, contractValue] = await Promise.all([
    db.select().from(objectMilestones).where(eq(objectMilestones.objectId, objectId)).orderBy(asc(objectMilestones.sortOrder), asc(objectMilestones.id)),
    objectContractValue(db, objectId),
  ]);
  const summary = summarizeMilestones(rows, contractValue);
  return { objectId, contractValue, items: rows.map(r => toView(r, contractValue)), summary };
}

/* ---------------- вехи: запись ---------------- */

/** Ровно одно из amount/pct: undefined — не трогать, null — очистить (проверяется по объединённой строке) */
function assertAmountOrPct(amount: string | null, pct: string | null): void {
  if ((amount === null) === (pct === null)) throw new DomainError(422, 'milestone_amount_required', 'Set either a fixed amount or a percent of the contract value');
}

async function loadMilestone(db: Db, objectId: string, id: string, lock = false): Promise<ObjectMilestoneRow> {
  const query = db.select().from(objectMilestones).where(and(eq(objectMilestones.objectId, objectId), eq(objectMilestones.id, id))).limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new DomainError(404, 'not_found', 'milestone not found');
  return row;
}

async function nextSortOrder(db: Db, objectId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`coalesce(max(${objectMilestones.sortOrder}), -1) + 1` }).from(objectMilestones).where(eq(objectMilestones.objectId, objectId));
  return Number(row?.n ?? 0);
}

export interface MilestoneInput {
  id?: string | undefined;
  name: string;
  dueDate?: string | null | undefined;
  kind?: MilestoneKind | undefined;
  amount?: string | null | undefined;
  pct?: string | null | undefined;
  note?: string | undefined;
}

/** Новая веха: в конец списка; ровно одно из amount/pct */
export async function createObjectMilestone(db: Db, ctx: MilestoneCtx, objectId: string, input: MilestoneInput): Promise<ObjectMilestoneRow> {
  await assertLiveObject(db, objectId);
  const amount = input.amount ?? null;
  const pct = input.pct ?? null;
  assertAmountOrPct(amount, pct);
  const [row] = await db
    .insert(objectMilestones)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      objectId,
      sortOrder: await nextSortOrder(db, objectId),
      name: input.name.trim(),
      dueDate: input.dueDate ?? null,
      kind: input.kind ?? 'stage',
      amount,
      pct,
      note: input.note ?? '',
    })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_milestone.created', entity: 'object_milestone', recordId: row!.id, actorId: ctx.memberId, payload: { objectId, name: row!.name, kind: row!.kind } });
  return row!;
}

/** Правка вехи: undefined — не трогать, null — очистить. Отметки выполнено/принято — отдельными операциями */
export async function updateObjectMilestone(db: Db, ctx: MilestoneCtx, objectId: string, id: string, input: Partial<MilestoneInput>): Promise<ObjectMilestoneRow> {
  const existing = await loadMilestone(db, objectId, id, true);
  const set: Partial<typeof objectMilestones.$inferInsert> = { updatedAt: new Date() };
  const amount = input.amount !== undefined ? input.amount : existing.amount;
  const pct = input.pct !== undefined ? input.pct : existing.pct;
  assertAmountOrPct(amount, pct);
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.dueDate !== undefined) set.dueDate = input.dueDate;
  if (input.kind !== undefined) set.kind = input.kind;
  if (input.amount !== undefined) set.amount = input.amount;
  if (input.pct !== undefined) set.pct = input.pct;
  if (input.note !== undefined) set.note = input.note;
  const [row] = await db.update(objectMilestones).set(set).where(eq(objectMilestones.id, id)).returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_milestone.updated', entity: 'object_milestone', recordId: id, actorId: ctx.memberId, payload: { objectId, fields: Object.keys(input) } });
  return row!;
}

/** Удаление вехи */
export async function deleteObjectMilestone(db: Db, ctx: MilestoneCtx, objectId: string, id: string): Promise<void> {
  const row = await loadMilestone(db, objectId, id, true);
  await db.delete(objectMilestones).where(eq(objectMilestones.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_milestone.deleted', entity: 'object_milestone', recordId: id, actorId: ctx.memberId, payload: { objectId, name: row.name } });
}

/** Отметка «выполнено»: снятие отметки снимает и приёмку (принято только после выполнено) */
export async function setMilestoneDone(db: Db, ctx: MilestoneCtx, objectId: string, id: string, done: boolean): Promise<ObjectMilestoneRow> {
  const existing = await loadMilestone(db, objectId, id, true);
  const now = new Date();
  const [row] = await db
    .update(objectMilestones)
    .set(done ? { doneAt: existing.doneAt ?? now, updatedAt: now } : { doneAt: null, acceptedAt: null, updatedAt: now })
    .where(eq(objectMilestones.id, id))
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: done ? 'object_milestone.done' : 'object_milestone.undone', entity: 'object_milestone', recordId: id, actorId: ctx.memberId, payload: { objectId, name: existing.name } });
  return row!;
}

/** Отметка «принято заказчиком»: только по выполненной вехе (422 milestone_not_done) */
export async function setMilestoneAccepted(db: Db, ctx: MilestoneCtx, objectId: string, id: string, accepted: boolean): Promise<ObjectMilestoneRow> {
  const existing = await loadMilestone(db, objectId, id, true);
  if (accepted && !existing.doneAt) throw new DomainError(422, 'milestone_not_done', 'A milestone can be accepted only after it is done');
  const now = new Date();
  const [row] = await db
    .update(objectMilestones)
    .set({ acceptedAt: accepted ? (existing.acceptedAt ?? now) : null, updatedAt: now })
    .where(eq(objectMilestones.id, id))
    .returning();
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: accepted ? 'object_milestone.accepted' : 'object_milestone.unaccepted',
    entity: 'object_milestone',
    recordId: id,
    actorId: ctx.memberId,
    payload: { objectId, name: existing.name },
  });
  return row!;
}

/** Строка вехи из ответа (после записи) — с суммой для отображения */
export async function milestoneView(db: Db, objectId: string, row: ObjectMilestoneRow): Promise<ObjectMilestoneView> {
  return toView(row, await objectContractValue(db, objectId));
}
