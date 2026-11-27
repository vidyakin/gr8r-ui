/* Тесты распределения дополнительных расходов (задача 1385): копеечная точность, способы распределения,
   фолбэк «по весу», ручной ввод и граничные случаи. */
import { describe, expect, test } from 'bun:test';
import { allocateLandedCost, fmt, landedCostLineWeight, landedCostWeights, manualLandedCostError, isLandedCostBaseType, LANDED_COST_BASE_TYPES, LANDED_COST_METHODS } from '../src';

const line = (id: string, baseAmount: string, qty: string, weight?: string | null, amount?: string | null) => ({ id, baseAmount, qty, weight, amount });

describe('landed cost base types', () => {
  test('only receipt and production bring goods onto our own stock', () => {
    expect(LANDED_COST_BASE_TYPES).toEqual(['receipt', 'production']);
    expect(isLandedCostBaseType('receipt')).toBe(true);
    expect(isLandedCostBaseType('production')).toBe(true);
    // давальческое сырьё и внутренние документы прихода своего склада не дают
    expect(isLandedCostBaseType('tolling_receipt')).toBe(false);
    expect(isLandedCostBaseType('stock_posting')).toBe(false);
    expect(isLandedCostBaseType(null)).toBe(false);
    expect(LANDED_COST_METHODS).toContain('manual');
  });
});

describe('landed cost weights', () => {
  test('by amount uses line value, by qty uses quantity, by weight uses weight', () => {
    const lines = [line('a', '100.00', '1.000', '2.000'), line('b', '300.00', '3.000', '1.000')];
    expect(landedCostWeights(lines, 'by_amount').weights.map(v => fmt(v, 2))).toEqual(['100.00', '300.00']);
    expect(landedCostWeights(lines, 'by_qty').weights.map(v => fmt(v, 3))).toEqual(['1.000', '3.000']);
    expect(landedCostWeights(lines, 'by_weight').weights.map(v => fmt(v, 3))).toEqual(['2.000', '1.000']);
  });

  test('by weight falls back to quantity when no line has a weight, then to amount', () => {
    const noWeight = [line('a', '100.00', '2.000'), line('b', '300.00', '4.000')];
    const qty = landedCostWeights(noWeight, 'by_weight');
    expect(qty.mode).toBe('by_qty');
    expect(qty.fallback).toBe(true);
    expect(qty.weights.map(v => fmt(v, 3))).toEqual(['2.000', '4.000']);
    // ни веса, ни количества — база берётся из суммы строки
    const empty = landedCostWeights([line('a', '50.00', '0'), line('b', '50.00', '0')], 'by_weight');
    expect(empty.mode).toBe('by_amount');
    expect(empty.fallback).toBe(true);
  });

  test('partial weight keeps the weight method and gives a zero share to the line without weight', () => {
    const w = landedCostWeights([line('a', '100.00', '1.000', '5.000'), line('b', '100.00', '1.000')], 'by_weight');
    expect(w.mode).toBe('by_weight');
    expect(w.partial).toBe(true);
    expect(fmt(w.weights[1]!, 3)).toBe('0.000');
  });
});

