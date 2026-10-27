/* Задача 1171: запись клиентов на приём — график специалиста, исключения и праздники, запись на несколько слотов, 409 на пересечение и 422 вне слотов,
   отмена и перенос, сетки и поиск свободного, документ «Оказанные услуги за день» (заполнение из «пришёл», проведение продаёт по клиентам),
   незакрытые дни, идемпотентные напоминания воркера, права на график и изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin } from './helpers';
import { runAppointmentsOnce } from '../../worker/src/appointments';

let owner: Client;
let spec: Client; // специалист (member)
let peer: Client; // другой member
let other: Client;
let ws: string;
let specId: string;
let ownerMemberId: string;
let massage30: string;
let massage60: string;
let goodsId: string;
let clientA: string; // физлицо без компании
let companyB: string;
const MON = '2026-11-02'; // понедельник
const TUE = '2026-11-03';

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const book = (c: Client, over: Record<string, unknown>) => c.post('/appointments', { specialistId: specId, productId: massage30, date: MON, startMin: 540, contactId: clientA, ...over });
const WEEK = { '1': [540, 570, 600, 630, 660, 690], '2': [540, 570, 600, 630] };

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Запись на приём WS' });
  ws = owner.workspaceId!;
  const join = async () => {
    const c = new Client();
    await c.signup();
    const inv = await owner.post(`/workspaces/${ws}/invites`, { email: c.user!.email, role: 'member' });
    await c.post('/invites/accept', { token: inv.body.token });
    c.workspaceId = ws;
    return c;
  };
  spec = await join();
  peer = await join();
  other = new Client();
  await other.signup({ workspaceName: 'Чужая запись WS' });
  const people = (await owner.get('/members')).body.items as any[];
  specId = people.find(m => m.email === spec.user!.email).id;
  ownerMemberId = people.find(m => m.email === owner.user!.email).id;
  expect((await owner.patch('/billing/timezone', { timezone: 'UTC' })).status).toBe(200);
  massage30 = (await mk(owner, '/products', { name: 'Массаж спины 30 мин', kind: 'service', unitCode: '876', price: 1500, vatRate: 'none', appointmentMinutes: 30 })).id;
  massage60 = (await mk(owner, '/products', { name: 'Общий массаж 60 мин', kind: 'service', unitCode: '876', price: 2800, vatRate: 'none', appointmentMinutes: 60 })).id;
  goodsId = (await mk(owner, '/products', { name: 'Масло', kind: 'goods', unitCode: '796', price: 400, purchasePrice: 200, vatRate: 'none' })).id;
  clientA = (await mk(owner, '/appointments/clients', { name: 'Иван Петров', phone: '+7 900 000-00-01' })).id;
  companyB = (await mk(owner, '/companies', { name: 'ООО «Релакс»' })).id;
});

describe('schedule', () => {
  test('slot length is validated; specialist and admin edit, a peer does not', async () => {
    const body = { slotMinutes: 30, dayStartMin: 540, dayEndMin: 720, week: WEEK };
    expect((await spec.put(`/appointments/schedules/${specId}`, { ...body, slotMinutes: 40 })).status).toBe(400);
    expect((await peer.put(`/appointments/schedules/${specId}`, body)).status).toBe(403);
    const r = await spec.put(`/appointments/schedules/${specId}`, body);
    expect(r.status).toBe(200);
    expect(r.body.schedule.week['1']).toHaveLength(6);
    expect((await owner.put(`/appointments/schedules/${specId}`, body)).status).toBe(200);
    const list = (await owner.get('/appointments/specialists')).body.items as any[];
    expect(list.map(s => s.memberId)).toEqual([specId]);
    expect((await owner.put(`/appointments/schedules/${ownerMemberId}`, { slotMinutes: 60, dayStartMin: 480, dayEndMin: 1080, week: { '1': [480, 540, 600] } })).status).toBe(200);
  });

  test('week grid follows the weekly pattern, exceptions and holidays', async () => {
    const week = async (from = MON) => (await owner.get(`/appointments/week?specialistId=${specId}&from=${from}`)).body.days as any[];
    let days = await week();
    expect(days[0].working).toEqual(WEEK['1']);
    expect(days[1].working).toEqual(WEEK['2']);
    expect(days[2].working).toEqual([]);
    // выходной, свой набор слотов, праздник и исключение поверх праздника
    expect((await spec.put(`/appointments/schedules/${specId}/exceptions/2026-11-09`, { slots: null })).status).toBe(200);
    expect((await spec.put(`/appointments/schedules/${specId}/exceptions/2026-11-10`, { slots: [540, 570] })).status).toBe(200);
    expect((await spec.put(`/appointments/schedules/${specId}/exceptions/2026-11-10`, { slots: [545] })).status).toBe(422);
    expect((await owner.post('/production/holidays', { date: '2026-11-16', name: 'Праздник' })).status).toBe(200);
    expect((await owner.post('/production/holidays', { date: '2026-11-17', name: 'Праздник 2' })).status).toBe(200);
    expect((await spec.put(`/appointments/schedules/${specId}/exceptions/2026-11-17`, { slots: [600] })).status).toBe(200);
    days = await week('2026-11-09');
    expect(days[0].working).toEqual([]);
    expect(days[1].working).toEqual([540, 570]);
    days = await week('2026-11-16');
    expect(days[0].working).toEqual([]);
    expect(days[1].working).toEqual([600]);
    expect((await peer.del(`/appointments/schedules/${specId}/exceptions/2026-11-09`)).status).toBe(403);
    expect((await spec.del(`/appointments/schedules/${specId}/exceptions/2026-11-09`)).status).toBe(200);
    expect((await week('2026-11-09'))[0].working).toEqual(WEEK['1']);
  });
});

describe('booking', () => {
  test('a 60-minute service takes two slots; overlap is 409, outside working slots is 422', async () => {
    const a = await book(spec, { productId: massage60, startMin: 540 });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ slots: 2, slotMinutes: 30, endMin: 600, status: 'booked', price: '2800.00', clientName: 'Иван Петров' });
    expect((await book(spec, { startMin: 570 })).status).toBe(409); // внутри первой записи
    expect((await book(spec, { productId: massage60, startMin: 510 })).status).toBe(422); // начало вне слотов
    expect((await book(spec, { productId: massage60, startMin: 690 })).status).toBe(422); // второй слот за пределами графика
    expect((await book(spec, { date: TUE, startMin: 660 })).status).toBe(422); // вторник до 11:00
    const ok = await book(spec, { startMin: 600, contactId: undefined, companyId: companyB });
    expect(ok.status).toBe(201);
    expect(ok.body.clientName).toBe('ООО «Релакс»');
    expect((await book(spec, { contactId: undefined, companyId: undefined })).status).toBe(400);
    expect((await book(spec, { startMin: 660, specialistId: ownerMemberId, productId: massage60 })).status).toBe(422); // у owner нет понедельничных 11:00
  });

  test('grid of the day lists every specialist; a free time is found for a service', async () => {
    const board = (await owner.get(`/appointments/day?date=${MON}`)).body;
    const col = board.columns.find((c: any) => c.specialistId === specId);
    expect(col.appointments).toHaveLength(2);
    expect(board.columns).toHaveLength(2);
    const free = (await owner.get(`/appointments/free?productId=${massage60}&specialistId=${specId}&from=${MON}`)).body.slot;
    expect(free).toMatchObject({ memberId: specId, date: MON, startMin: 630, slots: 2 });
    const anyone = (await owner.get(`/appointments/free?productId=${massage60}&from=${MON}`)).body.slot;
    expect(anyone.date).toBe(MON);
  });

  test('cancel needs a reason and frees the slots; move checks the target', async () => {
    const first = (await owner.get(`/appointments?specialistId=${specId}&from=${MON}&to=${MON}`)).body.items.find((a: any) => a.startMin === 540);
    expect((await spec.post(`/appointments/${first.id}/cancel`, {})).status).toBe(400);
    const c = await spec.post(`/appointments/${first.id}/cancel`, { reason: 'Клиент заболел' });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ status: 'cancelled', cancelReason: 'Клиент заболел' });
    const again = await book(spec, { productId: massage60, startMin: 540 });
    expect(again.status).toBe(201);
    expect((await spec.post(`/appointments/${first.id}/came`)).status).toBe(409);
    // перенос: на занятое — 409, вне слотов — 422, на свободное и в другой день — 200
    expect((await spec.post(`/appointments/${again.body.id}/move`, { date: MON, startMin: 600 })).status).toBe(409);
    expect((await spec.post(`/appointments/${again.body.id}/move`, { date: MON, startMin: 690 })).status).toBe(422);
    const mv = await spec.post(`/appointments/${again.body.id}/move`, { date: TUE, startMin: 540 });
    expect(mv.status).toBe(200);
    expect(mv.body).toMatchObject({ date: TUE, startMin: 540 });
    const back = await spec.post(`/appointments/${again.body.id}/move`, { date: MON, startMin: 540 });
    expect(back.status).toBe(200);
    // освобождённое место снова доступно — запись внутрь нового интервала невозможна, а после переноса вторника на понедельник 540 занято
    expect((await book(spec, { startMin: 570 })).status).toBe(409);
  });

  test('schedule changes cannot break future appointments', async () => {
    const r = await spec.put(`/appointments/schedules/${specId}`, { slotMinutes: 30, dayStartMin: 540, dayEndMin: 720, week: { '1': [660, 690], '2': WEEK['2'] } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('schedule_has_appointments');
  });
});

describe('worker', () => {
  test('a reminder is created exactly once per unconfirmed appointment the day before', async () => {
    const eve = new Date('2026-11-01T10:00:00Z');
    const booked = await admin`select count(*)::int as n from appointments where workspace_id = ${ws} and date = ${MON} and status = 'booked'`;
    expect(booked[0]!.n).toBe(2);
    const r1 = await runAppointmentsOnce(admin, eve);
    expect(r1.reminders).toBe(2);
    expect((await runAppointmentsOnce(admin, eve)).reminders).toBe(0);
    expect((await runAppointmentsOnce(admin, new Date('2026-11-01T18:00:00Z'))).reminders).toBe(0);
    const acts = await admin`select subject, company_id, contact_id from crm_activities where workspace_id = ${ws} and subject like 'Подтвердите запись%'`;
    expect(acts).toHaveLength(2);
    expect(await admin`select 1 from appointment_reminders where workspace_id = ${ws}`).toHaveLength(2);
    // подтверждённая запись на завтра напоминания не требует
    const late = await book(spec, { productId: massage30, date: TUE, startMin: 570 });
    expect((await spec.post(`/appointments/${late.body.id}/confirm`)).status).toBe(200);
    expect((await runAppointmentsOnce(admin, new Date('2026-11-02T10:00:00Z'))).reminders).toBe(0);
  });
});

describe('day document', () => {
  let apptA: string;
  let apptB: string;
  let docId: string;

  test('came appointments make the day unclosed and trigger alerts once (evening, then morning)', async () => {
    const items = (await owner.get(`/appointments?specialistId=${specId}&from=${MON}&to=${MON}`)).body.items as any[];
    apptA = items.find(a => a.startMin === 540 && a.status !== 'cancelled').id;
    apptB = items.find(a => a.startMin === 600).id;
    expect((await spec.post(`/appointments/${apptA}/came`)).status).toBe(200);
    expect((await spec.post(`/appointments/${apptB}/confirm`)).status).toBe(200);
    expect((await spec.post(`/appointments/${apptB}/came`)).status).toBe(200);
    const days = (await owner.get('/appointments/unclosed-days')).body.items;
    expect(days).toEqual([expect.objectContaining({ specialistId: specId, date: MON, count: 2, documentId: null })]);
    const week = (await owner.get(`/appointments/week?specialistId=${specId}&from=${MON}`)).body.days;
    expect(week[0].unclosed).toBe(true);
    expect((await runAppointmentsOnce(admin, new Date(`${MON}T15:00:00Z`))).alerts).toBe(0); // до вечера рано
    expect((await runAppointmentsOnce(admin, new Date(`${MON}T21:00:00Z`))).alerts).toBe(1);
    expect((await runAppointmentsOnce(admin, new Date(`${MON}T22:00:00Z`))).alerts).toBe(0);
    expect((await runAppointmentsOnce(admin, new Date(`${TUE}T09:00:00Z`))).alerts).toBe(1);
    expect((await runAppointmentsOnce(admin, new Date(`${TUE}T10:00:00Z`))).alerts).toBe(0);
    const notes = await admin`select recipient_id from notifications where workspace_id = ${ws} and text like 'Не закрыт день приёма%'`;
    expect(new Set(notes.map(n => n.recipient_id))).toEqual(new Set([specId, ownerMemberId]));
  });

  test('the document is filled from came appointments; posting sells to each client', async () => {
    const created = await spec.post('/appointments/day-documents', { specialistId: specId, date: MON });
    expect(created.status).toBe(201);
    docId = created.body.id;
    expect(created.body.lines).toHaveLength(2);
    expect(created.body.total).toBe('4300.00'); // 2800 (60 мин) + 1500
    expect((await spec.post('/appointments/day-documents', { specialistId: specId, date: MON })).status).toBe(409);
    // правка: доп. товар клиенту А
    const lines = created.body.lines.map((l: any) => ({ id: l.id, companyId: l.companyId, contactId: l.contactId, productId: l.productId, startMin: l.startMin, qty: l.qty, price: l.price }));
    const clientCompany = lines.find((l: any) => l.contactId === clientA).companyId;
    // физлицо без компании получило компанию-покупателя вида individual
    expect((await owner.get(`/companies/${clientCompany}`)).body.kind).toBe('individual');
    const upd = await spec.patch(`/appointments/day-documents/${docId}`, { lines: [...lines, { companyId: clientCompany, contactId: clientA, productId: goodsId, qty: '2', price: '400' }] });
    expect(upd.status).toBe(200);
    expect(upd.body.total).toBe('5100.00');
    // товар списывается со склада: сначала приход
    const wh = (await owner.get('/warehouses')).body.items[0].id;
    const supplier = await mk(owner, '/companies', { name: 'Поставщик масла' });
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier.id, warehouseId: wh, date: '2026-10-20', priceIncludesVat: false, lines: [{ productId: goodsId, qty: 10, price: 200 }] });
    expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
    const posted = await spec.post(`/appointments/day-documents/${docId}/post`);
    expect(posted.status).toBe(200);
    expect(posted.body.status).toBe('posted');
    expect(posted.body.sales).toHaveLength(2);
    const sales = await admin`select type, status, total, counterparty_id from documents where id in (select sale_document_id from service_day_sales where day_document_id = ${docId}) order by total`;
    expect(sales.map(s => [s.type, s.status, s.total])).toEqual([['act', 'posted', '1500.00'], ['realization', 'posted', '3600.00']]);
    const stock = await admin`select coalesce(sum(qty), 0)::float as q from stock_balances where workspace_id = ${ws} and product_id = ${goodsId}`;
    expect(stock[0]!.q).toBe(8);
    expect((await owner.get('/appointments/unclosed-days')).body.items).toEqual([]);
    expect((await owner.get(`/appointments/week?specialistId=${specId}&from=${MON}`)).body.days[0].unclosed).toBe(false);
    expect((await spec.patch(`/appointments/day-documents/${docId}`, { comment: 'x' })).status).toBe(409);
    // журнал продаж показывает документ дня
    const journal = await owner.get('/documents?type=service_day');
    expect(journal.body.items.map((d: any) => d.id)).toContain(docId);
  });

  test('unposting removes the sales and returns the stock; the day becomes unclosed again', async () => {
    expect((await spec.post(`/appointments/day-documents/${docId}/unpost`)).status).toBe(200);
    expect(await admin`select 1 from service_day_sales where day_document_id = ${docId}`).toHaveLength(0);
    const stock = await admin`select coalesce(sum(qty), 0)::float as q from stock_balances where workspace_id = ${ws} and product_id = ${goodsId}`;
    expect(stock[0]!.q).toBe(10);
    expect((await owner.get('/appointments/unclosed-days')).body.items).toHaveLength(1);
    expect((await spec.post(`/appointments/day-documents/${docId}/post`)).status).toBe(200);
    expect((await owner.get('/appointments/unclosed-days')).body.items).toEqual([]);
  });

  test('history of a contact and of a company lists their appointments', async () => {
    const mine = (await owner.get(`/appointments?contactId=${clientA}`)).body.items as any[];
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.every(a => a.contactId === clientA)).toBe(true);
    const company = (await owner.get(`/appointments?companyId=${companyB}`)).body.items as any[];
    expect(company.map(a => a.status)).toContain('came');
  });
});

describe('isolation', () => {
  test('another workspace sees nothing and cannot touch schedules or appointments', async () => {
    const some = (await owner.get(`/appointments?specialistId=${specId}`)).body.items[0];
    expect((await other.get(`/appointments/${some.id}`)).status).toBe(404);
    expect((await other.get('/appointments')).body.items).toEqual([]);
    expect((await other.get(`/appointments/day?date=${MON}`)).body.columns).toEqual([]);
    expect((await other.get('/appointments/specialists')).body.items).toEqual([]);
    expect((await other.put(`/appointments/schedules/${specId}`, { slotMinutes: 30, dayStartMin: 540, dayEndMin: 720, week: {} })).status).not.toBe(200);
    expect((await other.post(`/appointments/${some.id}/cancel`, { reason: 'x' })).status).toBe(404);
    const rows = await admin`select count(*)::int as n from appointments where workspace_id = ${other.workspaceId}`;
    expect(rows[0]!.n).toBe(0);
  });
});
