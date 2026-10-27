/* Платёжный календарь (задача 1174г): состояния заявки на расход и прогноз остатка денег по дням.
   Без БД: сервер собирает плановые статьи, прогноз считается чистой функцией. Правила — docs/architecture/payments.md. */
import { dec, fmt } from './decimal';

/* ---------------- заявка на расход ---------------- */

/** Состояния заявки: на согласовании → согласована → оплачена / отклонена. «Оплачена» ставит только проведение оплаты */
export const REQUEST_STATES = ['pending', 'approved', 'paid', 'rejected'] as const;
export type RequestState = (typeof REQUEST_STATES)[number];
export const REQUEST_STATE_LABELS: Record<RequestState, string> = { pending: 'Pending approval', approved: 'Approved', paid: 'Paid', rejected: 'Rejected' };
export const REQUEST_STATE_LABELS_RU: Record<RequestState, string> = { pending: 'На согласовании', approved: 'Согласована', paid: 'Оплачена', rejected: 'Отклонена' };
export const REQUEST_STATE_COLORS: Record<RequestState, string> = { pending: '#d97706', approved: '#2563eb', paid: '#16a34a', rejected: '#dc2626' };
/** Операции заявки: платёж поставщику (можно привязать к документу) или прочий расход */
export const REQUEST_OPERATIONS = ['to_supplier', 'other_expense'] as const;

/** Ручные переходы (согласует admin и выше); «оплачена» — только оплатой */
const MANUAL: Record<string, RequestState[]> = {
  pending: ['approved', 'rejected'],
  approved: ['pending', 'rejected'],
  rejected: ['pending'],
};
export const requestTransitions = (from: string | null): RequestState[] => (from ? (MANUAL[from] ?? []) : []);

/** Раскладка остатка к оплате по строкам заявки по порядку: каждой строке не больше её суммы */
export function allocateRequest(lines: { id: string; amount: string }[], remaining: string): { id: string; amount: string }[] {
  let left = dec(remaining);
  const out: { id: string; amount: string }[] = [];
  for (const l of lines) {
    if (left <= 0n) break;
    const a = dec(l.amount);
    const take = a < left ? a : left;
    if (take > 0n) out.push({ id: l.id, amount: fmt(take, 2) });
    left -= take;
  }
  return out;
}

/* ---------------- прогноз ---------------- */

export interface PlanItem {
  /** in — плановое поступление, out — плановый платёж */
  direction: 'in' | 'out';
  /** Источник: неоплаченный документ или заявка на расход */
  source: 'document' | 'request';
  /** Плановая дата (просроченные подтянуты на сегодня) */
  date: string;
  /** Срок по документу или желаемая дата заявки */
  dueDate: string;
  overdue: boolean;
  amount: string;
  documentId: string;
  documentType: string;
  number: string | null;
  counterpartyId: string | null;
  counterpartyName: string;
  /** Состояние заявки */
  state?: string;
}

export interface ForecastDay {
  date: string;
  in: string;
  out: string;
  balance: string;
  /** Остаток ушёл в минус: кассовый разрыв */
  gap: boolean;
}

export interface Forecast {
  days: ForecastDay[];
  totals: { in: string; out: string };
  endBalance: string;
  minBalance: string;
  minDate: string;
  /** Первый день с отрицательным остатком */
  firstGap: { date: string; balance: string } | null;
  gapDays: number;
}

export const addIsoDays = (iso: string, n: number): string => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);

/** Прогноз остатка по дням: остаток на сегодня + плановые поступления − плановые платежи. Статьи вне окна не учитываются */
export function buildForecast(p: { from: string; days: number; opening: string; items: Pick<PlanItem, 'direction' | 'date' | 'amount'>[] }): Forecast {
  const inBy = new Map<string, bigint>();
  const outBy = new Map<string, bigint>();
  for (const it of p.items) {
    const m = it.direction === 'in' ? inBy : outBy;
    m.set(it.date, (m.get(it.date) ?? 0n) + dec(it.amount));
  }
  let bal = dec(p.opening);
  let tIn = 0n;
  let tOut = 0n;
  let min: bigint | null = null;
  let minDate = p.from;
  let firstGap: Forecast['firstGap'] = null;
  let gapDays = 0;
  const days: ForecastDay[] = [];
  for (let i = 0; i < p.days; i++) {
    const date = addIsoDays(p.from, i);
    const di = inBy.get(date) ?? 0n;
    const dout = outBy.get(date) ?? 0n;
    bal += di - dout;
    tIn += di;
    tOut += dout;
    const gap = bal < 0n;
    if (gap) {
      gapDays++;
      firstGap ??= { date, balance: fmt(bal, 2) };
    }
    if (min === null || bal < min) {
      min = bal;
      minDate = date;
    }
    days.push({ date, in: fmt(di, 2), out: fmt(dout, 2), balance: fmt(bal, 2), gap });
  }
  return { days, totals: { in: fmt(tIn, 2), out: fmt(tOut, 2) }, endBalance: fmt(bal, 2), minBalance: fmt(min ?? dec(p.opening), 2), minDate, firstGap, gapDays };
}
