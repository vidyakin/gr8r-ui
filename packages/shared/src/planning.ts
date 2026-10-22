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

/** Начало смены по умолчанию, если график его не задал */
export const DEFAULT_SHIFT_START = 9;

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

/* ---------------- часовой масштаб (услуги) ---------------- */

/** Часы смены: начало и конец в часах от полуночи. Конец не больше начала — смена через полночь */
export interface ShiftWindow {
  startHour: number;
  endHour: number;
}

/** Часы смены графика: из шаблона (startHour/endHour), иначе 09:00 и hours_per_day */
export function shiftOf(cal: CalendarDef | null): ShiftWindow {
  const c = cal ?? DEFAULT_CALENDAR;
  const start = c.pattern.startHour ?? DEFAULT_SHIFT_START;
  const hours = Number(c.hoursPerDay ?? '8');
  const length = Number.isFinite(hours) && hours > 0 ? hours : 0;
  const end = c.pattern.endHour ?? Math.min(24, start + length);
  return { startHour: start, endHour: end };
}

/** Смена переходит через полночь (вечерняя или ночная) */
export const shiftCrossesMidnight = (sh: ShiftWindow): boolean => sh.endHour <= sh.startHour;

/** Локальные дата и час момента в поясе (IANA) */
export function zonedParts(instant: Date, timeZone: string): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) };
}

/** Момент времени по локальной дате и часу в поясе (обратная задача к zonedParts) */
export function zonedInstant(date: string, hour: number, minute: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d, hour, minute);
  let guess = base;
  // смещение пояса уточняем дважды: вокруг перехода на летнее время одна итерация не хватает
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)) - 1, Number(p.date.slice(8, 10)), p.hour, p.minute);
    guess += base - asUtc;
  }
  return new Date(guess);
}

/** Смена дня: начало и конец в моментах времени */
export interface ShiftSpan {
  start: Date;
  end: Date;
}

/** Смена, начавшаяся в этот день. Смена через полночь заканчивается в следующем дне */
export function shiftSpan(cal: CalendarDef | null, date: string, timeZone: string): ShiftSpan {
  const sh = shiftOf(cal);
  const start = zonedInstant(date, sh.startHour, 0, timeZone);
  const crosses = shiftCrossesMidnight(sh);
  const endDay = crosses || sh.endHour >= 24 ? addDays(date, 1) : date;
  const endHour = sh.endHour >= 24 ? 0 : sh.endHour;
  return { start, end: zonedInstant(endDay, endHour, 0, timeZone) };
}

/** Смены, покрывающие локальный день: своя смена и хвост смены предыдущего дня (ночная смена) */
export function spansForDay(
  cal: CalendarDef | null,
  date: string,
  timeZone: string,
  holidays: string[] = [],
  exceptions: CalendarException[] = [],
): ShiftSpan[] {
  const spans: ShiftSpan[] = [];
  if (isWorkingDayWith(cal, date, holidays, exceptions)) spans.push(shiftSpan(cal, date, timeZone));
  const prev = addDays(date, -1);
  if (isWorkingDayWith(cal, prev, holidays, exceptions)) {
    const s = shiftSpan(cal, prev, timeZone);
    // хвост вчерашней смены живёт в сегодняшнем дне
    if (s.end > zonedInstant(date, 0, 0, timeZone)) spans.push(s);
  }
  return spans;
}

/** Строка часовой загрузки: сотрудник или ресурс */
export interface HourlyRow {
  id: string;
  rowType: 'member' | 'resource';
  name: string;
  /** Сколько единиц доступно одновременно: у сотрудника 1, у ресурса — его мощность */
  capacityUnits: number;
  /** График: рабочие дни и часы смены */
  calendar: CalendarDef | null;
}

/** Запись часовой загрузки: назначение заказ-наряда или работа ресурса */
export interface HourlyEntry {
  id: string;
  kind: 'assignment' | 'resource';
  title: string;
  rowType: 'member' | 'resource';
  rowId: string;
  /** Интервал работы (ISO 8601 с часовым поясом) */
  startAt: string;
  endAt: string;
  /** Плановые часы */
  hours: string;
  documentId?: string | null;
  taskId?: string | null;
  memberId?: string | null;
  resourceId?: string | null;
  /** Назначение запланировано по дням, без часов (даты задачи): показывается, но в часовую загрузку не входит */
  allDay?: boolean;
}

