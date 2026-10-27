import { describe, expect, test } from 'bun:test';
import { bankBookedDate, bankDirection, bankImportKey, BankStatementFormatError, decodeBankStatement, encodeBankStatement, extractDocumentRefs, parseBankAmount, parseBankDate, parseBankStatement, renderPaymentOrders } from '../src';

const SAMPLE = [
  '1CClientBankExchange',
  'ВерсияФормата=1.03',
  'Кодировка=Windows',
  'Отправитель=Банк',
  'ДатаСоздания=27.10.2026',
  'ДатаНачала=01.10.2026',
  'ДатаКонца=27.10.2026',
  'РасчСчет=40702810000000000001',
  'СекцияРасчСчет',
  'ДатаНачала=01.10.2026',
  'ДатаКонца=27.10.2026',
  'РасчСчет=40702810000000000001',
  'НачальныйОстаток=1000,00',
  'ВсегоПоступило=5000.50',
  'ВсегоСписано=200',
  'КонечныйОстаток=5800.50',
  'КонецРасчСчет',
  'СекцияДокумент=Платежное поручение',
  'Номер=15',
  'Дата=12.10.2026',
  'Сумма=5000.50',
  'ПлательщикСчет=40702810999999999999',
  'Плательщик=ИНН 7707083893 КПП 770701001 ООО «Ромашка»',
  'ПлательщикБИК=044525225',
  'ПолучательСчет=40702810000000000001',
  'ПолучательИНН=7728168971',
  'Получатель1=ООО Наша',
  'ДатаПоступило=13.10.2026',
  'НазначениеПлатежа=Оплата по счету № 45 от 10.10.2026 по договору № 7, в т.ч. НДС',
  'КонецДокумента',
  'СекцияДокумент=Платежное поручение',
  'Номер=16',
  'Дата=14.10.2026',
  'Сумма=200',
  'ПлательщикСчет=40702810000000000001',
  'ПолучательСчет=40702810888888888888',
  'Получатель=ИП Иванов',
  'ПолучательИНН=500100732259',
  'ДатаСписано=14.10.2026',
  'НазначениеПлатежа=Аренда',
  'КонецДокумента',
  'СекцияДокумент=Платежное поручение',
  'Номер=17',
  'Дата=14.10.2026',
  'Сумма=abc',
  'КонецДокумента',
  'КонецФайла',
].join('\r\n');

describe('выписка 1CClientBankExchange', () => {
  test('значения: даты и суммы', () => {
    expect(parseBankDate('27.10.2026')).toBe('2026-10-27');
    expect(parseBankDate('31.02.2026')).toBeNull();
    expect(parseBankAmount('1 234,5')).toBe('1234.50');
    expect(parseBankAmount('200')).toBe('200.00');
    expect(parseBankAmount('-5')).toBeNull();
  });

  test('windows-1251 и UTF-8 дают один и тот же разбор', () => {
    const win = decodeBankStatement(encodeBankStatement(SAMPLE, 'windows-1251'));
    expect(win.encoding).toBe('windows-1251');
    expect(win.text).toBe(SAMPLE);
    const utf = decodeBankStatement(new TextEncoder().encode(SAMPLE));
    expect(utf.encoding).toBe('utf-8');
    const bom = decodeBankStatement(Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(SAMPLE)]));
    expect(bom.text).toBe(SAMPLE);
    expect(parseBankStatement(win.text)).toEqual(parseBankStatement(utf.text));
  });

  test('шапка, остатки, документы и предупреждения', () => {
    const st = parseBankStatement(SAMPLE);
    expect(st.accounts).toEqual(['40702810000000000001']);
    expect(st.dateFrom).toBe('2026-10-01');
    expect(st.balances[0]).toMatchObject({ opening: '1000.00', incoming: '5000.50', outgoing: '200.00', closing: '5800.50' });
    expect(st.transactions).toHaveLength(2);
    const [a, b] = st.transactions;
    expect(a!.payer).toMatchObject({ inn: '7707083893', kpp: '770701001', name: 'ООО «Ромашка»', bik: '044525225' });
    expect(a!.receiver.inn).toBe('7728168971');
    expect(a!.amount).toBe('5000.50');
    expect(b!.receiver.name).toBe('ИП Иванов');
    expect(st.warnings.map(w => w.code)).toEqual(['bad_amount']);
  });

  test('направление, дата проведения и ключ повторного импорта', () => {
    const st = parseBankStatement(SAMPLE);
    const [a, b] = st.transactions;
    expect(bankDirection(a!, st.accounts)).toBe('in');
    expect(bankDirection(b!, st.accounts)).toBe('out');
    expect(bankDirection(a!, ['1'])).toBeNull();
    expect(bankBookedDate(a!, 'in')).toBe('2026-10-13');
    expect(bankBookedDate(b!, 'out')).toBe('2026-10-14');
    expect(bankImportKey('40702810000000000001', 'in', a!)).toBe('40702810000000000001|in|2026-10-12|15|5000.50');
  });

  test('не выписка и пустой файл', () => {
    expect(() => parseBankStatement('hello')).toThrow(BankStatementFormatError);
    expect(() => parseBankStatement('  \n')).toThrow(BankStatementFormatError);
  });

  test('номера документов из назначения', () => {
    expect(extractDocumentRefs('Оплата по счету № 45 от 10.10.2026 по договору № 7')).toEqual({ numbers: ['45'], contractNumbers: ['7'] });
    expect(extractDocumentRefs('Оплата сч. 12/А, заказ N 3').numbers.sort()).toEqual(['12/А', '3']);
    expect(extractDocumentRefs('Аренда за октябрь').numbers).toEqual([]);
    expect(extractDocumentRefs('по счету 77 от 01.01.2026').numbers).toEqual(['77']);
  });

  test('выгрузка платёжных поручений читается разбором обратно', () => {
    const party = (name: string, account: string) => ({ name, inn: '7707083893', kpp: '770701001', account, bik: '044525225', bank: 'Банк «Тест»', corrAccount: '30101810400000000225' });
    const text = renderPaymentOrders({ createdAt: '2026-10-27', orders: [{ number: '5', date: '2026-10-27', amount: '1500.00', payer: party('ООО Наша', '40702810000000000001'), receiver: party('ООО Поставщик', '40702810555555555555'), purpose: 'Оплата по счету № 9' }] });
    const back = parseBankStatement(decodeBankStatement(encodeBankStatement(text)).text);
    expect(back.transactions).toHaveLength(1);
    expect(back.transactions[0]).toMatchObject({ number: '5', date: '2026-10-27', amount: '1500.00', purpose: 'Оплата по счету № 9' });
    expect(back.transactions[0]!.receiver).toMatchObject({ name: 'ООО Поставщик', account: '40702810555555555555', bank: 'Банк «Тест»' });
    expect(bankDirection(back.transactions[0]!, back.accounts)).toBe('out');
  });
});
