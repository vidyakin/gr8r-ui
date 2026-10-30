import { describe, expect, test } from 'bun:test';
import { accrualPoints, cumulativePctByScale, distributeRedemption, fifoExpiredPoints, redemptionLimit, resolveDiscountPct, reversalPointsForReturn } from '../src';

describe('выбор скидки из правил', () => {
  test('без правил — нет скидки', () => {
    expect(resolveDiscountPct([])).toEqual({ pct: '0.00', primaryRuleId: null });
  });
  test('несуммируемые — берём наибольший процент', () => {
    const r = resolveDiscountPct([
      { ruleId: 'a', discountPct: '5', stackable: false },
      { ruleId: 'b', discountPct: '10', stackable: false },
      { ruleId: 'c', discountPct: '7', stackable: false },
    ]);
    expect(r).toEqual({ pct: '10.00', primaryRuleId: 'b' });
  });
  test('суммируемые складываются с наибольшей несуммируемой', () => {
    const r = resolveDiscountPct([
      { ruleId: 'a', discountPct: '10', stackable: false },
      { ruleId: 'b', discountPct: '3', stackable: true },
      { ruleId: 'c', discountPct: '2', stackable: true },
    ]);
    expect(r).toEqual({ pct: '15.00', primaryRuleId: 'a' });
  });
  test('только суммируемые — базовая самая большая, остальные добавляются', () => {
    const r = resolveDiscountPct([
      { ruleId: 'a', discountPct: '3', stackable: true },
      { ruleId: 'b', discountPct: '5', stackable: true },
    ]);
    expect(r).toEqual({ pct: '8.00', primaryRuleId: 'b' });
  });
  test('сумма ограничена 100%', () => {
    const r = resolveDiscountPct([
      { ruleId: 'a', discountPct: '60', stackable: true },
      { ruleId: 'b', discountPct: '70', stackable: true },
    ]);
    expect(r.pct).toBe('100.00');
  });
});

describe('распределение списания баллов по строкам', () => {
  test('пропорционально сумме строки, остаток — на строку с большей суммой', () => {
    const lines = [
      { id: '1', total: '100.00' },
      { id: '2', total: '200.00' },
      { id: '3', total: '300.00' },
    ];
    const r = distributeRedemption(lines, '100');
    expect(r.find(x => x.lineId === '1')!.points).toBe('16.67');
    expect(r.find(x => x.lineId === '2')!.points).toBe('33.33');
    // большая доля + округление остатка
    expect(r.find(x => x.lineId === '3')!.points).toBe('50.00');
    const sum = r.reduce((a, x) => a + Number(x.points), 0);
    expect(sum).toBeCloseTo(100, 2);
  });
  test('списание больше суммы документа — ограничено суммой документа', () => {
    const lines = [{ id: '1', total: '50.00' }];
    const r = distributeRedemption(lines, '999');
    expect(r[0]!.points).toBe('50.00');
  });
  test('пустой список строк или нулевые баллы', () => {
    expect(distributeRedemption([], '10')).toEqual([]);
    expect(distributeRedemption([{ id: '1', total: '50.00' }], '0')).toEqual([{ lineId: '1', points: '0.00' }]);
  });
});

describe('накопительная шкала', () => {
  const scale = [
    { fromAmount: '0', pct: '0' },
    { fromAmount: '10000', pct: '3' },
    { fromAmount: '50000', pct: '5' },
  ];
  test('ниже первого порога', () => {
    expect(cumulativePctByScale('5000', scale)).toBe('0.00');
  });
  test('между порогами', () => {
    expect(cumulativePctByScale('20000', scale)).toBe('3.00');
  });
  test('выше верхнего порога', () => {
    expect(cumulativePctByScale('100000', scale)).toBe('5.00');
  });
  test('пустая шкала', () => {
    expect(cumulativePctByScale('100000', [])).toBe('0.00');
  });
});

describe('начисление и лимит списания баллов', () => {
  test('начисление — процент от суммы за вычетом списанного', () => {
    expect(accrualPoints('1000.00', '0.00', '5')).toBe('50.00');
    expect(accrualPoints('1000.00', '200.00', '5')).toBe('40.00');
  });
  test('база после списания отрицательна или ноль — начисление 0', () => {
    expect(accrualPoints('100.00', '150.00', '5')).toBe('0.00');
  });
  test('лимит списания — процент от суммы документа', () => {
    expect(redemptionLimit('1000.00', '30')).toBe('300.00');
  });
});

describe('сторно баллов при возврате', () => {
  test('пропорционально доле возврата', () => {
    expect(reversalPointsForReturn('50.00', '1000.00', '500.00')).toBe('25.00');
  });
  test('полный возврат — всё начисление', () => {
    expect(reversalPointsForReturn('50.00', '1000.00', '1000.00')).toBe('50.00');
  });
  test('нулевая сумма исходного документа', () => {
    expect(reversalPointsForReturn('50.00', '0.00', '0.00')).toBe('0.00');
  });
});

describe('FIFO-сгорание баллов', () => {
  const d = (s: string) => new Date(s);
  test('без расходов — весь просроченный лот сгорает', () => {
    const lots = [{ id: 'l1', createdAt: d('2026-01-01'), points: '50.00', expiresAt: d('2026-06-01') }];
    expect(fifoExpiredPoints(lots, '0', d('2026-07-01'))).toEqual([{ lotId: 'l1', points: '50.00' }]);
  });
  test('лот без срока не сгорает', () => {
    const lots = [{ id: 'l1', createdAt: d('2026-01-01'), points: '50.00', expiresAt: null }];
    expect(fifoExpiredPoints(lots, '0', d('2026-07-01'))).toEqual([]);
  });
  test('срок не наступил — не сгорает', () => {
    const lots = [{ id: 'l1', createdAt: d('2026-01-01'), points: '50.00', expiresAt: d('2026-12-01') }];
    expect(fifoExpiredPoints(lots, '0', d('2026-07-01'))).toEqual([]);
  });
  test('расход гасит самый старый лот первым (FIFO)', () => {
    const lots = [
      { id: 'l1', createdAt: d('2026-01-01'), points: '50.00', expiresAt: d('2026-06-01') },
      { id: 'l2', createdAt: d('2026-02-01'), points: '30.00', expiresAt: d('2026-12-01') },
    ];
    // списано 40 — гасит l1 целиком (50) частично? нет: 40 < 50, гасит 40 из l1, остаток l1 = 10 истёк → сгорает 10
    const r = fifoExpiredPoints(lots, '40', d('2026-07-01'));
    expect(r).toEqual([{ lotId: 'l1', points: '10.00' }]);
  });
  test('расход превышает первый лот — переходит на следующий по хронологии', () => {
    const lots = [
      { id: 'l1', createdAt: d('2026-01-01'), points: '50.00', expiresAt: d('2026-06-01') },
      { id: 'l2', createdAt: d('2026-02-01'), points: '30.00', expiresAt: d('2026-06-15') },
    ];
    // списано 60 — гасит l1 (50) целиком и 10 из l2; оба лота просрочены к июлю → l2 остаток 20 сгорает
    const r = fifoExpiredPoints(lots, '60', d('2026-07-01'));
    expect(r).toEqual([{ lotId: 'l2', points: '20.00' }]);
  });
  test('расход покрывает всё — ничего не сгорает', () => {
    const lots = [{ id: 'l1', createdAt: d('2026-01-01'), points: '50.00', expiresAt: d('2026-06-01') }];
    expect(fifoExpiredPoints(lots, '50', d('2026-07-01'))).toEqual([]);
  });
});
