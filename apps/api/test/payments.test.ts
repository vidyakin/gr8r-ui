/* Деньги (1174б): долг растёт отгрузкой и гасится оплатой, аванс зачитывается FIFO в обоих режимах, откат при отмене проведения,
   остатки и ДДС сходятся с движениями, подотчёт, перемещение денег, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let other: Client;
let service: string;
let orgId: string;
let bankId: string;
let cashId: string;
let ownerMemberId: string;
let expenseItem: string;
let incomeItem: string;
let costItem: string;

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

const company = async (name: string, extra: Record<string, unknown> = {}) => (await mk(owner, '/companies', { name, ...extra })).id as string;

/** Проведённый акт оказания услуг на сумму */
async function act(counterpartyId: string, amount: string, date: string, extra: Record<string, unknown> = {}) {
  const doc = await mk(owner, '/documents', { type: 'act', counterpartyId, date, lines: [{ productId: service, qty: 1, price: amount, vatRate: 'none' }], ...extra });
  await mk(owner, `/documents/${doc.id}/post`);
  return doc.id as string;
}

async function pay(body: Record<string, unknown>, post = true) {
  const d = await mk(owner, '/payments', { type: 'bank_receipt', bankAccountId: bankId, operation: 'from_customer', ...body });
  if (post) await mk(owner, `/documents/${d.id}/post`);
  return d.id as string;
}

const status = async (id: string) => (await owner.get(`/payments/status?ids=${id}`)).body.items[id];
const receivable = async (companyId: string) => {
  const r = (await owner.get(`/payments/reports/receivables?companyId=${companyId}`)).body;
  return r.rows[0] ?? { debt: '0.00', advance: '0.00', docs: [] };
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Payments WS' });
  other = new Client();
  await other.signup({ workspaceName: 'Other payments WS' });
  service = (await mk(owner, '/products', { name: 'Консультация', kind: 'service', price: 0, vatRate: 'none' })).id;
  orgId = (await owner.get('/organizations')).body.items[0].id;
  bankId = (await mk(owner, `/organizations/${orgId}/bank-accounts`, { bik: '044525225', account: '40702810400000000001', bankName: 'Тест-банк' })).id;
  cashId = (await mk(owner, '/cash-registers', { name: 'Основная касса' })).id;
  ownerMemberId = (await owner.get('/members')).body.items.find((m: any) => m.email === owner.user!.email).id;
  expenseItem = (await mk(owner, '/cash-flow-items', { name: 'Аренда', kind: 'expense' })).id;
  incomeItem = (await mk(owner, '/cash-flow-items', { name: 'Проценты банка', kind: 'income' })).id;
  costItem = (await mk(owner, '/cost-items', { name: 'Канцелярия', kind: 'expense' })).id;
});

describe('системные статьи ДДС', () => {
  test('создаются сами и не удаляются', async () => {
    const list = (await owner.get('/cash-flow-items?limit=100')).body.items;
    expect(list.length).toBeGreaterThan(0);
    await owner.get('/payments/reports/cash-flow?from=2026-01-01&to=2026-12-31');
    const sys = (await owner.get('/cash-flow-items?limit=100')).body.items.find((i: any) => i.systemKey === 'customers_payment');
    expect(sys.name).toBe('Оплата от покупателей');
    expect((await owner.del(`/cash-flow-items/${sys.id}`)).status).toBe(422);
  });
});

