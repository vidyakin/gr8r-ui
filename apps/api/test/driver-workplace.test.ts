/* Место водителя: доступ только к назначенному рейсу и повтор отметки. */
import { beforeAll, expect, test } from 'bun:test';
import { Client, addMember, admin } from './helpers';

let owner: Client, driver: Client, stranger: Client, outsider: Client;
let tripId: string, stopId: string;
beforeAll(async () => {
  owner = new Client(); await owner.signup();
  driver = await addMember(owner); stranger = await addMember(owner);
  outsider = new Client(); await outsider.signup();
  const members = (await owner.get('/members')).body.items as any[];
  const driverId = members.find(m => m.email === driver.user!.email).id;
  const vehicle = await owner.post('/fleet/vehicles', { plate: 'А121АА77', kind: 'van', fuelNormSummer: 10 });
  const trip = await owner.post('/trips', { dateFrom: new Date().toISOString().slice(0, 10), vehicleId: vehicle.body.id, driverMemberId: driverId });
  tripId = trip.body.id;
  const stop = await owner.post(`/trips/${tripId}/stops`, { address: 'Тестовый адрес' });
  stopId = stop.body.id;
  await owner.post(`/trips/${tripId}/start`);
});

test('водитель сохраняет отметку с координатами один раз; чужие пользователи не имеют доступа', async () => {
  const path = `/trips/driver/${tripId}/stops/${stopId}/events`;
  const payload = { clientId: crypto.randomUUID(), status: 'arrived', latitude: 55.75, longitude: 37.62 };
  expect((await stranger.post(path, payload)).status).toBe(403);
  expect((await outsider.post(path, payload)).status).toBe(404);
  const first = await driver.post(path, payload);
  expect(first.status).toBe(200);
  expect((await driver.post(path, payload)).body.id).toBe(first.body.id);
  const rows = await admin`select * from fleet_driver_events where client_id = ${payload.clientId}`;
  expect(rows).toHaveLength(1);
  expect(rows[0]!.latitude).toBe('55.750000');
});

test('список водителя содержит только назначенные рейсы за выбранный день', async () => {
  const date = new Date().toISOString().slice(0, 10);
  const mine = await driver.get(`/trips/driver/mine?date=${date}`);
  expect(mine.status).toBe(200);
  expect(mine.body.items.map((x: any) => x.id)).toContain(tripId);
  expect((await stranger.get(`/trips/driver/mine?date=${date}`)).body.items).toHaveLength(0);
  expect((await outsider.get(`/trips/driver/mine?date=${date}`)).body.items).toHaveLength(0);
});

test('один идентификатор нельзя использовать для другой отметки; координаты должны идти парой', async () => {
  const path = `/trips/driver/${tripId}/stops/${stopId}/events`;
  const clientId = crypto.randomUUID();
  expect((await driver.post(path, { clientId, status: 'done', photo: 'data:image/png;base64,YQ==', signature: 'data:image/png;base64,Yg==' })).status).toBe(200);
  expect((await driver.post(path, { clientId, status: 'failed' })).status).toBe(409);
  expect((await driver.post(path, { clientId, status: 'done', photo: 'different' })).status).toBe(409);
  expect((await driver.post(path, { clientId: crypto.randomUUID(), status: 'arrived', latitude: 1 })).status).toBe(400);
});

test('завершённую точку нельзя вернуть в работу новой отметкой', async () => {
  const res = await driver.post(`/trips/driver/${tripId}/stops/${stopId}/events`, { clientId: crypto.randomUUID(), status: 'arrived' });
  expect(res.status).toBe(409);
});

test('наличные водителя проводятся один раз в его отдельную кассу', async () => {
  const customer = (await owner.post('/companies', { name: 'Покупатель водителя' })).body;
  const product = (await owner.post('/products', { name: 'Товар водителя', kind: 'goods', unitCode: '796', price: 100, vatRate: 'none' })).body;
  const warehouse = (await owner.get('/warehouses')).body.items[0];
  const order = (await owner.post('/documents', { type: 'customer_order', counterpartyId: customer.id, warehouseId: warehouse.id, lines: [{ productId: product.id, qty: 1, price: 100 }] })).body;
  await owner.post(`/documents/${order.id}/post`);
  const delivery = (await owner.put(`/deliveries/by-document/${order.id}`, { address: 'Адрес оплаты' })).body;
  const stop = (await owner.post(`/trips/${tripId}/deliveries`, { deliveryId: delivery.id })).body;
  const path = `/trips/driver/${tripId}/stops/${stop.id}/payments`;
  const payload = { clientId: crypto.randomUUID(), amount: '75.00' };
  const first = await driver.post(path, payload);
  expect(first.status).toBe(200);
  expect((await driver.post(path, payload)).body.id).toBe(first.body.id);
  expect((await driver.post(path, { ...payload, amount: '76.00' })).status).toBe(409);
  const payments = await admin`select d.id, d.status, c.responsible_id from documents d join cash_registers c on c.id = d.cash_register_id where d.id = ${first.body.id}`;
  expect(payments).toHaveLength(1);
  expect(payments[0]!.status).toBe('posted');
  const driverMember = (await owner.get('/members')).body.items.find((m: any) => m.email === driver.user!.email);
  expect(payments[0]!.responsible_id).toBe(driverMember.id);
  const moves = await admin`select * from cash_moves where document_id = ${first.body.id}`;
  expect(moves).toHaveLength(1);
});

