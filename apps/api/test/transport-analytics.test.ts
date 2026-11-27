/* Задача 1216: аналитика транспорта — стоимость на заказ и на км, OTD, загрузка машин, выработка водителей и курьеров,
   изоляция воркспейсов, лицензия модуля transport и скрытие финансовых полей от member/guest. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { addMember, admin, Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let drvId: string;
let courierId: string;
let truckId: string;
let customerId: string;
let whId: string;
let goodsId: string;
let methodId: string;
let orgId: string;

const FROM = '2026-10-01';
const TO = '2026-10-31';

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Аналитика транспорта WS' });
  member = await addMember(owner, 'member');
  const courierClient = await addMember(owner, 'member');
  other = new Client();
  await other.signup({ workspaceName: 'Чужая аналитика WS' });

  expect((await owner.patch('/billing/timezone', { timezone: 'UTC' })).status).toBe(200);

  const people = (await owner.get('/members')).body.items as any[];
  drvId = people.find(m => m.email === member.user!.email).id;
  courierId = people.find(m => m.email === courierClient.user!.email).id;

  orgId = (await owner.get('/organizations')).body.items[0].id;
  whId = (await owner.get('/warehouses')).body.items[0].id;
  truckId = (await mk(owner, '/fleet/vehicles', { plate: 'А100АА77', kind: 'truck', capacityKg: 1000, volumeM3: 10, pallets: 4, fuelNormSummer: 20 })).id;
  customerId = (await mk(owner, '/companies', { name: 'ООО «Клиент Логистики»', actualAddress: 'Москва, Тверская, 1' })).id;
  goodsId = (await mk(owner, '/products', { name: 'Груз', kind: 'goods', unitCode: '796', price: 100, purchasePrice: 10, vatRate: 'none' })).id;
  const svcId = (await mk(owner, '/products', { name: 'Доставка', kind: 'service', unitCode: '876', price: 0, vatRate: 'none' })).id;
  methodId = (await mk(owner, '/delivery-methods', { name: 'Свой курьер', kind: 'own_courier', productId: svcId, clientRate: { base: 1000 }, costRate: { base: 500 } })).id;

  // 3 доставки: 2 в рейсе (1 вовремя, 1 с опозданием), 1 отдельным курьером (отказ)
  const doc1 = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customerId, warehouseId: whId, lines: [{ productId: goodsId, qty: 1, price: 100 }] });
  const del1 = (await owner.put(`/deliveries/by-document/${doc1.id}`, { methodId, deliveryDate: '2026-10-10', windowFrom: '09:00', windowTo: '12:00', distanceKm: 15, weightKg: 400, price: 1000, ourCost: 400, address: 'Адрес 1' })).body;

  const doc2 = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customerId, warehouseId: whId, lines: [{ productId: goodsId, qty: 1, price: 100 }] });
  const del2 = (await owner.put(`/deliveries/by-document/${doc2.id}`, { methodId, deliveryDate: '2026-10-10', windowFrom: '13:00', windowTo: '15:00', distanceKm: 20, weightKg: 300, price: 1200, ourCost: 400, address: 'Адрес 2' })).body;

  const doc3 = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customerId, warehouseId: whId, lines: [{ productId: goodsId, qty: 1, price: 100 }] });
  const del3 = (await owner.put(`/deliveries/by-document/${doc3.id}`, { methodId, courierMemberId: courierId, deliveryDate: '2026-10-12', windowFrom: '10:00', windowTo: '12:00', distanceKm: 20, weightKg: 100, price: 800, ourCost: 300, address: 'Адрес 3' })).body;
  await mk(owner, `/deliveries/${del3.id}/status`, { status: 'failed', comment: 'Клиент не открыл' });

  // Рейс 2026-10-10 на truckId с drvId, обе доставки как точки + путевой лист с пробегом 100 км
  const trip = await mk(owner, '/trips', { kind: 'city', dateFrom: '2026-10-10', vehicleId: truckId, driverMemberId: drvId, name: 'Рейс 10 окт' });
  const stop1 = await mk(owner, `/trips/${trip.id}/deliveries`, { deliveryId: del1.id });
  const stop2 = await mk(owner, `/trips/${trip.id}/deliveries`, { deliveryId: del2.id });
  await mk(owner, `/trips/${trip.id}/start`, {});
  await mk(owner, `/trips/${trip.id}/stops/${stop1.id}/status`, { status: 'done' });
  await mk(owner, `/trips/${trip.id}/stops/${stop2.id}/status`, { status: 'done' });
  // Зафиксируем точное время прибытия в БД: del1 вовремя (11:30 <= 12:00), del2 с опозданием (15:45 > 15:00)
  await admin`update fleet_trip_stops set arrived_at = '2026-10-10T11:30:00Z', done_at = '2026-10-10T11:35:00Z' where id = ${stop1.id}`;
  await admin`update fleet_trip_stops set arrived_at = '2026-10-10T15:45:00Z', done_at = '2026-10-10T15:50:00Z' where id = ${stop2.id}`;
  await admin`update deliveries set delivered_at = '2026-10-10' where id in (${del1.id}, ${del2.id})`;
  await mk(owner, `/trips/${trip.id}/complete`, {});

  // Закрытый путевой лист по рейсу (100 км) + заправка (3000 руб) + проведённый ремонт (2000 руб)
  const wb = await mk(owner, `/trips/${trip.id}/waybill`, {});
  await owner.patch(`/fleet/waybills/${wb.id}`, { odometerOut: 1000, odometerBack: 1100, fuelOut: 50, fuelBack: 30, medicalOk: true, techOk: true });
  await mk(owner, `/fleet/waybills/${wb.id}/issue`, {});
  await mk(owner, `/fleet/waybills/${wb.id}/close`, {});
  await mk(owner, '/fleet/fuel', { vehicleId: truckId, waybillId: wb.id, date: '2026-10-10', liters: 40, amount: 3000 });
  const rep = await mk(owner, '/fleet/repairs', { kind: 'repair', vehicleId: truckId, date: '2026-10-15', description: 'ТО', lines: [{ kind: 'work', name: 'Замена масла', qty: 1, price: 2000 }] });
  await mk(owner, `/fleet/repairs/${rep.id}/post`, {});

  // Заявка на перевозку, выполненная в этом же периоде (или начисление водителю за рейс)
  await mk(owner, '/payroll/employees', { memberId: drvId, organizationId: orgId, salary: 0, hiredAt: '2026-01-01' });
  await owner.put('/payroll/settings', { tripPieceworkRate: 1000, insuranceRate: 0 });
  const pr = await mk(owner, '/payroll', { period: '2026-10-01', organizationId: orgId });
  await mk(owner, `/payroll/${pr.id}/fill`, {});
  await mk(owner, `/payroll/${pr.id}/post`, {});
});

describe('GET /trips/analytics', () => {
  test('validates period bounds', async () => {
    const badOrder = await owner.get('/trips/analytics?from=2026-10-20&to=2026-10-10');
    expect(badOrder.status).toBe(422);
    expect(badOrder.body.error.code).toBe('report_period_invalid');

    const tooLong = await owner.get('/trips/analytics?from=2025-01-01&to=2026-10-31');
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error.code).toBe('report_period_invalid');
  });

  test('computes cost per order & km, OTD %, vehicle load, and driver output for admin/owner', async () => {
    const res = await owner.get(`/trips/analytics?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.canSeeCost).toBe(true);
    // 2 доставленных заказа + 0 transport orders; 1 рейс; пробег = 100 км (путевой лист) + 20 км (отдельная доставка del3) = 120.0
    expect(b.summary.ordersCount).toBe(2);
    expect(b.summary.deliveriesCompleted).toBe(2);
    expect(b.summary.tripsCount).toBe(1);
    expect(b.summary.totalKm).toBe('120.0');
    // Затраты: топливо 3000 + ремонт 2000 + зарплата 1000 = 6000.00 (доставки в рейсе с собственными затратами не дублируются)
    expect(b.cost.fuelCost).toBe('3000.00');
    expect(b.cost.repairCost).toBe('2000.00');
    expect(b.cost.driverPayCost).toBe('1000.00');
    expect(b.cost.totalCost).toBe('6000.00');
    expect(b.cost.totalRevenue).toBe('2200.00');
    expect(b.summary.costPerOrder).toBe('3000.00');
    expect(b.summary.costPerKm).toBe('50.00');

    // OTD: del1 вовремя (1), del2 с опозданием 45 мин (1), del3 отказ (1) -> 1/3 = 33.3%
    expect(b.otd.onTime).toBe(1);
    expect(b.otd.late).toBe(1);
    expect(b.otd.failed).toBe(1);
    expect(b.otd.otdPct).toBe('33.3');
    const lateRow = b.otd.rows.find((r: any) => r.status === 'late');
    expect(lateRow.delayMinutes).toBe(45);

    // Загрузка машины: 400 + 300 = 700 кг из 1000 кг -> 70.0%
    const v = b.vehicles.find((x: any) => x.vehicleId === truckId);
    expect(v).toBeTruthy();
    expect(v.tripsCount).toBe(1);
    expect(v.distanceKm).toBe('100.0');
    expect(v.weightUtilizationPct).toBe('70.0');
    expect(v.totalCost).toBe('5000.00');
    expect(v.costPerKm).toBe('50.00');

    // Водители и курьеры
    const drv = b.drivers.find((x: any) => x.memberId === drvId);
    expect(drv).toBeTruthy();
    expect(drv.tripsCount).toBe(1);
    expect(drv.deliveriesCompleted).toBe(2);
    expect(drv.distanceKm).toBe('100.0');
    expect(drv.otdPct).toBe('50.0');
    expect(drv.payrollAmount).toBe('1000.00');

    const cour = b.drivers.find((x: any) => x.memberId === courierId);
    expect(cour).toBeTruthy();
    expect(cour.deliveriesFailed).toBe(1);
    expect(cour.otdPct).toBe('0.0');
  });

  test('masks financial and payroll fields for non-admin members', async () => {
    const res = await member.get(`/trips/analytics?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.canSeeCost).toBe(false);
    expect(b.summary.ordersCount).toBe(2);
    expect(b.summary.otdPct).toBe('33.3');
    expect(b.summary.totalCost).toBeNull();
    expect(b.summary.costPerOrder).toBeNull();
    expect(b.summary.costPerKm).toBeNull();
    expect(b.cost.fuelCost).toBeNull();
    expect(b.vehicles[0].weightUtilizationPct).toBe('70.0');
    expect(b.vehicles[0].totalCost).toBeNull();
    expect(b.drivers.find((x: any) => x.memberId === drvId).payrollAmount).toBeNull();
  });

  test('isolates analytics across workspaces', async () => {
    const res = await other.get(`/trips/analytics?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.ordersCount).toBe(0);
    expect(res.body.summary.tripsCount).toBe(0);
    expect(res.body.vehicles).toHaveLength(0);
  });
});
