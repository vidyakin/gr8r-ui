/* Запись на приём (задача 1171): чистые правила слотов без БД — сетка недели, исключения, праздники, пересечения, поиск свободного.
   Время — минуты от полуночи, даты — YYYY-MM-DD в часовом поясе воркспейса. Раздел docs/architecture/appointments.md. */

export const SLOT_MINUTES = [15, 30, 45, 60, 90] as const;
export const APPOINTMENT_STATUSES = ['booked', 'confirmed', 'came', 'no_show', 'cancelled'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
/** Статусы, занимающие время специалиста: отмена и неявка слоты освобождают */
export const OCCUPYING_STATUSES: AppointmentStatus[] = ['booked', 'confirmed', 'came'];
/** Допустимые переходы статуса записи */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ['confirmed', 'came', 'no_show', 'cancelled'],
  confirmed: ['came', 'no_show', 'cancelled'],
  came: [],
  no_show: [],
  cancelled: [],
};
export const canMoveStatus = (from: AppointmentStatus, to: AppointmentStatus): boolean => APPOINTMENT_TRANSITIONS[from].includes(to);

export interface ScheduleDef {
  slotMinutes: number;
  dayStartMin: number;
  dayEndMin: number;
  /** День недели '1'..'7' (1 — понедельник) → начала рабочих слотов */
  week: Record<string, number[]>;
}
export interface ScheduleException {
  date: string;
  /** null — выходной; массив — свой набор слотов на этот день */
  slots: number[] | null;
}
export interface BusyRange {
  startMin: number;
  endMin: number;
}

/** День недели 1–7 (1 — понедельник) по дате YYYY-MM-DD */
export function weekdayOf(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Понедельник недели, в которую входит дата */
export const weekStartOf = (date: string): string => addDaysIso(date, 1 - weekdayOf(date));

/** Все начала слотов сетки от начала до конца дня */
export function gridStarts(def: Pick<ScheduleDef, 'slotMinutes' | 'dayStartMin' | 'dayEndMin'>): number[] {
  const out: number[] = [];
  for (let s = def.dayStartMin; s + def.slotMinutes <= def.dayEndMin; s += def.slotMinutes) out.push(s);
  return out;
}
/** Слот лежит на сетке графика */
export const isGridStart = (def: Pick<ScheduleDef, 'slotMinutes' | 'dayStartMin' | 'dayEndMin'>, start: number): boolean =>
  start >= def.dayStartMin && start + def.slotMinutes <= def.dayEndMin && (start - def.dayStartMin) % def.slotMinutes === 0;

/** Рабочие слоты дня: недельная сетка → исключение на дату (заменяет сетку) → праздник (день без слотов, если нет своего исключения) */
export function workingSlots(def: ScheduleDef, date: string, exceptions: ScheduleException[] = [], holidays: string[] = []): number[] {
  const ex = exceptions.find(e => e.date === date);
  let base: number[];
  if (ex) base = ex.slots ?? [];
  else if (holidays.includes(date)) base = [];
  else base = def.week[String(weekdayOf(date))] ?? [];
  return [...new Set(base)].filter(s => isGridStart(def, s)).sort((a, b) => a - b);
}

/** Сколько слотов подряд занимает приём длительностью durationMin (минимум один) */
export const slotsNeeded = (durationMin: number | null | undefined, slotMinutes: number): number => Math.max(1, Math.ceil((durationMin && durationMin > 0 ? durationMin : slotMinutes) / slotMinutes));

export type PlacementError = 'outside_slots' | 'overlap';

/** Запись [startMin, startMin + slots × slotMinutes) помещается в рабочие слоты подряд и не пересекает занятое */
export function checkPlacement(input: { working: number[]; slotMinutes: number; startMin: number; slots: number; busy: BusyRange[] }): PlacementError | null {
  const set = new Set(input.working);
  for (let i = 0; i < input.slots; i++) if (!set.has(input.startMin + i * input.slotMinutes)) return 'outside_slots';
  const end = input.startMin + input.slots * input.slotMinutes;
  if (input.busy.some(b => input.startMin < b.endMin && b.startMin < end)) return 'overlap';
  return null;
}

/** Начала, с которых приём из `slots` слотов подряд помещается и никому не мешает */
export function freeStarts(input: { working: number[]; slotMinutes: number; slots: number; busy: BusyRange[] }): number[] {
  return input.working.filter(s => checkPlacement({ ...input, startMin: s }) === null);
}

export interface FreeCandidate {
  memberId: string;
  date: string;
  def: ScheduleDef;
  working: number[];
  busy: BusyRange[];
}
export interface FreeSlot {
  memberId: string;
  date: string;
  startMin: number;
  slots: number;
}
/** Ближайшее свободное время под услугу: по дате, затем по времени, затем по порядку кандидатов. `from` — дата и минуты, раньше которых не ищем */
export function findNearestFree(candidates: FreeCandidate[], durationMin: number | null | undefined, from: { date: string; startMin: number }): FreeSlot | null {
  let best: FreeSlot | null = null;
  for (const c of candidates) {
    if (c.date < from.date) continue;
    const slots = slotsNeeded(durationMin, c.def.slotMinutes);
    for (const s of freeStarts({ working: c.working, slotMinutes: c.def.slotMinutes, slots, busy: c.busy })) {
      if (c.date === from.date && s < from.startMin) continue;
      if (!best || c.date < best.date || (c.date === best.date && s < best.startMin)) best = { memberId: c.memberId, date: c.date, startMin: s, slots };
      break;
    }
  }
  return best;
}

/** «09:30» из минут */
export const minToHm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
