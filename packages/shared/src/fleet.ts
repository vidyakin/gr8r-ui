/* Автопарк (задача 1210, docs/architecture/fleet.md): справочные константы, нормы расхода топлива, сроки документов,
   регламент ТО и разбор выписки по топливным картам. Чистые функции без БД — их вызывают сервер и интерфейс. */
import { addDaysIso } from './appointments';
import { dec, div, fmt, mul, type Dec } from './decimal';

export { addDaysIso };

export const VEHICLE_KINDS = ['car', 'van', 'truck', 'tractor', 'trailer', 'special', 'misc'] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];
export const FUEL_TYPES = ['petrol', 'diesel', 'gas', 'electric'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
export const VEHICLE_STATUSES = ['active', 'repair', 'inactive'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

/** Виды документов со сроками: чьи они — машины или водителя */
export const FLEET_DOC_KINDS = {
  osago: 'vehicle',
  kasko: 'vehicle',
  inspection: 'vehicle',
  tachograph: 'vehicle',
  registration: 'vehicle',
  vehicle_other: 'vehicle',
  license: 'driver',
  medical: 'driver',
  driver_other: 'driver',
} as const;
export type FleetDocKind = keyof typeof FLEET_DOC_KINDS;
export const FLEET_DOC_KIND_LIST = Object.keys(FLEET_DOC_KINDS) as [FleetDocKind, ...FleetDocKind[]];
export type FleetDocOwner = 'vehicle' | 'driver';

/** Без действующего ОСАГО и прав выпускать машину на линию нельзя */
export const WAYBILL_BLOCKING_DOCS: Record<FleetDocOwner, readonly FleetDocKind[]> = { vehicle: ['osago'], driver: ['license'] };

export const WAYBILL_STATUSES = ['draft', 'issued', 'closed', 'cancelled'] as const;
export type WaybillStatus = (typeof WAYBILL_STATUSES)[number];
export const REPAIR_KINDS = ['maintenance', 'repair'] as const;
export type RepairKind = (typeof REPAIR_KINDS)[number];
export const REPAIR_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];
export const REPAIR_LINE_KINDS = ['part', 'work'] as const;
export const FINE_STATUSES = ['unpaid', 'paid', 'appealed'] as const;
export type FineStatus = (typeof FINE_STATUSES)[number];

/** Системные статьи затрат (ключ → название); создаются вместе с остальными (documents.ensureCostItems) */
export const FLEET_COST_ITEMS = [
  { key: 'gsm', name: 'ГСМ' },
  { key: 'remont_transporta', name: 'Ремонт и ТО транспорта' },
  { key: 'shtrafy_gibdd', name: 'Штрафы ГИБДД' },
] as const;
export const FLEET_FUEL_COST_KEY = 'gsm';
export const FLEET_REPAIR_COST_KEY = 'remont_transporta';
export const FLEET_FINE_COST_KEY = 'shtrafy_gibdd';

/** События документов со сроками (триггер автоматизаций «Срок документа машины истекает») */
export const FLEET_DOC_EVENTS = ['expiring', 'expired'] as const;

/* ---------------- топливо ---------------- */

/** Зимний сезон по умолчанию: ноябрь — март (регионы утверждают свои периоды, поэтому месяцы можно передать) */
export const DEFAULT_WINTER_MONTHS: readonly number[] = [11, 12, 1, 2, 3];
export const fuelSeason = (date: string, winterMonths: readonly number[] = DEFAULT_WINTER_MONTHS): 'summer' | 'winter' =>
  winterMonths.includes(Number(date.slice(5, 7))) ? 'winter' : 'summer';

/** Норма на 100 км на дату: зимняя, если задана и сезон зимний; иначе летняя */
export function fuelNormPer100(norms: { summer: string | null; winter: string | null }, date: string, winterMonths?: readonly number[]): string {
  const season = fuelSeason(date, winterMonths);
  const v = season === 'winter' && norms.winter && dec(norms.winter) > 0n ? norms.winter : norms.summer;
  return v ?? '0';
}

/** Расход по норме, л: пробег × норма / 100 */
export function fuelNormLiters(distanceKm: string, normPer100: string): string {
  return fmt(div(mul(dec(distanceKm), dec(normPer100)), dec('100')), 3);
}

export interface WaybillFuelInput {
  fuelOut: string;
  fuelBack: string | null;
  /** Заправлено за рейс (литры по заправкам листа) */
  fuelFilled: string;
  odometerOut: string;
  odometerBack: string | null;
  normPer100: string;
}
export interface WaybillFuelResult {
  distanceKm: string;
  normLiters: string;
  /** Факт: остаток при выезде + заправлено − остаток при возврате */
  actualLiters: string;
  /** Факт минус норма: больше нуля — перерасход */
  deltaLiters: string;
  /** Фактический расход, л/100 км */
  actualPer100: string;
}

export function waybillFuel(i: WaybillFuelInput): WaybillFuelResult | null {
  if (i.odometerBack === null || i.fuelBack === null) return null;
  const km = dec(i.odometerBack) - dec(i.odometerOut);
  if (km < 0n) return null;
  const norm = div(mul(km, dec(i.normPer100)), dec('100'));
  const actual = dec(i.fuelOut) + dec(i.fuelFilled) - dec(i.fuelBack);
  const per100 = km > 0n ? mul(div(actual, km), dec('100')) : 0n;
  return { distanceKm: fmt(km, 3), normLiters: fmt(norm, 3), actualLiters: fmt(actual, 3), deltaLiters: fmt(actual - norm, 3), actualPer100: fmt(per100, 2) };
}

/* ---------------- сроки документов ---------------- */

export type DocTermState = 'ok' | 'expiring' | 'expired' | 'unlimited';

export const daysBetweenIso = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Состояние срока: просрочен (дата прошла), истекает (осталось не больше remindDays), в порядке, бессрочный */
export function docTermState(validUntil: string | null, remindDays: number, today: string): { state: DocTermState; daysLeft: number | null } {
  if (!validUntil) return { state: 'unlimited', daysLeft: null };
  const daysLeft = daysBetweenIso(today, validUntil);
  return { state: daysLeft < 0 ? 'expired' : daysLeft <= remindDays ? 'expiring' : 'ok', daysLeft };
}

/* ---------------- регламент ТО ---------------- */

export interface ServicePlanInput {
  everyKm: number | null;
  everyMonths: number | null;
  lastKm: string | null;
  lastDate: string | null;
}
export interface ServiceDue {
  dueKm: string | null;
  dueDate: string | null;
  /** Осталось км и дней (отрицательные — просрочено) */
  leftKm: string | null;
  leftDays: number | null;
  overdue: boolean;
  /** Скоро: осталось менее 10% интервала по пробегу или 14 дней */
  soon: boolean;
}

export function addMonthsIso(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export function serviceDue(plan: ServicePlanInput, odometer: string, today: string): ServiceDue {
  let dueKm: Dec | null = null;
  let dueDate: string | null = null;
  if (plan.everyKm && plan.lastKm !== null) dueKm = dec(plan.lastKm) + dec(String(plan.everyKm));
  if (plan.everyMonths && plan.lastDate) dueDate = addMonthsIso(plan.lastDate, plan.everyMonths);
  const leftKm = dueKm === null ? null : dueKm - dec(odometer);
  const leftDays = dueDate === null ? null : daysBetweenIso(today, dueDate);
  const overdue = (leftKm !== null && leftKm < 0n) || (leftDays !== null && leftDays < 0);
  const soonKm = leftKm !== null && plan.everyKm ? leftKm <= dec(String(Math.max(1, Math.round(plan.everyKm / 10)))) : false;
  const soon = !overdue && (soonKm || (leftDays !== null && leftDays <= 14));
  return { dueKm: dueKm === null ? null : fmt(dueKm, 0), dueDate, leftKm: leftKm === null ? null : fmt(leftKm, 0), leftDays, overdue, soon };
}

/* ---------------- выписка по топливным картам (CSV) ---------------- */

export interface FuelCsvRow {
  line: number;
  date: string;
  /** Номер топливной карты или госномер — по ним ищется машина */
  card: string;
  plate: string;
  liters: string;
  amount: string;
  station: string;
  odometer: string | null;
  error?: 'bad_date' | 'bad_liters' | 'bad_amount' | 'no_vehicle';
}

const HEADERS: Record<string, string[]> = {
  date: ['date', 'дата', 'дата операции', 'дата и время', 'время'],
  card: ['card', 'карта', 'номер карты', 'топливная карта'],
  plate: ['plate', 'госномер', 'гос. номер', 'гос номер', 'номер ам', 'тс'],
  liters: ['liters', 'litres', 'литры', 'количество', 'объем', 'объём', 'кол-во'],
  amount: ['amount', 'сумма', 'стоимость', 'сумма операции'],
  station: ['station', 'азс', 'место', 'адрес', 'точка'],
  odometer: ['odometer', 'пробег', 'одометр', 'показания'],
};

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const num = (s: string): string | null => {
  const v = s.replace(/\s| /g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(v) ? v : null;
};

/** Дата в выписке: 2026-10-30, 30.10.2026 или 30.10.2026 14:05 */
export function parseCsvDate(s: string): string | null {
  const t = s.trim();
  let iso: string | null = null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) iso = `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(t);
  if (m) iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  // несуществующая дата (13-й месяц, 31 февраля) — ошибка строки
  const d = iso ? new Date(`${iso}T00:00:00Z`) : null;
  return iso && d && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Разбор выписки: разделитель `;` или `,`, заголовки по-русски или по-английски. Строка с ошибкой получает `error` */
export function parseFuelCsv(text: string): FuelCsvRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0]!.match(/;/g)?.length ?? 0) >= (lines[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  const head = splitCsvLine(lines[0]!, sep).map(h => h.toLowerCase());
  const idx: Record<string, number> = {};
  for (const [key, names] of Object.entries(HEADERS)) idx[key] = head.findIndex(h => names.includes(h));
  const out: FuelCsvRow[] = [];
  for (let n = 1; n < lines.length; n++) {
    const cells = splitCsvLine(lines[n]!, sep);
    const get = (k: string) => (idx[k]! >= 0 ? cells[idx[k]!] ?? '' : '');
    const date = parseCsvDate(get('date'));
    const liters = num(get('liters'));
    const amount = num(get('amount'));
    const row: FuelCsvRow = { line: n + 1, date: date ?? '', card: get('card'), plate: get('plate'), liters: liters ?? '', amount: amount ?? '', station: get('station'), odometer: num(get('odometer')) };
    if (!date) row.error = 'bad_date';
    else if (!liters || dec(liters) <= 0n) row.error = 'bad_liters';
    else if (!amount || dec(amount) < 0n) row.error = 'bad_amount';
    else if (!row.card && !row.plate) row.error = 'no_vehicle';
    out.push(row);
  }
  return out;
}
