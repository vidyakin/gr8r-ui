/* Задача 1213: маршрутизация — настройки провайдера, геокодирование адресов в фоне, «Распределить» (провайдер и расчёт по прямой),
   «Оптимизировать порядок», ETA, сброс расчёта при правке, защита адреса сервера (SSRF), права и изоляция.
   Наружу запросов нет: `routingRuntime.fetch` подменён фикстурой (живых ключей Яндекса нет — реальные вызовы не проверялись). */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { routingFetcher, routingRuntime } from '@gr8r/db';
import type { Fetcher, HttpCall } from '@gr8r/shared';
import { defaultOptions, processJobsOnce } from '../../worker/src/worker';
import { Client, admin, sql } from './helpers';

const quiet = defaultOptions({ log: () => {}, ddl: null });
const day = (n = 0) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ok = (json: unknown) => ({ status: 200, json, text: JSON.stringify(json) });
const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let drv1: string;
let drv2: string;
let truck: string;

let customer: string;
let goods: string;
let method: string;
let wh: string;

/** Доставка на новом заказе; координаты и адрес задаются */
const delivery = async (extra: Record<string, unknown>) => {
  const o = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: wh, lines: [{ productId: goods, qty: 1, price: 100 }] });
  return (await owner.put(`/deliveries/by-document/${o.id}`, { methodId: method, distanceKm: 5, weightKg: 100, deliveryDate: day(5), ...extra })).body as any;
};
const waitRun = async (id: string) => {
  await processJobsOnce(sql, quiet);
  return (await owner.get(`/trips/routing/runs/${id}`)).body as any;
};
const calls: HttpCall[] = [];
let handler: (c: HttpCall) => ReturnType<typeof ok> = () => ({ status: 500, json: null, text: '' });
const fake: Fetcher = async c => {
  calls.push(c);
  return handler(c);
};

beforeAll(async () => {
  process.env.SECRETS_KEY = 'd'.repeat(64);
  routingRuntime.fetch = fake;
  routingRuntime.sleep = async () => {};
  owner = new Client();
  await owner.signup({ workspaceName: 'Маршруты WS' });
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
  await other.signup({ workspaceName: 'Чужие маршруты WS' });
  const people = (await owner.get('/members')).body.items as any[];
  drv1 = people.find(m => m.email === member.user!.email).id;
  drv2 = people.find(m => m.email === second.user!.email).id;
  truck = (await mk(owner, '/fleet/vehicles', { plate: 'Т111ТТ77', kind: 'truck', capacityKg: 1000, fuelNormSummer: 20, driverMemberId: drv1 })).id;
  (await mk(owner, '/fleet/vehicles', { plate: 'В222ВВ77', kind: 'van', capacityKg: 250, fuelNormSummer: 12, driverMemberId: drv2 })).id;
  wh = (await owner.get('/warehouses')).body.items[0].id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Получатель»', actualAddress: 'Москва, ул. Ленина, 1' })).id;
  goods = (await mk(owner, '/products', { name: 'Товар', kind: 'goods', unitCode: '796', price: 100, purchasePrice: 10, vatRate: 'none' })).id;
  const svc = (await mk(owner, '/products', { name: 'Доставка', kind: 'service', unitCode: '876', price: 0, vatRate: 'none' })).id;
  method = (await mk(owner, '/delivery-methods', { name: 'Свой курьер', kind: 'own_courier', productId: svc, clientRate: { base: 100 } })).id;
});
afterAll(() => {
  routingRuntime.fetch = null;
  routingRuntime.sleep = undefined;
});

const settings = (extra: Record<string, unknown> = {}) => ({ provider: 'none', ...extra });

