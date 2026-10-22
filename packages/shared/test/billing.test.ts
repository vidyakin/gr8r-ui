/* Договоры и биллинг: календарь периодов, пропорция по дням и правила абонентской позиции (1С:УНФ). */
import { describe, expect, test } from 'bun:test';
import { actLines, computeBilling, contractCoverage, periodByKey, periodDays, periodLabelRu, periodOf, prorate, shiftPeriod, type BillingBreakdownRow, type BillingFact, type BillingLine, type BillingProduct, type TariffPlanLine } from '../src/billing';

const product = (id: string, name: string, price = '1000'): BillingProduct => ({ id, name, unitCode: '356', vatRate: '20', price });

const CATALOG: Record<string, BillingProduct> = {
  consult: product('consult', 'Consultation', '1000'),
  repair: product('repair', 'Repair', '1500'),
  spare: product('spare', 'Spare part', '500'),
};

const PLAN: TariffPlanLine[] = [{ productId: 'consult', qty: '5', price: '1000', isSubscription: true }];

describe('billing: periods', () => {
  test('month, quarter and year periods', () => {
    expect(periodOf('month', '2026-10-15')).toEqual({ key: '2026-10', start: '2026-10-01', end: '2026-10-31' });
    expect(periodOf('quarter', '2026-10-15')).toEqual({ key: '2026-Q4', start: '2026-10-01', end: '2026-12-31' });
    expect(periodOf('quarter', '2026-01-31')).toEqual({ key: '2026-Q1', start: '2026-01-01', end: '2026-03-31' });
    expect(periodOf('year', '2026-10-15')).toEqual({ key: '2026', start: '2026-01-01', end: '2026-12-31' });
    expect(periodDays(periodOf('month', '2026-02-10'))).toBe(28); // февраль 2026 — без 29-го дня
    expect(periodDays(periodOf('month', '2024-02-10'))).toBe(29); // високосный год
  });

  test('period by key and shift', () => {
    expect(periodByKey('month', '2026-10').key).toBe('2026-10');
    expect(periodByKey('quarter', '2026-Q3')).toEqual({ key: '2026-Q3', start: '2026-07-01', end: '2026-09-30' });
    expect(periodByKey('year', '2026').end).toBe('2026-12-31');
    expect(shiftPeriod('month', periodOf('month', '2026-01-15'), -1).key).toBe('2025-12');
    expect(shiftPeriod('quarter', periodOf('quarter', '2026-01-15'), -1).key).toBe('2025-Q4');
    expect(shiftPeriod('year', periodOf('year', '2026-01-15'), -1).key).toBe('2025');
  });

  test('period label is in Russian (the print forms are)', () => {
    expect(periodLabelRu(periodOf('month', '2026-10-15'))).toBe('за октябрь 2026');
    expect(periodLabelRu(periodOf('quarter', '2026-10-15'))).toBe('за 4 квартал 2026');
    expect(periodLabelRu(periodOf('year', '2026-10-15'))).toBe('за 2026 год');
  });
});

describe('billing: proportion by days', () => {
  test('a contract that started on the 15th covers half of the period', () => {
    const c = contractCoverage('2026-10-15', null, periodOf('month', '2026-10-15'));
    expect(c.days).toBe(17); // с 15 по 31 включительно
    expect(prorate('5', c)).toBe('2.742'); // 5 × 17/31
  });

  test('an indefinite contract covers the whole period', () => {
    const c = contractCoverage('2026-01-01', null, periodOf('month', '2026-10-15'));
    expect(c.days).toBe(31);
    expect(prorate('5', c)).toBe('5.000');
  });

  test('a contract that ended in the middle of the period', () => {
    const c = contractCoverage('2026-10-01', '2026-10-20', periodOf('month', '2026-10-15'));
    expect(c.days).toBe(20);
    expect(prorate('10', c)).toBe('6.452'); // 10 × 20/31
  });

  test('a contract outside the period covers nothing', () => {
    const c = contractCoverage('2026-09-01', '2026-09-30', periodOf('month', '2026-10-15'));
    expect(c.days).toBe(0);
    expect(prorate('5', c)).toBe('0.000');
  });
});

