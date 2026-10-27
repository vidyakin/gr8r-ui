/* Контроль и отчёты услуг (задача 1097), раздел docs/architecture/service-reports.md.
   Состояние заказ-нарядов, отклонения от графика, загрузка специалистов, аналитика по клиентам.
   Отчёты читает любой участник; себестоимость и маржа клиентов маскируются для не-admin (maskClientsReport). */
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { capacityOf, dateRange, dec, diffDays, div, exceptionsFor, fmt, marginPct, mul, orderOverdue, spreadPlan, zonedParts, type OverdueReason } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { calendarContext, workspaceTimeZone } from './planning';
import { loadWorkOrderCosts, workOrdersDoneBetween } from './work-order-cost';
import { companies, documentLines, documentStates, documents, members, products, stockMoves, tasks, timeLogs, workOrderAssignments, workOrderKinds } from './schema';

export interface ServiceReportQuery {
  from: string;
  to: string;
  counterpartyId?: string | undefined;
  assigneeId?: string | undefined;
  kindId?: string | undefined;
  today?: string | undefined;
}

function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError(422, 'report_period_invalid', 'The period start is after its end');
  if (diffDays(from, to) > 366) throw new DomainError(422, 'report_period_invalid', 'The period is longer than a year');
}

const todayOf = (q: ServiceReportQuery): string => q.today ?? new Date().toISOString().slice(0, 10);
const pct = (a: bigint, b: bigint): string | null => (b > 0n ? fmt(div(mul(a, dec('100')), b), 1) : null);

/* ---------------- исходные данные ---------------- */

interface OrderRow {
  id: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  status: string;
  state: string | null;
  kindId: string | null;
  kindName: string | null;
  category: string | null;
  stateLabel: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  amountNet: string;
  total: string;
}

interface AssignmentRow {
  id: string;
  documentId: string;
  taskId: string;
  taskKey: string;
  title: string;
  taskStatus: string;
  assigneeId: string | null;
  assigneeName: string | null;
  plannedHours: string;
  actualHours: string;
  startAt: Date | null;
  endAt: Date | null;
  taskDue: string | null;
  completedAt: Date | null;
}

/** Заказ-наряды воркспейса по отборам клиента и вида; период по дате документа — если задан */
async function loadOrders(db: Db, ws: string, q: { counterpartyId?: string | undefined; kindId?: string | undefined; from?: string; to?: string }): Promise<OrderRow[]> {
  const conds = [eq(documents.workspaceId, ws), eq(documents.type, 'work_order')];
  if (q.counterpartyId) conds.push(eq(documents.counterpartyId, q.counterpartyId));
  if (q.kindId) conds.push(eq(documents.workOrderKindId, q.kindId));
  if (q.from) conds.push(gte(documents.date, q.from));
  if (q.to) conds.push(lte(documents.date, q.to));
  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      date: documents.date,
      dueDate: documents.dueDate,
      status: documents.status,
      state: documents.state,
      kindId: documents.workOrderKindId,
      kindName: workOrderKinds.name,
      category: documentStates.category,
      stateLabel: documentStates.label,
      counterpartyId: documents.counterpartyId,
      counterpartyName: companies.name,
      amountNet: documents.amountNet,
      total: documents.total,
    })
    .from(documents)
    .leftJoin(workOrderKinds, eq(workOrderKinds.id, documents.workOrderKindId))
    .leftJoin(documentStates, and(eq(documentStates.workspaceId, documents.workspaceId), eq(documentStates.kindId, documents.workOrderKindId), eq(documentStates.key, documents.state)))
    .leftJoin(companies, eq(companies.id, documents.counterpartyId))
    .where(and(...conds))
    .orderBy(asc(documents.date), asc(documents.createdAt));
  return rows;
}

