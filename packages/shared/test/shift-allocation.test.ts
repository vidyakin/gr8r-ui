import { describe, expect, test } from 'bun:test';
import { allocateShiftMaterials, costShares, dec, fmt } from '../src';

const t = (id: string, qty: string, norms: Record<string, string>, plannedCost = '0') => ({ id, qty: dec(qty), norms: new Map(Object.entries(norms).map(([k, v]) => [k, dec(v)])), plannedCost: dec(plannedCost) });
const sum = (r: { qty: bigint }[]) => r.reduce((a, x) => a + x.qty, 0n);

describe('распределение материалов смены', () => {
  test('по нормам, остаток округления на последнюю строку, сумма = факт', () => {
    const r = allocateShiftMaterials([{ key: 'm', qty: dec('10') }], [t('a', '1', { m: '1' }), t('b', '1', { m: '1' }), t('c', '1', { m: '1' })]);
    expect(r.map(x => fmt(x.qty, 6))).toEqual(['3.333333', '3.333333', '3.333334']);
    expect(sum(r)).toBe(dec('10'));
  });
  test('пропорции норм', () => {
    const r = allocateShiftMaterials([{ key: 'm', qty: dec('9') }], [t('a', '1', { m: '1' }), t('b', '2', { m: '2' })]);
    expect(r.map(x => fmt(x.qty, 3))).toEqual(['3.000', '6.000']);
  });
  test('материал вне норм — по плановой стоимости', () => {
    const r = allocateShiftMaterials([{ key: 'x', qty: dec('8') }], [t('a', '1', {}, '10'), t('b', '1', {}, '30')]);
    expect(r.map(x => fmt(x.qty, 3))).toEqual(['2.000', '6.000']);
  });
  test('без стоимости — по количеству выпуска', () => {
    const r = allocateShiftMaterials([{ key: 'x', qty: dec('9') }], [t('a', '1', {}), t('b', '2', {})]);
    expect(r.map(x => fmt(x.qty, 3))).toEqual(['3.000', '6.000']);
  });
  test('стоимость долей равна стоимости факта', () => {
    const shares = allocateShiftMaterials([{ key: 'm', qty: dec('10') }], [t('a', '1', { m: '1' }), t('b', '1', { m: '1' }), t('c', '1', { m: '1' })]);
    const c = costShares(shares, () => dec('13.333'));
    expect(c.reduce((a, x) => a + x.cost, 0n)).toBe(dec('13.333'));
  });
});
