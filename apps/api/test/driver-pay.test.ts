/* Задача 1224: зарплата водителей за рейс — сдельно за рейс/км/точку, суточные по междугородним рейсам.
   Одна строка документа на сотрудника × вид × рейс (tripId, номер рейса в комментарии); защита от двойного
   начисления того же рейса в другом неотменённом документе; tripDriverPay — для будущей маржи рейса (1223). */
import { beforeAll, describe, expect, test } from 'bun:test';
import { tripDriverPay, withContext } from '@gr8r/db';
import { admin, Client, sql } from './helpers';

let owner: Client;
let member: Client;
let coDriverClient: Client;
let other: Client;
let ws: string;
let drv1: string;
let drv2: string;
let truck: string;
let van: string;

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

/** Рейс со статусом done (минуя жизненный цикл точек) и заданным пробегом — для теста ставок достаточно прямого SQL */
const finishedTrip = async (opts: { dateFrom: string; dateTo: string; kind?: 'city' | 'intercity'; driverMemberId: string; coDriverMemberId?: string | null; vehicleId: string; routeKm?: string }) => {
  const t = await mk(owner, '/trips', { dateFrom: opts.dateFrom, dateTo: opts.dateTo, kind: opts.kind ?? 'city', vehicleId: opts.vehicleId, driverMemberId: opts.driverMemberId, coDriverMemberId: opts.coDriverMemberId ?? null });
  // точка, чтобы рейс можно было завершить
  await mk(owner, `/trips/${t.id}/stops`, { kind: 'delivery', address: 'Москва, тест', weightKg: 10 });
  await mk(owner, `/trips/${t.id}/start`);
  const stops = (await owner.get(`/trips/${t.id}`)).body.stops;
  await mk(owner, `/trips/${t.id}/stops/${stops[0].id}/status`, { status: 'done' });
  await mk(owner, `/trips/${t.id}/complete`);
  if (opts.routeKm) await admin`update fleet_trips set route_km = ${opts.routeKm} where id = ${t.id}`;
  return (await owner.get(`/trips/${t.id}`)).body;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Зарплата водителей WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  coDriverClient = new Client();
  await coDriverClient.signup();
  const inv2 = await owner.post(`/workspaces/${ws}/invites`, { email: coDriverClient.user!.email, role: 'member' });
  await coDriverClient.post('/invites/accept', { token: inv2.body.token });
  coDriverClient.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужая зарплата водителей WS' });

  const people = (await owner.get('/members')).body.items as any[];
  drv1 = people.find(m => m.email === member.user!.email).id;
  drv2 = people.find(m => m.email === coDriverClient.user!.email).id;
  truck = (await mk(owner, '/fleet/vehicles', { plate: 'А111АА77', kind: 'truck', capacityKg: 1000, fuelNormSummer: 20 })).id;
  van = (await mk(owner, '/fleet/vehicles', { plate: 'А222АА77', kind: 'van', capacityKg: 300, fuelNormSummer: 12 })).id;

  const costItem = (await mk(owner, '/cost-items', { name: 'Зарплата водителей', kind: 'expense' })).id;
  const reflections = (await mk(owner, '/payroll/reflections', { name: 'Зарплата водителей', costItemId: costItem })).items;
  const reflectionId = reflections[0].id;
  expect((await owner.put(`/payroll/employees/${drv1}`, { ndflRate: '13', reflectionId })).status).toBe(200);
  expect((await owner.put(`/payroll/employees/${drv2}`, { ndflRate: '13', reflectionId })).status).toBe(200);

  expect(
    (
      await owner.patch('/payroll/settings', {
        insuranceRate: '30',
        tripPieceworkRate: '500',
        tripKmRate: '10',
        tripStopRate: '50',
        tripPerdiemRate: '700',
      })
    ).status,
  ).toBe(200);
});

