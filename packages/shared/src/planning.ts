/* Планирование загрузки ресурсов: сменные графики, расчёт загрузки и перегрузки, автопланирование.
   Чистые функции — одна и та же логика на сервере, в тестах и (при необходимости) в интерфейсе.

   Графики: недельный (рабочие дни недели) и циклический (2/2, сутки через трое) с датой начала цикла.
   Праздники воркспейса и исключения (отпуск, больничный, ремонт) убирают рабочий день у сотрудника,
   участка или ресурса. Перегрузка — предупреждение: план сохраняется в любом случае. */
import { add, dec, fmt, mul, roundDiv, type Dec } from './decimal';

/** Единица в масштабе Dec (10^-6) */
const ONE = 10n ** 6n;

/* ---------------- графики ---------------- */

export const CALENDAR_KINDS = ['weekly', 'cycle'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

/** Недельный: weekdays — дни недели (1 — понедельник … 7 — воскресенье), startHour/endHour — часы смены.
    Циклический: cycle — массив дней цикла (1 — рабочий, 0 — выходной), отсчёт от cycleStart. */
export interface CalendarPattern {
  weekdays?: number[];
  startHour?: number;
  endHour?: number;
  cycle?: number[];
}

/** Рабочий график в расчётах */
export interface CalendarDef {
  id: string | null;
  kind: CalendarKind;
  pattern: CalendarPattern;
  /** Дата начала цикла (циклический график) */
  cycleStart: string | null;
  /** Рабочих часов в день */
  hoursPerDay: string;
}

/** График по умолчанию: пятидневка, 8 часов (когда график не назначен) */
export const DEFAULT_CALENDAR: CalendarDef = { id: null, kind: 'weekly', pattern: { weekdays: [1, 2, 3, 4, 5] }, cycleStart: null, hoursPerDay: '8' };

/** Исключение из графика: нерабочие дни (отпуск, больничный, ремонт) */
export interface CalendarException {
  scope: 'member' | 'work_center' | 'resource';
  scopeId: string;
  dateFrom: string;
  dateTo: string;
}

/* ---------------- даты (строки YYYY-MM-DD, без времени) ---------------- */

export const parseDay = (d: string): Date => new Date(`${d.slice(0, 10)}T00:00:00Z`);
export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Сдвиг даты на n дней */
export function addDays(date: string, n: number): string {
  const d = parseDay(date);
  d.setUTCDate(d.getUTCDate() + n);
  return dayKey(d);
}

/** Разница в днях: b − a */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

/** День недели: 1 — понедельник … 7 — воскресенье */
export function weekday(date: string): number {
  const w = parseDay(date).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Список датов периода включительно */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const n = diffDays(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/* ---------------- рабочие дни ---------------- */

/** Рабочий ли день по графику (без праздников и исключений) */
export function isWorkingDay(cal: CalendarDef | null, date: string): boolean {
  const c = cal ?? DEFAULT_CALENDAR;
  if (c.kind === 'cycle') {
    const cycle = c.pattern.cycle ?? [];
    if (!cycle.length || !c.cycleStart) return false;
    const idx = ((diffDays(c.cycleStart, date) % cycle.length) + cycle.length) % cycle.length;
    return cycle[idx] === 1;
  }
  const days = c.pattern.weekdays?.length ? c.pattern.weekdays : DEFAULT_CALENDAR.pattern.weekdays!;
  return days.includes(weekday(date));
}

/** Рабочий ли день с учётом праздников и исключений */
export function isWorkingDayWith(
  cal: CalendarDef | null,
  date: string,
  holidays: string[] = [],
  exceptions: CalendarException[] = [],
): boolean {
  if (holidays.includes(date)) return false;
  if (exceptions.some(e => date >= e.dateFrom && date <= e.dateTo)) return false;
  return isWorkingDay(cal, date);
}

/** Мощность строки в день: часы по графику (в выходной — ноль) */
export function capacityOf(
  cal: CalendarDef | null,
  date: string,
  capacityHoursPerDay: string | null,
  holidays: string[] = [],
  exceptions: CalendarException[] = [],
): Dec {
  if (!isWorkingDayWith(cal, date, holidays, exceptions)) return 0n;
  if (capacityHoursPerDay !== null && capacityHoursPerDay !== '') return dec(capacityHoursPerDay);
  return dec((cal ?? DEFAULT_CALENDAR).hoursPerDay);
}

/* ---------------- загрузка ---------------- */

export const LOAD_ROW_TYPES = ['member', 'work_center', 'resource'] as const;
export type LoadRowType = (typeof LOAD_ROW_TYPES)[number];

/** Строка загрузки: сотрудник, участок или ресурс */
export interface LoadRow {
  id: string;
  rowType: LoadRowType;
  name: string;
  /** Мощность в день: пусто — берётся из графика */
  capacityHoursPerDay: string | null;
  calendar: CalendarDef | null;
}

/** Запись загрузки: операция, назначение или работа ресурса */
export interface LoadEntry {
  id: string;
  kind: 'operation' | 'assignment' | 'resource';
  title: string;
  rowType: LoadRowType;
  rowId: string;
  /** Даты (YYYY-MM-DD) */
  start: string;
  end: string;
  /** Часы */
  hours: string;
  documentId?: string | null;
  memberId?: string | null;
  workCenterId?: string | null;
  resourceId?: string | null;
  /** Назначение операции (производство) */
  assignmentId?: string | null;
  /** Задача исполнителя (назначение заказ-наряда) */
  taskId?: string | null;
}

/** День загрузки строки */
export interface LoadDay {
  date: string;
  /** Запланировано часов */
  hours: string;
  /** Мощность дня */
  capacity: string;
  /** Перегрузка (предупреждение) */
  overloaded: boolean;
}

/** Загрузка строки за период */
export interface LoadRowResult {
  rowId: string;
  rowType: LoadRowType;
  name: string;
  days: LoadDay[];
  /** Всего часов за период */
  totalHours: string;
  /** Есть перегруженные дни */
  overloaded: boolean;
}

/** Исключения по областям: сотрудник, участок, ресурс */
export type ExceptionsByScope = Record<string, CalendarException[]>;

export const exceptionsFor = (byScope: ExceptionsByScope, rowType: LoadRowType, rowId: string): CalendarException[] => byScope[`${rowType}:${rowId}`] ?? [];

/** Загрузка строк за период: часы по дням, мощность и перегрузка */
export function computeLoad(
  rows: LoadRow[],
  entries: LoadEntry[],
  from: string,
  to: string,
  holidays: string[] = [],
  exceptionsByScope: ExceptionsByScope = {},
): LoadRowResult[] {
  const days = dateRange(from, to);
  return rows.map(row => {
    const exc = exceptionsFor(exceptionsByScope, row.rowType, row.id);
    const rowEntries = entries.filter(e => e.rowType === row.rowType && e.rowId === row.id);
    const load = new Map<string, Dec>();
    for (const e of rowEntries) {
      const s = e.start <= e.end ? e.start : e.end;
      const en = e.start <= e.end ? e.end : e.start;
      const all = dateRange(s, en);
      // часы ложатся на рабочие дни строки; если рабочих дней в интервале нет — на все его дни
      const working = all.filter(d => capacityOf(row.calendar, d, row.capacityHoursPerDay, holidays, exc) > 0n);
      const span = working.length ? working : all;
      if (!span.length) continue;
      const per = roundDiv(dec(e.hours), BigInt(span.length));
      for (const d of span) load.set(d, add(load.get(d) ?? 0n, per));
    }
    const rowDays: LoadDay[] = days.map(d => {
      const hours = load.get(d) ?? 0n;
      const capacity = capacityOf(row.calendar, d, row.capacityHoursPerDay, holidays, exc);
      return { date: d, hours: fmt(hours, 2), capacity: fmt(capacity, 2), overloaded: hours > capacity };
    });
    const total = rowDays.reduce((s, d) => add(s, dec(d.hours)), 0n);
    return {
      rowId: row.id,
      rowType: row.rowType,
      name: row.name,
      days: rowDays,
      totalHours: fmt(total, 2),
      overloaded: rowDays.some(d => d.overloaded),
    };
  });
}

/* ---------------- автопланирование ---------------- */

/** Единица планирования: операция заказа */
export interface ScheduleUnit {
  id: string;
  /** Порядок этапа: меньше — раньше */
  stageOrder: number;
  /** Потребности по строкам загрузки: исполнитель, участок, ресурсы (часы могут различаться) */
  demands: { rowId: string; hours: string }[];
  /** Ручные даты: автопланирование их не двигает */
  manualStart?: string | null;
  manualEnd?: string | null;
}

/** Результат автопланирования */
export interface ScheduleUnitResult {
  id: string;
  start: string | null;
  end: string | null;
  hours: string;
  /** Уложились в свободную мощность */
  scheduled: boolean;
}

export interface ScheduleResult {
  units: ScheduleUnitResult[];
  /** Прогнозный финиш */
  forecastEnd: string | null;
}

/** Занятая мощность другими планами: rowId → дата → часы */
export type BusyLoad = Record<string, Record<string, string>>;

export interface AutoScheduleOptions {
  holidays?: string[];
  exceptionsByScope?: ExceptionsByScope;
  /** Занятая мощность другими заказами */
  busy?: BusyLoad;
  /** На сколько дней вперёд искать место (по умолчанию — 180) */
  maxDays?: number;
}

/**
 * Расстановка операций от даты старта по порядку этапов в пределах свободной мощности.
 * Ручные даты не двигаются: такая операция занимает своё место, а следующие идут после неё.
 */
export function autoSchedule(units: ScheduleUnit[], rows: LoadRow[], from: string, opts: AutoScheduleOptions = {}): ScheduleResult {
  const holidays = opts.holidays ?? [];
  const exceptionsByScope = opts.exceptionsByScope ?? {};
  const busy = opts.busy ?? {};
  const maxDays = opts.maxDays ?? 180;
  const byId = new Map(rows.map(r => [r.id, r]));
  // свободная мощность: остаток в каждой строке за каждый день
  const free = new Map<string, Map<string, Dec>>();
  const cap = (rowId: string, date: string): Dec => {
    const row = byId.get(rowId);
    if (!row) return 0n;
    return capacityOf(row.calendar, date, row.capacityHoursPerDay, holidays, exceptionsFor(exceptionsByScope, row.rowType, row.id));
  };
  const remaining = (rowId: string, date: string): Dec => {
    const row = byId.get(rowId);
    if (!row) return 0n;
    let left = cap(rowId, date);
    const used = busy[rowId]?.[date];
    if (used) left = left - dec(used);
    const own = free.get(rowId)?.get(date);
    if (own) left = left - own;
    return left > 0n ? left : 0n;
  };
  const spend = (rowId: string, date: string, hours: Dec) => {
    let m = free.get(rowId);
    if (!m) {
      m = new Map();
      free.set(rowId, m);
    }
    m.set(date, add(m.get(date) ?? 0n, hours));
  };

  const ordered = [...units].sort((a, b) => a.stageOrder - b.stageOrder);
  const results: ScheduleUnitResult[] = [];
  let cursor = from;
  let forecast: string | null = null;

  for (const u of ordered) {
    const demands = u.demands.filter(d => dec(d.hours) > 0n);
    // ручные даты не двигаем
    if (u.manualStart && u.manualEnd) {
      const s = u.manualStart <= u.manualEnd ? u.manualStart : u.manualEnd;
      const e = u.manualStart <= u.manualEnd ? u.manualEnd : u.manualStart;
      results.push({ id: u.id, start: s, end: e, hours: fmt(demands.reduce((a, d) => add(a, dec(d.hours)), 0n), 3), scheduled: true });
      if (!forecast || e > forecast) forecast = e;
      if (e >= cursor) cursor = addDays(e, 1);
      continue;
    }
    if (!demands.length) {
      results.push({ id: u.id, start: null, end: null, hours: '0.000', scheduled: false });
      continue;
    }
    // выполненная доля работы (масштаб 10^-6, как у Dec)
    let done = 0n;
    let start: string | null = null;
    let end: string | null = null;
    for (let i = 0; i < maxDays && done < ONE; i++) {
      const date = addDays(cursor, i);
      // какая доля работы помещается в этот день (по самой «тяжёлой» потребности)
      let frac = ONE;
      for (const d of demands) {
        const need = mul(dec(d.hours), ONE - done);
        if (need <= 0n) continue;
        const f = roundDiv(remaining(d.rowId, date) * ONE, need);
        if (f < frac) frac = f;
      }
      if (frac <= 0n) continue;
      for (const d of demands) {
        const need = mul(dec(d.hours), ONE - done);
        if (need <= 0n) continue;
        spend(d.rowId, date, mul(need, frac));
      }
      if (start === null) start = date;
      end = date;
      done += frac;
    }
    const hours = demands.reduce((a, d) => add(a, dec(d.hours)), 0n);
    if (start && end) {
      results.push({ id: u.id, start, end, hours: fmt(hours, 3), scheduled: done >= ONE });
      if (!forecast || end > forecast) forecast = end;
      cursor = addDays(end, 1);
    } else {
      results.push({ id: u.id, start: null, end: null, hours: fmt(hours, 3), scheduled: false });
    }
  }
  return { units: results, forecastEnd: forecast };
}

/** Часы работы ресурса на единицу: норматив умножается на количество */
export const resourceHours = (hoursPerUnit: string, qty: string): Dec => mul(dec(hoursPerUnit), dec(qty));
