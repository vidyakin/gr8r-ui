/* План производства и расчёт потребностей в запасах: чистые функции, общие для сервера и интерфейса.
   Периоды плана (неделя/месяц), дата запуска по рабочему календарю, прогноз остатка по периодам с рекомендацией
   по правилу мин./макс., методики «по продажам: min-max» и «по статистике продаж со страховым запасом».
   Количества считаются на десятичных из decimal.ts, наружу идут строками с тремя знаками. */
import { dec, div, fmt, mul, pctOf, roundDiv, type Dec } from './decimal';
import { addDays, capacityOf, dateRange, isWorkingDayWith, type CalendarDef, type CalendarException } from './planning';

/* ---------------- периоды плана ---------------- */

/** Начала периодов плана: шаг — неделя или месяц. Дата выпуска строки = начало периода */
export function planPeriods(from: string, to: string, step: 'week' | 'month'): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < 400 && cur <= to; i++) {
    out.push(cur);
    cur = step === 'week' ? addDays(cur, 7) : addMonth(cur);
  }
  return out;
}

function addMonth(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const day = d.getUTCDate();
  // последний день месяца и дальше идёт последним днём (31.01 → 28.02 → 31.03)
  const eom = day === new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(eom ? last : Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Период плана, в который попадает дата: последний период, чьё начало не позже даты (вне диапазона — null) */
export function planPeriodOf(periods: string[], date: string): string | null {
  let found: string | null = null;
  for (const p of periods) {
    if (p <= date) found = p;
    else break;
  }
  return found;
}

/** Дата запуска: дата выпуска минус lead_days рабочих дней по календарю (сдвиг через выходной и праздник) */
export function startBeforeLead(cal: CalendarDef | null, holidays: string[], exceptions: CalendarException[], dueDate: string, leadDays: number): string {
  let d = dueDate;
  let left = Math.max(0, Math.trunc(leadDays));
  for (let i = 0; left > 0 && i < 1000; i++) {
    d = addDays(d, -1);
    if (isWorkingDayWith(cal, d, holidays, exceptions)) left--;
  }
  return d;
}

/* ---------------- прогноз остатка и рекомендация ---------------- */

/** Событие движения с датой: ожидаемое поступление или потребление (заказ покупателя, материалы производства) */
export interface StockFlow {
  date: string;
  qty: string;
  /** Откуда движение: тип документа или «План» */
  source: string;
  documentId?: string | null;
  label?: string | null;
}

/** Период прогноза остатка */
export interface ForecastPeriod {
  period: string;
  /** Остаток на начало периода */
  opening: string;
  /** Ожидаемые поступления за период */
  incoming: string;
  /** Потребление за период */
  consumption: string;
  /** Остаток на конец периода (без нового заказа) */
  closing: string;
  /** Сколько заказать в этом периоде (по правилу мин./макс.) */
  order: string;
}

export interface ForecastInput {
  /** Текущий остаток */
  balance: string;
  /** Начала периодов горизонта */
  periods: string[];
  incoming: StockFlow[];
  demand: StockFlow[];
  /** Минимальный запас: ниже него заказываем */
  minQty: string;
  /** Максимальный запас: до него доводим */
  maxQty: string;
  /** Сегодняшняя дата — для колонки «Просрочено» */
  today?: string;
}

export interface ForecastResult {
  periods: ForecastPeriod[];
  /** Рекомендуемое количество к заказу по всему горизонту */
  recommendation: string;
  /** Просрочено: движения с прошедшей датой и добор до максимума при остатке ниже минимума */
  overdue: string;
  /** Остаток на конец горизонта (без нового заказа) */
  closing: string;
}

const nonNeg = (v: Dec): Dec => (v > 0n ? v : 0n);

/**
 * Рекомендация по правилу мин./макс. за период: если по итогу периода (поступления минус потребление) остаток
 * не выше минимума — заказываем столько, чтобы после отгрузок остался максимум, то есть максимум плюс потребление
 * минус излишек остатка над минимумом. Если потребления в периоде нет — обычный добор до максимума.
 * Пример справки: мин 10, макс 20, потребление 5, остаток 2 → 20 + 5 = 25.
 */
export function minMaxRecommendation(opening: Dec, incoming: Dec, demand: Dec, minQty: Dec, maxQty: Dec): Dec {
  if (opening + incoming - demand > minQty) return 0n;
  if (demand <= 0n) return nonNeg(maxQty - opening);
  return nonNeg(maxQty + demand - nonNeg(opening - minQty));
}

/** Прогноз остатка по периодам и рекомендация к заказу. Ожидаемые поступления и потребление раскладываются
    по периодам по своей дате; заказанное в периоде попадает в остаток следующих периодов. */
export function stockForecast(input: ForecastInput): ForecastResult {
  const balance = dec(input.balance);
  const minQty = dec(input.minQty);
  const maxQty = dec(input.maxQty);
  const sum = (events: StockFlow[], period: string, next: string | null) => {
    let v = 0n;
    for (const e of events) if (e.date >= period && (next === null || e.date < next)) v += dec(e.qty);
    return v;
  };
  let running = balance;
  const periods: ForecastPeriod[] = [];
  let orderTotal = 0n;
  for (const [i, period] of input.periods.entries()) {
    const next = input.periods[i + 1] ?? null;
    const incoming = sum(input.incoming, period, next);
    const consumption = sum(input.demand, period, next);
    const closing = running + incoming - consumption;
    const order = minMaxRecommendation(running, incoming, consumption, minQty, maxQty);
    orderTotal += order;
    periods.push({
      period,
      opening: fmt(running, 3),
      incoming: fmt(incoming, 3),
      consumption: fmt(consumption, 3),
      closing: fmt(closing, 3),
      order: fmt(order, 3),
    });
    // заказ покрывает текущий период — дальше он уже пришёл
    running = closing + order;
  }
  const today = input.today ?? input.periods[0] ?? '';
  let overdue = 0n;
  for (const e of [...input.incoming, ...input.demand]) if (e.date < today) overdue += dec(e.qty);
  if (balance < minQty) overdue += maxQty - balance;
  return { periods, recommendation: fmt(orderTotal, 3), overdue: fmt(overdue, 3), closing: fmt(running - orderTotal, 3) };
}

/** Методика «по продажам: min-max» — сравниваем только текущий остаток с минимумом и максимумом */
export function salesMinMax(balance: string, minQty: string, maxQty: string): string {
  const b = dec(balance);
  return fmt(nonNeg(b > dec(minQty) ? 0n : dec(maxQty) - b), 3);
}

export interface SalesStatisticsInput {
  /** Средние продажи в день (за выбранное число прошлых периодов) */
  avgPerDay: string;
  /** Срок поставки, дней: сколько покрываем закупкой */
  leadDays: string;
  /** Текущий остаток */
  balance: string;
  /** Страховой запас по дням поставки (альтернатива процентам) */
  safetyDays?: string;
  /** Страховой запас в процентах от плановой потребности; может быть отрицательным */
  safetyPct?: string | null;
}

/** Методика «по статистике продаж»: средние продажи × (срок поставки + страховые дни) + страховой запас,
    минус остаток. Страховой запас в процентах берётся от плановой потребности и может быть отрицательным. */
export function salesStatistics(input: SalesStatisticsInput): string {
  const avg = dec(input.avgPerDay);
  const planned = mul(avg, dec(input.leadDays));
  const safety = input.safetyPct !== undefined && input.safetyPct !== null ? pctOf(planned, dec(input.safetyPct)) : mul(avg, dec(input.safetyDays ?? '0'));
  return fmt(nonNeg(planned + safety - dec(input.balance)), 3);
}

/** Среднее по значениям с округлением до тысячных (заполнение плана по статистике); пустая история — ноль */
export function averageQty(values: string[]): string {
  if (!values.length) return '0.000';
  let sum = 0n;
  for (const v of values) sum += dec(v);
  return fmt(roundDiv(sum, BigInt(values.length)), 3);
}

/* ---------------- потребности плана ---------------- */

/** Часы потребности против мощности периода: нехватка = потребность минус мощность */
export function loadVsCapacity(hours: string, capacity: string): { capacity: string; shortage: string } {
  const c = dec(capacity);
  return { capacity: fmt(c, 3), shortage: fmt(nonNeg(dec(hours) - c), 3) };
}

/** Мощность участка за период: сумма мощности по рабочим дням периода (выходные и праздники не входят) */
export function periodCapacity(
  cal: CalendarDef | null,
  capacityHoursPerDay: string | null,
  holidays: string[],
  exceptions: CalendarException[],
  from: string,
  to: string,
): string {
  let total = 0n;
  for (const day of dateRange(from, to)) total += capacityOf(cal, day, capacityHoursPerDay, holidays, exceptions);
  return fmt(total, 3);
}

/** Строки полуфабрикатов к плану: пропорционально продукции, одинаковые суммируются, период сдвигается
    на срок изготовления (сдвиг считает вызывающий — по рабочему календарю) */
export function semiPlan(
  lines: { periodStart: string; qty: string }[],
  semis: { itemId: string; qty: string }[],
  shift: (periodStart: string, leadDays: number) => string,
  leadDays: (itemId: string) => number,
): { itemId: string; periodStart: string; qty: string }[] {
  const acc = new Map<string, { periodStart: string; qty: Dec }>();
  for (const l of lines) {
    const units = dec(l.qty);
    for (const s of semis) {
      const periodStart = shift(l.periodStart, leadDays(s.itemId));
      const key = `${s.itemId}|${periodStart}`;
      const cur = acc.get(key) ?? { periodStart, qty: 0n };
      cur.qty += mul(dec(s.qty), units);
      acc.set(key, cur);
    }
  }
  return [...acc.entries()]
    .map(([key, v]) => ({ itemId: key.split('|')[0], periodStart: v.periodStart, qty: fmt(v.qty, 3) }))
    .sort((a, b) => (a.itemId === b.itemId ? a.periodStart.localeCompare(b.periodStart) : a.itemId.localeCompare(b.itemId)));
}

/** Отношение количества к норме: сколько партий нормы покрывает количество (округление вниз) */
export function batchFactor(qty: string, batchQty: string): string {
  const b = dec(batchQty);
  if (b <= 0n) return '0.000';
  return fmt(div(dec(qty), b), 3);
}