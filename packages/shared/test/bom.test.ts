import { describe, expect, test } from 'bun:test';
import { BomCycleError, computeBomCost, dec, fmt, findBomCycle, wouldCreateCycle, type BomItemInput, type BomLineInput } from '../src';

const prices: Record<string, string | null> = { wood: '100', screw: '2', paint: '50', fabric: null };
const rates: Record<string, string> = { carpentry: '600', assembly: '400' };
const pricing = { materialPrice: (id: string) => prices[id], workCenterRate: (id: string) => rates[id] };

const mat = (id: string, productId: string, qty: string, scrapPct = '0'): BomLineInput => ({ id, kind: 'material', productId, qty, scrapPct });
const semi = (id: string, childItemId: string, qty: string): BomLineInput => ({ id, kind: 'semi', childItemId, qty });
const work = (id: string, over: Partial<BomLineInput>): BomLineInput => ({ id, kind: 'work', qty: '1', operation: 'Op', ...over });
const item = (id: string, over: Partial<BomItemInput>): BomItemInput => ({ id, name: id, batchQty: '1', overheadPct: '0', lines: [], ...over });

describe('decimal', () => {
  test('exact arithmetic and formatting', () => {
    expect(fmt(dec('0.1') + dec('0.2'), 2)).toBe('0.30');
    expect(fmt(dec('10') / 3n, 4)).toBe('3.3333');
    expect(fmt(dec('2.005'), 2)).toBe('2.01'); // половина вверх
    expect(fmt(dec('-2.005'), 2)).toBe('-2.01');
    expect(fmt(dec(''), 2)).toBe('0.00');
    expect(fmt(dec(1.5), 1)).toBe('1.5');
  });
});

describe('computeBomCost', () => {
  test('flat item: materials with scrap, works by hours x center rate, fixed cost, overhead on direct cost', () => {
    const t = item('table', {
      overheadPct: '10',
      lines: [mat('l1', 'wood', '2', '10'), mat('l2', 'screw', '8'), work('l3', { workCenterId: 'carpentry', hours: '0.5' }), work('l4', { rate: '1000', hours: '1', fixedCost: '25' })],
    });
    const r = computeBomCost([t], 'table', pricing);
    // материалы: 2*100*1.1 = 220 + 8*2 = 16 -> 236; работы: 0.5*600 = 300 + (1*1000 + 25) = 1325; накладные: 10% от 1561
    expect(r.batch).toEqual({ materials: '236.0000', works: '1325.0000', overhead: '156.1000', total: '1717.1000' });
    expect(r.unit.total).toBe('1717.1000');
    expect(r.lines.map(l => l.cost)).toEqual(['220.0000', '16.0000', '300.0000', '1025.0000']);
  });

  test('three levels: semi inside semi, rolled up breakdown, own overhead per node (no double counting)', () => {
    const board = item('board', { overheadPct: '20', lines: [mat('b1', 'wood', '1'), work('b2', { workCenterId: 'carpentry', hours: '0.1' })] }); // 100 + 60 = 160, накладные 32 -> 192
    const top = item('top', { lines: [semi('t1', 'board', '2'), mat('t2', 'paint', '0.5')] }); // 2*192 + 25 = 409
    const table = item('table', { overheadPct: '10', lines: [semi('x1', 'top', '1'), mat('x2', 'screw', '4'), work('x3', { workCenterId: 'assembly', hours: '1' })] });
    const r = computeBomCost([table, top, board], 'table', pricing);
    const topNode = r.lines[0]!.child!;
    const boardNode = topNode.lines[0]!.child!;
    expect(boardNode.unit).toEqual({ materials: '100.0000', works: '60.0000', overhead: '32.0000', total: '192.0000' });
    expect(topNode.unit).toEqual({ materials: '225.0000', works: '120.0000', overhead: '64.0000', total: '409.0000' });
    // стол: прямые собственные = 4*2 + 400 = 408 -> накладные 40.8; всё остальное — из полуфабриката
    expect(r.unit).toEqual({ materials: '233.0000', works: '520.0000', overhead: '104.8000', total: '857.8000' });
    expect(r.lines[0]!.cost).toBe('409.0000');
  });

  test('batch: cost of one unit is batch cost divided by batch quantity (and semi pulls the unit cost)', () => {
    const legs = item('legs', { batchQty: '4', lines: [mat('a', 'wood', '1'), work('b', { fixedCost: '10' })] }); // партия 110 -> 27.5 за ногу
    const stool = item('stool', { lines: [semi('s', 'legs', '3')] });
    const r = computeBomCost([stool, legs], 'stool', pricing);
    expect(r.lines[0]!.child!.batch.total).toBe('110.0000');
    expect(r.lines[0]!.child!.unit.total).toBe('27.5000');
    expect(r.unit.total).toBe('82.5000');
    // не делится нацело: 100 / 3
    const odd = item('odd', { batchQty: '3', lines: [mat('a', 'wood', '1')] });
    expect(computeBomCost([odd], 'odd', pricing).unit.total).toBe('33.3333');
  });

  test('material without a price is flagged and costs nothing', () => {
    const r = computeBomCost([item('x', { lines: [mat('a', 'fabric', '5'), mat('b', 'wood', '1')] })], 'x', pricing);
    expect(r.lines[0]).toMatchObject({ missingPrice: true, cost: '0.0000' });
    expect(r.lines[1]!.missingPrice).toBeUndefined();
    expect(r.unit.total).toBe('100.0000');
  });

  test('cycle: direct, indirect and self reference throw with the chain', () => {
    const a = item('a', { lines: [semi('1', 'b', '1')] });
    const b = item('b', { lines: [semi('2', 'c', '1')] });
    const c = item('c', { lines: [semi('3', 'a', '1')] });
    expect(() => computeBomCost([a, b, c], 'a', pricing)).toThrow(BomCycleError);
    try {
      computeBomCost([a, b, c], 'a', pricing);
    } catch (e) {
      expect((e as BomCycleError).path).toEqual(['a', 'b', 'c', 'a']);
    }
    expect(() => computeBomCost([item('s', { lines: [semi('1', 's', '1')] })], 's', pricing)).toThrow(BomCycleError);
    expect(findBomCycle([a, b, c])).toEqual(['a', 'b', 'c', 'a']);
    expect(findBomCycle([a, b, item('c', {})])).toBeNull();
  });

  test('the same semi used twice (diamond) is not a cycle', () => {
    const leaf = item('leaf', { lines: [mat('m', 'screw', '1')] });
    const l = item('l', { lines: [semi('1', 'leaf', '1')] });
    const r = item('r', { lines: [semi('2', 'leaf', '2')] });
    const root = item('root', { lines: [semi('3', 'l', '1'), semi('4', 'r', '1')] });
    expect(computeBomCost([root, l, r, leaf], 'root', pricing).unit.total).toBe('6.0000');
  });

  test('wouldCreateCycle checks reachability on the edge map', () => {
    const edges = new Map([
      ['a', ['b']],
      ['b', ['c']],
    ]);
    expect(wouldCreateCycle(edges, 'c', 'a')).toBe(true); // c -> a замкнёт a -> b -> c
    expect(wouldCreateCycle(edges, 'a', 'c')).toBe(false);
    expect(wouldCreateCycle(edges, 'a', 'a')).toBe(true);
  });

  test('invalid batch quantity is rejected', () => {
    expect(() => computeBomCost([item('x', { batchQty: '0' })], 'x', pricing)).toThrow(RangeError);
  });
});
