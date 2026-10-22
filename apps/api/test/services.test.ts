/* Учёт времени и нормы работ (этап 2 сессии «УНФ: Услуги»): норма времени работы и её применение к назначению,
   выставление строки работы по фактическим часам (количество пересчитывается перед проведением), табель сотрудника
   и заказчик у задачи модуля services (время по заказчику без заказ-наряда). */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let warehouse: string;
let customer: string;
let servicesProject: string;
let memberId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

let counter = 0;
const work = async (name: string, price = 500) => (await mk(owner, '/products', { name: `${name} ${++counter}`, kind: 'work', unitCode: '356', price, vatRate: 'none' })).id;

const workOrder = async (lines: { productId: string; qty: number | string; price: number | string }[]) =>
  mk(owner, '/documents', { type: 'work_order', counterpartyId: customer, warehouseId: warehouse, lines });

const logTime = async (taskId: string, hours: string, logDate = '2026-10-20') => {
  const r = await owner.post('/time-logs', { taskId, hours, logDate, memberId });
  if (r.status !== 201) throw new Error(`time-log: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Учёт времени WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужой WS' });
  warehouse = (await owner.get('/warehouses')).body.items[0].id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Заказчик»', inn: '7728168971' })).id;
  memberId = ((await owner.get('/members')).body.items as any[]).find(m => m.email === member.user!.email)!.id;
  servicesProject = (await owner.get('/projects?module=services')).body.items[0].id;
});

describe('work norms', () => {
  test('the norm of a work is saved and applied to a new assignment', async () => {
    const productId = await work('Монтаж оборудования');
    const r = await owner.put(`/services/work-norms/${productId}`, { normHours: '1.5', workCenterId: null });
    expect(r.status).toBe(200);

    const norms = (await owner.get('/services/work-norms')).body.items as any[];
    const norm = norms.find(n => n.productId === productId);
    expect(norm).toMatchObject({ normHours: '1.500', workCenterId: null });

    const doc = await workOrder([{ productId, qty: 2, price: 500 }]);
    const lineId = (await owner.get(`/documents/${doc.id}`)).body.lines[0].id;
    const assignment = await owner.post(`/work-orders/${doc.id}/assignments`, { lineId, assigneeId: memberId });
    expect(assignment.status).toBe(201);

    // плановые часы назначения = количество строки × норма
    const time = (await owner.get(`/work-orders/${doc.id}/time`)).body;
    expect(time.assignments[0].plannedHours).toBe('3.000');
    expect(time.assignments[0].actualHours).toBe('0.000');
    expect(time.totals.plannedHours).toBe('3.000');
  });

  test('a norm can be set only for a work', async () => {
    const service = (await mk(owner, '/products', { name: `Услуга ${++counter}`, kind: 'service', unitCode: '876', price: 100 })).id;
    const r = await owner.put(`/services/work-norms/${service}`, { normHours: '2' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('not_work');
  });

  test('the norms of another workspace are not visible', async () => {
    const productId = await work('Скрытая работа');
    await owner.put(`/services/work-norms/${productId}`, { normHours: '3' });
    const r = await other.get('/services/work-norms');
    expect(r.status).toBe(200);
    expect((r.body.items as any[]).some(n => n.productId === productId)).toBe(false);
  });
});

describe('billing by actual hours', () => {
  test('the quantity of a line billed by hours is recalculated from the logged time before posting', async () => {
    const productId = await work('Сервисное обслуживание');
    const doc = await workOrder([{ productId, qty: 2, price: 500 }]);
    const lineId = (await owner.get(`/documents/${doc.id}`)).body.lines[0].id;

    const billing = await owner.post(`/work-orders/${doc.id}/billing`, { lines: [{ lineId, billing: 'hours' }] });
    expect(billing.status).toBe(200);
    expect(billing.body.lines.find((l: any) => l.lineId === lineId).billing).toBe('hours');

    const assignment = await owner.post(`/work-orders/${doc.id}/assignments`, { lineId, assigneeId: memberId });
    const taskId = assignment.body.taskId;
    await logTime(taskId, '3.5');

    const time = (await owner.get(`/work-orders/${doc.id}/time`)).body;
    expect(time.assignments[0].actualHours).toBe('3.500');
    expect(time.lines[0].actualHours).toBe('3.500');

    const state = await owner.post(`/documents/${doc.id}/state`, { state: 'done' });
    expect(state.status).toBe(200);
    expect(state.body.status).toBe('posted');

    // количество строки пересчитано по фактическим часам, сумма — по ним же
    const detail = (await owner.get(`/documents/${doc.id}`)).body;
    expect(detail.lines[0].qty).toBe('3.500');
    expect(detail.lines[0].total).toBe('1750.00');
    expect(detail.total).toBe('1750.00');
  });

  test('a line billed by hours without logged time is not posted', async () => {
    const productId = await work('Диагностика');
    const doc = await workOrder([{ productId, qty: 1, price: 500 }]);
    const lineId = (await owner.get(`/documents/${doc.id}`)).body.lines[0].id;
    await owner.post(`/work-orders/${doc.id}/billing`, { lines: [{ lineId, billing: 'hours' }] });
    await owner.post(`/work-orders/${doc.id}/assignments`, { lineId, assigneeId: memberId });

    const state = await owner.post(`/documents/${doc.id}/state`, { state: 'done' });
    expect(state.status).toBe(422);
    expect(state.body.error.code).toBe('no_hours_billed');
    // заказ-наряд остался черновиком
    const detail = (await owner.get(`/documents/${doc.id}`)).body;
    expect(detail.status).toBe('draft');
  });

  test('only a work line can be billed by hours', async () => {
    const goods = (await mk(owner, '/products', { name: `Товар ${++counter}`, kind: 'goods', unitCode: '006', price: 100 })).id;
    const doc = await workOrder([{ productId: goods, qty: 1, price: 100 }]);
    const lineId = (await owner.get(`/documents/${doc.id}`)).body.lines[0].id;
    const r = await owner.post(`/work-orders/${doc.id}/billing`, { lines: [{ lineId, billing: 'hours' }] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('not_work_line');
  });
});

describe('timesheet', () => {
  test('the timesheet shows the customer and the kind of work', async () => {
    const productId = await work('Выезд мастера');
    const doc = await workOrder([{ productId, qty: 1, price: 500 }]);
    const detail = (await owner.get(`/documents/${doc.id}`)).body;
    const lineId = detail.lines[0].id;
    const assignment = await owner.post(`/work-orders/${doc.id}/assignments`, { lineId, assigneeId: memberId });
    await logTime(assignment.body.taskId, '2.5');

    const sheet = (await owner.get(`/services/timesheet?from=2026-10-01&to=2026-10-31`)).body;
    const row = sheet.items.find((r: any) => r.taskId === assignment.body.taskId);
    expect(row).toBeTruthy();
    expect(row.companyName).toBe('ООО «Заказчик»');
    expect(row.workName).toBe(detail.lines[0].name);
    expect(row.hours).toBe('2.500');
    expect(row.memberId).toBe(memberId);
  });

  test('time can be logged for a customer without a work order', async () => {
    const task = await mk(owner, '/tasks', { projectId: servicesProject, title: 'Консультация по договору', companyId: customer, assigneeId: memberId });
    await logTime(task.id, '1');
    const sheet = (await owner.get(`/services/timesheet?from=2026-10-01&to=2026-10-31`)).body;
    const row = sheet.items.find((r: any) => r.taskId === task.id);
    expect(row).toBeTruthy();
    expect(row.companyName).toBe('ООО «Заказчик»');
    expect(row.documentId).toBeNull();
  });

  test('a member sees only their own hours', async () => {
    const sheet = (await member.get(`/services/timesheet?from=2026-10-01&to=2026-10-31`)).body;
    expect(sheet.items.length).toBeGreaterThan(0);
    expect(sheet.items.every((r: any) => r.memberId === memberId)).toBe(true);
  });

  test('the timesheet of another workspace is empty', async () => {
    const sheet = (await other.get(`/services/timesheet`)).body;
    expect(sheet.items).toEqual([]);
  });
});

describe('customer of a task', () => {
  test('the customer can be set for a task of the services module', async () => {
    const task = await mk(owner, '/tasks', { projectId: servicesProject, title: 'Работа по договору', companyId: customer });
    expect(task.companyId).toBe(customer);
    const patch = await owner.patch(`/tasks/${task.id}`, { companyId: null });
    expect(patch.status).toBe(200);
    expect(patch.body.companyId).toBeNull();
  });

  test('the customer of a task of another module is rejected', async () => {
    const project = await owner.project('TST', 'Обычный проект');
    const r = await owner.post('/tasks', { projectId: project.id, title: 'Обычная задача', companyId: customer });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('company_not_allowed');
  });

  test('the customer of another workspace is rejected', async () => {
    const foreign = (await mk(other, '/companies', { name: 'Чужая компания' })).id;
    const r = await owner.post('/tasks', { projectId: servicesProject, title: 'Задача с чужим заказчиком', companyId: foreign });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_reference');
  });
});

describe('checks found in review', () => {
  test('a task with a customer moved to an ordinary project loses the customer', async () => {
    const task = await mk(owner, '/tasks', { projectId: servicesProject, title: 'Консультация', companyId: customer });
    const project = await owner.project('MOV', 'Обычный проект для переноса');
    const res = await owner.patch(`/tasks/${task.id}`, { projectId: project.id });
    expect(res.status).toBe(200);
    expect(res.body.module).toBe('general');
    expect(res.body.companyId).toBeNull();
  });

  test('the billing of a performed work order or of another document cannot be changed', async () => {
    const productId = await work('Диагностика');
    const doc = await workOrder([{ productId, qty: 1, price: 500 }]);
    const lineId = (await owner.get(`/documents/${doc.id}`)).body.lines[0].id;
    expect((await owner.post(`/documents/${doc.id}/state`, { state: 'done' })).status).toBe(200);
    expect((await owner.post(`/work-orders/${doc.id}/billing`, { lines: [{ lineId, billing: 'hours' }] })).status).toBe(409);
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId, qty: 1, price: 500 }] });
    const orderLine = (await owner.get(`/documents/${order.id}`)).body.lines[0].id;
    expect((await owner.post(`/work-orders/${order.id}/billing`, { lines: [{ lineId: orderLine, billing: 'hours' }] })).status).toBe(422);
  });
});