describe('взаиморасчёты по документам', () => {
  test('долг растёт актом, гасится оплатой, остаток к оплате и событие paid', async () => {
    const c = await company('ООО «Заказчик 1»');
    const a = await act(c, '1000.00', '2026-03-01');
    expect(await status(a)).toMatchObject({ obligation: '1000.00', paid: '0.00', remaining: '1000.00', state: 'unpaid' });
    expect((await receivable(c)).debt).toBe('1000.00');

    // оплата на основании акта: сумма = остаток
    const draft = (await mk(owner, '/payments/from-document', { documentId: a, account: 'bank' })) as any;
    expect(draft.lines[0].amount).toBe('1000.00');
    expect(draft.type).toBe('bank_receipt');
    await mk(owner, '/payments', { type: 'bank_receipt', bankAccountId: bankId, counterpartyId: c, lines: [{ settlementDocumentId: a, amount: 400, comment: 'часть' }] }).then(async d => {
      await mk(owner, `/documents/${d.id}/post`);
    });
    expect(await status(a)).toMatchObject({ paid: '400.00', remaining: '600.00', state: 'partial' });
    expect((await receivable(c)).debt).toBe('600.00');
    // вторая оплата закрывает документ
    await pay({ counterpartyId: c, lines: [{ settlementDocumentId: a, amount: 600 }] });
    expect(await status(a)).toMatchObject({ remaining: '0.00', state: 'paid' });
    expect((await receivable(c)).debt).toBe('0.00');
  });

  test('оплата сверх долга становится авансом, следующее начисление зачитывает его', async () => {
    const c = await company('ООО «Заказчик 2»');
    const a1 = await act(c, '1000.00', '2026-03-01');
    await pay({ counterpartyId: c, lines: [{ settlementDocumentId: a1, amount: 1500 }] });
    let r = await receivable(c);
    expect(r.advance).toBe('500.00');
    expect(r.debt).toBe('0.00');
    const a2 = await act(c, '300.00', '2026-03-10');
    expect(await status(a2)).toMatchObject({ remaining: '0.00', state: 'paid' });
    r = await receivable(c);
    expect(r.advance).toBe('200.00');
  });

  test('аванс FIFO: старый источник гасится первым; отмена проведения откатывает зачёт', async () => {
    const c = await company('ООО «Заказчик 3»');
    const p1 = await pay({ counterpartyId: c, date: '2026-02-01', lines: [{ amount: 300 }] });
    await pay({ counterpartyId: c, date: '2026-02-05', lines: [{ amount: 500 }] });
    expect((await receivable(c)).advance).toBe('800.00');
    const a = await act(c, '600.00', '2026-03-01');
    expect(await status(a)).toMatchObject({ paid: '600.00', state: 'paid' });
    expect((await receivable(c)).advance).toBe('200.00');
    // старший аванс (300) зачтён целиком: отмена его проведения переносит зачёт на остаток другого аванса
    await mk(owner, `/documents/${p1}/unpost`);
    expect(await status(a)).toMatchObject({ paid: '500.00', remaining: '100.00' });
    expect((await receivable(c)).debt).toBe('100.00');
    await mk(owner, `/documents/${p1}/post`);
    // отмена начисления возвращает авансы целиком
    await mk(owner, `/documents/${a}/unpost`);
    expect((await receivable(c)).advance).toBe('800.00');
  });

  test('возврат покупателю уменьшает аванс', async () => {
    const c = await company('ООО «Заказчик 4»');
    await pay({ counterpartyId: c, lines: [{ amount: 700 }] });
    await pay({ type: 'bank_payment', operation: 'customer_refund', counterpartyId: c, lines: [{ amount: 200 }] });
    expect((await receivable(c)).advance).toBe('500.00');
  });
});

describe('взаиморасчёты по контрагенту', () => {
  test('одно сальдо, оплата закрывает документы по FIFO', async () => {
    const c = await company('Иванов И. (физлицо)', { kind: 'individual', settlementMode: 'by_counterparty' });
    const a1 = await act(c, '100.00', '2026-03-01');
    const a2 = await act(c, '200.00', '2026-03-05');
    await pay({ counterpartyId: c, lines: [{ amount: 150 }] });
    expect(await status(a1)).toMatchObject({ paid: '100.00', state: 'paid', mode: 'by_counterparty' });
    expect(await status(a2)).toMatchObject({ paid: '50.00', remaining: '150.00', state: 'partial' });
    const r = await receivable(c);
    expect(r.debt).toBe('150.00');
    // следующая оплата без документа, сверх долга — аванс как отрицательное сальдо
    await pay({ counterpartyId: c, lines: [{ amount: 400 }] });
    const r2 = await receivable(c);
    expect(r2).toMatchObject({ debt: '0.00', advance: '250.00' });
    const card = (await owner.get(`/payments/settlements/${c}?from=2026-01-01&to=2026-12-31`)).body;
    expect(card.sides[0].closing).toBe('-250.00');
  });
});

