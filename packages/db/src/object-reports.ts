/* Сводка о ходе объекта (задача 1277, docs/architecture/construction.md). Собирает то, что уже реализовано:
   процент выполнения (задача 1272), вехи, объём за неделю по подтверждённым сменам (1271), акты и оплаты (1273);
   перерасход бюджета (1270) и прогноз прибыли (1275) — только owner/admin.
   Отправка — внутренними уведомлениями (почта и SMS отложены, задача 1092): уведомление несёт ссылку на объект
   и открывает карточку. Расписание — object_report_schedules, окно считается по часовому поясу воркспейса,
   last_sent_at делает повторный проход идемпотентным. Всё в транзакции вызывающего; изменение + событие — вместе. */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  addDaysIso,
  dateInTimezone,
  dec,
  estimateLineTotals,
  fmt,
  mul,
  wallClock,
  weekdayOf,
  type ObjectDigest,
  type ObjectProgressMode,
  type ObjectReportActs,
  type ObjectReportBudgetOverrun,
  type ObjectReportMilestoneRow,
  type ObjectReportProfit,
  type ObjectReportScheduleView,
  type ObjectReportVolumeRow,
  type ReportWeekday,
  type Role,
} from '@gr8r/shared';
import type { Db } from './client';
import { canSeeCost } from './cost';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { objectActsView, objectRevenue } from './object-acts';
import { objectBudget } from './object-budget';
import { objectForecast } from './object-forecast';
import { objectContractValue, objectMilestonesView, objectProgress } from './object-progress';
import { printOrg } from './payments';
import { workspaceTimeZone } from './planning';
import {
  companies,
  contracts,
  members,
  notifications,
  objectContracts,
  objectEstimateItems,
  objectEstimates,
  objectForemen,
  objectReportSchedules,
  objectShiftHours,
  objectShiftVolumes,
  objectShifts,
  objects,
  organizations,
  units,
  workspaces,
} from './schema';

/** Тип фоновой задачи: сводка о ходе объекта по расписанию (модуль trade) */
export const OBJECT_REPORT_JOB = 'object.progress_report';

export type ObjectReportScheduleRow = typeof objectReportSchedules.$inferSelect;

/** Контекст записи: воркспейс, автор и его роль (расписание правит admin+ или ответственный объекта) */
export interface ReportCtx {
  workspaceId: string;
  memberId: string | null;
  role?: Role | undefined;
}

/** Объект своего воркспейса и не в архиве: чужая или архивная карточка — 404 (как GET /objects/:id) */
async function assertLiveObject(db: Db, objectId: string) {
  const [row] = await db.select().from(objects).where(eq(objects.id, objectId)).limit(1);
  if (!row || row.archivedAt) throw new DomainError(404, 'not_found', 'object not found');
  return row;
}

/* ---------------- окно расписания ---------------- */

/** Локальные день и время воркспейса: дата, минуты от начала суток и день недели */
export function reportWallTime(now: Date, timezone: string): { date: string; minutes: number; weekday: number } {
  const local = wallClock(now, timezone);
  const date = local.toISOString().slice(0, 10);
  return { date, minutes: local.getUTCHours() * 60 + local.getUTCMinutes(), weekday: weekdayOf(date) };
}

/** Минуты из «HH:MM»; неверный формат — null */
const minutesOf = (time: string): number | null => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
};

/** Пора ли отправлять сводку: включена, сегодня нужный день недели, время наступило,
    а прошлая отправка была раньше начала текущего окна (тот же день и время по часам воркспейса) */
