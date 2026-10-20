import { describe, expect, test } from 'bun:test';
import { accountKeyOk, amountInWordsRu, isValidAccount, isValidBik, isValidInn, isValidKpp, isValidOgrn, makeInn, makeOgrn, numberToWordsRu, pluralRu, validateRequisites } from '../src';

describe('INN', () => {
  test('10-digit checksum', () => {
    expect(isValidInn('7707083893')).toBe(true); // ПАО Сбербанк
    expect(isValidInn('7728168971')).toBe(true); // Альфа-Банк
    expect(isValidInn('7707083894')).toBe(false);
    expect(isValidInn('7707083883')).toBe(false);
  });
  test('12-digit checksum (both control digits)', () => {
    expect(isValidInn('500100732259')).toBe(true);
    expect(isValidInn('500100732258')).toBe(false);
    expect(isValidInn('500100732269')).toBe(false); // верна только вторая цифра
    expect(isValidInn('770100732259')).toBe(false);
  });
  test('format', () => {
    for (const bad of ['', '123', '12345678901', '77070838930', 'abcdefghij', '770708389a']) expect(isValidInn(bad)).toBe(false);
  });
  test('makeInn completes control digits', () => {
    expect(makeInn('770708389')).toBe('7707083893');
    expect(isValidInn(makeInn('5001007322'))).toBe(true);
    for (let i = 0; i < 50; i++) expect(isValidInn(makeInn(String(100000000 + i * 7919)))).toBe(true);
    expect(() => makeInn('12')).toThrow();
  });
});

describe('KPP, OGRN, bank', () => {
  test('KPP', () => {
    expect(isValidKpp('770701001')).toBe(true);
    expect(isValidKpp('7707ab001')).toBe(false);
    expect(isValidKpp('77070A001')).toBe(true);
    expect(isValidKpp('77070100')).toBe(false);
  });
  test('OGRN 13 and OGRNIP 15', () => {
    expect(isValidOgrn('1027700132195')).toBe(true); // Сбербанк
    expect(isValidOgrn('1027700132196')).toBe(false);
    expect(isValidOgrn('304500116000157')).toBe(true);
    expect(isValidOgrn('304500116000158')).toBe(false);
    expect(makeOgrn('102770013219')).toBe('1027700132195');
    expect(isValidOgrn(makeOgrn('30450011600015'))).toBe(true);
  });
  test('BIK and accounts', () => {
    expect(isValidBik('044525225')).toBe(true);
    expect(isValidBik('144525225')).toBe(false);
    expect(isValidAccount('40702810400000000001')).toBe(true);
    expect(isValidAccount('4070281040000000001')).toBe(false);
  });
  test('account control key: exactly one key digit fits the BIK', () => {
    const fits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(k => accountKeyOk('044525225', `40702810${k}00000000001`));
    expect(fits.length).toBe(1);
    const corr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(k => accountKeyOk('044525225', `3010181${k}400000000225`, true));
    expect(corr.length).toBe(1);
  });
});

describe('validateRequisites', () => {
  test('legal entity needs 10-digit INN, KPP allowed', () => {
    expect(validateRequisites({ kind: 'legal', inn: '7707083893', kpp: '770701001', ogrn: '1027700132195' })).toEqual({});
    expect(validateRequisites({ kind: 'legal', inn: '500100732259' }).inn).toContain('10 digits');
    expect(validateRequisites({ kind: 'legal', inn: '7707083894' }).inn).toContain('checksum');
    expect(validateRequisites({ kind: 'legal', ogrn: '304500116000157' }).ogrn).toContain('13 digits');
  });
  test('sole proprietor: 12-digit INN, OGRNIP, no KPP', () => {
    expect(validateRequisites({ kind: 'sole_proprietor', inn: '500100732259', ogrn: '304500116000157' })).toEqual({});
    expect(validateRequisites({ kind: 'sole_proprietor', inn: '7707083893' }).inn).toContain('12 digits');
    expect(validateRequisites({ kind: 'sole_proprietor', kpp: '770701001' }).kpp).toBeTruthy();
    expect(validateRequisites({ kind: 'sole_proprietor', ogrn: '1027700132195' }).ogrn).toContain('15 digits');
  });
  test('individual: 12-digit INN only; empty values are fine', () => {
    expect(validateRequisites({ kind: 'individual', inn: '500100732259' })).toEqual({});
    expect(validateRequisites({ kind: 'individual', ogrn: '304500116000157' }).ogrn).toBeTruthy();
    expect(validateRequisites({ kind: 'legal', inn: '', kpp: '', ogrn: '' })).toEqual({});
  });
});

