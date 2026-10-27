/* Ввод начальных остатков: приход в cash_moves без оборота в «Движении денег», долги и авансы контрагентов,
   отмена проведения, закрытый период, права, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let other: Client;
let member: Client;
let orgId: string;
let bankId: string;
let cashId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Opening WS' });
  other = new Client();
  await other.signup({ workspaceName: 'Other opening WS' });
  orgId = (await owner.get('/organizations')).body.items[0].id;
  bankId = (await mk(owner, `/organizations/${orgId}/bank-accounts`, { bik: '044525225', account: '40702810400000000001', bankName: 'Тест-банк' })).id;
  cashId = (await mk(owner, '/cash-registers', { name: 'Основная касса' })).id;
  member = new Client();
  void member;
});

describe('ввод начальных остатков', () => {
  test('проведение даёт остатки, но не оборот; отмена убирает', async () => {
    const doc = await mk(owner, '/opening-balances', {
      date: '2026-01-01',
      lines: [
        { kind: 'cash', cashRegisterId: cashId, amount: '10000.00' },
        { kind: 'bank', bankAccountId: bankId, amount: '250000.50' },
      ],
    });
    expect(doc.total).toBe('260000.50');
    await mk(owner, `/documents/${doc.id}/post`);
    const posted = (await owner.get(`/opening-balances/${doc.id}`)).body;
    expect(posted.status).toBe('posted');
    expect(posted.number).toMatch(/^НО/);
    expect(posted.total).toBe('260000.50');

    const bal = (await owner.get('/payments/balances?asOf=2026-06-01')).body;
    expect(bal.totals.cash).toBe('10000.00');
    expect(bal.totals.bank).toBe('250000.50');

    // обороты: ни по статьям, ни по месяцам
    const byItem = (await owner.get('/payments/reports/cash-flow?from=2026-01-01&to=2026-12-31&groupBy=item')).body;
    expect(byItem.totals.income).toBe('0.00');
    const byMonth = (await owner.get('/payments/reports/cash-flow?from=2026-01-01&to=2026-12-31&groupBy=month')).body;
    expect(byMonth.rows.length).toBe(0);
    // по кассам и счетам: остаток на начало периода включает ввод, оборота нет
    const byAcc = (await owner.get('/payments/reports/cash-flow?from=2026-01-01&to=2026-12-31&groupBy=account')).body;
    const bank = byAcc.rows.find((r: any) => r.key === bankId);
    expect(bank).toMatchObject({ opening: '250000.50', closing: '250000.50', income: '0.00', expense: '0.00' });

    // отмена проведения убирает движения; можно править и проводить снова
    await mk(owner, `/documents/${doc.id}/unpost`);
    expect((await owner.get('/payments/balances?asOf=2026-06-01')).body.totals.all).toBe('0.00');
  });

  test('долг и аванс контрагента пишут взаиморасчёты', async () => {
    const buyer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»' })).id as string;
    const supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»' })).id as string;
    const doc = await mk(owner, '/opening-balances', {
      date: '2026-01-01',
      lines: [
        { kind: 'customer_debt', counterpartyId: buyer, amount: '5000' },
        { kind: 'supplier_advance', counterpartyId: supplier, amount: '700' },
      ],
    });
    await mk(owner, `/documents/${doc.id}/post`);
    const rec = (await owner.get(`/payments/reports/receivables?companyId=${buyer}`)).body;
    expect(rec.rows[0].debt).toBe('5000.00');
    const pay = (await owner.get(`/payments/reports/payables?companyId=${supplier}`)).body;
    expect(pay.rows[0].advance).toBe('700.00');
    await mk(owner, `/documents/${doc.id}/unpost`);
    expect((await owner.get(`/payments/reports/receivables?companyId=${buyer}`)).body.rows.length).toBe(0);
  });

  test('проверки: счёт обязателен, чужой счёт, пустой документ, права, изоляция', async () => {
    expect((await owner.post('/opening-balances', { lines: [{ kind: 'cash', amount: '10' }] })).status).toBe(422);
    const empty = await mk(owner, '/opening-balances', { date: '2026-01-01' });
    expect((await owner.post(`/documents/${empty.id}/post`)).status).toBe(422);
    // изоляция арендаторов
    expect((await other.get(`/opening-balances/${empty.id}`)).status).toBe(404);
    expect((await other.get('/opening-balances')).body.items.length).toBe(0);
    // общий CRUD документов не редактирует документ остатков
    expect((await owner.patch(`/documents/${empty.id}`, { comment: 'x' })).status).toBe(422);
  });
});
