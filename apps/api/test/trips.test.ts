/* Задача 1211: рейсы — расчёты (загрузка, окна, пересечения, расстояние), жизненный цикл (план → в пути → выполнен / отменён),
   занятость машины и водителя, доставки в рейсе (курьер из рейса, синхронизация статусов), контроль вместимости (предупреждение / запрет),
   междугородний рейс, путевой лист из рейса, события для автоматизаций, диспетчер, печать, права и изоляция. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { routeStraightKm, tripOverloads, tripPeakLoad, tripsOverlap, windowOrderConflicts } from '@gr8r/shared';
import { Client, admin } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let drv1: string;
let drv2: string;
let truck: string;
let van: string;
let customer: string;
let goods: string;
let method: string;
let wh: string;
const day = (n = 0) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
/** Доставка на новом заказе; вес задаётся явно */
const delivery = async (weightKg: number, extra: Record<string, unknown> = {}) => {
  const o = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: wh, lines: [{ productId: goods, qty: 1, price: 100 }] });
  return (await owner.put(`/deliveries/by-document/${o.id}`, { methodId: method, distanceKm: 5, weightKg, address: `Москва, ул. Тестовая, ${Math.round(Math.random() * 900)}`, ...extra })).body as any;
};
const trip = async (body: Record<string, unknown>) => mk(owner, '/trips', { dateFrom: day(0), vehicleId: truck, driverMemberId: drv1, ...body });
const dbDelivery = async (id: string) => (await admin.unsafe(`select status, courier_member_id, delivery_date from deliveries where id='${id}'`))[0] as any;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Рейсы WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  const second = new Client();
  await second.signup();
  const inv2 = await owner.post(`/workspaces/${ws}/invites`, { email: second.user!.email, role: 'member' });
  await second.post('/invites/accept', { token: inv2.body.token });
  other = new Client();
  await other.signup({ workspaceName: 'Чужие рейсы WS' });
  const people = (await owner.get('/members')).body.items as any[];
  drv1 = people.find(m => m.email === member.user!.email).id;
  drv2 = people.find(m => m.email === second.user!.email).id;
  truck = (await mk(owner, '/fleet/vehicles', { plate: 'Т111ТТ77', kind: 'truck', capacityKg: 1000, volumeM3: 10, pallets: 4, fuelNormSummer: 20 })).id;
  van = (await mk(owner, '/fleet/vehicles', { plate: 'В222ВВ77', kind: 'van', capacityKg: 300, fuelNormSummer: 12 })).id;
  wh = (await owner.get('/warehouses')).body.items[0].id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Получатель»', actualAddress: 'Москва, ул. Ленина, 1' })).id;
  goods = (await mk(owner, '/products', { name: 'Товар', kind: 'goods', unitCode: '796', price: 100, purchasePrice: 10, vatRate: 'none' })).id;
  const svc = (await mk(owner, '/products', { name: 'Доставка', kind: 'service', unitCode: '876', price: 0, vatRate: 'none' })).id;
  method = (await mk(owner, '/delivery-methods', { name: 'Свой курьер', kind: 'own_courier', productId: svc, clientRate: { base: 100 } })).id;
});

