/* Этап 5 услуг: часовой планировщик работ. Интервал назначения заказ-наряда (start_at/end_at),
   перегрузка и работа вне смены — предупреждения, смена исполнителя при записанном времени —
   запрет (как у операции со сдельным нарядом), закрытый заказ-наряд не перепланируют,
   ресурсы строк-работ подставляются из норматива, часовой план и изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let warehouse: string;
let customer: string;
let memberId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

/** Свой товар на тест: остатки не смешиваются с другими тестами */
let counter = 0;
const work = async (name: string, price = 500) => (await mk(owner, '/products', { name: `${name} ${++counter}`, kind: 'work', unitCode: '356', price })).id;

const workOrder = async (lines: { productId: string; qty: number | string; price: number | string }[], extra: Record<string, unknown> = {}) =>
  mk(owner, '/documents', { type: 'work_order', counterpartyId: customer, warehouseId: warehouse, lines, ...extra });

/** Понедельник 2026-03-02 — рабочий день пятидневки по умолчанию */
const MON = '2026-03-02';

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Планировщик услуг WS' });
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
  // график по умолчанию: пятидневка со сменой 09:00–17:00
  await mk(owner, '/production/calendars', { name: 'Пятидневка', kind: 'weekly', pattern: { weekdays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 }, hoursPerDay: '8', isDefault: true });
});

describe('service schedule: the interval of an assignment', () => {
  let docId: string;
  let taskId: string;

  beforeAll(async () => {
    const productId = await work('Монтаж оборудования');
    const doc = await workOrder([{ productId, qty: 2, price: 500 }]);
    docId = doc.id;
    const created = await mk(owner, `/work-orders/${docId}/assignments`, { assigneeId: memberId, lineId: doc.lines[0].id });
    taskId = created.taskId;
  });

  test('the planner sets the interval and the dates of the task follow it', async () => {
    const res = await owner.patch(`/work-order-assignments/${taskId}`, { startAt: `${MON}T10:00:00Z`, endAt: `${MON}T13:00:00Z` });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    const tasks = (await owner.get('/tasks?module=services')).body.items as any[];
    const task = tasks.find(t => t.id === taskId);
    expect(task).toMatchObject({ startDate: MON, dueDate: MON });
  });

  test('the start of the interval must not be after its end', async () => {
    const res = await owner.patch(`/work-order-assignments/${taskId}`, { startAt: `${MON}T15:00:00Z`, endAt: `${MON}T12:00:00Z` });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('invalid_dates');
  });

  test('the executor of an assignment with logged time cannot be changed', async () => {
    const log = await owner.post('/time-logs', { taskId, hours: '2', logDate: MON, memberId });
    expect(log.status).toBe(201);
    const ownerId = ((await owner.get('/members')).body.items as any[]).find(m => m.email === owner.user!.email)!.id;
    const res = await owner.patch(`/work-order-assignments/${taskId}`, { assigneeId: ownerId });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('assignment_has_time');
  });

  test('a closed work order is not rescheduled', async () => {
    const productId = await work('Обслуживание');
    const doc = await workOrder([{ productId, qty: 1, price: 300 }]);
    const created = await mk(owner, `/work-orders/${doc.id}/assignments`, { assigneeId: memberId, lineId: doc.lines[0].id });
    await owner.post(`/documents/${doc.id}/state`, { state: 'done' });
    await owner.post(`/documents/${doc.id}/state`, { state: 'delivered' });
    const res = await owner.patch(`/work-order-assignments/${created.taskId}`, { startAt: `${MON}T10:00:00Z`, endAt: `${MON}T12:00:00Z` });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('invalid_state');
  });

  test('the change comes to the other tabs as an event', async () => {
    const events = (await owner.get('/events?limit=50')).body.items as any[];
    expect(events.some(e => e.entity === 'task' && e.recordId === taskId)).toBe(true);
  });
});

