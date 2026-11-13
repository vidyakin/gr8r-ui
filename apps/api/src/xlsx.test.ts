/* Чтение таблиц прайсов: XLSX с картинками (много файлов в архиве), старый XLS, CSV в Windows-1251, лимит строк */
import { describe, expect, test } from 'bun:test';
import { buildXlsx, readTable, XlsxError, zipRead, zipStore } from './xlsx';

const enc = new TextEncoder();

describe('readTable', () => {
  test('XLSX с тысячей картинок читается: картинки не распаковываются и не считаются в лимит', () => {
    const book = zipRead(buildXlsx('Прайс', [['Артикул', 'Цена'], ['A-1', 10]]), () => true);
    const media = Array.from({ length: 1000 }, (_, i) => ({ name: `xl/media/image${i}.png`, data: new Uint8Array(50 * 1024) }));
    const bytes = zipStore([...[...book].map(([name, data]) => ({ name, data })), ...media]);
    expect(readTable('price.xlsx', bytes)).toEqual([['Артикул', 'Цена'], ['A-1', '10']]);
  });

  test('старый XLS — понятная ошибка', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(() => readTable('price.xls', ole)).toThrow(XlsxError);
  });

  test('CSV в Windows-1251 читается кириллицей', () => {
    // «Болт;12,5» в cp1251
    const cp1251 = new Uint8Array([0xc1, 0xee, 0xeb, 0xf2, 0x3b, 0x31, 0x32, 0x2c, 0x35]);
    expect(readTable('price.csv', cp1251)).toEqual([['Болт', '12,5']]);
  });

  test('CSV в UTF-8 не меняется', () => {
    expect(readTable('price.csv', enc.encode('Болт;12,5\n'))).toEqual([['Болт', '12,5']]);
  });

  test('лимит строк: по умолчанию 20 000, для прайса можно больше', () => {
    const csv = enc.encode(Array.from({ length: 25000 }, (_, i) => `A${i};${i}`).join('\n'));
    expect(readTable('p.csv', csv).length).toBe(20000);
    expect(readTable('p.csv', csv, { maxRows: 300000 }).length).toBe(25000);
  });
});