describe('настройки провайдера', () => {
  test('по умолчанию провайдера нет; правит admin; адрес сервера проверяется на частные адреса', async () => {
    const r = (await owner.get('/trips/routing')).body;
    expect(r.settings.provider).toBe('none');
    expect(r.tile.url).toContain('tile.openstreetmap.org');
    expect(r.tile.crs).toBe('EPSG3857');
    expect((await member.put('/trips/routing', settings())).status).toBe(403);
    expect((await owner.put('/trips/routing', settings({ provider: 'osrm_vroom', osrmUrl: 'http://127.0.0.1:5000' }))).status).toBe(400);
    expect((await owner.put('/trips/routing', settings({ provider: 'osrm_vroom', osrmUrl: 'http://10.1.2.3' }))).status).toBe(400);
    const okSave = await owner.put('/trips/routing', settings({ provider: 'osrm_vroom', osrmUrl: 'https://osrm.example.com', vroomUrl: 'https://vroom.example.com' }));
    expect(okSave.status).toBe(200);
    expect(okSave.body.capabilities).toEqual({ geocode: false, matrix: true, solve: true });
    // не-admin адреса серверов не видит
    expect((await member.get('/trips/routing')).body.settings.osrmUrl).toBe('');
    expect((await other.get('/trips/routing')).body.settings.provider).toBe('none');
    await owner.put('/trips/routing', settings());
  });
  test('плитки Яндекса при провайдере Яндекс и ключе карты', async () => {
    const r = await owner.put('/trips/routing', settings({ provider: 'yandex', yandexMapsKey: 'pub-key' }));
    expect(r.body.tile.crs).toBe('EPSG3395');
    expect(r.body.tile.url).toContain('apikey=pub-key');
    await owner.put('/trips/routing', settings());
  });
  test('защищённый fetch: частные адреса и чужие хосты не пропускаются, наружу не ходит', async () => {
    const f = routingFetcher(new Map([['127.0.0.1:5000', 'public' as const], ['localhost:3000', 'public' as const], ['trusted.local:80', 'trusted' as const]]), {});
    await expect(f({ method: 'GET', url: 'http://127.0.0.1:5000/x' })).rejects.toMatchObject({ kind: 'permanent' });
    await expect(f({ method: 'GET', url: 'http://localhost:3000/x' })).rejects.toMatchObject({ kind: 'permanent' });
    await expect(f({ method: 'GET', url: 'https://evil.example.com/x' })).rejects.toThrow('not allowed');
    await expect(f({ method: 'GET', url: 'http://u:p@127.0.0.1:5000/x' })).rejects.toThrow();
  });
});

describe('«Распределить» без провайдера (расчёт по прямой)', () => {
  let run: any;
  let ds: any[];
  test('доставки с координатами делятся по машинам, порядок и ETA записываются', async () => {
    // две точки на севере, две на юге; фургон берёт до 250 кг, грузовик — до 1000
    ds = [
      await delivery({ address: 'Север 1', lat: 55.85, lon: 37.6, weightKg: 100 }),
      await delivery({ address: 'Север 2', lat: 55.86, lon: 37.62, weightKg: 100, windowFrom: '10:00', windowTo: '12:00' }),
      await delivery({ address: 'Юг 1', lat: 55.6, lon: 37.6, weightKg: 100 }),
      await delivery({ address: 'Юг 2', lat: 55.61, lon: 37.62, weightKg: 100 }),
    ];
    expect(ds[0].lat).toBe('55.850000');
    expect(ds[0].geoSource).toBe('manual');
    expect((await member.post('/trips/routing/distribute', { date: day(5) })).status).toBe(202);
    run = (await owner.get(`/trips/routing/runs?date=${day(5)}`)).body.items[0];
    expect(run.status).toBe('queued');
    // повторный запуск на тот же день, пока первый не закончен
    expect((await owner.post('/trips/routing/distribute', { date: day(5) })).status).toBe(409);
    run = await waitRun(run.id);
    expect(run.status).toBe('done');
    expect(run.source).toBe('straight');
    expect(run.summary.unassigned).toEqual([]);
    expect(run.summary.stops).toBe(4);
    expect(run.summary.tripIds.length).toBeGreaterThanOrEqual(1);
    for (const id of run.summary.tripIds) {
      const t = (await owner.get(`/trips/${id}`)).body;
      expect(t.status).toBe('planned');
      expect(Number(t.routeKm)).toBeGreaterThanOrEqual(0);
      expect(t.routeSource).toBe('straight');
      expect(t.stops.every((s: any) => s.etaMin !== null)).toBe(true);
      const etas = t.stops.map((s: any) => s.etaMin);
      expect([...etas].sort((a, b) => a - b)).toEqual(etas);
    }
    // окно 10:00–12:00 учтено: прибытие не раньше 10:00
    const north2 = (await owner.get(`/trips/${run.summary.tripIds[0]}`)).body.stops.find((s: any) => s.address === 'Север 2') ?? (await owner.get(`/trips/${run.summary.tripIds.at(-1)}`)).body.stops.find((s: any) => s.address === 'Север 2');
    expect(north2.etaMin).toBeGreaterThanOrEqual(600);
    expect(north2.etaLate).toBe(false);
    // доставки больше не «нераспределённые»
    const board = (await owner.get(`/trips/dispatch?date=${day(5)}`)).body;
    expect(board.unassigned.filter((d: any) => ds.some(x => x.id === d.id))).toEqual([]);
  });
  test('занятые машины пропускаются с причиной; нет свободных машин — доставки остаются', async () => {
    const extra = await delivery({ address: 'Центр', lat: 55.75, lon: 37.6 });
    const r = await mk(owner, '/trips/routing/distribute', { date: day(5) });
    const done = await waitRun(r.id);
    expect(done.status).toBe('done');
    expect(done.summary.tripIds).toEqual([]);
    expect(done.summary.skippedVehicles.map((v: any) => v.reason)).toEqual(['vehicle_busy', 'vehicle_busy']);
    expect(done.summary.unassigned).toEqual([{ deliveryId: extra.id, reason: 'no_vehicle' }]);
  });
  test('ручная правка порядка сбрасывает ETA; «Оптимизировать порядок» считает заново', async () => {
    const t = (await owner.get(`/trips/${run.summary.tripIds[0]}`)).body;
    expect(t.stops.length).toBeGreaterThan(0);
    const ids = t.stops.map((s: any) => s.id).reverse();
    expect((await owner.put(`/trips/${t.id}/order`, { stopIds: ids })).status).toBe(200);
    const cleared = (await owner.get(`/trips/${t.id}`)).body;
    expect(cleared.routeKm).toBeNull();
    expect(cleared.stops.every((s: any) => s.etaMin === null)).toBe(true);
    const r = await mk(owner, `/trips/${t.id}/optimize`, { reorder: true });
    const done = await waitRun(r.id);
    expect(done.status).toBe('done');
    const again = (await owner.get(`/trips/${t.id}`)).body;
    expect(Number(again.routeKm)).toBeGreaterThanOrEqual(0);
    expect(again.stops.every((s: any) => s.etaMin !== null)).toBe(true);
  });
  test('права: гость не запускает; чужой рейс недоступен', async () => {
    expect((await other.post(`/trips/${run.summary.tripIds[0]}/optimize`, { reorder: true })).status).toBeGreaterThanOrEqual(400);
    expect((await other.get(`/trips/routing/runs/${run.id}`)).status).toBe(404);
  });
});

