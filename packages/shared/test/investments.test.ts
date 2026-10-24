/* Инвестпроекты: периоды, NPV, IRR, окупаемость. Сверка — пример [-1000, 300, 400, 500] при 10%:
   NPV = −1000 + 300/1,1 + 400/1,21 + 500/1,331 = −21,04; IRR ≈ 8,90%; простая окупаемость 2 + 300/500 = 2,6 периода.
   Соглашение: поток периода 0 не дисконтируется (в отличие от NPV() в Excel). */
import { describe, expect, test } from 'bun:test';
import { dec } from '../src/decimal';
import {
  cashflowTable,
  discountedPayback,
  forecastFlows,
  investmentMetrics,
  irr,
  npv,
  payback,
  periodDate,
  periodIndexOf,
  periodLabel,
  periodRate,
  periodStart,
  profitabilityIndex,
  sumByPeriod,
} from '../src/investments';

const sample = [-1000, 300, 400, 500];

describe('periods', () => {
  test('start of a period', () => {
    expect(periodStart('2026-11-17', 'month')).toBe('2026-11-01');
    expect(periodStart('2026-11-17', 'quarter')).toBe('2026-10-01');
    expect(periodStart('2026-02-28', 'quarter')).toBe('2026-01-01');
    expect(periodStart('2026-11-17', 'year')).toBe('2026-01-01');
  });

  test('date and label of period i', () => {
    expect(periodDate('2026-11-01', 'month', 2)).toBe('2027-01-01');
    expect(periodDate('2026-10-01', 'quarter', 5)).toBe('2028-01-01');
    expect(periodLabel('2026-10-01', 'quarter', 1)).toBe('2027 Q1');
    expect(periodLabel('2026-01-01', 'year', 3)).toBe('2029');
    expect(periodLabel('2026-11-01', 'month', 0)).toBe('2026-11');
  });

  test('period index of a date', () => {
    expect(periodIndexOf('2026-10-01', 'quarter', '2026-12-31')).toBe(0);
    expect(periodIndexOf('2026-10-01', 'quarter', '2027-01-01')).toBe(1);
    expect(periodIndexOf('2026-10-01', 'quarter', '2026-09-30')).toBe(-1);
    expect(periodIndexOf('2026-01-01', 'year', '2030-06-15')).toBe(4);
    expect(periodIndexOf('2026-11-01', 'month', '2027-02-10')).toBe(3);
  });

  test('effective period rate from the annual rate', () => {
    expect(periodRate(10, 'year')).toBeCloseTo(0.1, 12);
    expect(periodRate(21, 'quarter')).toBeCloseTo(Math.pow(1.21, 0.25) - 1, 12);
    expect(Math.pow(1 + periodRate(12, 'month'), 12)).toBeCloseTo(1.12, 12);
    expect(periodRate(0, 'month')).toBe(0);
  });
});

describe('npv, irr, payback', () => {
  test('npv: the first period is not discounted', () => {
    expect(npv(sample, 0.1)).toBeCloseTo(-21.0368, 4);
    expect(npv(sample, 0)).toBe(200);
    expect(npv([-100], 0.1)).toBe(-100);
  });

  test('irr makes npv zero', () => {
    const r = irr(sample)!;
    expect(r).toBeCloseTo(0.08896, 4);
    expect(npv(sample, r)).toBeCloseTo(0, 6);
    expect(irr([-100, 110])).toBeCloseTo(0.1, 9);
  });

  test('irr is null without a sign change', () => {
    expect(irr([-100, -50])).toBeNull();
    expect(irr([100, 50])).toBeNull();
    expect(irr([0, 0])).toBeNull();
  });

  test('irr of a project that loses money is negative', () => {
    expect(irr([-100, 50, 40])).toBeLessThan(0);
    expect(npv([-100, 50, 40], irr([-100, 50, 40])!)).toBeCloseTo(0, 6);
  });

  test('simple and discounted payback with interpolation', () => {
    expect(payback(sample)).toBeCloseTo(2.6, 9);
    // дисконтированный поток при 10% не окупается на горизонте
    expect(discountedPayback(sample, 0.1)).toBeNull();
    // [-1000, 600, 600]: при 10% дисконтированные 545,45 и 495,87 → 1 + 454,55/495,87 ≈ 1,9167
    expect(discountedPayback([-1000, 600, 600], 0.1)).toBeCloseTo(1 + (1000 - 600 / 1.1) / (600 / 1.21), 9);
    expect(payback([-1000, 200, 200])).toBeNull();
    expect(payback([100, 200])).toBe(0);
  });

  test('payback counts the last time the cumulative flow turns non-negative', () => {
    // окупился ко 2-му периоду, в 3-м новые вложения, снова окупился в 4-м
    expect(payback([-100, 60, 60, -50, 100])).toBeCloseTo(3 + 30 / 100, 9);
  });

  test('profitability index', () => {
    expect(profitabilityIndex(sample, 0)).toBeCloseTo(1.2, 9);
    expect(profitabilityIndex(sample, 0.1)).toBeCloseTo(978.9632 / 1000, 6);
    expect(profitabilityIndex([100, 200], 0.1)).toBeNull();
  });
});