describe('pure calculations', () => {
  test('peak load, overloads, windows, overlaps, straight distance', () => {
    const stops = [
      { seq: 1, kind: 'load' as const, weightKg: '500', volumeM3: '5', pallets: 2 },
      { seq: 2, kind: 'load' as const, weightKg: '400', volumeM3: '3', pallets: 1 },
      { seq: 3, kind: 'unload' as const, weightKg: '700', volumeM3: '6', pallets: 2 },
      { seq: 4, kind: 'delivery' as const, weightKg: '200', volumeM3: '0', pallets: 0 },
    ];
    // груз «доставки» едет с начала: 200 → 700 → 1100 → 400 → 200
    expect(tripPeakLoad(stops)).toEqual({ weightKg: '1100.000', volumeM3: '8.000', pallets: 3 });
    expect(tripOverloads({ weightKg: '1100.000', volumeM3: '8.000', pallets: 3 }, { capacityKg: '1000', volumeM3: null, pallets: 2 }).map(o => o.kind)).toEqual(['weight', 'pallets']);
    expect(windowOrderConflicts([{ seq: 1, windowFrom: '14:00', windowTo: '16:00' }, { seq: 2, windowFrom: '09:00', windowTo: '11:00' }])).toEqual([2]);
    expect(windowOrderConflicts([{ seq: 1, windowFrom: '09:00', windowTo: '11:00' }, { seq: 2, windowFrom: '10:00', windowTo: '12:00' }])).toEqual([]);
    expect(tripsOverlap({ dateFrom: '2026-10-30', dateTo: '2026-10-30' }, { dateFrom: '2026-10-30', dateTo: '2026-10-31' })).toBe(true);
    expect(tripsOverlap({ dateFrom: '2026-10-30', dateTo: '2026-10-30', startTime: '08:00', endTime: '12:00' }, { dateFrom: '2026-10-30', dateTo: '2026-10-30', startTime: '13:00', endTime: '17:00' })).toBe(false);
    const r = routeStraightKm([{ lat: 55.75, lon: 37.62 }, { lat: 59.93, lon: 30.31 }, { lat: null, lon: null }]);
    expect(Number(r!.km)).toBeGreaterThan(600);
    expect(Number(r!.km)).toBeLessThan(660);
    expect(routeStraightKm([{ lat: null, lon: null }, { lat: 1, lon: 1 }])).toBeNull();
  });
});