export function reportDue(
  schedule: { enabled: boolean; weekday: number; time: string; lastSentAt: Date | string | null },
  now: Date,
  timezone: string,
): boolean {
  if (!schedule.enabled) return false;
  const local = reportWallTime(now, timezone);
  if (local.weekday !== schedule.weekday) return false;
  const due = minutesOf(schedule.time);
  if (due === null || local.minutes < due) return false;
  if (!schedule.lastSentAt) return true;
  const sent = wallClock(schedule.lastSentAt instanceof Date ? schedule.lastSentAt : new Date(schedule.lastSentAt), timezone);
  // начало текущего окна — сегодня в назначенное время (в «стенных» координатах воркспейса)
  const windowStart = wallClock(now, timezone).getTime() - (local.minutes - due) * 60_000;
  return sent.getTime() < windowStart;
}

/** Расписание к отправке: объект не в архиве, расписание включено, окно наступило */
export interface DueReportSchedule {
  scheduleId: string;
  workspaceId: string;
  objectId: string;
  objectNumber: string;
  objectName: string;
}

/** Расписания, у которых наступило окно. Читается под app_worker (все арендаторы) — воркер затем ставит задачи */
export async function dueSchedules(db: Db, now: Date = new Date()): Promise<DueReportSchedule[]> {
  const rows = await db
    .select({
      scheduleId: objectReportSchedules.id,
      workspaceId: objectReportSchedules.workspaceId,
      objectId: objectReportSchedules.objectId,
      objectNumber: objects.number,
      objectName: objects.name,
      enabled: objectReportSchedules.enabled,
      weekday: objectReportSchedules.weekday,
      time: objectReportSchedules.time,
      lastSentAt: objectReportSchedules.lastSentAt,
      timezone: workspaces.timezone,
    })
    .from(objectReportSchedules)
    .innerJoin(objects, and(eq(objects.workspaceId, objectReportSchedules.workspaceId), eq(objects.id, objectReportSchedules.objectId)))
    .innerJoin(workspaces, eq(workspaces.id, objectReportSchedules.workspaceId))
    .where(and(eq(objectReportSchedules.enabled, true), isNull(objects.archivedAt)))
    .orderBy(asc(objectReportSchedules.id));
  return rows.filter(r => reportDue(r, now, r.timezone)).map(r => ({ scheduleId: r.scheduleId, workspaceId: r.workspaceId, objectId: r.objectId, objectNumber: r.objectNumber, objectName: r.objectName }));
}

/* ---------------- настройка расписания ---------------- */

/** Получатели по умолчанию: ответственный и прорабы объекта (только действующие участники) */
export async function defaultReportRecipients(db: Db, object: { managerId: string | null; id: string }): Promise<string[]> {
  const foremen = await db.select({ memberId: objectForemen.memberId }).from(objectForemen).where(eq(objectForemen.objectId, object.id)).orderBy(asc(objectForemen.createdAt));
  const ids = [...new Set([object.managerId, ...foremen.map(f => f.memberId)].filter((x): x is string => !!x))];
  if (!ids.length) return [];
  const active = await db
    .select({ id: members.id })
    .from(members)
    .where(and(inArray(members.id, ids), eq(members.status, 'active')))
    .orderBy(asc(members.name));
  return active.map(m => m.id);
}

/** Настройка сводки объекта: нет строки — выключено, понедельник 09:00, получатели по умолчанию */
export async function objectReportSchedule(db: Db, objectId: string): Promise<ObjectReportScheduleView> {
  const object = await assertLiveObject(db, objectId);
  const [row] = await db.select().from(objectReportSchedules).where(eq(objectReportSchedules.objectId, objectId)).limit(1);
  const timezone = await workspaceTimeZone(db, object.workspaceId);
  if (!row) {
    return {
      objectId,
      enabled: false,
      weekday: 1,
      time: '09:00',
      recipientIds: (await defaultReportRecipients(db, object)) as string[],
      lastSentAt: null,
      timezone,
    };
  }
  return {
    objectId,
    enabled: row.enabled,
    weekday: row.weekday as ReportWeekday,
    time: row.time,
    recipientIds: row.recipientIds.length ? row.recipientIds : ((await defaultReportRecipients(db, object)) as string[]),
    lastSentAt: row.lastSentAt ? row.lastSentAt.toISOString() : null,
    timezone,
  };
}

