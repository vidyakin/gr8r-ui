/* Планирование загрузки: справочник ключевых ресурсов, сменные графики, потребность в ресурсах и расчёт загрузки.
   Расчётные функции — чистые, в packages/shared/src/planning.ts; здесь — чтение и запись данных. */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  autoSchedule,
  computeHourlyLoad,
  computeLoad,
  dec,
  fmt,
  mul,
  zonedInstant,
  type BusyLoad,
  type CalendarDef,
  type CalendarException,
  type ExceptionsByScope,
  type HourlyEntry,
  type HourlyLoadResult,
  type HourlyRow,
  type LoadEntry,
  type LoadRow,
  type LoadRowResult,
  type LoadRowType,
  type ScheduleResult,
} from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import type { DocCtx } from './documents';
import { uuidv7 } from './uuid';
import { calendarExceptions, documentLines, documentResources, productResources, products, resources, workCalendars, workspaceHolidays } from './schema';
import { members } from './schema/people';
import { pieceworkLines, productionOperations, productionComponents, productionHeaders, productionStages, workCenters } from './schema/production';
import { tasks } from './schema/work';
import { workOrderAssignments } from './schema/services';
import { documents, workspaces } from './schema';

/* ---------------- справочники графиков ---------------- */

export interface CalendarRow {
  id: string;
  name: string;
  kind: 'weekly' | 'cycle';
  pattern: Record<string, unknown>;
  cycleStart: string | null;
  hoursPerDay: string;
  isDefault: boolean;
  note: string;
}

const toPattern = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Графики воркспейса */
export async function listCalendars(db: Db, workspaceId: string, includeArchived = false): Promise<CalendarRow[]> {
  const rows = await db
    .select()
    .from(workCalendars)
    .where(includeArchived ? eq(workCalendars.workspaceId, workspaceId) : and(eq(workCalendars.workspaceId, workspaceId), isNull(workCalendars.archivedAt)))
    .orderBy(asc(workCalendars.name));
  return rows.map(c => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    pattern: toPattern(c.pattern),
    cycleStart: c.cycleStart,
    hoursPerDay: c.hoursPerDay,
    isDefault: c.isDefault,
    note: c.note,
  }));
}

export interface CalendarInput {
  id?: string;
  name: string;
  kind: 'weekly' | 'cycle';
  pattern: Record<string, unknown>;
  cycleStart?: string | null;
  hoursPerDay: string;
  isDefault?: boolean;
  note?: string;
}

/** Создание или правка графика: график по умолчанию у воркспейса один */
export async function saveCalendar(db: Db, ctx: DocCtx, input: CalendarInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new DomainError(422, 'validation_error', 'The name is required');
  if (input.kind === 'cycle' && !input.cycleStart) throw new DomainError(422, 'cycle_start_required', 'Set the date the cycle starts from');
  const [same] = await db
    .select({ id: workCalendars.id })
    .from(workCalendars)
    .where(and(eq(workCalendars.workspaceId, ctx.workspaceId), sql`lower(${workCalendars.name}) = lower(${name})`, isNull(workCalendars.archivedAt)))
    .limit(1);
  if (same && same.id !== input.id) throw new DomainError(409, 'duplicate_name', `“${name}” already exists`);
  const id = input.id ?? uuidv7();
  if (input.isDefault) await db.update(workCalendars).set({ isDefault: false }).where(eq(workCalendars.workspaceId, ctx.workspaceId));
  if (input.id) {
    await db.update(workCalendars).set({ name, kind: input.kind, pattern: input.pattern, cycleStart: input.cycleStart ?? null, hoursPerDay: input.hoursPerDay, isDefault: !!input.isDefault, note: input.note ?? '', updatedAt: new Date() }).where(eq(workCalendars.id, id));
  } else {
    await db.insert(workCalendars).values({ id, workspaceId: ctx.workspaceId, name, kind: input.kind, pattern: input.pattern, cycleStart: input.cycleStart ?? null, hoursPerDay: input.hoursPerDay, isDefault: !!input.isDefault, note: input.note ?? '' });
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'work_calendar.updated', entity: 'work_calendar', recordId: id, actorId: ctx.memberId, payload: { name } });
  return id;
}

/** Архивирование графика */
export async function archiveCalendar(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const [row] = await db.select().from(workCalendars).where(eq(workCalendars.id, id)).limit(1);
  if (!row) throw new DomainError(404, 'not_found', 'The work calendar does not exist');
  await db.update(workCalendars).set({ archivedAt: new Date(), isDefault: false, updatedAt: new Date() }).where(eq(workCalendars.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'work_calendar.archived', entity: 'work_calendar', recordId: id, actorId: ctx.memberId, payload: { name: row.name } });
}

/** Праздники воркспейса */
export async function listHolidays(db: Db, workspaceId: string): Promise<{ date: string; name: string }[]> {
  const rows = await db.select().from(workspaceHolidays).where(eq(workspaceHolidays.workspaceId, workspaceId)).orderBy(asc(workspaceHolidays.date));
  return rows.map(h => ({ date: h.date, name: h.name }));
}