describe('city trip lifecycle with deliveries', () => {
  let t: any;
  let d1: any;
  let d2: any;
  let d3: any;
  test('creation: a city trip is one day, the vehicle and driver are busy, a non-overlapping time is allowed', async () => {
    t = await trip({ dateTo: day(3), startTime: '08:00', endTime: '12:00' });
    expect(t).toMatchObject({ number: expect.stringMatching(/^РС-\d{4}-\d{5}$/), kind: 'city', status: 'planned', dateTo: day(0) });
    expect((await owner.post('/trips', { dateFrom: day(0), vehicleId: truck, driverMemberId: drv2, startTime: '10:00', endTime: '14:00' })).body.error.code).toBe('trip_vehicle_busy');
    expect((await owner.post('/trips', { dateFrom: day(0), vehicleId: van, driverMemberId: drv1 })).body.error.code).toBe('trip_driver_busy');
    const later = await trip({ startTime: '13:00', endTime: '17:00' });
    expect(later.status).toBe('planned');
    expect((await owner.del(`/trips/${later.id}`)).status).toBe(200);
    expect((await owner.post('/trips', { dateFrom: day(0), vehicleId: truck, driverMemberId: drv2, kind: 'intercity', dateTo: day(-1) })).body.error.code).toBe('trip_dates_invalid');
  });

  test('a delivery in a trip takes the courier from the trip; it cannot be in two trips; the courier cannot be changed by hand', async () => {
    d1 = await delivery(300, { deliveryDate: day(0), windowFrom: '09:00', windowTo: '11:00' });
    d2 = await delivery(300, { windowFrom: '14:00', windowTo: '16:00' });
    d3 = await delivery(500);
    const board0 = (await owner.get(`/trips/dispatch?date=${day(0)}`)).body;
    expect(board0.unassigned.map((x: any) => x.id)).toEqual(expect.arrayContaining([d1.id, d2.id, d3.id]));
    const s1 = (await owner.post(`/trips/${t.id}/deliveries`, { deliveryId: d1.id })).body;
    expect(s1).toMatchObject({ kind: 'delivery', sourceKind: 'delivery', deliveryId: d1.id, seq: 1, weightKg: '300.000', windowFrom: '09:00:00' });
    expect(await dbDelivery(d1.id)).toMatchObject({ status: 'assigned', courier_member_id: drv1 });
    expect((await owner.post(`/trips/${t.id}/deliveries`, { deliveryId: d1.id })).body.error.code).toBe('delivery_in_trip');
    expect((await owner.post(`/deliveries/${d1.id}/assign`, { courierMemberId: drv2 })).body.error.code).toBe('delivery_in_trip');
    const board = (await owner.get(`/trips/dispatch?date=${day(0)}`)).body;
    expect(board.unassigned.map((x: any) => x.id)).not.toContain(d1.id);
    expect(board.trips.find((x: any) => x.id === t.id).stops).toHaveLength(1);
    // вторая — перед первой (индекс 0), порядок хранится
    await owner.post(`/trips/${t.id}/deliveries`, { deliveryId: d2.id, index: 0 });
    const full = (await owner.get(`/trips/${t.id}`)).body;
    expect(full.stops.map((s: any) => s.deliveryId)).toEqual([d2.id, d1.id]);
    expect(full.stops.map((s: any) => s.seq)).toEqual([1, 2]);
    // окно второй точки (14–16) начинается позже окна первой (9–11): порядок противоречит окнам
    expect(full.warnings).toEqual([{ code: 'window_order', seq: 2 }]);
    expect((await owner.put(`/trips/${t.id}/order`, { stopIds: [full.stops[0].id] })).body.error.code).toBe('trip_order_invalid');
    const re = await owner.put(`/trips/${t.id}/order`, { stopIds: [full.stops[1].id, full.stops[0].id] });
    expect(re.body.items.map((s: any) => s.deliveryId)).toEqual([d1.id, d2.id]);
    expect((await owner.get(`/trips/${t.id}`)).body.warnings).toEqual([]);
  });

  test('capacity: a warning by default, a ban by the setting', async () => {
    // 300 + 300 = 600 кг в машине на 1000 — в норме; третья 500 даёт 1100
    const r = await owner.post(`/trips/${t.id}/deliveries`, { deliveryId: d3.id });
    expect(r.status).toBe(201);
    const view = (await owner.get(`/trips/${t.id}`)).body;
    expect(view.overloads).toEqual([{ kind: 'weight', peak: '1100.000', limit: '1000.000' }]);
    expect(view.warnings.some((w: any) => w.code === 'overload')).toBe(true);
    expect((await member.put('/trips/settings', { capacityMode: 'block' })).status).toBe(403);
    expect((await owner.put('/trips/settings', { capacityMode: 'block' })).body).toEqual({ capacityMode: 'block' });
    // при запрете рейс не уйдёт, а ещё одна лишняя точка не добавится
    expect((await owner.post(`/trips/${t.id}/start`)).body.error.code).toBe('trip_overloaded');
    const extra = await delivery(10);
    expect((await owner.post(`/trips/${t.id}/deliveries`, { deliveryId: extra.id })).body.error.code).toBe('trip_overloaded');
    expect((await dbDelivery(extra.id)).courier_member_id).toBeNull();
    // убрать лишнюю точку — доставка освобождается
    const s3 = view.stops.find((s: any) => s.deliveryId === d3.id);
    expect((await owner.del(`/trips/${t.id}/stops/${s3.id}`)).status).toBe(200);
    expect(await dbDelivery(d3.id)).toMatchObject({ status: 'new', courier_member_id: null });
    expect((await owner.get(`/trips/${t.id}`)).body.overloads).toEqual([]);
    await owner.put('/trips/settings', { capacityMode: 'warn' });
  });

  test('start sends the deliveries; stops move the deliveries; the trip completes only when every stop is closed; events fire', async () => {
    const started = (await owner.post(`/trips/${t.id}/start`)).body;
    expect(started.status).toBe('in_transit');
    expect(await dbDelivery(d1.id)).toMatchObject({ status: 'in_transit' });
    expect((await owner.post(`/trips/${t.id}/complete`)).body.error.code).toBe('trip_stops_open');
    expect((await owner.patch(`/trips/${t.id}`, { vehicleId: van })).body.error.code).toBe('trip_not_planned');
    const stops = (await owner.get(`/trips/${t.id}`)).body.stops;
    expect((await owner.post(`/trips/${t.id}/stops/${stops[0].id}/status`, { status: 'done' })).body.status).toBe('done');
    expect((await dbDelivery(d1.id)).status).toBe('delivered');
    expect((await owner.post(`/trips/${t.id}/stops/${stops[1].id}/status`, { status: 'failed', comment: 'Никого нет' })).status).toBe(200);
    expect((await dbDelivery(d2.id)).status).toBe('failed');
    expect((await owner.patch(`/trips/${t.id}/stops/${stops[0].id}`, { address: 'x' })).body.error.code).toBe('stop_finished');
    // доставку, отмеченную водителем напрямую, точка тоже видит
    const d4 = await delivery(5);
    const t2 = await trip({ vehicleId: van, driverMemberId: drv2, dateFrom: day(1) });
    const s4 = (await owner.post(`/trips/${t2.id}/deliveries`, { deliveryId: d4.id })).body;
    await owner.post(`/trips/${t2.id}/start`);
    expect((await owner.post(`/deliveries/${d4.id}/status`, { status: 'delivered' })).status).toBe(200);
    expect((await owner.get(`/trips/${t2.id}`)).body.stops.find((s: any) => s.id === s4.id).status).toBe('done');
    expect((await owner.post(`/trips/${t2.id}/complete`)).body.status).toBe('done');
    expect((await owner.post(`/trips/${t.id}/complete`)).body).toMatchObject({ status: 'done', finishedAt: expect.any(String) });
    expect((await owner.post(`/trips/${t.id}/stops`, { address: 'x' })).body.error.code).toBe('trip_closed');
    const evs = (await admin.unsafe(`select type from events where workspace_id='${ws}' and entity='fleet_trip' and type in ('fleet_trip.started','fleet_trip.completed') and record_id='${t.id}'`)) as any[];
    expect(evs.map(e => e.type).sort()).toEqual(['fleet_trip.completed', 'fleet_trip.started']);
  });

  test('waybill from the trip: once, linked by trip_id; print; the FK clears the link when the trip is deleted', async () => {
    const t3 = await trip({ dateFrom: day(2), name: 'Тест' });
    await owner.post(`/trips/${t3.id}/stops`, { kind: 'delivery', address: 'Москва, Арбат 1', title: 'Точка', weightKg: 10 });
    const w = (await owner.post(`/trips/${t3.id}/waybill`)).body;
    expect(w).toMatchObject({ tripId: t3.id, vehicleId: truck, driverMemberId: drv1, date: day(2), route: 'Москва, Арбат 1' });
    expect((await owner.post(`/trips/${t3.id}/waybill`)).body.error.code).toBe('trip_waybill_exists');
    expect((await owner.get(`/trips/${t3.id}`)).body.waybills).toEqual([expect.objectContaining({ id: w.id })]);
    const html = await owner.get(`/trips/${t3.id}/print`);
    expect(html.status).toBe(200);
    expect(String(html.body)).toContain(`Маршрутный лист рейса ${t3.number}`);
    expect(String(html.body)).toContain('Арбат');
    expect((await owner.del(`/trips/${t3.id}`)).status).toBe(200);
    expect(((await admin.unsafe(`select trip_id from fleet_waybills where id='${w.id}'`))[0] as any).trip_id).toBeNull();
  });

  test('cancel releases the unfinished deliveries; a delivery without a trip works as before', async () => {
    const d5 = await delivery(20);
    const t4 = await trip({ dateFrom: day(5) });
    await owner.post(`/trips/${t4.id}/deliveries`, { deliveryId: d5.id });
    expect((await dbDelivery(d5.id)).courier_member_id).toBe(drv1);
    expect((await owner.post(`/trips/${t4.id}/cancel`)).body.status).toBe('cancelled');
    expect(await dbDelivery(d5.id)).toMatchObject({ status: 'new', courier_member_id: null });
    expect((await owner.post(`/deliveries/${d5.id}/assign`, { courierMemberId: drv2 })).body.status).toBe('assigned');
    // отменённый рейс не держит машину
    expect((await trip({ dateFrom: day(5) })).status).toBe('planned');
  });
});

