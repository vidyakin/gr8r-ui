import { afterEach, describe, expect, test } from 'bun:test';
import { fmtAmount, fmtDateTimeIntl, hasKey, parseNumber, resolveLocale, setLocale, t, tEnum } from '.';

afterEach(() => setLocale('en'));

describe('i18n', () => {
  test('t: подстановки и запасной английский', () => {
    setLocale('en');
    expect(t('catalog.noProductsIn', { name: 'Tables' })).toBe('No products in Tables');
    setLocale('ru');
    expect(t('catalog.noProductsIn', { name: 'Столы' })).toBe('В категории «Столы» пока пусто');
    expect(t('nonexistent.key' as never)).toBe('nonexistent.key');
  });

  test('t: множественное число по правилам языка', () => {
    setLocale('en');
    expect([1, 2].map(count => t('catalog.summary', { count }))).toEqual(['1 item', '2 items']);
    setLocale('ru');
    expect([1, 3, 5, 21].map(count => t('catalog.summary', { count }))).toEqual(['1 позиция', '3 позиции', '5 позиций', '21 позиция']);
  });

  test('tEnum и hasKey: перевод подписей из shared с запасным вариантом', () => {
    setLocale('ru');
    expect(tEnum('vat', 'none', 'No VAT')).toBe('Без НДС');
    expect(tEnum('vat', '20', '20%')).toBe('20%');
    expect(hasKey('errors.not_found')).toBe(true);
    expect(hasKey('errors.no_such_code')).toBe(false);
  });

  test('форматирование по языку', () => {
    setLocale('en');
    expect(fmtAmount('1234.5')).toBe('1,234.50');
    expect(fmtDateTimeIntl(new Date(2026, 9, 30), { month: 'short', day: 'numeric' })).toBe('Oct 30');
    setLocale('ru');
    expect(fmtAmount('1234.5').replace(/\s/g, ' ')).toBe('1 234,50');
  });

  test('parseNumber: ввод по правилам языка', () => {
    setLocale('en');
    expect(parseNumber('50,000')).toBe(50000);
    expect(parseNumber('$1,234.5')).toBe(1234.5);
    setLocale('ru');
    expect(parseNumber('50 000,5')).toBe(50000.5);
    expect(parseNumber(fmtAmount(1234.5))).toBe(1234.5);
  });

  test('resolveLocale: личный язык важнее языка воркспейса', () => {
    expect(resolveLocale('ru', 'en')).toBe('ru');
    expect(resolveLocale(null, 'ru')).toBe('ru');
    expect(resolveLocale('de', 'en')).toBe('en');
  });
});