export interface ReportScheduleInput {
  enabled: boolean;
  weekday: number;
  time: string;
  recipientIds: string[];
}

/** Получатели — действующие участники этого воркспейса; посторонний id — 422 invalid_reference */
async function assertRecipients(db: Db, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = await db.select({ id: members.id, status: members.status }).from(members).where(inArray(members.id, unique));
  const found = new Map(rows.map(r => [r.id, r.status]));
  const bad = unique.find(id => found.get(id) !== 'active');
  if (bad) throw new DomainError(422, 'invalid_reference', 'The report recipient is not an active member of this workspace', { memberId: bad });
  return unique;
}

/** Сохранение настройки сводки: одна строка на объект. Пустые получатели — ответственный и прорабы */
export async function saveObjectReportSchedule(db: Db, ctx: ReportCtx, objectId: string, input: ReportScheduleInput): Promise<ObjectReportScheduleView> {
  const object = await assertLiveObject(db, objectId);
  // правит admin и выше или ответственный объекта
  if (!canSeeCost(ctx.role) && object.managerId !== ctx.memberId)
    throw new DomainError(403, 'forbidden', 'Only an admin or the object manager can change the report schedule');
  const recipients = input.recipientIds.length ? await assertRecipients(db, input.recipientIds) : await defaultReportRecipients(db, object);
  const [existing] = await db.select().from(objectReportSchedules).where(eq(objectReportSchedules.objectId, objectId)).limit(1);
  if (existing) {
    await db
      .update(objectReportSchedules)
      .set({ enabled: input.enabled, weekday: input.weekday, time: input.time, recipientIds: recipients, updatedAt: new Date() })
      .where(eq(objectReportSchedules.id, existing.id));
  } else {
    await db.insert(objectReportSchedules).values({
      workspaceId: ctx.workspaceId,
      objectId,
      enabled: input.enabled,
      weekday: input.weekday,
      time: input.time,
      recipientIds: recipients,
    });
  }
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: 'object_report.updated',
    entity: 'object_report',
    recordId: objectId,
    actorId: ctx.memberId,
    payload: { objectId, enabled: input.enabled, weekday: input.weekday, time: input.time, recipients: recipients.length },
  });
  return objectReportSchedule(db, objectId);
}

/* ---------------- сводка ---------------- */

/** Период недели сводки: последние 7 дней, включая сегодняшний (локальные даты воркспейса) */
export function reportWeekPeriod(now: Date, timezone: string): { from: string; to: string } {
  const to = dateInTimezone(timezone, now);
  return { from: addDaysIso(to, -6), to };
}

