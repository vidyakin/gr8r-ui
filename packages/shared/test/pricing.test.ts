import { describe, expect, test } from 'bun:test';
import { applyMarkup, changeByPercent, convertPriceVatBase, dec, hasKindCycle, parsePriceCell, pickPriceKind, priceStr, roundPrice } from '../src';

const r = (step: string, mode: 'math' | 'up' = 'math', nine = false) => ({ step, mode, nine });

describe('округление цены', () => {
  test('по математике и вверх', () => {
    expect(priceStr(roundPrice(dec('123.456'), r('0.01')))).toBe('123.46');
    expect(priceStr(roundPrice(dec('123.4'), r('1')))).toBe('123.00');
    expect(priceStr(roundPrice(dec('123.5'), r('1')))).toBe('124.00');
    expect(priceStr(roundPrice(dec('123.01'), r('1', 'up')))).toBe('124.00');
    expect(priceStr(roundPrice(dec('123'), r('10', 'up')))).toBe('130.00');
    expect(priceStr(roundPrice(dec('149'), r('100')))).toBe('100.00');
  });
  test('«до 9»', () => {
    expect(priceStr(roundPrice(dec('150'), r('100', 'math', true)))).toBe('199.00');
    expect(priceStr(roundPrice(dec('120'), r('10', 'up', true)))).toBe('119.00');
    expect(priceStr(roundPrice(dec('84'), r('100', 'math', true)))).toBe('99.00');
    // при шаге 1 флаг не действует
    expect(priceStr(roundPrice(dec('84'), r('1', 'math', true)))).toBe('84.00');
  });
});

describe('наценка и скидка', () => {
  test('оптовая = розничная − 15 % с округлением до 1', () => {
    expect(priceStr(applyMarkup(dec('1000'), '-15', r('1')))).toBe('850.00');
    expect(priceStr(applyMarkup(dec('333'), '-15', r('1')))).toBe('283.00');
  });
  test('себестоимость + 25 %', () => {
    expect(changeByPercent('80', '25', r('0.01'))).toBe('100.00');
    expect(priceStr(applyMarkup(dec('0'), '25', r('1')))).toBe('0.00');
  });
});

describe('выбор вида цен', () => {
  const base = { retailKindId: 'R', purchaseKindId: 'P' };
  test('приоритет покупателя', () => {
    expect(pickPriceKind({ ...base, party: 'customer' })).toEqual({ kindId: 'R', source: 'default' });
    expect(pickPriceKind({ ...base, party: 'customer', workOrderKindId: 'W' }).kindId).toBe('W');
    expect(pickPriceKind({ ...base, party: 'customer', workOrderKindId: 'W', companyKindId: 'C' }).kindId).toBe('C');
    expect(pickPriceKind({ ...base, party: 'customer', companyKindId: 'C', contractKindId: 'K' }).kindId).toBe('K');
    expect(pickPriceKind({ ...base, party: 'customer', companyKindId: 'C', contractKindId: 'K', headerKindId: 'H' }).kindId).toBe('H');
  });
  test('закупка: вид поставщика, иначе закупочная', () => {
    expect(pickPriceKind({ ...base, party: 'supplier' }).kindId).toBe('P');
    expect(pickPriceKind({ ...base, party: 'supplier', supplierKindId: 'S', companyKindId: 'C' }).kindId).toBe('S');
  });
});

test('цикл расчётных видов', () => {
  const m: Record<string, string> = { a: 'b', b: 'c', c: 'a' };
  expect(hasKindCycle('a', id => m[id])).toBe(true);
  expect(hasKindCycle('x', id => ({ x: 'y' })[id])).toBe(false);
});

describe('convertPriceVatBase: приведение к базе вида цен', () => {
  test('базы совпадают — цена как есть, даже при ставке none', () => {
    expect(convertPriceVatBase('120', true, true, '20')).toBe('120.00');
    expect(convertPriceVatBase('100.5', false, false, 'none')).toBe('100.50');
  });
  test('с НДС → без НДС', () => {
    expect(convertPriceVatBase('120', true, false, '20')).toBe('100.00');
    expect(convertPriceVatBase('110', true, false, '10')).toBe('100.00');
    expect(convertPriceVatBase('100', true, false, '20')).toBe('83.33');
    expect(convertPriceVatBase('50', true, false, '0')).toBe('50.00');
  });
  test('без НДС → с НДС', () => {
    expect(convertPriceVatBase('100', false, true, '20')).toBe('120.00');
    expect(convertPriceVatBase('99.99', false, true, '20')).toBe('119.99');
    expect(convertPriceVatBase('10.05', false, true, '5')).toBe('10.55');
  });
  test('ставка none при разных базах — привести нельзя', () => {
    expect(convertPriceVatBase('100', true, false, 'none')).toBeNull();
    expect(convertPriceVatBase('100', false, true, 'none')).toBeNull();
  });
});

describe('parsePriceCell — ячейка цены из файла поставщика', () => {
  test('длинная дробь из Excel округляется до копеек, запятая и пробелы', () => {
    expect(parsePriceCell('1384.4508196720001')).toBe('1384.45');
    expect(parsePriceCell('1 234,50')).toBe('1234.50');
  });
  test('экспоненциальная запись XLSX', () => {
    expect(parsePriceCell('1.2E3')).toBe('1200.00');
    expect(parsePriceCell('5E-2')).toBe('0.05');
  });
  test('текст вместо цены — не цена', () => {
    expect(parsePriceCell('Цена по запросу')).toBeNull();
  });
});
