import { expect, test } from 'bun:test';
import { bankAccountRequisites, bankDirection, bankImportKey, computeDocument, formAllowedFor, getCountryPack, parseBankStatement, printFormsFor, printParam, renderMoneyForm, renderPrintForm, type PrintData } from '../src';

const iik = 'KZ86125KZT5004100100';
const otherIik = 'KZ27220A123456789012';
const requisites = { binIin: '900101350122', iik, bik: 'HSBKKZKX', kbe: '17', knp: '710' };
const organization: PrintData['organization'] = {
  name: 'ТОО <script>&"', fullName: '', inn: '', kpp: '', ogrn: '', address: 'Алматы', phone: '',
  bank: null, requisites, kind: 'legal', directorName: 'А. <Иванов>', directorTitle: '', accountantName: '',
  taxSystem: 'our', stampFile: null, directorSignatureFile: null, accountantSignatureFile: null,
};
const inputs = ['16', '0', 'none'].map(vatRate => ({ qty: '1', price: '100', vatRate }));
const { lines, totals } = computeDocument(inputs, false);
const document: PrintData = {
  type: 'realization', number: 'KZ<&>', date: '2026-11-25', dueDate: null, priceIncludesVat: false,
  organization, party: { ...organization, name: 'Покупатель' },
  lines: lines.map((line, i) => ({
    ...inputs[i]!, ...line, n: i + 1, discountPct: '0', sku: 'A', unitCode: '796', unitSymbol: 'шт.', name: '<товар>',
  })),
  totals, basedOn: null, comment: '<комментарий>',
};
const payment = { organization, number: document.number, date: document.date, amount: '316.25' };

const forms = [
  ['invoice', 'kz_invoice', 'Счёт на оплату', renderPrintForm('kz_invoice', { ...document, type: 'invoice' })],
  ['realization', 'kz_z2', 'З-2', renderPrintForm('kz_z2', document)],
  ['act', 'kz_r1', 'Р-1', renderPrintForm('kz_r1', { ...document, type: 'act' })],
  ['realization', 'kz_tax_invoice', 'Счёт-фактура', renderPrintForm('kz_tax_invoice', document)],
  ['cash_receipt', 'kz_pko', 'КО-1', renderMoneyForm({ ...payment, form: 'kz_pko', cashRegisterName: 'Касса', personName: 'Покупатель', basis: '<основание>' })],
  ['cash_payment', 'kz_rko', 'КО-2', renderMoneyForm({ ...payment, form: 'kz_rko', cashRegisterName: 'Касса', personName: 'Поставщик', basis: '<основание>' })],
  ['bank_payment', 'kz_payment_order', 'Платёжное поручение', renderMoneyForm({ ...payment, form: 'kz_payment_order', payer: organization, payerBank: null, payee: organization, payeeBank: null, purpose: '<назначение>' })],
] as const;

for (const [type, form, title, html] of forms) {
  test(`${form} prints escaped Russian content and is available for KZ only`, () => {
    expect(getCountryPack('KZ').printFormIds).toContain(form);
    expect(printParam.safeParse({ id: '00000000-0000-4000-8000-000000000001', form }).success).toBe(true);
    expect(formAllowedFor(type, form, 'KZ')).toBe(true);
    expect(printFormsFor(type, 'KZ')).toContain(form);
    expect(printFormsFor(type, 'RU')).not.toContain(form);
    expect(formAllowedFor(type, form, 'RU')).toBe(false);
    expect(formAllowedFor(type, form, 'AE')).toBe(false);
    expect(formAllowedFor('inventory_count', form, 'KZ')).toBe(false);
    for (const value of [title, 'БИН/ИИН', 'ИИК', 'БИК', 'КБе', 'КНП', ...Object.values(requisites), 'триста шестнадцать тенге', 'тиын', '&lt;script&gt;&amp;&quot;', 'KZ&lt;&amp;&gt;']) {
      expect(html).toContain(value);
    }
    expect(html).not.toContain('<script>');
    if (!type.startsWith('cash_') && type !== 'bank_payment') {
      for (const value of ['16%', '0%', 'без НДС', '&lt;товар&gt;']) expect(html).toContain(value);
    } else {
      expect(html).toContain('двадцать пять тиын');
    }
  });
}