describe('service schedule: the hourly plan', () => {
  let taskId: string;

  beforeAll(async () => {
    const productId = await work('Диагностика');
    const doc = await workOrder([{ productId, qty: 1, price: 300 }]);
    const created = await mk(owner, `/work-orders/${doc.id}/assignments`, { assigneeId: memberId, lineId: doc.lines[0].id });
    taskId = created.taskId;
    await owner.patch(`/work-order-assignments/${taskId}`, { startAt: `${MON}T09:00:00Z`, endAt: `${MON}T11:00:00Z` });
  });

  test('the plan shows the rows, the intervals and the load by hours', async () => {
    const res = await owner.get(`/services/schedule?from=${MON}T00:00:00Z&to=${MON}T23:59:59Z&resource=member`);
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: any) => r.rowId === memberId);
    expect(row).toBeTruthy();
    const slot = row.slots.find((s: any) => s.start === `${MON}T09:00:00.000Z`);
    expect(slot).toMatchObject({ used: '1.00', capacity: '1.00', working: true, overloaded: false });
    const entry = res.body.entries.find((e: any) => e.taskId === taskId);
    expect(entry).toMatchObject({ kind: 'assignment', rowId: memberId, startAt: `${MON}T09:00:00.000Z`, endAt: `${MON}T11:00:00.000Z` });
  });

  test('work outside the shift is a warning, not a block', async () => {
    const productId = await work('Ночной выезд');
    const doc = await workOrder([{ productId, qty: 1, price: 300 }]);
    const created = await mk(owner, `/work-orders/${doc.id}/assignments`, { assigneeId: memberId, lineId: doc.lines[0].id });
    const res = await owner.patch(`/work-order-assignments/${created.taskId}`, { startAt: `${MON}T19:00:00Z`, endAt: `${MON}T20:00:00Z` });
    expect(res.status).toBe(200);
    expect(res.body.warnings.some((w: any) => w.code === 'outside_shift')).toBe(true);
  });

  test('two assignments of one executor at the same time are a warning', async () => {
    const productId = await work('Второй выезд');
    const doc = await workOrder([{ productId, qty: 1, price: 300 }]);
    const created = await mk(owner, `/work-orders/${doc.id}/assignments`, { assigneeId: memberId, lineId: doc.lines[0].id });
    const res = await owner.patch(`/work-order-assignments/${created.taskId}`, { startAt: `${MON}T10:00:00Z`, endAt: `${MON}T12:00:00Z` });
    expect(res.status).toBe(200);
    expect(res.body.warnings.some((w: any) => w.code === 'member_overlap')).toBe(true);
  });

  test('moving an assignment by days in the production planner moves its hours too', async () => {
    const productId = await work('Перенос по дням');
    const doc = await workOrder([{ productId, qty: 1, price: 300 }]);
    const created = await mk(owner, `/work-orders/${doc.id}/assignments`, { assigneeId: memberId, lineId: doc.lines[0].id });
    expect((await owner.patch(`/work-order-assignments/${created.taskId}`, { startAt: `${MON}T10:00:00Z`, endAt: `${MON}T12:00:00Z` })).status).toBe(200);
    // дневной планировщик производства двигает назначение датами задачи
    expect((await owner.patch(`/work-order-assignments/${created.taskId}`, { startDate: '2026-03-04', dueDate: '2026-03-04' })).status).toBe(200);
    const a = ((await owner.get(`/documents/${doc.id}`)).body.assignments as any[]).find(x => x.taskId === created.taskId);
    expect(a.startDate).toBe('2026-03-04');
    expect(a.startAt).toBe('2026-03-04T10:00:00.000Z');
    expect(a.endAt).toBe('2026-03-04T12:00:00.000Z');
  });

  test('the plan of another workspace is empty', async () => {
    const res = await other.get(`/services/schedule?from=${MON}T00:00:00Z&to=${MON}T23:59:59Z&resource=member`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
  });
});

describe('service schedule: the resources of a work', () => {
  test('the resources of the norm of the work are put into the tab Resources', async () => {
    const productId = await work('Работы с ресурсом');
    const resource = await mk(owner, '/production/resources', { name: 'Верстак', kind: 'equipment', capacityUnits: 2 });
    await owner.put('/production/product-resources', { productId, resources: [{ resourceId: resource.id, hoursPerUnit: '1.500' }] });
    const doc = await workOrder([{ productId, qty: 2, price: 300 }]);
    const res = await owner.get(`/production/document-resources?documentId=${doc.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ resourceId: resource.id, hours: '3.000' });
  });

  test('the resource works are visible in the hourly plan of the resources', async () => {
    const productId = await work('Работы с интервалом ресурса');
    const resource = await mk(owner, '/production/resources', { name: 'Станок', kind: 'equipment' });
    await owner.put('/production/product-resources', { productId, resources: [{ resourceId: resource.id, hoursPerUnit: '1.000' }] });
    const doc = await workOrder([{ productId, qty: 1, price: 300 }]);
    await owner.put('/production/document-resources', {
      documentId: doc.id,
      items: [{ resourceId: resource.id, startAt: `${MON}T09:00:00Z`, endAt: `${MON}T12:00:00Z`, hours: '3' }],
    });
    const res = await owner.get(`/services/schedule?from=${MON}T00:00:00Z&to=${MON}T23:59:59Z&resource=resource`);
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: any) => r.rowId === resource.id);
    expect(row).toBeTruthy();
    expect(row.slots.find((s: any) => s.start === `${MON}T09:00:00.000Z`)).toMatchObject({ used: '1.00', working: true });
  });
});
