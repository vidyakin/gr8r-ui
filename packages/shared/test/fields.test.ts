/* Сборка zod-схемы из описания полей: по одному допустимому и недопустимому значению на тип; create / patch. */
import { describe, expect, test } from 'bun:test';
import { buildRecordSchema, validateRecord, keyFromName, plainValue, type FieldDef } from '../src';

const U = '0198a7c0-0000-7000-8000-000000000001';
const f = (key: string, type: FieldDef['type'], options: FieldDef['options'] = {}, required = false): FieldDef => ({ key, name: key, type, required, options });
const choices = [{ value: 'a', label: 'Alpha', color: 'blue' }, { value: 'b', label: 'Beta', color: 'rose' }];

const cases: [FieldDef, unknown, unknown, unknown][] = [
  // поле, допустимое значение, ожидаемый результат, недопустимое
  [f('t', 'text'), ' hi ', 'hi', 123],
  [f('lt', 'long_text'), 'a\nb', 'a\nb', {}],
  [f('n', 'number', { min: 1, max: 9 }), '5', 5, 10],
  [f('m', 'money'), 1.234, 1.23, 'abc'],
  [f('p', 'percent'), 99.5, 99.5, 101],
  [f('d', 'date'), '2026-02-28', '2026-02-28', '2026-02-29'],
  [f('dt', 'datetime'), '2026-02-28T10:00:00+03:00', '2026-02-28T10:00:00+03:00', '2026-02-28'],
  [f('b', 'boolean'), true, true, 'true'],
  [f('s', 'select', { choices }), 'a', 'a', 'z'],
  [f('ms', 'multi_select', { choices }), ['a', 'a', 'b'], ['a', 'b'], ['c']],
  [f('u', 'user'), U, U, 'x'],
  [f('r', 'ref', { refEntity: 'company' }), U, U, 5],
  [f('rs', 'refs', { refEntity: 'company' }), [U, U], [U], [U, 'x']],
  [f('url', 'url'), 'https://a.b/c?d=1', 'https://a.b/c?d=1', 'a.b'],
  [f('e', 'email'), 'x@y.zz', 'x@y.zz', 'x@'],
  [f('ph', 'phone'), '+7 (900) 123-45-67', '+7 (900) 123-45-67', '12'],
];

describe('buildRecordSchema', () => {
  for (const [def, good, out, bad] of cases) {
    test(`${def.type}: accepts a valid value and rejects an invalid one`, () => {
      const schema = buildRecordSchema([def]);
      const ok = schema.safeParse({ [def.key]: good });
      expect(ok.success).toBe(true);
      expect((ok as { data: Record<string, unknown> }).data[def.key]).toEqual(out);
      expect(schema.safeParse({ [def.key]: bad }).success).toBe(false);
    });
  }

  test('create: required fields must be filled, blanks are dropped, unknown keys are rejected', () => {
    const defs = [f('name', 'text', {}, true), f('note', 'long_text'), f('tags', 'multi_select', { choices })];
    const s = buildRecordSchema(defs, 'create');
    expect(s.safeParse({}).success).toBe(false);
    expect(s.safeParse({ name: '   ' }).success).toBe(false);
    expect(s.parse({ name: 'x', note: '', tags: [] })).toEqual({ name: 'x' });
    expect(s.safeParse({ name: 'x', other: 1 }).success).toBe(false);
  });

  test('patch: only present keys are checked, null clears optional fields and is an error for required ones', () => {
    const defs = [f('name', 'text', {}, true), f('note', 'text')];
    const s = buildRecordSchema(defs, 'patch');
    expect(s.parse({})).toEqual({});
    expect(s.parse({ note: null })).toEqual({ note: null });
    expect(s.parse({ note: '' })).toEqual({ note: null });
    expect(s.safeParse({ name: null }).success).toBe(false);
    expect(s.parse({ name: 'new' })).toEqual({ name: 'new' });
  });

  test('validateRecord returns errors keyed by field for client forms', () => {
    const r = validateRecord([f('name', 'text', {}, true), f('n', 'number', { max: 3 })], { n: 7 });
    expect(r).toEqual({ ok: false, errors: { name: 'name is required', n: 'Must be at most 3' } });
  });

  test('helpers: keyFromName and plainValue', () => {
    expect(keyFromName('Story points')).toBe('story_points');
    expect(keyFromName('  Client / Company #1 ')).toBe('client_company_1');
    expect(keyFromName('123')).toBe('field');
    expect(plainValue(f('s', 'select', { choices }), 'a')).toBe('Alpha');
    expect(plainValue(f('b', 'boolean'), false)).toBe('No');
  });
});
