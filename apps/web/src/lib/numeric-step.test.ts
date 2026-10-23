import { describe, expect, test } from 'bun:test';
import { stepNumeric } from './numeric-step';

describe('stepNumeric', () => {
  test('steps by 1, with Shift by 10', () => {
    expect(stepNumeric('5', 1)).toBe('6');
    expect(stepNumeric('5', -1)).toBe('4');
    expect(stepNumeric('5', 1, true)).toBe('15');
  });
  test('keeps the fraction and the separator', () => {
    expect(stepNumeric('2.5', 1)).toBe('3.5');
    expect(stepNumeric('1,250', 1)).toBe('2,250');
    expect(stepNumeric('10.00', -1)).toBe('9.00');
  });
  test('does not go below zero', () => {
    expect(stepNumeric('0.5', -1)).toBe('0.0');
    expect(stepNumeric('3', -1, true)).toBe('0');
  });
  test('an empty field starts from zero, text is left alone', () => {
    expect(stepNumeric('', 1)).toBe('1');
    expect(stepNumeric('abc', 1)).toBeNull();
    expect(stepNumeric('1e3', 1)).toBeNull();
  });
});
