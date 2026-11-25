import { expect, test } from 'bun:test';
import { documentLineInput, renderPrintForm, warehouseBinCreate, warehouseBinUpdate, type PrintData } from '../src';

const id = '018f0000-0000-7000-8000-000000000001';
const line = { productId: id, qty: '1', price: '100' };

test('warehouse bins require a code and accept optional hierarchy fields', () => {
  expect(warehouseBinCreate.parse({ code: ' A-01-02 ', parentId: id, zone: 'A', rack: '01', shelf: '02' }))
    .toMatchObject({ code: 'A-01-02', parentId: id, active: true });
  expect(warehouseBinCreate.safeParse({ code: '  ' }).success).toBe(false);
  expect(warehouseBinUpdate.safeParse({ parentId: 'other' }).success).toBe(false);
  expect(warehouseBinUpdate.parse({ parentId: null })).toEqual({ parentId: null });
});

test('document lines accept optional bins, customs declaration and country', () => {
  expect(documentLineInput.parse(line)).not.toHaveProperty('binId');
  expect(documentLineInput.parse({ ...line, binId: id, toBinId: null, gtdNumber: ' 10005030/250326/0000123 ', originCountry: 'cn' }))
    .toMatchObject({ binId: id, toBinId: null, gtdNumber: '10005030/250326/0000123', originCountry: 'CN' });
  expect(documentLineInput.safeParse({ ...line, originCountry: 'Китай (156)' }).success).toBe(true);
  expect(documentLineInput.safeParse({ ...line, originCountry: 'XX' }).success).toBe(false);
  expect(documentLineInput.safeParse({ ...line, originCountry: 'Китай' }).success).toBe(false);
  expect(documentLineInput.safeParse({ ...line, gtdNumber: '12\n34' }).success).toBe(false);
  expect(documentLineInput.safeParse({ ...line, toBinId: 'bad' }).success).toBe(false);
});

const party = { name: 'Organisation', fullName: '', inn: '', kpp: '', ogrn: '', address: '', phone: '', bank: null };
const data: PrintData = {
  type: 'realization', number: 'РТ-1', date: '2026-03-25', dueDate: null, comment: '', basedOn: null,
  priceIncludesVat: false, party,
  organization: { ...party, kind: 'legal', taxSystem: 'osn', directorName: '', directorTitle: '', accountantName: '', stampFile: null, directorSignatureFile: null, accountantSignatureFile: null },
  lines: [{ n: 1, name: 'Товар', sku: '', unitCode: '796', unitSymbol: 'шт', qty: '1', price: '100', discountPct: '0', vatRate: '20', net: '100', vatAmount: '20', total: '120' }],
  totals: { net: '100', vat: '20', total: '120', byRate: [] },
};

for (const form of ['upd', 'vat_invoice'] as const) {
  test(`${form} prints country and customs declaration in columns 10, 10а, 11`, () => {
    const first = data.lines[0]!;
    const html = renderPrintForm(form, { ...data, lines: [
      { ...first, originCountry: 'CN', gtdNumber: '10005030/250326/0000123' },
      { ...first, n: 2, originCountry: 'Китай (156)', gtdNumber: '<test>' },
      { ...first, n: 3 },
    ] });
    expect(html).toContain('<td class="center">156</td><td class="center">Китай</td><td class="center">10005030/250326/0000123</td>');
    expect(html).toContain('<td class="center">156</td><td class="center">Китай</td><td class="center">&lt;test&gt;</td>');
    expect(html).toContain('<td class="center">—</td><td class="center">—</td><td class="center">—</td>');
    expect(html).toContain('<th>10</th><th>10а</th><th>11</th>');
    expect(html.includes('Универсальный передаточный документ')).toBe(form === 'upd');
  });
}