test('онлайн-оплата точки использует настроенную интеграцию и доступна только водителю', async () => {
  const customer = (await owner.post('/companies', { name: 'Клиент онлайн' })).body;
  const product = (await owner.post('/products', { name: 'Товар онлайн', kind: 'goods', unitCode: '796', price: 100, vatRate: 'none' })).body;
  const warehouse = (await owner.get('/warehouses')).body.items[0];
  const order = (await owner.post('/documents', { type: 'customer_order', counterpartyId: customer.id, warehouseId: warehouse.id, lines: [{ productId: product.id, qty: 1, price: 100 }] })).body;
  await owner.post(`/documents/${order.id}/post`);
  const delivery = (await owner.put(`/deliveries/by-document/${order.id}`, { address: 'Адрес' })).body;
  const stop = (await owner.post(`/trips/${tripId}/deliveries`, { deliveryId: delivery.id })).body;
  const path = `/trips/driver/${tripId}/stops/${stop.id}/payment-link`;
  expect((await stranger.post(path, { returnUrl: 'https://example.com' })).status).toBe(403);
  const res = await driver.post(path, { returnUrl: 'https://example.com' });
  expect(res.status).toBe(422);
  expect(res.body.error.code).toBe('yookassa_not_configured');
});

test('частичный отказ возвращает только выбранное количество и повтор не удваивает складское движение', async () => {
  const customer = (await owner.post('/companies', { name: 'Клиент возврата' })).body;
  const product = (await owner.post('/products', { name: 'Товар возврата', kind: 'goods', unitCode: '796', price: 100, vatRate: 'none' })).body;
  const warehouse = (await owner.get('/warehouses')).body.items[0];
  const receipt = (await owner.post('/documents', { type: 'receipt', counterpartyId: customer.id, warehouseId: warehouse.id, lines: [{ productId: product.id, qty: 5, price: 10 }] })).body;
  expect((await owner.post(`/documents/${receipt.id}/post`)).status).toBe(200);
  const sale = (await owner.post('/documents', { type: 'realization', counterpartyId: customer.id, warehouseId: warehouse.id, lines: [{ productId: product.id, qty: 4, price: 100 }] })).body;
  expect((await owner.post(`/documents/${sale.id}/post`)).status).toBe(200);
  const delivery = (await owner.put(`/deliveries/by-document/${sale.id}`, { address: 'Адрес возврата' })).body;
  const stop = (await owner.post(`/trips/${tripId}/deliveries`, { deliveryId: delivery.id })).body;
  const path = `/trips/driver/${tripId}/stops/${stop.id}/returns`;
  const payload = { clientId: crypto.randomUUID(), lines: [{ lineId: sale.lines[0].id, qty: '2' }] };
  const first = await driver.post(path, payload);
  expect(first.status).toBe(200);
  expect((await driver.post(path, payload)).body.id).toBe(first.body.id);
  const moves = (await owner.get(`/stock/moves?documentId=${first.body.id}`)).body.items;
  expect(moves).toHaveLength(1);
  expect(moves[0].qty).toBe('2.000');
  expect((await driver.post(path, { ...payload, lines: [{ lineId: sale.lines[0].id, qty: '1' }] })).status).toBe(409);
});

test('водителю доступны строки и доказательства только его точек', async () => {
  const date = new Date().toISOString().slice(0, 10);
  const mine = await driver.get(`/trips/driver/mine?date=${date}`);
  const stops = mine.body.items.flatMap((t: any) => t.stops);
  const events = stops.find((s: any) => s.id === stopId).events as any[];
  expect(events.some(e => e.hasPhoto)).toBe(true);
  expect(events.some(e => 'photo' in e || 'signature' in e)).toBe(false); // тяжёлые данные только по запросу
  const proof = await driver.get(`/trips/driver/${tripId}/stops/${stopId}/proof`);
  expect(proof.status).toBe(200);
  expect(proof.body.items.some((e: any) => e.photo)).toBe(true);
  expect((await stranger.get(`/trips/driver/${tripId}/stops/${stopId}/proof`)).status).toBe(403);
  expect(stops.some((s: any) => s.lines?.length > 0)).toBe(true);
});
