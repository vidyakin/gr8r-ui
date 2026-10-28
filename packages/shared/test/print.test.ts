import { describe, expect, test } from 'bun:test';
import { computeDocument, dateLongRu, dateRu, esc, moneyRu, printOrientation, qtyRu, renderMoneyForm, renderPrintForm, qrSvg, type PrintData, type PrintLine } from '../src';

const lines = (includesVat: boolean): PrintLine[] => {
  const raw = [
    { sku: 'TBL-1', name: 'Стол «Норд» <дуб>', unitCode: '796', unitSymbol: 'шт', qty: '2.000', price: '12500.00', discountPct: '0', vatRate: '20' },
    { sku: '', name: 'Доставка', unitCode: '876', unitSymbol: 'усл. ед', qty: '1.000', price: '1500.00', discountPct: '0', vatRate: 'none' },
  ];
  const doc = computeDocument(raw, includesVat);
  return raw.map((r, i) => ({ n: i + 1, ...r, ...doc.lines[i]! }));
};

const data = (over: Partial<PrintData> = {}, includesVat = true): PrintData => {
  const ls = lines(includesVat);
  return {
    type: 'realization',
    number: 'РТ-2026-00007',
    date: '2026-03-05',
    dueDate: null,
    priceIncludesVat: includesVat,
    organization: {
      name: 'ООО «Гр8р Студия»',
      fullName: 'Общество с ограниченной ответственностью «Гр8р Студия»',
      inn: '7707083893',
      kpp: '770701001',
      ogrn: '1027700132195',
      address: '101000, Москва, ул. Мясницкая, 1',
      phone: '+7 495 000-00-00',
      bank: { bik: '044525225', account: '40702810400000000001', corrAccount: '30101810400000000225', bankName: 'ПАО Сбербанк' },
      kind: 'legal',
      directorName: 'Иванов И. И.',
      directorTitle: 'Генеральный директор',
      accountantName: 'Петрова П. П.',
      taxSystem: 'osn',
      stampFile: { name: 'stamp.png', url: 'data:image/png;base64,AAAA' },
      directorSignatureFile: null,
      accountantSignatureFile: null,
    },
    party: { name: 'ООО «Покупатель»', fullName: 'ООО «Покупатель»', inn: '7728168971', kpp: '', ogrn: '', address: 'Санкт-Петербург', phone: '', bank: null },
    lines: ls,
    totals: computeDocument(ls.map(l => ({ qty: l.qty, price: l.price, vatRate: l.vatRate })), includesVat).totals,
    basedOn: { type: 'customer_order', number: 'ЗК-2026-00003', date: '2026-03-01' },
    comment: '',
    ...over,
  };
};

