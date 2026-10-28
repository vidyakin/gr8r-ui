import { describe, expect, test } from 'bun:test';
import { advanceFor, insuranceOf, lineMoves, ndflOf, percentAmount, periodEndOf, salaryByDays, salaryRegistryCsv } from '../src/payroll';

describe('расчёты зарплаты', () => {
  test('оклад пропорционален отработанным дням', () => {
    expect(salaryByDays('100000', 17, 22)).toBe('77272.73');
    expect(salaryByDays('100000', 22, 22)).toBe('100000.00');
    expect(salaryByDays('100000', 30, 22)).toBe('100000.00');
    expect(salaryByDays('100000', 0, 22)).toBe('0.00');
    expect(salaryByDays('100000', 5, 0)).toBe('0.00');
  });
  test('НДФЛ, взносы, процент', () => {
    expect(ndflOf('77272.73', '13')).toBe('10045.45');
    expect(insuranceOf('1000', '30', true)).toBe('300.00');
    expect(insuranceOf('1000', '30', false)).toBe('0.00');
    expect(percentAmount('20000', '5')).toBe('1000.00');
    expect(percentAmount('-5', '5')).toBe('0.00');
  });
  test('аванс: сумма приоритетнее процента', () => {
    expect(advanceFor('100000', null, '40')).toBe('40000.00');
    expect(advanceFor('100000', '15000', '40')).toBe('15000.00');
    expect(advanceFor(null, null, '40')).toBe('0.00');
  });
  test('движения строки и конец месяца', () => {
    expect(lineMoves({ amount: '1000', ndfl: '130', deduction: false })).toEqual([
      { kind: 'accrual', amount: '1000.00' },
      { kind: 'ndfl', amount: '-130.00' },
    ]);
    expect(lineMoves({ amount: '500', ndfl: '0', deduction: true })).toEqual([{ kind: 'deduction', amount: '-500.00' }]);
    expect(periodEndOf('2026-02-01')).toBe('2026-02-28');
    expect(salaryRegistryCsv([{ name: 'Иванов; И.', account: '4081', amount: '10.00' }])).toBe('ФИО;Счёт;Сумма\r\n"Иванов; И.";4081;10.00\r\n');
  });
});
