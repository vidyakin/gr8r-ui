import { describe, expect, test } from 'bun:test';
import { BomCycleError, computeBomCost, computeNeeds, dec, explodeBom, fmt, findBomCycle, wouldCreateCycle, type BomItemInput, type BomLineInput } from '../src';

const prices: Record<string, string | null> = { wood: '100', screw: '2', paint: '50', fabric: null };
const rates: Record<string, string> = { carpentry: '600', assembly: '400' };
const pricing = { materialPrice: (id: string) => prices[id], workCenterRate: (id: string) => rates[id] };

const mat = (id: string, productId: string, qty: string, scrapPct = '0'): BomLineInput => ({ id, kind: 'material', productId, qty, scrapPct });
const semi = (id: string, childItemId: string, qty: string, semiMode?: 'stock' | 'explode'): BomLineInput => ({ id, kind: 'semi', childItemId, qty, ...(semiMode ? { semiMode } : {}) });
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

describe('explodeBom', () => {
  // Доска (полуфабрикат, партия 10): брус 2 с отходом 10% + работа 1 ч столярного
  const board = () => item('board', { batchQty: '10', productId: 'boardProduct', lines: [mat('b1', 'wood', '2', '10'), work('b2', { workCenterId: 'carpentry', hours: '1' })] });
  // Столешница: 2 доски + краска 0.5
  const top = (mode?: 'stock' | 'explode') => item('top', { productId: 'topProduct', lines: [semi('t1', 'board', '2', mode), mat('t2', 'paint', '0.5')] });
  // Стол (партия 10): столешница + 4 шурупа + сборка 1 ч
  const table = (mode?: 'stock' | 'explode') => item('table', { batchQty: '10', lines: [semi('x1', 'top', '1', mode), mat('x2', 'screw', '4'), work('x3', { workCenterId: 'assembly', hours: '1' })] });

  test('количество пропорционально qty / batch_qty: кратности партиям нет', () => {
    const items = [table(), top(), board()];
    const one = explodeBom(items, 'table', '1');
    expect(one.qty).toBe('1.000');
    expect(one.materials.map(m => [m.productId, m.qty])).toEqual([['screw', '0.400']]);
    expect(one.works.map(w => [w.operation, w.hours])).toEqual([['Op', '0.100']]);
    expect(one.semis.map(s => [s.itemId, s.qty])).toEqual([['top', '0.100']]);
    // 13 штук при партии 10: нормы × 1.3
    const thirteen = explodeBom(items, 'table', '13');
    expect(thirteen.materials.map(m => [m.productId, m.qty])).toEqual([['screw', '5.200']]);
    expect(thirteen.works.map(w => w.hours)).toEqual(['1.300']);
    expect(thirteen.semis.map(s => [s.itemId, s.qty])).toEqual([['top', '1.300']]);
    // разложение полуфабриката — на его партию: 2 доски, краска 0.5, а в доске брус 2.2 (с отходом)
    const child = thirteen.semis[0]!.child!;
    expect(child.materials.map(m => [m.productId, m.qty])).toEqual([['paint', '0.500']]);
    expect(child.semis.map(s => [s.itemId, s.qty])).toEqual([['board', '2.000']]);
    expect(child.semis[0]!.child!.materials.map(m => [m.productId, m.qty])).toEqual([['wood', '2.200']]);
  });

  test('полуфабрикат в режиме stock — строка на списание, в режиме explode — разворачивается до материалов', () => {
    const stock = explodeBom([table('stock'), top('stock'), board()], 'table', '1');
    expect(stock.semis.map(s => s.itemId)).toEqual(['top']);
    expect(stock.materials.map(m => m.productId)).toEqual(['screw']);
    const phantom = explodeBom([table('explode'), top('explode'), board()], 'table', '1');
    expect(phantom.semis).toEqual([]);
    // стол (партия 10) на 1 штуку: 0.1 столешницы -> 0.2 доски -> 0.02 партии досок: брус 0.044 (с отходом), краска 0.05
    expect(phantom.materials.map(m => [m.productId, m.qty])).toEqual([
      ['wood', '0.044'],
      ['paint', '0.050'],
      ['screw', '0.400'],
    ]);
  });

  test('цикл в спецификации — BomCycleError', () => {
    const a = item('a', { lines: [semi('1', 'b', '1')] });
    const b = item('b', { lines: [semi('2', 'a', '1')] });
    expect(() => explodeBom([a, b], 'a', '1')).toThrow(BomCycleError);
  });
});

