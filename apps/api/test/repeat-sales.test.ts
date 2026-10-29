/* Задача 1133: повторные продажи и планирование продаж — дата следующего контакта при проведении (наименьший срок, более ранняя дата не сдвигается,
   заказ-наряд при выполнении), задача воркера (одно дело на компанию и дату, очистка даты, владелец без ответственного),
   сценарии планирования, документ «План продаж» (проведение пишет регистр), план-фактный анализ (менеджер/категория/товар, возврат, прогноз по сделкам),
   права и изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin, lostReasonId, stageId } from './helpers';
import { runNextContactsOnce } from '../../worker/src/next-contacts';
import { sql } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let ownerId: string;
let memberId: string;
let warehouse: string;
let companyA: string;
let companyB: string;
let companyC: string;
let monthly: string; // повторить через 30 дн.
let quarterly: string; // через 90 дн.
let plain: string; // без срока
let goods: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const act = async (company: string, date: string, productIds: string[]) => {
  const d = await mk(owner, '/documents', { type: 'act', counterpartyId: company, warehouseId: warehouse, date, lines: productIds.map(productId => ({ productId, qty: 1, price: 1000 })) });
  expect((await owner.post(`/documents/${d.id}/post`)).status).toBe(200);
  return d;
};
const nextOf = async (id: string) => (await owner.get(`/companies/${id}`)).body.nextContactDate as string | null;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Повторные продажи WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужие повторные продажи WS' });
  const people = (await owner.get('/members')).body.items as any[];
  memberId = people.find(m => m.email === member.user!.email).id;
  ownerId = people.find(m => m.email === owner.user!.email).id;
  warehouse = (await owner.get('/warehouses')).body.items[0].id;
  companyA = (await mk(owner, '/companies', { name: 'ООО «Альфа»' })).id;
  companyB = (await mk(owner, '/companies', { name: 'ООО «Бета»' })).id;
  companyC = (await mk(owner, '/companies', { name: 'ООО «Гамма»', ownerId: memberId })).id;
  monthly = (await mk(owner, '/products', { name: 'Замер', kind: 'service', unitCode: '876', price: 1000, vatRate: 'none', repeatSaleDays: 30 })).id;
  quarterly = (await mk(owner, '/products', { name: 'Обслуживание', kind: 'service', unitCode: '876', price: 1000, vatRate: 'none', repeatSaleDays: 90 })).id;
  plain = (await mk(owner, '/products', { name: 'Консультация', kind: 'service', unitCode: '876', price: 1000, vatRate: 'none' })).id;
  goods = (await mk(owner, '/products', { name: 'Датчик', kind: 'goods', unitCode: '796', price: 200, purchasePrice: 100, vatRate: 'none' })).id;
  expect((await owner.patch('/billing/timezone', { timezone: 'UTC' })).status).toBe(200);
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: companyA, warehouseId: warehouse, date: '2026-09-01', priceIncludesVat: false, lines: [{ productId: goods, qty: 20, price: 100 }] });
  expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
});

describe('next contact date on sale', () => {
  test('product term and company fields are stored through the existing routes', async () => {
    expect((await owner.get(`/products/${monthly}`)).body.repeatSaleDays).toBe(30);
    expect((await owner.patch(`/products/${plain}`, { repeatSaleDays: 0 })).status).toBe(400);
    const r = await owner.patch(`/companies/${companyB}`, { nextContactDate: '2030-01-01', nextContactNote: 'Позвонить' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nextContactDate: '2030-01-01', nextContactNote: 'Позвонить' });
    expect((await member.patch(`/companies/${companyB}`, { nextContactDate: null, nextContactNote: '' })).status).toBe(200);
    expect(await nextOf(companyB)).toBeNull();
  });

  test('an act sets date + the smallest term; a later date does not shift an earlier one; an earlier one moves it', async () => {
    await act(companyA, '2026-10-01', [monthly, quarterly]);
    expect(await nextOf(companyA)).toBe('2026-10-31');
    await act(companyA, '2026-10-10', [quarterly]); // 2027-01-08 позже — не сдвигает
    expect(await nextOf(companyA)).toBe('2026-10-31');
    await act(companyA, '2026-09-01', [monthly]); // 2026-10-01 раньше — ставится
    expect(await nextOf(companyA)).toBe('2026-10-01');
  });

  test('no term, no change; a realization with goods and the term of a service line counts too', async () => {
    await act(companyB, '2026-10-02', [plain]);
    expect(await nextOf(companyB)).toBeNull();
    const d = await mk(owner, '/documents', { type: 'realization', counterpartyId: companyB, warehouseId: warehouse, date: '2026-10-03', lines: [{ productId: goods, qty: 1, price: 200 }, { productId: quarterly, qty: 1, price: 100 }] });
    expect((await owner.post(`/documents/${d.id}/post`)).status).toBe(200);
    expect(await nextOf(companyB)).toBe('2027-01-01');
  });

  test('a work order sets the date when it is done; unposting leaves it', async () => {
    const wo = await mk(owner, '/documents', { type: 'work_order', counterpartyId: companyC, warehouseId: warehouse, date: '2026-10-05', lines: [{ productId: monthly, qty: 1, price: 1000 }] });
    expect(await nextOf(companyC)).toBeNull(); // черновик дату не ставит
    expect((await owner.post(`/documents/${wo.id}/state`, { state: 'done' })).status).toBe(200);
    expect(await nextOf(companyC)).toBe('2026-11-04');
    expect((await owner.post(`/documents/${wo.id}/state`, { state: 'in_progress' })).status).toBe(200);
    expect(await nextOf(companyC)).toBe('2026-11-04');
  });
});

describe('crm.next_contacts worker task', () => {
  test('creates exactly one task for the responsible member, notifies, clears the date; repeat does nothing', async () => {
    await admin`update companies set next_contact_date = null where id = ${companyA}`; // дату А проверяет последний тест группы
    await admin`update companies set next_contact_date = '2026-11-02', next_contact_note = 'Предложить продление' where id = ${companyC}`;
    expect(await runNextContactsOnce(admin, new Date('2026-11-01T10:00:00Z'))).toBe(0); // день ещё не наступил
    expect(await nextOf(companyC)).toBe('2026-11-02');
    expect(await runNextContactsOnce(admin, new Date('2026-11-02T00:30:00Z'))).toBe(1);
    expect(await nextOf(companyC)).toBeNull();
    expect((await owner.get(`/companies/${companyC}`)).body.nextContactNote).toBe('');
    const acts = await admin`select * from crm_activities where company_id = ${companyC} and subject like 'Позвонить клиенту%'`;
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ type: 'task', done: false, due_date: '2026-11-02', author_id: memberId, body: 'Предложить продление' });
    const notes = await admin`select recipient_id from notifications where workspace_id = ${ws} and text like 'Позвонить клиенту%Гамма%'`;
    expect(notes.map(n => n.recipient_id)).toEqual([memberId]);
    expect(await runNextContactsOnce(admin, new Date('2026-11-02T12:00:00Z'))).toBe(0);
    // повтор задачи с той же датой (дату вернули вручную) нового дела не создаёт, дата снова очищается
    await admin`update companies set next_contact_date = '2026-11-02' where id = ${companyC}`;
    expect(await runNextContactsOnce(admin, new Date('2026-11-02T13:00:00Z'))).toBe(0);
    expect(await nextOf(companyC)).toBeNull();
    expect(await admin`select 1 from crm_activities where company_id = ${companyC} and subject like 'Позвонить клиенту%'`).toHaveLength(1);
  });

  test('without a responsible member the workspace owner gets the task; the timezone decides the day', async () => {
    await admin`update companies set owner_id = null, next_contact_date = '2026-12-10' where id = ${companyB}`;
    expect(await owner.patch('/billing/timezone', { timezone: 'Asia/Tokyo' })).toMatchObject({ status: 200 });
    // 9 декабря 20:00 UTC — в Токио уже 10-е 05:00
    expect(await runNextContactsOnce(admin, new Date('2026-12-09T20:00:00Z'))).toBe(1);
    const acts = await admin`select author_id, due_date from crm_activities where company_id = ${companyB} and subject like 'Позвонить клиенту%'`;
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ author_id: ownerId, due_date: '2026-12-10' });
    expect(await owner.patch('/billing/timezone', { timezone: 'UTC' })).toMatchObject({ status: 200 });
    // просроченная дата тоже обрабатывается: дело создаётся один раз
    await admin`update companies set next_contact_date = '2026-10-01' where id = ${companyA}`;
    expect(await runNextContactsOnce(admin, new Date('2026-12-11T10:00:00Z'))).toBe(1);
    expect(await nextOf(companyA)).toBeNull();
  });
});

describe('planning scenarios and the sales plan document', () => {
  let scenM: string; // менеджер, по месяцам
  let scenC: string; // категория, по кварталам
  let scenP: string; // товар, по месяцам
  let x: string;
  let y: string;
  let planM: any;
  let categoryId: string;
  let service2: string;
  let wh2: string;
  const plans = (qs = '') => owner.get(`/sales-plan/plans${qs}`);
  const analysis = async (c: Client, scenarioId: string, from: string, to: string, extra = '') => {
    const r = await c.get(`/sales-plan/analysis?scenarioId=${scenarioId}&from=${from}&to=${to}${extra}`);
    if (r.status !== 200) throw new Error(`analysis ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as any;
  };

  beforeAll(async () => {
    scenM = (await mk(owner, '/sales-plan/scenarios', { name: 'По менеджерам', periodicity: 'month', dimension: 'manager' })).id;
    scenC = (await mk(owner, '/sales-plan/scenarios', { name: 'По категориям', periodicity: 'quarter', dimension: 'category' })).id;
    scenP = (await mk(owner, '/sales-plan/scenarios', { name: 'По товарам', periodicity: 'month', dimension: 'product' })).id;
    categoryId = (await mk(owner, '/product-categories', { name: 'Монтаж' })).id;
    service2 = (await mk(owner, '/products', { name: 'Монтаж стойки', kind: 'service', unitCode: '876', price: 200, vatRate: 'none', categoryId })).id;
    wh2 = (await mk(owner, '/warehouses', { name: 'Склад 2' })).id;
    // продажи 2027: ответственные — владелец (создатель документа) и участник
    x = (await mk(owner, '/companies', { name: 'ООО «Дельта»', ownerId: memberId })).id; // ответственный компании — участник
    y = (await mk(owner, '/companies', { name: 'ООО «Эпсилон»' })).id; // ответственный — владелец
    const doc = async (type: string, company: string, date: string, productId: string, qty: number, price: number, extra: Record<string, unknown> = {}) => {
      const d = await mk(owner, '/documents', { type, counterpartyId: company, warehouseId: warehouse, date, lines: [{ productId, qty, price }], ...extra });
      expect((await owner.post(`/documents/${d.id}/post`)).status).toBe(200);
      return d;
    };
    await doc('act', x, '2027-10-05', plain, 1, 1000); // ответственный документа — владелец (создатель)
    const a2 = await doc('act', x, '2027-10-06', plain, 1, 700);
    await admin`update documents set responsible_id = null where id = ${a2.id}`; // → ответственный компании: участник
    const r1 = await doc('realization', y, '2027-10-07', goods, 5, 200, { responsibleId: memberId }); // 1000 за участником
    await doc('customer_return', y, '2027-10-08', goods, 1, 200, { basedOnId: r1.id, responsibleId: memberId }); // −200 у участника
    await doc('act', y, '2027-11-02', plain, 1, 300); // другой месяц
    await doc('act', y, '2027-11-10', service2, 2, 200); // категория «Монтаж», 400
    await mk(owner, '/deals', { name: 'Won', companyId: x, ownerId: memberId, amount: 5000, stageId: await stageId(owner, 'won'), closeDate: '2027-10-20' });
    await mk(owner, '/deals', { name: 'Open', companyId: x, ownerId: ownerId, amount: 3000, stageId: await stageId(owner, 'proposal'), closeDate: '2027-10-25' });
    await mk(owner, '/deals', { name: 'Lost', companyId: x, ownerId: ownerId, amount: 900, stageId: await stageId(owner, 'lost'), lostReasonId: await lostReasonId(owner), closeDate: '2027-10-26' });
    await mk(owner, '/deals', { name: 'Nodate', companyId: x, ownerId: ownerId, amount: 800, stageId: await stageId(owner, 'lead') });
  });

  test('scenarios: only admin and owner edit them; names are unique', async () => {
    expect((await member.post('/sales-plan/scenarios', { name: 'Чужой', periodicity: 'year', dimension: 'manager' })).status).toBe(403);
    expect((await member.get('/sales-plan/scenarios')).body.items).toHaveLength(3);
    expect((await owner.post('/sales-plan/scenarios', { name: 'По менеджерам', periodicity: 'year', dimension: 'manager' })).status).toBe(409);
  });

  test('a plan document is a draft with the period normalized by the scenario; lines are validated against it', async () => {
    const line = (periodStart: string, who: string | null, amount: number) => ({ periodStart, memberId: who, amount });
    planM = await mk(owner, '/sales-plan/plans', { scenarioId: scenM, periodStart: '2027-01-15', organizationId: null, lines: [line('2027-10-01', memberId, 2500), line('2027-10-01', ownerId, 1500), line('2027-10-01', null, 100), line('2027-11-01', ownerId, 400)] });
    expect(planM).toMatchObject({ status: 'draft', periodStart: '2027-01-01', total: '4500.00', scenario: { dimension: 'manager', periodicity: 'month' } });
    expect(planM.periods).toHaveLength(12);
    expect(planM.number).toBeNull();
    const bad = (lines: any[]) => owner.patch(`/sales-plan/plans/${planM.id}`, { lines });
    expect((await bad([line('2028-01-01', memberId, 1)])).body.error.code).toBe('invalid_period');
    expect((await bad([{ periodStart: '2027-02-01', categoryId, amount: 1 }])).body.error.code).toBe('invalid_dimension');
    expect((await bad([line('2027-02-01', memberId, 1), line('2027-02-01', memberId, 2)])).body.error.code).toBe('duplicate_line');
    expect((await bad([{ periodStart: '2027-02-01', memberId: '00000000-0000-7000-8000-000000000000', amount: 1 }])).body.error.code).toBe('invalid_reference');
    expect((await member.patch(`/sales-plan/plans/${planM.id}`, { comment: 'x' })).status).toBe(403);
    expect((await member.get(`/sales-plan/plans/${planM.id}`)).status).toBe(200);
    // сценарий с документами нельзя перестроить
    expect((await owner.patch(`/sales-plan/scenarios/${scenM}`, { dimension: 'product' })).status).toBe(409);
  });

  test('posting writes the register; unposting clears it; a posted plan is not editable', async () => {
    const count = async () => (await admin`select count(*)::int as n from sales_plan_figures where document_id = ${planM.id}`)[0]!.n as number;
    expect(await count()).toBe(0);
    const empty = await mk(owner, '/sales-plan/plans', { scenarioId: scenM, periodStart: '2027-01-01', lines: [] });
    expect((await owner.post(`/sales-plan/plans/${empty.id}/post`)).body.error.code).toBe('no_lines');
    expect((await owner.del(`/sales-plan/plans/${empty.id}`)).status).toBe(200);
    const posted = (await owner.post(`/sales-plan/plans/${planM.id}/post`)).body;
    expect(posted).toMatchObject({ status: 'posted' });
    expect(posted.number).toMatch(/^ПП-/);
    expect(await count()).toBe(4);
    expect((await owner.patch(`/sales-plan/plans/${planM.id}`, { comment: 'правка' })).body.error.code).toBe('not_draft');
    expect((await analysis(owner, scenM, '2027-01-01', '2027-12-31')).total.plan).toBe('4500.00');
    expect((await owner.post(`/sales-plan/plans/${planM.id}/unpost`)).body.status).toBe('draft');
    expect(await count()).toBe(0);
    expect((await analysis(owner, scenM, '2027-01-01', '2027-12-31')).total.plan).toBe('0.00');
    expect((await owner.post(`/sales-plan/plans/${planM.id}/post`)).status).toBe(200);
    expect((await plans(`?scenarioId=${scenM}`)).body.items.map((p: any) => p.id)).toEqual([planM.id]);
  });

  test('analysis by manager: fact by the document or company responsible, returns reduce it, forecast from deals', async () => {
    const r = await analysis(owner, scenM, '2027-01-01', '2027-12-31');
    expect(r.periods).toHaveLength(12);
    const row = (id: string | null) => r.rows.find((z: any) => z.key === id);
    // участник: акт Дельты без ответственного 700 (ответственный компании) + реализация 1000 − возврат 200
    expect(row(memberId).periods[9]).toMatchObject({ plan: '2500.00', fact: '1500.00', deviation: '-1000.00', pct: '60.0', forecastWon: '5000.00', forecastOpen: '0.00', forecast: '5000.00', forecastWeighted: '5000.00' });
    // владелец: акт 1000 в октябре, акты 300 и 400 в ноябре; открытая сделка 3000 (вероятность этапа 50 %)
    expect(row(ownerId).periods[9]).toMatchObject({ plan: '1500.00', fact: '1000.00', pct: '66.7', forecastOpen: '3000.00', forecastWon: '0.00', forecastWeighted: '1500.00' });
    expect(row(ownerId).periods[10]).toMatchObject({ plan: '400.00', fact: '700.00', pct: '175.0' });
    expect(row(null).periods[9]).toMatchObject({ plan: '100.00', fact: '0.00' });
    expect(r.totals[9]).toMatchObject({ plan: '4100.00', fact: '2500.00', forecast: '8000.00', forecastWeighted: '6500.00' });
    // период выравнивается по периодам сценария
    const part = await analysis(owner, scenM, '2027-10-20', '2027-11-03');
    expect(part).toMatchObject({ from: '2027-10-01', to: '2027-11-30' });
    expect(part.periods).toEqual(['2027-10-01', '2027-11-01']);
  });

  test('a done work order counts at its done date by the document responsible', async () => {
    const z = (await mk(owner, '/companies', { name: 'ООО «Зета»' })).id;
    const wo = await mk(owner, '/documents', { type: 'work_order', counterpartyId: z, warehouseId: warehouse, date: '2027-12-03', responsibleId: memberId, lines: [{ productId: plain, qty: 1, price: 900 }] });
    expect((await owner.post(`/documents/${wo.id}/state`, { state: 'done' })).status).toBe(200);
    await admin`update documents set posted_at = '2027-12-04T10:00:00Z' where id = ${wo.id}`;
    const r = await analysis(owner, scenM, '2027-12-01', '2027-12-31');
    expect(r.rows.find((row: any) => row.key === memberId).periods[0]).toMatchObject({ fact: '900.00', plan: '0.00', pct: null });
  });

  test('fact matches the clients report; analysis by category (quarters) and by product (with quantity)', async () => {
    const clients = (await owner.get('/services/reports/clients?from=2027-01-01&to=2027-12-31')).body;
    expect((await analysis(owner, scenM, '2027-01-01', '2027-12-31')).total.fact).toBe(clients.totals.revenue);

    const cat = await mk(owner, '/sales-plan/plans', { scenarioId: scenC, periodStart: '2027-02-01', lines: [{ periodStart: '2027-10-01', categoryId, amount: 1000 }, { periodStart: '2027-10-01', categoryId: null, amount: 50 }] });
    expect((await owner.post(`/sales-plan/plans/${cat.id}/post`)).status).toBe(200);
    const c = await analysis(owner, scenC, '2027-10-01', '2027-12-31');
    expect(c.periods).toEqual(['2027-10-01']);
    expect(c.rows.find((row: any) => row.key === categoryId).periods[0]).toMatchObject({ plan: '1000.00', fact: '400.00', pct: '40.0', forecast: '0.00' });
    expect(c.rows.find((row: any) => row.key === null).periods[0].plan).toBe('50.00');

    const prod = await mk(owner, '/sales-plan/plans', { scenarioId: scenP, periodStart: '2027-01-01', warehouseId: warehouse, lines: [{ periodStart: '2027-10-01', productId: goods, amount: 1000, qty: 5 }] });
    expect((await owner.post(`/sales-plan/plans/${prod.id}/post`)).status).toBe(200);
    const p = await analysis(owner, scenP, '2027-10-01', '2027-10-31');
    expect(p.rows.find((row: any) => row.key === goods).periods[0]).toMatchObject({ plan: '1000.00', planQty: '5.000', fact: '800.00', factQty: '4.000' });
    // склад плана: на другом складе плана и продаж нет
    expect((await analysis(owner, scenP, '2027-10-01', '2027-10-31', `&warehouseId=${wh2}`)).rows).toHaveLength(0);
    expect((await analysis(owner, scenP, '2027-10-01', '2027-10-31', `&warehouseId=${warehouse}`)).rows.find((row: any) => row.key === goods).periods[0].factQty).toBe('4.000');
    // количество планируется только по товарам
    expect((await owner.post('/sales-plan/plans', { scenarioId: scenM, periodStart: '2027-01-01', lines: [{ periodStart: '2027-01-01', memberId, amount: 1, qty: 2 }] })).body.error.code).toBe('invalid_dimension');
  });

  test('tenants are isolated', async () => {
    expect((await other.get('/sales-plan/plans')).body.items).toHaveLength(0);
    expect((await other.get('/sales-plan/scenarios')).body.items).toHaveLength(0);
    expect((await other.get(`/sales-plan/plans/${planM.id}`)).status).toBe(404);
    expect((await other.get(`/sales-plan/analysis?scenarioId=${scenM}&from=2027-01-01&to=2027-12-31`)).status).toBe(404);
    expect((await other.post('/sales-plan/plans', { scenarioId: scenM, periodStart: '2027-01-01', lines: [] })).status).toBe(404);
    // под ролью приложения без воркспейса таблицы пусты
    for (const t of ['sales_plan_scenarios', 'sales_plan_docs', 'sales_plan_lines', 'sales_plan_figures', 'crm_next_contact_runs']) {
      expect((await sql.unsafe(`select 1 from ${t}`).catch(() => [])).length).toBe(0);
    }
  });
});