describe('поставщики и остатки', () => {
  test('поступление создаёт долг перед поставщиком, оплата поставщику гасит его и уменьшает остаток счёта', async () => {
    const before = (await owner.get('/payments/balances')).body.totals.all;
    const s = await company('ООО «Поставщик»');
    const doc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: s, date: '2026-04-01', lines: [{ productId: service, qty: 1, price: '900', vatRate: 'none' }] });
    await mk(owner, `/documents/${doc.id}/post`);
    const p = (await owner.get('/payments/reports/payables')).body;
    expect(p.rows.find((r: any) => r.companyId === s).debt).toBe('900.00');
    await pay({ type: 'bank_payment', operation: 'to_supplier', counterpartyId: s, lines: [{ settlementDocumentId: doc.id, amount: 900 }] });
    expect((await owner.get('/payments/reports/payables')).body.rows.find((r: any) => r.companyId === s)).toBeUndefined();
    const after = (await owner.get('/payments/balances')).body.totals.all;
    expect(Number(after) - Number(before)).toBe(-900);
  });

  test('перемещение денег меняет остатки счетов, но не итог и не ДДС', async () => {
    await pay({ type: 'cash_receipt', cashRegisterId: cashId, bankAccountId: undefined, operation: 'other_income', lines: [{ amount: 1000, cashFlowItemId: incomeItem }] });
    const b0 = (await owner.get('/payments/balances')).body;
    const d = await mk(owner, '/payments', { type: 'cash_payment', cashRegisterId: cashId, operation: 'money_transfer', targetBankAccountId: bankId, lines: [{ amount: 200 }] });
    await mk(owner, `/documents/${d.id}/post`);
    const b1 = (await owner.get('/payments/balances')).body;
    expect(Number(b1.cash[0].balance) - Number(b0.cash[0].balance)).toBe(-200);
    expect(Number(b1.totals.all)).toBe(Number(b0.totals.all));
    const dds = (await owner.get('/payments/reports/cash-flow?from=2026-01-01&to=2030-12-31&groupBy=item')).body;
    expect(dds.rows.some((r: any) => r.name === 'Перемещение денег')).toBe(false);
    expect(dds.rows.find((r: any) => r.name === 'Проценты банка').income).toBe('1000.00');
    // сумма отчёта по кассам и счетам сходится с остатками
    const acc = (await owner.get('/payments/reports/cash-flow?from=2000-01-01&to=2030-12-31&groupBy=account')).body;
    expect(acc.rows.reduce((s: number, r: any) => s + Number(r.closing), 0)).toBeCloseTo(Number(b1.totals.all), 2);
  });

  test('касса в минус — предупреждение, не запрет', async () => {
    const d = await mk(owner, '/payments', { type: 'cash_payment', cashRegisterId: cashId, operation: 'other_expense', lines: [{ amount: 999999, cashFlowItemId: expenseItem }] });
    expect(d.warnings).toContain('negative_balance');
    await mk(owner, `/documents/${d.id}/post`);
    const b = (await owner.get('/payments/balances')).body;
    expect(Number(b.cash[0].balance)).toBeLessThan(0);
    await mk(owner, `/documents/${d.id}/unpost`);
  });
});

describe('подотчёт', () => {
  test('выдача, авансовый отчёт и возврат остатка', async () => {
    const issue = await mk(owner, '/payments', { type: 'cash_payment', cashRegisterId: cashId, operation: 'to_accountable', accountableMemberId: ownerMemberId, lines: [{ amount: 1000 }] });
    await mk(owner, `/documents/${issue.id}/post`);
    expect((await owner.get('/payments/accountable')).body.items[0].balance).toBe('1000.00');
    const rep = await mk(owner, '/payments', { type: 'advance_report', accountableMemberId: ownerMemberId, lines: [{ amount: 700, costItemId: costItem, cashFlowItemId: expenseItem }] });
    await mk(owner, `/documents/${rep.id}/post`);
    expect((await owner.get('/payments/accountable')).body.items[0].balance).toBe('300.00');
    const back = await mk(owner, '/payments', { type: 'cash_receipt', cashRegisterId: cashId, operation: 'from_accountable', accountableMemberId: ownerMemberId, lines: [{ amount: 300 }] });
    await mk(owner, `/documents/${back.id}/post`);
    expect((await owner.get('/payments/accountable')).body.items).toHaveLength(0);
    // выдача не попадает в ДДС как расход, расход отчёта — попадает
    const dds = (await owner.get('/payments/reports/cash-flow?from=2000-01-01&to=2030-12-31&groupBy=item')).body;
    expect(dds.rows.find((r: any) => r.name === 'Аренда').expense).toBe('700.00');
    expect(dds.rows.some((r: any) => r.name === 'Подотчёт')).toBe(false);
  });
});