/** Назначения заказ-нарядов с задачей и суммой времени задачи */
async function loadAssignments(db: Db, ws: string, docIds: string[]): Promise<AssignmentRow[]> {
  if (!docIds.length) return [];
  const rows = await db
    .select({
      id: workOrderAssignments.id,
      documentId: workOrderAssignments.documentId,
      taskId: workOrderAssignments.taskId,
      taskKey: tasks.key,
      title: tasks.title,
      taskStatus: tasks.status,
      assigneeId: tasks.assigneeId,
      assigneeName: members.name,
      plannedHours: workOrderAssignments.plannedHours,
      startAt: workOrderAssignments.startAt,
      endAt: workOrderAssignments.endAt,
      taskDue: tasks.dueDate,
      completedAt: tasks.completedAt,
    })
    .from(workOrderAssignments)
    .innerJoin(tasks, eq(tasks.id, workOrderAssignments.taskId))
    .leftJoin(members, eq(members.id, tasks.assigneeId))
    .where(and(eq(workOrderAssignments.workspaceId, ws), inArray(workOrderAssignments.documentId, docIds)))
    .orderBy(asc(workOrderAssignments.createdAt));
  const taskIds = rows.map(r => r.taskId);
  const hours = new Map<string, string>();
  if (taskIds.length) {
    const logs = await db
      .select({ taskId: timeLogs.taskId, hours: sql<string>`coalesce(sum(${timeLogs.hours}), 0)::text` })
      .from(timeLogs)
      .where(inArray(timeLogs.taskId, taskIds))
      .groupBy(timeLogs.taskId);
    for (const l of logs) hours.set(l.taskId, l.hours);
  }
  return rows.map(r => ({ ...r, plannedHours: r.plannedHours ?? '0', actualHours: hours.get(r.taskId) ?? '0' }));
}

/** Заказ-наряды по отборам клиента, вида и исполнителя (у заказ-наряда есть назначение этого исполнителя) и их назначения.
    Назначения возвращаются целиком (не только исполнителя): план и факт заказ-наряда не зависят от отбора */
async function scope(db: Db, ws: string, q: ServiceReportQuery, withPeriod: boolean) {
  let orders = await loadOrders(db, ws, { counterpartyId: q.counterpartyId, kindId: q.kindId, ...(withPeriod ? { from: q.from, to: q.to } : {}) });
  let assignments = await loadAssignments(db, ws, orders.map(o => o.id));
  if (q.assigneeId) {
    const keep = new Set(assignments.filter(a => a.assigneeId === q.assigneeId).map(a => a.documentId));
    orders = orders.filter(o => keep.has(o.id));
    assignments = assignments.filter(a => keep.has(a.documentId));
  }
  return { orders, assignments };
}

const localDate = (d: Date | null, tz: string): string | null => (d ? zonedParts(d, tz).date : null);
/** Плановый конец назначения: конец интервала, иначе срок задачи */
const plannedEnd = (a: AssignmentRow, tz: string): string | null => localDate(a.endAt, tz) ?? a.taskDue;

/* ---------------- 1. состояние заказ-нарядов ---------------- */

export interface StatesOrderRow {
  documentId: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  status: string;
  kindId: string | null;
  kindName: string | null;
  state: string | null;
  stateLabel: string | null;
  category: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  amountNet: string;
  total: string;
  overdue: boolean;
  overdueDays: number;
  overdueReasons: OverdueReason[];
  plannedHours: string;
  actualHours: string;
  completionPct: string | null;
}

export interface StatesSummaryRow {
  kindId: string | null;
  kindName: string | null;
  category: string | null;
  state: string | null;
  stateLabel: string | null;
  count: number;
  amountNet: string;
  total: string;
  overdue: number;
  plannedHours: string;
  actualHours: string;
  completionPct: string | null;
}

export interface StatesReport {
  from: string;
  to: string;
  today: string;
  rows: StatesOrderRow[];
  /** По видам и состояниям */
  summary: StatesSummaryRow[];
  /** По категориям */
  byCategory: { category: string | null; count: number; amountNet: string; total: string; overdue: number }[];
  totals: { count: number; amountNet: string; total: string; overdue: number; plannedHours: string; actualHours: string; completionPct: string | null };
}

