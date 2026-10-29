/* Повторные продажи и планирование продаж (задача 1133, docs/architecture/repeat-sales.md): чистые правила без БД.
   Сервисы packages/db/src/repeat-sales.ts и sales-plan.ts собирают данные, интерфейс получает готовый план-факт. */
import { dec, div, fmt, mul } from './decimal';
import { periodOf, shiftPeriod, type BillingPeriodicity } from './billing';
import { addDays } from './planning';

/** Дата следующего контакта после продажи: дата документа + наименьший срок повтора из строк.
    Возвращает новую дату или null, если ставить нечего (сроков нет либо уже стоит более ранняя дата) */
export function nextContactAfterSale(docDate: string, termsDays: (number | null | undefined)[], current: string | null): string | null {
  const terms = termsDays.filter((d): d is number => typeof d === 'number' && d > 0);
  if (!terms.length) return null;
  const candidate = addDays(docDate.slice(0, 10), Math.min(...terms));
  return current && current <= candidate ? null : candidate;
}

/* ---------------- сценарии планирования ---------------- */

export const SALES_PLAN_PERIODICITIES = ['month', 'quarter', 'year'] as const;
export const SALES_PLAN_DIMENSIONS = ['manager', 'category', 'product'] as const;
export type SalesPlanDimension = (typeof SALES_PLAN_DIMENSIONS)[number];

/** Сколько периодов в планируемом годе документа */
export const SALES_PLAN_PERIODS_PER_YEAR: Record<BillingPeriodicity, number> = { month: 12, quarter: 4, year: 1 };

/** Начала периодов, покрывающих [from, to] по периодичности сценария */
export function periodStarts(periodicity: BillingPeriodicity, from: string, to: string): string[] {
  const out: string[] = [];
  let p = periodOf(periodicity, from);
  while (p.start <= to && out.length < 400) {
    out.push(p.start);
    p = shiftPeriod(periodicity, p, 1);
  }
  return out;
}

/** Начало плана → начало первого периода и периоды планируемого года документа */
export function planDocPeriods(periodicity: BillingPeriodicity, start: string): { first: string; periods: string[] } {
  const first = periodOf(periodicity, start).start;
  const periods: string[] = [first];
  let p = periodOf(periodicity, first);
  for (let i = 1; i < SALES_PLAN_PERIODS_PER_YEAR[periodicity]; i++) {
    p = shiftPeriod(periodicity, p, 1);
    periods.push(p.start);
  }
  return { first, periods };
}

/** Последний день периода, начинающегося в start */
export const periodEnd = (periodicity: BillingPeriodicity, start: string): string => periodOf(periodicity, start).end;

/* ---------------- план-факт ---------------- */

export interface PlanFigure {
  /** Начало периода */
  period: string;
  /** Значение разреза: id менеджера, категории или товара; null — «без менеджера/категории» */
  key: string | null;
  amount: string;
  qty: string;
}

export interface ForecastFigure {
  period: string;
  key: string | null;
  won: string;
  open: string;
  weighted: string;
}

export interface PlanFactCell {
  plan: string;
  fact: string;
  planQty: string;
  factQty: string;
  /** % выполнения плана; null, если плана нет */
  pct: string | null;
  /** Отклонение: факт − план */
  deviation: string;
  forecastWon: string;
  forecastOpen: string;
  /** Прогноз по сделкам с датой закрытия в периоде: выигранные + открытые */
  forecast: string;
  /** Взвешенный прогноз: выигранные + открытые × вероятность этапа */
  forecastWeighted: string;
}

export interface PlanFactRow {
  key: string | null;
  name: string | null;
  periods: PlanFactCell[];
  total: PlanFactCell;
}

export interface PlanFactReport {
  scenario: { id: string; name: string; periodicity: BillingPeriodicity; dimension: SalesPlanDimension };
  from: string;
  to: string;
  /** Начала периодов отчёта */
  periods: string[];
  rows: PlanFactRow[];
  /** Итоги по периодам и общий */
  totals: PlanFactCell[];
  total: PlanFactCell;
}

export interface PlanFactInput {
  periods: string[];
  /** Названия значений разреза (id → имя); значение без имени показывается по ключу */
  names: Map<string, string>;
  plan: PlanFigure[];
  fact: PlanFigure[];
  forecast: ForecastFigure[];
}

interface Acc { plan: bigint; fact: bigint; planQty: bigint; factQty: bigint; won: bigint; open: bigint; weighted: bigint }
const zero = (): Acc => ({ plan: 0n, fact: 0n, planQty: 0n, factQty: 0n, won: 0n, open: 0n, weighted: 0n });
const add = (a: Acc, b: Acc): Acc => ({ plan: a.plan + b.plan, fact: a.fact + b.fact, planQty: a.planQty + b.planQty, factQty: a.factQty + b.factQty, won: a.won + b.won, open: a.open + b.open, weighted: a.weighted + b.weighted });
const isZero = (a: Acc) => Object.values(a).every(v => v === 0n);
const cell = (a: Acc): PlanFactCell => ({
  plan: fmt(a.plan, 2),
  fact: fmt(a.fact, 2),
  planQty: fmt(a.planQty, 3),
  factQty: fmt(a.factQty, 3),
  pct: a.plan > 0n ? fmt(div(mul(a.fact, dec('100')), a.plan), 1) : null,
  deviation: fmt(a.fact - a.plan, 2),
  forecastWon: fmt(a.won, 2),
  forecastOpen: fmt(a.open, 2),
  forecast: fmt(a.won + a.open, 2),
  forecastWeighted: fmt(a.won + a.weighted, 2),
});

/** План-факт по периодам и значениям разреза. Строка есть у значения с планом, фактом или прогнозом; сначала идут значения с планом */
export function buildPlanFact(i: PlanFactInput): { rows: PlanFactRow[]; totals: PlanFactCell[]; total: PlanFactCell } {
  const idx = new Map(i.periods.map((p, k) => [p, k]));
  const table = new Map<string, Acc[]>();
  const touch = (key: string | null, period: string): Acc | null => {
    const k = idx.get(period);
    if (k === undefined) return null;
    const id = key ?? '';
    if (!table.has(id)) table.set(id, i.periods.map(zero));
    return table.get(id)![k]!;
  };
  for (const e of i.plan) { const a = touch(e.key, e.period); if (a) { a.plan += dec(e.amount); a.planQty += dec(e.qty); } }
  for (const e of i.fact) { const a = touch(e.key, e.period); if (a) { a.fact += dec(e.amount); a.factQty += dec(e.qty); } }
  for (const e of i.forecast) { const a = touch(e.key, e.period); if (a) { a.won += dec(e.won); a.open += dec(e.open); a.weighted += dec(e.weighted); } }
  const sum = (list: Acc[]): Acc => list.reduce(add, zero());
  const rows: PlanFactRow[] = [];
  for (const [id, list] of table) {
    const total = sum(list);
    if (isZero(total)) continue;
    rows.push({ key: id || null, name: id ? i.names.get(id) ?? id : null, periods: list.map(cell), total: cell(total) });
  }
  // по имени; «без значения» — в конце
  rows.sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : (a.name ?? '').localeCompare(b.name ?? '')));
  const colTotals = i.periods.map((_, k) => sum([...table.values()].map(r => r[k]!)));
  return { rows, totals: colTotals.map(cell), total: cell(sum(colTotals)) };
}
