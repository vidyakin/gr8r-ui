import { describe, expect, test } from 'bun:test';
import { calculateSalesAbc, calculateSalesProfit } from '../src/sales-profit';

describe('sales profit', () => {
  test('subtracts returns and aggregates amounts without floating point', () => {
    const rows = calculateSalesProfit([
      { groupId: '1', groupName: 'Product', type: 'realization', revenue: '100.10', discount: '10.00', cogs: '60.00' },
      { groupId: '1', groupName: 'Product', type: 'customer_return', revenue: '20.10', discount: '2.00', cogs: '12.00' },
    ]);
    expect(rows).toEqual([{ groupId: '1', groupName: 'Product', revenue: '80.00', discount: '8.00', cogs: '48.00', grossProfit: '32.00', grossMarginPct: '40.00' }]);
  });
  test('does not divide by zero', () => {
    expect(calculateSalesProfit([{ groupId: '1', groupName: 'P', type: 'realization', revenue: '0', discount: '0', cogs: '2' }])[0]?.grossMarginPct).toBeNull();
  });
});

describe('ABC', () => {
  const rows = calculateSalesProfit(['80', '15', '5', '-1'].map((revenue, i) => ({ groupId: String(i), groupName: String(i), type: 'realization' as const, revenue, discount: '0', cogs: '0' })));
  test('uses previous cumulative share for boundaries and excludes negative values', () => {
    const result = calculateSalesAbc(rows, 'revenue');
    expect(result.map(r => r.abcClass)).toEqual(['A', 'B', 'C', 'C']);
    expect(result.map(r => r.cumulativePct)).toEqual(['80.00', '95.00', '100.00', '100.00']);
  });
  test('supports profit and custom thresholds', () => {
    expect(calculateSalesAbc(rows, 'profit', { a: 50, b: 50 }).map(r => r.abcClass)).toEqual(['A', 'B', 'B', 'C']);
    expect(() => calculateSalesAbc(rows, 'revenue', { a: 90, b: 20 })).toThrow(RangeError);
  });
});
