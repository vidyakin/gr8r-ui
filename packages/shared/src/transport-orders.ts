/* Заявки на перевозку, тарифы по направлениям, доход/затраты и маржа рейса, экспедирование (задача 1223,
   docs/plans/2026-10-30-tms.md, п. 8). Чистые функции без БД — вызывают сервер и интерфейс. */
import { dec, div, fmt, mul, type Dec } from './decimal';

export const TRANSPORT_RATE_KINDS = ['flat', 'per_km', 'per_ton'] as const;
export type TransportRateKind = (typeof TRANSPORT_RATE_KINDS)[number];

export const TRANSPORT_ORDER_STATUSES = ['draft', 'confirmed', 'in_progress', 'done', 'cancelled'] as const;
export type TransportOrderStatus = (typeof TRANSPORT_ORDER_STATUSES)[number];
/** Статусы, после которых заявку нельзя редактировать свободно (как и у документов продаж — только отмена) */
export const TRANSPORT_ORDER_FINAL: readonly TransportOrderStatus[] = ['done', 'cancelled'];

export interface TransportRateInput {
  rateKind: TransportRateKind;
  rate: string;
}

/** Сумма по ставке: flat — сама ставка, per_km — ставка × расстояние, per_ton — ставка × вес в тоннах (округление веса вверх до 1 кг не нужно — тонны считаются долями) */
export function computeTransportRateAmount(input: TransportRateInput, ctx: { distanceKm?: string | null; weightKg?: string | null }): string {
  const rate = dec(input.rate);
  if (input.rateKind === 'per_km') return fmt(mul(rate, dec(ctx.distanceKm ?? '0')), 2);
  if (input.rateKind === 'per_ton') return fmt(mul(rate, div(dec(ctx.weightKg ?? '0'), dec('1000'))), 2);
  return fmt(rate, 2);
}

/** Маржа рейса: доход (сумма ставок заявок рейса) минус затраты (топливо+ремонт+штрафы автопарка за период рейса,
    ставка наёмному перевозчику, прочие затраты рейса статьями). Все суммы — строки decimal, результат тоже. */
export interface TripMarginInput {
  /** Сумма ставок клиентам по заявкам, закреплённым за рейсом */
  ordersAmount: string;
  /** Затраты автопарка: топливо, ремонт, штрафы (fleetCosts по машине рейса за его период) */
  fleetFuelAmount?: string;
  fleetRepairAmount?: string;
  fleetFinesAmount?: string;
  /** Ставка наёмному перевозчику (экспедирование), пусто — рейс свой */
  carrierRate?: string | null;
  /** Прочие затраты рейса статьями (fleet_trip_costs) */
  otherCosts?: string;
}

export interface TripMarginResult {
  income: string;
  /** Затраты без учёта наёмного перевозчика — для своего рейса это полные затраты */
  fleetCosts: string;
  carrierRate: string;
  otherCosts: string;
  totalCosts: string;
  margin: string;
  /** Маржа в процентах от дохода; доход 0 — null */
  marginPct: string | null;
}

export function computeTripMargin(input: TripMarginInput): TripMarginResult {
  const income = dec(input.ordersAmount);
  const fleetCosts = dec(input.fleetFuelAmount ?? '0') + dec(input.fleetRepairAmount ?? '0') + dec(input.fleetFinesAmount ?? '0');
  const carrierRate = dec(input.carrierRate ?? '0');
  const otherCosts = dec(input.otherCosts ?? '0');
  const totalCosts = fleetCosts + carrierRate + otherCosts;
  const margin = income - totalCosts;
  const marginPct = income > 0n ? fmt(div(mul(margin, dec('100')), income), 2) : null;
  return {
    income: fmt(income, 2),
    fleetCosts: fmt(fleetCosts, 2),
    carrierRate: fmt(carrierRate, 2),
    otherCosts: fmt(otherCosts, 2),
    totalCosts: fmt(totalCosts, 2),
    margin: fmt(margin, 2),
    marginPct,
  };
}

/** Экспедирование: маржа экспедитора по одному рейсу = сумма ставок клиентам минус ставка перевозчику (без прочих затрат —
    у наёмного рейса свой транспорт несёт остальные расходы) */
export function computeForwardingMargin(ordersAmount: string, carrierRate: string): { margin: string; marginPct: string | null } {
  const income = dec(ordersAmount);
  const cost = dec(carrierRate);
  const margin = income - cost;
  return { margin: fmt(margin, 2), marginPct: income > 0n ? fmt(div(mul(margin, dec('100')), income), 2) : null };
}

/** Подсказка ставки из тарифа направления: совпадение по откуда/куда (без учёта регистра) и, если задан, типу кузова */
export interface TransportRateScheduleLike {
  fromPlace: string;
  toPlace: string;
  bodyType: string;
  rateKind: TransportRateKind;
  rate: string;
  distanceKm: string | null;
}

export function findRateSchedule(schedules: TransportRateScheduleLike[], q: { fromPlace: string; toPlace: string; bodyType?: string }): TransportRateScheduleLike | null {
  const norm = (s: string) => s.trim().toLowerCase();
  const matches = schedules.filter(s => norm(s.fromPlace) === norm(q.fromPlace) && norm(s.toPlace) === norm(q.toPlace));
  if (matches.length === 0) return null;
  if (q.bodyType) {
    const bodyType = q.bodyType;
    const exact = matches.find(s => s.bodyType && norm(s.bodyType) === norm(bodyType));
    if (exact) return exact;
  }
  return matches.find(s => !s.bodyType) ?? matches[0]!;
}

export type { Dec };
