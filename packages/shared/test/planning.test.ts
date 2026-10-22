/* Этап 4г: планирование загрузки. Проверяются чистые функции: рабочие дни по недельному и циклическому
   графику, праздники и исключения, расчёт загрузки и перегрузки, автопланирование по порядку этапов. */
import { describe, expect, test } from 'bun:test';
import {
  autoSchedule,
  computeLoad,
  capacityOf,
  isWorkingDay,
  isWorkingDayWith,
  type CalendarDef,
  type LoadEntry,
  type LoadRow,
} from '../src/planning';

const weekly: CalendarDef = { id: 'c1', kind: 'weekly', pattern: { weekdays: [1, 2, 3, 4, 5] }, cycleStart: null, hoursPerDay: '8' };
const cyclic: CalendarDef = { id: 'c2', kind: 'cycle', pattern: { cycle: [1, 1, 0, 0] }, cycleStart: '2026-01-05', hoursPerDay: '12' };

describe('work calendars', () => {
  test('a weekly calendar has working days from Monday to Friday', () => {
    expect(isWorkingDay(weekly, '2026-10-19')).toBe(true); // понедельник
    expect(isWorkingDay(weekly, '2026-10-20')).toBe(true);
    expect(isWorkingDay(weekly, '2026-10-24')).toBe(false); // суббота
    expect(isWorkingDay(weekly, '2026-10-25')).toBe(false); // воскресенье
  });

  test('a cyclic calendar repeats its pattern from the start date', () => {
    // цикл начинается в понедельник 2026-01-05: рабочие дни — 5, 6 января
    expect(isWorkingDay(cyclic, '2026-01-05')).toBe(true);
    expect(isWorkingDay(cyclic, '2026-01-06')).toBe(true);
    expect(isWorkingDay(cyclic, '2026-01-07')).toBe(false);
    expect(isWorkingDay(cyclic, '2026-01-08')).toBe(false);
    expect(isWorkingDay(cyclic, '2026-01-09')).toBe(true);
  });

  test('a holiday and an exception make the day non-working', () => {
    expect(isWorkingDayWith(weekly, '2026-10-19', ['2026-10-19'])).toBe(false);
    expect(isWorkingDayWith(weekly, '2026-10-19', [], [{ scope: 'member', scopeId: 'm1', dateFrom: '2026-10-19', dateTo: '2026-10-21' }])).toBe(false);
    expect(isWorkingDayWith(weekly, '2026-10-22', [], [{ scope: 'member', scopeId: 'm1', dateFrom: '2026-10-19', dateTo: '2026-10-21' }])).toBe(true);
  });

  test('the capacity of a day is the hours of the calendar, zero on a day off', () => {
    expect(capacityOf(weekly, '2026-10-19', null)).toBe(8_000_000n);
    expect(capacityOf(weekly, '2026-10-24', null)).toBe(0n);
    expect(capacityOf(weekly, '2026-10-19', '6')).toBe(6_000_000n);
  });
});

describe('load', () => {
  const row: LoadRow = { id: 'm1', rowType: 'member', name: 'Иван', capacityHoursPerDay: null, calendar: weekly };
  const entry: LoadEntry = {
    id: 'e1',
    kind: 'operation',
    title: 'Сборка',
    rowType: 'member',
    rowId: 'm1',
    start: '2026-10-19',
    end: '2026-10-20',
    hours: '16',
  };

  test('the hours are spread over the days of the interval and the overload is marked', () => {
    const res = computeLoad([row], [entry], '2026-10-19', '2026-10-25');
    expect(res).toHaveLength(1);
    const days = res[0]!.days;
    expect(days.map(d => [d.date, d.hours, d.capacity, d.overloaded])).toEqual([
      ['2026-10-19', '8.00', '8.00', false],
      ['2026-10-20', '8.00', '8.00', false],
      ['2026-10-21', '0.00', '8.00', false],
      ['2026-10-22', '0.00', '8.00', false],
      ['2026-10-23', '0.00', '8.00', false],
      ['2026-10-24', '0.00', '0.00', false],
      ['2026-10-25', '0.00', '0.00', false],
    ]);
    expect(res[0]!.totalHours).toBe('16.00');
    expect(res[0]!.overloaded).toBe(false);
  });

  test('more hours than the capacity is an overload — a warning, not a block', () => {
    const res = computeLoad([row], [{ ...entry, hours: '20', start: '2026-10-19', end: '2026-10-19' }], '2026-10-19', '2026-10-19');
    expect(res[0]!.days[0]).toMatchObject({ hours: '20.00', capacity: '8.00', overloaded: true });
    expect(res[0]!.overloaded).toBe(true);
  });

  test('work planned for a day off is an overload', () => {
    const res = computeLoad([row], [{ ...entry, start: '2026-10-24', end: '2026-10-24', hours: '4' }], '2026-10-24', '2026-10-24');
    expect(res[0]!.days[0]).toMatchObject({ capacity: '0.00', overloaded: true });
  });
});