describe('начисление за рейс', () => {
  test('городской рейс: сдельно за рейс, за км, за точку; совместный водитель получает те же начисления', async () => {
    const t = await finishedTrip({ dateFrom: '2026-09-05', dateTo: '2026-09-05', driverMemberId: drv1, coDriverMemberId: drv2, vehicleId: truck, routeKm: '40' });
    expect(t.status).toBe('done');

    const doc = await mk(owner, '/payroll/documents', { period: '2026-09-01' });
    const filled = (await owner.post(`/payroll/documents/${doc.id}/fill`, {})).body;
    const lines = (memberId: string, base: string) => filled.lines.filter((l: any) => l.memberId === memberId && l.baseType === base);

    // основной водитель: сдельно за рейс (500) + за км (40 × 10 = 400) + за точку (1 точка × 50 = 50)
    const piece1 = lines(drv1, 'trip_piecework');
    expect(piece1).toHaveLength(1);
    expect(piece1[0].amount).toBe('500.00');
    expect(piece1[0].tripId).toBe(t.id);
    expect(piece1[0].comment).toContain(t.number);

    const km1 = lines(drv1, 'trip_km');
    expect(km1).toHaveLength(1);
    expect(km1[0].amount).toBe('400.00');

    const stop1 = lines(drv1, 'trip_stop');
    expect(stop1).toHaveLength(1);
    expect(stop1[0].amount).toBe('50.00');

    // суточные не начисляются по городскому рейсу
    expect(lines(drv1, 'trip_perdiem')).toHaveLength(0);

    // совместный водитель получает те же начисления по тем же ставкам (не делятся)
    const piece2 = lines(drv2, 'trip_piecework');
    expect(piece2).toHaveLength(1);
    expect(piece2[0].amount).toBe('500.00');
    expect(piece2[0].tripId).toBe(t.id);

    const totalDoc1 = Number(filled.totals.accrued);
    expect(totalDoc1).toBeCloseTo((500 + 400 + 50) * 2, 2);

    // повторное «Заполнить» без удвоения
    const refilled = (await owner.post(`/payroll/documents/${doc.id}/fill`, {})).body;
    expect(refilled.lines.filter((l: any) => l.memberId === drv1 && l.baseType === 'trip_piecework')).toHaveLength(1);
    expect(Number(refilled.totals.accrued)).toBeCloseTo(totalDoc1, 2);

    expect((await owner.post(`/documents/${doc.id}/post`)).status).toBe(200);
  });

  test('междугородний рейс: суточные по числу дней в пути', async () => {
    const t = await finishedTrip({ dateFrom: '2026-09-10', dateTo: '2026-09-12', kind: 'intercity', driverMemberId: drv1, vehicleId: van, routeKm: '0' });
    expect(t.status).toBe('done');

    const doc = await mk(owner, '/payroll/documents', { period: '2026-09-01' });
    const filled = (await owner.post(`/payroll/documents/${doc.id}/fill`, {})).body;
    const perdiem = filled.lines.filter((l: any) => l.memberId === drv1 && l.baseType === 'trip_perdiem' && l.tripId === t.id);
    expect(perdiem).toHaveLength(1);
    // 10, 11, 12 сентября — 3 дня в пути × 700
    expect(perdiem[0].amount).toBe('2100.00');
    expect((await owner.post(`/documents/${doc.id}/post`)).status).toBe(200);
  });

  test('второй документ за тот же период не начисляет тот же рейс повторно', async () => {
    const t = await finishedTrip({ dateFrom: '2026-09-20', dateTo: '2026-09-20', driverMemberId: drv1, vehicleId: truck, routeKm: '10' });
    const doc1 = await mk(owner, '/payroll/documents', { period: '2026-09-01', workCenterId: null, comment: 'Документ 1' });
    const filled1 = (await owner.post(`/payroll/documents/${doc1.id}/fill`, {})).body;
    const line1 = filled1.lines.find((l: any) => l.memberId === drv1 && l.tripId === t.id && l.baseType === 'trip_piecework');
    expect(line1).toBeTruthy();
    expect((await owner.post(`/documents/${doc1.id}/post`)).status).toBe(200);

    // второй документ за тот же месяц — заполняем только по этому сотруднику
    const doc2 = await mk(owner, '/payroll/documents', { period: '2026-09-01', comment: 'Документ 2' });
    const filled2 = (await owner.post(`/payroll/documents/${doc2.id}/fill`, { memberIds: [drv1] })).body;
    const line2 = filled2.lines.find((l: any) => l.tripId === t.id && l.baseType === 'trip_piecework');
    expect(line2).toBeUndefined();
  });

  test('закрытый период: рейсовые начисления заполняются, но проведение запрещено', async () => {
    const t = await finishedTrip({ dateFrom: '2026-08-05', dateTo: '2026-08-05', driverMemberId: drv1, vehicleId: truck, routeKm: '5' });
    const doc = await mk(owner, '/payroll/documents', { period: '2026-08-01' });
    const filled = (await owner.post(`/payroll/documents/${doc.id}/fill`, {})).body;
    expect(filled.lines.some((l: any) => l.tripId === t.id)).toBe(true);
    expect((await owner.patch('/production/periods/settings', { closedThrough: '2026-08-31' })).status).toBe(200);
    const res = await owner.post(`/documents/${doc.id}/post`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('period_closed');
    await owner.patch('/production/periods/settings', { closedThrough: null });
  });

  test('чужой воркспейс не видит документ начисления', async () => {
    const t = await finishedTrip({ dateFrom: '2026-09-22', dateTo: '2026-09-22', driverMemberId: drv1, vehicleId: truck, routeKm: '15' });
    const doc = await mk(owner, '/payroll/documents', { period: '2026-09-01' });
    await mk(owner, `/payroll/documents/${doc.id}/fill`, {});
    expect((await other.get(`/payroll/documents/${doc.id}`)).status).toBeGreaterThanOrEqual(404);
    void t;
  });

  test('tripDriverPay: сумма начисления и взносов по рейсу только в проведённых документах', async () => {
    const t = await finishedTrip({ dateFrom: '2026-09-25', dateTo: '2026-09-25', driverMemberId: drv1, vehicleId: truck, routeKm: '20' });
    const doc = await mk(owner, '/payroll/documents', { period: '2026-09-01' });
    await mk(owner, `/payroll/documents/${doc.id}/fill`, {});

    // до проведения документа начисление ещё не в проведённых документах — сумма нулевая
    const before = await withContext(sql, { workspaceId: ws }, db => tripDriverPay(db, t.id));
    expect(before).toBe('0.00');

    expect((await owner.post(`/documents/${doc.id}/post`)).status).toBe(200);
    const rows: any[] = await admin`select amount, insurance from payroll_lines where trip_id = ${t.id}`;
    const expected = rows.reduce((s, r) => s + Number(r.amount) + Number(r.insurance), 0);
    const after = await withContext(sql, { workspaceId: ws }, db => tripDriverPay(db, t.id));
    expect(Number(after)).toBeCloseTo(expected, 2);
    expect(Number(after)).toBeGreaterThan(0);

    const margin = await owner.get(`/transport-orders/trips/${t.id}/margin`);
    expect(margin.body.driverPay).toBe(after);
    expect(margin.body.totalCosts).toBe(after);
  });

  test('рейс наёмного перевозчика своему водителю не начисляется', async () => {
    const t = await mk(owner, '/trips', { dateFrom: '2026-07-10', hired: true });
    const carrier = await mk(owner, '/companies', { name: 'ООО «Наёмный перевозчик»' });
    expect((await owner.put(`/transport-orders/trips/${t.id}/carrier`, { carrierCompanyId: carrier.id, rate: '1000' })).status).toBe(200);
    await mk(owner, `/trips/${t.id}/stops`, { kind: 'delivery', address: 'Москва, тест' });
    expect((await owner.post(`/trips/${t.id}/start`)).status).toBe(200);
    const stop = (await owner.get(`/trips/${t.id}`)).body.stops[0];
    await mk(owner, `/trips/${t.id}/stops/${stop.id}/status`, { status: 'done' });
    expect((await owner.post(`/trips/${t.id}/complete`)).status).toBe(200);
    const doc = await mk(owner, '/payroll/documents', { period: '2026-07-01' });
    await mk(owner, `/payroll/documents/${doc.id}/fill`, {});
    expect(await admin`select id from payroll_lines where trip_id = ${t.id}`).toHaveLength(0);
  });
});