/** Добавить или убрать праздник */
export async function setHoliday(db: Db, ctx: DocCtx, date: string, name: string): Promise<void> {
  await db
    .insert(workspaceHolidays)
    .values({ workspaceId: ctx.workspaceId, date, name: name.trim() })
    .onConflictDoUpdate({ target: [workspaceHolidays.workspaceId, workspaceHolidays.date], set: { name: name.trim() } });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'work_calendar.updated', entity: 'work_calendar', recordId: null, actorId: ctx.memberId, payload: { holiday: date } });
}

/** Убрать праздник */
export async function removeHoliday(db: Db, ctx: DocCtx, date: string): Promise<void> {
  await db.delete(workspaceHolidays).where(and(eq(workspaceHolidays.workspaceId, ctx.workspaceId), eq(workspaceHolidays.date, date)));
}

/** Исключения из графика */
export async function listExceptions(db: Db, workspaceId: string): Promise<(typeof calendarExceptions.$inferSelect)[]> {
  return db.select().from(calendarExceptions).where(eq(calendarExceptions.workspaceId, workspaceId)).orderBy(asc(calendarExceptions.dateFrom));
}

/** Добавить исключение (отпуск, больничный, ремонт) */
export async function addException(db: Db, ctx: DocCtx, input: { scope: 'member' | 'work_center' | 'resource'; scopeId: string; dateFrom: string; dateTo: string; note?: string }): Promise<string> {
  if (input.dateTo < input.dateFrom) throw new DomainError(422, 'invalid_range', 'The end date is before the start date');
  const id = uuidv7();
  await db.insert(calendarExceptions).values({ id, workspaceId: ctx.workspaceId, scope: input.scope, scopeId: input.scopeId, dateFrom: input.dateFrom, dateTo: input.dateTo, note: input.note ?? '' });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'work_calendar.updated', entity: 'work_calendar', recordId: id, actorId: ctx.memberId, payload: { scope: input.scope } });
  return id;
}

/** Убрать исключение */
export async function removeException(db: Db, ctx: DocCtx, id: string): Promise<void> {
  await db.delete(calendarExceptions).where(and(eq(calendarExceptions.workspaceId, ctx.workspaceId), eq(calendarExceptions.id, id)));
}

/* ---------------- справочник ресурсов ---------------- */

export interface ResourceRow {
  id: string;
  code: string;
  name: string;
  kind: 'equipment' | 'other';
  workCenterId: string | null;
  capacityUnits: number;
  calendarId: string | null;
  note: string;
  archivedAt: Date | null;
}

/** Ключевые ресурсы воркспейса */
export async function listResources(db: Db, workspaceId: string, includeArchived = false): Promise<ResourceRow[]> {
  const rows = await db
    .select()
    .from(resources)
    .where(includeArchived ? eq(resources.workspaceId, workspaceId) : and(eq(resources.workspaceId, workspaceId), isNull(resources.archivedAt)))
    .orderBy(asc(resources.name));
  return rows.map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    workCenterId: r.workCenterId,
    capacityUnits: r.capacityUnits,
    calendarId: r.calendarId,
    note: r.note,
    archivedAt: r.archivedAt,
  }));
}

export interface ResourceInput {
  id?: string;
  code?: string;
  name: string;
  kind?: 'equipment' | 'other';
  workCenterId?: string | null;
  capacityUnits?: number;
  calendarId?: string | null;
  note?: string;
}

/** Создание или правка ресурса */
export async function saveResource(db: Db, ctx: DocCtx, input: ResourceInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new DomainError(422, 'validation_error', 'The name is required');
  const [same] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(and(eq(resources.workspaceId, ctx.workspaceId), sql`lower(${resources.name}) = lower(${name})`, isNull(resources.archivedAt)))
    .limit(1);
  if (same && same.id !== input.id) throw new DomainError(409, 'duplicate_name', `“${name}” already exists`);
  const values = {
    name,
    code: input.code ?? '',
    kind: input.kind ?? ('equipment' as const),
    workCenterId: input.workCenterId ?? null,
    capacityUnits: input.capacityUnits ?? 1,
    calendarId: input.calendarId ?? null,
    note: input.note ?? '',
  };
  const id = input.id ?? uuidv7();
  if (input.id) await db.update(resources).set({ ...values, updatedAt: new Date() }).where(eq(resources.id, id));
  else await db.insert(resources).values({ id, workspaceId: ctx.workspaceId, ...values });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'resource.updated', entity: 'resource', recordId: id, actorId: ctx.memberId, payload: { name } });
  return id;
}

/** Архивирование ресурса */
export async function archiveResource(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const [row] = await db.select().from(resources).where(eq(resources.id, id)).limit(1);
  if (!row) throw new DomainError(404, 'not_found', 'The resource does not exist');
  await db.update(resources).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(resources.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'resource.archived', entity: 'resource', recordId: id, actorId: ctx.memberId, payload: { name: row.name } });
}

/* ---------------- потребность в ресурсах ---------------- */

