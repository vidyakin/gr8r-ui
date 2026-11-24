import { describe, expect, test } from 'bun:test';
import { generateEnterpriseData, icExportRequest, type EnterpriseDataDocument, type EnterpriseDataInput } from '../src/enterprise-data';

const options = { dateFrom: '2026-11-01', dateTo: '2026-11-30' };
const organization = { id: '58965531-e58c-4326-b369-4c498cb9de0a', name: 'A <>&"\'', inn: '1234567890', kind: 'legal' as const };
const company = { id: 'ea37db30-80d8-4ca2-beec-985123a5892e', name: 'Client' };
const product = { id: '961360a3-3ab2-4709-b34c-a661dd3c4c82', name: 'Product', kind: 'goods', unitCode: '796', vatRate: '20' };
const document: EnterpriseDataInput['documents'][number] = {
  id: 'ac9a6f66-9abd-4389-96fa-a4a2e17c3f8c', type: 'realization', number: '42', date: '2026-11-01',
  organizationId: organization.id, companyId: company.id, currency: 'RUB', total: '120.00', priceIncludesVat: true,
  lines: [{ productId: product.id, unitCode: '796', qty: '2', price: '60.00', net: '100.00', total: '120.00', vatRate: '20', vatAmount: '20.00' }],
};
const input: EnterpriseDataInput = {
  organizations: [organization], companies: [company], products: [product], contracts: [], warehouses: [], bankAccounts: [], documents: [document],
};

describe('EnterpriseData', () => {
  test('serializes the envelope, catalogs and posted-data lines with VAT', () => {
    const { xml, summary } = generateEnterpriseData(input, options);
    expect(xml).toContain('xmlns:msg="http://www.1c.ru/SSL/Exchange/Message"');
    expect(xml).toContain('xmlns:ed="http://v8.1c.ru/edi/edi_stnd/EnterpriseData/1.15"');
    expect(xml).toContain('<msg:Header>');
    expect(xml).toContain('<Body xmlns="http://v8.1c.ru/edi/edi_stnd/EnterpriseData/1.15">');
    expect(xml).toContain('<Справочник.Организации><КлючевыеСвойства>');
    expect(xml).toContain('<Документ.РеализацияТоваровУслуг>');
    expect(xml).toContain('<Товары><Строка>');
    expect(xml).toContain('<СтавкаНДС>НДС20</СтавкаНДС>');
    expect(xml).toContain('<СуммаНДС>20.00</СуммаНДС>');
    expect(xml).toContain('A &lt;&gt;&amp;&quot;&apos;');
    expect(summary.catalogs).toEqual({ organization: 1, company: 1, product: 1 });
    expect(summary.documents).toEqual({ realization: 1 });
    expect(summary.totalObjects).toBe(4);
    expect(summary.warnings).toEqual(['missing_inn:Client']);
    expect(generateEnterpriseData(input, options).xml).toBe(xml);
  });

  test('filters the inclusive period, organization and selected object types', () => {
    const { summary, xml } = generateEnterpriseData(input, {
      ...options, dateFrom: '2026-12-01', dateTo: '2026-12-31', includeCatalogs: false, version: '1.17',
    });
    expect(summary).toEqual({ catalogs: {}, documents: {}, totalObjects: 0, warnings: [] });
    expect(xml).toContain('<Body xmlns="http://v8.1c.ru/edi/edi_stnd/EnterpriseData/1.17">\n</Body>');
    expect(generateEnterpriseData(input, { ...options, dateTo: document.date }).summary.documents).toEqual({ realization: 1 });
    expect(generateEnterpriseData(input, { ...options, organizationId: company.id }).summary.documents).toEqual({});
    expect(generateEnterpriseData(input, { ...options, documentTypes: ['receipt'], catalogTypes: ['product'] }).summary.totalObjects).toBe(1);
  });

  test('uses matched GUIDs in both catalog objects and document references', () => {
    const refUuid = 'd0bee084-5765-422d-b0fd-63a678bafb49';
    const { xml } = generateEnterpriseData({ ...input, organizations: [{ ...organization, refUuid }] }, options);
    expect(xml.match(new RegExp(refUuid, 'g'))).toHaveLength(2);
    expect(xml).not.toContain(organization.id);
  });
});

