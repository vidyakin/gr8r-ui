/* Этап 4г: планирование загрузки. Справочник ключевых ресурсов, сменные графики, праздники и исключения,
   потребность в ресурсах (норматив и закладка «Ресурсы» заказа), расчёт загрузки с перегрузкой,
   автопланирование заказа и сдвиг операции планировщиком. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let memberId: string;
let center: string;
let operation: string;
let item: string;
let wood: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const itemOf = (name: string, extra: Record<string, unknown> = {}) => mk(owner, '/manufactured-items', { name, ...extra });

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Planning WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other planning WS' });

  const members = (await owner.get('/members')).body.items;
  memberId = members.find((m: any) => m.userId === member.user!.id).id;

  wood = (await mk(owner, '/products', { name: 'Брус', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
  operation = (await mk(owner, '/products', { name: 'Сборка', kind: 'operation', vatRate: 'none' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Сборочный участок', hourlyRate: 500 })).id;
  item = (await itemOf('Стол', { overheadPct: 0 })).id;
  await owner.post(`/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty: 1 });
  await owner.post(`/manufactured-items/${item}/lines`, { kind: 'work', operation: 'Сборка', productId: operation, workCenterId: center, hours: 4 });
});

describe('resources and calendars', () => {
  test('a resource is created, renamed and archived', async () => {
    const res = await mk(owner, '/production/resources', { name: 'Раскроечный станок', kind: 'equipment', code: 'EQ-1', workCenterId: center });
    expect(res).toMatchObject({ name: 'Раскроечный станок', kind: 'equipment', capacityUnits: 1 });
    const patch = await owner.patch(`/production/resources/${res.id}`, { name: 'Станок' });
    expect(patch.status).toBe(200);
    expect(patch.body.name).toBe('Станок');
    const del = await owner.del(`/production/resources/${res.id}`);
    expect(del.status).toBe(200);
    expect((await owner.get('/production/resources')).body.items).toHaveLength(0);
  });

  test('the name of a resource is unique', async () => {
    await mk(owner, '/production/resources', { name: 'Press' });
    const dup = await owner.post('/production/resources', { name: 'press' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_name');
  });

  test('a member cannot change the reference books', async () => {
    const res = await member.post('/production/resources', { name: 'Станок' });
    expect(res.status).toBe(403);
  });

  test('a work calendar is weekly or cyclic and the default one is unique', async () => {
    const weekly = await mk(owner, '/production/calendars', { name: 'Пятидневка', kind: 'weekly', pattern: { weekdays: [1, 2, 3, 4, 5] }, hoursPerDay: '8', isDefault: true });
    expect(weekly).toMatchObject({ kind: 'weekly', isDefault: true, hoursPerDay: '8.000' });
    const cyclic = await owner.post('/production/calendars', { name: 'Сменный 2/2', kind: 'cycle', pattern: { cycle: [1, 1, 0, 0] }, hoursPerDay: '8' });
    expect(cyclic.status).toBe(422); // циклу нужна дата начала
    const cyclicOk = await mk(owner, '/production/calendars', { name: 'Сменный 2/2', kind: 'cycle', pattern: { cycle: [1, 1, 0, 0] }, cycleStart: '2026-01-05', hoursPerDay: '8', isDefault: true });
    expect(cyclicOk.kind).toBe('cycle');
    // график по умолчанию один: новый снимает признак у прежнего
    const list = (await owner.get('/production/calendars')).body.items;
    expect(list.filter((c: any) => c.isDefault)).toHaveLength(1);
    expect(list.find((c: any) => c.isDefault).name).toBe('Сменный 2/2');
  });

  test('holidays of the workspace and exceptions of a resource', async () => {
    expect((await owner.post('/production/holidays', { date: '2026-01-01', name: 'Новый год' })).status).toBe(200);
    expect((await owner.get('/production/holidays')).body.items).toHaveLength(1);
    const res = await mk(owner, '/production/resources', { name: 'Верстак' });
    const exc = await mk(owner, '/production/calendar-exceptions', { scope: 'resource', scopeId: res.id, dateFrom: '2026-02-02', dateTo: '2026-02-06', note: 'Ремонт' });
    expect(exc.id).toBeTruthy();
    expect((await owner.get('/production/calendar-exceptions')).body.items).toHaveLength(1);
    expect((await owner.del(`/production/calendar-exceptions/${exc.id}`)).status).toBe(200);
  });

  test('the resources of another workspace are not visible', async () => {
    await mk(owner, '/production/resources', { name: 'Только наш станок' });
    expect((await other.get('/production/resources')).body.items).toHaveLength(0);
  });
});

describe('resource demand', () => {
  test('the norm of an operation keeps the resources and their hours', async () => {
    const res = await mk(owner, '/production/resources', { name: 'Сборочный верстак' });
    const put = await owner.put('/production/product-resources', { productId: operation, resources: [{ resourceId: res.id, hoursPerUnit: '0.500' }] });
    expect(put.status).toBe(200);
    expect(put.body.items).toEqual([{ resourceId: res.id, name: 'Сборочный верстак', hoursPerUnit: '0.500' }]);
  });

  test('the resources of an order are filled in and edited', async () => {
    const order = (await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '2' }] })).id;
    const res = await mk(owner, '/production/resources', { name: 'Станок для сборки' });
    const put = await owner.put('/production/document-resources', {
      documentId: order,
      items: [{ resourceId: res.id, startAt: '2026-03-02T00:00:00Z', endAt: '2026-03-03T23:59:59Z', hours: '4' }],
    });
    expect(put.status).toBe(200);
    expect(put.body.items).toHaveLength(1);
    const list = (await owner.get(`/production/document-resources?documentId=${order}`)).body.items;
    expect(list[0]).toMatchObject({ resourceId: res.id, hours: '4.000' });
  });
});

describe('load and auto scheduling', () => {
  let order: string;
  let componentId: string;

  beforeAll(async () => {
    order = (await mk(owner, '/production-orders', { workCenterId: center, plannedStart: '2026-03-02T00:00:00Z', items: [{ itemId: item, qty: '2' }] })).id;
    await owner.post(`/production-orders/${order}/fill-from-bom`);
    const detail = (await owner.get(`/production-orders/${order}`)).body;
    componentId = detail.components.find((c: any) => c.kind === 'work').id;
    await owner.post(`/production-orders/${order}/operations`, { assignments: [{ componentId, memberId, qty: '2' }] });
  });

  test('the operations of the order are scheduled from the start date by the capacity', async () => {
    const res = await owner.post(`/production-orders/${order}/schedule`);
    expect(res.status).toBe(200);
    expect(res.body.forecastEnd).toBe('2026-03-02');
    expect(res.body.assignments[0]).toMatchObject({ start: '2026-03-02', end: '2026-03-02', scheduled: true });
    // задача исполнителя получила те же даты
    const tasks = (await owner.get('/tasks?module=production')).body.items;
    expect(tasks[0]).toMatchObject({ startDate: '2026-03-02', dueDate: '2026-03-02' });
  });

  test('a manual date is not moved by the auto scheduling', async () => {
    const ops = (await owner.get(`/production-orders/${order}/operations`)).body.items;
    await owner.patch(`/production/operations/${ops[0].id}/move`, { start: '2026-03-10', end: '2026-03-10' });
    const res = await owner.post(`/production-orders/${order}/schedule`);
    expect(res.body.assignments[0]).toMatchObject({ start: '2026-03-10', end: '2026-03-10' });
  });

  test('the load shows the hours of the row and the overload', async () => {
    const load = await owner.get(`/production/load?from=2026-03-09&to=2026-03-11&rowType=member`);
    expect(load.status).toBe(200);
    const row = load.body.rows.find((r: any) => r.rowId === memberId);
    expect(row).toBeTruthy();
    expect(row.days.find((d: any) => d.date === '2026-03-10').hours).toBe('8.00');
    expect(row.totalHours).toBe('8.00');
    expect(load.body.entries.some((e: any) => e.rowId === memberId)).toBe(true);
  });

  test('a member without a calendar works by the default calendar of the workspace', async () => {
    // по умолчанию стоит сменный график 2/2 (с 2026-01-05): 2026-03-07 — рабочий день, 2026-03-08 — выходной
    const load = await owner.get(`/production/load?from=2026-03-07&to=2026-03-08&rowType=member`);
    const row = load.body.rows.find((r: any) => r.rowId === memberId);
    expect(row.days.map((d: any) => d.capacity)).toEqual(['8.00', '0.00']);
  });

  test('an operation can be moved by the planner', async () => {
    const ops = (await owner.get(`/production-orders/${order}/operations`)).body.items;
    const res = await owner.patch(`/production/operations/${ops[0].id}/move`, { start: '2026-03-16', end: '2026-03-17' });
    expect(res.status).toBe(200);
    const load = await owner.get(`/production/load?from=2026-03-16&to=2026-03-16&rowType=member`);
    const row = load.body.rows.find((r: any) => r.rowId === memberId);
    expect(row.days[0].hours).toBe('4.00');
  });
});

describe('checks found in review', () => {
  let order: string;
  let assignment: string;

  beforeAll(async () => {
    order = (await mk(owner, '/production-orders', { workCenterId: center, plannedStart: '2026-04-06T00:00:00Z', items: [{ itemId: item, qty: '2' }] })).id;
    await owner.post(`/production-orders/${order}/fill-from-bom`);
    const detail = (await owner.get(`/production-orders/${order}`)).body;
    const componentId = detail.components.find((c: any) => c.kind === 'work').id;
    await owner.post(`/production-orders/${order}/operations`, { assignments: [{ componentId, memberId, qty: '2' }] });
    assignment = (await owner.get(`/production-orders/${order}/operations`)).body.items[0].id;
  });

  test('the planner does not save a start after the end', async () => {
    const res = await owner.patch(`/production/operations/${assignment}/move`, { start: '2026-04-10', end: '2026-04-08' });
    expect(res.status).toBe(422);
  });

  test('the executor of an operation with done work cannot be changed by the planner', async () => {
    expect((await member.post(`/production/operations/${assignment}/done`, { qty: '1' })).status).toBe(200);
    const ownerId = (await owner.get('/members')).body.items.find((m: any) => m.userId === owner.user!.id).id;
    const res = await owner.patch(`/production/operations/${assignment}/move`, { memberId: ownerId });
    expect(res.status).toBe(422);
  });
});