/** Норматив: у товара (операции или работы) — какие ресурсы и сколько часов на единицу */
export async function listProductResources(db: Db, productId: string): Promise<{ resourceId: string; name: string; hoursPerUnit: string }[]> {
  const rows = await db
    .select({ resourceId: productResources.resourceId, name: resources.name, hoursPerUnit: productResources.hoursPerUnit })
    .from(productResources)
    .innerJoin(resources, eq(resources.id, productResources.resourceId))
    .where(eq(productResources.productId, productId))
    .orderBy(asc(resources.name));
  return rows.map(r => ({ resourceId: r.resourceId, name: r.name, hoursPerUnit: r.hoursPerUnit }));
}

/** Норматив потребности в ресурсах: заменяется целиком */
export async function setProductResources(db: Db, ctx: DocCtx, productId: string, items: { resourceId: string; hoursPerUnit: string }[]): Promise<void> {
  await db.delete(productResources).where(and(eq(productResources.workspaceId, ctx.workspaceId), eq(productResources.productId, productId)));
  for (const i of items) {
    await db.insert(productResources).values({ workspaceId: ctx.workspaceId, productId, resourceId: i.resourceId, hoursPerUnit: i.hoursPerUnit });
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'product.updated', entity: 'product', recordId: productId, actorId: ctx.memberId, payload: { changes: ['resources'] } });
}

/** Ресурсы документа: закладка «Ресурсы» заказа на производство и заказ-наряда */
export async function listDocumentResources(db: Db, documentId: string): Promise<(typeof documentResources.$inferSelect)[]> {
  return db.select().from(documentResources).where(eq(documentResources.documentId, documentId)).orderBy(asc(documentResources.sortOrder));
}

/** Ресурсы документа заменяются целиком */
export async function setDocumentResources(
  db: Db,
  ctx: DocCtx,
  documentId: string,
  items: { id?: string; lineId?: string | null; resourceId: string; startAt?: string | null; endAt?: string | null; hours: string }[],
): Promise<void> {
  const [doc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'The document does not exist');
  await db.delete(documentResources).where(eq(documentResources.documentId, documentId));
  for (const [n, i] of items.entries()) {
    await db.insert(documentResources).values({
      id: i.id ?? uuidv7(),
      workspaceId: ctx.workspaceId,
      documentId,
      lineId: i.lineId ?? null,
      resourceId: i.resourceId,
      startAt: i.startAt ? new Date(i.startAt) : null,
      endAt: i.endAt ? new Date(i.endAt) : null,
      hours: i.hours,
      sortOrder: n,
    });
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: documentId, actorId: ctx.memberId, payload: { changes: ['resources'] } });
}

/* ---------------- загрузка ---------------- */

/** Графики, праздники и исключения воркспейса — контекст расчёта */
export interface CalendarContext {
  calendars: Map<string, CalendarDef>;
  /** График по умолчанию (графика воркспейса) */
  defaultCalendar: CalendarDef | null;
  holidays: string[];
  exceptions: CalendarException[];
  exceptionsByScope: ExceptionsByScope;
}

const toCalendarDef = (c: { id: string; kind: 'weekly' | 'cycle'; pattern: unknown; cycleStart: string | null; hoursPerDay: string }): CalendarDef => ({
  id: c.id,
  kind: c.kind,
  pattern: toPattern(c.pattern) as CalendarDef['pattern'],
  cycleStart: c.cycleStart,
  hoursPerDay: c.hoursPerDay,
});

/** Контекст графиков воркспейса */
export async function calendarContext(db: Db, workspaceId: string): Promise<CalendarContext> {
  const rows = await db.select().from(workCalendars).where(isNull(workCalendars.archivedAt));
  const calendars = new Map(rows.map(c => [c.id, toCalendarDef(c)]));
  const def = rows.find(c => c.isDefault) ?? null;
  const holidays = (await db.select({ date: workspaceHolidays.date }).from(workspaceHolidays).where(eq(workspaceHolidays.workspaceId, workspaceId))).map(h => h.date);
  const exceptions = await listExceptions(db, workspaceId);
  const exceptionsByScope: ExceptionsByScope = {};
  for (const e of exceptions) {
    const key = `${e.scope}:${e.scopeId}`;
    (exceptionsByScope[key] ||= []).push({ scope: e.scope, scopeId: e.scopeId, dateFrom: e.dateFrom, dateTo: e.dateTo });
  }
  return { calendars, defaultCalendar: def ? toCalendarDef(def) : null, holidays, exceptions, exceptionsByScope };
}

export interface LoadQuery {
  from: string;
  to: string;
  rowType: LoadRowType;
}

