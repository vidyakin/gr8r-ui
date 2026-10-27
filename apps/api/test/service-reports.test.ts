/* Задача 1097: контроль и отчёты услуг — состояние заказ-нарядов и просрочка (по сроку документа и по назначению),
   отклонения от графика, загрузка специалистов (раскладка плана по дням: интервал через полночь, без интервала, без даты;
   доступное время по календарю участника), выручка клиента (заказ-наряд + акт + реализация − возврат), маскирование для member. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let memberId: string; // график по умолчанию: пн–пт, 8 ч
let ownerId: string; // свой график: пн–чт, 6 ч
let customerA: string;
let customerB: string;
let warehouse: string;
let workW: string;
let goodsG: string;
let serviceS: string;
const TODAY = '2026-10-28';

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const rep = async (c: Client, name: string, qs: Record<string, string> = {}) => c.get(`/services/reports/${name}?${new URLSearchParams({ from: '2026-10-01', to: '2026-10-31', today: TODAY, ...qs })}`);
const wo = (body: Record<string, unknown>) => mk(owner, '/documents', { type: 'work_order', warehouseId: warehouse, ...body });
const assign = (docId: string, body: Record<string, unknown>) => mk(owner, `/work-orders/${docId}/assignments`, body);
const interval = async (taskId: string, startAt: string, endAt: string) => {
  const r = await owner.patch(`/work-order-assignments/${taskId}`, { startAt, endAt });
  if (r.status !== 200) throw new Error(`interval ${r.status} ${JSON.stringify(r.body)}`);
};
const logTime = async (taskId: string, who: string, hours: string, logDate: string) => {
  const r = await owner.post('/time-logs', { taskId, hours, logDate, memberId: who });
  if (r.status !== 201) throw new Error(`time-log ${r.status} ${JSON.stringify(r.body)}`);
};
const done = async (id: string, postedAt: string) => {
  const r = await owner.post(`/documents/${id}/state`, { state: 'done' });
  if (r.status !== 200) throw new Error(`done ${r.status} ${JSON.stringify(r.body)}`);
  await admin`update documents set posted_at = ${postedAt} where id = ${id}`;
};

let wo1: any;
let wo2: any;
let wo3: any;
let wo4: any;
let a1: any;
let a2: any;
let a3: any;
let a5: any;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Отчёты услуг WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужие отчёты услуг WS' });
  const people = (await owner.get('/members')).body.items as any[];
  memberId = people.find(m => m.email === member.user!.email).id;
  ownerId = people.find(m => m.email === owner.user!.email).id;
  warehouse = (await owner.get('/warehouses')).body.items[0].id;
  customerA = (await mk(owner, '/companies', { name: 'ООО «Альфа»', inn: '7728168971' })).id;
  customerB = (await mk(owner, '/companies', { name: 'ООО «Бета»', inn: '7707083893' })).id;
  workW = (await mk(owner, '/products', { name: 'Монтаж', kind: 'work', unitCode: '356', price: 1000, vatRate: 'none' })).id;
  goodsG = (await mk(owner, '/products', { name: 'Датчик', kind: 'goods', unitCode: '796', price: 200, purchasePrice: 100, vatRate: 'none' })).id;
  serviceS = (await mk(owner, '/products', { name: 'Консультация', kind: 'service', unitCode: '876', price: 500, vatRate: 'none' })).id;
  expect((await owner.patch('/billing/timezone', { timezone: 'UTC' })).status).toBe(200);
  // график воркспейса: пн–пт, 8 ч; у владельца свой: пн–чт, 6 ч
  await mk(owner, '/production/calendars', { name: 'Пятидневка', kind: 'weekly', pattern: { weekdays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 }, hoursPerDay: '8', isDefault: true });
  const four = await mk(owner, '/production/calendars', { name: 'Четырёхдневка', kind: 'weekly', pattern: { weekdays: [1, 2, 3, 4], startHour: 9, endHour: 15 }, hoursPerDay: '6' });
  await admin`update members set calendar_id = ${four.id} where id = ${ownerId}`;
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: customerA, warehouseId: warehouse, date: '2026-09-01', priceIncludesVat: false, lines: [{ productId: goodsG, qty: 20, price: 100 }] });
  expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);

  // ЗН1: срок документа прошёл, состояние «новый»; назначение 6 ч через полночь 05→06 октября
  wo1 = await wo({ counterpartyId: customerA, date: '2026-10-05', dueDate: '2026-10-09', lines: [{ productId: workW, qty: 1, price: 1000 }] });
  a1 = await assign(wo1.id, { assigneeId: memberId, plannedHours: '6', lineId: wo1.lines[0].id });
  await interval(a1.taskId, '2026-10-05T22:00:00Z', '2026-10-06T02:00:00Z');
  await logTime(a1.taskId, memberId, '2', '2026-10-05');
  await logTime(a1.taskId, memberId, '3', '2026-10-06');

  // ЗН2: срок документа в будущем, «в работе»; назначение владельца 10 ч (перегрузка среды), просрочено по концу;
  // назначение участника без интервала — по сроку задачи, закрыто 16 октября
  wo2 = await wo({ counterpartyId: customerA, date: '2026-10-12', dueDate: '2026-11-30', lines: [{ productId: workW, qty: 1, price: 1000 }] });
  expect((await owner.post(`/documents/${wo2.id}/state`, { state: 'in_progress' })).status).toBe(200);
  a2 = await assign(wo2.id, { assigneeId: ownerId, plannedHours: '10', lineId: wo2.lines[0].id });
  await interval(a2.taskId, '2026-10-14T08:00:00Z', '2026-10-14T12:00:00Z');
  a3 = await assign(wo2.id, { assigneeId: memberId, plannedHours: '2', dueDate: '2026-10-15', title: 'Сдача' });
  await logTime(a3.taskId, memberId, '2', '2026-10-16');
  await admin`update tasks set status = 'done', completed_at = '2026-10-16T09:00:00Z' where id = ${a3.taskId}`;

  // ЗН3: клиент Б, без дат, выполнен 20 октября; назначение без дат
  wo3 = await wo({ counterpartyId: customerB, date: '2026-10-19', lines: [{ productId: serviceS, qty: 1, price: 700 }] });
  a5 = await assign(wo3.id, { assigneeId: memberId, plannedHours: '1.5', title: 'Без даты' });
  await done(wo3.id, '2026-10-20T10:00:00Z');

  // ЗН4: клиент А, работа 2 × 1000 и товар 3 × 200, срок прошёл, но выполнен 21 октября
  wo4 = await wo({ counterpartyId: customerA, date: '2026-10-21', dueDate: '2026-10-10', lines: [{ productId: workW, qty: 2, price: 1000 }, { productId: goodsG, qty: 3, price: 200 }] });
  await done(wo4.id, '2026-10-21T10:00:00Z');

  // акт 500, реализация 2 × 200 и возврат 1 × 200 клиента А
  const act = await mk(owner, '/documents', { type: 'act', counterpartyId: customerA, warehouseId: warehouse, date: '2026-10-22', lines: [{ productId: serviceS, qty: 1, price: 500 }] });
  expect((await owner.post(`/documents/${act.id}/post`)).status).toBe(200);
  const sh = await mk(owner, '/documents', { type: 'realization', counterpartyId: customerA, warehouseId: warehouse, date: '2026-10-23', lines: [{ productId: goodsG, qty: 2, price: 200 }] });
  expect((await owner.post(`/documents/${sh.id}/post`)).status).toBe(200);
  const ret = await mk(owner, '/documents', { type: 'customer_return', counterpartyId: customerA, warehouseId: warehouse, date: '2026-10-24', basedOnId: sh.id, lines: [{ productId: goodsG, qty: 1, price: 200 }] });
  expect((await owner.post(`/documents/${ret.id}/post`)).status).toBe(200);
});

describe('states and overdue', () => {
  test('counts, amounts, overdue by document due date and by an open assignment, done is never overdue by date', async () => {
    const r = (await rep(owner, 'states')).body;
    expect(r.rows).toHaveLength(4);
    const by = (id: string) => r.rows.find((x: any) => x.documentId === id);
    expect(by(wo1.id)).toMatchObject({ category: 'new', overdue: true, overdueReasons: ['due', 'assignment'], overdueDays: 22, plannedHours: '6.00', actualHours: '5.00', completionPct: '83.3' });
    // срок документа прошёл 9 октября (19 дней), а назначение не закрыто и закончилось 6 октября (22 дня)
    // ЗН2: срок документа не наступил, но назначение владельца не закрыто и закончилось 14 октября
    expect(by(wo2.id)).toMatchObject({ category: 'in_progress', overdue: true, overdueReasons: ['assignment'], overdueDays: 14, plannedHours: '12.00', actualHours: '2.00' });
    expect(by(wo3.id)).toMatchObject({ category: 'done', overdue: false });
    expect(by(wo4.id)).toMatchObject({ category: 'done', overdue: false, completionPct: null, amountNet: '2600.00' });
    expect(r.totals).toMatchObject({ count: 4, overdue: 2, amountNet: '5300.00', plannedHours: '19.50', actualHours: '7.00' });
    const state = (c: string) => r.summary.find((s: any) => s.category === c);
    expect(state('new')).toMatchObject({ count: 1, overdue: 1, kindName: expect.any(String) });
    expect(state('done')).toMatchObject({ count: 2, amountNet: '3300.00', overdue: 0 });
    expect(r.byCategory.map((c: any) => c.category).sort()).toEqual(['done', 'in_progress', 'new']);
  });

  test('filters: client, assignee, kind and the period', async () => {
    expect((await rep(owner, 'states', { counterpartyId: customerB })).body.rows.map((x: any) => x.documentId)).toEqual([wo3.id]);
    const byOwner = (await rep(owner, 'states', { assigneeId: ownerId })).body;
    expect(byOwner.rows.map((x: any) => x.documentId)).toEqual([wo2.id]);
    // план и факт заказ-наряда не зависят от отбора по исполнителю
    expect(byOwner.rows[0].plannedHours).toBe('12.00');
    expect((await rep(owner, 'states', { kindId: '00000000-0000-7000-8000-000000000000' })).body.rows).toHaveLength(0);
    expect((await rep(owner, 'states', { from: '2026-10-20', to: '2026-10-31' })).body.rows.map((x: any) => x.documentId)).toEqual([wo4.id]);
    expect((await rep(owner, 'states', { from: '2026-10-31', to: '2026-10-01' })).status).toBe(422);
  });

  test('a cancelled work order is not overdue by an open assignment', async () => {
    const c = await wo({ counterpartyId: customerB, date: '2026-10-02', dueDate: '2026-10-03', lines: [{ productId: workW, qty: 1, price: 1000 }] });
    const t = await assign(c.id, { assigneeId: memberId, plannedHours: '1', dueDate: '2026-10-03', title: 'Старое' });
    expect(t.taskId).toBeTruthy();
    expect((await owner.post(`/documents/${c.id}/state`, { state: 'cancelled', cancelReason: 'тест' })).status).toBe(200);
    const row = (await rep(owner, 'states', { counterpartyId: customerB })).body.rows.find((x: any) => x.documentId === c.id);
    expect(row).toMatchObject({ category: 'cancelled', overdue: false });
  });
});

describe('schedule deviations', () => {
  test('planned and actual hours, planned end, closing date and deviations', async () => {
    const r = (await rep(owner, 'schedule', { counterpartyId: customerA })).body;
    const row = (taskId: string) => r.rows.find((x: any) => x.taskId === taskId);
    // не закрыто: плановый конец 6 октября (интервал до 02:00), отклонение — до «сегодня»
    expect(row(a1.taskId)).toMatchObject({ plannedHours: '6.00', actualHours: '5.00', deviationHours: '-1.00', plannedEnd: '2026-10-06', closed: false, deviationDays: 22 });
    expect(row(a2.taskId)).toMatchObject({ plannedHours: '10.00', actualHours: '0.00', deviationHours: '-10.00', plannedEnd: '2026-10-14', deviationDays: 14 });
    // закрыто на день позже срока задачи
    expect(row(a3.taskId)).toMatchObject({ plannedEnd: '2026-10-15', closed: true, closedDate: '2026-10-16', deviationDays: 1, deviationHours: '0.00' });
    expect(r.totals).toMatchObject({ plannedHours: '18.00', actualHours: '7.00', deviationHours: '-11.00', count: 3 });
    expect(r.byOrder.find((o: any) => o.documentId === wo2.id)).toMatchObject({ plannedHours: '12.00', actualHours: '2.00', count: 2 });
    const mine = r.byAssignee.find((a: any) => a.assigneeId === memberId);
    expect(mine).toMatchObject({ plannedHours: '8.00', actualHours: '7.00', count: 2, late: 2 });
  });

  test('an assignment without dates falls into the period by the document date', async () => {
    const r = (await rep(owner, 'schedule', { counterpartyId: customerB })).body;
    expect(r.rows.find((x: any) => x.taskId === a5.taskId)).toMatchObject({ plannedEnd: null, deviationDays: null, plannedHours: '1.50' });
    expect((await rep(owner, 'schedule', { from: '2026-11-01', to: '2026-11-30' })).body.rows).toHaveLength(0);
  });
});

describe('specialist load', () => {
  test('the plan is spread over days: interval across midnight, task due date, no date; the fact comes from time logs', async () => {
    const r = (await rep(owner, 'load', { assigneeId: memberId })).body;
    expect(r.rows).toHaveLength(1);
    const m = r.rows[0];
    const day = (d: string | null) => m.days.find((x: any) => x.date === d);
    // 6 ч на интервал 22:00–02:00: по 3 ч в каждые сутки
    expect(day('2026-10-05')).toMatchObject({ planned: '3.00', fact: '2.00', capacity: '8.00', overloaded: false });
    expect(day('2026-10-06')).toMatchObject({ planned: '3.00', fact: '3.00' });
    // без интервала — в день срока задачи
    expect(day('2026-10-15')).toMatchObject({ planned: '2.00' });
    expect(day('2026-10-16')).toMatchObject({ planned: '0.00', fact: '2.00' });
    // без дат — отдельная строка, в проценты не входит
    expect(day(null)).toMatchObject({ planned: '1.50' });
    expect(m).toMatchObject({ capacity: '176.00', planned: '8.00', fact: '7.00', plannedPct: '4.5', factPct: '4.0', undated: '1.50', overloaded: false });
  });

  test('available time follows the calendar of the member; an overload is flagged', async () => {
    const r = (await rep(owner, 'load', { assigneeId: ownerId })).body;
    const m = r.rows[0];
    // пн–чт по 6 ч: 17 рабочих дней октября
    expect(m.capacity).toBe('102.00');
    expect(m.days.find((d: any) => d.date === '2026-10-14')).toMatchObject({ planned: '10.00', capacity: '6.00', overloaded: true });
    expect(m.days.find((d: any) => d.date === '2026-10-09')).toBeUndefined(); // пятница — выходной, ничего не запланировано
    expect(m).toMatchObject({ planned: '10.00', plannedPct: '9.8', overloaded: true });
  });

  test('the client filter limits the plan to the work orders of the client', async () => {
    const r = (await rep(owner, 'load', { counterpartyId: customerB })).body;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ memberId, planned: '0.00', undated: '1.50' });
  });
});

describe('time zone', () => {
  test('days of the plan follow the time zone of the workspace', async () => {
    expect((await owner.patch('/billing/timezone', { timezone: 'Europe/Moscow' })).status).toBe(200);
    // 22:00–02:00 UTC это 01:00–05:00 по Москве: все 6 ч в один день, 6 октября
    const m = (await rep(owner, 'load', { assigneeId: memberId })).body.rows[0];
    expect(m.days.find((d: any) => d.date === '2026-10-05')).toMatchObject({ planned: '0.00' });
    expect(m.days.find((d: any) => d.date === '2026-10-06')).toMatchObject({ planned: '6.00', overloaded: false });
    expect((await owner.patch('/billing/timezone', { timezone: 'UTC' })).status).toBe(200);
  });
});

describe('client analytics', () => {
  test('revenue is work orders plus acts and shipments minus returns, split by services and goods', async () => {
    const r = (await rep(owner, 'clients')).body;
    expect(r.rows.map((x: any) => x.counterpartyName)).toEqual(['ООО «Альфа»', 'ООО «Бета»']);
    const a = r.rows[0];
    // ЗН4: работы 2000 и товар 600; акт 500; реализация 400; возврат −200
    expect(a).toMatchObject({ orders: 1, documents: 3, revenueServices: '2500.00', revenueGoods: '800.00', revenue: '3300.00' });
    // себестоимость: товар ЗН4 3 × 100, отгрузка 2 × 100, возврат −1 × 100
    expect(a).toMatchObject({ cost: '400.00', margin: '2900.00', marginPct: '87.88' });
    expect(r.rows[1]).toMatchObject({ orders: 1, documents: 0, revenueServices: '700.00', revenueGoods: '0.00', revenue: '700.00', cost: '0.00', margin: '700.00', marginPct: '100.00' });
    expect(r.totals).toMatchObject({ orders: 2, documents: 3, revenue: '4000.00', cost: '400.00', margin: '3600.00', marginPct: '90.00' });
  });

  test('the period and the filters narrow the result; kind and assignee leave out acts and shipments', async () => {
    expect((await rep(owner, 'clients', { from: '2026-10-22', to: '2026-10-22' })).body.totals).toMatchObject({ orders: 0, documents: 1, revenue: '500.00' });
    expect((await rep(owner, 'clients', { counterpartyId: customerB })).body.rows).toHaveLength(1);
    const byAssignee = (await rep(owner, 'clients', { assigneeId: memberId })).body;
    expect(byAssignee.totals).toMatchObject({ orders: 1, documents: 0, revenue: '700.00' });
  });
});

describe('access', () => {
  test('a member reads every report but cost, margin and percent are masked; an admin sees them', async () => {
    for (const name of ['states', 'schedule', 'load', 'clients']) expect((await rep(member, name)).status).toBe(200);
    const r = (await rep(member, 'clients')).body;
    expect(r.rows[0]).toMatchObject({ revenue: '3300.00', cost: null, margin: null, marginPct: null });
    expect(r.totals).toMatchObject({ revenue: '4000.00', cost: null, margin: null, marginPct: null });
    expect((await rep(owner, 'clients')).body.rows[0].cost).toBe('400.00');
  });

  test("another workspace sees nothing of this one's data", async () => {
    for (const name of ['states', 'schedule', 'load', 'clients']) {
      const r = await rep(other, name);
      expect(r.status).toBe(200);
      expect(r.body.rows).toHaveLength(0);
    }
  });
});
