/* Прогноз прибыли объекта (задача 1275): чистая функция. Контрольный пример из плана модуля электромонтажа —
   1 000 м кабеля и 200 чел.-ч в смете, выполнено 400 м за 110 ч: остаток 165 ч, итог 275 ч (перерасход 75 ч).
   Плюс: остаток субподряда, категория материалов «план − факт», ручная правка, накладные, нулевая стоимость,
   отсутствие согласованной сметы и пробелы данных. */
import { describe, expect, test } from 'bun:test';
import { computeObjectForecast, type ObjectForecastInput } from '../src';

const item = (over: Partial<ObjectForecastInput['items'][number]> = {}): ObjectForecastInput['items'][number] => ({
  id: 'i1',
  kind: 'work',
  name: 'Прокладка кабеля',
  unitCode: '006',
  qty: '1000',
  price: '300',
  costPrice: '50',
  laborHours: '0.2',
  doneQty: '0',
  ...over,
});

const input = (over: Partial<ObjectForecastInput> = {}): ObjectForecastInput => ({
  hasEstimate: true,
  contractValue: '300000',
  overheadPct: '0',
  items: [item()],
  facts: { material: '0', labor: '0', subcontract: '0', other: '0' },
  laborByItem: [],
  acceptedByItem: [],
  overrides: [],
  ...over,
});

