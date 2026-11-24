import { describe, expect, test } from 'bun:test';
import { MODULE_BY_ID, moduleOfApiPath, resolveModules, fleetMeterTypeSchema, weighingCreateBody, weighingPatchBody } from '@erp/shared';
import { weighingMath } from '../src/routes/weighings';

describe('weighingCreateBody', () => {
  test('accepts a valid weighing and coerces numbers', () => {
    const r = weighingCreateBody.safeParse({ direction: 'out', grossKg: '42000', tareKg: 15000 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.grossKg).toBe(42000);
  });
  test('rejects gross < tare, negative tare and bad direction', () => {
    expect(weighingCreateBody.safeParse({ direction: 'in', grossKg: 100, tareKg: 200 }).success).toBe(false);
    expect(weighingCreateBody.safeParse({ direction: 'in', grossKg: 100, tareKg: -1 }).success).toBe(false);
    expect(weighingCreateBody.safeParse({ direction: 'x', grossKg: 100, tareKg: 0 }).success).toBe(false);
  });
  test('patch is partial but still checks gross >= tare', () => {
    expect(weighingPatchBody.safeParse({ notes: 'ok' }).success).toBe(true);
    expect(weighingPatchBody.safeParse({ grossKg: 1, tareKg: 2 }).success).toBe(false);
  });
});

describe('weighing math', () => {
  test('net and volume', () => {
    expect(weighingMath(42000, 15000, 1.5)).toEqual({ netKg: 27000, volumeM3: 18 });
    expect(weighingMath(10000, 4000, 1.6)).toEqual({ netKg: 6000, volumeM3: 3.75 });
  });
  test('no density → no volume', () => {
    expect(weighingMath(10000, 4000, null)).toEqual({ netKg: 6000, volumeM3: null });
    expect(weighingMath(10000, 4000)).toEqual({ netKg: 6000, volumeM3: null });
  });
});

describe('mining module', () => {
  test('requires production and owns /weighings', () => {
    expect(MODULE_BY_ID.mining.requires).toEqual(['production']);
    expect(moduleOfApiPath('/weighings')).toBe('mining');
    expect(resolveModules(['mining']).has('production')).toBe(true);
  });
});

describe('fleetMeterTypeSchema', () => {
  test('odometer / engine_hours only', () => {
    expect(fleetMeterTypeSchema.safeParse('engine_hours').success).toBe(true);
    expect(fleetMeterTypeSchema.safeParse('odometer').success).toBe(true);
    expect(fleetMeterTypeSchema.safeParse('km').success).toBe(false);
  });
});