describe('allocateLandedCost', () => {
  test('by amount splits kopecks exactly: the sum of shares equals the expense total', () => {
    const out = allocateLandedCost({ method: 'by_amount', amount: '100.00', lines: [line('a', '33.33', '1'), line('b', '33.33', '1'), line('c', '33.34', '1')] });
    expect(out.rows.map(r => r.amount)).toEqual(['33.33', '33.33', '33.34']);
    expect(out.total).toBe('100.00');
    expect(out.rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0)).toBe(10000);
  });

  test('by qty: 100.00 over 1 + 2 + 3 gives 16.67 / 33.33 / 50.00', () => {
    const out = allocateLandedCost({ method: 'by_qty', amount: '100.00', lines: [line('a', '0', '1'), line('b', '0', '2'), line('c', '0', '3')] });
    expect(out.rows.map(r => r.amount)).toEqual(['16.67', '33.33', '50.00']);
    expect(out.mode).toBe('by_qty');
    expect(out.fallback).toBe(false);
  });

  test('by weight: 120.00 over 2 kg and 1 kg gives 80.00 and 40.00', () => {
    const out = allocateLandedCost({ method: 'by_weight', amount: '120.00', lines: [line('a', '10.00', '1', '2.000'), line('b', '10.00', '1', '1.000')] });
    expect(out.rows.map(r => r.amount)).toEqual(['80.00', '40.00']);
  });

  test('by weight without weights falls back to quantity', () => {
    const out = allocateLandedCost({ method: 'by_weight', amount: '90.00', lines: [line('a', '0', '1'), line('b', '0', '2')] });
    expect(out.mode).toBe('by_qty');
    expect(out.fallback).toBe(true);
    expect(out.rows.map(r => r.amount)).toEqual(['30.00', '60.00']);
  });

  test('manual takes per-line amounts and the total is their sum', () => {
    const out = allocateLandedCost({ method: 'manual', lines: [line('a', '0', '1', null, '10.10'), line('b', '0', '1', null, '20.20')] });
    expect(out.rows.map(r => r.amount)).toEqual(['10.10', '20.20']);
    expect(out.total).toBe('30.30');
    expect(out.mode).toBe('manual');
    // доли показываются в процентах и складываются в 100.00
    expect(out.rows.reduce((s, r) => s + Number(r.sharePct), 0)).toBeCloseTo(100, 6);
  });

  test('shares in percent always add up to 100.00', () => {
    const out = allocateLandedCost({ method: 'by_qty', amount: '10.00', lines: [line('a', '0', '1'), line('b', '0', '1'), line('c', '0', '1')] });
    expect(out.rows.reduce((s, r) => s + Math.round(Number(r.sharePct) * 100), 0)).toBe(10000);
  });

  test('boundary: empty line list, zero amount and zero base give zero shares, not a crash', () => {
    expect(allocateLandedCost({ method: 'by_qty', amount: '10.00', lines: [] })).toMatchObject({ rows: [], total: '0.00' });
    expect(allocateLandedCost({ method: 'by_amount', amount: '0', lines: [line('a', '10', '1')] }).rows[0]!.amount).toBe('0.00');
    const zeroBase = allocateLandedCost({ method: 'by_amount', amount: '10.00', lines: [line('a', '0', '0'), line('b', '0', '0')] });
    expect(zeroBase.rows.map(r => r.amount)).toEqual(['0.00', '0.00']);
    expect(zeroBase.rows.map(r => r.sharePct)).toEqual(['0.00', '0.00']);
  });

  test('a single line takes the whole amount', () => {
    expect(allocateLandedCost({ method: 'by_amount', amount: '7.77', lines: [line('a', '1', '1')] }).rows[0]).toMatchObject({ amount: '7.77', sharePct: '100.00' });
  });
});

describe('manual allocation validation', () => {
  test('empty, negative and all-zero manual lists are rejected', () => {
    expect(manualLandedCostError([])).toBe('empty');
    expect(manualLandedCostError([line('a', '0', '1', null, '-1.00')])).toBe('negative');
    expect(manualLandedCostError([line('a', '0', '1', null, '0.00'), line('b', '0', '1', null, '0')])).toBe('zero');
    expect(manualLandedCostError([line('a', '0', '1', null, '0.01')])).toBeNull();
  });
});

describe('landedCostLineWeight', () => {
  test('weight = quantity × unit weight, missing weight is zero', () => {
    expect(landedCostLineWeight('2.000', '1.5')).toBe('3.000');
    expect(landedCostLineWeight('2.000', null)).toBe('0.000');
    expect(landedCostLineWeight('0', '1.5')).toBe('0.000');
  });
});
