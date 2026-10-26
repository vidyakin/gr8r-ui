/* Себестоимость заказ-наряда: ручной расчёт труда, материалов, товаров, прочих и косвенных, выручка и маржа. */
import { describe, expect, test } from 'bun:test';
import { computeWorkOrderCost, marginPct, type WorkOrderCostInput } from '../src/work-orders';
import { dec } from '../src/decimal';

const base: WorkOrderCostInput = {
  revenueNet: '10000.00',
  assignments: [
    { id: 'a1', assigneeId: 'm1', assigneeName: 'Иван', workCenterId: 'w1', workCenterName: 'Цех', plannedHours: '4.000', actualHours: '5.000', rate: '500.00' },
    { id: 'a2', assigneeId: 'm2', assigneeName: 'Анна', workCenterId: null, workCenterName: null, plannedHours: '2.000', actualHours: '1.000', rate: null },
    { id: 'a3', assigneeId: 'm1', assigneeName: 'Иван', workCenterId: 'w2', workCenterName: 'Монтаж', plannedHours: '0.000', actualHours: '2.000', rate: '300.00' },
  ],
  materials: [{ key: 'p1', productId: 'p1', name: 'Краска', unitCode: '166', qty: '2.000', unitCost: '150.0000', factCost: '330.00' }],
  goods: [{ key: 'p2', productId: 'p2', name: 'Болты', unitCode: '796', qty: '10.000', unitCost: '12.5000', factCost: null }],
  other: '200.00',
  indirect: '150.00',
};

describe('computeWorkOrderCost', () => {
  const r = computeWorkOrderCost(base);

  test('labor: hours x work center rate, a row per assignee and center', () => {
    expect(r.labor.rows).toHaveLength(3);
    expect(r.labor.plan).toBe('2000.00'); // 4 ч × 500
    expect(r.labor.fact).toBe('3100.00'); // 5 × 500 + 2 × 300
    expect(r.labor.plannedHours).toBe('6.000');
    expect(r.labor.actualHours).toBe('8.000');
    expect(r.labor.byCenter.find(c => c.workCenterId === 'w1')?.factAmount).toBe('2500.00');
  });

  test('assignment without a work center is not priced and gives a warning', () => {
    expect(r.warnings).toEqual([{ kind: 'no_work_center', assignmentIds: ['a2'], plannedHours: '2.000', actualHours: '1.000' }]);
    expect(r.labor.rows.find(x => x.assigneeId === 'm2')?.factAmount).toBe('0.00');
  });

  test('materials by write-off cost, goods before posting are estimated by average', () => {
    expect(r.materials.plan).toBe('300.00');
    expect(r.materials.fact).toBe('330.00');
    expect(r.materials.estimated).toBe(false);
    expect(r.goods.plan).toBe('125.00');
    expect(r.goods.fact).toBe('125.00');
    expect(r.goods.estimated).toBe(true);
    expect(r.estimated).toBe(true);
  });

  test('totals, margin and percent', () => {
    expect(r.other).toEqual({ plan: '200.00', fact: '200.00' });
    expect(r.indirect).toEqual({ plan: '0.00', fact: '150.00' });
    expect(r.cost).toEqual({ plan: '2625.00', fact: '3905.00' });
    expect(r.revenue).toBe('10000.00');
    expect(r.margin).toEqual({ plan: '7375.00', fact: '6095.00' });
    expect(r.marginPct).toEqual({ plan: '73.75', fact: '60.95' });
  });

  test('a service-only order has no costs: the whole revenue is margin', () => {
    const s = computeWorkOrderCost({ revenueNet: '1000.00', assignments: [], materials: [], goods: [], other: '0', indirect: '0' });
    expect(s.cost).toEqual({ plan: '0.00', fact: '0.00' });
    expect(s.margin.fact).toBe('1000.00');
    expect(s.marginPct.fact).toBe('100.00');
    expect(s.estimated).toBe(false);
  });

  test('zero revenue gives no percent', () => {
    expect(marginPct(dec(-5), 0n)).toBeNull();
    const z = computeWorkOrderCost({ ...base, revenueNet: '0' });
    expect(z.marginPct).toEqual({ plan: null, fact: null });
    expect(z.margin.fact).toBe('-3905.00');
  });

  test('posted order: fact materials come from the moves even when they differ from the average', () => {
    const p = computeWorkOrderCost({ ...base, goods: [{ ...base.goods[0]!, factCost: '140.00' }] });
    expect(p.goods.fact).toBe('140.00');
    expect(p.estimated).toBe(false);
    expect(p.cost.fact).toBe('3920.00');
  });
});