describe('intercity trip', () => {
  test('several days, manual load and unload points, a stop day inside the period, source field, coordinates and straight distance', async () => {
    const t = await trip({ kind: 'intercity', dateFrom: day(10), dateTo: day(12), vehicleId: truck, driverMemberId: drv2, coDriverMemberId: drv1, name: 'Москва — Санкт-Петербург' });
    expect(t).toMatchObject({ kind: 'intercity', dateFrom: day(10), dateTo: day(12) });
    const a = (await owner.post(`/trips/${t.id}/stops`, { kind: 'load', address: 'Москва, склад', lat: 55.75, lon: 37.62, weightKg: 900, pallets: 3, day: day(10) })).body;
    expect(a.sourceKind).toBe('manual');
    const b = (await owner.post(`/trips/${t.id}/stops`, { kind: 'unload', address: 'Санкт-Петербург, терминал', lat: 59.93, lon: 30.31, weightKg: 900, pallets: 3, day: day(12), sourceKind: 'transport_order', sourceId: '00000000-0000-7000-8000-000000000001' })).body;
    expect(b).toMatchObject({ sourceKind: 'transport_order', sourceId: '00000000-0000-7000-8000-000000000001' });
    expect((await owner.post(`/trips/${t.id}/stops`, { kind: 'unload', address: 'x', day: day(20) })).body.error.code).toBe('trip_stop_day');
    const v = (await owner.get(`/trips/${t.id}`)).body;
    expect(v.coDriverName).toBeTruthy();
    expect(Number(v.straightKm)).toBeGreaterThan(600);
    expect(v.stops[0].legKm).toBeNull();
    expect(Number(v.stops[1].legKm)).toBeGreaterThan(600);
    expect(v.load).toEqual({ weightKg: '900.000', volumeM3: '0.000', pallets: 3 });
    // водитель, занятый как второй, недоступен на эти дни
    expect((await owner.post('/trips', { dateFrom: day(11), vehicleId: van, driverMemberId: drv1 })).body.error.code).toBe('trip_driver_busy');
    expect((await owner.patch(`/trips/${t.id}`, { dateTo: day(13) })).status).toBe(200);
    const list = (await owner.get(`/trips?from=${day(10)}&to=${day(13)}`)).body;
    expect(list.items.map((x: any) => x.id)).toContain(t.id);
    expect(list.items.find((x: any) => x.id === t.id)).toMatchObject({ plate: 'Т111ТТ77', stopsTotal: 2, stopsDone: 0 });
  });
});

describe('rights, modules and isolation', () => {
  test('a foreign tenant sees nothing; a guest cannot write', async () => {
    const t = await trip({ dateFrom: day(30) });
    expect((await other.get(`/trips/${t.id}`)).status).toBe(404);
    expect((await other.get('/trips')).body.items).toEqual([]);
    expect((await other.post('/trips', { dateFrom: day(30), vehicleId: truck, driverMemberId: drv1 })).status).toBeGreaterThanOrEqual(400);
    const guest = new Client();
    await guest.signup();
    const inv = await owner.post(`/workspaces/${ws}/invites`, { email: guest.user!.email, role: 'guest' });
    await guest.post('/invites/accept', { token: inv.body.token });
    guest.workspaceId = ws;
    expect((await guest.get('/trips')).status).toBe(200);
    expect((await guest.post('/trips', { dateFrom: day(31), vehicleId: truck, driverMemberId: drv1 })).status).toBe(403);
  });
});
