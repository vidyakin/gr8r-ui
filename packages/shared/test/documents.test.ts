import { describe, expect, test } from 'bun:test';
import { basedOnTargets, canChangeState, computeDocument, computeLine, computeTotals, dec, DOCUMENT_META, DOCUMENT_TYPES, documentTypesOf, fmt, formatDocumentNumber, lineRole, replayMoves, stateTransitions, stockIn, stockOut, stockPlan, weightedAvgCost } from '../src';

const line = (qty: string, price: string, vatRate: string, discountPct = '0') => ({ qty, price, vatRate, discountPct });

describe('line amounts', () => {
  test('VAT on top: net is the price × qty, VAT is added', () => {
    expect(computeLine(line('3', '100', '20'), false)).toEqual({ net: '300.00', vatAmount: '60.00', total: '360.00' });
    expect(computeLine(line('3', '100', '10'), false)).toEqual({ net: '300.00', vatAmount: '30.00', total: '330.00' });
  });
  test('VAT included: total is the price × qty, VAT is extracted', () => {
    expect(computeLine(line('3', '100', '20'), true)).toEqual({ net: '250.00', vatAmount: '50.00', total: '300.00' });
    expect(computeLine(line('1', '110', '10'), true)).toEqual({ net: '100.00', vatAmount: '10.00', total: '110.00' });
  });
  test('no VAT and zero rate', () => {
    expect(computeLine(line('2', '50', 'none'), true)).toEqual({ net: '100.00', vatAmount: '0.00', total: '100.00' });
    expect(computeLine(line('2', '50', '0'), false)).toEqual({ net: '100.00', vatAmount: '0.00', total: '100.00' });
  });
  test('discount applies before VAT', () => {
    expect(computeLine(line('2', '100', '20', '10'), false)).toEqual({ net: '180.00', vatAmount: '36.00', total: '216.00' });
    expect(computeLine(line('2', '100', '20', '10'), true)).toEqual({ net: '150.00', vatAmount: '30.00', total: '180.00' });
    expect(computeLine(line('1', '100', '20', '100'), false).total).toBe('0.00');
  });
  test('rounding: half away from zero, once per line', () => {
    expect(computeLine(line('0.5', '0.05', 'none'), false).total).toBe('0.03'); // 0.025
    expect(computeLine(line('1', '1.00', 'none', '12.5'), false).total).toBe('0.88'); // 0.875
    expect(computeLine(line('1.001', '24.99', 'none'), false).total).toBe('25.01'); // 25.01499
    expect(computeLine(line('3', '0.335', 'none'), false).total).toBe('1.01'); // 1.005
    // 0.0249996 не должно стать 0.03 из-за промежуточного округления
    expect(computeLine(line('0.001', '24.9996', 'none'), false).total).toBe('0.02');
  });
  test('VAT extraction rounds the VAT, net is the remainder (net + vat = total always)', () => {
    for (const price of ['0.10', '0.35', '1.99', '19.99', '123.45', '999.99']) {
      for (const rate of ['5', '7', '10', '20']) {
        const r = computeLine(line('1', price, rate), true);
        expect(fmt(dec(r.net) + dec(r.vatAmount), 2)).toBe(r.total);
      }
    }
    expect(computeLine(line('1', '0.10', '20'), true)).toEqual({ net: '0.08', vatAmount: '0.02', total: '0.10' });
    expect(computeLine(line('1', '19.99', '20'), true)).toEqual({ net: '16.66', vatAmount: '3.33', total: '19.99' });
  });
  test('large values stay exact', () => {
    // 1234567.891 × 9999999.99 = 12345678897654.3210... → 12345678897654.32; НДС 20% = 2469135779530.864 → .86
    expect(computeLine(line('1234567.891', '9999999.99', '20'), false)).toEqual({ net: '12345678897654.32', vatAmount: '2469135779530.86', total: '14814814677185.18' });
  });
  test('invalid discount', () => {
    expect(() => computeLine(line('1', '1', '20', '101'), false)).toThrow();
    expect(() => computeLine(line('1', '1', '20', '-1'), false)).toThrow();
  });
});

describe('document totals', () => {
  test('totals are sums of rounded lines (not a recomputation)', () => {
    const doc = computeDocument([line('1', '0.10', '20'), line('1', '0.10', '20'), line('1', '0.10', '20')], true);
    expect(doc.lines.map(l => l.vatAmount)).toEqual(['0.02', '0.02', '0.02']);
    expect(doc.totals).toMatchObject({ net: '0.24', vat: '0.06', total: '0.30' }); // по документу целиком было бы 0.05
  });
  test('breakdown by VAT rate, ascending', () => {
    const doc = computeDocument([line('1', '120', '20'), line('2', '100', '10'), line('1', '50', 'none'), line('1', '60', '20')], false);
    expect(doc.totals.byRate).toEqual([
      { rate: 'none', net: '50.00', vat: '0.00', total: '50.00' },
      { rate: '10', net: '200.00', vat: '20.00', total: '220.00' },
      { rate: '20', net: '180.00', vat: '36.00', total: '216.00' },
    ]);
    expect(doc.totals).toMatchObject({ net: '430.00', vat: '56.00', total: '486.00' });
  });
  test('empty document', () => {
    expect(computeTotals([])).toEqual({ net: '0.00', vat: '0.00', total: '0.00', byRate: [] });
  });
});