export async function statesReport(db: Db, ws: string, q: ServiceReportQuery): Promise<StatesReport> {
  assertPeriod(q.from, q.to);
  const today = todayOf(q);
  const tz = await workspaceTimeZone(db, ws);
  const { orders, assignments } = await scope(db, ws, q, true);
  const rows: StatesOrderRow[] = orders.map(o => {
    const own = assignments.filter(a => a.documentId === o.id);
    const od = orderOverdue({ category: o.category, dueDate: o.dueDate, today, assignments: own.map(a => ({ closed: a.taskStatus === 'done', endDate: plannedEnd(a, tz) })) });
    const planned = own.reduce((s, a) => s + dec(a.plannedHours), 0n);
    const actual = own.reduce((s, a) => s + dec(a.actualHours), 0n);
    return {
      documentId: o.id,
      number: o.number,
      date: o.date,
      dueDate: o.dueDate,
      status: o.status,
      kindId: o.kindId,
      kindName: o.kindName,
      state: o.state,
      stateLabel: o.stateLabel,
      category: o.category,
      counterpartyId: o.counterpartyId,
      counterpartyName: o.counterpartyName,
      amountNet: o.amountNet,
      total: o.total,
      overdue: od.overdue,
      overdueDays: od.days,
      overdueReasons: od.reasons,
      plannedHours: fmt(planned, 2),
      actualHours: fmt(actual, 2),
      completionPct: pct(actual, planned),
    };
  });
  const agg = (list: StatesOrderRow[]) => {
    const planned = list.reduce((s, r) => s + dec(r.plannedHours), 0n);
    const actual = list.reduce((s, r) => s + dec(r.actualHours), 0n);
    return {
      count: list.length,
      amountNet: fmt(list.reduce((s, r) => s + dec(r.amountNet), 0n), 2),
      total: fmt(list.reduce((s, r) => s + dec(r.total), 0n), 2),
      overdue: list.filter(r => r.overdue).length,
      plannedHours: fmt(planned, 2),
      actualHours: fmt(actual, 2),
      completionPct: pct(actual, planned),
    };
  };
  const group = <K,>(key: (r: StatesOrderRow) => string, make: (r: StatesOrderRow) => K) => {
    const map = new Map<string, { head: K; list: StatesOrderRow[] }>();
    for (const r of rows) {
      const k = key(r);
      const cur = map.get(k) ?? { head: make(r), list: [] };
      cur.list.push(r);
      map.set(k, cur);
    }
    return [...map.values()];
  };
  const summary = group(r => `${r.kindId}|${r.state}`, r => ({ kindId: r.kindId, kindName: r.kindName, category: r.category, state: r.state, stateLabel: r.stateLabel })).map(g => ({ ...g.head, ...agg(g.list) }));
  const byCategory = group(r => `${r.category}`, r => r.category).map(g => {
    const a = agg(g.list);
    return { category: g.head, count: a.count, amountNet: a.amountNet, total: a.total, overdue: a.overdue };
  });
  return { from: q.from, to: q.to, today, rows, summary, byCategory, totals: agg(rows) };
}

/* ---------------- 2. отклонения от графика ---------------- */

export interface ScheduleRow {
  assignmentId: string;
  documentId: string;
  number: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  taskId: string;
  taskKey: string;
  title: string;
  assigneeId: string | null;
  assigneeName: string | null;
  plannedHours: string;
  actualHours: string;
  deviationHours: string;
  plannedEnd: string | null;
  /** Дата закрытия задачи (статус done) */
  closedDate: string | null;
  closed: boolean;
  /** Отклонение закрытия от планового конца в днях; у незакрытой просроченной — до «сегодня» */
  deviationDays: number | null;
}

export interface ScheduleTotal {
  plannedHours: string;
  actualHours: string;
  deviationHours: string;
  count: number;
  late: number;
}

