/* Задача 1171: чистые правила слотов — сетка недели, исключения, праздники, пересечения, поиск ближайшего свободного. */
import { describe, expect, test } from 'bun:test';
import { checkPlacement, findNearestFree, freeStarts, gridStarts, slotsNeeded, weekdayOf, workingSlots, type ScheduleDef } from '../src/appointments';

const def: ScheduleDef = { slotMinutes: 30, dayStartMin: 540, dayEndMin: 720, week: { '1': [540, 570, 600, 630, 660, 690], '2': [540, 570] } };

describe('working slots', () => {
  test('weekday and grid', () => {
    expect(weekdayOf('2026-11-02')).toBe(1);
    expect(weekdayOf('2026-11-08')).toBe(7);
    expect(gridStarts(def)).toEqual([540, 570, 600, 630, 660, 690]);
  });
  test('weekly pattern, exception and holiday; off-grid slots are dropped', () => {
    expect(workingSlots(def, '2026-11-03')).toEqual([540, 570]);
    expect(workingSlots(def, '2026-11-04')).toEqual([]);
    expect(workingSlots(def, '2026-11-02', [{ date: '2026-11-02', slots: null }])).toEqual([]);
    expect(workingSlots(def, '2026-11-02', [{ date: '2026-11-02', slots: [570, 545, 600, 900] }])).toEqual([570, 600]);
    expect(workingSlots(def, '2026-11-02', [], ['2026-11-02'])).toEqual([]);
    expect(workingSlots(def, '2026-11-02', [{ date: '2026-11-02', slots: [540] }], ['2026-11-02'])).toEqual([540]);
  });
});

describe('placement', () => {
  const working = [540, 570, 600, 630];
  test('consecutive slots are required', () => {
    expect(slotsNeeded(60, 30)).toBe(2);
    expect(slotsNeeded(45, 30)).toBe(2);
    expect(slotsNeeded(null, 45)).toBe(1);
    expect(checkPlacement({ working, slotMinutes: 30, startMin: 570, slots: 2, busy: [] })).toBeNull();
    expect(checkPlacement({ working, slotMinutes: 30, startMin: 630, slots: 2, busy: [] })).toBe('outside_slots');
    expect(checkPlacement({ working: [540, 600], slotMinutes: 30, startMin: 540, slots: 2, busy: [] })).toBe('outside_slots');
  });
  test('overlap with a busy range, touching ranges are fine', () => {
    const busy = [{ startMin: 570, endMin: 630 }];
    expect(checkPlacement({ working, slotMinutes: 30, startMin: 540, slots: 1, busy })).toBeNull();
    expect(checkPlacement({ working, slotMinutes: 30, startMin: 540, slots: 2, busy })).toBe('overlap');
    expect(checkPlacement({ working, slotMinutes: 30, startMin: 600, slots: 1, busy })).toBe('overlap');
    expect(checkPlacement({ working, slotMinutes: 30, startMin: 630, slots: 1, busy })).toBeNull();
    expect(freeStarts({ working, slotMinutes: 30, slots: 2, busy })).toEqual([]);
    expect(freeStarts({ working, slotMinutes: 30, slots: 1, busy })).toEqual([540, 630]);
  });
});

describe('nearest free', () => {
  const full = { memberId: 'a', date: '2026-11-02', def, working: [540, 570], busy: [{ startMin: 540, endMin: 600 }] };
  test('later day of the same specialist, or another specialist the same day', () => {
    const next = { memberId: 'a', date: '2026-11-03', def, working: [540, 570], busy: [] };
    expect(findNearestFree([full, next], 30, { date: '2026-11-02', startMin: 0 })).toEqual({ memberId: 'a', date: '2026-11-03', startMin: 540, slots: 1 });
    const other = { memberId: 'b', date: '2026-11-02', def: { ...def, slotMinutes: 60 }, working: [600, 660], busy: [] };
    expect(findNearestFree([full, next, other], 60, { date: '2026-11-02', startMin: 0 })).toEqual({ memberId: 'b', date: '2026-11-02', startMin: 600, slots: 1 });
    expect(findNearestFree([full, next, other], 60, { date: '2026-11-02', startMin: 610 })?.startMin).toBe(660);
    expect(findNearestFree([full], 90, { date: '2026-11-02', startMin: 0 })).toBeNull();
  });
});