/** Строки загрузки: сотрудники, участки или ресурсы */
export async function loadRows(db: Db, workspaceId: string, rowType: LoadRowType, ctx: CalendarContext): Promise<LoadRow[]> {
  if (rowType === 'member') {
    const rows = await db.select().from(members).where(and(eq(members.workspaceId, workspaceId), eq(members.status, 'active'))).orderBy(asc(members.name));
    return rows.map(m => ({
      id: m.id,
      rowType: 'member' as const,
      name: m.name,
      capacityHoursPerDay: null,
      calendar: (m.calendarId ? ctx.calendars.get(m.calendarId) : null) ?? ctx.defaultCalendar,
    }));
  }
  if (rowType === 'work_center') {
    const rows = await db.select().from(workCenters).where(and(eq(workCenters.workspaceId, workspaceId), isNull(workCenters.archivedAt))).orderBy(asc(workCenters.name));
    return rows.map(w => ({
      id: w.id,
      rowType: 'work_center' as const,
      name: w.name,
      capacityHoursPerDay: w.capacityHoursPerDay,
      calendar: (w.calendarId ? ctx.calendars.get(w.calendarId) : null) ?? ctx.defaultCalendar,
    }));
  }
  const rows = await db.select().from(resources).where(and(eq(resources.workspaceId, workspaceId), isNull(resources.archivedAt))).orderBy(asc(resources.name));
  return rows.map(r => ({
    id: r.id,
    rowType: 'resource' as const,
    name: r.name,
    // единиц ресурса — умножение мощности на количество
    capacityHoursPerDay: (() => {
      const cal = (r.calendarId ? ctx.calendars.get(r.calendarId) : null) ?? ctx.defaultCalendar;
      const hours = cal ? Number(cal.hoursPerDay) : 8;
      return (hours * r.capacityUnits).toFixed(3);
    })(),
    calendar: (r.calendarId ? ctx.calendars.get(r.calendarId) : null) ?? ctx.defaultCalendar,
  }));
}

/** Записи загрузки: операции производства, назначения заказ-наряда и работы ресурсов */
export async function loadEntries(db: Db, workspaceId: string, from: string, to: string): Promise<LoadEntry[]> {
  const entries: LoadEntry[] = [];

  // операции производства: даты в назначении, часы — плановые нормочасы
  const ops = await db
    .select({
      id: productionOperations.id,
      memberId: productionOperations.memberId,
      workCenterId: productionOperations.workCenterId,
      hours: productionOperations.plannedHours,
      start: productionOperations.plannedStart,
      end: productionOperations.plannedEnd,
      taskTitle: tasks.title,
      documentId: productionOperations.documentId,
    })
    .from(productionOperations)
    .leftJoin(tasks, eq(tasks.id, productionOperations.taskId))
    .where(eq(productionOperations.workspaceId, workspaceId));
  for (const o of ops) {
    if (!o.start || !o.end) continue;
    if (o.end < from || o.start > to) continue;
    const title = o.taskTitle ?? 'Operation';
    if (o.memberId)
      entries.push({ id: `op:${o.id}:member`, kind: 'operation', title, rowType: 'member', rowId: o.memberId, start: o.start, end: o.end, hours: o.hours, documentId: o.documentId, memberId: o.memberId, workCenterId: o.workCenterId, assignmentId: o.id });
    if (o.workCenterId)
      entries.push({ id: `op:${o.id}:wc`, kind: 'operation', title, rowType: 'work_center', rowId: o.workCenterId, start: o.start, end: o.end, hours: o.hours, documentId: o.documentId, memberId: o.memberId, workCenterId: o.workCenterId, assignmentId: o.id });
  }

  // назначения заказ-наряда: даты — из задачи исполнителя
  const assignments = await db
    .select({
      id: workOrderAssignments.id,
      taskId: workOrderAssignments.taskId,
      assigneeId: tasks.assigneeId,
      start: tasks.startDate,
      end: tasks.dueDate,
      hours: tasks.planHours,
      title: tasks.title,
      documentId: workOrderAssignments.documentId,
    })
    .from(workOrderAssignments)
    .innerJoin(tasks, eq(tasks.id, workOrderAssignments.taskId))
    .where(eq(workOrderAssignments.workspaceId, workspaceId));
  for (const a of assignments) {
    if (!a.assigneeId || !a.start || !a.end) continue;
    if (a.end < from || a.start > to) continue;
    entries.push({ id: `as:${a.id}`, kind: 'assignment', title: a.title ?? 'Assignment', rowType: 'member', rowId: a.assigneeId, start: a.start, end: a.end, hours: a.hours ?? '0', documentId: a.documentId, memberId: a.assigneeId, taskId: a.taskId });
  }

  // ресурсы документов: интервал работы ресурса
  const docRes = await db
    .select({ id: documentResources.id, resourceId: documentResources.resourceId, startAt: documentResources.startAt, endAt: documentResources.endAt, hours: documentResources.hours, documentId: documentResources.documentId })
    .from(documentResources)
    .where(eq(documentResources.workspaceId, workspaceId));
  for (const d of docRes) {
    if (!d.startAt || !d.endAt) continue;
    const start = d.startAt.toISOString().slice(0, 10);
    const end = d.endAt.toISOString().slice(0, 10);
    if (end < from || start > to) continue;
    entries.push({ id: `res:${d.id}`, kind: 'resource', title: 'Resource', rowType: 'resource', rowId: d.resourceId, start, end, hours: d.hours, documentId: d.documentId, resourceId: d.resourceId });
  }
  return entries;
}