describe('computeNeeds', () => {
  const board = () => item('board', { batchQty: '10', productId: 'boardProduct', lines: [mat('b1', 'wood', '2', '10'), work('b2', { workCenterId: 'carpentry', hours: '1' })] });
  const top = () => item('top', { productId: 'topProduct', lines: [semi('t1', 'board', '2'), mat('t2', 'paint', '0.5')] });
  const table = () => item('table', { batchQty: '10', lines: [semi('x1', 'top', '1'), mat('x2', 'screw', '4'), work('x3', { workCenterId: 'assembly', hours: '1' })] });
  const chain = () => [table(), top(), board()];

  test('нужно, доступно и дефицит по материалам', () => {
    const x = item('x', { lines: [mat('m1', 'screw', '4'), mat('m2', 'wood', '2')] });
    const needs = computeNeeds(explodeBom([x], 'x', '1'), { screw: '3' });
    expect(needs.materials.map(m => [m.productId, m.qty, m.available, m.deficit])).toEqual([
      ['screw', '4.000', '3.000', '1.000'],
      ['wood', '2.000', '0.000', '2.000'],
    ]);
    expect(needs.semis).toEqual([]);
  });

  test('дефицит полуфабриката в режиме stock разворачивается до его материалов и работ', () => {
    const needs = computeNeeds(explodeBom(chain(), 'table', '13'), {});
    // стол: 13 штук при партии 10 -> 1.3 столешницы -> 2.6 доски -> 0.26 партии досок -> брус 0.572
    expect(needs.semis.map(s => [s.itemId, s.qty, s.available, s.deficit, s.produce])).toEqual([
      ['top', '1.300', '0.000', '1.300', '1.300'],
      ['board', '2.600', '0.000', '2.600', '2.600'],
    ]);
    expect(needs.materials.map(m => [m.productId, m.qty])).toEqual([
      ['screw', '5.200'],
      ['paint', '0.650'],
      ['wood', '0.572'],
    ]);
    expect(needs.works.map(w => w.hours)).toEqual(['1.300', '0.260']);
  });

  test('полуфабриката хватает на складе — его материалы не нужны', () => {
    const needs = computeNeeds(explodeBom(chain(), 'table', '13'), { topProduct: '5', boardProduct: '10' });
    expect(needs.semis.map(s => [s.itemId, s.qty, s.deficit, s.produce])).toEqual([['top', '1.300', '0.000', '0.000']]);
    expect(needs.materials.map(m => m.productId)).toEqual(['screw']);
    expect(needs.works.map(w => w.hours)).toEqual(['1.300']);
  });

  test('полуфабрикат в режиме explode в потребности не появляется', () => {
    const items = [item('table', { batchQty: '10', lines: [semi('x1', 'top', '1', 'explode'), mat('x2', 'screw', '4')] }), top(), board()];
    const needs = computeNeeds(explodeBom(items, 'table', '13'), {});
    // столешница развёрнута до материалов, поэтому её нет среди полуфабрикатов; доска внутри неё — обычный складской материал
    expect(needs.semis.map(s => s.itemId)).toEqual(['board']);
    expect(needs.materials.map(m => [m.productId, m.qty])).toEqual([
      ['paint', '0.650'],
      ['screw', '5.200'],
      ['wood', '0.572'],
    ]);
  });

  test('один и тот же товар на разных уровнях агрегируется: остаток не списывается дважды', () => {
    // стол: 4 шурупа напрямую + 2 шурупа в доске, которую нужно выпустить; шурупов на складе 5
    const items = [item('table', { batchQty: '1', lines: [mat('m1', 'screw', '4'), semi('s1', 'board', '1')] }), item('board', { batchQty: '1', productId: 'boardProduct', lines: [mat('b1', 'screw', '2')] })];
    const needs = computeNeeds(explodeBom(items, 'table', '1'), { screw: '5' });
    expect(needs.materials.map(m => [m.productId, m.qty, m.available, m.deficit])).toEqual([['screw', '6.000', '5.000', '1.000']]);
    expect(needs.semis.map(s => [s.itemId, s.qty, s.produce])).toEqual([['board', '1.000', '1.000']]);
  });
});