describe('billing: subscription position (1C rules)', () => {
  const base = {
    tariffLines: PLAN,
    products: CATALOG,
    subscriptionPeriod: periodOf('month', '2026-10-15'),
    factPeriod: periodOf('month', '2026-09-15'),
    validFrom: '2026-01-01',
    validTo: null as string | null,
  };

  test('no primary documents — the position is issued by the plan', () => {
    const r = computeBilling({ ...base, facts: [] });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ productId: 'consult', qty: '5.000', price: '1000', name: 'Consultation за октябрь 2026' });
    expect(r.lines[0]!.breakdown[0]).toMatchObject({ source: 'plan', qty: '5', price: '1000' });
    expect(r.sources).toHaveLength(0);
  });

  test('delivered less than the plan — still by the plan', () => {
    const facts: BillingFact[] = [{ sourceKind: 'work_order', sourceId: 'wo-1', productId: 'consult', qty: '3', price: '1200', date: '2026-09-20' }];
    const r = computeBilling({ ...base, facts });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ qty: '5.000', price: '1000' });
    // первичка засчитана: в следующий счёт она не попадёт
    expect(r.sources).toEqual([{ sourceKind: 'work_order', sourceId: 'wo-1' }]);
  });

  // решение пользователя 2026-10-22: абонплата идёт авансом, поэтому работы прошедшего периода в пределах его абонплаты
  // уже оплачены — в счёт идёт абонплата текущего периода и перерасход сверх плана по цене первички
  test('a work order delivered more than the plan — the subscription plus the excess at the price of the work order', () => {
    const facts: BillingFact[] = [{ sourceKind: 'work_order', sourceId: 'wo-2', productId: 'consult', qty: '7', price: '1200', date: '2026-09-20' }];
    const r = computeBilling({ ...base, facts });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ productId: 'consult', qty: '5.000', price: '1000', name: 'Consultation за октябрь 2026' });
    expect(r.lines[1]).toMatchObject({ productId: 'consult', qty: '2.000', price: '1200.00', name: 'Consultation за сентябрь 2026' });
    expect(r.lines[1]!.breakdown[0]).toMatchObject({ source: 'work_order', sourceId: 'wo-2', qty: '2.000', amount: '2400.00' });
    expect(r.sources).toEqual([{ sourceKind: 'work_order', sourceId: 'wo-2' }]);
  });

  test('time without a price above the plan — the subscription plus the excess at the list price', () => {
    const facts: BillingFact[] = [{ sourceKind: 'time_log', sourceId: 'tl-1', productId: 'consult', qty: '7', price: null, date: '2026-09-20' }];
    const r = computeBilling({ ...base, facts });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ qty: '5.000', price: '1000' }); // абонплата октября по плану
    expect(r.lines[1]).toMatchObject({ qty: '2.000', price: '1000.00' }); // перерасход сентября по цене прайса
    expect(r.sources).toEqual([{ sourceKind: 'time_log', sourceId: 'tl-1' }]);
  });

  test('the plan of the previous period covers the earliest works first', () => {
    const facts: BillingFact[] = [
      { sourceKind: 'time_log', sourceId: 'tl-late', productId: 'consult', qty: '3', price: null, date: '2026-09-25' },
      { sourceKind: 'work_order', sourceId: 'wo-early', productId: 'consult', qty: '4', price: '1200', date: '2026-09-05' },
    ];
    const r = computeBilling({ ...base, facts });
    // 5 ч плана: 4 ч заказ-наряда и 1 ч времени; сверх — 2 ч времени по прайсу
    expect(r.lines[1]!.breakdown).toEqual([expect.objectContaining({ source: 'time_log', sourceId: 'tl-late', qty: '2.000', price: '1000' })]);
  });

  test('works of a period without the contract are all excess', () => {
    // договор начался в октябре: сентябрьской абонплаты не было
    const facts: BillingFact[] = [{ sourceKind: 'work_order', sourceId: 'wo-3', productId: 'consult', qty: '3', price: '1200', date: '2026-09-20' }];
    const r = computeBilling({ ...base, facts, validFrom: '2026-10-01' });
    expect(r.lines[1]).toMatchObject({ qty: '3.000', price: '1200.00' });
  });

  test('after the end of the contract there is no subscription line, only the works of its last period', () => {
    const facts: BillingFact[] = [{ sourceKind: 'time_log', sourceId: 'tl-2', productId: 'consult', qty: '6', price: null, date: '2026-09-20' }];
    const r = computeBilling({ ...base, facts, validTo: '2026-09-30' });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ qty: '1.000', name: 'Consultation за сентябрь 2026' });
  });

  test('the plan part is proportional to the days of the contract', () => {
    const r = computeBilling({ ...base, facts: [], validFrom: '2026-10-15' });
    expect(r.lines[0]!.qty).toBe('2.742'); // 5 ч × 17/31
  });
});