/** Загрузка воркспейса за период: строки, записи и расчёт по дням */
export async function workspaceLoad(
  db: Db,
  workspaceId: string,
  query: LoadQuery,
): Promise<{ rows: LoadRow[]; entries: LoadEntry[]; result: LoadRowResult[]; holidays: string[] }> {
  const ctx = await calendarContext(db, workspaceId);
  const rows = await loadRows(db, workspaceId, query.rowType, ctx);
  const entries = await loadEntries(db, workspaceId, query.from, query.to);
  const result = computeLoad(rows, entries, query.from, query.to, ctx.holidays, ctx.exceptionsByScope);
  return { rows, entries, result, holidays: ctx.holidays };
}

/* ---------------- автопланирование заказа ---------------- */

export interface ScheduleAssignmentView {
  id: string;
  operationName: string;
  memberId: string;
  memberName: string;
  workCenterId: string | null;
  stageId: string | null;
  stageOrder: number;
  plannedHours: string;
  start: string | null;
  end: string | null;
  scheduled: boolean;
}

/**
 * Автопланирование заказа на производство: операции расставляются от даты старта по порядку этапов
 * в пределах свободной мощности участков, сотрудников и ресурсов. Ручные даты не двигаются.
 */
export async function scheduleProductionOrder(db: Db, ctx: DocCtx, orderId: string): Promise<{ assignments: ScheduleAssignmentView[]; forecastEnd: string | null }> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, orderId)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'The document does not exist');
  if (doc.type !== 'production_order') throw new DomainError(422, 'invalid_type', 'This is not a production order');
  const [header] = await db.select().from(productionHeaders).where(eq(productionHeaders.documentId, orderId)).limit(1);
  const from = header?.plannedStart ? header.plannedStart.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  const assignments = await db.select().from(productionOperations).where(eq(productionOperations.documentId, orderId)).orderBy(asc(productionOperations.sortOrder));
  if (!assignments.length) throw new DomainError(422, 'no_operations', 'The order has no operations with executors');

  const calCtx = await calendarContext(db, ctx.workspaceId);
  const stageRows = await db.select().from(productionStages);
  const stageOrder = new Map(stageRows.map(s => [s.id, s.sortOrder]));

  // норматив потребности в ресурсах по операциям
  const componentById = new Map((await db.select().from(productionComponents).where(eq(productionComponents.documentId, orderId))).map(c => [c.id, c]));
  const productIds = [...new Set(assignments.map(a => a.operationId).filter((x): x is string => !!x))];
  const norms = productIds.length
    ? await db.select().from(productResources).where(inArray(productResources.productId, productIds))
    : [];
  const normByProduct = new Map<string, { resourceId: string; hoursPerUnit: string }[]>();
  for (const n of norms) {
    const list = normByProduct.get(n.productId) ?? [];
    list.push({ resourceId: n.resourceId, hoursPerUnit: n.hoursPerUnit });
    normByProduct.set(n.productId, list);
  }

  // строки загрузки, которые занимает заказ
  const memberIds = [...new Set(assignments.map(a => a.memberId))];
  const workCenterIds = [...new Set(assignments.map(a => a.workCenterId).filter((x): x is string => !!x))];
  const resourceIds = [...new Set([...normByProduct.values()].flat().map(n => n.resourceId))];
  const rows: LoadRow[] = [];
  if (memberIds.length) {
    const ms = await db.select().from(members).where(inArray(members.id, memberIds));
    for (const m of ms)
      rows.push({ id: m.id, rowType: 'member', name: m.name, capacityHoursPerDay: null, calendar: (m.calendarId ? calCtx.calendars.get(m.calendarId) : null) ?? calCtx.defaultCalendar });
  }
  if (workCenterIds.length) {
    const ws = await db.select().from(workCenters).where(inArray(workCenters.id, workCenterIds));
    for (const w of ws)
      rows.push({ id: w.id, rowType: 'work_center', name: w.name, capacityHoursPerDay: w.capacityHoursPerDay, calendar: (w.calendarId ? calCtx.calendars.get(w.calendarId) : null) ?? calCtx.defaultCalendar });
  }
  if (resourceIds.length) {
    const rs = await db.select().from(resources).where(inArray(resources.id, resourceIds));
    for (const r of rs) {
      const cal = (r.calendarId ? calCtx.calendars.get(r.calendarId) : null) ?? calCtx.defaultCalendar;
      const hours = cal ? Number(cal.hoursPerDay) : 8;
      rows.push({ id: r.id, rowType: 'resource', name: r.name, capacityHoursPerDay: (hours * r.capacityUnits).toFixed(3), calendar: cal });
    }
  }

  // занятая мощность другими заказами (операции этого заказа не учитываем)
  const otherEntries = (await loadEntries(db, ctx.workspaceId, from, addDaysLocal(from, 120))).filter(e => e.documentId !== orderId);
  // занятость по дням — тем же расчётом, что и загрузка (часы ложатся на рабочие дни строки)
  const busy: BusyLoad = {};
  for (const r of computeLoad(rows, otherEntries, from, addDaysLocal(from, 120), calCtx.holidays, calCtx.exceptionsByScope)) {
    const map: Record<string, string> = {};
    for (const d of r.days) if (dec(d.hours) > 0n) map[d.date] = d.hours;
    busy[r.rowId] = map;
  }

  const units = assignments.map(a => {
    const c = componentById.get(a.componentId);
    const normsFor = a.operationId ? (normByProduct.get(a.operationId) ?? []) : [];
    const demands: { rowId: string; hours: string }[] = [];
    if (a.memberId) demands.push({ rowId: a.memberId, hours: a.plannedHours });
    if (a.workCenterId) demands.push({ rowId: a.workCenterId, hours: a.plannedHours });
    for (const n of normsFor) demands.push({ rowId: n.resourceId, hours: (Number(n.hoursPerUnit) * Number(a.plannedQty)).toFixed(3) });
    return {
      id: a.id,
      stageOrder: a.stageId ? (stageOrder.get(a.stageId) ?? 0) : 999,
      demands,
      manualStart: a.autoPlanned ? null : a.plannedStart,
      manualEnd: a.autoPlanned ? null : a.plannedEnd,
      operationName: c?.operation ?? '',
      componentId: a.componentId,
      plannedQty: a.plannedQty,
    };
  });

  const result: ScheduleResult = autoSchedule(
    units.map(u => ({ id: u.id, stageOrder: u.stageOrder, demands: u.demands, manualStart: u.manualStart, manualEnd: u.manualEnd })),
    rows,
    from,
    { holidays: calCtx.holidays, exceptionsByScope: calCtx.exceptionsByScope, busy },
  );

  // записываем даты
  for (const r of result.units) {
    const u = units.find(x => x.id === r.id)!;
    await db
      .update(productionOperations)
      .set({ plannedStart: r.start, plannedEnd: r.end, autoPlanned: true })
      .where(eq(productionOperations.id, r.id));
    const [a] = await db.select().from(productionOperations).where(eq(productionOperations.id, r.id)).limit(1);
    if (a?.taskId) await db.update(tasks).set({ startDate: r.start, dueDate: r.end, updatedAt: new Date() }).where(eq(tasks.id, a.taskId));
    // ресурсы операции попадают в закладку «Ресурсы» заказа
    const normsFor = (u.demands ?? []).filter(d => d.rowId && !memberIds.includes(d.rowId) && !workCenterIds.includes(d.rowId));
    if (normsFor.length && r.start && r.end) {
      for (const n of normsFor) {
        const [existing] = await db
          .select({ id: documentResources.id })
          .from(documentResources)
          .where(and(eq(documentResources.documentId, orderId), eq(documentResources.resourceId, n.rowId)))
          .limit(1);
        const values = {
          workspaceId: ctx.workspaceId,
          documentId: orderId,
          resourceId: n.rowId,
          startAt: new Date(`${r.start}T00:00:00Z`),
          endAt: new Date(`${r.end}T23:59:59Z`),
          hours: n.hours,
          sortOrder: 0,
        };
        if (existing) await db.update(documentResources).set(values).where(eq(documentResources.id, existing.id));
        else await db.insert(documentResources).values({ id: uuidv7(), ...values });
      }
    }
  }

  // прогнозный финиш — в шапку заказа, если срок не задан вручную
  if (result.forecastEnd && !header?.plannedEnd) {
    await db
      .update(productionHeaders)
      .set({ plannedEnd: new Date(`${result.forecastEnd}T23:59:59Z`) })
      .where(eq(productionHeaders.documentId, orderId));
  }

  const names = new Map((await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, memberIds))).map(m => [m.id, m.name]));
  const view: ScheduleAssignmentView[] = result.units.map(r => {
    const u = units.find(x => x.id === r.id)!;
    const a = assignments.find(x => x.id === r.id)!;
    return {
      id: r.id,
      operationName: u.operationName,
      memberId: a.memberId,
      memberName: names.get(a.memberId) ?? '',
      workCenterId: a.workCenterId,
      stageId: a.stageId,
      stageOrder: u.stageOrder,
      plannedHours: r.hours,
      start: r.start,
      end: r.end,
      scheduled: r.scheduled,
    };
  });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: orderId, actorId: ctx.memberId, payload: { changes: ['schedule'] } });
  return { assignments: view, forecastEnd: result.forecastEnd };
}

