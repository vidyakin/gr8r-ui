/* Инвестпроекты: периоды, денежный поток и показатели эффективности (NPV, IRR, PI, срок окупаемости). Чистые функции —
   одни и те же на сервере и в интерфейсе.

   Соглашения:
   - поток периода i приходится на начало периода i; поток периода 0 не дисконтируется: NPV = Σ CFᵢ / (1 + r)ⁱ
     (в Excel `NPV()` дисконтирует и первый член — там это `CF₀ + NPV(r; CF₁…)`);
   - ставка задаётся годовой, ставка периода — эффективная: (1 + r)^(1/k) − 1, k = 12 / 4 / 1;
   - суммы потока — десятичные (`decimal.ts`), дисконтирование — float (дробные степени): результат округляется до копеек,
     IRR — до сотых процентного пункта, сроки окупаемости — до сотых периода. */
import { dec, fmt, type Dec } from './decimal';
import type { DocumentType } from './documents';

export const INVESTMENT_STATUSES = ['draft', 'approved', 'closed'] as const;
export type InvestmentStatus = (typeof INVESTMENT_STATUSES)[number];
export const INVESTMENT_PERIOD_KINDS = ['month', 'quarter', 'year'] as const;
export type InvestmentPeriodKind = (typeof INVESTMENT_PERIOD_KINDS)[number];

/** Документы, которые дают факт инвестпроекта, и направление их суммы: вложение (out) или поступление (in).
    Возвраты идут с минусом в своём направлении */
export const INVESTMENT_FACT_TYPES: Partial<Record<DocumentType, 'in' | 'out'>> = {
  receipt: 'out',
  supplier_return: 'out',
  other_costs: 'out',
  write_off: 'out',
  realization: 'in',
  act: 'in',
  customer_return: 'in',
  stock_posting: 'in',
};
export const isInvestmentFactType = (type: string): boolean => type in INVESTMENT_FACT_TYPES;

/** Сколько периодов в году */
export const PERIODS_PER_YEAR: Record<InvestmentPeriodKind, number> = { month: 12, quarter: 4, year: 1 };
const MONTHS_IN: Record<InvestmentPeriodKind, number> = { month: 1, quarter: 3, year: 12 };

const ymd = (y: number, m0: number) => `${String(y).padStart(4, '0')}-${String(m0 + 1).padStart(2, '0')}-01`;
const monthNo = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/** Начало периода, в который попадает дата: 1-е число месяца, квартала или года */
export function periodStart(date: string, kind: InvestmentPeriodKind): string {
  const n = monthNo(date);
  const m = n - (n % 12) + Math.floor((n % 12) / MONTHS_IN[kind]) * MONTHS_IN[kind];
  return ymd(Math.floor(m / 12), m % 12);
}

/** Дата начала периода i от начала проекта */
export function periodDate(start: string, kind: InvestmentPeriodKind, i: number): string {
  const m = monthNo(periodStart(start, kind)) + i * MONTHS_IN[kind];
  return ymd(Math.floor(m / 12), m % 12);
}

/** Номер периода проекта, в который попадает дата (отрицательный — раньше начала) */
export function periodIndexOf(start: string, kind: InvestmentPeriodKind, date: string): number {
  return Math.floor((monthNo(date) - monthNo(periodStart(start, kind))) / MONTHS_IN[kind]);
}

