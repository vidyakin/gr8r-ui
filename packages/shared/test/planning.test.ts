/* Этап 4г: планирование загрузки. Проверяются чистые функции: рабочие дни по недельному и циклическому
   графику, праздники и исключения, расчёт загрузки и перегрузки, автопланирование по порядку этапов. */
import { describe, expect, test } from 'bun:test';
import {
  autoSchedule,
  computeLoad,
  capacityOf,
  isWorkingDay,
  isWorkingDayWith,
  computeHourlyLoad,
  shiftOf,
  type CalendarDef,
  type HourlyEntry,
  type HourlyRow,
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

/* ---------------- часовой масштаб (этап 5 услуг) ---------------- */

describe('hourly load', () => {
  const shift: CalendarDef = { id: 'c1', kind: 'weekly', pattern: { weekdays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 }, cycleStart: null, hoursPerDay: '8' };
  const night: CalendarDef = { id: 'c3', kind: 'cycle', pattern: { cycle: [1, 1, 0, 0], startHour: 22, endHour: 6 }, cycleStart: '2026-01-05', hoursPerDay: '8' };

  const memberRow: HourlyRow = { id: 'm1', rowType: 'member', name: 'Иван', capacityUnits: 1, calendar: shift };
  const resourceRow: HourlyRow = { id: 'r1', rowType: 'resource', name: 'Верстак', capacityUnits: 1, calendar: shift };
  const bench: HourlyRow = { id: 'r2', rowType: 'resource', name: 'Стол', capacityUnits: 2, calendar: shift };

  const assignment = (id: string, startAt: string, endAt: string, rowId = 'm1'): HourlyEntry => ({
    id,
    kind: 'assignment',
    title: 'Монтаж',
    rowType: 'member',
    rowId,
    startAt,
    endAt,
    hours: '2',
  });

  test('the shift of the calendar comes from the pattern, otherwise from the hours of the day', () => {
    expect(shiftOf(shift)).toEqual({ startHour: 9, endHour: 17 });
    expect(shiftOf({ id: 'c4', kind: 'weekly', pattern: { weekdays: [1] }, cycleStart: null, hoursPerDay: '12' })).toEqual({ startHour: 9, endHour: 21 });
    expect(shiftOf(null)).toEqual({ startHour: 9, endHour: 17 });
  });

  test('the hours of the shift are working, the rest of the day is not', () => {
    const res = computeHourlyLoad([memberRow], [assignment('e1', '2026-10-19T09:00:00Z', '2026-10-19T11:00:00Z')], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z');
    const slots = res.rows[0]!.slots;
    expect(slots.find(s => s.start === '2026-10-19T09:00:00.000Z')).toMatchObject({ working: true, used: '1.00', capacity: '1.00', overloaded: false });
    expect(slots.find(s => s.start === '2026-10-19T12:00:00.000Z')).toMatchObject({ working: true, used: '0.00' });
    expect(slots.find(s => s.start === '2026-10-19T08:00:00.000Z')).toMatchObject({ working: false, capacity: '0.00' });
  });

  test('two assignments of one executor at the same time are a warning', () => {
    const res = computeHourlyLoad([memberRow], [assignment('e1', '2026-10-19T09:00:00Z', '2026-10-19T11:00:00Z'), assignment('e2', '2026-10-19T10:00:00Z', '2026-10-19T12:00:00Z')], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z');
    expect(res.warnings.filter(w => w.code === 'member_overlap')).toHaveLength(1);
    expect(res.rows[0]!.slots.find(s => s.start === '2026-10-19T10:00:00.000Z')).toMatchObject({ used: '2.00', capacity: '1.00', overloaded: true });
  });

  test('assignments one after another do not overlap', () => {
    const res = computeHourlyLoad([memberRow], [assignment('e1', '2026-10-19T09:00:00Z', '2026-10-19T11:00:00Z'), assignment('e2', '2026-10-19T11:00:00Z', '2026-10-19T13:00:00Z')], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z');
    expect(res.warnings.filter(w => w.code === 'member_overlap')).toHaveLength(0);
    expect(res.rows[0]!.slots.some(s => s.overloaded)).toBe(false);
  });

  test('a resource is busy with more works than its capacity', () => {
    const work = (id: string, rowId: string): HourlyEntry => ({ id, kind: 'resource', title: 'Работа', rowType: 'resource', rowId, startAt: '2026-10-19T09:00:00Z', endAt: '2026-10-19T11:00:00Z', hours: '2' });
    const res = computeHourlyLoad([resourceRow], [work('e1', 'r1'), work('e2', 'r1')], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z');
    expect(res.warnings.filter(w => w.code === 'resource_overload')).toHaveLength(1);
    // у верстака на две смены — две работы одновременно не перегруз
    const res2 = computeHourlyLoad([bench], [work('e1', 'r2'), work('e2', 'r2')], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z');
    expect(res2.warnings.filter(w => w.code === 'resource_overload')).toHaveLength(0);
  });

  test('a resource is overloaded only when more works than its capacity go at the same moment', () => {
    const work = (id: string, startAt: string, endAt: string): HourlyEntry => ({ id, kind: 'resource', title: 'Работа', rowType: 'resource', rowId: 'r2', startAt, endAt, hours: '1' });
    // длинная работа пересекается с двумя короткими, но короткие идут одна после другой: одновременно не больше двух
    const res = computeHourlyLoad(
      [bench],
      [work('long', '2026-10-19T09:00:00Z', '2026-10-19T12:00:00Z'), work('a', '2026-10-19T09:00:00Z', '2026-10-19T10:00:00Z'), work('b', '2026-10-19T11:00:00Z', '2026-10-19T12:00:00Z')],
      '2026-10-19T00:00:00Z',
      '2026-10-20T00:00:00Z',
    );
    expect(res.warnings.filter(w => w.code === 'resource_overload')).toHaveLength(0);
    // третья работа в то же время — перегрузка, одно предупреждение на все три
    const res2 = computeHourlyLoad(
      [bench],
      [work('long', '2026-10-19T09:00:00Z', '2026-10-19T12:00:00Z'), work('a', '2026-10-19T09:00:00Z', '2026-10-19T10:00:00Z'), work('c', '2026-10-19T09:30:00Z', '2026-10-19T10:30:00Z')],
      '2026-10-19T00:00:00Z',
      '2026-10-20T00:00:00Z',
    );
    const w = res2.warnings.filter(x => x.code === 'resource_overload');
    expect(w).toHaveLength(1);
    expect([...w[0]!.entryIds].sort()).toEqual(['a', 'c', 'long']);
  });

  test('assignments planned by days without hours do not give hourly warnings', () => {
    // назначения без часового интервала (только даты задачи) — дневной план, не часовой: ни наложения, ни «вне смены»
    const day = (id: string): HourlyEntry => ({ ...assignment(id, '2026-10-19T00:00:00Z', '2026-10-19T23:59:00Z'), allDay: true });
    const res = computeHourlyLoad([memberRow], [day('d1'), day('d2')], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z');
    expect(res.warnings).toHaveLength(0);
    expect(res.rows[0]!.slots.some(s => s.overloaded)).toBe(false);
    expect(res.entries.map(e => e.id)).toEqual(['d1', 'd2']);
  });

  test('work outside the shift and on a day off is a warning', () => {
    const res = computeHourlyLoad([memberRow], [assignment('e1', '2026-10-19T19:00:00Z', '2026-10-19T20:00:00Z')], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z');
    expect(res.warnings.filter(w => w.code === 'outside_shift')).toHaveLength(1);
    // суббота — выходной
    const res2 = computeHourlyLoad([memberRow], [assignment('e1', '2026-10-24T10:00:00Z', '2026-10-24T12:00:00Z')], '2026-10-24T00:00:00Z', '2026-10-25T00:00:00Z');
    expect(res2.warnings.filter(w => w.code === 'outside_shift')).toHaveLength(1);
  });

  test('the night shift goes through midnight', () => {
    const row: HourlyRow = { id: 'm2', rowType: 'member', name: 'Пётр', capacityUnits: 1, calendar: night };
    // цикл начинается в понедельник 2026-01-05: рабочие дни 5 и 6 января
    const res = computeHourlyLoad([row], [assignment('e1', '2026-01-05T22:00:00Z', '2026-01-06T02:00:00Z')], '2026-01-05T00:00:00Z', '2026-01-07T00:00:00Z');
    const slots = res.rows[0]!.slots;
    expect(slots.find(s => s.start === '2026-01-05T22:00:00.000Z')).toMatchObject({ working: true });
    expect(slots.find(s => s.start === '2026-01-05T23:00:00.000Z')).toMatchObject({ working: true });
    expect(slots.find(s => s.start === '2026-01-06T01:00:00.000Z')).toMatchObject({ working: true });
    expect(slots.find(s => s.start === '2026-01-06T12:00:00.000Z')).toMatchObject({ working: false });
    expect(res.warnings.filter(w => w.code === 'outside_shift')).toHaveLength(0);
  });

  test('the shift of the workspace is counted in its own time zone', () => {
    // смена 09:00–17:00 по Москве: в UTC это 06:00–14:00
    const res = computeHourlyLoad([memberRow], [assignment('e1', '2026-10-19T07:00:00Z', '2026-10-19T09:00:00Z')], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z', { timeZone: 'Europe/Moscow' });
    expect(res.warnings.filter(w => w.code === 'outside_shift')).toHaveLength(0);
    expect(res.rows[0]!.slots.find(s => s.start === '2026-10-19T07:00:00.000Z')).toMatchObject({ working: true });
    // в UTC этот же интервал — до начала смены
    const res2 = computeHourlyLoad([memberRow], [assignment('e1', '2026-10-19T07:00:00Z', '2026-10-19T09:00:00Z')], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z', { timeZone: 'UTC' });
    expect(res2.warnings.filter(w => w.code === 'outside_shift')).toHaveLength(1);
  });
});