export interface ScheduleReport {
  from: string;
  to: string;
  today: string;
  rows: ScheduleRow[];
  byOrder: (ScheduleTotal & { documentId: string; number: string | null })[];
  byAssignee: (ScheduleTotal & { assigneeId: string | null; assigneeName: string | null })[];
  totals: ScheduleTotal;
}

export async function scheduleReport(db: Db, ws: string, q: ServiceReportQuery): Promise<ScheduleReport> {
  assertPeriod(q.from, q.to);
  const today = todayOf(q);
  const tz = await workspaceTimeZone(db, ws);
  const { orders, assignments } = await scope(db, ws, q, false);
  const byDoc = new Map(orders.map(o => [o.id, o]));
  const rows: ScheduleRow[] = [];
  for (const a of assignments) {
    if (q.assigneeId && a.assigneeId !== q.assigneeId) continue;
    const o = byDoc.get(a.documentId)!;
    const end = plannedEnd(a, tz);
    // в период попадает по плановому концу, без дат — по дате документа
    const ref = end ?? o.date;
    if (ref < q.from || ref > q.to) continue;
    const closed = a.taskStatus === 'done';
    const closedDate = closed ? localDate(a.completedAt, tz) : null;
    const deviationDays = closed ? (closedDate && end ? diffDays(end, closedDate) : null) : end && end < today ? diffDays(end, today) : null;
    rows.push({
      assignmentId: a.id,
      documentId: a.documentId,
      number: o.number,
      counterpartyId: o.counterpartyId,
      counterpartyName: o.counterpartyName,
      taskId: a.taskId,
      taskKey: a.taskKey,
      title: a.title,
      assigneeId: a.assigneeId,
      assigneeName: a.assigneeName,
      plannedHours: fmt(dec(a.plannedHours), 2),
      actualHours: fmt(dec(a.actualHours), 2),
      deviationHours: fmt(dec(a.actualHours) - dec(a.plannedHours), 2),
      plannedEnd: end,
      closedDate,
      closed,
      deviationDays,
    });
  }
  const agg = (list: ScheduleRow[]): ScheduleTotal => {
    const planned = list.reduce((s, r) => s + dec(r.plannedHours), 0n);
    const actual = list.reduce((s, r) => s + dec(r.actualHours), 0n);
    return { plannedHours: fmt(planned, 2), actualHours: fmt(actual, 2), deviationHours: fmt(actual - planned, 2), count: list.length, late: list.filter(r => (r.deviationDays ?? 0) > 0).length };
  };
  const orderIds = [...new Set(rows.map(r => r.documentId))];
  const assigneeKeys = [...new Set(rows.map(r => r.assigneeId ?? ''))];
  return {
    from: q.from,
    to: q.to,
    today,
    rows,
    byOrder: orderIds.map(id => {
      const list = rows.filter(r => r.documentId === id);
      return { documentId: id, number: list[0]!.number, ...agg(list) };
    }),
    byAssignee: assigneeKeys.map(k => {
      const list = rows.filter(r => (r.assigneeId ?? '') === k);
      return { assigneeId: list[0]!.assigneeId, assigneeName: list[0]!.assigneeName, ...agg(list) };
    }),
    totals: agg(rows),
  };
}

/* ---------------- 3. загрузка специалистов ---------------- */

export interface ServiceLoadDay {
  /** Дата или null — плановые часы назначений без дат */
  date: string | null;
  capacity: string;
  planned: string;
  fact: string;
  overloaded: boolean;
}

export interface ServiceLoadRow {
  memberId: string;
  memberName: string;
  capacity: string;
  planned: string;
  fact: string;
  /** Загрузка планом и фактом, % от доступного времени (null — доступного времени нет) */
  plannedPct: string | null;
  factPct: string | null;
  overloaded: boolean;
  /** Плановые часы без дат (не входят в дни и в процент) */
  undated: string;
  days: ServiceLoadDay[];
}

export interface ServiceLoadReport {
  from: string;
  to: string;
  rows: ServiceLoadRow[];
}

