/* Учёт времени и нормы работ (этап 2 сессии «УНФ: Услуги»).

   Время пишется на задачи модуля services (таблица time_logs не меняется), недельный табель сотрудника — отчёт
   по этим записям. Норма времени и участок по умолчанию живут в той же таблице operations, что и у операций
   производства: она 1:1 к товару каталога, вид товара задаёт смысл записи (operation — производство, work — услуги).

   Выставление клиенту выбирается в строке работы заказ-наряда: norm (количество × цена) или hours (фактические
   часы задач-назначений строки). Перед проведением заказ-наряда количество таких строк пересчитывается по часам.

   Правила — docs/architecture.md, раздел «Учёт времени и нормы работ». */
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { dec, fmt, type Dec } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { companies, documentLines, documents, members, operations, products, tasks, timeLogs, workCenters, workOrderAssignments, workOrderLines } from './schema';
import type { DocCtx } from './documents';

/* ---------------- нормы работ ---------------- */

export interface WorkNormView {
  productId: string;
  name: string;
  sku: string;
  unitCode: string;
  archived: boolean;
  /** Норма времени на единицу работы, ч */
  normHours: string;
  /** Участок по умолчанию */
  workCenterId: string | null;
}

/** Работы каталога с нормой времени и участком по умолчанию */
export async function listWorkNorms(db: Db, workspaceId: string): Promise<WorkNormView[]> {
  const rows = await db
    .select({ product: products, spec: operations })
    .from(products)
    .leftJoin(operations, and(eq(operations.productId, products.id), eq(operations.workspaceId, workspaceId)))
    .where(eq(products.kind, 'work'))
    .orderBy(asc(products.name));
  return rows.map(r => ({
    productId: r.product.id,
    name: r.product.name,
    sku: r.product.sku,
    unitCode: r.product.unitCode,
    archived: !!r.product.archivedAt,
    normHours: r.spec?.normHours ?? '0',
    workCenterId: r.spec?.workCenterId ?? null,
  }));
}

/** Норма времени и участок по умолчанию работы */
export async function setWorkNorm(db: Db, ctx: DocCtx, input: { productId: string; normHours: string; workCenterId?: string | null }): Promise<void> {
  const [p] = await db.select({ id: products.id, name: products.name, kind: products.kind, archivedAt: products.archivedAt }).from(products).where(eq(products.id, input.productId)).limit(1);
  if (!p || p.archivedAt) throw new DomainError(422, 'invalid_reference', 'The work does not exist');
  if (p.kind !== 'work') throw new DomainError(422, 'not_work', 'Only a product of the "work" kind can have a norm');
  if (dec(input.normHours) < 0n) throw new DomainError(422, 'invalid_norm', 'The norm cannot be negative');
  if (input.workCenterId) {
    const [wc] = await db.select({ id: workCenters.id }).from(workCenters).where(eq(workCenters.id, input.workCenterId)).limit(1);
    if (!wc) throw new DomainError(422, 'invalid_reference', 'The work center does not exist');
  }
  await db
    .insert(operations)
    .values({ workspaceId: ctx.workspaceId, productId: input.productId, normHours: input.normHours, workCenterId: input.workCenterId ?? null })
    .onConflictDoUpdate({ target: [operations.workspaceId, operations.productId], set: { normHours: input.normHours, workCenterId: input.workCenterId ?? null, updatedAt: new Date() } });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'operation.updated', entity: 'operation', recordId: input.productId, actorId: ctx.memberId, payload: { productId: input.productId } });
}

/** Норма времени и участок работы (пусто — нормы нет) */
export async function workNorm(db: Db, workspaceId: string, productId: string): Promise<{ normHours: string; workCenterId: string | null }> {
  const [row] = await db.select().from(operations).where(and(eq(operations.workspaceId, workspaceId), eq(operations.productId, productId))).limit(1);
  return { normHours: row?.normHours ?? '0', workCenterId: row?.workCenterId ?? null };
}

/* ---------------- время заказ-наряда ---------------- */