describe('billing: positions outside the plan', () => {
  const base = {
    tariffLines: PLAN,
    products: CATALOG,
    subscriptionPeriod: periodOf('month', '2026-10-15'),
    factPeriod: periodOf('month', '2026-09-15'),
    validFrom: '2026-01-01',
    validTo: null as string | null,
  };
  const facts: BillingFact[] = [{ sourceKind: 'realization', sourceId: 'rl-1', productId: 'spare', qty: '2', price: '500', date: '2026-09-20' }];

  test('allow — the position is issued', () => {
    const r = computeBilling({ ...base, facts, extraProductPolicy: 'allow' });
    expect(r.lines.some(l => l.productId === 'spare')).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  test('warn — the position is issued with a warning', () => {
    const r = computeBilling({ ...base, facts, extraProductPolicy: 'warn' });
    expect(r.lines.some(l => l.productId === 'spare')).toBe(true);
    expect(r.warnings[0]).toContain('Spare part');
  });

  test('forbid — the position is not issued', () => {
    const r = computeBilling({ ...base, facts, extraProductPolicy: 'forbid' });
    expect(r.lines.some(l => l.productId === 'spare')).toBe(false);
    expect(r.warnings[0]).toContain('запрещена');
  });
});

describe('billing: lines outside the subscription', () => {
  test('a position of the plan is issued by fact, the sum of the primary documents is kept', () => {
    const lines: TariffPlanLine[] = [{ productId: 'repair', qty: '1', price: '1500', isSubscription: false }];
    const facts: BillingFact[] = [
      { sourceKind: 'work_order', sourceId: 'wo-3', productId: 'repair', qty: '2', price: '1500', date: '2026-09-10' },
      { sourceKind: 'work_order', sourceId: 'wo-4', productId: 'repair', qty: '1', price: '1800', date: '2026-09-12' },
    ];
    const r = computeBilling({
      tariffLines: lines,
      facts,
      products: CATALOG,
      subscriptionPeriod: periodOf('month', '2026-10-15'),
      factPeriod: periodOf('month', '2026-09-15'),
      validFrom: '2026-01-01',
      validTo: null,
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.qty).toBe('3.000');
    expect(Number(r.lines[0]!.price) * 3).toBeCloseTo(4800, 2); // 2 × 1500 + 1 × 1800
    expect(r.lines[0]!.breakdown).toHaveLength(2);
  });
});

describe('billing: representation in the invoice', () => {
  test('positions with the same representative are merged into one line, the breakdown keeps the original ones', () => {
    const lines: TariffPlanLine[] = [
      { productId: 'consult', qty: '1', price: '1000', isSubscription: false, invoiceAsProductId: 'repair' },
      { productId: 'spare', qty: '2', price: '500', isSubscription: false, invoiceAsProductId: 'repair' },
    ];
    const facts: BillingFact[] = [
      { sourceKind: 'work_order', sourceId: 'wo-1', productId: 'consult', qty: '1', price: '1000', date: '2026-09-10' },
      { sourceKind: 'work_order', sourceId: 'wo-2', productId: 'spare', qty: '2', price: '500', date: '2026-09-12' },
    ];
    const r = computeBilling({
      tariffLines: lines,
      facts,
      products: CATALOG,
      subscriptionPeriod: periodOf('month', '2026-10-15'),
      factPeriod: periodOf('month', '2026-09-15'),
      validFrom: '2026-01-01',
      validTo: null,
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.productId).toBe('repair'); // представление в счёте
    expect(r.lines[0]!.name).toBe('Repair за сентябрь 2026');
    expect(r.lines[0]!.qty).toBe('3.000');
    expect(r.lines[0]!.price).toBe('666.67'); // средневзвешенная цена: (1 × 1000 + 2 × 500) / 3
    expect(r.lines[0]!.breakdown).toHaveLength(2);
  });
});

describe('billing: the act of the billing invoice', () => {
  const line = (rows: BillingBreakdownRow[]): BillingLine => ({ productId: 'consult', name: 'Consultation', unitCode: '356', qty: '1.000', price: '0', vatRate: 'none', invoiceAsProductId: null, breakdown: rows });
  const row = (source: BillingBreakdownRow['source'], amount: string): BillingBreakdownRow => ({ source, sourceId: source === 'plan' ? null : 'x', productId: 'consult', name: 'Consultation', qty: '1', price: amount, amount });

  test('a work order and a shipment are already sold — they do not go into the act', () => {
    const lines = [line([row('plan', '5000.00')]), line([row('work_order', '2400.00')]), line([row('realization', '1000.00')]), line([row('time_log', '2000.00')])];
    const act = actLines(lines);
    expect(act.map(l => l.breakdown[0]!.source)).toEqual(['plan', 'time_log']);
  });

  test('a grouped line goes into the act with the sum of its own part', () => {
    const act = actLines([line([row('plan', '5000.00'), row('work_order', '2400.00')])]);
    expect(act).toHaveLength(1);
    expect(act[0]).toMatchObject({ qty: '1.000', price: '5000.00' });
  });
});