describe('cashflow by periods', () => {
  test('sums by period; entries outside the horizon go to the edge periods', () => {
    const { outflow, inflow } = sumByPeriod(
      [
        { periodIndex: 0, direction: 'out', amount: '700' },
        { periodIndex: 0, direction: 'out', amount: '300.10' },
        { periodIndex: 0, direction: 'out', amount: '-0.10' }, // возврат поставщику
        { periodIndex: -2, direction: 'out', amount: '1' },
        { periodIndex: 2, direction: 'in', amount: '0.1' },
        { periodIndex: 2, direction: 'in', amount: '0.2' },
        { periodIndex: 9, direction: 'in', amount: '5' },
      ],
      3,
    );
    expect(outflow).toEqual([dec('1001'), 0n, 0n]);
    expect(inflow).toEqual([0n, 0n, dec('5.3')]);
  });

  test('table: net, cumulative and discounted cumulative', () => {
    const t = cashflowTable([dec(1000), 0n, 0n, 0n], [0n, dec(300), dec(400), dec(500)], 0.1);
    expect(t.map(r => r.net)).toEqual(['-1000.00', '300.00', '400.00', '500.00']);
    expect(t.map(r => r.cumulative)).toEqual(['-1000.00', '-700.00', '-300.00', '200.00']);
    expect(t.map(r => r.discounted)).toEqual(['-1000.00', '272.73', '330.58', '375.66']);
    expect(t[3]!.discountedCumulative).toBe('-21.04');
  });

  test('forecast takes fact for past periods and plan for the rest', () => {
    expect(forecastFlows([1, 2, 3, 4], [10, 20, 30, 40], 2)).toEqual([10, 20, 3, 4]);
    expect(forecastFlows([1, 2], [10, 20], 0)).toEqual([1, 2]);
    expect(forecastFlows([1, 2], [10, 20], 5)).toEqual([10, 20]);
  });
});

describe('metrics', () => {
  test('sample project, yearly periods', () => {
    const m = investmentMetrics([dec(1000), 0n, 0n, 0n], [0n, dec(300), dec(400), dec(500)], 10, 'year');
    expect(m).toEqual({ totalOutflow: '1000.00', totalInflow: '1200.00', net: '200.00', npv: '-21.04', irr: '8.90', pi: '0.98', payback: '2.60', discountedPayback: null });
  });

  test('quarterly periods: irr is annualised', () => {
    // 10% за квартал → годовая (1,1)^4 − 1 = 46,41%
    const m = investmentMetrics([dec(100), 0n], [0n, dec(110)], 46.41, 'quarter');
    expect(m.irr).toBe('46.41');
    expect(m.npv).toBe('0.00');
  });

  test('no investments: no irr and no pi, payback 0', () => {
    const m = investmentMetrics([0n, 0n], [dec(10), dec(10)], 10, 'month');
    expect(m.irr).toBeNull();
    expect(m.pi).toBeNull();
    expect(m.payback).toBe('0.00');
  });
});
