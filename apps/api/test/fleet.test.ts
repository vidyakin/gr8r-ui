/* Задача 1210: автопарк — машины и водители (функция driver), документы со сроками и напоминания воркера (идемпотентные), путевой лист
   (отметки, просроченное ОСАГО, закрытие: пробег, норма против факта), топливо (привязка к листу, выписка CSV без дублей),
   регламент ТО, ремонт с запчастями со склада (списание и откат), штрафы с водителем по листу, затраты, печать, права и изоляция. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin } from './helpers';
import { runFleetOnce } from '../../worker/src/fleet';
import { parseFuelCsv, serviceDue, waybillFuel, docTermState, fuelNormPer100 } from '@gr8r/shared';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let driverId: string;
let vehicle: string;
let vehicle2: string;
const iso = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Автопарк WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужой автопарк WS' });
  const people = (await owner.get('/members')).body.items as any[];
  driverId = people.find(m => m.email === member.user!.email).id;
  const pos = await mk(owner, '/positions', { name: 'Водитель', functions: ['driver'], sections: ['transport'] });
  expect((await owner.put(`/positions/by-member/${driverId}`, { positionIds: [pos.id] })).status).toBe(200);
  vehicle = (await mk(owner, '/fleet/vehicles', { plate: 'А123ВС77', kind: 'truck', make: 'ГАЗ', model: 'ГАЗон Next', capacityKg: 5000, volumeM3: 30, pallets: 12, fuelNormSummer: 20, fuelNormWinter: 24, odometer: 1000 })).id;
  vehicle2 = (await mk(owner, '/fleet/vehicles', { plate: 'К777КК77', kind: 'van', fuelNormSummer: 12 })).id;
});

describe('pure calculations', () => {
  test('norms, terms, service due and CSV', () => {
    expect(fuelNormPer100({ summer: '20', winter: '24' }, '2026-01-15')).toBe('24');
    expect(fuelNormPer100({ summer: '20', winter: null }, '2026-01-15')).toBe('20');
    expect(fuelNormPer100({ summer: '20', winter: '24' }, '2026-07-01')).toBe('20');
    expect(waybillFuel({ fuelOut: '30', fuelBack: '10', fuelFilled: '50', odometerOut: '1000', odometerBack: '1200', normPer100: '20' })).toMatchObject({ distanceKm: '200.000', normLiters: '40.000', actualLiters: '70.000', deltaLiters: '30.000' });
    expect(docTermState('2026-10-01', 30, '2026-10-30')).toEqual({ state: 'expired', daysLeft: -29 });
    expect(docTermState('2026-11-15', 30, '2026-10-30').state).toBe('expiring');
    expect(docTermState(null, 30, '2026-10-30').state).toBe('unlimited');
    expect(serviceDue({ everyKm: 10000, everyMonths: 12, lastKm: '5000', lastDate: '2026-01-31' }, '14000', '2026-10-30')).toMatchObject({ dueKm: '15000', dueDate: '2027-01-31', leftKm: '1000', overdue: false, soon: true });
    const rows = parseFuelCsv('Дата;Карта;Литры;Сумма;АЗС\n30.10.2026 12:00;7001;40,5;2 430,00;Лукойл\n;7001;1;1;x\n2026-10-30;;5;10;');
    expect(rows[0]).toMatchObject({ date: '2026-10-30', liters: '40.5', amount: '2430.00', card: '7001' });
    expect(rows[1]!.error).toBe('bad_date');
    expect(rows[2]!.error).toBe('no_vehicle');
  });
});

describe('vehicles and drivers', () => {
  test('plate is unique, the driver list follows the function, a profile is saved', async () => {
    expect((await owner.post('/fleet/vehicles', { plate: 'а123вс77' })).status).toBe(409);
    const v = (await owner.get(`/fleet/vehicles/${vehicle}`)).body;
    expect(v).toMatchObject({ plate: 'А123ВС77', capacityKg: '5000.000', pallets: 12 });
    const drivers = (await owner.get('/fleet/drivers')).body.items as any[];
    expect(drivers.map(d => d.memberId)).toEqual([driverId]);
    const p = await owner.put(`/fleet/drivers/${driverId}`, { licenseNumber: '77 11 123456', categories: ['B', 'C'], phone: '+7 900 111-22-33' });
    expect(p.body.categories).toEqual(['B', 'C']);
    expect((await owner.get('/fleet/drivers')).body.items[0]).toMatchObject({ licenseNumber: '77 11 123456' });
  });
});

describe('documents and reminders', () => {
  test('owner kind is checked, terms are computed, the worker reminds once per term and the extension resets it', async () => {
    expect((await owner.post('/fleet/documents', { kind: 'osago', memberId: driverId })).body.error.code).toBe('fleet_document_owner');
    expect((await owner.post('/fleet/documents', { kind: 'license', vehicleId: vehicle })).body.error.code).toBe('fleet_document_owner');
    const osago = await mk(owner, '/fleet/documents', { kind: 'osago', vehicleId: vehicle, number: 'XXX 1', validUntil: iso(10), remindDays: 30 });
    await mk(owner, '/fleet/documents', { kind: 'inspection', vehicleId: vehicle, validUntil: iso(200) });
    const lic = await mk(owner, '/fleet/documents', { kind: 'license', memberId: driverId, number: '77 11 123456', validUntil: iso(-1) });
    const list = (await owner.get('/fleet/documents')).body.items as any[];
    expect(list.find(d => d.id === osago.id)).toMatchObject({ state: 'expiring', daysLeft: 10 });
    expect(list.find(d => d.id === lic.id).state).toBe('expired');
    expect((await owner.get('/fleet/documents?term=expired')).body.items).toHaveLength(1);

    const before = ((await admin.unsafe(`select count(*)::int n from notifications where workspace_id='${ws}'`))[0] as any).n;
    expect(await runFleetOnce(admin)).toBeGreaterThanOrEqual(2);
    expect(await runFleetOnce(admin)).toBe(0); // повтор ничего не создаёт
    const after = ((await admin.unsafe(`select count(*)::int n from notifications where workspace_id='${ws}'`))[0] as any).n;
    expect(after).toBeGreaterThan(before);
    const evs = (await admin.unsafe(`select type from events where workspace_id='${ws}' and entity='fleet_document' and type in ('fleet_document.expiring','fleet_document.expired')`)) as any[];
    expect(evs.map(e => e.type).sort()).toEqual(['fleet_document.expired', 'fleet_document.expiring']);
    // продление сбрасывает отметку: новый срок снова не просрочен и не истекает — тишина; затем истекает — снова напоминание
    await owner.patch(`/fleet/documents/${lic.id}`, { validUntil: iso(5) });
    expect(await runFleetOnce(admin)).toBe(1);
    // сводка и список машин показывают предупреждения
    expect((await owner.get('/fleet/summary')).body).toMatchObject({ docsExpiring: 2 });
    expect(((await owner.get('/fleet/vehicles')).body.items as any[]).find(v => v.id === vehicle).docsExpiring).toBe(1);
  });
});

describe('waybill', () => {
  test('checks, expired documents, closing: distance, norm against fact, odometer; print', async () => {
    const w = await mk(owner, '/fleet/waybills', { vehicleId: vehicle, driverMemberId: driverId, date: '2026-07-01', route: 'Москва — Тула', fuelOut: 30 });
    expect(w).toMatchObject({ number: expect.stringMatching(/^ПЛ-2026-\d{5}$/), status: 'draft', odometerOut: '1000.000', normPer100: '20.00' });
    expect((await owner.post(`/fleet/waybills/${w.id}/issue`)).body.error.code).toBe('waybill_checks_required');
    await owner.patch(`/fleet/waybills/${w.id}`, { medicalOk: true, medicalTime: '07:30', medicalBy: 'Фельдшер Иванова', techOk: true, techTime: '07:40', techBy: 'Механик Сидоров' });
    // права водителя просрочены на дату листа
    await owner.patch(`/fleet/documents/${(await owner.get(`/fleet/documents?kind=license`)).body.items[0].id}`, { validUntil: '2026-06-01' });
    const bad = await owner.post(`/fleet/waybills/${w.id}/issue`);
    expect(bad.body.error.code).toBe('fleet_document_expired');
    await owner.patch(`/fleet/documents/${(await owner.get(`/fleet/documents?kind=license`)).body.items[0].id}`, { validUntil: iso(365) });
    expect((await owner.post(`/fleet/waybills/${w.id}/issue`)).body.status).toBe('issued');
    // заправка в период листа привязывается к нему сама
    const fuel = await mk(owner, '/fleet/fuel', { vehicleId: vehicle, date: '2026-07-01', liters: 50, amount: 3000, station: 'Лукойл' });
    expect(fuel.waybillId).toBe(w.id);
    expect((await owner.post(`/fleet/waybills/${w.id}/close`)).body.error.code).toBe('waybill_return_required');
    expect((await owner.patch(`/fleet/waybills/${w.id}`, { odometerBack: 900, fuelBack: 5 })).body.error.code).toBe('waybill_odometer');
    await owner.patch(`/fleet/waybills/${w.id}`, { odometerBack: 1200, fuelBack: 10 });
    const closed = (await owner.post(`/fleet/waybills/${w.id}/close`)).body;
    expect(closed).toMatchObject({ status: 'closed', distanceKm: '200.000', normLiters: '40.000', actualLiters: '70.000' });
    expect((await owner.get(`/fleet/vehicles/${vehicle}`)).body.odometer).toBe('1200.000');
    const view = (await owner.get(`/fleet/waybills/${w.id}`)).body;
    expect(view.fuel).toMatchObject({ deltaLiters: '30.000', actualPer100: '35.00' });
    expect((await owner.patch(`/fleet/waybills/${w.id}`, { route: 'x' })).body.error.code).toBe('waybill_closed');
    const html = await owner.get(`/fleet/waybills/${w.id}/print`);
    expect(html.status).toBe(200);
    expect(String(html.body)).toContain('ПУТЕВОЙ ЛИСТ');
    // второй лист получает следующий номер; черновик удаляется, выданный — нет
    const w2 = await mk(owner, '/fleet/waybills', { vehicleId: vehicle2, driverMemberId: driverId, date: '2026-07-02' });
    expect(w2.number.endsWith('00002')).toBe(true);
    expect((await owner.del(`/fleet/waybills/${w2.id}`)).status).toBe(200);
  });
});

describe('fuel', () => {
  test('CSV import: card and plate matching, errors, no duplicates on re-upload', async () => {
    const card = await mk(owner, '/fleet/fuel-cards', { number: '7001', name: 'Лукойл', vehicleId: vehicle2 });
    const csv = `Дата;Карта;Гос. номер;Литры;Сумма;АЗС\n2026-08-01;7001;;40,5;2430;Лукойл\n2026-08-02;;А123ВС77;30;1800;Газпром\n2026-08-03;9999;;10;600;?\n01.13.2026;7001;;1;1;`;
    const dry = (await owner.post('/fleet/fuel/import', { csv, dryRun: true })).body;
    expect(dry).toMatchObject({ created: 2, errors: 2 });
    expect((await owner.get('/fleet/fuel?vehicleId=' + vehicle2)).body.items).toHaveLength(0);
    const res = (await owner.post('/fleet/fuel/import', { csv })).body;
    expect(res).toMatchObject({ created: 2, duplicates: 0, errors: 2 });
    expect(res.rows[2].error).toBe('vehicle_not_found');
    const again = (await owner.post('/fleet/fuel/import', { csv })).body;
    expect(again).toMatchObject({ created: 0, duplicates: 2 });
    const list = (await owner.get('/fleet/fuel?from=2026-08-01&to=2026-08-31')).body;
    expect(list.total).toBe(2);
    expect(list.totals).toMatchObject({ liters: '70.500', amount: '4230.00' });
    expect(list.items.find((e: any) => e.plate === 'К777КК77').cardId).toBe(card.id);
  });
});

describe('service and repairs', () => {
  test('a service plan is due by odometer and date; a repair writes off the stock parts and rolls back', async () => {
    const plan = await mk(owner, '/fleet/service-plans', { vehicleId: vehicle, name: 'ТО-1', everyKm: 10000, everyMonths: 12, lastKm: 0, lastDate: iso(-30) });
    const listed = (await owner.get(`/fleet/service-plans?vehicleId=${vehicle}`)).body.items[0];
    expect(listed.due).toMatchObject({ dueKm: '10000', leftKm: '8800', overdue: false });
    expect((await owner.post('/fleet/service-plans', { vehicleId: vehicle, name: 'x' })).body.error.code).toBe('service_interval_required');

    const wh = (await owner.get('/warehouses')).body.items[0].id;
    const surplus = ((await owner.get('/cost-items')).body.items as any[]).find(i => i.systemKey === 'izlishki').id;
    const filter = await mk(owner, '/products', { name: 'Масляный фильтр', kind: 'goods', unitCode: '796', price: 900, purchasePrice: 400, vatRate: 'none' });
    const posting = await mk(owner, '/documents', { type: 'stock_posting', warehouseId: wh, costItemId: surplus, lines: [{ productId: filter.id, qty: 5, price: 400 }] });
    expect((await owner.post(`/documents/${posting.id}/post`)).status).toBe(200);
    const bal = async () => Number(((await owner.get(`/stock/balances?productId=${filter.id}`)).body.items as any[])[0].qty);
    expect(await bal()).toBe(5);

    const rep = await mk(owner, '/fleet/repairs', {
      vehicleId: vehicle,
      kind: 'maintenance',
      date: '2026-09-10',
      odometer: 9000,
      planId: plan.id,
      warehouseId: wh,
      description: 'Замена масла',
      lines: [
        { kind: 'part', productId: filter.id, name: 'Масляный фильтр', qty: 2, price: 0 },
        { kind: 'part', name: 'Масло 10 л (купили)', qty: 1, price: 3500 },
        { kind: 'work', name: 'Работа механика', qty: 1, price: 1500 },
      ],
    });
    expect(rep.number).toMatch(/^РМ-2026-\d{5}$/);
    const posted = (await owner.post(`/fleet/repairs/${rep.id}/post`)).body;
    expect(posted).toMatchObject({ status: 'posted', partsCost: '800.00', directCost: '5000.00' });
    expect(posted.writeOffDocumentId).toBeTruthy();
    expect(await bal()).toBe(3);
    expect((await owner.patch(`/fleet/repairs/${rep.id}`, { description: 'x' })).body.error.code).toBe('repair_not_draft');
    const after = (await owner.get(`/fleet/service-plans?vehicleId=${vehicle}`)).body.items[0];
    expect(after).toMatchObject({ lastKm: '9000.000', lastDate: '2026-09-10' });
    // затраты на машину
    const costs = (await owner.get('/fleet/costs?from=2026-07-01&to=2026-09-30')).body;
    const row = costs.items.find((i: any) => i.plate === 'А123ВС77');
    expect(row).toMatchObject({ fuelAmount: '4800.00', repairAmount: '5800.00', distanceKm: '200', fuelDeltaLiters: '30.0' });
    expect((await member.get('/fleet/costs?from=2026-07-01&to=2026-09-30')).status).toBe(403);

    expect((await owner.post(`/fleet/repairs/${rep.id}/unpost`)).body).toMatchObject({ status: 'draft', writeOffDocumentId: null, partsCost: '0.00' });
    expect(await bal()).toBe(5);
    expect((await owner.del(`/fleet/repairs/${rep.id}`)).status).toBe(200);
    // запчасть со склада без склада в ремонте — отказ
    const noWh = await mk(owner, '/fleet/repairs', { vehicleId: vehicle, date: '2026-09-11', lines: [{ kind: 'part', productId: filter.id, name: 'Фильтр', qty: 1 }] });
    expect((await owner.post(`/fleet/repairs/${noWh.id}/post`)).body.error.code).toBe('warehouse_required');
  });
});

describe('fines', () => {
  test('the driver is taken from the waybill on the date; paid fines count in costs', async () => {
    const fine = await mk(owner, '/fleet/fines', { vehicleId: vehicle, date: '2026-07-01', uin: '18810177260000000001', article: '12.9 ч.2', amount: 500 });
    expect(fine.driverMemberId).toBe(driverId);
    expect(fine.waybillId).toBeTruthy();
    expect((await owner.post('/fleet/fines', { vehicleId: vehicle, date: '2026-07-01', uin: '18810177260000000001', amount: 1 })).status).toBe(409);
    const paid = (await owner.patch(`/fleet/fines/${fine.id}`, { status: 'paid' })).body;
    expect(paid.paidOn).toBe(iso());
    const list = (await owner.get('/fleet/fines?driverId=' + driverId)).body;
    expect(list.items).toHaveLength(1);
    expect(list.totals.amount).toBe('500.00');
    const none = await mk(owner, '/fleet/fines', { vehicleId: vehicle2, date: '2026-07-01', amount: 100 });
    expect(none.driverMemberId).toBeNull();
  });
});

describe('isolation and license', () => {
  test('another tenant sees nothing; a disabled module is refused', async () => {
    expect((await other.get('/fleet/vehicles')).body.items).toHaveLength(0);
    expect((await other.get(`/fleet/vehicles/${vehicle}`)).status).toBe(404);
    expect((await other.post('/fleet/waybills', { vehicleId: vehicle, driverMemberId: driverId, date: '2026-07-01' })).status).toBeGreaterThanOrEqual(400);
    // модуль отключён (тариф без transport) — 403 module_disabled
    await admin.unsafe(`insert into license_plans (key, name, modules, all_modules) values ('no-transport','Без транспорта','{crm}',false) on conflict do nothing`);
    await admin.unsafe(`insert into workspace_licenses (workspace_id, plan_id) select '${ws}', id from license_plans where key='no-transport' on conflict (workspace_id) do update set plan_id = excluded.plan_id`);
    const r = await owner.get('/fleet/vehicles');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('module_disabled');
    expect(await runFleetOnce(admin)).toBe(0);
  });
});