/** Сдвиг операции в планировщике: даты и (по желанию) исполнитель или участок */
export async function moveOperation(
  db: Db,
  ctx: DocCtx,
  assignmentId: string,
  patch: { start?: string | null; end?: string | null; memberId?: string | null; workCenterId?: string | null },
): Promise<void> {
  const [row] = await db.select().from(productionOperations).where(eq(productionOperations.id, assignmentId)).limit(1);
  if (!row) throw new DomainError(404, 'not_found', 'The operation assignment does not exist');
  const start = patch.start !== undefined ? patch.start || null : row.plannedStart;
  const end = patch.end !== undefined ? patch.end || null : row.plannedEnd;
  if (start && end && start > end) throw new DomainError(422, 'invalid_dates', 'The start of the operation must not be after its end');
  // исполнителя операции, по которой уже отмечена работа (строки сдельных нарядов), не меняют: наряд привязан к нему
  if (patch.memberId && patch.memberId !== row.memberId) {
    const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, patch.memberId)).limit(1);
    if (!m) throw new DomainError(422, 'invalid_reference', 'The member does not exist in this workspace');
    const [line] = await db.select({ id: pieceworkLines.id }).from(pieceworkLines).where(eq(pieceworkLines.assignmentId, assignmentId)).limit(1);
    if (line) throw new DomainError(422, 'operation_has_work', 'The work on this operation is already marked: its executor cannot be changed');
  }
  const set: Partial<typeof productionOperations.$inferInsert> = { autoPlanned: false };
  if (patch.start !== undefined) set.plannedStart = patch.start || null;
  if (patch.end !== undefined) set.plannedEnd = patch.end || null;
  if (patch.memberId !== undefined) set.memberId = patch.memberId || row.memberId;
  if (patch.workCenterId !== undefined) set.workCenterId = patch.workCenterId || null;
  await db.update(productionOperations).set(set).where(eq(productionOperations.id, assignmentId));
  const [after] = await db.select().from(productionOperations).where(eq(productionOperations.id, assignmentId)).limit(1);
  if (after?.taskId) {
    await db
      .update(tasks)
      .set({
        startDate: after.plannedStart,
        dueDate: after.plannedEnd,
        ...(patch.memberId ? { assigneeId: patch.memberId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, after.taskId));
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: row.documentId, actorId: ctx.memberId, payload: { changes: ['schedule'] } });
}