test('exports the payment operations that map to bank statements and cash orders in 1C', () => {
  const bankAccount = { id: 'b2e3e9da-daa3-4355-8b5c-1f22e661ef96', name: 'Bank', bik: '044525000', account: '40702810000000000001', bankName: 'Bank', organizationId: organization.id };
  const cashRegister = { id: '15724dc8-861d-44c3-8e85-c40bd59c946d', name: 'Cash desk' };
  const payment = { ...document, lines: undefined, paymentLines: [{ amount: '120.00' }] };
  const documents: EnterpriseDataDocument[] = [
    { ...payment, type: 'bank_receipt', operation: 'from_customer', bankAccountId: bankAccount.id },
    { ...payment, type: 'bank_payment', operation: 'to_supplier', bankAccountId: bankAccount.id },
    { ...payment, type: 'cash_receipt', operation: 'from_customer', cashRegister },
    { ...payment, type: 'cash_payment', operation: 'other_expense', cashRegister },
    { ...payment, type: 'advance_report', companyId: null, accountable: { id: '61ebd615-4b41-4461-9011-c2c6d0f2e441', name: 'Employee' }, paymentLines: [{ amount: '120.00', comment: 'Taxi <receipt>' }] },
  ];
  const { xml, summary } = generateEnterpriseData({
    ...input,
    bankAccounts: [bankAccount],
    warehouses: [{ id: '64a6dd75-6d57-4772-9910-ff7b8cbf8aef', name: 'Warehouse' }],
    contracts: [{ id: '87b183f3-408f-4727-ada3-ae283c83cd3f', name: 'Contract', number: 'RD1', date: '2026-11-01', currency: 'RUB', kind: 'customer', companyId: company.id, organizationId: organization.id }],
    documents: documents.map((row, i) => ({ ...row, id: `ac9a6f66-9abd-4389-96fa-a4a2e17c3f8${i}` })),
  }, options);
  expect(summary.totalObjects).toBe(11);
  expect(summary.documents).toEqual({ bank_receipt: 1, bank_payment: 1, cash_receipt: 1, cash_payment: 1, advance_report: 1 });
  expect(xml).toContain('<Справочник.Договоры>');
  expect(xml).toContain('<Номер>RD1</Номер>');
  expect(xml).toContain('<Справочник.Склады>');
  expect(xml).toContain('<Справочник.БанковскиеСчета>');
  expect(xml).toContain('<БИК>044525000</БИК>');
  expect(xml).toContain('<Документ.ПБДСРасчетыСКонтрагентами>');
  expect(xml).toContain('<Документ.СБДСРасчетыСКонтрагентами>');
  expect(xml).toContain('<Документ.ПКОРасчетыСКонтрагентами>');
  expect(xml).toContain('<Документ.РКОПрочаяВыдача>');
  expect(xml).toContain('<Документ.АвансовыйОтчет>');
  expect(xml).toContain('<РасшифровкаПлатежа><Строка>');
  expect(xml).toContain('<ФИО>Employee</ФИО>');
  expect(xml).toContain('<Содержание>Taxi &lt;receipt&gt;</Содержание>');
});

test('supports structured VAT rates in 1.17 and warns about reduced rates in 1.15', () => {
  const data = { ...input, products: [{ ...product, vatRate: '7' }], documents: [] };
  const modern = generateEnterpriseData(data, { ...options, version: '1.17' });
  expect(modern.xml).toContain('<СтавкаНДС><Ставка>7</Ставка>');
  expect(modern.xml).toContain('<ВидСтавки>Пониженная</ВидСтавки>');
  expect(modern.summary.warnings).not.toContain('legacy_vat');
  expect(generateEnterpriseData(data, options).summary.warnings).toContain('legacy_vat');
});

test('validates real dates and rejects reversed periods', () => {
  expect(icExportRequest.safeParse(options).success).toBe(true);
  expect(icExportRequest.safeParse({ ...options, dateFrom: '2026-11-31' }).success).toBe(false);
  expect(icExportRequest.safeParse({ ...options, dateFrom: '0000-01-01' }).success).toBe(false);
  expect(icExportRequest.safeParse({ ...options, dateTo: '2026-10-31' }).success).toBe(false);
});