describe('document types', () => {
  test('numbering format and groups', () => {
    expect(formatDocumentNumber('invoice', 2026, 42)).toBe('СЧ-2026-00042');
    expect(formatDocumentNumber('receipt', 2027, 123456)).toBe('ПТ-2027-123456');
    expect(documentTypesOf('sales')).toEqual(['quote', 'customer_order', 'invoice', 'realization', 'act', 'customer_return', 'work_order']);
    expect(documentTypesOf('purchases')).toEqual(['supplier_order', 'receipt', 'supplier_return']);
    expect(new Set(DOCUMENT_TYPES.map(t => DOCUMENT_META[t].prefix)).size).toBe(DOCUMENT_TYPES.length);
  });
  test('chains', () => {
    expect(basedOnTargets('customer_order')).toEqual(['invoice', 'realization', 'act', 'production_order', 'production', 'work_order']);
    expect(basedOnTargets('invoice')).toEqual(['realization', 'act']);
    expect(basedOnTargets('supplier_order')).toEqual(['receipt']);
    expect(basedOnTargets('act')).toEqual([]);
    expect(basedOnTargets('production_order')).toEqual(['production']);
    // заказ-наряд: счёт можно выставить на основании заказ-наряда (предоплата), акта и реализации — нет
    expect(basedOnTargets('work_order')).toEqual(['invoice']);
  });
  test('production documents: no counterparty, states apart from posting', () => {
    expect(documentTypesOf('production')).toEqual(['production_order', 'production', 'piecework_order']);
    expect(DOCUMENT_META.production_order.party).toBeNull();
    expect(DOCUMENT_META.production.party).toBeNull();
    // сдельный наряд: тоже внутренний документ, без контрагента и без состояний
    expect(DOCUMENT_META.piecework_order.party).toBeNull();
    expect(DOCUMENT_META.piecework_order.states).toBeUndefined();
    expect(DOCUMENT_META.production_order.states?.map(s => s.key)).toEqual(['planned', 'in_progress', 'done', 'closed']);
    expect(DOCUMENT_META.production_order.operation).toBe('assembly');
    expect(DOCUMENT_META.production.production).toBe(true);
    // состояние заказа: переходы по списку, из конечного выхода нет
    const meta = DOCUMENT_META.production_order;
    expect(stateTransitions(meta, null)).toEqual(['planned', 'in_progress', 'done']);
    expect(stateTransitions(meta, 'planned')).toEqual(['in_progress']);
    expect(stateTransitions(meta, 'closed')).toEqual([]);
  });
  test('stock direction', () => {
    expect(DOCUMENT_META.realization.stock).toBe('out');
    expect(DOCUMENT_META.receipt.stock).toBe('in');
    expect(DOCUMENT_META.customer_return.stock).toBe('in');
    expect(DOCUMENT_META.supplier_return.stock).toBe('out');
    expect(DOCUMENT_META.act.stock).toBeNull();
  });
  test('internal documents: no counterparty, their own line role', () => {
    expect(documentTypesOf('stock')).toEqual(['stock_transfer', 'write_off', 'stock_posting', 'inventory_count']);
    expect(DOCUMENT_META.stock_transfer.party).toBeNull();
    expect(DOCUMENT_META.write_off.costItemKind).toBe('expense');
    expect(DOCUMENT_META.stock_posting.costItemKind).toBe('income');
    expect(lineRole('write_off')).toBe('out');
    expect(lineRole('stock_posting')).toBe('in');
    expect(lineRole('stock_transfer')).toBeNull(); // обе стороны задаёт шапка
    expect(lineRole('invoice')).toBeNull();
  });
  test('states are separate from posting: a type without states has no transitions', () => {
    expect(stateTransitions(DOCUMENT_META.invoice, null)).toEqual([]);
    const meta = { ...DOCUMENT_META.stock_transfer, states: [{ key: 'draft', label: 'Draft' }, { key: 'shipped', label: 'Shipped', next: ['received'] }, { key: 'received', label: 'Received', final: true }] };
    expect(stateTransitions(meta, null)).toEqual(['draft', 'shipped']);
    expect(stateTransitions(meta, 'shipped')).toEqual(['received']);
    expect(stateTransitions(meta, 'received')).toEqual([]);
    expect(canChangeState(meta, 'shipped', 'received')).toBe(true);
    expect(canChangeState(meta, 'shipped', 'draft')).toBe(false);
  });
});

