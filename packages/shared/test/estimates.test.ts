/* Смета объекта (задача 1269): итоги сметы — сумма заказчику, плановая себестоимость, часы и маржа без float. */
import { describe, expect, test } from 'bun:test';
import { computeEstimateTotals, estimateLineTotals, estimatePlanFact } from '@gr8r/shared';

const item = (over: Partial<{ id: string; kind: string; qty: string; price: string; costPrice: string; laborHours: string }> = {}) => ({
  kind: 'work',
  qty: '1',
  price: '0',
  costPrice: '0',
  laborHours: '0',
  ...over,
});

describe('смета: итоги', () => {
  test('сумма, себестоимость и часы считаются по строкам', () => {
    const items = [item({ qty: '120', price: '850', costPrice: '600', laborHours: '0.25' }), item({ kind: 'material', qty: '10', price: '300.50', costPrice: '250.10' })];
    expect(estimateLineTotals(items[0]!)).toEqual({ revenue: '102000.00', cost: '72000.00', hours: '30.000' });
    expect(computeEstimateTotals(items)).toEqual({ revenue: '105005.00', cost: '74501.00', hours: '30.000', margin: '30504.00', marginPct: '29.05' });
  });

  test('округление — до копейки по каждой строке, итоги складывают округлённые строки', () => {
    const items = [item({ qty: '3', price: '0.335' }), item({ qty: '1', price: '0.005' })];
    expect(items.map(i => estimateLineTotals(i).revenue)).toEqual(['1.01', '0.01']);
    expect(computeEstimateTotals(items).revenue).toBe('1.02');
  });

  test('маржа при нулевой сумме не считается, отрицательная маржа — со знаком', () => {
    expect(computeEstimateTotals([]).marginPct).toBeNull();
    const loss = computeEstimateTotals([item({ qty: '1', price: '100', costPrice: '150' })]);
    expect(loss.margin).toBe('-50.00');
    expect(loss.marginPct).toBe('-50.00');
  });

  test('план-факт: факт пока нулевой, остаток равен плану; факт подставляется извне', () => {
    const items = [item({ id: 'a', qty: '2', price: '100', costPrice: '70', laborHours: '1' })];
    const [row] = estimatePlanFact(items, {});
    expect(row).toEqual({
      id: 'a',
      plan: { revenue: '200.00', cost: '140.00', hours: '2.000' },
      fact: { revenue: '0.00', cost: '0.00', hours: '0.000' },
      remaining: { revenue: '200.00', cost: '140.00', hours: '2.000' },
    });
    const [withFact] = estimatePlanFact(items, { a: { revenue: '150.00', cost: '100.00', hours: '1.500' } });
    expect(withFact!.remaining).toEqual({ revenue: '50.00', cost: '40.00', hours: '0.500' });
  });
});
