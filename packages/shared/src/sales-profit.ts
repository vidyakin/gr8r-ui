/* Чистые расчёты продаж для отчёта P&L и ABC. Денежные значения передаются строками. */
import { dec, div, fmt, mul } from './decimal';

export interface SalesProfitEntry {
  groupId: string;
  groupName: string;
  type: 'realization' | 'customer_return';
  /** Сумма после скидки. */
  revenue: string;
  discount: string;
  /** Сумма движений склада по цене движения. */
  cogs: string;
}

export interface SalesProfitRow {
  groupId: string;
  groupName: string;
  revenue: string;
  discount: string;
  cogs: string;
  grossProfit: string;
  grossMarginPct: string | null;
}

/** Возвраты уменьшают все суммы; маржа не определена при нулевой выручке. */
export function calculateSalesProfit(entries: readonly SalesProfitEntry[]): SalesProfitRow[] {
  const groups = new Map<string, { name: string; revenue: bigint; discount: bigint; cogs: bigint }>();
  for (const entry of entries) {
    const g = groups.get(entry.groupId) ?? { name: entry.groupName, revenue: 0n, discount: 0n, cogs: 0n };
    const sign = entry.type === 'customer_return' ? -1n : 1n;
    g.revenue += sign * dec(entry.revenue);
    g.discount += sign * dec(entry.discount);
    g.cogs += sign * dec(entry.cogs);
    groups.set(entry.groupId, g);
  }
  return [...groups].map(([groupId, g]) => {
    const profit = g.revenue - g.cogs;
    return {
      groupId, groupName: g.name, revenue: fmt(g.revenue, 2), discount: fmt(g.discount, 2),
      cogs: fmt(g.cogs, 2), grossProfit: fmt(profit, 2),
      grossMarginPct: g.revenue === 0n ? null : fmt(mul(div(profit, g.revenue), dec('100')), 2),
    };
  });
}

export interface AbcRow extends SalesProfitRow {
  abcClass: 'A' | 'B' | 'C';
  contributionPct: string;
  cumulativePct: string;
}

/** Положительные значения формируют базу; нулевые и отрицательные входят в C с нулевым вкладом.
 * Класс определяется накопленным вкладом ДО товара, поэтому товар, пересекающий границу, остаётся в предыдущем классе. */
export function calculateSalesAbc(rows: readonly SalesProfitRow[], metric: 'revenue' | 'profit', thresholds = { a: 80, b: 15 }): AbcRow[] {
  if (!Number.isFinite(thresholds.a) || !Number.isFinite(thresholds.b) || thresholds.a < 0 || thresholds.b < 0 || thresholds.a + thresholds.b > 100) {
    throw new RangeError('Invalid ABC thresholds');
  }
  const value = (row: SalesProfitRow) => dec(metric === 'revenue' ? row.revenue : row.grossProfit);
  const sorted = [...rows].sort((a, b) => {
    const diff = value(b) - value(a);
    return diff > 0n ? 1 : diff < 0n ? -1 : a.groupId.localeCompare(b.groupId);
  });
  const total = sorted.reduce((sum, row) => sum + (value(row) > 0n ? value(row) : 0n), 0n);
  let cumulative = 0n;
  return sorted.map(row => {
    const amount = value(row) > 0n ? value(row) : 0n;
    const before = cumulative;
    cumulative += amount;
    const abcClass = amount === 0n || total === 0n ? 'C' : before * dec('100') < total * dec(thresholds.a) ? 'A' : before * dec('100') < total * dec(thresholds.a + thresholds.b) ? 'B' : 'C';
    const percent = (n: bigint) => total ? fmt(mul(div(n, total), dec('100')), 2) : '0.00';
    return { ...row, abcClass, contributionPct: percent(amount), cumulativePct: percent(cumulative) };
  });
}
