/* Банковская выписка (1174в): предпросмотр файла 1CClientBankExchange (windows-1251 и UTF-8), сопоставление по ИНН и номеру
   документа, создание документов, защита от повторного импорта, выгрузка платёжных поручений, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { decodeBankStatement, encodeBankStatement, parseBankStatement } from '@gr8r/shared';
import { Client } from './helpers';

let owner: Client;
let other: Client;
let service: string;
let orgId: string;
let bankId: string;
let customerId: string;
let supplierId: string;
let actId: string;
let actNumber: string;

const OWN = '40702810400000000001';
const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

function statement(actRef: string): string {
  return [
    '1CClientBankExchange',
    'ВерсияФормата=1.03',
    'Кодировка=Windows',
    'Отправитель=Тест-банк',
    'ДатаСоздания=27.10.2026',
    'ДатаНачала=01.10.2026',
    'ДатаКонца=27.10.2026',
    `РасчСчет=${OWN}`,
    // приход от покупателя по номеру акта
    'СекцияДокумент=Платежное поручение',
    'Номер=101',
    'Дата=20.10.2026',
    'Сумма=1000.00',
    'ПлательщикСчет=40702810999999999991',
    'Плательщик=ИНН 7728168971 ООО «Покупатель»',
    'ПолучательСчет=' + OWN,
    'ДатаПоступило=21.10.2026',
    `НазначениеПлатежа=Оплата по акту № ${actRef} от 15.10.2026`,
    'КонецДокумента',
    // расход неизвестному получателю
    'СекцияДокумент=Платежное поручение',
    'Номер=102',
    'Дата=22.10.2026',
    'Сумма=250,50',
    'ПлательщикСчет=' + OWN,
    'ПолучательСчет=40702810888888888881',
    'Получатель=ИП Сидоров',
    'ПолучательИНН=500100732259',
    'ДатаСписано=22.10.2026',
    'НазначениеПлатежа=Аренда парковки',
    'КонецДокумента',
    // чужой счёт в той же выписке
    'СекцияДокумент=Платежное поручение',
    'Номер=103',
    'Дата=22.10.2026',
    'Сумма=5',
    'ПлательщикСчет=40702810777777777771',
    'ПолучательСчет=40702810666666666661',
    'НазначениеПлатежа=Чужое',
    'КонецДокумента',
    'КонецФайла',
  ].join('\r\n');
}

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Bank import WS' });
  other = new Client();
  await other.signup({ workspaceName: 'Other bank import WS' });
  service = (await mk(owner, '/products', { name: 'Консультация', kind: 'service', price: 0, vatRate: 'none' })).id;
  orgId = (await owner.get('/organizations')).body.items[0].id;
  bankId = (await mk(owner, `/organizations/${orgId}/bank-accounts`, { bik: '044525225', account: OWN, bankName: 'Тест-банк' })).id;
  customerId = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7728168971' })).id;
  supplierId = (await mk(owner, '/companies', { name: 'ООО «Поставщик»', inn: '7707083893' })).id;
  await mk(owner, `/companies/${supplierId}/bank-accounts`, { bik: '044525225', account: '40702810555555555551', bankName: 'Банк поставщика' });
  const doc = await mk(owner, '/documents', { type: 'act', counterpartyId: customerId, date: '2026-10-15', lines: [{ productId: service, qty: 1, price: '1000', vatRate: 'none' }] });
  await mk(owner, `/documents/${doc.id}/post`);
  actId = doc.id;
  actNumber = (await owner.get(`/documents/${actId}`)).body.number;
});

const lastRun = () => (actNumber.match(/\d+/g) ?? []).pop()!.replace(/^0+(?=\d)/, '');
const preview = (bytes: Uint8Array, c = owner, q = '') => c.upload(`/bank-import/preview${q}`, bytes);
const toCommit = (rows: any[], extra: Record<string, unknown> = {}) =>
  rows
    .filter(r => !r.skip)
    .map(r => ({ direction: r.direction, number: r.number, docDate: r.docDate, bookedDate: r.bookedDate, amount: r.amount, purpose: r.purpose, operation: r.operation, counterpartyId: r.counterpartyId, settlementDocumentId: r.settlementDocumentId, ...extra }));

describe('предпросмотр', () => {
  test('windows-1251: счёт, контрагент по ИНН, документ по номеру, чужой счёт пропускается', async () => {
    const r = await preview(encodeBankStatement(statement(lastRun()), 'windows-1251'));
    expect(r.status).toBe(200);
    expect(r.body.encoding).toBe('windows-1251');
    expect(r.body.bankAccount.id).toBe(bankId);
    const [a, b, c] = r.body.rows;
    expect(a).toMatchObject({ direction: 'in', amount: '1000.00', bookedDate: '2026-10-21', counterpartyId: customerId, settlementDocumentId: actId, operation: 'from_customer', skip: false });
    expect(b).toMatchObject({ direction: 'out', amount: '250.50', counterpartyId: null, operation: 'other_expense', skip: false });
    expect(b.issues).toContain('counterparty_not_found');
    expect(c).toMatchObject({ skip: true });
    expect(c.issues).toContain('other_account');
  });

  test('UTF-8 даёт тот же результат', async () => {
    const win = await preview(encodeBankStatement(statement(lastRun()), 'windows-1251'));
    const utf = await preview(new TextEncoder().encode(statement(lastRun())));
    expect(utf.body.encoding).toBe('utf-8');
    expect(utf.body.rows).toEqual(win.body.rows);
  });

  test('не выписка — 422, чужой арендатор своих счетов не видит', async () => {
    const bad = await preview(new TextEncoder().encode('hello'));
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('invalid_statement');
    const foreign = await preview(encodeBankStatement(statement(lastRun())), other);
    expect(foreign.status).toBe(200);
    expect(foreign.body.bankAccount).toBeNull();
    expect(foreign.body.rows).toEqual([]);
  });
});

describe('импорт', () => {
  test('создаёт и проводит документы, оплата акта закрывает долг, повтор не дублирует', async () => {
    const bytes = encodeBankStatement(statement(lastRun()));
    const pv = await preview(bytes);
    const rows = toCommit(pv.body.rows);
    expect(rows).toHaveLength(2);
    // правим вручную: расход — поставщику
    rows[1]!.counterpartyId = supplierId;
    rows[1]!.operation = 'to_supplier';
    const bad = await owner.post('/bank-import/commit', { bankAccountId: bankId, post: true, rows: [{ ...rows[1]!, operation: 'from_customer', number: '999' }] });
    expect(bad.body.failed[0].code).toBe('invalid_operation');
    expect(bad.body.created).toEqual([]);

    const r = await owner.post('/bank-import/commit', { bankAccountId: bankId, post: true, rows });
    expect(r.status).toBe(200);
    expect(r.body.failed).toEqual([]);
    expect(r.body.created.map((x: any) => x.posted)).toEqual([true, true]);
    const st = (await owner.get(`/payments/status?ids=${actId}`)).body.items[actId];
    expect(st.state).toBe('paid');
    const bal = (await owner.get('/payments/balances?asOf=2026-12-31')).body;
    expect(bal.bank.find((b: any) => b.id === bankId).balance).toBe('749.50');
    const doc = (await owner.get(`/payments/${r.body.created[0].id}`)).body;
    expect(doc).toMatchObject({ type: 'bank_receipt', date: '2026-10-21', status: 'posted' });
    expect(doc.comment).toContain('Оплата по акту');

    // повторный предпросмотр помечает дубли, повторная отправка ничего не создаёт
    const again = await preview(bytes);
    expect(again.body.rows.filter((x: any) => x.issues.includes('duplicate'))).toHaveLength(2);
    expect(again.body.summary.duplicates).toBe(2);
    const dup = await owner.post('/bank-import/commit', { bankAccountId: bankId, post: true, rows });
    expect(dup.body.created).toEqual([]);
    expect(dup.body.skipped.map((x: any) => x.reason)).toEqual(['duplicate', 'duplicate']);
  });

  test('черновики, если не проводить; чужой счёт организации — ошибка', async () => {
    const item = (await mk(owner, '/cash-flow-items', { name: 'Проценты банка', kind: 'income' })).id;
    const row = { cashFlowItemId: item, direction: 'in', number: '555', docDate: '2026-10-25', bookedDate: '2026-10-25', amount: '10', purpose: 'Проценты', operation: 'other_income' };
    const r = await owner.post('/bank-import/commit', { bankAccountId: bankId, post: false, rows: [row] });
    expect(r.body.created[0].posted).toBe(false);
    expect((await owner.get(`/payments/${r.body.created[0].id}`)).body.status).toBe('draft');
    const foreign = await other.post('/bank-import/commit', { bankAccountId: bankId, post: false, rows: [{ ...row, number: '556' }] });
    expect(foreign.status).toBe(422);
  });
});

describe('выгрузка платёжных поручений', () => {
  test('черновик списания со счёта выгружается в windows-1251 и читается разбором', async () => {
    const d = await mk(owner, '/payments', { type: 'bank_payment', bankAccountId: bankId, operation: 'to_supplier', counterpartyId: supplierId, date: '2026-10-26', comment: 'Оплата по счёту № 9 «Тест»', lines: [{ amount: '777.00' }] });
    const r = await owner.get(`/bank-import/payment-orders?bankAccountId=${bankId}&from=2026-10-26&to=2026-10-26`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('windows-1251');
    const back = parseBankStatement(decodeBankStatement(r.bytes).text);
    expect(back.transactions).toHaveLength(1);
    expect(back.transactions[0]).toMatchObject({ amount: '777.00', purpose: 'Оплата по счёту № 9 «Тест»' });
    expect(back.transactions[0]!.receiver).toMatchObject({ inn: '7707083893', account: '40702810555555555551' });
    expect(back.accounts).toEqual([OWN]);
    void d;
    const none = await owner.get(`/bank-import/payment-orders?bankAccountId=${bankId}&from=2030-01-01`);
    expect(none.status).toBe(422);
  });
});
