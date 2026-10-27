import { describe, expect, test } from 'bun:test';
import { allocateRequest, buildForecast, requestTransitions } from '../src/payment-calendar';

describe('прогноз остатка', () => {
  test('считает остаток по дням и находит кассовый разрыв', () => {
    const f = buildForecast({
      from: '2026-11-01',
      days: 5,
      opening: '1000.00',
      items: [
        { direction: 'out', date: '2026-11-02', amount: '1500.00' },
        { direction: 'in', date: '2026-11-04', amount: '800.00' },
        { direction: 'out', date: '2026-11-04', amount: '100.00' },
      ],
    });
    expect(f.days.map(d => d.balance)).toEqual(['1000.00', '-500.00', '-500.00', '200.00', '200.00']);
    expect(f.firstGap).toEqual({ date: '2026-11-02', balance: '-500.00' });
    expect(f.gapDays).toBe(2);
    expect(f.minBalance).toBe('-500.00');
    expect(f.totals).toEqual({ in: '800.00', out: '1600.00' });
    expect(f.endBalance).toBe('200.00');
  });
  test('без разрыва', () => {
    const f = buildForecast({ from: '2026-11-01', days: 2, opening: '10.00', items: [] });
    expect(f.firstGap).toBeNull();
    expect(f.gapDays).toBe(0);
  });
});

test('раскладка остатка по строкам заявки', () => {
  const lines = [{ id: 'a', amount: '100.00' }, { id: 'b', amount: '50.00' }];
  expect(allocateRequest(lines, '120.00')).toEqual([{ id: 'a', amount: '100.00' }, { id: 'b', amount: '20.00' }]);
  expect(allocateRequest(lines, '0.00')).toEqual([]);
  expect(allocateRequest(lines, '500.00')).toEqual(lines);
});

test('переходы состояний', () => {
  expect(requestTransitions('pending')).toEqual(['approved', 'rejected']);
  expect(requestTransitions('paid')).toEqual([]);
  expect(requestTransitions(null)).toEqual([]);
});