/** Слот часовой загрузки */
export interface HourlySlot {
  /** Начало слота (ISO 8601) */
  start: string;
  /** Конец слота (ISO 8601) */
  end: string;
  /** Занято часов в слоте */
  used: string;
  /** Доступно часов в слоте (ноль — нерабочее время) */
  capacity: string;
  /** Слот внутри смены */
  working: boolean;
  /** Перегрузка — предупреждение, не запрет */
  overloaded: boolean;
}

/** Предупреждение о перегрузке */
export interface HourlyWarning {
  code: 'member_overlap' | 'resource_overload' | 'outside_shift' | 'over_capacity';
  rowType: 'member' | 'resource';
  rowId: string;
  /** Записи, которых касается предупреждение */
  entryIds: string[];
  message: string;
}

export interface HourlyRowResult {
  rowId: string;
  rowType: 'member' | 'resource';
  name: string;
  capacityUnits: number;
  slots: HourlySlot[];
  /** Плановые часы записей за период */
  totalHours: string;
  /** Занятое время (пересечения интервалов), ч */
  bookedHours: string;
  overloaded: boolean;
}

export interface HourlyLoadResult {
  rows: HourlyRowResult[];
  entries: HourlyEntry[];
  warnings: HourlyWarning[];
  /** Пояс, в котором считаются смены */
  timeZone: string;
}

export interface HourlyLoadOptions {
  /** Пояс воркспейса: часы смены и границы дней считаются в нём */
  timeZone?: string;
  holidays?: string[];
  exceptionsByScope?: ExceptionsByScope;
  /** Длина слота, минут (60 — час, 30 — полчаса) */
  slotMinutes?: number;
}

const hours2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);
const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;

/** Пересечение двух интервалов в минутах */
function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Часовая загрузка: пересечения интервалов исполнителя и ресурсов, перегрузка и работа вне смены.
 * Перегрузка — предупреждение: план сохраняется в любом случае.
 */