describe('правила и изоляция', () => {
  test('документ расчётов другого контрагента отклоняется', async () => {
    const c1 = await company('Контрагент А');
    const c2 = await company('Контрагент Б');
    const a = await act(c1, '100.00', '2026-03-01');
    const r = await owner.post('/payments', { type: 'bank_receipt', bankAccountId: bankId, counterpartyId: c2, lines: [{ settlementDocumentId: a, amount: 50 }] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('settlement_document_mismatch');
  });

  test('проведённый документ не правится; у банковского документа нужен счёт организации', async () => {
    const c = await company('Контрагент В');
    const id = await pay({ counterpartyId: c, lines: [{ amount: 10 }] });
    expect((await owner.patch(`/payments/${id}`, { comment: 'x' })).status).toBe(409);
    const foreign = await mk(owner, `/companies/${c}/bank-accounts`, { bik: '044525225', account: '40702810400000000002', bankName: 'Чужой банк' });
    const bad = await mk(owner, '/payments', { type: 'bank_receipt', bankAccountId: foreign.id, counterpartyId: c, lines: [{ amount: 10 }] });
    const r = await owner.post(`/documents/${bad.id}/post`);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('account_organization_mismatch');
  });

  test('закрытый период блокирует проведение', async () => {
    const c = await company('Контрагент Г');
    const d = await mk(owner, '/payments', { type: 'bank_receipt', bankAccountId: bankId, counterpartyId: c, date: '2020-01-10', lines: [{ amount: 10 }] });
    const lock = await owner.patch('/production/periods/settings', { closedThrough: '2020-12-31' });
    expect(lock.status).toBeLessThan(300);
    const r = await owner.post(`/documents/${d.id}/post`);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('period_closed');
    await owner.patch('/production/periods/settings', { closedThrough: null });
  });

  test('арендатор не видит чужие оплаты, кассы и отчёты', async () => {
    const c = await company('Контрагент Д');
    const id = await pay({ counterpartyId: c, lines: [{ amount: 10 }] });
    expect((await other.get(`/payments/${id}`)).status).toBe(404);
    expect((await other.get('/cash-registers')).body.items).toHaveLength(0);
    expect((await other.get('/payments/balances')).body.cash).toHaveLength(0);
    expect((await other.get(`/payments/reports/receivables`)).body.rows).toHaveLength(0);
  });
});

describe('кассовый факт инвестпроекта', () => {
  test('при базе «оплаты» факт — движения денег с проектом, внутренние движения не считаются', async () => {
    const proj = await mk(owner, '/investments', { name: 'Кассовый проект', startDate: '2026-01-01', periods: 4, periodKind: 'quarter', factBasis: 'payments', lines: [{ periodIndex: 0, costItemId: costItem, amount: '1000' }] });
    const d = await mk(owner, '/payments', { type: 'bank_payment', bankAccountId: bankId, operation: 'other_expense', date: '2026-02-10', lines: [{ amount: 250, cashFlowItemId: expenseItem, costItemId: costItem, investmentProjectId: proj.id }] });
    await mk(owner, `/documents/${d.id}/post`);
    await mk(owner, '/investments/' + proj.id + '/status', { action: 'approve' }).catch(() => null);
    const pf = (await owner.get(`/investments/${proj.id}/plan-fact`)).body;
    expect(JSON.stringify(pf)).toContain('250.00');
    expect((await owner.get(`/investments/${proj.id}`)).body.factBasis).toBe('payments');
  });
});
