import { describe, expect, test } from 'bun:test';
import { computeDocument, CONTRACT_TEMPLATE_BLOCKS, CONTRACT_TEMPLATE_PARAMS, DEFAULT_CONTRACT_TEMPLATES, renderContract, renderContractBody, type ContractPrintData, type PrintData, type PrintLine } from '../src';

const raw = [{ sku: 'A', name: 'Стол <дуб>', unitCode: '796', unitSymbol: 'шт', qty: '2.000', price: '1000.00', discountPct: '0', vatRate: 'none' }];
const calc = computeDocument(raw, true);
const lines: PrintLine[] = raw.map((r, i) => ({ n: i + 1, ...r, ...calc.lines[i]! }));

const org = { name: 'ООО Ромашка', fullName: 'ООО «Ромашка»', inn: '7707083893', kpp: '770701001', ogrn: '1027700132195', address: 'Москва', phone: '', bank: { bik: '044525225', account: '40702810000000000001', corrAccount: '30101810400000000225', bankName: 'Сбербанк' }, kind: 'legal' as const, directorName: 'Иванов И. И.', directorTitle: 'Генеральный директор', accountantName: '', taxSystem: 'osn' as const, stampFile: null, directorSignatureFile: null, accountantSignatureFile: null };
const party = { name: 'ИП Петров', fullName: 'ИП Петров <П.П.>', inn: '500100732259', kpp: '', ogrn: '', address: 'Тверь', phone: '', bank: null };

const doc = (): PrintData => ({ type: 'customer_order', number: 'ЗК-1', date: '2026-03-05', dueDate: '2026-03-20', priceIncludesVat: true, organization: org, party, lines, totals: calc.totals, basedOn: null, comment: '' });
const data = (over: Partial<ContractPrintData['contract']> = {}, withDoc = false): ContractPrintData => ({
  contract: { number: 'Д-15', date: '2026-03-01', kind: 'customer', category: '', validFrom: '2026-03-01', validTo: '2027-02-28', paymentDays: 10, note: '', orgSignerBasis: '', partySignerName: '', partySignerTitle: '', partySignerBasis: '', ...over },
  organization: org,
  party,
  doc: withDoc ? doc() : null,
});

describe('шаблоны договоров', () => {
  test('параметры договора и сторон подставляются, значения экранируются', () => {
    const h = renderContractBody('Договор № {{Номер договора}} {{Дата договора}}\n\n{{Контрагент}}, ИНН {{ИНН контрагента}}\n\nСрок: {{Срок действия}}; отсрочка {{Отсрочка оплаты}}', data());
    expect(h).toContain('Договор № Д-15 1 марта 2026 г.');
    expect(h).toContain('ИП Петров &lt;П.П.&gt;, ИНН 500100732259');
    expect(h).toContain('Срок: с 01.03.2026 по 28.02.2027; отсрочка 10 дн.');
  });

  test('«в лице … на основании»: по умолчанию Устав, у контрагента — из договора; без подписанта — только название', () => {
    const t = '{{Организация в лице}}\n\n{{Контрагент в лице}}';
    const a = renderContractBody(t, data());
    expect(a).toContain('ООО «Ромашка», в лице Генеральный директор Иванов И. И., действующего на основании Устава');
    expect(a).toContain('ИП Петров &lt;П.П.&gt;</p>');
    const b = renderContractBody(t, data({ orgSignerBasis: 'доверенности № 5', partySignerName: 'Сидоров С. С.', partySignerTitle: 'директора', partySignerBasis: 'приказа' }));
    expect(b).toContain('действующего на основании доверенности № 5');
    expect(b).toContain('в лице директора Сидоров С. С., действующего на основании приказа');
  });

  test('бессрочный договор, пустые параметры документа не печатаются, незнакомый остаётся текстом', () => {
    const h = renderContractBody('Срок: {{Срок действия}}\n\nЗаказ: {{Номер документа}}\n\nХ: {{Нет такого}}', data({ validTo: null }));
    expect(h).toContain('Срок: с 01.03.2026, бессрочный');
    expect(h).not.toContain('Заказ:');
    expect(h).toContain('{{Нет такого}}');
  });

  test('составное назначение: блок {{Товары}} и параметры документа', () => {
    const h = renderContractBody('Заказ {{Номер документа}} от {{Дата документа}}\n\n{{Товары}}\n\nИтого {{Сумма}}', data({}, true));
    expect(h).toContain('Заказ ЗК-1 от 5 марта 2026 г.');
    expect(h).toContain('Стол &lt;дуб&gt;');
    expect(h).toContain('2 000,00');
    // у договора без документа блок пуст
    expect(renderContractBody('{{Товары}}', data())).not.toContain('<table');
  });

  test('встроенные шаблоны всех назначений собираются, реквизиты сторон в подписях', () => {
    for (const purpose of ['contract', 'contract_order', 'contract_invoice', 'contract_work_order'] as const) {
      const h = renderContract(data({}, purpose !== 'contract'), purpose);
      expect(h).toContain('<h1 class="center">Договор № Д-15</h1>');
      expect(h).toContain('ИНН 7707083893');
      expect(h).toContain('ИНН 500100732259');
      expect(h).not.toContain('{{');
      expect(DEFAULT_CONTRACT_TEMPLATES[purpose].name).toBeTruthy();
    }
    expect(renderContract(data({}, true), 'contract_order')).toContain('Стол &lt;дуб&gt;');
  });

  test('списки параметров и блоков для редактора', () => {
    expect(CONTRACT_TEMPLATE_PARAMS).toContain('Контрагент в лице');
    expect(CONTRACT_TEMPLATE_BLOCKS).toEqual(['Товары', 'Подписи сторон']);
  });
});