/** Часы и объёмы подтверждённых смен за период */
async function weekFacts(db: Db, objectId: string, from: string, to: string): Promise<Omit<ObjectDigest['week'], 'from' | 'to'>> {
  const [shiftRow] = await db
    .select({ n: sql<number>`count(distinct ${objectShifts.id})`, hours: sql<string>`coalesce(sum(${objectShiftHours.hours}), 0)::text` })
    .from(objectShifts)
    .leftJoin(objectShiftHours, and(eq(objectShiftHours.workspaceId, objectShifts.workspaceId), eq(objectShiftHours.shiftId, objectShifts.id)))
    .where(and(eq(objectShifts.objectId, objectId), eq(objectShifts.status, 'confirmed'), gte(objectShifts.workDate, from), lte(objectShifts.workDate, to)));
  const volumes = await db
    .select({
      estimateItemId: objectShiftVolumes.estimateItemId,
      name: objectEstimateItems.name,
      unitCode: objectEstimateItems.unitCode,
      symbol: units.symbol,
      qty: sql<string>`sum(${objectShiftVolumes.qty})::text`,
    })
    .from(objectShiftVolumes)
    .innerJoin(objectShifts, and(eq(objectShifts.workspaceId, objectShiftVolumes.workspaceId), eq(objectShifts.id, objectShiftVolumes.shiftId)))
    .innerJoin(objectEstimateItems, and(eq(objectEstimateItems.workspaceId, objectShiftVolumes.workspaceId), eq(objectEstimateItems.id, objectShiftVolumes.estimateItemId)))
    .leftJoin(units, and(eq(units.workspaceId, objectEstimateItems.workspaceId), eq(units.code, objectEstimateItems.unitCode)))
    .where(and(eq(objectShifts.objectId, objectId), eq(objectShifts.status, 'confirmed'), gte(objectShifts.workDate, from), lte(objectShifts.workDate, to)))
    .groupBy(objectShiftVolumes.estimateItemId, objectEstimateItems.name, objectEstimateItems.unitCode, units.symbol)
    .orderBy(asc(objectEstimateItems.name));
  const volumeRows: ObjectReportVolumeRow[] = volumes.map(v => ({
    estimateItemId: v.estimateItemId,
    name: v.name,
    unitCode: v.unitCode,
    unitSymbol: v.symbol ?? v.unitCode,
    qty: fmt(dec(v.qty), 3),
  }));
  return { shifts: Number(shiftRow?.n ?? 0), hours: fmt(dec(shiftRow?.hours), 2), volumes: volumeRows };
}

/** Вехи сводки: выполнено, принято и просроченные (срок прошёл, а веха не выполнена) */
async function digestMilestones(db: Db, objectId: string, today: string): Promise<ObjectDigest['milestones']> {
  const view = await objectMilestonesView(db, objectId);
  const items: ObjectReportMilestoneRow[] = view.items.map(m => ({
    id: m.id,
    name: m.name,
    kind: m.kind,
    dueDate: m.dueDate,
    doneAt: m.doneAt ? m.doneAt.toISOString() : null,
    acceptedAt: m.acceptedAt ? m.acceptedAt.toISOString() : null,
    overdue: !!m.dueDate && m.dueDate < today && !m.doneAt,
    value: m.value,
  }));
  return {
    done: items.filter(i => i.doneAt).length,
    accepted: items.filter(i => i.acceptedAt).length,
    overdue: items.filter(i => i.overdue).length,
    total: items.length,
    items,
    summary: view.summary,
  };
}

/** Акты и оплаты: цена заказчику, её видят все участники */
async function digestActs(db: Db, objectId: string): Promise<ObjectReportActs> {
  const revenue = await objectRevenue(db, objectId);
  return {
    acts: revenue.acts,
    signed: revenue.signed,
    done: revenue.done,
    accepted: revenue.accepted ?? '0.00',
    invoiced: revenue.invoiced ?? '0.00',
    paid: revenue.paid ?? '0.00',
  };
}

/** Прогноз прибыли и перерасход бюджета — только owner/admin; остальным null (себестоимость не раскрывается) */
async function digestMoney(db: Db, objectId: string, role: Role | null): Promise<{ budgetOverruns: ObjectReportBudgetOverrun[] | null; profit: ObjectReportProfit | null }> {
  if (!canSeeCost(role ?? undefined)) return { budgetOverruns: null, profit: null };
  const [budget, forecast] = await Promise.all([objectBudget(db, objectId, role ?? undefined), objectForecast(db, objectId, role ?? undefined)]);
  const budgetOverruns = (Object.keys(budget.categories) as (keyof typeof budget.categories)[])
    .filter(cat => budget.categories[cat].over)
    .map(cat => ({
      category: cat,
      budget: budget.categories[cat].budget ?? '0.00',
      fact: budget.categories[cat].fact ?? '0.00',
      rest: budget.categories[cat].rest ?? '0.00',
    }));
  return {
    budgetOverruns,
    profit: {
      contractValue: forecast.totals.contractValue,
      forecastCost: forecast.totals.forecastCost,
      profit: forecast.totals.profit,
      marginPct: forecast.totals.marginPct,
    },
  };
}

