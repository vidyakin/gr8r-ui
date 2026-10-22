/* План производства и расчёт потребностей: периоды плана, дата запуска по рабочему календарю, прогноз остатка
   с рекомендацией по правилу мин./макс., методики по продажам, потребности плана. */
import { describe, expect, test } from 'bun:test';
import {
  averageQty,
  loadVsCapacity,
  minMaxRecommendation,
  periodCapacity,
  planPeriodOf,
  planPeriods,
  salesMinMax,
  salesStatistics,
  semiPlan,
  startBeforeLead,
  stockForecast,
  type StockFlow,
} from '../src/replenishment';
import type { CalendarDef } from '../src/planning';

/** График пятидневки без праздников */
const week: CalendarDef = { id: null, kind: 'weekly', pattern: { weekdays: [1, 2, 3, 4, 5] }, cycleStart: null, hoursPerDay: '8' };

describe('periods of the plan', () => {
  test('week and month steps', () => {
    expect(planPeriods('2026-10-01', '2026-10-29', 'week')).toEqual(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);
    expect(planPeriods('2026-01-15', '2026-03-31', 'month')).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });
  test('the end of a month is not moved to the next one', () => {
    expect(planPeriods('2026-01-31', '2026-03-31', 'month')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
  test('the period a date falls into', () => {
    const periods = planPeriods('2026-10-01', '2026-10-29', 'week');
    expect(planPeriodOf(periods, '2026-10-08')).toBe('2026-10-08');
    expect(planPeriodOf(periods, '2026-10-14')).toBe('2026-10-08');
    expect(planPeriodOf(periods, '2026-10-01')).toBe('2026-10-01');
    expect(planPeriodOf(periods, '2025-12-31')).toBe(null);
  });
});

describe('start date of the plan line', () => {
  test('lead days are counted backwards over working days', () => {
    // пятница 2026-10-02 → два рабочих дня назад: четверг 01.10 и среда 30.09
    expect(startBeforeLead(week, [], [], '2026-10-02', 2)).toBe('2026-09-30');
  });
  test('the shift skips weekends and holidays', () => {
    // понедельник 2026-10-05 минус 3 рабочих дня: пятница 02.10, четверг 01.10 (среда — праздник), вторник 29.09
    expect(startBeforeLead(week, ['2026-09-30'], [], '2026-10-05', 3)).toBe('2026-09-29');
  });
  test('zero lead days — the release date itself', () => {
    expect(startBeforeLead(week, [], [], '2026-10-05', 0)).toBe('2026-10-05');
  });
});

describe('min/max recommendation', () => {
  test('the example from the manual: min 10, max 20, orders 5, balance 2 → 25', () => {
    expect(minMaxRecommendation(2n, 0n, 5n, 10n, 20n)).toBe(25n);
  });
  test('balance above the minimum — nothing to order', () => {
    expect(minMaxRecommendation(30n, 0n, 5n, 10n, 20n)).toBe(0n);
    expect(minMaxRecommendation(11n, 0n, 0n, 10n, 20n)).toBe(0n);
  });
  test('balance exactly at the minimum — order up to the maximum', () => {
    expect(minMaxRecommendation(10n, 0n, 0n, 10n, 20n)).toBe(10n);
  });
  test('incoming of the period covers the demand — nothing to order', () => {
    expect(minMaxRecommendation(2n, 30n, 5n, 10n, 20n)).toBe(0n);
  });
  test('the surplus above the minimum reduces the order', () => {
    // остаток 20, отгрузка 15: по итогу периода 5 ≤ 10, заказываем 20 + 15 − (20 − 10)
    expect(minMaxRecommendation(20n, 0n, 15n, 10n, 20n)).toBe(25n);
  });
});

describe('stock forecast by periods', () => {
  const flow = (date: string, qty: string, source: string): StockFlow => ({ date, qty, source });

  test('periods keep the running balance and the order of the period', () => {
    const r = stockForecast({
      balance: '2',
      periods: ['2026-10-01', '2026-10-08'],
      incoming: [flow('2026-10-02', '30', 'Supplier order')],
      demand: [flow('2026-10-03', '5', 'Customer order')],
      minQty: '10',
      maxQty: '20',
      today: '2026-10-01',
    });
    expect(r.periods).toEqual([
      { period: '2026-10-01', opening: '2.000', incoming: '30.000', consumption: '5.000', closing: '27.000', order: '0.000' },
      { period: '2026-10-08', opening: '27.000', incoming: '0.000', consumption: '0.000', closing: '27.000', order: '0.000' },
    ]);
    expect(r.recommendation).toBe('0.000');
  });

  test('the example of the manual is recommended in the first period', () => {
    const r = stockForecast({
      balance: '2',
      periods: ['2026-10-01', '2026-10-08'],
      incoming: [],
      demand: [flow('2026-10-03', '5', 'Customer order')],
      minQty: '10',
      maxQty: '20',
      today: '2026-10-01',
    });
    expect(r.periods[0]).toMatchObject({ opening: '2.000', consumption: '5.000', closing: '-3.000', order: '25.000' });
    expect(r.recommendation).toBe('25.000');
    // заказ покрывает период — дальше остаток идёт уже с ним
    expect(r.periods[1]).toMatchObject({ opening: '22.000', order: '0.000' });
  });

  test('events of the next period are not counted in the current one', () => {
    const r = stockForecast({
      balance: '0',
      periods: ['2026-10-01', '2026-10-08'],
      incoming: [flow('2026-10-09', '5', 'Supplier order')],
      demand: [],
      minQty: '0',
      maxQty: '10',
      today: '2026-10-01',
    });
    expect(r.periods[0].incoming).toBe('0.000');
    expect(r.periods[1].incoming).toBe('5.000');
  });

  test('overdue: movements of the past plus topping up to the maximum below the minimum', () => {
    const r = stockForecast({
      balance: '2',
      periods: ['2026-10-01'],
      incoming: [flow('2026-09-20', '4', 'Supplier order')],
      demand: [flow('2026-09-25', '1', 'Customer order')],
      minQty: '10',
      maxQty: '20',
      today: '2026-10-01',
    });
    // 4 + 1 просроченных + (20 − 2) добора до максимума
    expect(r.overdue).toBe('23.000');
  });

  test('overdue without movements of the past and a healthy balance', () => {
    const r = stockForecast({ balance: '30', periods: ['2026-10-01'], incoming: [], demand: [], minQty: '10', maxQty: '20', today: '2026-10-01' });
    expect(r.overdue).toBe('0.000');
  });
});

describe('sales methods', () => {
  test('min-max by sales looks at the balance only', () => {
    expect(salesMinMax('2', '10', '20')).toBe('18.000');
    expect(salesMinMax('10', '10', '20')).toBe('10.000');
    expect(salesMinMax('25', '10', '20')).toBe('0.000');
  });

  test('statistics: average sales × lead time plus safety days', () => {
    // 10 в день, срок 5 дней → потребность 50, страховые 3 дня → 30, остаток 20
    expect(salesStatistics({ avgPerDay: '10', leadDays: '5', balance: '20', safetyDays: '3' })).toBe('60.000');
  });

  test('statistics: the safety stock as a percentage of the planned need', () => {
    expect(salesStatistics({ avgPerDay: '10', leadDays: '5', balance: '0', safetyPct: '20' })).toBe('60.000');
  });

  test('a negative percentage reduces the order', () => {
    expect(salesStatistics({ avgPerDay: '10', leadDays: '5', balance: '0', safetyPct: '-50' })).toBe('25.000');
    // отрицательный процент может обнулить заказ, но не сделать его отрицательным
    expect(salesStatistics({ avgPerDay: '10', leadDays: '5', balance: '10', safetyPct: '-50' })).toBe('15.000');
    expect(salesStatistics({ avgPerDay: '10', leadDays: '5', balance: '100', safetyPct: '-50' })).toBe('0.000');
  });

  test('quantities are rounded to thousandths', () => {
    expect(salesStatistics({ avgPerDay: '0.000333', leadDays: '3', balance: '0' })).toBe('0.001');
  });

  test('an empty history gives zero and no order', () => {
    expect(averageQty([])).toBe('0.000');
    expect(salesStatistics({ avgPerDay: averageQty([]), leadDays: '5', balance: '0' })).toBe('0.000');
  });

  test('the average of the history for filling the plan', () => {
    expect(averageQty(['10', '20', '31'])).toBe('20.333');
    expect(averageQty(['4'])).toBe('4.000');
  });
});

describe('needs of the plan', () => {
  test('hours against the capacity: shortage only when it exceeds', () => {
    expect(loadVsCapacity('12', '8')).toEqual({ capacity: '8.000', shortage: '4.000' });
    expect(loadVsCapacity('5', '8')).toEqual({ capacity: '8.000', shortage: '0.000' });
  });

  test('the capacity of a period counts working days only', () => {
    // неделя 01.10–07.10: пять рабочих дней по 8 часов
    expect(periodCapacity(week, null, [], [], '2026-10-01', '2026-10-07')).toBe('40.000');
    // со своей мощностью участка и праздником в среду
    expect(periodCapacity(week, '6', ['2026-10-07'], [], '2026-10-01', '2026-10-07')).toBe('24.000');
  });

  test('semi-finished lines are proportional, summed and shifted by the lead time', () => {
    const rows = semiPlan(
      [
        { periodStart: '2026-10-01', qty: '10' },
        { periodStart: '2026-10-01', qty: '5' },
        { periodStart: '2026-10-08', qty: '10' },
      ],
      [{ itemId: 's1', qty: '2' }],
      (period, leadDays) => (leadDays ? planPeriods(period, period, 'week')[0] : period),
      () => 1,
    );
    // два изделия в одном периоде дают один ПФ: (10 + 5) × 2 = 30, второй период — 20
    expect(rows).toEqual([
      { itemId: 's1', periodStart: '2026-10-01', qty: '30.000' },
      { itemId: 's1', periodStart: '2026-10-08', qty: '20.000' },
    ]);
  });
});