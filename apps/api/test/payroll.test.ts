/* Зарплата (задача 1184): оклад по графику с исключением, сдельная как в отчёте выработки, процент от продаж,
   затраты в закрытии месяца без двойного счёта сдельщины, ведомость и выплата из кассы и банка, права, изоляция, закрытый период. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { admin, Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let memberId: string;
let ownerMemberId: string;
let kinds: Record<string, string> = {};
let reflectionId: string;
let operation: string;
let orgId: string;
let cashId: string;
let bankId: string;
let payrollId: string;
let statementId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Payroll WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other payroll WS' });

  const ms = (await owner.get('/members')).body.items;
  memberId = ms.find((m: any) => m.userId === member.user!.id).id;
  ownerMemberId = ms.find((m: any) => m.userId === owner.user!.id).id;
  orgId = (await owner.get('/organizations')).body.items[0].id;
  cashId = (await mk(owner, '/cash-registers', { name: 'Касса' })).id;
  bankId = (await mk(owner, `/organizations/${orgId}/bank-accounts`, { bik: '044525225', account: '40702810400000000001', bankName: 'Тест-банк' })).id;
  kinds = Object.fromEntries((await owner.get('/payroll/kinds')).body.items.map((k: any) => [k.systemKey, k.id]));
  const costItem = (await mk(owner, '/cost-items', { name: 'Зарплата', kind: 'expense' })).id;
  const reflections = (await mk(owner, '/payroll/reflections', { name: 'Зарплата цеха', costItemId: costItem })).items;
  reflectionId = reflections[0].id;
  operation = (await mk(owner, '/products', { name: 'Сборка', kind: 'operation', vatRate: 'none' })).id;
  await mk(owner, '/production/operation-rates', { productId: operation, validFrom: '2026-01-01', rate: '100', unit: 'per_unit' });
});

const put = async (id: string, patch: Record<string, unknown>) => {
  const r = await owner.put(`/payroll/employees/${id}`, patch);
  expect(r.status).toBe(200);
};

describe('зарплата', () => {
  test('кадровые данные и плановые начисления', async () => {
    await put(memberId, { reflectionId, ndflRate: '13', cardAccount: '40817810000000000001', advancePercent: '40' });
    await put(ownerMemberId, { reflectionId, ndflRate: '13' });
    await mk(owner, '/payroll/accruals', { memberId, kindId: kinds.salary, validFrom: '2026-01-01', amount: '100000' });
    await mk(owner, '/payroll/accruals', { memberId, kindId: kinds.sales_percent, validFrom: '2026-01-01', percent: '5', percentBasis: 'revenue' });
    const emp = (await owner.get('/payroll/employees')).body.items.find((e: any) => e.memberId === memberId);
    expect(emp.accruals.length).toBe(2);
    expect((await owner.patch('/payroll/settings', { insuranceRate: '30' })).body.insuranceRate).toBe('30.00');
  });

  test('начисление за месяц: оклад по графику с исключением, сдельная, процент от продаж', async () => {
    // сентябрь 2026: 22 рабочих дня; исключение (отпуск) 14–18 сентября — 5 рабочих дней
    await mk(owner, '/production/calendar-exceptions', { scope: 'member', scopeId: memberId, dateFrom: '2026-09-14', dateTo: '2026-09-18', note: 'Отпуск' });
    // сдельный наряд 400 ₽ (4 × 100)
    const pw = await mk(owner, '/production/piecework', { date: '2026-09-10', memberId, lines: [{ operationId: operation, qty: '4' }] });
    expect((await owner.post(`/documents/${pw.id}/post`)).status).toBe(200);
    // выручка ответственного: акт на 20 000
    const service = (await mk(owner, '/products', { name: 'Услуга', kind: 'service', price: 20000, vatRate: 'none' })).id;
    const cp = (await mk(owner, '/companies', { name: 'ООО Заказчик' })).id;
    const act = await mk(owner, '/documents', { type: 'act', date: '2026-09-12', counterpartyId: cp, responsibleId: memberId, lines: [{ productId: service, qty: 1, price: 20000 }] });
    expect((await owner.post(`/documents/${act.id}/post`)).status).toBe(200);

    const doc = await mk(owner, '/payroll/documents', { period: '2026-09-01' });
    payrollId = doc.id;
    expect(doc.date).toBe('2026-09-30');
    const filled = (await owner.post(`/payroll/documents/${payrollId}/fill`, {})).body;
    const line = (key: string) => filled.lines.find((l: any) => l.memberId === memberId && l.kindId === kinds[key]);

    const salary = line('salary');
    expect(salary.workedDays).toBe(17);
    expect(salary.normDays).toBe(22);
    expect(salary.amount).toBe('77272.73');
    expect(salary.ndfl).toBe('10045.45');

    // сдельная совпадает с отчётом выработки
    const report = (await owner.get('/production/piecework/report?from=2026-09-01&to=2026-09-30')).body;
    const reported = report.rows ? report.rows : report.items ?? report;
    const reportedSum = (reported as any[]).filter(r => r.memberId === memberId).reduce((s, r) => s + Number(r.amount), 0);
    expect(reportedSum).toBe(400);
    expect(line('piecework').amount).toBe('400.00');

    // процент от продаж: 5 % от выручки ответственного
    expect(line('sales_percent').base).toBe('20000.00');
    expect(line('sales_percent').amount).toBe('1000.00');
    expect(filled.totals.accrued).toBe('78672.73');
  });

  test('проведение: долг растёт, затраты — без сдельной, взносы — со всего', async () => {
    const res = await owner.post(`/documents/${payrollId}/post`);
    expect(res.status).toBe(200);
    const rows: any[] = await admin`select kind, amount from payroll_moves where document_id = ${payrollId}`;
    const sum = (k: string) => rows.filter(r => r.kind === k).reduce((s, r) => s + Number(r.amount), 0);
    expect(sum('accrual')).toBeCloseTo(78672.73, 2);
    expect(sum('ndfl')).toBeLessThan(0);
    // затраты: оклад 77272.73 + процент 1000 + взносы 30 % от 78672.73 (включая 400 сдельной), но не сама сдельная
    const costs: any[] = await admin`select amount from period_costs where document_id = ${payrollId}`;
    const total = costs.reduce((s, r) => s + Number(r.amount), 0);
    expect(total).toBeCloseTo(77272.73 + 1000 + 78672.73 * 0.3, 1);
    const [pc] = await admin`select source, period from period_costs where document_id = ${payrollId}`;
    expect(pc!.source).toBe('payroll');
  });

  test('ведомость и выплата из кассы гасят долг', async () => {
    const st = await mk(owner, '/payroll/statements', { period: '2026-09-01', kind: 'settlement', method: 'cash' });
    statementId = st.id;
    const filled = (await owner.post(`/payroll/statements/${statementId}/fill`)).body;
    const l = filled.lines.find((x: any) => x.memberId === memberId);
    const net = 78672.73 - Number(filled.lines.length ? 0 : 0);
    expect(Number(l.amount)).toBeLessThan(net);
    // нельзя оплатить непроведённую
    expect((await owner.post(`/payroll/statements/${statementId}/pay`, { cashRegisterId: cashId })).status).toBe(422);
    expect((await owner.post(`/documents/${statementId}/post`)).status).toBe(200);
    const pay = await owner.post(`/payroll/statements/${statementId}/pay`, { cashRegisterId: cashId });
    expect(pay.status).toBe(201);
    const payment = (await owner.get(`/payments/${pay.body.paymentId}`)).body;
    expect(payment.operation).toBe('salary_payment');
    expect(payment.type).toBe('cash_payment');
    const pp = await owner.post(`/documents/${pay.body.paymentId}/post`);
    expect([pp.status, pp.body?.error?.code]).toEqual([200, undefined]);
    const after = (await owner.get(`/payroll/statements/${statementId}`)).body;
    expect(after.payState).toBe('paid');
    // повторная выплата на ту же ведомость — нечего платить
    expect((await owner.post(`/payroll/statements/${statementId}/pay`, { cashRegisterId: cashId })).status).toBe(422);
    // отмена проведения ведомости с платежом запрещена
    expect((await owner.post(`/documents/${statementId}/unpost`)).status).toBe(409);

    const rep = (await owner.get('/payroll/reports/settlements?from=2026-09-01&to=2026-12-31')).body;
    const row = rep.items.find((r: any) => r.memberId === memberId);
    expect(row.closing).toBe('0.00');
    expect(row.accrued).toBe('78672.73');
    expect(Number(row.paid)).toBeGreaterThan(0);
  });

  test('аванс через банк и зарплатный реестр', async () => {
    await mk(owner, '/payroll/accruals', { memberId, kindId: kinds.salary, validFrom: '2026-10-01', amount: '100000' });
    const st = await mk(owner, '/payroll/statements', { period: '2026-10-01', kind: 'advance', method: 'bank' });
    const filled = (await owner.post(`/payroll/statements/${st.id}/fill`)).body;
    expect(filled.lines.find((x: any) => x.memberId === memberId).amount).toBe('40000.00');
    await mk(owner, `/documents/${st.id}/post`);
    const reg = await owner.get(`/payroll/statements/${st.id}/registry`);
    expect(reg.status).toBe(200);
    expect(String(reg.body)).toContain('40817810000000000001;40000.00');
    const pay = await owner.post(`/payroll/statements/${st.id}/pay`, { bankAccountId: bankId });
    expect(pay.status).toBe(201);
    expect((await owner.get(`/payments/${pay.body.paymentId}`)).body.type).toBe('bank_payment');
    const pp = await owner.post(`/documents/${pay.body.paymentId}/post`);
    expect([pp.status, pp.body?.error?.code]).toEqual([200, undefined]);
  });

  test('права: сотрудник видит свой листок, но не суммы других; изоляция арендаторов', async () => {
    expect((await member.get('/payroll/employees')).status).toBe(403);
    expect((await member.get(`/payroll/documents/${payrollId}`)).status).toBe(403);
    expect((await member.get(`/documents/${payrollId}`)).status).toBe(403);
    const own = await member.get('/payroll/payslip?period=2026-09-01');
    expect(own.status).toBe(200);
    expect(own.body.memberId).toBe(memberId);
    expect(own.body.totals.accrued).toBe('78672.73');
    expect((await member.get(`/payroll/payslip?period=2026-09-01&memberId=${ownerMemberId}`)).status).toBe(403);
    // выплаты зарплаты в оплатах скрыты от участника
    const list = (await member.get('/payments?type=cash_payment')).body;
    expect(list.items.some((i: any) => i.operation === 'salary_payment')).toBe(false);

    expect((await other.get('/payroll/documents')).body.items.length).toBe(0);
    expect((await other.get(`/payroll/documents/${payrollId}`)).status).toBeGreaterThanOrEqual(404);
    expect((await other.get('/payroll/reports/settlements?from=2026-01-01&to=2026-12-31')).body.items.length).toBe(0);
  });

  test('печатные формы: платёжная ведомость и расчётный листок', async () => {
    const st = await owner.get(`/payroll/statements/${statementId}/print`);
    expect(st.status).toBe(200);
    expect(String(st.body)).toContain('Т-53');
    expect((await member.get(`/payroll/statements/${statementId}/print`)).status).toBe(403);
    const slip = await member.get('/payroll/payslip/print?period=2026-09-01');
    expect(slip.status).toBe(200);
    expect(String(slip.body)).toContain('Расчётный листок');
  });

  test('закрытый период: проведение запрещено', async () => {
    const doc = await mk(owner, '/payroll/documents', { period: '2026-08-01' });
    await mk(owner, `/payroll/documents/${doc.id}/fill`, {});
    expect((await owner.patch('/production/periods/settings', { closedThrough: '2026-08-31' })).status).toBe(200);
    const res = await owner.post(`/documents/${doc.id}/post`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('period_closed');
    await owner.patch('/production/periods/settings', { closedThrough: null });
  });
});
