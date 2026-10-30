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
