/* Задача 1176: чистые правила воронок — обязательные поля, норматив этапа, шаблоны, этап «квалифицирован». */
import { describe, expect, test } from 'bun:test';
import { PIPELINE_TEMPLATES, conversionPct, isStageOverdue, isValidRequiredField, missingRequiredFields, qualifiedStageIndex, weightedAmount } from '../src';

const none = { amount: '0', closeDate: null, contactCount: 0, sourceId: null, custom: {} };

describe('обязательные поля этапа', () => {
  test('пустые встроенные поля и поля конструктора попадают в список', () => {
    expect(missingRequiredFields(['amount', 'closeDate', 'contact', 'source', 'custom:region'], none)).toEqual(['amount', 'closeDate', 'contact', 'source', 'custom:region']);
  });
  test('заполненные не мешают', () => {
    expect(missingRequiredFields(['amount', 'closeDate', 'contact', 'source', 'custom:region'], { amount: '10.50', closeDate: '2030-01-01', contactCount: 1, sourceId: 'x', custom: { region: 'ЦФО' } })).toEqual([]);
  });
  test('допустимые ключи', () => {
    expect(isValidRequiredField('amount')).toBe(true);
    expect(isValidRequiredField('custom:region')).toBe(true);
    expect(isValidRequiredField('custom:')).toBe(false);
    expect(isValidRequiredField('stage')).toBe(false);
  });
});

describe('норматив этапа и расчёты', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  test('просрочка только при заданном нормативе и превышении', () => {
    expect(isStageOverdue(null, '2026-01-01', now)).toBe(false);
    expect(isStageOverdue(3, '2026-10-27T12:00:00Z', now)).toBe(false);
    expect(isStageOverdue(3, '2026-10-25T12:00:00Z', now)).toBe(true);
  });
  test('взвешенная сумма и конверсия', () => {
    expect(weightedAmount(800, 75)).toBe(600);
    expect(conversionPct(5, 6)).toBe(83.3);
    expect(conversionPct(1, 0)).toBeNull();
  });
});

describe('шаблоны воронок', () => {
  test('в каждом ровно один «выиграна» и хотя бы один «проиграна»', () => {
    for (const t of PIPELINE_TEMPLATES) {
      expect(t.stages.filter(s => s.category === 'won')).toHaveLength(1);
      expect(t.stages.filter(s => s.category === 'lost').length).toBeGreaterThanOrEqual(1);
    }
  });
  test('«квалифицирован» — второй открытый этап, а при одном открытом — первый', () => {
    expect(qualifiedStageIndex(PIPELINE_TEMPLATES[0]!.stages)).toBe(1);
    expect(qualifiedStageIndex([{ category: 'in_progress' }, { category: 'won' }, { category: 'lost' }])).toBe(0);
  });
});
