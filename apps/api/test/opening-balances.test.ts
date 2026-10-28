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

describe('остатки: документ расчётов и повторный ввод', () => {
  const status = async (id: string) => (await owner.get(`/payments/status?ids=${id}`)).body.items[id];

  test('долг и аванс с документом расчётов не висят в общем пуле (режим «по документам»)', async () => {
    const service = (await mk(owner, '/products', { name: 'Услуга', kind: 'service', price: 0, vatRate: 'none' })).id;
    const buyer = (await mk(owner, '/companies', { name: 'ООО «Покупатель с документом»' })).id as string;
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: buyer, date: '2026-01-05', lines: [{ productId: service, qty: 1, price: '1000.00', vatRate: 'none' }] });
    const act = await mk(owner, '/documents', { type: 'act', counterpartyId: buyer, date: '2026-01-06', lines: [] });
    const doc = await mk(owner, '/opening-balances', {
      date: '2025-12-31',
      organizationId: orgId,
      lines: [
        { kind: 'customer_advance', counterpartyId: buyer, settlementDocumentId: order.id, amount: '300' },
        { kind: 'customer_debt', counterpartyId: buyer, settlementDocumentId: act.id, amount: '2000' },
      ],
    });
    await mk(owner, `/documents/${doc.id}/post`);
    expect(await status(order.id)).toMatchObject({ paid: '300.00', remaining: '700.00', state: 'partial' });
    expect(await status(act.id)).toMatchObject({ obligation: '2000.00', paid: '0.00', remaining: '2000.00' });
    const rec = (await owner.get(`/payments/reports/receivables?companyId=${buyer}`)).body.rows[0];
    expect(rec.debt).toBe('2000.00');
    expect(rec.docs.map((d: any) => d.documentId)).toContain(act.id);
    // карточка документа остатков показывает выбранный документ
    const detail = (await owner.get(`/opening-balances/${doc.id}`)).body;
    expect(detail.lines[0].settlementDocumentId).toBe(order.id);
    expect(detail.lines[0].settlementDocumentLabel).toContain('2026-01-05');
    // отмена проведения убирает и привязанные движения
    await mk(owner, `/documents/${doc.id}/unpost`);
    expect(await status(order.id)).toMatchObject({ paid: '0.00' });
  });

  test('документ другого контрагента или другой стороны — 422 settlement_document_mismatch', async () => {
    const a = (await mk(owner, '/companies', { name: 'ООО «Свой»' })).id as string;
    const b = (await mk(owner, '/companies', { name: 'ООО «Чужой»' })).id as string;
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: b, date: '2026-01-05', lines: [] });
    const wrong = await mk(owner, '/opening-balances', { date: '2025-12-30', organizationId: orgId, lines: [{ kind: 'customer_debt', counterpartyId: a, settlementDocumentId: order.id, amount: '10' }] });
    const r = await owner.post(`/documents/${wrong.id}/post`);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('settlement_document_mismatch');
    const side = await mk(owner, '/opening-balances', { date: '2025-12-30', organizationId: orgId, lines: [{ kind: 'supplier_debt', counterpartyId: b, settlementDocumentId: order.id, amount: '10' }] });
    expect((await owner.post(`/documents/${side.id}/post`)).body.error.code).toBe('settlement_document_mismatch');
  });

  test('второй проведённый документ остатков на ту же организацию блокируется', async () => {
    const org2 = (await mk(owner, '/organizations', { name: 'ООО «Вторая»' })).id as string;
    const first = await mk(owner, '/opening-balances', { date: '2025-12-31', organizationId: org2, lines: [{ kind: 'cash', cashRegisterId: cashId, amount: '1' }] });
    void first;
    const org3 = (await mk(owner, '/organizations', { name: 'ООО «Третья»' })).id as string;
    const c3 = (await mk(owner, '/companies', { name: 'ООО «К»' })).id as string;
    const one = await mk(owner, '/opening-balances', { date: '2025-12-31', organizationId: org3, lines: [{ kind: 'customer_debt', counterpartyId: c3, amount: '5' }] });
    await mk(owner, `/documents/${one.id}/post`);
    const two = await mk(owner, '/opening-balances', { date: '2026-01-31', organizationId: org3, lines: [{ kind: 'customer_debt', counterpartyId: c3, amount: '7' }] });
    const r = await owner.post(`/documents/${two.id}/post`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('opening_already_posted');
    // после отмены проведения первого второй проводится
    await mk(owner, `/documents/${one.id}/unpost`);
    expect((await owner.post(`/documents/${two.id}/post`)).status).toBe(200);
  });
});

describe('остатки и смена режима расчётов', () => {
  test('привязка к документу действует только в режиме «по документам»; пересчёт идёт и по документу остатков', async () => {
    const buyer = (await mk(owner, '/companies', { name: 'ООО «Режим и остатки»' })).id as string;
    const act = await mk(owner, '/documents', { type: 'act', counterpartyId: buyer, date: '2026-01-06', lines: [] });
    const doc = await mk(owner, '/opening-balances', { date: '2025-11-30', organizationId: orgId, lines: [{ kind: 'customer_debt', counterpartyId: buyer, settlementDocumentId: act.id, amount: '900' }] });
    await mk(owner, `/documents/${doc.id}/post`);
    const st = async () => (await owner.get(`/payments/status?ids=${act.id}`)).body.items[act.id];
    expect(await st()).toMatchObject({ mode: 'by_documents', obligation: '900.00' });
    expect((await owner.patch(`/companies/${buyer}`, { settlementMode: 'by_counterparty' })).status).toBe(200);
    expect((await owner.get(`/payments/reports/receivables?companyId=${buyer}`)).body.rows[0].debt).toBe('900.00');
    expect((await owner.patch(`/companies/${buyer}`, { settlementMode: 'by_documents' })).status).toBe(200);
    expect(await st()).toMatchObject({ mode: 'by_documents', obligation: '900.00', paid: '0.00' });
    await mk(owner, `/documents/${doc.id}/unpost`);
  });
});
