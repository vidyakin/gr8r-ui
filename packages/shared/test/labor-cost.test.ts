/* Стоимость часа рабочего для табеля прораба (задача 1271): почасовая ставка или оклад / норма часов месяца,
   плюс страховые взносы; нет ни ставки, ни оклада — стоимости нет (null, не ноль). Деньги — без float.
   Код бейджа: 'W' + 8 символов base32 без 0/O и 1/I, код для сравнения — без пробелов и в верхнем регистре. */
import { describe, expect, test } from 'bun:test';
import { badgeCode, BADGE_CODE_ALPHABET, laborCostAmount, laborHourCost, monthNormHours, normalizeBadgeCode } from '@gr8r/shared';

describe('норма часов месяца', () => {
  test('рабочие дни × часы в день графика', () => {
    expect(monthNormHours(21, '8')).toBe('168.00');
    expect(monthNormHours(15, '11.5')).toBe('172.50');
    // считать нечего: нет рабочих дней или нулевой день
    expect(monthNormHours(0, '8')).toBe('0.00');
    expect(monthNormHours(21, '0')).toBe('0.00');
  });
});

describe('стоимость часа', () => {
  test('почасовая ставка важнее оклада, сверху страховые взносы', () => {
    const c = laborHourCost({ hourlyRate: '650', salary: '45000', monthNormHours: '168.00', insuranceRate: '30' });
    expect(c.source).toBe('hourly');
    expect(c.gross).toBe('650.00');
    // 650 × 1,3 = 845
    expect(c.rate).toBe('845.00');
  });

  test('оклад / норма часов месяца, плюс взносы; округление до копейки', () => {
    const c = laborHourCost({ hourlyRate: null, salary: '45000', monthNormHours: '168.00', insuranceRate: '30' });
    expect(c.source).toBe('salary');
    // 45 000 / 168 = 267,857142… → 267,86; × 1,3 = 348,21 (округление от точной базы, не от копейки)
    expect(c.gross).toBe('267.86');
    expect(c.rate).toBe('348.21');
  });

  test('нулевая ставка взносов оставляет ставку часа как есть', () => {
    expect(laborHourCost({ hourlyRate: '500', insuranceRate: '0' }).rate).toBe('500.00');
  });

  test('нет ни ставки, ни оклада (или норма нулевая) — стоимости нет, а не ноль', () => {
    expect(laborHourCost({ hourlyRate: null, salary: null, monthNormHours: '168.00', insuranceRate: '30' })).toEqual({
      source: null,
      gross: null,
      rate: null,
      monthNormHours: '168.00',
    });
    // оклад есть, а нормы часов нет — считать нечего
    expect(laborHourCost({ salary: '45000', monthNormHours: '0.00', insuranceRate: '30' }).rate).toBeNull();
    expect(laborHourCost({ hourlyRate: '0', salary: '45000', monthNormHours: '168.00', insuranceRate: '30' }).source).toBe('salary');
  });
});

describe('сумма строки табеля', () => {
  test('часы × стоимость часа до копейки', () => {
    expect(laborCostAmount('8', '348.21')).toBe('2785.68');
    expect(laborCostAmount('4.5', '845')).toBe('3802.50');
  });

  test('нет стоимости часа — нет суммы (пробел, не ноль)', () => {
    expect(laborCostAmount('8', null)).toBeNull();
    expect(laborCostAmount('8', '')).toBeNull();
  });
});

describe('код бейджа', () => {
  test('W и 8 символов base32 без 0/O и 1/I', () => {
    const code = badgeCode(() => 0.5);
    expect(code).toHaveLength(9);
    expect(code.startsWith('W')).toBe(true);
    expect(/^[A-Z2-9]{8}$/.test(code.slice(1))).toBe(true);
    expect(/[0O1I]/.test(code.slice(1))).toBe(false);
  });

  test('все символы — из алфавита, коды разные при разных случайных числах', () => {
    const alphabet = new Set(BADGE_CODE_ALPHABET.split(''));
    expect(BADGE_CODE_ALPHABET).toHaveLength(32);
    for (const c of badgeCode().slice(1)) expect(alphabet.has(c)).toBe(true);
    expect(badgeCode(() => 0)).not.toBe(badgeCode(() => 0.99));
  });

  test('код для сравнения: без пробелов, в верхнем регистре', () => {
    expect(normalizeBadgeCode('  wab3 4cd5 ')).toBe('WAB34CD5');
  });
});