describe('amount in words', () => {
  test('plural forms', () => {
    const f = ['рубль', 'рубля', 'рублей'] as const;
    expect(pluralRu(1, f)).toBe('рубль');
    expect(pluralRu(2, f)).toBe('рубля');
    expect(pluralRu(5, f)).toBe('рублей');
    expect(pluralRu(11, f)).toBe('рублей');
    expect(pluralRu(14, f)).toBe('рублей');
    expect(pluralRu(21, f)).toBe('рубль');
    expect(pluralRu(111, f)).toBe('рублей');
    expect(pluralRu(122, f)).toBe('рубля');
  });
  test('numbers', () => {
    expect(numberToWordsRu(0)).toBe('ноль');
    expect(numberToWordsRu(21)).toBe('двадцать один');
    expect(numberToWordsRu(2, 'f')).toBe('две');
    expect(numberToWordsRu(1000)).toBe('одна тысяча');
    expect(numberToWordsRu(2000)).toBe('две тысячи');
    expect(numberToWordsRu(5000)).toBe('пять тысяч');
    expect(numberToWordsRu(11000)).toBe('одиннадцать тысяч');
    expect(numberToWordsRu(21001)).toBe('двадцать одна тысяча один');
    expect(numberToWordsRu(112345)).toBe('сто двенадцать тысяч триста сорок пять');
    expect(numberToWordsRu(1_000_000)).toBe('один миллион');
    expect(numberToWordsRu(2_000_002)).toBe('два миллиона два');
    expect(numberToWordsRu(1_000_000_000_000n)).toBe('один триллион');
    expect(numberToWordsRu(-15)).toBe('минус пятнадцать');
    expect(numberToWordsRu(999_999_999)).toBe('девятьсот девяносто девять миллионов девятьсот девяносто девять тысяч девятьсот девяносто девять');
  });
  test('amounts with kopecks', () => {
    expect(amountInWordsRu('0')).toBe('Ноль рублей 00 копеек');
    expect(amountInWordsRu('1')).toBe('Один рубль 00 копеек');
    expect(amountInWordsRu('123.45')).toBe('Сто двадцать три рубля 45 копеек');
    expect(amountInWordsRu('1000.01')).toBe('Одна тысяча рублей 01 копейка');
    expect(amountInWordsRu('2002.02')).toBe('Две тысячи два рубля 02 копейки');
    expect(amountInWordsRu('11.11')).toBe('Одиннадцать рублей 11 копеек');
    expect(amountInWordsRu('1234567.89')).toBe('Один миллион двести тридцать четыре тысячи пятьсот шестьдесят семь рублей 89 копеек');
    expect(amountInWordsRu(0.5)).toBe('Ноль рублей 50 копеек');
    expect(amountInWordsRu('.07')).toBe('Ноль рублей 07 копеек');
  });
  test('rounding to kopecks and negatives', () => {
    expect(amountInWordsRu('10.005')).toBe('Десять рублей 01 копейка');
    expect(amountInWordsRu('10.994')).toBe('Десять рублей 99 копеек');
    expect(amountInWordsRu('10.995')).toBe('Одиннадцать рублей 00 копеек');
    expect(amountInWordsRu('-5.50')).toBe('Минус пять рублей 50 копеек');
    expect(() => amountInWordsRu('abc')).toThrow();
  });
});