export interface WorkOrderTimeRow {
  assignmentId: string;
  taskId: string;
  taskKey: string;
  title: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  lineId: string | null;
  lineName: string | null;
  workCenterId: string | null;
  workCenterName: string | null;
  /** Плановые часы назначения */
  plannedHours: string;
  /** Фактические часы по журналу времени */
  actualHours: string;
}

export interface WorkOrderTimeView {
  assignments: WorkOrderTimeRow[];
  /** Строки работ: способ выставления и фактические часы */
  lines: { lineId: string; name: string; billing: 'norm' | 'hours'; actualHours: string }[];
  /** Итоги по исполнителям */
  members: { memberId: string | null; memberName: string | null; plannedHours: string; actualHours: string }[];
  totals: { plannedHours: string; actualHours: string };
}

/** Часы по назначениям заказ-наряда: план (planned_hours) и факт (time_logs) */
export async function workOrderTime(db: Db, documentId: string): Promise<WorkOrderTimeView> {
  const rows = await db
    .select({
      assignmentId: workOrderAssignments.id,
      taskId: workOrderAssignments.taskId,
      lineId: workOrderAssignments.lineId,
      workCenterId: workOrderAssignments.workCenterId,
      plannedHours: workOrderAssignments.plannedHours,
      taskKey: tasks.key,
      title: tasks.title,
      status: tasks.status,
      assigneeId: tasks.assigneeId,
      assigneeName: members.name,
      workCenterName: workCenters.name,
      lineName: documentLines.name,
    })
    .from(workOrderAssignments)
    .innerJoin(tasks, eq(tasks.id, workOrderAssignments.taskId))
    .leftJoin(members, eq(members.id, tasks.assigneeId))
    .leftJoin(workCenters, eq(workCenters.id, workOrderAssignments.workCenterId))
    .leftJoin(documentLines, eq(documentLines.id, workOrderAssignments.lineId))
    .where(eq(workOrderAssignments.documentId, documentId))
    .orderBy(asc(workOrderAssignments.createdAt));
  const taskIds = rows.map(r => r.taskId);
  const fact = new Map<string, Dec>();
  if (taskIds.length) {
    const logs = await db
      .select({ taskId: timeLogs.taskId, hours: sql<string>`coalesce(sum(${timeLogs.hours}), 0)::text` })
      .from(timeLogs)
      .where(inArray(timeLogs.taskId, taskIds))
      .groupBy(timeLogs.taskId);
    for (const l of logs) fact.set(l.taskId, dec(l.hours));
  }
  const assignments: WorkOrderTimeRow[] = rows.map(r => ({
    assignmentId: r.assignmentId,
    taskId: r.taskId,
    taskKey: r.taskKey,
    title: r.title,
    status: r.status,
    assigneeId: r.assigneeId,
    assigneeName: r.assigneeName,
    lineId: r.lineId,
    lineName: r.lineName,
    workCenterId: r.workCenterId,
    workCenterName: r.workCenterName,
    plannedHours: r.plannedHours ?? '0',
    actualHours: fmt(fact.get(r.taskId) ?? 0n, 3),
  }));
  // строки работ: способ выставления и фактические часы по ним (только работы — у них бывает выставление по часам)
  const lineRows = await db
    .select({ lineId: documentLines.id, name: documentLines.name, billing: workOrderLines.billing })
    .from(documentLines)
    .innerJoin(products, eq(products.id, documentLines.productId))
    .leftJoin(workOrderLines, and(eq(workOrderLines.lineId, documentLines.id), eq(workOrderLines.workspaceId, documentLines.workspaceId), eq(workOrderLines.documentId, documentId)))
    .where(and(eq(documentLines.documentId, documentId), eq(products.kind, 'work')))
    .orderBy(asc(documentLines.sortOrder));
  const lines = lineRows.map(l => ({
    lineId: l.lineId,
    name: l.name,
    billing: (l.billing ?? 'norm') as 'norm' | 'hours',
    actualHours: fmt(assignments.filter(a => a.lineId === l.lineId).reduce((s, a) => s + dec(a.actualHours), 0n), 3),
  }));
  // итоги по исполнителям
  const byMember = new Map<string, { memberId: string | null; memberName: string | null; planned: Dec; actual: Dec }>();
  for (const a of assignments) {
    const key = a.assigneeId ?? '';
    const cur = byMember.get(key) ?? { memberId: a.assigneeId, memberName: a.assigneeName, planned: 0n, actual: 0n };
    cur.planned += dec(a.plannedHours);
    cur.actual += dec(a.actualHours);
    byMember.set(key, cur);
  }
  const memberRows = [...byMember.values()].map(m => ({ memberId: m.memberId, memberName: m.memberName, plannedHours: fmt(m.planned, 3), actualHours: fmt(m.actual, 3) }));
  return {
    assignments,
    lines,
    members: memberRows,
    totals: {
      plannedHours: fmt(assignments.reduce((s, a) => s + dec(a.plannedHours), 0n), 3),
      actualHours: fmt(assignments.reduce((s, a) => s + dec(a.actualHours), 0n), 3),
    },
  };
}

