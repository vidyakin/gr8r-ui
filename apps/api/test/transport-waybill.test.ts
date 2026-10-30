/* Задача 1214: транспортная накладная — сквозной номер, повторная печать с тем же номером, области (рейс / точка / доставка),
   содержимое формы, изоляция арендаторов, задача PDF. Сам PDF собирает воркер — проверяется в браузере. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin } from './helpers';

let owner: Client;
let other: Client;
let ws: string;
let drv: string;
let truck: string;
let customer: string;
let goods: string;
let method: string;
let wh: string;
const day = (n = 0) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const delivery = async (extra: Record<string, unknown> = {}) => {
  const o = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: wh, lines: [{ productId: goods, qty: 3, price: 100 }] });
  return { doc: o, d: (await owner.put(`/deliveries/by-document/${o.id}`, { methodId: method, distanceKm: 5, weightKg: 12, address: 'Тверь, ул. Мира, 5', ...extra })).body as any };
};
const page = (c: Client, id: string) => c.get<string>(`/trips/tn/${id}/print`);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'ТН WS' });
  ws = owner.workspaceId!;
  other = new Client();
  await other.signup({ workspaceName: 'Чужая ТН WS' });
  drv = ((await owner.get('/members')).body.items as any[])[0].id;
  truck = (await mk(owner, '/fleet/vehicles', { plate: 'Т111ТТ77', kind: 'truck', make: 'ГАЗ', model: 'Газель', capacityKg: 1500 })).id;
  wh = (await owner.get('/warehouses')).body.items[0].id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Получатель ТН»', inn: '7707083893', actualAddress: 'Москва, ул. Ленина, 1' })).id;
  goods = (await mk(owner, '/products', { name: 'Стол <дубовый>', kind: 'goods', unitCode: '796', price: 100, purchasePrice: 10, vatRate: 'none', weightKg: 4 })).id;
  const svc = (await mk(owner, '/products', { name: 'Доставка', kind: 'service', unitCode: '876', price: 0, vatRate: 'none' })).id;
  method = (await mk(owner, '/delivery-methods', { name: 'Свой курьер', kind: 'own_courier', productId: svc, clientRate: { base: 100 } })).id;
});

describe('транспортная накладная', () => {
  test('по доставке: номер сквозной, повторно — тот же; форма с получателем, грузом, весом', async () => {
    const { d } = await delivery();
    const a = await owner.post('/trips/tn', { deliveryId: d.id });
    expect(a.status).toBe(200);
    expect(a.body.number).toBe('ТН-00001');
    expect(a.body.etrnStatus).toBe('none');
    const again = await owner.post('/trips/tn', { deliveryId: d.id });
    expect(again.body.id).toBe(a.body.id);
    expect(again.body.number).toBe('ТН-00001');
    const p = await page(owner, a.body.id);
    expect(p.status).toBe(200);
    for (const s of ['ТН-00001', 'ООО «Получатель ТН»', '7707083893', 'Тверь, ул. Мира, 5', 'Стол &lt;дубовый&gt;', '12.000', 'Заказ покупателя']) expect(p.body).toContain(s);
    expect(p.body).not.toContain('<дубовый>');
  });
  test('по рейсу и по точке: свои номера, машина и водитель из рейса', async () => {
    const { d } = await delivery();
    const t = await mk(owner, '/trips', { dateFrom: day(0), vehicleId: truck, driverMemberId: drv });
    await mk(owner, `/trips/${t.id}/deliveries`, { deliveryId: d.id });
    const byTrip = await owner.post('/trips/tn', { tripId: t.id });
    const detail = (await owner.get(`/trips/${t.id}`)).body;
    const byStop = await owner.post('/trips/tn', { stopId: detail.stops[0].id });
    const byDelivery = await owner.post('/trips/tn', { deliveryId: d.id });
    // доставка в рейсе и её точка — одна область
    expect(byDelivery.body.id).toBe(byStop.body.id);
    expect(byTrip.body.id).not.toBe(byStop.body.id);
    expect(new Set(['ТН-00001', byTrip.body.number, byStop.body.number]).size).toBe(3);
    const p = await page(owner, byTrip.body.id);
    for (const s of ['Т111ТТ77', 'ГАЗ Газель', t.number, 'Стол']) expect(p.body).toContain(s);
    expect((await owner.post('/trips/tn', { tripId: t.id })).body.id).toBe(byTrip.body.id);
  });
  test('валидация и чужие данные', async () => {
    expect((await owner.post('/trips/tn', {})).status).toBe(400);
    const { d } = await delivery();
    const a = await owner.post('/trips/tn', { deliveryId: d.id });
    expect((await other.post('/trips/tn', { deliveryId: d.id })).status).toBe(404);
    expect((await other.get(`/trips/tn/${a.body.id}`)).status).toBe(404);
    expect((await page(other, a.body.id)).status).toBe(404);
  });
  test('номер переживает удаление рейса; нумерация у арендаторов своя', async () => {
    const t = await mk(owner, '/trips', { dateFrom: day(5), vehicleId: truck, driverMemberId: drv });
    const w = await owner.post('/trips/tn', { tripId: t.id });
    expect((await owner.del(`/trips/${t.id}`)).status).toBeLessThan(300);
    const rows = (await admin.unsafe(`select number, trip_id from transport_waybills where id='${w.body.id}'`)) as any[];
    expect(rows[0].number).toBe(w.body.number);
    expect(rows[0].trip_id).toBeNull();
    const oc = (await mk(other, '/companies', { name: 'Чужой' })).id;
    const prod = (await mk(other, '/products', { name: 'Т', kind: 'goods', unitCode: '796', price: 1, purchasePrice: 1, vatRate: 'none' })).id;
    const odoc = await mk(other, '/documents', { type: 'customer_order', counterpartyId: oc, lines: [{ productId: prod, qty: 1, price: 1 }] });
    const od = (await other.put(`/deliveries/by-document/${odoc.id}`, { address: 'x' })).body as any;
    expect((await other.post('/trips/tn', { deliveryId: od.id })).body.number).toBe('ТН-00001');
  });
  test('PDF: задача воркеру и статус файла', async () => {
    const { d } = await delivery();
    const a = await owner.post('/trips/tn', { deliveryId: d.id });
    const f = await owner.post(`/trips/tn/${a.body.id}/pdf`, {});
    expect(f.status).toBe(202);
    expect(f.body.name).toBe('TN-00005.pdf'.replace('00005', a.body.number.slice(3)));
    expect((await owner.get(`/trips/tn-files/${f.body.id}`)).body.status).toBe('pending');
    // готовый файл отдаётся с ASCII-именем (кириллица в Content-Disposition ломает заголовок)
    await admin.unsafe(`update document_exports set status='ready', data='\\x25504446', size=4 where id='${f.body.id}'`);
    const dl = await owner.get(`/trips/tn-files/${f.body.id}?download=1`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    const jobs = (await admin.unsafe(`select type from jobs where workspace_id='${ws}' and type='transport.waybill_pdf'`)) as any[];
    expect(jobs.length).toBeGreaterThan(0);
  });
});
