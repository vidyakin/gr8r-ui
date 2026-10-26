/* Закрытие периода: распределение косвенных затрат по базе (чистые функции этапа 6).
   Проверяем главное — сумма распределённого равна сумме затрат (остаток округления уходит на последнюю строку),
   порядок «свой участок → общий выпуск → нераспределено» и пример УНФ: 100 косвенных на два выпуска по 1 шт. */
import { describe, expect, test } from 'bun:test';
import { dec } from '../src/decimal';
import { distributeOverhead, monthLabel, monthPeriod, monthRange, planOverhead, targetUnitCost, type OverheadCost, type OverheadTarget } from '../src/cost-closing';

const sum = (rows: { amount: bigint }[]) => rows.reduce((s, r) => s + r.amount, 0n);

/** Позиция выпуска с базами по умолчанию: 1 шт, прямые затраты 100, 2 часа */
const target = (over: Partial<OverheadTarget> = {}): OverheadTarget => ({ itemId: 'i1', releaseId: 'r1', name: 'Стол', workCenterId: 'wc1', documentLineId: 'l1', qty: dec(1), directCost: dec(100), workHours: dec(2), ...over });
const cost = (over: Partial<OverheadCost> = {}): OverheadCost => ({ costItemId: 'c1', costItemName: 'Электричество', workCenterId: null, workCenterName: null, method: 'output_qty', amount: dec(100), ...over });

describe('distribute by base', () => {
  test('proportionally to the base, and the sum equals the amount', () => {
    const r = distributeOverhead(dec(100), [{ key: 'a', base: dec(1) }, { key: 'b', base: dec(3) }]);
    expect(r.allocations.map(a => [a.key, a.amount.toString()])).toEqual([
      ['a', '25000000'],
      ['b', '75000000'],
    ]);
    expect(sum(r.allocations)).toBe(dec(100));
    expect(r.undistributed).toBe(0n);
  });

  test('the rounding remainder goes to the last line — the sum still equals the amount', () => {
    // 100 / 3 = 33,333333… — без остатка на последней строке сумма сошлась бы на копейку
    const r = distributeOverhead(dec(100), [{ key: 'a', base: dec(1) }, { key: 'b', base: dec(1) }, { key: 'c', base: dec(1) }]);
    expect(r.allocations.map(a => a.amount.toString())).toEqual(['33333333', '33333333', '33333334']);
    expect(sum(r.allocations)).toBe(dec(100));
  });

  test('a zero base gets nothing and the rest keeps the whole amount', () => {
    const r = distributeOverhead(dec(50), [{ key: 'a', base: dec(0) }, { key: 'b', base: dec(2) }]);
    expect(r.allocations).toEqual([{ key: 'b', amount: dec(50) }]);
    expect(r.undistributed).toBe(0n);
  });

  test('no base at all — the amount stays undistributed', () => {
    const r = distributeOverhead(dec(50), [{ key: 'a', base: dec(0) }]);
    expect(r.allocations).toEqual([]);
    expect(r.undistributed).toBe(dec(50));
  });
});