/** Добавить n дней к дате (YYYY-MM-DD) */
function addDaysLocal(date: string, n: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ---------------- часовой план услуг ---------------- */

/** Часовой план: период (ISO) и строки — сотрудники или ресурсы */
export interface ServiceScheduleQuery {
  from: string;
  to: string;
  rowType: 'member' | 'resource';
}

/** Пояс воркспейса (`workspaces.timezone`, этап 8 услуг): часы смены и границы дней считаются в нём */
export async function workspaceTimeZone(db: Db, workspaceId: string): Promise<string> {
  const [ws] = await db.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return ws?.timezone || 'UTC';
}

/** Часовые строки: сотрудники или ресурсы */
export async function hourlyRows(db: Db, workspaceId: string, rowType: 'member' | 'resource', ctx: CalendarContext): Promise<HourlyRow[]> {
  if (rowType === 'member') {
    const rows = await db.select().from(members).where(and(eq(members.workspaceId, workspaceId), eq(members.status, 'active'))).orderBy(asc(members.name));
    return rows.map(m => ({
      id: m.id,
      rowType: 'member' as const,
      name: m.name,
      capacityUnits: 1,
      calendar: (m.calendarId ? ctx.calendars.get(m.calendarId) : null) ?? ctx.defaultCalendar,
    }));
  }
  const rows = await db.select().from(resources).where(and(eq(resources.workspaceId, workspaceId), isNull(resources.archivedAt))).orderBy(asc(resources.name));
  return rows.map(r => ({
    id: r.id,
    rowType: 'resource' as const,
    name: r.name,
    capacityUnits: r.capacityUnits,
    calendar: (r.calendarId ? ctx.calendars.get(r.calendarId) : null) ?? ctx.defaultCalendar,
  }));
}

/** Границы дня в поясе воркспейса: начало и конец (вclusive) */
function dayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  return { start: zonedInstant(date, 0, 0, timeZone), end: zonedInstant(date, 23, 59, timeZone) };
}

/** Записи часового плана: назначения заказ-нарядов и работы их ресурсов */
export async function hourlyEntries(db: Db, workspaceId: string, from: string, to: string, timeZone: string): Promise<HourlyEntry[]> {
  const entries: HourlyEntry[] = [];
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();

  // назначения заказ-нарядов: интервал по часам, у старых — даты задачи
  const assignments = await db
    .select({
      id: workOrderAssignments.id,
      taskId: workOrderAssignments.taskId,
      documentId: workOrderAssignments.documentId,
      startAt: workOrderAssignments.startAt,
      endAt: workOrderAssignments.endAt,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      hours: tasks.planHours,
      title: tasks.title,
      memberId: tasks.assigneeId,
    })
    .from(workOrderAssignments)
    .innerJoin(tasks, eq(tasks.id, workOrderAssignments.taskId))
    .where(eq(workOrderAssignments.workspaceId, workspaceId));
  for (const a of assignments) {
    if (!a.memberId) continue;
    let start = a.startAt;
    let end = a.endAt;
    // без часового интервала назначение запланировано по дням: полоса на дни задачи, без часовой загрузки
    const allDay = !start || !end;
    if (allDay) {
      start = a.startDate ? dayBounds(a.startDate, timeZone).start : null;
      end = a.dueDate ? dayBounds(a.dueDate, timeZone).end : null;
    }
    if (!start || !end) continue;
    if (end.getTime() <= fromMs || start.getTime() >= toMs) continue;
    entries.push({
      id: `as:${a.id}`,
      kind: 'assignment',
      title: a.title ?? 'Assignment',
      rowType: 'member',
      rowId: a.memberId,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      hours: a.hours ?? '0',
      documentId: a.documentId,
      taskId: a.taskId,
      memberId: a.memberId,
      allDay,
    });
  }

  // ресурсы заказ-нарядов: закладка «Ресурсы» с интервалом работы
  const docRes = await db
    .select({
      id: documentResources.id,
      documentId: documentResources.documentId,
      lineId: documentResources.lineId,
      resourceId: documentResources.resourceId,
      startAt: documentResources.startAt,
      endAt: documentResources.endAt,
      hours: documentResources.hours,
      type: documents.type,
    })
    .from(documentResources)
    .innerJoin(documents, eq(documents.id, documentResources.documentId))
    .where(eq(documentResources.workspaceId, workspaceId));
  for (const d of docRes) {
    if (d.type !== 'work_order' || !d.startAt || !d.endAt) continue;
    if (d.endAt.getTime() <= fromMs || d.startAt.getTime() >= toMs) continue;
    entries.push({
      id: `res:${d.id}`,
      kind: 'resource',
      title: 'Resource',
      rowType: 'resource',
      rowId: d.resourceId,
      startAt: d.startAt.toISOString(),
      endAt: d.endAt.toISOString(),
      hours: d.hours,
      documentId: d.documentId,
      resourceId: d.resourceId,
    });
  }
  return entries;
}