describe('параметрическая спецификация (этап 7)', () => {
  const glass: BomLineInput = { id: 'g', kind: 'material', productId: 'glass', qty: '1', scrapPct: '0', qtyExpr: 'width * height / 1000000 * 1.05' };
  const paint: BomLineInput = { id: 'p', kind: 'material', productId: 'paint', qty: '1', scrapPct: '0', condition: "color = 'white'" };
  const expense: BomLineInput = { id: 'e', kind: 'expense', productId: 'painting', qty: '1', scrapPct: '0' };
  const window: BomItemInput = { id: 'window', name: 'Окно', batchQty: '1', overheadPct: '0', paramKeys: ['width', 'height', 'color'], lines: [glass, paint, expense] };

  test('количество строки считается формулой, условие исключает строку из состава', () => {
    const white = explodeBom([{ ...window, params: { width: 1200, height: 1400, color: 'white' } }], 'window', '1');
    expect(white.materials.map(m => [m.productId, m.qty])).toEqual([
      ['glass', '1.764'],
      ['paint', '1.000'],
      ['painting', '1.000'],
    ]);
    const black = explodeBom([{ ...window, params: { width: 1200, height: 1400, color: 'black' } }], 'window', '1');
    expect(black.materials.map(m => m.productId)).toEqual(['glass', 'painting']);
  });

  test('расход подрядчику входит в развёртку, но не в потребность', () => {
    const needs = computeNeeds(explodeBom([{ ...window, params: { width: 1200, height: 1400, color: 'white' } }], 'window', '1'), {});
    expect(needs.materials.map(m => m.productId)).toEqual(['glass', 'paint']);
  });

  test('себестоимость: расход идёт в материалы, условие отключает строку', () => {
    const p = { materialPrice: (id: string) => (id === 'glass' ? '100' : id === 'paint' ? '50' : '300'), workCenterRate: () => undefined };
    const t = computeBomCost([{ ...window, params: { width: 1200, height: 1400, color: 'white' } }], 'window', p);
    expect(t.batch.materials).toBe('526.4000'); // 1.764*100 + 50 (краска) + 300 (расход)
    const black = computeBomCost([{ ...window, params: { width: 1200, height: 1400, color: 'black' } }], 'window', p);
    expect(black.batch.materials).toBe('476.4000'); // без краски
  });

  test('параметры передаются вложенной продукции по совпадающим ключам', () => {
    const frame: BomItemInput = { id: 'frame', name: 'Рама', batchQty: '1', overheadPct: '0', paramKeys: ['color'], lines: [{ id: 'f', kind: 'material', productId: 'wood', qty: '1', scrapPct: '0', qtyExpr: "if(color = 'white', 2, 4)" }] };
    const parent: BomItemInput = { id: 'parent', name: 'Изделие', batchQty: '1', overheadPct: '0', paramKeys: ['color'], params: { color: 'white' }, lines: [{ id: 's', kind: 'semi', childItemId: 'frame', qty: '1', semiMode: 'explode' }] };
    expect(explodeBom([parent, frame], 'parent', '1').materials.map(m => m.qty)).toEqual(['2.000']);
  });

  test('без параметров поведение строго прежнее', () => {
    const plain = item('plain', { lines: [mat('m1', 'wood', '2')] });
    expect(computeBomCost([plain], 'plain', pricing).batch.materials).toBe('200.0000');
  });
});

describe('возвратные отходы (задача 1136)', () => {
  const waste = (id: string, productId: string, qty: string): BomLineInput => ({ id, kind: 'waste', productId, qty });

  test('учётная стоимость отходов вычитается из затрат, накладные считаются от затрат без вычета', () => {
    const t = item('table', { overheadPct: '10', lines: [mat('l1', 'wood', '2'), waste('w1', 'screw', '5')] });
    const r = computeBomCost([t], 'table', { ...pricing, wastePrice: id => (id === 'screw' ? '3' : null) });
    // материалы 200, накладные 10 % от 200 = 20, отходы 5 × 3 = 15
    expect(r.batch).toEqual({ materials: '200.0000', works: '0.0000', overhead: '20.0000', waste: '-15.0000', total: '205.0000' });
    expect(r.lines.map(l => [l.kind, l.cost])).toEqual([['material', '200.0000'], ['waste', '-15.0000']]);
  });

  test('цена отхода по умолчанию — цена материала; нет цены — строка помечена, вычета нет', () => {
    const t = item('t', { lines: [mat('l1', 'wood', '1'), waste('w1', 'fabric', '2')] });
    const r = computeBomCost([t], 't', pricing);
    expect(r.batch.total).toBe('100.0000');
    expect(r.lines[1]).toMatchObject({ kind: 'waste', missingPrice: true });
  });

  test('без отходов разбивка прежняя: поля waste нет', () => {
    const r = computeBomCost([item('p', { lines: [mat('l1', 'wood', '1')] })], 'p', pricing);
    expect(r.batch).toEqual({ materials: '100.0000', works: '0.0000', overhead: '0.0000', total: '100.0000' });
  });

  test('развёртка: отходы масштабируются на партию, у «фантома» попадают в родителя, этапа у них нет', () => {
    const child = item('board', { batchQty: '2', lines: [mat('b1', 'wood', '1'), { ...waste('bw', 'screw', '4'), stageId: 'cut' }] });
    const parent = item('table', { lines: [semi('s1', 'board', '2', 'explode'), waste('w1', 'paint', '1')] });
    const e = explodeBom([parent, child], 'table', '3');
    // партия доски 2 шт.: на 6 досок 3 партии -> отходов 12; плюс собственный отход стола на 3 шт.
    expect(e.wastes.map(w => [w.productId, w.qty, w.stageId])).toEqual([['screw', '12.000', null], ['paint', '3.000', null]]);
    expect(e.materials).toHaveLength(1);
  });
});