describe('провайдер Яндекс на фикстуре', () => {
  test('геокодирование в фоне при сохранении, точки рейса наследуют координаты', async () => {
    await owner.put('/secrets/routing.yandex_geocoder_key', { value: 'GEO-KEY' });
    await owner.put('/secrets/routing.yandex_router_key', { value: 'ROUTER-KEY' });
    const view = (await owner.put('/trips/routing', settings({ provider: 'yandex' }))).body;
    expect(view.capabilities).toEqual({ geocode: true, matrix: true, solve: true });
    expect(JSON.stringify(view)).not.toContain('GEO-KEY');
    handler = c =>
      c.url.includes('geocode-maps.yandex.ru')
        ? ok({ response: { GeoObjectCollection: { featureMember: [{ GeoObject: { Point: { pos: '37.61 55.76' }, metaDataProperty: { GeocoderMetaData: { precision: 'exact' } } } }] } } })
        : { status: 500, json: null, text: '' };
    calls.length = 0;
    const d = await delivery({ address: 'Москва, Тверская 7', deliveryDate: day(7) });
    expect(d.lat).toBeNull();
    const t = await mk(owner, '/trips', { dateFrom: day(7), vehicleId: truck, driverMemberId: drv1 });
    await mk(owner, `/trips/${t.id}/deliveries`, { deliveryId: d.id });
    await processJobsOnce(sql, quiet);
    const row = (await admin.unsafe(`select lat, lon, geo_source, geo_status from deliveries where id='${d.id}'`))[0] as any;
    expect(row).toMatchObject({ lat: '55.760000', lon: '37.610000', geo_source: 'geocoder', geo_status: 'ok' });
    const stop = (await admin.unsafe(`select lat, geo_source from fleet_trip_stops where delivery_id='${d.id}'`))[0] as any;
    expect(stop).toMatchObject({ lat: '55.760000', geo_source: 'geocoder' });
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toContain('apikey=GEO-KEY');
    expect(calls[0]!.url).toContain(encodeURIComponent('Москва, Тверская 7'));
    // ручные координаты не перезаписываются геокодером
    await owner.put(`/deliveries/by-document/${d.documentId}`, { lat: 55.1, lon: 37.1 });
    await processJobsOnce(sql, quiet);
    expect(((await admin.unsafe(`select lat, geo_source from deliveries where id='${d.id}'`))[0] as any)).toMatchObject({ lat: '55.100000', geo_source: 'manual' });
    expect(calls.length).toBe(1);
    await owner.del(`/trips/${t.id}`);
  });
  test('адрес не найден — статус «не найден», координат нет', async () => {
    handler = () => ok({ response: { GeoObjectCollection: { featureMember: [] } } });
    const d = await delivery({ address: 'Нигде', deliveryDate: day(8) });
    await processJobsOnce(sql, quiet);
    expect(((await admin.unsafe(`select lat, geo_status from deliveries where id='${d.id}'`))[0] as any)).toMatchObject({ lat: null, geo_status: 'not_found' });
  });
  test('«Распределить» решает провайдер (VRP с опросом готовности); порядок берётся из ответа', async () => {
    const dd = [await delivery({ address: 'A', lat: 55.7, lon: 37.5, deliveryDate: day(10) }), await delivery({ address: 'B', lat: 55.71, lon: 37.51, deliveryDate: day(10) }), await delivery({ address: 'C', lat: 55.72, lon: 37.52, deliveryDate: day(10) })];
    let polls = 0;
    let sent: any = null;
    handler = c => {
      if (c.url.includes('/add/mvrp')) {
        sent = JSON.parse(c.body!);
        return ok({ id: 'task-1' });
      }
      if (c.url.includes('/result/mvrp/')) {
        if (++polls < 2) return { status: 202, json: { status: 'pending' }, text: '' };
        // одна машина берёт всё в обратном порядке
        const locs = [...sent.locations].reverse();
        return ok({ result: { routes: [{ vehicle_id: 1, route: locs.map((l: any) => ({ node: { type: 'location', value: { id: l.id, ref: l.ref } } })) }] } });
      }
      if (c.url.includes('distancematrix')) {
        const n = decodeURIComponent(c.url).split('origins=')[1]!.split('&')[0]!.split('|').length;
        const m = decodeURIComponent(c.url).split('destinations=')[1]!.split('&')[0]!.split('|').length;
        return ok({ rows: Array.from({ length: n }, () => ({ elements: Array.from({ length: m }, () => ({ status: 'OK', duration: { value: 600 }, distance: { value: 5000 } })) })) });
      }
      return { status: 500, json: null, text: '' };
    };
    calls.length = 0;
    const r = await mk(owner, '/trips/routing/distribute', { date: day(10) });
    const done = await waitRun(r.id);
    expect(done.status).toBe('done');
    expect(done.source).toBe('provider');
    expect(done.warning).toBeNull();
    // в день попадают и прежние нераспределённые доставки — их координаты тоже уходят провайдеру
    expect(done.summary.stops).toBeGreaterThanOrEqual(3);
    expect(sent.locations.length).toBeGreaterThanOrEqual(3);
    expect(calls.some(c => c.url.includes('apikey=ROUTER-KEY'))).toBe(true);
    const t = (await owner.get(`/trips/${done.summary.tripIds[0]}`)).body;
    // обратный порядок ответа провайдера; участки считает матрица провайдера (5 км, 10 минут)
    const refs = sent.locations.map((l: any) => l.ref).reverse();
    expect(t.stops.slice(0, refs.length).map((s: any) => s.deliveryId)).toEqual(refs);
    expect(refs.slice(0, 3).map((id: string) => dd.find(d => d.id === id)?.address)).toContain('C');
    expect(t.routeSource).toBe('provider');
    expect(t.stops[1].legKm).toBe('5.0');
    expect(t.stops[1].legMin).toBe(10);
  });
  test('сбой провайдера не ломает «Распределить»: расчёт по прямой и предупреждение', async () => {
    await delivery({ address: 'D', lat: 55.7, lon: 37.5, deliveryDate: day(12) });
    handler = () => ({ status: 403, json: null, text: '' });
    const r = await mk(owner, '/trips/routing/distribute', { date: day(12) });
    const done = await waitRun(r.id);
    expect(done.status).toBe('done');
    expect(done.source).toBe('straight');
    expect(done.warning).toContain('access denied');
    expect(done.summary.stops).toBe(1);
  });
});