/** Сводка о ходе объекта для получателя. forMember — роль получателя: от неё зависит, показывать ли себестоимость */
export async function buildObjectDigest(db: Db, objectId: string, forMember: Role | null, opts: { now?: Date; period?: { from?: string | undefined; to?: string | undefined } } = {}): Promise<ObjectDigest> {
  const object = await assertLiveObject(db, objectId);
  const now = opts.now ?? new Date();
  const timezone = await workspaceTimeZone(db, object.workspaceId);
  const today = dateInTimezone(timezone, now);
  const week = reportWeekPeriod(now, timezone);
  const from = opts.period?.from ?? week.from;
  const to = opts.period?.to ?? week.to;
  const [progress, milestones, weekFactsRow, acts, money, customerRow] = await Promise.all([
    objectProgress(db, objectId),
    digestMilestones(db, objectId, today),
    weekFacts(db, objectId, from, to),
    digestActs(db, objectId),
    digestMoney(db, objectId, forMember),
    object.customerId ? db.select({ name: companies.name }).from(companies).where(eq(companies.id, object.customerId)).limit(1) : Promise.resolve([]),
  ]);
  return {
    objectId,
    number: object.number,
    name: object.name,
    customerName: customerRow[0]?.name ?? null,
    address: object.address,
    status: object.status,
    computedAt: now.toISOString(),
    progress: { mode: progress.mode as ObjectProgressMode, percent: progress.percent, base: progress.base },
    milestones,
    week: { from, to, ...weekFactsRow },
    acts,
    budgetOverruns: money.budgetOverruns,
    profit: money.profit,
  };
}

/* ---------------- отправка ---------------- */

export interface SendDigestOptions {
  /** Получатели; пусто — из расписания, иначе ответственный и прорабы объекта */
  recipientIds?: string[] | undefined;
  now?: Date | undefined;
  /** Отметить последнюю отправку в расписании (задача воркера и кнопка «Отправить сейчас») */
  markSent?: boolean | undefined;
}

export interface SendDigestResult {
  objectId: string;
  recipients: number;
  notifications: number;
}

/** Отправка сводки: каждому получателю — своё уведомление (себестоимость только owner/admin).
    Возвращает число уведомлений; обновляет last_sent_at, пишет события notification.created и object_report.sent. */
export async function sendObjectDigest(
  db: Db,
  ctx: { workspaceId: string; memberId: string | null },
  objectId: string,
  opts: SendDigestOptions = {},
): Promise<SendDigestResult> {
  const object = await assertLiveObject(db, objectId);
  const now = opts.now ?? new Date();
  const [schedule] = await db.select().from(objectReportSchedules).where(eq(objectReportSchedules.objectId, objectId)).limit(1);
  const configured = opts.recipientIds ?? (schedule?.recipientIds.length ? schedule.recipientIds : undefined);
  const recipients = configured ? await assertRecipients(db, configured) : await defaultReportRecipients(db, object);
  if (!recipients.length) throw new DomainError(422, 'report_recipients_required', 'The report has no recipients: select workspace members');
  const memberRows = await db.select({ id: members.id, role: members.role }).from(members).where(and(inArray(members.id, recipients), eq(members.status, 'active')));
  // сводка собирается на роль: двум группам (с себестоимостью и без) достаточно двух расчётов
  const digests = new Map<boolean, ObjectDigest>();
  const text = `Сводка о ходе работ: ${object.number} ${object.name}`;
  let created = 0;
  for (const m of memberRows) {
    const showCost = canSeeCost(m.role);
    if (!digests.has(showCost)) digests.set(showCost, await buildObjectDigest(db, objectId, m.role, { now }));
    const digest = digests.get(showCost)!;
    const snippet = objectDigestSnippet(digest);
    const [row] = await db
      .insert(notifications)
      .values({ workspaceId: ctx.workspaceId, recipientId: m.id, type: 'update', actorId: ctx.memberId, objectId, text, snippet })
      .returning({ id: notifications.id });
    await recordEvent(db, {
      workspaceId: ctx.workspaceId,
      type: 'notification.created',
      entity: 'notification',
      recordId: row!.id,
      actorId: ctx.memberId,
      payload: { recipientId: m.id, objectId, via: 'object_report' },
    });
    created++;
  }
  if (schedule && opts.markSent !== false) {
    await db.update(objectReportSchedules).set({ lastSentAt: now, updatedAt: now }).where(eq(objectReportSchedules.id, schedule.id));
  }
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: 'object_report.sent',
    entity: 'object_report',
    recordId: objectId,
    actorId: ctx.memberId,
    payload: { objectId, recipients: created, scheduled: !!schedule },
  });
  return { objectId, recipients: memberRows.length, notifications: created };
}

