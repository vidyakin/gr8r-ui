/* Печатная форма «Заказ поставщику»: артикул и наименование у поставщика, наш код у него. Без БД. */
import { describe, expect, test } from 'bun:test';
import { renderPrintForm, type PrintData } from '../src';

const base = {
  type: 'supplier_order',
  number: 'ЗС-1',
  date: '2026-11-08',
  dueDate: null,
  priceIncludesVat: false,
  organization: { name: 'Наша', fullName: 'Наша', inn: '', kpp: '', ogrn: '', address: '', phone: '', bank: null, kind: 'legal', directorName: '', directorTitle: '', accountantName: '', taxSystem: 'osn', stampFile: null, directorSignatureFile: null, accountantSignatureFile: null },
  party: { name: 'Поставщик', fullName: 'Поставщик', inn: '', kpp: '', ogrn: '', address: '', phone: '', bank: null },
  lines: [{ n: 1, sku: 'S1', name: 'Брус', unitCode: '006', unitSymbol: 'м', qty: '2.000', price: '80.00', discountPct: '0', vatRate: '20', net: '160.00', vatAmount: '32.00', total: '192.00', partnerArticle: 'BR-50', partnerName: 'Брус 50x50' }],
  totals: { net: '160.00', vat: '32.00', total: '192.00' },
  basedOn: null,
  comment: '',
  ourCode: 'CL-777',
} as unknown as PrintData;

describe('supplier_order print', () => {
  test('показывает артикул, наименование поставщика и наш код', () => {
    const html = renderPrintForm('supplier_order', base);
    expect(html).toContain('Заказ поставщику');
    expect(html).toContain('BR-50');
    expect(html).toContain('Брус 50x50');
    expect(html).toContain('CL-777');
  });
  test('без кода строки нет', () => {
    expect(renderPrintForm('supplier_order', { ...base, ourCode: undefined })).not.toContain('Наш код у поставщика');
  });
});
