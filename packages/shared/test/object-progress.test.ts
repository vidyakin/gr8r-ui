/* Процент выполнения объекта и суммы вех (задача 1272): каждый способ расчёта, null без базы,
   вехи — сумма или процент от стоимости договора, аванс отдельно от выполнения. */
import { describe, expect, test } from 'bun:test';
import { computeObjectProgress, milestoneAmount, milestonesDonePercent, percentOf, summarizeMilestones } from '@gr8r/shared';
import { dec } from '../src/decimal';

const closed = { status: 'done' };

describe('процент выполнения: способы расчёта', () => {
  test('tasks_closed — доля задач в завершённых статусах, один знак после запятой', () => {
    const r = computeObjectProgress({
      mode: 'tasks_closed',
      tasks: [closed, closed, { status: 'todo' }],
      estimateItems: null,
    });
    expect(r.percent).toBe('66.7');
    expect(r.base.tasks).toMatchObject({ total: 3, closed: 2 });
  });

  test('tasks_closed: статус closed тоже завершённый', () => {
    expect(computeObjectProgress({ mode: 'tasks_closed', tasks: [{ status: 'closed' }, { status: 'progress' }], estimateItems: null }).percent).toBe('50.0');
  });

  test('tasks_closed: ноль задач — базы нет', () => {
    const r = computeObjectProgress({ mode: 'tasks_closed', tasks: [], estimateItems: null });
    expect(r.percent).toBeNull();
    expect(r.base.tasks).toMatchObject({ total: 0, closed: 0 });
  });

  test('tasks_avg — средний прогресс: завершённая 100, остальные 0', () => {
    expect(computeObjectProgress({ mode: 'tasks_avg', tasks: [closed, { status: 'todo' }, { status: 'todo' }, { status: 'review' }], estimateItems: null }).percent).toBe('25.0');
  });

  test('task_weights — веса задач; без веса = 1', () => {
    const r = computeObjectProgress({
      mode: 'task_weights',
      tasks: [
        { status: 'done', weight: '3' },
        { status: 'todo', weight: '1' },
        { status: 'done' },
      ],
      estimateItems: null,
    });
    // (3 + 1) / (3 + 1 + 1) = 80%
    expect(r.percent).toBe('80.0');
    expect(r.base.tasks.weightTotal).toBe('5.00');
  });

  test('task_weights: нулевые веса считаются как 1', () => {
    expect(computeObjectProgress({ mode: 'task_weights', tasks: [{ status: 'done', weight: '0' }, { status: 'todo' }], estimateItems: null }).percent).toBe('50.0');
  });

  test('estimate_volume — выполненный объём позиций согласованной сметы', () => {
    const r = computeObjectProgress({
      mode: 'estimate_volume',
      tasks: [closed],
      estimateItems: [
        { qty: '100', price: '250', doneQty: '100' },
        { qty: '2', price: '12000', doneQty: '1' },
        { qty: '1', price: '25000', doneQty: '0' },
      ],
    });
    // (100 × 250 + 1 × 12000) / (100 × 250 + 2 × 12000 + 25000) = 37000 / 74000 = 50%
    expect(r.percent).toBe('50.0');
    expect(r.base.estimate).toMatchObject({ lines: 3, revenue: '74000.00', doneRevenue: '37000.00' });
  });

  test('estimate_volume: нет согласованной сметы или пустая — базы нет', () => {
    expect(computeObjectProgress({ mode: 'estimate_volume', tasks: [closed], estimateItems: null }).percent).toBeNull();
    expect(computeObjectProgress({ mode: 'estimate_volume', tasks: [closed], estimateItems: [] }).percent).toBeNull();
    expect(
      computeObjectProgress({ mode: 'estimate_volume', tasks: [], estimateItems: [{ qty: '0', price: '0', doneQty: '0' }] }).percent,
    ).toBeNull();
  });

  test('manual — ручной процент, не задан — null', () => {
    expect(computeObjectProgress({ mode: 'manual', manual: '42.5', tasks: [closed], estimateItems: null }).percent).toBe('42.5');
    expect(computeObjectProgress({ mode: 'manual', manual: '30', tasks: [], estimateItems: null }).percent).toBe('30.0');
    expect(computeObjectProgress({ mode: 'manual', manual: null, tasks: [closed], estimateItems: null }).percent).toBeNull();
  });

  test('decimal: 1/3 без float', () => {
    expect(percentOf(dec('1'), dec('3'))).toBe('33.3');
    expect(percentOf(0n, 0n)).toBeNull();
  });
});

describe('вехи: сумма и сводка', () => {
  const contract = '100000.00';

  test('сумма вехи: фиксированная или процент от стоимости договора', () => {
    expect(milestoneAmount({ amount: '25000.00' }, contract)).toBe('25000.00');
    expect(milestoneAmount({ pct: '30' }, contract)).toBe('30000.00');
    expect(milestoneAmount({ pct: '30' }, null)).toBeNull();
  });

  test('сводка: этапы отдельно, аванс отдельно и в выполнение не входит', () => {
    const summary = summarizeMilestones(
      [
        { kind: 'advance', pct: '30' },
        { kind: 'stage', pct: '40', doneAt: '2026-11-01' },
        { kind: 'stage', pct: '30' },
      ],
      contract,
    );
    expect(summary.contractValue).toBe('100000.00');
    expect(summary.stages).toEqual({ total: '70000.00', done: '40000.00', accepted: '0.00', invoiced: null, paid: null });
    expect(summary.advance).toEqual({ total: '30000.00', done: '0.00', accepted: '0.00', invoiced: null, paid: null });
    expect(milestonesDonePercent(summary)).toBe(57.1);
  });

  test('сводка: принято отдельно от выполнено', () => {
    const summary = summarizeMilestones([{ kind: 'stage', amount: '1000', doneAt: '2026-11-01', acceptedAt: '2026-11-05' }, { kind: 'stage', amount: '1000', doneAt: '2026-11-02' }], contract);
    expect(summary.stages).toMatchObject({ total: '2000.00', done: '2000.00', accepted: '1000.00' });
  });

  test('сводка: веха-процент без стоимости договора — суммы не считаются', () => {
    const summary = summarizeMilestones([{ kind: 'stage', pct: '40' }], null);
    expect(summary.stages.total).toBeNull();
  });
});