/** Текст уведомления: числа сводки без себестоимости (её нет в тексте даже у owner/admin) */
function objectDigestSnippet(digest: ObjectDigest): string {
  const parts: string[] = [];
  parts.push(digest.progress.percent === null ? 'Готовность не определена' : `Готовность ${digest.progress.percent}%`);
  parts.push(`вехи: выполнено ${digest.milestones.done} из ${digest.milestones.total}, принято ${digest.milestones.accepted}` + (digest.milestones.overdue ? `, просрочено ${digest.milestones.overdue}` : ''));
  if (digest.week.shifts) parts.push(`за неделю ${digest.week.shifts} смен(ы), ${digest.week.hours} ч`);
  parts.push(`принято ${digest.acts.accepted}, оплачено ${digest.acts.paid}`);
  if (digest.budgetOverruns?.length) parts.push(`перерасход: ${digest.budgetOverruns.map(b => b.category).join(', ')}`);
  return parts.join('; ');
}

/** Отправка по расписанию (задача воркера): расписание ещё актуально — иначе повтор ничего не делает */
export async function runScheduledObjectReport(db: Db, scheduleId: string, now: Date = new Date()): Promise<SendDigestResult | null> {
  const [row] = await db
    .select({
      id: objectReportSchedules.id,
      workspaceId: objectReportSchedules.workspaceId,
      objectId: objectReportSchedules.objectId,
      enabled: objectReportSchedules.enabled,
      weekday: objectReportSchedules.weekday,
      time: objectReportSchedules.time,
      lastSentAt: objectReportSchedules.lastSentAt,
      timezone: workspaces.timezone,
    })
    .from(objectReportSchedules)
    .innerJoin(workspaces, eq(workspaces.id, objectReportSchedules.workspaceId))
    .where(eq(objectReportSchedules.id, scheduleId))
    .limit(1);
  if (!row || !reportDue(row, now, row.timezone)) return null;
  return sendObjectDigest(db, { workspaceId: row.workspaceId, memberId: null }, row.objectId, { now });
}

/* ---------------- печатный отчёт для заказчика ---------------- */

const PROGRESS_MODE_RU: Record<string, string> = {
  tasks_closed: 'по закрытым задачам',
  tasks_avg: 'по среднему прогрессу задач',
  task_weights: 'по весам задач',
  estimate_volume: 'по выполненным объёмам сметы',
  manual: 'вручную',
};