export async function serviceLoadReport(db: Db, ws: string, q: ServiceReportQuery): Promise<ServiceLoadReport> {
  assertPeriod(q.from, q.to);
  const tz = await workspaceTimeZone(db, ws);
  const cal = await calendarContext(db, ws);
  const { orders, assignments } = await scope(db, ws, q, false);
  const byDoc = new Map(orders.map(o => [o.id, o]));

  // план по участникам и дням
  const plan = new Map<string, Map<string, bigint>>();
  const undated = new Map<string, bigint>();
  const add = (m: Map<string, bigint>, k: string, v: bigint) => m.set(k, (m.get(k) ?? 0n) + v);
  for (const a of assignments) {
    const o = byDoc.get(a.documentId)!;
    if (!a.assigneeId || o.category === 'cancelled') continue;
    if (q.assigneeId && a.assigneeId !== q.assigneeId) continue;
    const parts = spreadPlan({ hours: a.plannedHours, startAt: a.startAt, endAt: a.endAt, taskDue: a.taskDue, docDue: o.dueDate, timeZone: tz });
    for (const p of parts) {
      if (p.date === null) {
        // без дат: считаем в периоде по дате документа
        if (o.date >= q.from && o.date <= q.to) add(undated, a.assigneeId, dec(p.hours));
      } else if (p.date >= q.from && p.date <= q.to) {
        const m = plan.get(a.assigneeId) ?? new Map<string, bigint>();
        add(m, p.date, dec(p.hours));
        plan.set(a.assigneeId, m);
      }
    }
  }

  // факт: время задач модуля services по дням записи. С отбором клиента или вида — задачи его заказ-нарядов
  // (и задачи заказчика без заказ-наряда, когда вида нет)
  const logConds = [eq(timeLogs.workspaceId, ws), eq(tasks.module, 'services'), gte(timeLogs.logDate, q.from), lte(timeLogs.logDate, q.to)];
  if (q.assigneeId) logConds.push(eq(timeLogs.memberId, q.assigneeId));
  if (q.counterpartyId || q.kindId) {
    const ids = assignments.map(a => a.taskId);
    const own = ids.length ? inArray(tasks.id, ids) : sql`false`;
    logConds.push(q.counterpartyId && !q.kindId ? sql`(${own} or ${tasks.companyId} = ${q.counterpartyId})` : own);
  }
  const logs = await db
    .select({ memberId: timeLogs.memberId, day: timeLogs.logDate, hours: sql<string>`sum(${timeLogs.hours})::text` })
    .from(timeLogs)
    .innerJoin(tasks, eq(tasks.id, timeLogs.taskId))
    .where(and(...logConds))
    .groupBy(timeLogs.memberId, timeLogs.logDate);
  const fact = new Map<string, Map<string, bigint>>();
  for (const l of logs) {
    const m = fact.get(l.memberId) ?? new Map<string, bigint>();
    add(m, l.day, dec(l.hours));
    fact.set(l.memberId, m);
  }

  const people = await db.select().from(members).where(and(eq(members.workspaceId, ws), eq(members.status, 'active'))).orderBy(asc(members.name));
  const known = new Set(people.map(p => p.id));
  const extra = [...new Set([...plan.keys(), ...fact.keys(), ...undated.keys()])].filter(id => !known.has(id));
  const extraRows = extra.length ? await db.select().from(members).where(inArray(members.id, extra)) : [];
  const days = dateRange(q.from, q.to);
  const rows: ServiceLoadRow[] = [];
  for (const p of [...people, ...extraRows]) {
    if (q.assigneeId && p.id !== q.assigneeId) continue;
    const calendar = (p.calendarId ? cal.calendars.get(p.calendarId) : null) ?? cal.defaultCalendar;
    const exc = exceptionsFor(cal.exceptionsByScope, 'member', p.id);
    let capacity = 0n;
    let planned = 0n;
    let factSum = 0n;
    const list: ServiceLoadDay[] = [];
    for (const d of days) {
      const cap = capacityOf(calendar, d, null, cal.holidays, exc);
      const pl = plan.get(p.id)?.get(d) ?? 0n;
      const f = fact.get(p.id)?.get(d) ?? 0n;
      capacity += cap;
      planned += pl;
      factSum += f;
      if (cap > 0n || pl > 0n || f > 0n) list.push({ date: d, capacity: fmt(cap, 2), planned: fmt(pl, 2), fact: fmt(f, 2), overloaded: pl > cap || f > cap });
    }
    const und = undated.get(p.id) ?? 0n;
    if (und > 0n) list.push({ date: null, capacity: '0.00', planned: fmt(und, 2), fact: '0.00', overloaded: false });
    // участник без доступного времени, плана и факта в отчёт не попадает
    if (!list.some(d => dec(d.planned) > 0n || dec(d.fact) > 0n)) continue;
    rows.push({ memberId: p.id, memberName: p.name, capacity: fmt(capacity, 2), planned: fmt(planned, 2), fact: fmt(factSum, 2), plannedPct: pct(planned, capacity), factPct: pct(factSum, capacity), overloaded: list.some(d => d.overloaded), undated: fmt(und, 2), days: list });
  }
  return { from: q.from, to: q.to, rows };
}

