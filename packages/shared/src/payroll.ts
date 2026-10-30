/* Зарплата (задача 1184): виды начислений, чистые расчёты оклада по табелю, НДФЛ, взносов и процента от продаж.
   Без БД: те же функции использует сервер при заполнении и проведении и интерфейс. Правила — docs/architecture/payroll.md. */
import { dec, fmt, mul, pctOf, roundDiv } from './decimal';

/** Базы начисления: по ним сервис заполняет строки документа.
    trip_piecework/trip_km/trip_stop/trip_perdiem — оплата водителям по рейсам (задача 1224) */
export const PAYROLL_BASE_TYPES = ['salary', 'piecework', 'sales_percent', 'bonus', 'one_time', 'deduction', 'trip_piecework', 'trip_km', 'trip_stop', 'trip_perdiem'] as const;
export type PayrollBaseType = (typeof PAYROLL_BASE_TYPES)[number];
/** Системные виды: создаются при первом обращении, не удаляются */
export interface SystemPayrollKind {
  key: PayrollBaseType;
  name: string;
  /** Облагается страховыми взносами */
  insurable: boolean;
}
export const SYSTEM_PAYROLL_KINDS: SystemPayrollKind[] = [
  { key: 'salary', name: 'Оклад', insurable: true },
  { key: 'piecework', name: 'Сдельная оплата', insurable: true },
  { key: 'sales_percent', name: 'Процент от продаж', insurable: true },
  { key: 'bonus', name: 'Премия', insurable: true },
  { key: 'one_time', name: 'Разовое начисление', insurable: true },
  { key: 'deduction', name: 'Удержание', insurable: false },
  { key: 'trip_piecework', name: 'Оплата за рейс', insurable: true },
  { key: 'trip_km', name: 'Оплата за км', insurable: true },
  { key: 'trip_stop', name: 'Оплата за точку', insurable: true },
  { key: 'trip_perdiem', name: 'Суточные (междугородние рейсы)', insurable: false },
];
/** Виды, которые задаются плановыми начислениями сотрудника (остальные — факт периода или разовые строки) */
export const PLANNED_BASE_TYPES: PayrollBaseType[] = ['salary', 'sales_percent', 'bonus'];
/** Виды оплаты водителям по фактически выполненным рейсам за период: пересчитываются при каждом «Заполнить», как сдельная (без двойного начисления) */
export const TRIP_BASE_TYPES: PayrollBaseType[] = ['trip_piecework', 'trip_km', 'trip_stop', 'trip_perdiem'];
export const isDeductionBase = (b: string): boolean => b === 'deduction';

export const PERCENT_BASES = ['revenue', 'margin'] as const;
export type PercentBasis = (typeof PERCENT_BASES)[number];

export const DEFAULT_NDFL_RATE = '13';
export const DEFAULT_INSURANCE_RATE = '30';

export const ADVANCE_KINDS = ['advance', 'settlement'] as const;
export type AdvanceKind = (typeof ADVANCE_KINDS)[number];
export const PAYOUT_METHODS = ['cash', 'bank'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export const PAYROLL_MOVE_KINDS = ['accrual', 'ndfl', 'deduction', 'payment'] as const;
export type PayrollMoveKind = (typeof PAYROLL_MOVE_KINDS)[number];

/** Первый день месяца периода «ГГГГ-ММ» или «ГГГГ-ММ-ДД» */
export const periodStartOf = (v: string): string => `${v.slice(0, 7)}-01`;
/** Последний день месяца */
export function periodEndOf(v: string): string {
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${v.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

/** Оклад по табелю: оклад × отработанные дни / рабочие дни нормы месяца. Нет дней нормы — ноль */
export function salaryByDays(salary: string, workedDays: number, normDays: number): string {
  if (normDays <= 0 || workedDays <= 0) return '0.00';
  const worked = Math.min(workedDays, normDays);
  return fmt(roundDiv(dec(salary) * BigInt(worked), BigInt(normDays)), 2);
}

/** Начисление водителю за рейс: количество (рейсов, км, точек или дней) × ставка. Неположительное количество или ставка — ноль */
export function tripAccrualAmount(qty: string | number, rate: string): string {
  const q = typeof qty === 'number' ? dec(String(qty)) : dec(qty);
  const r = dec(rate);
  if (q <= 0n || r <= 0n) return '0.00';
  return fmt(mul(q, r), 2);
}

/** Процент от базы (выручки или маржи): округление до копеек; неположительная база начисления не даёт */
export function percentAmount(base: string, percent: string): string {
  const b = dec(base);
  if (b <= 0n) return '0.00';
  return fmt(pctOf(b, dec(percent)), 2);
}

/** НДФЛ с суммы начисления по ставке в процентах */
export const ndflOf = (amount: string, rate: string): string => fmt(pctOf(dec(amount), dec(rate)), 2);
/** Страховые взносы с облагаемой суммы */
export const insuranceOf = (amount: string, rate: string, insurable: boolean): string => (insurable ? fmt(pctOf(dec(amount), dec(rate)), 2) : '0.00');

/** Аванс: сумма из кадровых данных или процент от оклада (сумма приоритетнее) */
export function advanceFor(salary: string | null, advanceAmount: string | null, advancePercent: string | null): string {
  if (advanceAmount !== null && dec(advanceAmount) > 0n) return fmt(dec(advanceAmount), 2);
  if (advancePercent !== null && salary !== null && dec(advancePercent) > 0n) return fmt(pctOf(dec(salary), dec(advancePercent)), 2);
  return '0.00';
}

/** Итоги строки: начислено, удержано, на руки (взносы идут только в затраты) */
export function lineTotals(l: { amount: string; ndfl: string; deduction: boolean }): { accrued: string; withheld: string; net: string } {
  const a = dec(l.amount);
  if (l.deduction) return { accrued: '0.00', withheld: fmt(a, 2), net: fmt(-a, 2) };
  return { accrued: fmt(a, 2), withheld: fmt(dec(l.ndfl), 2), net: fmt(a - dec(l.ndfl), 2) };
}

/** Знаковые движения долга перед сотрудником по строке: начисление (+), НДФЛ (−), удержание (−) */
export function lineMoves(l: { amount: string; ndfl: string; deduction: boolean }): { kind: PayrollMoveKind; amount: string }[] {
  const a = dec(l.amount);
  if (l.deduction) return a > 0n ? [{ kind: 'deduction', amount: fmt(-a, 2) }] : [];
  const out: { kind: PayrollMoveKind; amount: string }[] = [];
  if (a > 0n) out.push({ kind: 'accrual', amount: fmt(a, 2) });
  if (dec(l.ndfl) > 0n) out.push({ kind: 'ndfl', amount: fmt(-dec(l.ndfl), 2) });
  return out;
}

/** Реестр на банк: CSV «ФИО;Счёт;Сумма» (простой общий формат, решение исполнителя) */
export function salaryRegistryCsv(rows: { name: string; account: string; amount: string }[]): string {
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ['ФИО;Счёт;Сумма', ...rows.map(r => [esc(r.name), esc(r.account), r.amount].join(';'))].join('\r\n') + '\r\n';
}