describe('formatting helpers', () => {
  test('money, quantity and dates in Russian format', () => {
    expect(moneyRu('1234567.5')).toBe('1 234 567,50');
    expect(moneyRu('0.07')).toBe('0,07');
    expect(moneyRu('-1500.00')).toBe('-1 500,00');
    expect(qtyRu('2.000')).toBe('2');
    expect(qtyRu('2.500')).toBe('2,5');
    expect(qtyRu('10')).toBe('10');
    expect(dateRu('2026-03-05')).toBe('05.03.2026');
    expect(dateLongRu('2026-03-05')).toBe('5 марта 2026 г.');
  });
  test('escape', () => {
    expect(esc(`<a href="x">'&</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;');
    expect(esc(null)).toBe('');
  });
  test('orientation', () => {
    expect(printOrientation('invoice')).toBe('portrait');
    expect(printOrientation('act')).toBe('portrait');
    expect(printOrientation('upd')).toBe('landscape');
    expect(printOrientation('torg12')).toBe('landscape');
  });
});

describe('print forms', () => {
  test('every form is a complete A4 page with page-break rules and the right orientation', () => {
    for (const form of ['invoice', 'act', 'upd', 'torg12'] as const) {
      const html = renderPrintForm(form, data());
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain(`@page{size:A4 ${printOrientation(form)}`);
      expect(html).toContain('break-inside:avoid');
      expect(html).toContain('display:table-header-group'); // шапка таблицы повторяется на каждой странице
      expect(html).toContain('lang="ru"');
    }
  });

  test('invoice: bank block, parties, totals and amount in words', () => {
    const html = renderPrintForm('invoice', data({ type: 'invoice', number: 'СЧ-2026-00042', basedOn: null }));
    expect(html).toContain('Счёт на оплату № СЧ-2026-00042 от 05.03.2026');
    expect(html).toContain('ПАО Сбербанк');
    expect(html).toContain('044525225');
    expect(html).toContain('40702810400000000001');
    expect(html).toContain('ИНН 7707083893');
    expect(html).toContain('Покупатель:');
    // с НДС 20%: 2 × 12 500 = 25 000 (в т.ч. 4 166,67) + доставка 1 500 без НДС
    expect(html).toContain('26 500,00');
    expect(html).toContain('В том числе НДС:');
    expect(html).toContain('4 166,67');
    expect(html).toContain('Двадцать шесть тысяч пятьсот рублей 00 копеек');
    expect(html).toContain('Всего наименований 2');
    expect(html).toContain('Стол «Норд» &lt;дуб&gt;'); // экранирование названия
  });

  test('invoice with VAT on top shows totals without VAT, VAT and the total to pay', () => {
    const html = renderPrintForm('invoice', data({ type: 'invoice', basedOn: null }, false));
    expect(html).toContain('Итого (без НДС):');
    expect(html).toContain('Сумма НДС:');
    expect(html).toContain('Всего к оплате:');
    expect(html).toContain('Тридцать одна тысяча пятьсот рублей 00 копеек'); // 25 000 + 5 000 НДС + 1 500
  });

  test('draft is marked; quote and order change the title', () => {
    const d = renderPrintForm('invoice', data({ type: 'quote', number: null }));
    expect(d).toContain('Коммерческое предложение (черновик');
    expect(d).toContain('ЧЕРНОВИК');
    expect(renderPrintForm('invoice', data({ type: 'customer_order' }))).toContain('Заказ покупателя № РТ-2026-00007');
  });

  test('UPD: status by tax system, 13 value columns, per-line VAT, "без НДС", stamp', () => {
    const osn = renderPrintForm('upd', data());
    expect(osn).toContain('Универсальный передаточный документ');
    expect(osn).toContain('Статус: <b>1</b>');
    expect(osn).toContain('Счёт-фактура № РТ-2026-00007 от 05.03.2026');
    expect(osn).toContain('без НДС');
    expect(osn).toContain('20%');
    expect(osn).toContain('Всего к оплате');
    expect(osn).toContain('Российский рубль, 643');
    expect(osn).toContain('Заказ покупателя № ЗК-2026-00003 от 01.03.2026');
    expect(osn).toContain('<img class="stamp" src="data:image/png;base64,AAAA"');
    const usn = renderPrintForm('upd', data({ organization: { ...data().organization, taxSystem: 'usn' } }));
    expect(usn).toContain('Статус: <b>2</b>');
  });

  test('TORG-12: numbered columns, quantity of records in words, total in words', () => {
    const html = renderPrintForm('torg12', data());
    expect(html).toContain('ТОВАРНАЯ НАКЛАДНАЯ');
    expect(html).toContain('Унифицированная форма № ТОРГ-12');
    expect(html).toContain('<th class="small">15</th>');
    expect(html).toContain('содержит <b>два</b> порядковых номеров записей');
    expect(html).toContain('Двадцать шесть тысяч пятьсот рублей 00 копеек');
    expect(html).toContain('Отпуск груза разрешил');
    expect(html).toContain('796'); // код ОКЕИ
  });

  test('service act: wording, services table and totals', () => {
    const html = renderPrintForm('act', data({ type: 'act', number: 'АКТ-2026-00001' }));
    expect(html).toContain('Акт оказания услуг № АКТ-2026-00001 от 05.03.2026');
    expect(html).toContain('Исполнитель оказал следующие услуги');
    expect(html).toContain('претензий по объёму, качеству и срокам оказания услуг не имеет');
    expect(html).toContain('ИСПОЛНИТЕЛЬ');
    expect(html).toContain('ЗАКАЗЧИК');
    expect(html).toContain('Всего оказано услуг 2');
  });

  test('hostile values never become markup', () => {
    const evil = data();
    evil.party = { ...evil.party, name: '<script>alert(1)</script>', fullName: '<script>alert(1)</script>' };
    evil.organization = { ...evil.organization, stampFile: { name: 'x', url: '"><script>alert(2)</script>' } };
    for (const form of ['invoice', 'act', 'upd', 'torg12'] as const) {
      const html = renderPrintForm(form, evil);
      expect(html).not.toContain('<script>');
    }
  });
});

describe('payment link block (YooKassa)', () => {
  const url = 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=abc';
  test('invoice with a link prints the URL, the amount and an inline QR', () => {
    const html = renderPrintForm('invoice', data({ type: 'invoice', paymentLink: { url, amount: '1234.50' } }));
    expect(html).toContain('Оплатить онлайн');
    expect(html).toContain(esc(url));
    expect(html).toContain(moneyRu('1234.50'));
    expect(html).toContain('<svg');
    expect(html).not.toContain('<img src="http');
  });
  test('no link, a non-https link or a null link means no block', () => {
    expect(renderPrintForm('invoice', data({ type: 'invoice' }))).not.toContain('Оплатить онлайн');
    expect(renderPrintForm('invoice', data({ type: 'invoice', paymentLink: null }))).not.toContain('Оплатить онлайн');
    expect(renderPrintForm('invoice', data({ type: 'invoice', paymentLink: { url: 'javascript:alert(1)', amount: '1.00' } }))).not.toContain('Оплатить онлайн');
  });
  test('qrSvg is deterministic and sized by viewBox', () => {
    const a = qrSvg(url);
    expect(a).toBe(qrSvg(url));
    expect(a).toMatch(/viewBox="0 0 (\d+) \1"/);
  });
});

describe('money forms', () => {
  const org = data().organization;
  const base = { number: 'СС-2026-00004', date: '2026-03-05', organization: org };
  const bank = { bankName: 'ПАО Сбербанк', bik: '044525225', corrAccount: '30101810400000000225', account: '40702810400000000001' };
  test('payment order 0401060 carries both banks, the amount in words and the purpose', () => {
    const html = renderMoneyForm({ ...base, form: 'payment_order', payer: { name: org.name, inn: org.inn, kpp: org.kpp }, payerBank: bank, payee: { name: 'ООО «Поставщик»', inn: '7728168971', kpp: '' }, payeeBank: { ...bank, bik: '044030653', account: '40702810900000000009' }, amount: '1500.00', purpose: 'Оплата по счёту <1>' });
    expect(html).toContain('Платёжное поручение № СС-2026-00004');
    expect(html).toContain('0401060');
    expect(html).toContain('044030653');
    expect(html).toContain('Одна тысяча пятьсот рублей 00 копеек');
    expect(html).toContain('Оплата по счёту &lt;1&gt;');
  });
  test('draft documents are marked', () => {
    const html = renderMoneyForm({ ...base, number: null, form: 'advance_report', accountableName: 'Сидоров', rows: [{ n: 1, label: 'Бумага', costItem: 'Канцелярия', counterparty: '', amount: '300.00' }], total: '300.00', comment: '' });
    expect(html).toContain('ЧЕРНОВИК');
    expect(html).toContain('АО-1');
  });
  test('bank receipt, opening balances and the cash order go through one dispatcher', () => {
    expect(renderMoneyForm({ ...base, form: 'bank_receipt', account: bank, operation: 'Оплата от покупателя', payer: { name: 'Покупатель', inn: '1', kpp: '' }, rows: [{ n: 1, label: 'Счёт СЧ-1', flowItem: 'Оплата от покупателей', amount: '10.00' }], amount: '10.00', comment: '' })).toContain('Поступление на расчётный счёт № СС-2026-00004');
    expect(renderMoneyForm({ ...base, form: 'opening_balance', sections: [{ title: 'Остатки в кассах', rows: [{ n: 1, name: 'Касса', details: '', amount: '100.00' }], total: '100.00' }], comment: '' })).toContain('Остатки в кассах');
    expect(renderMoneyForm({ form: 'ko1', number: 'ПКО-1', date: '2026-03-05', organization: org, cashRegisterName: 'Касса', personName: 'X', basis: '', amount: '5.00' })).toContain('КО-1');
  });
});