describe('stock plan', () => {
  const line = { id: 'l1', productId: 'p1', qty: '5', stockRole: null };
  test('sales and purchases: the type sets the direction', () => {
    expect(stockPlan({ type: 'realization', warehouseId: 'w1', targetWarehouseId: null }, [line])).toEqual([{ lineId: 'l1', productId: 'p1', warehouseId: 'w1', qty: '5', direction: 'out', role: 'out' }]);
    expect(stockPlan({ type: 'receipt', warehouseId: 'w1', targetWarehouseId: null }, [line])).toEqual([{ lineId: 'l1', productId: 'p1', warehouseId: 'w1', qty: '5', direction: 'in', role: 'in' }]);
    expect(stockPlan({ type: 'invoice', warehouseId: 'w1', targetWarehouseId: null }, [line])).toEqual([]); // счёт склад не двигает
    expect(stockPlan({ type: 'realization', warehouseId: null, targetWarehouseId: null }, [line])).toEqual([]); // без склада движений нет
  });
  test('transfer: two sides per line — out of the header warehouse and into the target', () => {
    expect(stockPlan({ type: 'stock_transfer', warehouseId: 'w1', targetWarehouseId: 'w2' }, [line])).toEqual([
      { lineId: 'l1', productId: 'p1', warehouseId: 'w1', qty: '5', direction: 'out', role: 'out' },
      { lineId: 'l1', productId: 'p1', warehouseId: 'w2', qty: '5', direction: 'in', role: 'in' },
    ]);
  });
  test('write-off and posting: the role of the type', () => {
    expect(stockPlan({ type: 'write_off', warehouseId: 'w1', targetWarehouseId: null }, [line])).toEqual([{ lineId: 'l1', productId: 'p1', warehouseId: 'w1', qty: '5', direction: 'out', role: 'out' }]);
    expect(stockPlan({ type: 'stock_posting', warehouseId: 'w1', targetWarehouseId: null }, [line])).toEqual([{ lineId: 'l1', productId: 'p1', warehouseId: 'w1', qty: '5', direction: 'in', role: 'in' }]);
  });
  test('the role of the line wins over the type (release of a production order)', () => {
    const out = { ...line, stockRole: 'out' as const };
    const inn = { ...line, id: 'l2', stockRole: 'in' as const };
    expect(stockPlan({ type: 'stock_posting', warehouseId: 'w1', targetWarehouseId: 'w2' }, [out, inn])).toEqual([
      { lineId: 'l1', productId: 'p1', warehouseId: 'w1', qty: '5', direction: 'out', role: 'out' },
      { lineId: 'l2', productId: 'p1', warehouseId: 'w2', qty: '5', direction: 'in', role: 'in' },
    ]);
  });
});

describe('moving average cost', () => {
  const D = dec;
  test('weighted average on receipts, outgoing keeps average', () => {
    let s = { qty: 0n, avg: 0n };
    s = stockIn(s, D(10), D(100));
    expect(fmt(s.avg, 4)).toBe('100.0000');
    s = stockIn(s, D(10), D(120));
    expect(fmt(s.avg, 4)).toBe('110.0000');
    const out = stockOut(s, D(5));
    expect(fmt(out.cost, 4)).toBe('110.0000');
    expect(fmt(out.state.qty, 3)).toBe('15.000');
    expect(out.state.avg).toBe(s.avg);
    const s3 = stockIn(out.state, D(5), D(130)); // 15 @110 + 5 @130
    expect(fmt(s3.avg, 4)).toBe('115.0000');
  });
  test('averages are rounded to 4 places', () => {
    const s = stockIn(stockIn({ qty: 0n, avg: 0n }, D(3), D(10)), D(4), D('10.01'));
    expect(fmt(s.avg, 4)).toBe('10.0057'); // (30 + 40.04) / 7 = 10.00571…
  });
  test('receipt into empty or negative stock sets the price', () => {
    const neg = stockOut(stockIn({ qty: 0n, avg: 0n }, D(2), D(50)), D(5)).state; // -3 @50
    expect(fmt(neg.qty, 3)).toBe('-3.000');
    const s = stockIn(neg, D(10), D(80));
    expect(fmt(s.avg, 4)).toBe('80.0000');
    expect(fmt(s.qty, 3)).toBe('7.000');
  });
  test('replay reproduces incremental results, reports minimum and re-costs outgoing', () => {
    const r = replayMoves([
      { qty: D(10), cost: D(100) },
      { qty: -D(4), cost: 0n },
      { qty: D(10), cost: D(130) },
      { qty: -D(16), cost: 0n },
    ]);
    // 10@100, -4 → 6@100, +10@130 → 16@118.75, -16 → 0
    expect(r.moves.map(m => fmt(m.cost, 4))).toEqual(['100.0000', '100.0000', '130.0000', '118.7500']);
    expect(fmt(r.state.qty, 3)).toBe('0.000');
    expect(r.minQty).toBe(0n);
    const r2 = replayMoves([{ qty: D(1), cost: D(5) }, { qty: -D(3), cost: 0n }]);
    expect(fmt(r2.minQty, 3)).toBe('-2.000');
  });
  test('weighted average over warehouses ignores empty ones', () => {
    expect(weightedAvgCost([{ qty: '10', avgCost: '100' }, { qty: '30', avgCost: '120' }, { qty: '0', avgCost: '999' }, { qty: '-2', avgCost: '5' }])).toBe('115.0000');
    expect(weightedAvgCost([{ qty: '0', avgCost: '10' }])).toBeNull();
    expect(weightedAvgCost([])).toBeNull();
  });
});
