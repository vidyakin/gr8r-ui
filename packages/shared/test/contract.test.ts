import { describe, expect, test } from 'bun:test';
import { computeDocument, CONTRACT_TEMPLATE_BLOCKS, CONTRACT_TEMPLATE_PARAMS, DEFAULT_CONTRACT_TEMPLATES, renderContract, renderContractBody, type ContractPrintData, type PrintData, type PrintLine } from '../src';
import { docxTemplateTags, renderContractDocx } from '../src/print/contract-docx';
import PizZip from 'pizzip';

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

describe('DOCX-шаблоны (задача 1195)', () => {
  const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const run = (t: string) => (t ? `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>` : '');
  /** Минимальный .docx: только [Content_Types].xml, связи и word/document.xml; разбивка {{…}} на прогоны — как после Word */
  const docx = (body: string): Uint8Array => {
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    const zip = new PizZip();
    zip.file('[Content_Types].xml', ct);
    zip.file('_rels/.rels', rels);
    zip.file('word/document.xml', doc);
    return zip.generate({ type: 'uint8array' }) as Uint8Array;
  };
  const texts = (b: Uint8Array): string[] => {
    const xml = new PizZip(b).file('word/document.xml')?.asText() ?? '';
    return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]!.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&').replaceAll(' ', ' ')).filter(t => t.trim());
  };

  test('разорванные Word-прогоны внутри {{…}} склеиваются, параметры подставляются', () => {
    // «{{Номер договора}}» разрезан между прогонами — Word так сохраняет после правок
    const b = docx(`<w:p>${run('Договор № {')}${run('{Номер дог')}${run('овора}} от {')}${run('{Дата догово')}${run('ра}}')}</w:p><w:p>${run('Стороны: {{Организация}} и {{Контрагент}}')}</w:p>`);
    const out = renderContractDocx(b, data());
    const t = texts(out).join(' ');
    expect(t).toContain('Договор № Д-15');
    expect(t).toContain('от 1 марта 2026 г.');
    expect(t).toContain('Стороны: ООО «Ромашка» и ИП Петров <П.П.>');
  });

  test('повтор строки таблицы с {{#Товары}}…{{/Товары}}: по строке на каждую строку документа', () => {
    // Метка цикла — в первой ячейке строки-шаблона, закрывающая — в последней (как требует docxtemplater)
    const b = docx(
      `<w:tbl><w:tr>` +
        `<w:tc><w:p>${run('{{#Товары}}')}</w:p></w:tc>` +
        `<w:tc><w:p>${run('{{Наименование}}')}</w:p></w:tc>` +
        `<w:tc><w:p>${run('{{Количество}}')}</w:p></w:tc>` +
        `<w:tc><w:p>${run('{{Единица}}')}</w:p></w:tc>` +
        `<w:tc><w:p>${run('{{Цена}}')}</w:p></w:tc>` +
        `<w:tc><w:p>${run('{{Сумма}}')}</w:p></w:tc>` +
        `<w:tc><w:p>${run('{{/Товары}}')}</w:p></w:tc>` +
        `</w:tr></w:tbl>`,
    );
    const out = renderContractDocx(b, data({}, true));
    const t = texts(out);
    expect(t.filter(x => x === 'Стол <дуб>').length).toBe(1);
    expect(t.join(' ')).toContain('шт');
    expect(t.join(' ')).toContain('2 000,00');
  });

  test('сумма прописью и реквизиты документа подставляются', () => {
    const b = docx(`<w:p>${run('Итого {{Сумма}} ({{Сумма прописью}}), НДС {{НДС}}')}</w:p>`);
    const t = texts(renderContractDocx(b, data({}, true))).join(' ');
    expect(t).toContain('2 000,00');
    expect(t).toContain('Две тысячи рублей 00 копеек');
    expect(t).toContain('без НДС');
  });

  test('список найденных параметров (проверка шаблона при загрузке)', () => {
    const b = docx(`<w:p>${run('{{Номер договора}} {{Нет такого параметра}} {{#Товары}}{{Наименование}}{{/Товары}}')}</w:p>`);
    const tags = docxTemplateTags(b);
    expect(tags).toContain('Номер договора');
    expect(tags).toContain('Нет такого параметра');
    expect(tags).toContain('Наименование');
  });
});