/* ---------------- 4. аналитика по клиентам ---------------- */

export interface ClientsRow {
  counterpartyId: string | null;
  counterpartyName: string | null;
  /** Выполненные заказ-наряды за период */
  orders: number;
  /** Проведённые акты, реализации и возвраты */
  documents: number;
  revenueServices: string;
  revenueGoods: string;
  revenue: string;
  /** Себестоимость, маржа и процент — только admin и owner (иначе null) */
  cost: string | null;
  margin: string | null;
  marginPct: string | null;
}

export interface ClientsReport {
  from: string;
  to: string;
  rows: ClientsRow[];
  totals: Omit<ClientsRow, 'counterpartyId' | 'counterpartyName'>;
}

/** Выручка без НДС = выполненные заказ-наряды + проведённые акты и реализации − возвраты покупателей.
    Отборы вида и исполнителя относятся к заказ-нарядам: с ними акты, реализации и возвраты не учитываются */
export async function clientsReport(db: Db, ws: string, q: ServiceReportQuery): Promise<ClientsReport> {
  assertPeriod(q.from, q.to);
  interface Acc { name: string | null; orders: number; docs: number; services: bigint; goods: bigint; cost: bigint }
  const acc = new Map<string, Acc>();
  const get = (id: string | null, name: string | null) => {
    const k = id ?? '';
    const cur = acc.get(k) ?? { name, orders: 0, docs: 0, services: 0n, goods: 0n, cost: 0n };
    acc.set(k, cur);
    return cur;
  };
  const lineSplit = async (ids: string[]) => {
    const rows = ids.length
      ? await db
          .select({ documentId: documentLines.documentId, goods: sql<string>`coalesce(sum(${documentLines.net}) filter (where ${products.kind} = 'goods'), 0)::text`, other: sql<string>`coalesce(sum(${documentLines.net}) filter (where ${products.kind} <> 'goods'), 0)::text` })
          .from(documentLines)
          .innerJoin(products, eq(products.id, documentLines.productId))
          .where(inArray(documentLines.documentId, ids))
          .groupBy(documentLines.documentId)
      : [];
    return new Map(rows.map(r => [r.documentId, { goods: dec(r.goods), other: dec(r.other) }]));
  };

  // заказ-наряды, выполненные в периоде
  let woIds = await workOrdersDoneBetween(db, ws, q.from, q.to);
  const orders = await loadOrders(db, ws, { counterpartyId: q.counterpartyId, kindId: q.kindId });
  const orderOf = new Map(orders.map(o => [o.id, o]));
  woIds = woIds.filter(id => orderOf.has(id));
  if (q.assigneeId && woIds.length) {
    const asg = await loadAssignments(db, ws, woIds);
    const keep = new Set(asg.filter(a => a.assigneeId === q.assigneeId).map(a => a.documentId));
    woIds = woIds.filter(id => keep.has(id));
  }
  const costs = await loadWorkOrderCosts(db, ws, woIds);
  const split = await lineSplit(woIds);
  for (const id of woIds) {
    const o = orderOf.get(id)!;
    const c = costs.get(id);
    if (!c) continue;
    const a = get(o.counterpartyId, o.counterpartyName);
    const goods = split.get(id)?.goods ?? 0n;
    a.orders++;
    a.goods += goods;
    a.services += dec(o.amountNet) - goods;
    a.cost += dec(c.cost.cost.fact);
  }

  // акты, реализации и возвраты покупателей
  if (!q.kindId && !q.assigneeId) {
    const conds = [eq(documents.workspaceId, ws), eq(documents.status, 'posted'), inArray(documents.type, ['act', 'realization', 'customer_return']), gte(documents.date, q.from), lte(documents.date, q.to)];
    if (q.counterpartyId) conds.push(eq(documents.counterpartyId, q.counterpartyId));
    const docs = await db
      .select({ id: documents.id, type: documents.type, counterpartyId: documents.counterpartyId, name: companies.name })
      .from(documents)
      .leftJoin(companies, eq(companies.id, documents.counterpartyId))
      .where(and(...conds));
    const ids = docs.map(d => d.id);
    const lines = await lineSplit(ids);
    const moves = ids.length
      ? await db
          .select({ documentId: stockMoves.documentId, cost: sql<string>`coalesce(sum(-${stockMoves.qty} * ${stockMoves.cost}), 0)::text` })
          .from(stockMoves)
          .where(inArray(stockMoves.documentId, ids))
          .groupBy(stockMoves.documentId)
      : [];
    const moveCost = new Map(moves.map(m => [m.documentId, dec(m.cost)]));
    for (const d of docs) {
      const a = get(d.counterpartyId, d.name);
      const sign = d.type === 'customer_return' ? -1n : 1n;
      const s = lines.get(d.id) ?? { goods: 0n, other: 0n };
      a.docs++;
      a.goods += sign * s.goods;
      a.services += sign * s.other;
      // у возврата движения приходные: −qty × cost уже отрицательны
      a.cost += moveCost.get(d.id) ?? 0n;
    }
  }

  const toRow = (id: string | null, a: Acc): ClientsRow => {
    const revenue = a.services + a.goods;
    const margin = revenue - a.cost;
    return { counterpartyId: id, counterpartyName: a.name, orders: a.orders, documents: a.docs, revenueServices: fmt(a.services, 2), revenueGoods: fmt(a.goods, 2), revenue: fmt(revenue, 2), cost: fmt(a.cost, 2), margin: fmt(margin, 2), marginPct: marginPct(margin, revenue) };
  };
  const rows = [...acc.entries()].map(([k, a]) => toRow(k || null, a)).sort((a, b) => Number(dec(b.revenue) - dec(a.revenue)));
  const total: Acc = { name: null, orders: 0, docs: 0, services: 0n, goods: 0n, cost: 0n };
  for (const a of acc.values()) {
    total.orders += a.orders;
    total.docs += a.docs;
    total.services += a.services;
    total.goods += a.goods;
    total.cost += a.cost;
  }
  const { counterpartyId: _i, counterpartyName: _n, ...totals } = toRow(null, total);
  return { from: q.from, to: q.to, rows, totals };
}

/** Себестоимость, маржа и процент — только admin и owner */
export function maskClientsReport(r: ClientsReport, seeCost: boolean): ClientsReport {
  if (seeCost) return r;
  const hide = <T extends { cost: string | null; margin: string | null; marginPct: string | null }>(x: T): T => ({ ...x, cost: null, margin: null, marginPct: null });
  return { ...r, rows: r.rows.map(hide), totals: hide(r.totals) };
}