function statement(sender: string, accountField: string, identityField: string, codeField: string, currency = 'KZT') {
  return `1CClientBankExchange
ВерсияФормата=1.03
Отправитель=${sender}
Валюта=${currency}
${accountField}=${iik}
СекцияРасчСчет
${accountField}=${iik}
НачальныйОстаток=100,25
КонецРасчСчет
СекцияДокумент=Платежное поручение
Номер=15
Дата=25.11.2026
Сумма=50,10
Плательщик=ТОО Клиент
Плательщик${identityField}=900101350122
ПлательщикИИК=${otherIik}
ПлательщикБИК=CASPKZKA
ПлательщикКБе=19
ПолучательИИК=kz86 125kzt5004100100
ПолучательБИК=HSBKKZKXXXX
КБе=17
${codeField}=071
НазначениеПлатежа=Оплата счета № 15
КонецДокумента
КонецФайла`;
}

for (const [sender, accountField, identityField, codeField] of [
  ['АО «Народный Банк Казахстана»', 'РасчСчет', 'БИН', 'КНП'],
  ['Kaspi Pay', 'ИИК', 'ИИН', 'КодНазначенияПлатежа'],
  ['Jusan Business', 'РасчСчет', 'БИН', 'КНП'],
  ['АО Банк ЦентрКредит', 'РасчСчет', 'БИН', 'КНП'],
] as const) {
  test(`${sender} statement retains KZ bank fields`, () => {
    const result = parseBankStatement(statement(sender, accountField, identityField, codeField));
    expect(result).toMatchObject({ country: 'KZ', accounts: [iik], balances: [{ account: iik, opening: '100.25' }], warnings: [] });
    const [tx] = result.transactions;
    expect(tx).toMatchObject({
      currency: 'KZT', knp: '071', uin: '', amount: '50.10',
      payer: { inn: '900101350122', account: otherIik, bik: 'CASPKZKA', kbe: '19' },
      receiver: { account: iik, bik: 'HSBKKZKXXXX', kbe: '17' },
    });
    expect(bankDirection(tx!, ['kz86 125kzt5004100100'])).toBe('in');
    expect(bankImportKey(iik, 'in', tx!)).toBe(`${iik}|in|2026-11-25|15|50.10`);
  });
}

test('standard bank headers identify KZ format and the KZT default', () => {
  for (const sender of ['Halyk Bank', 'Kaspi Pay', 'Jusan Business', 'BCC Business']) {
    const result = parseBankStatement(`1CClientBankExchange\nОтправитель=${sender}\nКонецФайла`);
    expect(result).toMatchObject({ country: 'KZ', currency: 'KZT' });
  }
});

test('local fields identify KZ independently of the bank header', () => {
  const result = parseBankStatement(statement('1С', 'ИИК', 'БИН', 'КНП', '398'));
  expect(result.country).toBe('KZ');
  expect(result.transactions[0]?.currency).toBe('KZT');
});

test('organizations can save a KZ bank account with 8- or 11-character SWIFT', () => {
  for (const bik of ['HSBKKZKX', 'HSBKKZKXXXX']) {
    expect(bankAccountRequisites('KZ').safeParse({ account: iik, bik }).success).toBe(true);
    expect(bankAccountRequisites('RU').safeParse({ account: iik, bik }).success).toBe(false);
  }
  expect(bankAccountRequisites('KZ').safeParse({ account: iik, bik: '044525225' }).success).toBe(false);
  expect(bankAccountRequisites('RU').safeParse({ account: '40702810000000000001', bik: '044525225' }).success).toBe(true);
});

test('foreign-currency KZ rows are skipped with a warning', () => {
  const result = parseBankStatement(statement('Halyk', 'РасчСчет', 'БИН', 'КНП', 'USD'));
  expect(result.transactions).toEqual([]);
  expect(result.warnings).toMatchObject([{ code: 'unsupported_currency' }]);
});

test('Russian statements retain numeric accounts, BIK, INN/KPP, and UIN', () => {
  const account = '40702810000000000001';
  const result = parseBankStatement(`1CClientBankExchange
РасчСчет=${account}
СекцияДокумент=Платежное поручение
Номер=15
Дата=25.11.2026
Сумма=50,10
Плательщик=ИНН 7701234567 КПП 770101001 ООО Пример
ПлательщикСчет=${account}
ПлательщикБИК=044525225
ПолучательСчет=40702810000000000002
Код=123
КодНазначенияПлатежа=999
КонецДокумента
КонецФайла`);
  const [tx] = result.transactions;
  expect(result.accounts).toEqual([account]);
  expect(result.country).toBeUndefined();
  expect(tx).toMatchObject({ uin: '123', payer: { account, bik: '044525225', inn: '7701234567', kpp: '770101001', name: 'ООО Пример' } });
  expect(bankDirection(tx!, [account])).toBe('out');
  expect(bankImportKey(account, 'out', tx!)).toBe(`${account}|out|2026-11-25|15|50.10`);
});