/** Способ выставления строк работ заказ-наряда заменяется целиком */
export async function saveWorkOrderBilling(db: Db, ctx: DocCtx, documentId: string, inputs: { lineId: string; billing: 'norm' | 'hours' }[]): Promise<void> {
  const lines = inputs.length ? await db.select({ id: documentLines.id, documentId: documentLines.documentId, productId: documentLines.productId }).from(documentLines).where(inArray(documentLines.id, inputs.map(i => i.lineId))) : [];
  const byId = new Map(lines.map(l => [l.id, l]));
  const products_ = lines.length ? await db.select({ id: products.id, kind: products.kind }).from(products).where(inArray(products.id, [...new Set(lines.map(l => l.productId))])) : [];
  const kinds = new Map(products_.map(p => [p.id, p.kind]));
  const keep = new Set<string>();
  for (const i of inputs) {
    const line = byId.get(i.lineId);
    if (!line) throw new DomainError(422, 'invalid_reference', 'The line of the work order does not exist');
    if (line.documentId !== documentId) throw new DomainError(422, 'invalid_reference', 'The line belongs to another document');
    if (kinds.get(line.productId) !== 'work') throw new DomainError(422, 'not_work_line', 'Only a work line can be billed by hours');
    keep.add(i.lineId);
    await db
      .insert(workOrderLines)
      .values({ workspaceId: ctx.workspaceId, documentId, lineId: i.lineId, billing: i.billing })
      .onConflictDoUpdate({ target: [workOrderLines.workspaceId, workOrderLines.lineId], set: { billing: i.billing, updatedAt: new Date() } });
  }
  // строки, которых нет в списке, выставляются по норме (обычный способ)
  const current = await db.select({ lineId: workOrderLines.lineId }).from(workOrderLines).where(eq(workOrderLines.documentId, documentId));
  const drop = current.filter(c => !keep.has(c.lineId)).map(c => c.lineId);
  if (drop.length) await db.delete(workOrderLines).where(inArray(workOrderLines.lineId, drop));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: documentId, actorId: ctx.memberId, payload: { changes: { billing: { from: null, to: inputs.length } } } });
}

/** Фактические часы по строке работы: сумма времени задач-назначений строки */
export async function lineActualHours(db: Db, documentId: string, lineId: string): Promise<Dec> {
  const assignments = await db.select({ taskId: workOrderAssignments.taskId }).from(workOrderAssignments).where(and(eq(workOrderAssignments.documentId, documentId), eq(workOrderAssignments.lineId, lineId)));
  if (!assignments.length) return 0n;
  const logs = await db
    .select({ hours: sql<string>`coalesce(sum(${timeLogs.hours}), 0)::text` })
    .from(timeLogs)
    .where(inArray(timeLogs.taskId, assignments.map(a => a.taskId)));
  return dec(logs[0]?.hours ?? '0');
}

/** Пересчёт количества строк, выставляемых по фактическим часам (перед проведением заказ-наряда) */
export async function applyWorkOrderBilling(db: Db, documentId: string): Promise<void> {
  const rows = await db.select({ lineId: workOrderLines.lineId }).from(workOrderLines).where(and(eq(workOrderLines.documentId, documentId), eq(workOrderLines.billing, 'hours')));
  for (const row of rows) {
    const hours = await lineActualHours(db, documentId, row.lineId);
    if (hours <= 0n) throw new DomainError(422, 'no_hours_billed', 'There are no logged hours to bill this work line by');
    const qty = fmt(hours, 3);
    const [line] = await db.select({ id: documentLines.id, qty: documentLines.qty }).from(documentLines).where(eq(documentLines.id, row.lineId)).limit(1);
    if (!line) continue;
    if (line.qty !== qty) await db.update(documentLines).set({ qty }).where(eq(documentLines.id, row.lineId));
  }
}

