/* Платёжный календарь (1174г): заявка на расход (подача, согласование, оплата на основании, возврат состояния),
   плановые поступления и платежи по неоплаченным документам, прогноз остатка и кассовый разрыв, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let expenseItem: string;

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const company = async (name: string) => (await mk(owner, '/companies', { name })).id as string;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function request(counterpartyId: string, amount: number, extra: Record<string, unknown> = {}, submit = true) {
  const r = await mk(owner, '/payment-requests', { counterpartyId, lines: [{ amount, cashFlowItemId: expenseItem }], ...extra });
  if (submit) await mk(owner, `/documents/${r.id}/post`);
  return r.id as string;
}
const detail = async (id: string) => (await owner.get(`/payment-requests/${id}`)).body;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Calendar WS' });
  other = new Client();
  await other.signup({ workspaceName: 'Other calendar WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  const orgId = (await owner.get("/organizations")).body.items[0].id;
  await mk(owner, `/organizations/${orgId}/bank-accounts`, { bik: "044525225", account: "40702810400000000001", bankName: "Тест-банк" });
  expenseItem = (await mk(owner, '/cash-flow-items', { name: 'Аренда', kind: 'expense' })).id;
});

describe('заявка на расход', () => {
  test('подача, согласование, оплата на основании, возврат состояния при отмене проведения оплаты', async () => {
    const s = await company('ООО «Арендодатель»');
    const id = await request(s, 1000, {}, false);
    expect((await detail(id)).state).toBeNull();
    // из черновика согласовать нельзя
    expect((await owner.post(`/payment-requests/${id}/state`, { state: 'approved' })).status).toBe(422);
    await mk(owner, `/documents/${id}/post`);
    let d = await detail(id);
    expect(d).toMatchObject({ state: 'pending', status: 'posted', total: '1000.00' });
    expect(d.number).toMatch(/^ЗР-/);
    // оплата до согласования запрещена
    expect((await owner.post(`/payment-requests/${id}/pay`, { account: 'bank' })).status).toBe(422);
    // участник без прав admin согласовать не может
    expect((await member.post(`/payment-requests/${id}/state`, { state: 'approved' })).status).toBe(422);
    expect((await mk(owner, `/payment-requests/${id}/state`, { state: 'approved' })).state).toBe('approved');
    // согласованную заявку нельзя снять с проведения
    expect((await owner.post(`/documents/${id}/unpost`)).status).toBe(409);

    const pay = await mk(owner, `/payment-requests/${id}/pay`, { account: 'bank' });
    expect(pay).toMatchObject({ type: 'bank_payment', basedOnId: id, total: '1000.00', operation: 'to_supplier' });
    // второй черновик не создаётся: остаток уже занят черновиком оплаты
    expect((await owner.post(`/payment-requests/${id}/pay`, { account: 'bank' })).status).toBe(422);
    await mk(owner, `/documents/${pay.id}/post`);
    d = await detail(id);
    expect(d).toMatchObject({ state: 'paid', paid: '1000.00', remaining: '0.00' });
    await mk(owner, `/documents/${pay.id}/unpost`);
    expect((await detail(id)).state).toBe('approved');
  });

  test('частичная оплата оставляет заявку согласованной; сумма оплат не превышает заявку', async () => {
    const s = await company('ООО «Подрядчик»');
    const id = await request(s, 1000);
    await mk(owner, `/payment-requests/${id}/state`, { state: 'approved' });
    const pay = await mk(owner, `/payment-requests/${id}/pay`, { account: 'bank' });
    await owner.patch(`/payments/${pay.id}`, { lines: [{ id: pay.lines[0].id, amount: 400, cashFlowItemId: expenseItem }] });
    await mk(owner, `/documents/${pay.id}/post`);
    let d = await detail(id);
    expect(d).toMatchObject({ state: 'approved', paid: '400.00', remaining: '600.00', payable: '600.00' });
    const rest = await mk(owner, `/payment-requests/${id}/pay`, { account: 'bank' });
    expect(rest.total).toBe('600.00');
    await mk(owner, `/documents/${rest.id}/post`);
    expect((await detail(id)).state).toBe('paid');
  });

  test('отклонённую можно вернуть на согласование; платить отклонённую нельзя', async () => {
    const s = await company('ООО «Отказ»');
    const id = await request(s, 50);
    await mk(owner, `/payment-requests/${id}/state`, { state: 'rejected' });
    expect((await owner.post(`/payment-requests/${id}/pay`, { account: 'bank' })).status).toBe(422);
    expect((await mk(owner, `/payment-requests/${id}/state`, { state: 'pending' })).state).toBe('pending');
  });

  test('обычные маршруты документов не правят заявку; чужой арендатор её не видит', async () => {
    const s = await company('ООО «Изоляция»');
    const id = await request(s, 10, {}, false);
    expect((await owner.patch(`/documents/${id}`, { comment: 'x' })).status).toBe(422);
    expect((await other.get(`/payment-requests/${id}`)).status).toBe(404);
    expect((await other.get('/payment-requests')).body.items.length).toBe(0);
  });
});

describe('платёжный календарь', () => {
  test('плановые поступления и платежи, заявки без двойного счёта, кассовый разрыв', async () => {
    // чистый воркспейс: свои остатки и документы
    const c = new Client();
    await c.signup({ workspaceName: 'Calendar clean WS' });
    const svc = (await mk(c, '/products', { name: 'Услуга', kind: 'service', price: 0, vatRate: 'none' })).id;
    const orgId = (await c.get('/organizations')).body.items[0].id;
    const bank = (await mk(c, `/organizations/${orgId}/bank-accounts`, { bik: '044525225', account: '40702810400000000002', bankName: 'Банк' })).id;
    const item = (await mk(c, '/cash-flow-items', { name: 'Аренда', kind: 'expense' })).id;
    const cal = async (q = '') => (await c.get(`/payment-calendar?days=30${q}`)).body;

    // остаток 1000 на счёте
    const inc = await mk(c, '/payments', { type: 'bank_receipt', bankAccountId: bank, operation: 'other_income', date: day(-1), lines: [{ amount: 1000, cashFlowItemId: (await mk(c, '/cash-flow-items', { name: 'Проценты', kind: 'income' })).id }] });
    await mk(c, `/documents/${inc.id}/post`);
    expect((await cal()).opening.total).toBe('1000.00');

    // покупатель должен 500, срок через 5 дней; поставщик: мы должны 2000, срок через 3 дня
    const buyer = (await mk(c, '/companies', { name: 'Покупатель' })).id;
    const sup = (await mk(c, '/companies', { name: 'Поставщик' })).id;
    const a = await mk(c, '/documents', { type: 'act', counterpartyId: buyer, date: day(-2), dueDate: day(5), lines: [{ productId: svc, qty: 1, price: '500', vatRate: 'none' }] });
    await mk(c, `/documents/${a.id}/post`);
    const r = await mk(c, '/documents', { type: 'receipt', counterpartyId: sup, date: day(-2), dueDate: day(3), lines: [{ productId: svc, qty: 1, price: '2000', vatRate: 'none' }] });
    await mk(c, `/documents/${r.id}/post`);

    let k = await cal();
    expect(k.items.map((i: any) => [i.direction, i.amount, i.date])).toEqual([['out', '2000.00', day(3)], ['in', '500.00', day(5)]]);
    expect(k.firstGap).toMatchObject({ date: day(3), balance: '-1000.00' });
    expect(k.days.find((d: any) => d.date === day(5)).balance).toBe('-500.00');
    expect(k.totals).toEqual({ in: '500.00', out: '2000.00' });
    expect(k.minBalance).toBe('-1000.00');

    // заявка на оплату этого же поставщика (привязана к поступлению) не удваивает платёж
    const req = await mk(c, '/payment-requests', { counterpartyId: sup, dueDate: day(10), lines: [{ amount: 2000, cashFlowItemId: item, settlementDocumentId: r.id }] });
    await mk(c, `/documents/${req.id}/post`);
    k = await cal();
    expect(k.items.filter((i: any) => i.direction === 'out').map((i: any) => [i.source, i.amount, i.date])).toEqual([['request', '2000.00', day(10)]]);
    expect(k.totals.out).toBe('2000.00');
    // заявка на согласовании — по флагу
    expect((await cal('&includePending=false')).items.filter((i: any) => i.source === 'request').length).toBe(0);
    await mk(c, `/payment-requests/${req.id}/state`, { state: 'approved' });
    expect((await cal('&includePending=false')).items.filter((i: any) => i.source === 'request').length).toBe(1);

    // просроченный документ попадает на сегодня
    const late = await mk(c, '/documents', { type: 'act', counterpartyId: buyer, date: day(-30), dueDate: day(-10), lines: [{ productId: svc, qty: 1, price: '100', vatRate: 'none' }] });
    await mk(c, `/documents/${late.id}/post`);
    k = await cal();
    const lateItem = k.items.find((i: any) => i.documentId === late.id);
    expect(lateItem).toMatchObject({ overdue: true, date: day(0), direction: 'in' });
  });

  test('фильтр по организации и изоляция арендаторов', async () => {
    const k = (await other.get('/payment-calendar?days=10')).body;
    expect(k.items).toEqual([]);
    expect(k.days.length).toBe(10);
  });
});