describe('plan of overhead allocation', () => {
  test('100 indirect costs on two releases of one piece each: 50/50 by output', () => {
    const plan = planOverhead([cost()], [target({ itemId: 'i1' }), target({ itemId: 'i2', releaseId: 'r2', documentLineId: 'l2' })]);
    expect(plan.byTarget.get('i1')).toBe(dec(50));
    expect(plan.byTarget.get('i2')).toBe(dec(50));
    expect(plan.undistributed).toBe(0n);
    expect(plan.byCostItem[0]).toMatchObject({ costItemName: 'Электричество', amount: dec(100), distributed: dec(100), scope: 'common' });
  });

  test('the same amount by direct costs: 33,33 / 66,67 (example of 1C:UNF)', () => {
    const plan = planOverhead([cost({ method: 'direct_costs' })], [target({ itemId: 'i1', directCost: dec(100) }), target({ itemId: 'i2', releaseId: 'r2', documentLineId: 'l2', directCost: dec(200) })]);
    expect(plan.byTarget.get('i1')).toBe(dec('33.333333'));
    expect(plan.byTarget.get('i2')).toBe(dec('66.666667'));
    expect((plan.byTarget.get('i1') ?? 0n) + (plan.byTarget.get('i2') ?? 0n)).toBe(dec(100));
  });

  test('by work hours of the release', () => {
    const plan = planOverhead([cost({ method: 'work_hours' })], [target({ itemId: 'i1', workHours: dec(1) }), target({ itemId: 'i2', releaseId: 'r2', documentLineId: 'l2', workHours: dec(3) })]);
    expect(plan.byTarget.get('i1')).toBe(dec(25));
    expect(plan.byTarget.get('i2')).toBe(dec(75));
  });

  test('costs of a work center go first to the releases of that work center', () => {
    const plan = planOverhead([cost({ workCenterId: 'wc1', workCenterName: 'Столярный цех' })], [
      target({ itemId: 'i1', workCenterId: 'wc1', documentLineId: 'l1' }),
      target({ itemId: 'i2', releaseId: 'r2', documentLineId: 'l2', workCenterId: 'wc2' }),
    ]);
    expect(plan.byTarget.get('i1')).toBe(dec(100));
    expect(plan.byTarget.get('i2')).toBeUndefined();
    expect(plan.byCostItem[0]!.scope).toBe('work_center');
    expect(plan.warnings).toEqual([]);
  });

  test('no release of that work center — the costs go to all releases with a warning', () => {
    const plan = planOverhead([cost({ workCenterId: 'wc3', workCenterName: 'Малярный участок' })], [
      target({ itemId: 'i1', workCenterId: 'wc1', documentLineId: 'l1' }),
      target({ itemId: 'i2', releaseId: 'r2', documentLineId: 'l2', workCenterId: 'wc2' }),
    ]);
    expect(plan.byTarget.get('i1')).toBe(dec(50));
    expect(plan.byTarget.get('i2')).toBe(dec(50));
    expect(plan.byCostItem[0]!.scope).toBe('common');
    expect(plan.warnings[0]).toContain('Малярный участок');
  });

  test('an intermediate stage receives costs of its own work center into its work in progress', () => {
    const plan = planOverhead([cost({ workCenterId: 'wc1', workCenterName: 'Цех' })], [target({ itemId: 'i0', documentLineId: null, interim: true }), target({ itemId: 'i1', releaseId: 'r2', documentLineId: 'l2', workCenterId: 'wc2' })]);
    expect(plan.byTarget.get('i0')).toBe(dec(100));
    expect(plan.byTarget.has('i1')).toBe(false);
    expect(plan.byCostItem[0]!.scope).toBe('work_center');
  });

  test('an item marked "do not allocate" stays undistributed', () => {
    const plan = planOverhead([cost({ method: 'none' })], [target()]);
    expect(plan.byTarget.size).toBe(0);
    expect(plan.undistributed).toBe(dec(100));
    expect(plan.warnings[0]).toContain('not allocated');
  });

  test('no releases at all — the costs stay undistributed and the closing warns', () => {
    const plan = planOverhead([cost()], []);
    expect(plan.byTarget.size).toBe(0);
    expect(plan.undistributed).toBe(dec(100));
    expect(plan.warnings[0]).toContain('there are no releases this month');
  });

  test('a zero base (release without direct costs by that method) keeps the costs undistributed', () => {
    const plan = planOverhead([cost({ method: 'direct_costs' })], [target({ directCost: dec(0) })]);
    expect(plan.byTarget.size).toBe(0);
    expect(plan.undistributed).toBe(dec(100));
  });

  test('several cost items are allocated independently and the total is preserved', () => {
    const plan = planOverhead(
      [cost({ costItemId: 'c1', amount: dec(100), method: 'output_qty' }), cost({ costItemId: 'c2', costItemName: 'Аренда', amount: dec(30), method: 'output_qty' })],
      [target({ itemId: 'i1' }), target({ itemId: 'i2', releaseId: 'r2', documentLineId: 'l2' })],
    );
    expect(plan.byTarget.get('i1')).toBe(dec(65));
    expect(plan.byTarget.get('i2')).toBe(dec(65));
    expect([...plan.byTarget.values()].reduce((s, v) => s + v, 0n)).toBe(dec(130));
  });

  test('the unit cost of the release includes its share of indirect costs', () => {
    expect(targetUnitCost(dec(100), dec(50), dec(2))).toBe(dec('75.000000'));
  });
});

describe('periods', () => {
  test('a month key gives the first and the last day', () => {
    expect(monthPeriod('2026-10')).toMatchObject({ start: '2026-10-01', end: '2026-10-31' });
    expect(monthPeriod('2026-02')).toMatchObject({ start: '2026-02-01', end: '2026-02-28' });
  });

  test('months of a period go in order, including leap February', () => {
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  test('a label is in English for the interface', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
  });
});