export function computeHourlyLoad(rows: HourlyRow[], entries: HourlyEntry[], from: string, to: string, opts: HourlyLoadOptions = {}): HourlyLoadResult {
  const timeZone = opts.timeZone ?? 'UTC';
  const holidays = opts.holidays ?? [];
  const exceptionsByScope = opts.exceptionsByScope ?? {};
  const slotMinutes = opts.slotMinutes ?? 60;
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const warnings: HourlyWarning[] = [];
  const results: HourlyRowResult[] = [];

  const dayFrom = zonedParts(new Date(fromMs), timeZone).date;
  const dayTo = zonedParts(new Date(toMs), timeZone).date;
  const days = dateRange(dayFrom, dayTo);
  const slotsPerHour = Math.max(1, Math.round(60 / slotMinutes));

  for (const row of rows) {
    const exc = exceptionsFor(exceptionsByScope, row.rowType, row.id);
    const rowEntries = entries.filter(e => e.rowType === row.rowType && e.rowId === row.id);
    // записи дневного плана (без часов) в часовую загрузку и предупреждения не входят
    const parsed = rowEntries
      .filter(e => !e.allDay)
      .map(e => ({ entry: e, start: new Date(e.startAt).getTime(), end: new Date(e.endAt).getTime() }))
      .filter(e => Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start && e.end > fromMs && e.start < toMs);

    // смены по дням: свои и хвосты ночных смен предыдущих дней
    const spansByDay = new Map<string, ShiftSpan[]>();
    /** Своя смена дня — по ней считаем занятость смены */
    const ownSpans = new Map<string, ShiftSpan>();
    for (const day of [addDays(dayFrom, -1), ...days]) {
      const spans = spansForDay(row.calendar, day, timeZone, holidays, exc);
      spansByDay.set(day, spans);
      if (isWorkingDayWith(row.calendar, day, holidays, exc)) ownSpans.set(day, shiftSpan(row.calendar, day, timeZone));
    }

    const slots: HourlySlot[] = [];
    let bookedMs = 0;

    for (const day of days) {
      const spans = spansByDay.get(day) ?? [];
      for (let h = 0; h < 24; h++) {
        for (let s = 0; s < slotsPerHour; s++) {
          const slotStart = zonedInstant(day, h, s * slotMinutes, timeZone).getTime();
          const slotEnd = slotStart + slotMinutes * MS_MIN;
          if (slotEnd <= fromMs || slotStart >= toMs) continue;
          const working = spans.some(sp => sp.start.getTime() <= slotStart && slotEnd <= sp.end.getTime());
          let usedMs = 0;
          for (const e of parsed) usedMs += overlapMinutes(slotStart, slotEnd, e.start, e.end);
          const capacityHours = working ? (slotMinutes / 60) * row.capacityUnits : 0;
          const usedHours = usedMs / MS_HOUR;
          slots.push({
            start: new Date(slotStart).toISOString(),
            end: new Date(slotEnd).toISOString(),
            used: hours2(usedHours),
            capacity: hours2(capacityHours),
            working,
            overloaded: usedHours > capacityHours + 1e-9,
          });
        }
      }
    }

    // занятое время по сменам и работа вне смены
    for (const e of parsed) {
      const start = Math.max(e.start, fromMs);
      const end = Math.min(e.end, toMs);
      // интервал может переходить через полночь — покрытие считаем по сменам
      let covered = 0;
      for (const [, sp] of ownSpans) covered += overlapMinutes(start, end, sp.start.getTime(), sp.end.getTime());
      bookedMs += covered;
      if (covered < end - start) {
        warnings.push({
          code: 'outside_shift',
          rowType: row.rowType,
          rowId: row.id,
          entryIds: [e.entry.id],
          message: `${e.entry.title} is planned outside the working hours of ${row.name}`,
        });
      }
    }

    // две записи одного сотрудника в одно время; ресурс занят больше своей мощности
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        if (overlapMinutes(parsed[i]!.start, parsed[i]!.end, parsed[j]!.start, parsed[j]!.end) <= 0) continue;
        if (row.rowType === 'member') {
          warnings.push({
            code: 'member_overlap',
            rowType: row.rowType,
            rowId: row.id,
            entryIds: [parsed[i]!.entry.id, parsed[j]!.entry.id],
            message: `${parsed[i]!.entry.title} and ${parsed[j]!.entry.title} overlap: ${row.name} is booked twice at the same time`,
          });
        }
      }
    }
    if (row.rowType === 'resource') {
      // одновременно идущих работ больше мощности ресурса: проход по началам и концам интервалов
      const points = parsed.flatMap(e => [{ at: e.start, delta: 1, e }, { at: e.end, delta: -1, e }]).sort((a, b) => a.at - b.at || a.delta - b.delta);
      const running = new Set<(typeof parsed)[number]>();
      let group: Set<(typeof parsed)[number]> | null = null;
      let peak = 0;
      const flush = () => {
        if (!group) return;
        warnings.push({
          code: 'resource_overload',
          rowType: row.rowType,
          rowId: row.id,
          entryIds: [...group].map(x => x.entry.id),
          message: `${row.name} is busy with ${peak} works at once, its capacity is ${row.capacityUnits}`,
        });
        group = null;
        peak = 0;
      };
      for (const p of points) {
        if (p.delta > 0) running.add(p.e);
        else running.delete(p.e);
        if (running.size > row.capacityUnits) {
          group ??= new Set();
          for (const x of running) group.add(x);
          peak = Math.max(peak, running.size);
        } else flush();
      }
      flush();
    }

    // плановое время больше длительности смены
    for (const [day, sp] of ownSpans) {
      const booked = parsed.reduce((sum, e) => sum + overlapMinutes(Math.max(e.start, fromMs), Math.min(e.end, toMs), sp.start.getTime(), sp.end.getTime()), 0);
      const capacityMs = (sp.end.getTime() - sp.start.getTime()) * row.capacityUnits;
      if (booked > capacityMs + MS_MIN / 2) {
        warnings.push({
          code: 'over_capacity',
          rowType: row.rowType,
          rowId: row.id,
          entryIds: parsed.filter(e => overlapMinutes(Math.max(e.start, fromMs), Math.min(e.end, toMs), sp.start.getTime(), sp.end.getTime()) > 0).map(e => e.entry.id),
          message: `${row.name} is booked for ${hours2(booked / MS_HOUR)} h on ${day}, the shift is ${hours2(capacityMs / MS_HOUR)} h`,
        });
      }
    }

    const totalHours = parsed.reduce((sum, e) => sum + Number(e.entry.hours || 0), 0);
    results.push({
      rowId: row.id,
      rowType: row.rowType,
      name: row.name,
      capacityUnits: row.capacityUnits,
      slots,
      totalHours: hours2(totalHours),
      bookedHours: hours2(bookedMs / MS_HOUR),
      overloaded: slots.some(s => s.overloaded) || warnings.some(w => w.rowId === row.id),
    });
  }

  return { rows: results, entries, warnings, timeZone };
}