describe('computeObjectForecast', () => {
  test('пример из плана: 400 м за 110 ч из 1 000 м и 200 ч — остаток 165 ч, итог 275 ч', () => {
    const r = computeObjectForecast(
      input({
        items: [item({ doneQty: '400', costPrice: '13.75' })],
        facts: { material: '0', labor: '5500', subcontract: '0', other: '0' },
        laborByItem: [{ itemId: 'i1', hours: '110', cost: '5500', hoursWithoutCost: '0' }],
      }),
    );
    const row = r.categories.find(c => c.category === 'labor')!.items[0]!;
    expect(row.donePct).toBe('40.0');
    expect(row.planHours).toBe('200.000');
    expect(row.factHours).toBe('110.000');
    expect(row.remainingHours).toBe('165.000');
    expect(row.forecastHours).toBe('275.000');
    // стоимость остатка по темпу: 5 500 / 400 × 600 = 8 250
    expect(row.remaining).toBe('8250.00');
    expect(row.forecast).toBe('13750.00');
    expect(row.deviation).toBe('0.00');
  });

  test('не начатая позиция — остаток по плановой себестоимости оставшегося объёма', () => {
    const r = computeObjectForecast(input());
    const row = r.categories.find(c => c.category === 'labor')!.items[0]!;
    expect(row.basis).toBe('plan');
    expect(row.remaining).toBe('50000.00');
    expect(row.remainingHours).toBe('200.000');
    expect(r.totals.remaining).toBe('50000.00');
  });

  test('выполненная позиция — остаток нулевой', () => {
    const r = computeObjectForecast(
      input({ items: [item({ doneQty: '1000' })], facts: { material: '0', labor: '60000', subcontract: '0', other: '0' } }),
    );
    const row = r.categories.find(c => c.category === 'labor')!.items[0]!;
    expect(row.basis).toBe('zero');
    expect(row.remaining).toBe('0.00');
    expect(row.remainingHours).toBe('0.000');
  });

  test('субподряд: остаток = (объём − принятое) × плановая себестоимость', () => {
    const r = computeObjectForecast(
      input({
        items: [item({ id: 's1', kind: 'subcontract', name: 'Монтаж видеонаблюдения', qty: '10', price: '1200', costPrice: '1000', laborHours: '0', doneQty: '0' })],
        acceptedByItem: [{ itemId: 's1', qty: '4' }],
      }),
    );
    const row = r.categories.find(c => c.category === 'subcontract')!.items[0]!;
    expect(row.basis).toBe('accepted');
    expect(row.factCost).toBe('4000.00');
    expect(row.remaining).toBe('6000.00');
    expect(row.forecast).toBe('10000.00');
    expect(row.deviation).toBe('0.00');
  });

  test('материалы и щиты — одна категория: остаток = max(план − факт, 0)', () => {
    const r = computeObjectForecast(
      input({
        items: [item({ id: 'm1', kind: 'material', name: 'Кабель', qty: '100', costPrice: '85', doneQty: '0' }), item({ id: 'p1', kind: 'panel', name: 'Щит ЩР-1', qty: '1', costPrice: '5000', doneQty: '0' })],
        facts: { material: '3000', labor: '0', subcontract: '0', other: '0' },
      }),
    );
    const cat = r.categories.find(c => c.category === 'material')!;
    expect(cat.planCost).toBe('13500.00');
    expect(cat.factCost).toBe('3000.00');
    expect(cat.remaining).toBe('10500.00');
    expect(cat.items[0]!.remaining).toBeNull();
    // факт по материалам больше плана — остаток не отрицательный
    const over = computeObjectForecast(input({ items: [item({ kind: 'material', qty: '10', costPrice: '100' })], facts: { material: '2000', labor: '0', subcontract: '0', other: '0' } }));
    expect(over.categories.find(c => c.category === 'material')!.remaining).toBe('0.00');
  });

  test('ручная правка по позиции заменяет остаток и видна с причиной; правка категории — итог категории', () => {
    const r = computeObjectForecast(
      input({
        items: [item({ doneQty: '400' })],
        facts: { material: '1000', labor: '5500', subcontract: '0', other: '0' },
        laborByItem: [{ itemId: 'i1', hours: '110', cost: '5500', hoursWithoutCost: '0' }],
        overrides: [
          { estimateItemId: 'i1', category: null, remaining: '9000', reason: 'Сложный участок' },
          { estimateItemId: null, category: 'material', remaining: '1500', reason: 'Дозаказ кабеля' },
        ],
      }),
    );
    const labor = r.categories.find(c => c.category === 'labor')!;
    expect(labor.items[0]!.overridden).toBe(true);
    expect(labor.items[0]!.overrideReason).toBe('Сложный участок');
    expect(labor.items[0]!.basis).toBe('override');
    expect(labor.items[0]!.remaining).toBe('9000.00');
    const material = r.categories.find(c => c.category === 'material')!;
    expect(material.overridden).toBe(true);
    expect(material.remaining).toBe('1500.00');
  });

  test('накладные — процент объекта от прямых затрат (факт + остаток)', () => {
    const r = computeObjectForecast(
      input({
        overheadPct: '15',
        items: [item({ doneQty: '400' })],
        facts: { material: '1000', labor: '5500', subcontract: '0', other: '0' },
        laborByItem: [{ itemId: 'i1', hours: '110', cost: '5500', hoursWithoutCost: '0' }],
      }),
    );
    // прямые: 6 500 факт + 8 250 остаток = 14 750, накладные 15% = 2 212,50
    expect(r.totals.overhead).toBe('2212.50');
    expect(r.totals.forecastCost).toBe('16962.50');
    expect(r.totals.profit).toBe('283037.50');
  });

  test('прибыль и маржа: стоимость минус прогноз; при нулевой стоимости маржа null', () => {
    const r = computeObjectForecast(input({ contractValue: '60000', facts: { material: '0', labor: '0', subcontract: '0', other: '0' } }));
    expect(r.totals.profit).toBe('10000.00');
    expect(r.totals.marginPct).toBe('16.7');
    const zero = computeObjectForecast(input({ contractValue: '0' }));
    expect(zero.totals.marginPct).toBeNull();
  });

  test('без согласованной сметы прогноз не строится: null и причина; факт по категориям виден', () => {
    const r = computeObjectForecast(input({ hasEstimate: false, items: [], facts: { material: '500', labor: '1000', subcontract: '0', other: '0' } }));
    expect(r.totals.forecastCost).toBeNull();
    expect(r.totals.profit).toBeNull();
    expect(r.totals.marginPct).toBeNull();
    expect(r.totals.remaining).toBeNull();
    expect(r.categories.find(c => c.category === 'labor')!.factCost).toBe('1000.00');
    expect(r.gaps.map(g => g.code)).toContain('no_estimate');
  });

  test('пробелы: часы без ставки и позиции без плановой себестоимости — не ноль', () => {
    const r = computeObjectForecast(
      input({
        items: [item({ doneQty: '400', costPrice: '0' })],
        laborByItem: [{ itemId: 'i1', hours: '110', cost: null, hoursWithoutCost: '110' }],
      }),
    );
    const row = r.categories.find(c => c.category === 'labor')!.items[0]!;
    expect(row.factCost).toBeNull();
    expect(row.noCostPrice).toBe(true);
    expect(row.remainingHours).toBe('165.000');
    const codes = r.gaps.map(g => g.code);
    expect(codes).toContain('no_rate_hours');
    expect(codes).toContain('no_cost_price');
    expect(r.gaps.find(g => g.code === 'no_rate_hours')!.hours).toBe('110.00');
  });
});
