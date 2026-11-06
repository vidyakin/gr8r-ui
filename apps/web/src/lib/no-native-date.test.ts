/* Поля дат — только DateInput (components/gr8r/date-picker.tsx) с календарём проекта:
   нативный <input type="date"> выглядит по-разному в браузерах и не знает быстрых дат. */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(import.meta.dir, '..', 'app');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

describe('date fields', () => {
  test('screens use DateInput instead of native type="date"', () => {
    const offenders = files(APP).filter(f => readFileSync(f, 'utf8').includes('type="date"'));
    expect(offenders.map(f => f.slice(APP.length + 1))).toEqual([]);
  });
});