describe('auto scheduling', () => {
  const member: LoadRow = { id: 'm1', rowType: 'member', name: 'Иван', capacityHoursPerDay: null, calendar: weekly };
  const member2: LoadRow = { id: 'm2', rowType: 'member', name: 'Пётр', capacityHoursPerDay: null, calendar: weekly };

  test('the operations are placed from the start date within the free capacity', () => {
    const res = autoSchedule(
      [{ id: 'u1', stageOrder: 0, demands: [{ rowId: 'm1', hours: '10' }] }],
      [member],
      '2026-10-17',
    );
    expect(res.units[0]).toMatchObject({ start: '2026-10-19', end: '2026-10-20', scheduled: true });
    expect(res.forecastEnd).toBe('2026-10-20');
  });

  test('the stages go in order and the next one starts after the previous', () => {
    const res = autoSchedule(
      [
        { id: 'u1', stageOrder: 0, demands: [{ rowId: 'm1', hours: '8' }] },
        { id: 'u2', stageOrder: 1, demands: [{ rowId: 'm1', hours: '8' }] },
      ],
      [member],
      '2026-10-19',
    );
    expect(res.units.map(u => [u.start, u.end])).toEqual([
      ['2026-10-19', '2026-10-19'],
      ['2026-10-20', '2026-10-20'],
    ]);
  });

  test('manual dates are not moved, the plan goes after them', () => {
    const res = autoSchedule(
      [
        { id: 'u1', stageOrder: 0, demands: [{ rowId: 'm1', hours: '8' }], manualStart: '2026-10-26', manualEnd: '2026-10-26' },
        { id: 'u2', stageOrder: 1, demands: [{ rowId: 'm1', hours: '8' }] },
      ],
      [member],
      '2026-10-19',
    );
    expect(res.units[0]).toMatchObject({ start: '2026-10-26', end: '2026-10-26' });
    expect(res.units[1]!.start).toBe('2026-10-27');
  });

  test('the busy load of other orders is taken into account', () => {
    const res = autoSchedule(
      [{ id: 'u1', stageOrder: 0, demands: [{ rowId: 'm1', hours: '8' }] }],
      [member],
      '2026-10-19',
      { busy: { m1: { '2026-10-19': '8' } } },
    );
    expect(res.units[0]!.start).toBe('2026-10-20');
  });

  test('the second employee takes the rest of the work', () => {
    const res = autoSchedule(
      [{ id: 'u1', stageOrder: 0, demands: [{ rowId: 'm1', hours: '8' }] }],
      [member, member2],
      '2026-10-19',
    );
    expect(res.units[0]).toMatchObject({ start: '2026-10-19', end: '2026-10-19', scheduled: true });
  });

  test('the resource with less hours finishes earlier than the employee', () => {
    const resource: LoadRow = { id: 'r1', rowType: 'resource', name: 'Станок', capacityHoursPerDay: '8', calendar: weekly };
    const res = autoSchedule(
      [{ id: 'u1', stageOrder: 0, demands: [{ rowId: 'm1', hours: '16' }, { rowId: 'r1', hours: '4' }] }],
      [member, resource],
      '2026-10-19',
    );
    expect(res.units[0]).toMatchObject({ start: '2026-10-19', end: '2026-10-20', scheduled: true });
  });
});

describe('checks found in review', () => {
  test('the hours of an entry are spread over the working days of the row, not over the weekend', () => {
    const rows: LoadRow[] = [{ id: 'm1', rowType: 'member', name: 'Иван', capacityHoursPerDay: null, calendar: weekly }];
    // пятница 2026-10-23 — понедельник 2026-10-26, 16 часов: по 8 в пятницу и понедельник, выходные свободны
    const entries: LoadEntry[] = [{ id: 'e1', kind: 'operation', title: 'Сборка', rowType: 'member', rowId: 'm1', start: '2026-10-23', end: '2026-10-26', hours: '16' }];
    const [row] = computeLoad(rows, entries, '2026-10-23', '2026-10-26');
    expect(row.days.map(d => d.hours)).toEqual(['8.00', '0.00', '0.00', '8.00']);
    expect(row.overloaded).toBe(false);
  });
});