/** Подпись периода: «2026-11», «2026 Q4», «2026» */
export function periodLabel(start: string, kind: InvestmentPeriodKind, i: number): string {
  const d = periodDate(start, kind, i);
  if (kind === 'year') return d.slice(0, 4);
  if (kind === 'quarter') return `${d.slice(0, 4)} Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
  return d.slice(0, 7);
}

/** Эффективная ставка периода из годовой ставки в процентах */
export function periodRate(annualPct: number, kind: InvestmentPeriodKind): number {
  return Math.pow(1 + annualPct / 100, 1 / PERIODS_PER_YEAR[kind]) - 1;
}

/** Чистая приведённая стоимость: поток периода 0 не дисконтируется */
export function npv(flows: number[], rate: number): number {
  return flows.reduce((s, cf, i) => s + cf / Math.pow(1 + rate, i), 0);
}

/** Внутренняя норма доходности за период. null — поток не меняет знак или корня нет.
    При нескольких корнях — наименьший (первая смена знака NPV при росте ставки) */
export function irr(flows: number[]): number | null {
  if (!flows.some(f => f > 0) || !flows.some(f => f < 0)) return null;
  // ищем отрезок со сменой знака NPV, двигаясь от ставки −99,9999% вверх
  const grid = [-0.999999, -0.99, -0.9, -0.75, -0.5, -0.25, 0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 20, 50, 100, 1000];
  let bracket: [number, number] | null = null;
  for (let k = 1; k < grid.length && !bracket; k++) {
    const a = npv(flows, grid[k - 1]!);
    if (a === 0) return grid[k - 1]!;
    if (Math.sign(a) !== Math.sign(npv(flows, grid[k]!))) bracket = [grid[k - 1]!, grid[k]!];
  }
  if (!bracket) return null;
  let [lo, hi] = bracket;
  let fLo = npv(flows, lo);
  for (let k = 0; k < 200 && hi - lo > 1e-12; k++) {
    const mid: number = (lo + hi) / 2;
    const f = npv(flows, mid);
    if (f === 0) return mid;
    if (Math.sign(f) === Math.sign(fLo)) [lo, fLo] = [mid, f];
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Момент, после которого накопленный поток больше не отрицателен (в периодах, с интерполяцией внутри периода).
    0 — накопленный поток не уходил в минус; null — не окупается на горизонте */
function crossing(flows: number[]): number | null {
  let acc = 0;
  const cum = flows.map(f => (acc += f));
  let last = -1;
  cum.forEach((c, i) => {
    if (c < -1e-9) last = i;
  });
  if (last === -1) return 0;
  if (last === cum.length - 1) return null;
  const next = flows[last + 1]!;
  return last + -cum[last]! / next;
}

/** Простой срок окупаемости, периодов */
export const payback = (flows: number[]): number | null => crossing(flows);

/** Дисконтированный срок окупаемости, периодов */
export const discountedPayback = (flows: number[], rate: number): number | null => crossing(flows.map((f, i) => f / Math.pow(1 + rate, i)));

/** Индекс прибыльности: PV поступлений / PV вложений. null — вложений нет */
export function profitabilityIndex(flows: number[], rate: number): number | null {
  const pvIn = npv(flows.map(f => Math.max(f, 0)), rate);
  const pvOut = -npv(flows.map(f => Math.min(f, 0)), rate);
  return pvOut > 0 ? pvIn / pvOut : null;
}

/* ---------------- поток по периодам ---------------- */

/** Сумма потока: вложение (out) или поступление (in); суммы со знаком «минус» — возвраты */
export interface CashflowEntry {
  periodIndex: number;
  direction: 'in' | 'out';
  amount: string;
}

export interface CashflowPeriod {
  index: number;
  outflow: string;
  inflow: string;
  /** Поступления − вложения */
  net: string;
  cumulative: string;
  discounted: string;
  discountedCumulative: string;
}

/** Вложения и поступления по периодам 0…periods−1; запись за горизонтом попадает в последний период, до начала — в первый */
export function sumByPeriod(entries: CashflowEntry[], periods: number): { outflow: Dec[]; inflow: Dec[] } {
  const outflow = Array.from({ length: periods }, () => 0n);
  const inflow = Array.from({ length: periods }, () => 0n);
  for (const e of entries) {
    const i = Math.min(Math.max(e.periodIndex, 0), periods - 1);
    if (e.direction === 'in') inflow[i]! += dec(e.amount);
    else outflow[i]! += dec(e.amount);
  }
  return { outflow, inflow };
}

/** Чистый поток по периодам (число — для дисконтирования) */
export const netFlows = (outflow: Dec[], inflow: Dec[]): number[] => outflow.map((o, i) => Number(fmt(inflow[i]! - o, 2)));

/** Таблица «Денежный поток»: по периодам вложения, поступления, чистый, накопленный и дисконтированный */
export function cashflowTable(outflow: Dec[], inflow: Dec[], rate: number): CashflowPeriod[] {
  let cum = 0n;
  let dcum = 0;
  return outflow.map((o, i) => {
    const net = inflow[i]! - o;
    cum += net;
    const d = Number(fmt(net, 2)) / Math.pow(1 + rate, i);
    dcum += d;
    return { index: i, outflow: fmt(o, 2), inflow: fmt(inflow[i]!, 2), net: fmt(net, 2), cumulative: fmt(cum, 2), discounted: money(d), discountedCumulative: money(dcum) };
  });
}

/** Прогноз: факт за прошедшие периоды (до текущего, не включая его) и план за текущий и будущие */
export function forecastFlows<T>(plan: T[], fact: T[], currentIndex: number): T[] {
  return plan.map((p, i) => (i < currentIndex ? fact[i]! : p));
}

/* ---------------- показатели ---------------- */

export interface InvestmentMetrics {
  totalOutflow: string;
  totalInflow: string;
  net: string;
  npv: string;
  /** Годовая IRR, % */
  irr: string | null;
  pi: string | null;
  /** Сроки окупаемости, периодов */
  payback: string | null;
  discountedPayback: string | null;
}

const money = (x: number) => fmt(dec(Math.round(x * 100) / 100), 2);
const round2 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : fmt(dec(Math.round(x * 100) / 100), 2));

/** Показатели проекта по вложениям и поступлениям периодов и годовой ставке, % */
export function investmentMetrics(outflow: Dec[], inflow: Dec[], annualPct: number, kind: InvestmentPeriodKind): InvestmentMetrics {
  const flows = netFlows(outflow, inflow);
  const rate = periodRate(annualPct, kind);
  const r = irr(flows);
  const totalOut = outflow.reduce((s, x) => s + x, 0n);
  const totalIn = inflow.reduce((s, x) => s + x, 0n);
  return {
    totalOutflow: fmt(totalOut, 2),
    totalInflow: fmt(totalIn, 2),
    net: fmt(totalIn - totalOut, 2),
    npv: money(npv(flows, rate)),
    irr: r === null ? null : round2((Math.pow(1 + r, PERIODS_PER_YEAR[kind]) - 1) * 100),
    pi: round2(profitabilityIndex(flows, rate)),
    payback: round2(payback(flows)),
    discountedPayback: round2(discountedPayback(flows, rate)),
  };
}
