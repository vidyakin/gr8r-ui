/* Обеспечение строки материала: чистая функция покрытия (нужно, списано, зарезервировано, размещено, не обеспечено, свободно, к поступлению, статус). */
import { describe, expect, test } from 'bun:test';
import { dec } from '../src/decimal';
import { materialCoverage, overTransferLimit } from '../src/supply';

const base = {
  need: '10',
  written: '0',
  reserved: '0',
  placed: '0',
  incoming: '0',
  onHand: '0',
  reservedTotal: '0',
};

describe('material coverage', () => {
  test('nothing is needed — the line is fully provided', () => {
    const c = materialCoverage({ ...base, need: '10', written: '10' });
    expect(c.required).toBe('0.000');
    expect(c.notEnsured).toBe('0.000');
    expect(c.status).toBe('full');
  });

  test('a reserve equal to the need covers the line', () => {
    const c = materialCoverage({ ...base, need: '10', reserved: '10' });
    expect(c.required).toBe('10.000');
    expect(c.notEnsured).toBe('0.000');
    expect(c.status).toBe('full');
  });

  test('a part of the need is reserved — the line is partially provided', () => {
    const c = materialCoverage({ ...base, need: '10', reserved: '4' });
    expect(c.notEnsured).toBe('6.000');
    expect(c.status).toBe('partial');
  });

  test('a placed quantity (ordered from a supplier) provides the line too', () => {
    const c = materialCoverage({ ...base, need: '10', placed: '6' });
    expect(c.notEnsured).toBe('4.000');
    expect(c.status).toBe('partial');
    const full = materialCoverage({ ...base, need: '10', placed: '10' });
    expect(full.notEnsured).toBe('0.000');
    expect(full.status).toBe('full');
  });

  test('nothing is reserved or ordered — the line is not provided', () => {
    const c = materialCoverage({ ...base, need: '10' });
    expect(c.notEnsured).toBe('10.000');
    expect(c.status).toBe('none');
  });

  test('written off goods reduce the requirement', () => {
    const c = materialCoverage({ ...base, need: '10', written: '6', reserved: '4' });
    expect(c.required).toBe('4.000');
    expect(c.notEnsured).toBe('0.000');
    expect(c.status).toBe('full');
  });

  test('free stock is the remainder minus all the reserves of the goods', () => {
    const c = materialCoverage({ ...base, need: '10', onHand: '25', reservedTotal: '7' });
    expect(c.free).toBe('18.000');
  });

  test('incoming goods are shown as they are', () => {
    const c = materialCoverage({ ...base, need: '10', incoming: '3.5' });
    expect(c.incoming).toBe('3.500');
  });

  test('without transfers the transferred columns are zero', () => {
    const c = materialCoverage(base);
    expect(c.transferred).toBe('0.000');
    expect(c.overTransferred).toBe('0.000');
    expect(c.transferLimit).toBe('10.000');
  });

  test('a transfer within the need is not over-transferred', () => {
    const c = materialCoverage({ ...base, transferred: '7.5' });
    expect(c.transferred).toBe('7.500');
    expect(c.overTransferred).toBe('0.000');
  });

  test('a transfer above the need is shown as over-transferred', () => {
    const c = materialCoverage({ ...base, transferred: '10.5', overtransferPct: '10' });
    expect(c.transferred).toBe('10.500');
    expect(c.overTransferred).toBe('0.500');
    expect(c.transferLimit).toBe('11.000');
  });

  test('transfers do not change reserve or status', () => {
    const c = materialCoverage({ ...base, reserved: '4', transferred: '12' });
    expect(c.status).toBe('partial');
    expect(c.notEnsured).toBe('6.000');
  });
});

describe('over-transfer limit', () => {
  test('zero percent is the plain norm', () => {
    expect(overTransferLimit(dec('10'), 0n)).toBe(dec('10'));
  });
  test('norm × (1 + pct / 100)', () => {
    expect(overTransferLimit(dec('10'), dec('5'))).toBe(dec('10.5'));
    expect(overTransferLimit(dec('3'), dec('33.33'))).toBe(dec('3.9999'));
  });
  test('a negative percent is treated as zero', () => {
    expect(overTransferLimit(dec('10'), dec('-5'))).toBe(dec('10'));
  });
});