/** Часовой план услуг: загрузка по часам, перегрузка и работа вне смены */
export async function servicesSchedule(db: Db, workspaceId: string, query: ServiceScheduleQuery): Promise<HourlyLoadResult> {
  const timeZone = await workspaceTimeZone(db, workspaceId);
  const ctx = await calendarContext(db, workspaceId);
  const rows = await hourlyRows(db, workspaceId, query.rowType, ctx);
  const entries = await hourlyEntries(db, workspaceId, query.from, query.to, timeZone);
  const result = computeHourlyLoad(rows, entries, query.from, query.to, { timeZone, holidays: ctx.holidays, exceptionsByScope: ctx.exceptionsByScope });
  return { ...result, timeZone };
}

/** Предупреждения по назначению заказ-наряда: перегрузка и работа вне смены вокруг его интервала */
export async function assignmentWarnings(db: Db, workspaceId: string, assignmentId: string): Promise<HourlyLoadResult['warnings']> {
  const [row] = await db.select().from(workOrderAssignments).where(eq(workOrderAssignments.id, assignmentId)).limit(1);
  if (!row) return [];
  const timeZone = await workspaceTimeZone(db, workspaceId);
  const start = row.startAt ?? (row.endAt ? new Date(row.endAt.getTime() - 3_600_000) : new Date());
  const end = row.endAt ?? new Date(start.getTime() + 3_600_000);
  const ctx = await calendarContext(db, workspaceId);
  const from = new Date(start.getTime() - 86_400_000).toISOString();
  const to = new Date(end.getTime() + 86_400_000).toISOString();
  const entryId = `as:${row.id}`;
  const entries = await hourlyEntries(db, workspaceId, from, to, timeZone);
  // ресурсы того же заказ-наряда: их перегрузка — тоже следствие этого назначения
  const docResourceIds = new Set(entries.filter(e => e.kind === 'resource' && e.documentId === row.documentId).map(e => e.id));
  const warnings: HourlyLoadResult['warnings'] = [];
  for (const rowType of ['member', 'resource'] as const) {
    const rows = await hourlyRows(db, workspaceId, rowType, ctx);
    const result = computeHourlyLoad(rows, entries, from, to, { timeZone, holidays: ctx.holidays, exceptionsByScope: ctx.exceptionsByScope });
    warnings.push(...result.warnings.filter(w => w.entryIds.some(id => id === entryId || docResourceIds.has(id))));
  }
  return warnings;
}

/**
 * Ресурсы заказ-наряда по нормативу работ: у каждой строки-работы появляются ресурсы из product_resources.
 * Свои правки пользователя не трогаем — добавляются только недостающие строки.
 */
export async function syncWorkOrderResources(db: Db, ctx: DocCtx, documentId: string): Promise<void> {
  const lines = await db
    .select({ id: documentLines.id, productId: documentLines.productId, qty: documentLines.qty })
    .from(documentLines)
    .innerJoin(products, eq(products.id, documentLines.productId))
    .where(and(eq(documentLines.documentId, documentId), eq(products.kind, 'work')));
  if (!lines.length) return;
  const existing = await db.select({ lineId: documentResources.lineId, resourceId: documentResources.resourceId }).from(documentResources).where(eq(documentResources.documentId, documentId));
  const have = new Set(existing.map(e => `${e.lineId ?? ''}:${e.resourceId}`));
  const productIds = [...new Set(lines.map(l => l.productId))];
  const norms = await db.select().from(productResources).where(inArray(productResources.productId, productIds));
  let sortOrder = existing.length;
  for (const line of lines) {
    for (const n of norms.filter(x => x.productId === line.productId)) {
      if (have.has(`${line.id}:${n.resourceId}`)) continue;
      const hours = mul(dec(n.hoursPerUnit), dec(line.qty));
      await db.insert(documentResources).values({
        id: uuidv7(),
        workspaceId: ctx.workspaceId,
        documentId,
        lineId: line.id,
        resourceId: n.resourceId,
        hours: fmt(hours, 3),
        sortOrder: sortOrder++,
      });
      have.add(`${line.id}:${n.resourceId}`);
    }
  }
}
