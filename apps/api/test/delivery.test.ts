/* Задача 1100 (часть 1): доставка без внешних служб — тариф (база, км, кг, минимум, бесплатно от суммы), строка-услуга в документе,
   наследование заказ → реализация, «доставлена» пишет расход и откатывается, у заказ-наряда — в его себестоимость,
   курьер видит и меняет только свои, маскирование денег в отчёте, права на справочник, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin } from './helpers';

let owner: Client;
let manager: Client;
let courier: Client;
let courier2: Client;
let other: Client;
let ws: string;
let courierId: string;
let courier2Id: string;
let wh: string;
let customer: string;
let goods: string;
let svc: string;
let method: string;
let methodFree: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const invite = async (role: string) => {
  const c = new Client();
  await c.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: c.user!.email, role });
  await c.post('/invites/accept', { token: inv.body.token });
  c.workspaceId = ws;
  return c;
};
const order = async (qty = 4, price = 500) => mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: wh, lines: [{ productId: goods, qty, price }] });
const rows = async (q: string) => admin.unsafe(q);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Доставка WS' });
  ws = owner.workspaceId!;
  manager = await invite('member');
  courier = await invite('member');
  courier2 = await invite('member');
  other = new Client();
  await other.signup({ workspaceName: 'Чужая доставка WS' });
  const people = (await owner.get('/members')).body.items as any[];
  courierId = people.find(m => m.email === courier.user!.email).id;
  courier2Id = people.find(m => m.email === courier2.user!.email).id;
  // курьеры — участники с должностью с функцией «курьер» (задача 1172)
  const pos = (await owner.post('/positions', { name: 'Курьер', functions: ['courier'] })).body;
  for (const id of [courierId, courier2Id]) expect((await owner.put(`/positions/by-member/${id}`, { positionIds: [pos.id] })).status).toBe(200);
  wh = (await owner.get('/warehouses')).body.items[0].id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Получатель»', actualAddress: 'Москва, ул. Ленина, 1' })).id;
  await mk(owner, '/contacts', { name: 'Иван Петров', phone: '+7 900 000-00-01', companyId: customer });
  goods = (await mk(owner, '/products', { name: 'Тяжёлый товар', kind: 'goods', unitCode: '796', price: 500, purchasePrice: 100, vatRate: 'none', weightKg: 2.5 })).id;
  svc = (await mk(owner, '/products', { name: 'Доставка', kind: 'service', unitCode: '876', price: 0, vatRate: 'none' })).id;
  method = (await mk(owner, '/delivery-methods', { name: 'Свой курьер', kind: 'own_courier', productId: svc, clientRate: { base: 100, perKm: 10, perKg: 5, min: 150 }, costRate: { base: 50, perKm: 8, perKg: 2 }, freeFrom: 5000 })).id;
  methodFree = (await mk(owner, '/delivery-methods', { name: 'Служба', kind: 'courier_service', productId: svc, clientRate: { base: 300 } })).id;
});

describe('methods and permissions', () => {
  test('admin edits the catalog, a member only reads it', async () => {
    expect((await manager.post('/delivery-methods', { name: 'X' })).status).toBe(403);
    expect((await manager.get('/delivery-methods')).body.items).toHaveLength(2);
    const r = await owner.patch(`/delivery-methods/${methodFree}`, { clientRate: { perKm: 7 } });
    expect(r.body.clientRate).toEqual({ base: '300', perKm: '7', perKg: '0', min: '0' });
    expect((await owner.post('/delivery-methods', { name: 'Товар вместо услуги', productId: goods })).body.error.code).toBe('delivery_product_not_service');
    expect((await owner.post('/delivery-methods', { name: 'Свой курьер' })).status).toBe(409);
  });
  test('the system cost item exists', async () => {
    const items = (await owner.get('/cost-items')).body.items as any[];
    expect(items.find(i => i.systemKey === 'dostavka')?.name).toBe('Доставка');
  });
});

describe('delivery of a document', () => {
  let o: any;
  let d: any;
  test('defaults: contact from the company, weight from the lines; the tariff gives price and cost', async () => {
    o = await order(4, 500);
    const r = await owner.put(`/deliveries/by-document/${o.id}`, { methodId: method, distanceKm: 10 });
    expect(r.status).toBe(200);
    d = r.body;
    expect(d).toMatchObject({ address: 'Москва, ул. Ленина, 1', contactName: 'Иван Петров', contactPhone: '+7 900 000-00-01', weightKg: '10.000', price: '250.00', ourCost: '150.00', status: 'new' });
  });
  test('a member does not see the cost; the owner does', async () => {
    const m = (await manager.get(`/deliveries/by-document/${o.id}`)).body.delivery;
    expect(m.price).toBe('250.00');
    expect(m.ourCost).toBeNull();
    expect((await owner.get(`/deliveries/by-document/${o.id}`)).body.delivery.ourCost).toBe('150.00');
  });
  test('manual price survives; recalc brings the tariff back; free from the order total', async () => {
    expect((await manager.put(`/deliveries/by-document/${o.id}`, { price: 400 })).body.price).toBe('400.00');
    expect((await manager.put(`/deliveries/by-document/${o.id}`, { comment: 'x' })).body.price).toBe('400.00');
    expect((await manager.put(`/deliveries/by-document/${o.id}`, { recalc: true })).body.price).toBe('250.00');
    const big = await order(20, 500);
    const r = await owner.put(`/deliveries/by-document/${big.id}`, { methodId: method, distanceKm: 10 });
    expect(r.body).toMatchObject({ price: '0.00', ourCost: '230.00', weightKg: '50.000' });
  });
  test('add to document: one service line, updated on repeat; a posted document stays as is', async () => {
    const a = await owner.post(`/deliveries/${d.id}/add-to-document`);
    expect(a.status).toBe(200);
    let lines = (await owner.get(`/documents/${o.id}`)).body.lines as any[];
    expect(lines).toHaveLength(2);
    expect(lines.find(l => l.productId === svc)).toMatchObject({ qty: '1.000', price: '250.00' });
    await owner.put(`/deliveries/by-document/${o.id}`, { price: 300 });
    await owner.post(`/deliveries/${d.id}/add-to-document`);
    lines = (await owner.get(`/documents/${o.id}`)).body.lines as any[];
    expect(lines).toHaveLength(2);
    expect(Number(lines.find(l => l.productId === svc).price)).toBe(300);
    expect(lines.find(l => l.productId === goods).qty).toBe('4.000');
    const posted = await order(1, 100);
    const pd = (await owner.put(`/deliveries/by-document/${posted.id}`, { methodId: method })).body;
    expect((await owner.post(`/documents/${posted.id}/post`)).status).toBe(200);
    expect((await owner.post(`/deliveries/${pd.id}/add-to-document`)).status).toBe(409);
  });
  test('a realization based on the order inherits the delivery; the order keeps a link', async () => {
    const r = await mk(owner, `/documents/${o.id}/based-on`, { type: 'realization' });
    const mine = (await owner.get(`/deliveries/by-document/${r.id}`)).body.delivery;
    expect(mine.id).toBe(d.id);
    expect(mine.originDocumentId).toBe(o.id);
    const reLines = (await owner.get(`/documents/${r.id}`)).body.lines as any[];
    expect(mine.lineId).toBe(reLines.find(l => l.productId === svc).id);
    const back = (await owner.get(`/deliveries/by-document/${o.id}`)).body;
    expect(back.delivery).toBeNull();
    expect(back.movedTo).toMatchObject({ documentId: r.id, type: 'realization' });
    // повторное «Добавить в документ» обновляет строку реализации, а не добавляет вторую
    await owner.post(`/deliveries/${d.id}/add-to-document`);
    expect(((await owner.get(`/documents/${r.id}`)).body.lines as any[]).filter(l => l.productId === svc)).toHaveLength(1);
  });
});

describe('statuses and the expense', () => {
  let o: any;
  let d: any;
  const dbRow = async () => (await rows(`select status, expense_amount, expensed_at, delivered_at, expense_cost_item_id from deliveries where id = '${d.id}'`))[0] as any;
  test('assigning a courier moves new to assigned; removing it moves back', async () => {
    o = await order(4, 500);
    d = (await owner.put(`/deliveries/by-document/${o.id}`, { methodId: method, distanceKm: 10, deliveryDate: '2026-10-27', windowFrom: '10:00', windowTo: '12:00' })).body;
    expect((await owner.post(`/deliveries/${d.id}/status`, { status: 'assigned' })).body.error.code).toBe('courier_required');
    expect((await manager.post(`/deliveries/${d.id}/assign`, { courierMemberId: courierId })).body).toMatchObject({ status: 'assigned', courierName: expect.any(String) });
    expect((await owner.post(`/deliveries/${d.id}/assign`, { courierMemberId: null })).body.status).toBe('new');
    await owner.post(`/deliveries/${d.id}/assign`, { courierMemberId: courierId });
  });
  test('delivered writes the expense on the system item; leaving delivered takes it back', async () => {
    expect((await courier.post(`/deliveries/${d.id}/status`, { status: 'in_transit' })).status).toBe(200);
    expect((await dbRow()).expense_amount).toBeNull();
    const r = await courier.post(`/deliveries/${d.id}/status`, { status: 'delivered', comment: 'Отдал на проходной' });
    expect(r.status).toBe(200);
    expect(r.body.comment).toBe('Отдал на проходной');
    const row = await dbRow();
    expect(row.status).toBe('delivered');
    expect(row.expense_amount).toBe('150.00');
    expect(row.expensed_at).not.toBeNull();
    const item = ((await owner.get('/cost-items')).body.items as any[]).find(i => i.systemKey === 'dostavka');
    expect(row.expense_cost_item_id).toBe(item.id);
    // возврат из «доставлена» (админ)
    expect((await owner.post(`/deliveries/${d.id}/status`, { status: 'in_transit' })).status).toBe(200);
    const back = await dbRow();
    expect(back.expense_amount).toBeNull();
    expect(back.expensed_at).toBeNull();
    expect(back.delivered_at).toBeNull();
    await owner.post(`/deliveries/${d.id}/status`, { status: 'delivered' });
    expect((await dbRow()).expense_amount).toBe('150.00');
  });
  test('a failed delivery writes no expense', async () => {
    const o2 = await order(2, 100);
    const d2 = (await owner.put(`/deliveries/by-document/${o2.id}`, { methodId: method, courierMemberId: courierId })).body;
    expect((await courier.post(`/deliveries/${d2.id}/status`, { status: 'failed', comment: 'Нет на месте' })).body.status).toBe('failed');
    expect(((await rows(`select expense_amount from deliveries where id = '${d2.id}'`))[0] as any).expense_amount).toBeNull();
    expect((await owner.post(`/deliveries/${d2.id}/assign`, { courierMemberId: courier2Id })).body.error.code).toBe('delivery_closed');
  });
  test('a work order delivery goes to the work order cost, not to the cost item', async () => {
    const wo = await mk(owner, '/documents', { type: 'work_order', counterpartyId: customer, warehouseId: wh, lines: [{ productId: svc, qty: 1, price: 1000 }] });
    const before = (await owner.get(`/work-orders/${wo.id}/cost`)).body.other.fact;
    const wd = (await owner.put(`/deliveries/by-document/${wo.id}`, { methodId: method, distanceKm: 10, weightKg: 10, courierMemberId: courierId })).body;
    expect((await owner.get(`/work-orders/${wo.id}/cost`)).body.other.fact).toBe(before);
    await courier.post(`/deliveries/${wd.id}/status`, { status: 'delivered' });
    expect((await owner.get(`/work-orders/${wo.id}/cost`)).body.other.fact).toBe('150.00');
    expect(((await rows(`select expense_amount from deliveries where id = '${wd.id}'`))[0] as any).expense_amount).toBeNull();
    await owner.post(`/deliveries/${wd.id}/status`, { status: 'in_transit' });
    expect((await owner.get(`/work-orders/${wo.id}/cost`)).body.other.fact).toBe(before);
  });
});

describe('courier scope', () => {
  test('a courier sees and changes only their own deliveries', async () => {
    const o = await order(1, 100);
    const own = (await owner.put(`/deliveries/by-document/${o.id}`, { methodId: method, courierMemberId: courierId, deliveryDate: '2026-11-05' })).body;
    const o2 = await order(1, 100);
    const foreign = (await owner.put(`/deliveries/by-document/${o2.id}`, { methodId: method, courierMemberId: courier2Id, deliveryDate: '2026-11-05' })).body;
    const list = (await courier.get('/deliveries?from=2026-11-05&to=2026-11-05')).body;
    expect(list.items.map((i: any) => i.id)).toEqual([own.id]);
    expect((await courier2.get('/deliveries?from=2026-11-05&to=2026-11-05')).body.items.map((i: any) => i.id)).toEqual([foreign.id]);
    expect((await manager.get('/deliveries?from=2026-11-05&to=2026-11-05')).body.items).toHaveLength(2);
    expect((await courier.get(`/deliveries/${foreign.id}`)).status).toBe(404);
    expect((await courier.get(`/deliveries/by-document/${o2.id}`)).body.delivery).toBeNull();
    const r = await courier.post(`/deliveries/${foreign.id}/status`, { status: 'delivered' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('delivery_not_yours');
    expect((await courier.post(`/deliveries/${own.id}/status`, { status: 'new' })).body.error.code).toBe('delivery_status_forbidden');
    expect((await courier.put(`/deliveries/by-document/${o.id}`, { price: 1 })).status).toBe(403);
    expect((await courier.post(`/deliveries/${own.id}/assign`, { courierMemberId: courier2Id })).status).toBe(403);
    expect((await courier.get('/deliveries/report?from=2026-01-01&to=2026-12-31')).status).toBe(403);
    expect((await courier.get('/deliveries/mine?date=2026-11-05')).body.items.map((i: any) => i.id)).toEqual([own.id]);
    expect((await courier.get(`/deliveries/route-sheet?courierId=${courier2Id}&date=2026-11-05`)).status).toBe(403);
    // цена видна, себестоимости нет
    expect(list.items[0].ourCost).toBeNull();
  });
  test('the route sheet prints the day of the courier', async () => {
    const res = await courier.get('/deliveries/route-sheet?date=2026-11-05');
    expect(res.status).toBe(200);
    expect(String(res.body)).toContain('Маршрутный лист на 05.11.2026');
    expect(String(res.body)).toContain('Москва, ул. Ленина, 1');
    expect((await owner.get(`/deliveries/route-sheet?courierId=${courier2Id}&date=2026-11-05`)).status).toBe(200);
  });
});

describe('report', () => {
  test('revenue, cost, margin and the failed share; cost and margin are hidden from a member', async () => {
    const q = '/deliveries/report?from=2026-10-01&to=2026-12-31&by=method';
    const o = (await owner.get(q)).body;
    expect(o.totals.count).toBeGreaterThanOrEqual(5);
    expect(o.totals.failed).toBe(1);
    expect(o.totals.cost).not.toBeNull();
    expect(Number(o.totals.margin)).toBe(Number(o.totals.revenue) - Number(o.totals.cost));
    expect(o.rows.find((r: any) => r.label === 'Свой курьер').delivered).toBeGreaterThanOrEqual(1);
    const m = (await manager.get(q)).body;
    expect(m.totals.revenue).toBe(o.totals.revenue);
    expect(m.totals.cost).toBeNull();
    expect(m.totals.margin).toBeNull();
    expect(m.rows.every((r: any) => r.cost === null && r.margin === null)).toBe(true);
    const byCourier = (await owner.get('/deliveries/report?from=2026-10-01&to=2026-12-31&by=courier')).body;
    expect(byCourier.rows.length).toBeGreaterThanOrEqual(2);
    expect((await owner.get('/deliveries/report?from=2026-10-01&to=2026-12-31&by=month')).body.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('tenant isolation', () => {
  test('another workspace sees nothing of ours', async () => {
    expect((await other.get('/delivery-methods')).body.items).toHaveLength(0);
    expect((await other.get('/deliveries')).body.total).toBe(0);
    const any = (await owner.get('/deliveries')).body.items[0];
    expect((await other.get(`/deliveries/${any.id}`)).status).toBe(404);
    expect((await other.post(`/deliveries/${any.id}/status`, { status: 'delivered' })).status).toBe(404);
    expect((await other.put(`/deliveries/by-document/${any.documentId}`, { methodId: method })).status).toBe(404);
    expect((await other.patch(`/delivery-methods/${method}`, { name: 'Хак' })).status).toBe(404);
    const otherOrder = await mk(other, '/documents', { type: 'customer_order', lines: [] }).catch(() => null);
    if (otherOrder) expect((await other.put(`/deliveries/by-document/${otherOrder.id}`, { methodId: method })).status).toBe(404);
  });
});
