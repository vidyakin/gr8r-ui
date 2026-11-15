import { expect, test } from 'bun:test';
import { sanitizeMoney } from './money-input';

test('sanitizeMoney: только цифры, один разделитель, два знака', () => {
  expect(sanitizeMoney('1 250,50')).toBe('1250,50');
  expect(sanitizeMoney('12abc3')).toBe('123');
  expect(sanitizeMoney('1.2.3')).toBe('1.23');
  expect(sanitizeMoney('10,999')).toBe('10,99');
  expect(sanitizeMoney('-5')).toBe('5');
  expect(sanitizeMoney('')).toBe('');
});
