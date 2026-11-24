import { describe, expect, test } from 'bun:test';
import { generateEnterpriseData as buildEnterpriseDataXml, type EnterpriseDataInput } from '../src/enterprise-data';
import { ENTERPRISE_DATA_MAX_BYTES, parseEnterpriseDataXml } from '../src/enterprise-data-parse';

const guid = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const [organization, company, contract, product, warehouse, bank, cash] = Array.from({ length: 7 }, (_, index) => guid(index + 1));
const day = '2026-11-24';
const namespace = (version = '1.17') => `http://v8.1c.ru/edi/edi_stnd/EnterpriseData/${version}`;
const ref = (id: string) => `<Ссылка>${id}</Ссылка>`;
const link = (tag: string, id: string) => `<${tag}>${ref(id)}</${tag}>`;
const xml = (body: string, version = '1.17') =>
  `<?xml version="1.0" encoding="UTF-8"?><m:Message xmlns:m="http://www.1c.ru/SSL/Exchange/Message"><m:Body xmlns="${namespace(version)}">${body}</m:Body></m:Message>`;

describe('parseEnterpriseDataXml', () => {
  for (const version of ['1.15', '1.17'] as const) {
    test(`round trip with the FutureERP exporter (${version})`, () => {
      const data: EnterpriseDataInput = {
        organizations: [{ id: organization, name: 'А & Б <ООО>', inn: '1234567890', kpp: '123456789', ogrn: '1234567890123' }],
        companies: [{ id: company, name: 'ИП Иванов', kind: 'sole_proprietor', ogrn: '123456789012345' }],
        contracts: [{ id: contract, name: 'Основной', date: day, number: 'C-100', currency: 'RUB', kind: 'supplier', organizationId: organization, companyId: company }],
        products: [{ id: product, name: 'Товар', kind: 'goods', sku: 'A-10', unitCode: '796', vatRate: 'none' }],
        warehouses: [{ id: warehouse, name: 'Основной склад' }],
        bankAccounts: [{ id: bank, organizationId: organization, name: 'Счёт', bik: '044525225', account: '40702810000000000001', bankName: 'Банк', currency: 'RUB' }],
        documents: (['realization', 'receipt', 'bank_receipt', 'bank_payment', 'cash_receipt', 'cash_payment', 'advance_report'] as const).map((type, index) => ({
          id: guid(20 + index), type, number: `БП-${index + 1}`, date: day, organizationId: organization, companyId: company,
          bankAccountId: bank, cashRegister: { id: cash, name: 'Основная касса' }, currency: 'RUB', total: '120.00', priceIncludesVat: true,
        })),
      };
      const exported = buildEnterpriseDataXml(data, { version, dateFrom: day, dateTo: day });
      const parsed = parseEnterpriseDataXml(new TextEncoder().encode(exported.xml));
      expect(parsed.version).toBe(version);
      expect(parsed.issues).toEqual([]);
      expect(parsed.balances).toEqual([]);
      expect(parsed.catalogs).toHaveLength(6);
      expect(parsed.catalogs.find(row => row.type === 'organization')).toMatchObject({
        refUuid: organization, name: 'А & Б <ООО>', inn: '1234567890', kpp: '123456789', ogrn: '1234567890123',
      });
      expect(parsed.catalogs.find(row => row.type === 'company')).toMatchObject({ partyKind: 'sole_proprietor', ogrn: '123456789012345' });
      expect(parsed.catalogs.find(row => row.type === 'contract')).toMatchObject({ organizationRef: organization, companyRef: company, contractKind: 'supplier', number: 'C-100' });
      expect(parsed.catalogs.find(row => row.type === 'product')).toMatchObject({ sku: 'A-10', unitCode: '796', vatRate: 'none' });
      expect(parsed.catalogs.find(row => row.type === 'bank_account')).toMatchObject({ ownerRef: organization, bik: '044525225', account: '40702810000000000001' });
      expect(parsed.references.find(row => row.type === 'cash_register')).toMatchObject({ refUuid: cash, organizationRef: organization });
      expect(parsed.documents.map(row => row.type)).toEqual(data.documents.map(row => row.type));
      expect(parsed.documents[2]).toMatchObject({ refUuid: guid(22), type: 'bank_receipt', number: 'БП-3', date: day, amount: '120.00',
        currency: '643', organizationRef: organization, companyRef: company });
    });
  }

  test('reads prefixed 1C records, GUIDs, classifications and document key properties', () => {
    const parsed = parseEnterpriseDataXml(`<m:Message xmlns:m="http://www.1c.ru/SSL/Exchange/Message" xmlns:ed="${namespace()}">
      <m:Header><m:Format>${namespace()}</m:Format></m:Header><m:Body>
      <ed:Справочник.Контрагенты><ed:КлючевыеСвойства><ed:Ссылка>{${company.toUpperCase()}}</ed:Ссылка>
        <ed:Наименование>ООО &#x41; &amp; Б</ed:Наименование><ed:ИНН>7707083893</ed:ИНН><ed:КПП>773601001</ed:КПП>
      </ed:КлючевыеСвойства><ed:ОГРН>1027700132195</ed:ОГРН></ed:Справочник.Контрагенты>
      <ed:Справочник.Номенклатура><ed:КлючевыеСвойства><ed:Ссылка>${product}</ed:Ссылка><ed:Наименование>Кабель</ed:Наименование>
        <ed:Артикул>ART-013</ed:Артикул></ed:КлючевыеСвойства><ed:Штрихкоды><ed:Строка><ed:Штрихкод>4601234567890</ed:Штрихкод></ed:Строка></ed:Штрихкоды>
        <ed:ЕдиницаИзмерения><ed:Код>006</ed:Код></ed:ЕдиницаИзмерения></ed:Справочник.Номенклатура>
      <ed:Документ.ПоступлениеТоваровУслуг><ed:КлючевыеСвойства>
        <ed:Ссылка>${guid(28)}</ed:Ссылка><ed:Дата>2026-11-24T15:05:00+03:00</ed:Дата><ed:Номер>00УТ-000074</ed:Номер>
        <ed:Организация>${organization}</ed:Организация><ed:Контрагент>${company}</ed:Контрагент>
      </ed:КлючевыеСвойства><ed:СуммаДокумента>512,90</ed:СуммаДокумента></ed:Документ.ПоступлениеТоваровУслуг>
      </m:Body></m:Message>`);
    expect(parsed.issues).toEqual([]);
    expect(parsed.catalogs[0]).toMatchObject({ refUuid: company, name: 'ООО A & Б', inn: '7707083893', kpp: '773601001', ogrn: '1027700132195' });
    expect(parsed.catalogs[1]).toMatchObject({ sku: 'ART-013', barcode: '4601234567890', unitCode: '006' });
    expect(parsed.documents).toMatchObject([{ type: 'receipt', date: day, amount: '512.90', organizationRef: organization, companyRef: company }]);
  });

  test('reads stock, bank, cash and signed counterparty opening documents', () => {
    const key = `<КлючевыеСвойства>${ref(guid(80))}<Дата>${day}T00:00:00</Дата>${link('Организация', organization)}</КлючевыеСвойства>`;
    const parsed = parseEnterpriseDataXml(xml(`
      <Документ.ОстаткиСобственныхТМЦ>${key}${link('Склад', warehouse)}<Запасы><СтрокаЗапасов>
        <ДанныеНоменклатуры>${link('Номенклатура', product)}</ДанныеНоменклатуры><Количество>4.500</Количество><Сумма>75.43</Сумма>
      </СтрокаЗапасов></Запасы></Документ.ОстаткиСобственныхТМЦ>
      <Документ.ОстаткиБезналичныхДенежныхСредств>${key}${link('БанковскийСчетОрганизации', bank)}<Сумма>250.00</Сумма>
      </Документ.ОстаткиБезналичныхДенежныхСредств>
      <Документ.ОстаткиНаличныхДенежныхСредств>${key}<Касса>${ref(cash)}<Наименование>Касса № 1</Наименование></Касса>
        <Сумма>100.00</Сумма></Документ.ОстаткиНаличныхДенежныхСредств>
      <Документ.ОстаткиРасчетовСПоставщикамиДолги>${key}<Взаиморасчеты><СтрокаВзаиморасчетов>${link('Контрагент', company)}
        ${link('Договор', contract)}<Сумма>18.35</Сумма></СтрокаВзаиморасчетов></Взаиморасчеты></Документ.ОстаткиРасчетовСПоставщикамиДолги>
      <Документ.ВводНачальныхОстатков>${key}<Взаиморасчеты><Строка>${link('Контрагент', company)}
        <Задолженность>15</Задолженность></Строка></Взаиморасчеты></Документ.ВводНачальныхОстатков>
    `));
    expect(parsed.issues).toEqual([]);
    expect(parsed.balances).toMatchObject([
      { kind: 'stock', productRef: product, warehouseRef: warehouse, organizationRef: organization, qty: '4.500', amount: '75.43', date: day, hasCost: true },
      { kind: 'bank', accountRef: bank, amount: '250.00', organizationRef: organization, date: day },
      { kind: 'cash', accountRef: cash, amount: '100.00' },
      { kind: 'settlement', companyRef: company, contractRef: contract, amount: '-18.35', side: 'supplier' },
      { kind: 'settlement', companyRef: company, amount: '15' },
    ]);
    expect(parsed.catalogs).toMatchObject([{ type: 'cash_register', refUuid: cash, name: 'Касса № 1', organizationRef: organization }]);
  });

  test('keeps explicit empty snapshots and reports invalid records instead of treating their values as zero', () => {
    const parsed = parseEnterpriseDataXml(xml(`
      <ОстаткиТоваров><Дата>${day}</Дата>${link('Организация', organization)}</ОстаткиТоваров>
      <ОстаткиВзаиморасчетов><Строка><Сумма>broken</Сумма></Строка></ОстаткиВзаиморасчетов>
      <Справочник.Номенклатура><Наименование>Без GUID</Наименование></Справочник.Номенклатура>
      <Документ.РеализацияТоваровУслуг><Номер>A-4</Номер><Дата>2026-02-30</Дата><Сумма>42</Сумма></Документ.РеализацияТоваровУслуг>
      <Документ.РКО><Номер>Проект</Номер><Дата>${day}</Дата><Сумма>2</Сумма><Проведен>false</Проведен></Документ.РКО>
    `));
    expect(parsed.issues.map(issue => issue.reason)).toEqual(['invalid_balance', 'invalid_catalog', 'invalid_document']);
    expect(parsed.documents).toEqual([]);
    expect(parsed.balanceSnapshots).toMatchObject([{ kind: 'stock', date: day, organizationRef: organization }]);
  });

  test('rejects DOCTYPE, external and declared entities, malformed XML and unsupported formats', () => {
    const input = xml('');
    for (const document of [
      input.replace('<m:Message', '<!DOCTYPE m:Message SYSTEM "file:///etc/passwd"><m:Message'),
      input.replace('<m:Message', '<!DOCTYPE m:Message [<!ENTITY external SYSTEM "file:///etc/passwd">]><m:Message'),
      xml('<Справочник.Номенклатура>&external;</Справочник.Номенклатура>'),
      xml('<Справочник.Номенклатура>'),
      xml('', '1.18'),
      '<Message><Body /></Message>',
      xml('<Строка>&#x0;</Строка>'),
    ]) expect(() => parseEnterpriseDataXml(document), document).toThrow();
  });

  test('enforces the UTF-8 byte limit and rejects invalid UTF-8', () => {
    expect(() => parseEnterpriseDataXml(xml('я'.repeat(ENTERPRISE_DATA_MAX_BYTES / 2)))).toThrow('exceeds 10 MiB');
    expect(() => parseEnterpriseDataXml(new Uint8Array(ENTERPRISE_DATA_MAX_BYTES + 1))).toThrow('exceeds 10 MiB');
    expect(() => parseEnterpriseDataXml(Uint8Array.of(0xC0, 0xAF))).toThrow('Expected a valid EnterpriseData');
  });
});