/* ---------------- табель сотрудника ---------------- */

export interface TimesheetRow {
  logDate: string;
  hours: string;
  memberId: string;
  memberName: string;
  taskId: string;
  taskKey: string;
  title: string;
  /** Заказчик: контрагент заказ-наряда или заказчик задачи */
  companyId: string | null;
  companyName: string | null;
  /** Вид работ: товар строки заказ-наряда */
  workName: string | null;
  documentId: string | null;
  documentNumber: string | null;
}

/** Табель сотрудника: время по задачам модуля services за период (строки по заказчику и виду работ) */
export async function servicesTimesheet(db: Db, workspaceId: string, params: { memberId?: string; from?: string; to?: string }): Promise<{ items: TimesheetRow[]; totals: { hours: string; byMember: { memberId: string; memberName: string; hours: string }[] } }> {
  const conds = [
    eq(timeLogs.workspaceId, workspaceId),
    eq(tasks.module, 'services'),
    params.memberId ? eq(timeLogs.memberId, params.memberId) : undefined,
    params.from ? gte(timeLogs.logDate, params.from) : undefined,
    params.to ? lte(timeLogs.logDate, params.to) : undefined,
  ];
  const rows = await db
    .select({
      logDate: timeLogs.logDate,
      hours: timeLogs.hours,
      memberId: timeLogs.memberId,
      memberName: members.name,
      taskId: tasks.id,
      taskKey: tasks.key,
      title: tasks.title,
      taskCompanyId: tasks.companyId,
      documentId: documents.id,
      documentNumber: documents.number,
      counterpartyId: documents.counterpartyId,
      workName: documentLines.name,
    })
    .from(timeLogs)
    .innerJoin(tasks, and(eq(tasks.id, timeLogs.taskId), eq(tasks.workspaceId, timeLogs.workspaceId)))
    .innerJoin(members, eq(members.id, timeLogs.memberId))
    .leftJoin(workOrderAssignments, eq(workOrderAssignments.taskId, tasks.id))
    .leftJoin(documents, eq(documents.id, workOrderAssignments.documentId))
    .leftJoin(documentLines, eq(documentLines.id, workOrderAssignments.lineId))
    .where(and(...conds))
    .orderBy(asc(timeLogs.logDate), asc(timeLogs.createdAt));
  const companyIds = [...new Set(rows.map(r => r.taskCompanyId ?? r.counterpartyId).filter((x): x is string => !!x))];
  const names = companyIds.length ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, companyIds)) : [];
  const nameById = new Map(names.map(c => [c.id, c.name]));
  const items: TimesheetRow[] = rows.map(r => {
    const companyId = r.taskCompanyId ?? r.counterpartyId ?? null;
    return {
      logDate: r.logDate,
      hours: fmt(dec(r.hours), 3),
      memberId: r.memberId,
      memberName: r.memberName,
      taskId: r.taskId,
      taskKey: r.taskKey,
      title: r.title,
      companyId,
      companyName: companyId ? (nameById.get(companyId) ?? null) : null,
      workName: r.workName ?? null,
      documentId: r.documentId ?? null,
      documentNumber: r.documentNumber ?? null,
    };
  });
  const byMember = new Map<string, { memberId: string; memberName: string; hours: Dec }>();
  for (const r of items) {
    const cur = byMember.get(r.memberId) ?? { memberId: r.memberId, memberName: r.memberName, hours: 0n };
    cur.hours += dec(r.hours);
    byMember.set(r.memberId, cur);
  }
  return {
    items,
    totals: {
      hours: fmt(items.reduce((s, r) => s + dec(r.hours), 0n), 3),
      byMember: [...byMember.values()].map(m => ({ memberId: m.memberId, memberName: m.memberName, hours: fmt(m.hours, 3) })),
    },
  };
}