/** Данные печатного отчёта о ходе работ для заказчика: только цена заказчику, внутренней себестоимости нет */
export async function objectProgressReportData(db: Db, objectId: string, period: { from?: string | undefined; to?: string | undefined } = {}) {
  const object = await assertLiveObject(db, objectId);
  const timezone = await workspaceTimeZone(db, object.workspaceId);
  const today = dateInTimezone(timezone);
  const from = period.from ?? `${today.slice(0, 7)}-01`;
  const to = period.to ?? today;
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.archivedAt)).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
  const organization = org ? await printOrg(db, org.id) : null;
  const [company] = object.customerId ? await db.select().from(companies).where(eq(companies.id, object.customerId)).limit(1) : [];
  const customer = {
    name: company?.name ?? '',
    fullName: company?.name ?? '',
    inn: company?.inn ?? '',
    kpp: company?.kpp ?? '',
    ogrn: company?.ogrn ?? '',
    address: company ? company.legalAddress || company.city : '',
    phone: '',
    bank: null,
  };
  const [contract] = await db
    .select({ number: contracts.number, date: contracts.date })
    .from(objectContracts)
    .innerJoin(contracts, and(eq(contracts.workspaceId, objectContracts.workspaceId), eq(contracts.id, objectContracts.contractId)))
    .where(eq(objectContracts.objectId, object.id))
    .limit(1);
  const [items, symbols, progress, milestones, acts, revenue, contractValue] = await Promise.all([
    db
      .select({
        name: objectEstimateItems.name,
        unitCode: objectEstimateItems.unitCode,
        qty: objectEstimateItems.qty,
        doneQty: objectEstimateItems.doneQty,
        price: objectEstimateItems.price,
      })
      .from(objectEstimateItems)
      .innerJoin(objectEstimates, and(eq(objectEstimates.workspaceId, objectEstimateItems.workspaceId), eq(objectEstimates.id, objectEstimateItems.estimateId)))
      .where(
        and(
          eq(objectEstimates.objectId, objectId),
          sql`((${objectEstimates.kind} = 'main' and ${objectEstimates.status} = 'approved') or (${objectEstimates.kind} = 'change' and ${objectEstimates.changeStatus} = 'approved'))`,
        ),
      )
      .orderBy(asc(objectEstimates.kind), asc(objectEstimateItems.sortOrder)),
    db.select({ code: units.code, symbol: units.symbol }).from(units),
    objectProgress(db, objectId),
    objectMilestonesView(db, objectId),
    objectActsView(db, objectId, { from, to }),
    objectRevenue(db, objectId),
    objectContractValue(db, objectId),
  ]);
  const symbolsOf = new Map(symbols.map(u => [u.code, u.symbol]));
  let planTotal = 0n;
  let doneTotal = 0n;
  const lines = items.map((i, idx) => {
    const doneAmount = mul(dec(i.doneQty), dec(i.price));
    planTotal += dec(estimateLineTotals({ kind: 'work', qty: i.qty, price: i.price, costPrice: '0', laborHours: '0' }).revenue);
    doneTotal += doneAmount;
    return { n: idx + 1, name: i.name, unitSymbol: symbolsOf.get(i.unitCode) ?? i.unitCode, qty: i.qty, doneQty: i.doneQty, price: i.price, doneAmount: fmt(doneAmount, 2) };
  });
  return {
    objectNumber: object.number,
    objectName: object.name,
    objectAddress: object.address,
    customer,
    organization,
    contractLabel: contract ? `№ ${contract.number} от ${contract.date}` : '',
    periodFrom: from,
    periodTo: to,
    progressPercent: progress.percent,
    progressModeLabel: PROGRESS_MODE_RU[progress.mode] ?? progress.mode,
    milestones: milestones.items.map(m => ({
      name: m.name,
      dueDate: m.dueDate,
      doneAt: m.doneAt ? m.doneAt.toISOString() : null,
      acceptedAt: m.acceptedAt ? m.acceptedAt.toISOString() : null,
      overdue: !!m.dueDate && m.dueDate < today && !m.doneAt,
      value: m.value,
    })),
    lines,
    planTotal: fmt(planTotal, 2),
    doneTotal: fmt(doneTotal, 2),
    acts: acts.items.map(a => ({ number: a.number, date: a.actDate, kind: a.kind, amount: a.totals.net, signed: a.status === 'signed' })),
    accepted: revenue.accepted ?? '0.00',
    invoiced: revenue.invoiced ?? '0.00',
    paid: revenue.paid ?? '0.00',
    contractValue,
    generatedAt: today,
  };
}
