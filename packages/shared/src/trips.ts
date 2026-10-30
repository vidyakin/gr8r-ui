/* Рейсы (задача 1211, docs/architecture/trips.md): справочные константы, загрузка машины по точкам объезда, расстояние по прямой,
   проверка временных окон. Чистые функции без БД — их вызывают сервер и интерфейс. */
import { dec, fmt, type Dec } from './decimal';

export const TRIP_KINDS = ['city', 'intercity'] as const;
export type TripKind = (typeof TRIP_KINDS)[number];
export const TRIP_STATUSES = ['planned', 'in_transit', 'done', 'cancelled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
/** Погрузка, выгрузка, доставка (груз развозится с начала рейса) */
export const STOP_KINDS = ['load', 'unload', 'delivery'] as const;
export type StopKind = (typeof STOP_KINDS)[number];
export const STOP_STATUSES = ['planned', 'arrived', 'done', 'failed'] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];
/** Откуда взялась точка: вручную, из доставки документа; заявка на перевозку (задача 1223) добавит свой вид */
export const STOP_SOURCES = ['manual', 'delivery', 'transport_order'] as const;
export type StopSource = (typeof STOP_SOURCES)[number];
/** Предупреждение о превышении вместимости или запрет */
export const TRIP_CAPACITY_MODES = ['warn', 'block'] as const;
export type TripCapacityMode = (typeof TRIP_CAPACITY_MODES)[number];
export const TRIP_CAPACITY_SETTING = 'tripCapacityMode';

export interface StopCargo {
  seq: number;
  kind: StopKind;
  weightKg: string;
  volumeM3: string;
  pallets: number;
  /** Точка не считается, если уже не едем туда (не доставлено) — пока в расчёте участвуют все точки */
  status?: StopStatus;
}

export interface TripLoad {
  weightKg: string;
  volumeM3: string;
  pallets: number;
}

export interface VehicleLimits {
  capacityKg: string | null;
  volumeM3: string | null;
  pallets: number | null;
}

export type OverloadKind = 'weight' | 'volume' | 'pallets';
export interface Overload {
  kind: OverloadKind;
  peak: string;
  limit: string;
}

/** Пиковая загрузка за рейс. Груз точек «доставка» лежит в машине с начала рейса; «погрузка» добавляет, «выгрузка» и «доставка» снимают */
export function tripPeakLoad(stops: readonly StopCargo[]): TripLoad {
  const sorted = [...stops].sort((a, b) => a.seq - b.seq);
  let w: Dec = 0n;
  let v: Dec = 0n;
  let p = 0;
  for (const s of sorted)
    if (s.kind === 'delivery') {
      w += dec(s.weightKg);
      v += dec(s.volumeM3);
      p += s.pallets;
    }
  let pw = w;
  let pv = v;
  let pp = p;
  for (const s of sorted) {
    const sign = s.kind === 'load' ? 1n : -1n;
    w += sign * dec(s.weightKg);
    v += sign * dec(s.volumeM3);
    p += s.kind === 'load' ? s.pallets : -s.pallets;
    if (w > pw) pw = w;
    if (v > pv) pv = v;
    if (p > pp) pp = p;
  }
  return { weightKg: fmt(pw, 3), volumeM3: fmt(pv, 3), pallets: pp };
}

/** Что превышено: лимит `null` — не ограничен */
export function tripOverloads(load: TripLoad, limits: VehicleLimits): Overload[] {
  const out: Overload[] = [];
  if (limits.capacityKg !== null && dec(load.weightKg) > dec(limits.capacityKg)) out.push({ kind: 'weight', peak: load.weightKg, limit: fmt(dec(limits.capacityKg), 3) });
  if (limits.volumeM3 !== null && dec(load.volumeM3) > dec(limits.volumeM3)) out.push({ kind: 'volume', peak: load.volumeM3, limit: fmt(dec(limits.volumeM3), 3) });
  if (limits.pallets !== null && load.pallets > limits.pallets) out.push({ kind: 'pallets', peak: String(load.pallets), limit: String(limits.pallets) });
  return out;
}

/** Расстояние по прямой между двумя точками, км (формула гаверсинусов) */
export function straightKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface RoutePoint {
  lat: number | null;
  lon: number | null;
}

/** Длина маршрута по прямой в порядке точек, км (с одним знаком). Участки, где нет координат, пропускаются; пусто — нет ни одного участка */
export function routeStraightKm(points: readonly RoutePoint[]): { km: string; legs: (string | null)[] } | null {
  const legs: (string | null)[] = [null];
  let total = 0;
  let any = false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.lat === null || a.lon === null || b.lat === null || b.lon === null) {
      legs.push(null);
      continue;
    }
    const d = straightKm({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
    total += d;
    any = true;
    legs.push(d.toFixed(1));
  }
  return any ? { km: total.toFixed(1), legs } : null;
}

export interface StopWindow {
  seq: number;
  windowFrom: string | null;
  windowTo: string | null;
}

/** Точки, порядок которых противоречит окнам: окно закончилось раньше, чем началось окно предыдущей точки (номера `seq`) */
export function windowOrderConflicts(stops: readonly StopWindow[]): number[] {
  const sorted = [...stops].sort((a, b) => a.seq - b.seq);
  const bad: number[] = [];
  let maxFrom = '';
  for (const s of sorted) {
    if (s.windowTo && maxFrom && s.windowTo.slice(0, 5) < maxFrom) bad.push(s.seq);
    if (s.windowFrom && s.windowFrom.slice(0, 5) > maxFrom) maxFrom = s.windowFrom.slice(0, 5);
  }
  return bad;
}

/** Пересекаются ли два интервала рейсов. Без времени рейс занимает весь день; границы включены */
export function tripsOverlap(a: TripSpan, b: TripSpan): boolean {
  const s = (x: TripSpan) => `${x.dateFrom}T${x.startTime?.slice(0, 5) ?? '00:00'}`;
  const e = (x: TripSpan) => `${x.dateTo}T${x.endTime?.slice(0, 5) ?? '23:59'}`;
  return s(a) < e(b) && s(b) < e(a);
}
export interface TripSpan {
  dateFrom: string;
  dateTo: string;
  startTime?: string | null;
  endTime?: string | null;
}

/** Статус доставки по статусу точки и рейса */
export function deliveryStatusOfStop(stop: StopStatus, tripStatus: TripStatus): 'assigned' | 'in_transit' | 'delivered' | 'failed' {
  if (stop === 'done') return 'delivered';
  if (stop === 'failed') return 'failed';
  return tripStatus === 'in_transit' ? 'in_transit' : 'assigned';
}
