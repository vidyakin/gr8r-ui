import { describe, expect, test } from 'bun:test';
import {
  buildVroom,
  buildYandexVrp,
  computeEta,
  distributeJobs,
  optimizeStops,
  orderGreedy,
  osrmVroomAdapter,
  parseVroom,
  parseYandexGeocode,
  parseYandexVrp,
  routingUrlError,
  solveGreedy,
  straightMatrix,
  tileConfig,
  withSettings,
  yandexAdapter,
  type Fetcher,
  type OrderStop,
  type VrpJob,
  type VrpProblem,
} from '../src';

const job = (id: string, lat: number, lon: number, o: Partial<VrpJob> = {}): VrpJob => ({ id, location: { lat, lon }, serviceMin: 10, weightKg: 100, volumeM3: 0, pallets: 0, windowFromMin: null, windowToMin: null, ...o });
const veh = (id: string, kg: number | null = null) => ({ id, start: { lat: 55.75, lon: 37.6 }, capacityKg: kg, capacityM3: null, capacityPallets: null, fromMin: 540, toMin: 1080 });
const problem = (jobs: VrpJob[], vehicles = [veh('a'), veh('b')]): VrpProblem => ({ date: '2026-10-30', depot: { lat: 55.75, lon: 37.6 }, vehicles, jobs });

describe('сеть и настройки', () => {
  test('адрес своего сервера: частные и служебные запрещены', () => {
    expect(routingUrlError('')).toBeNull();
    expect(routingUrlError('https://osrm.example.com')).toBeNull();
    expect(routingUrlError('http://127.0.0.1:5000')).toBe('url_private');
    expect(routingUrlError('http://10.0.0.5')).toBe('url_private');
    expect(routingUrlError('http://osrm.internal')).toBe('url_private');
    expect(routingUrlError('http://169.254.169.254/')).toBe('url_private');
    expect(routingUrlError('ftp://x.com')).toBe('invalid_url');
    expect(routingUrlError('https://u:p@x.com')).toBe('url_credentials');
  });
  test('плитки: OSM по умолчанию, Яндекс при ключе', () => {
    expect(tileConfig(withSettings({})).crs).toBe('EPSG3857');
    expect(tileConfig(withSettings({ provider: 'yandex' })).crs).toBe('EPSG3857');
    const y = tileConfig(withSettings({ provider: 'yandex', yandexMapsKey: 'k' }));
    expect(y.crs).toBe('EPSG3395');
    expect(y.url).toContain('apikey=k');
  });
});

describe('расчёт без провайдера', () => {
  test('матрица по прямой симметрична, диагональ нулевая', () => {
    const m = straightMatrix([{ lat: 55.75, lon: 37.6 }, { lat: 55.8, lon: 37.7 }], 30);
    expect(m.distancesM[0]![0]).toBe(0);
    expect(m.distancesM[0]![1]).toBe(m.distancesM[1]![0]);
    expect(m.durationsS[0]![1]!).toBeGreaterThan(0);
  });
  test('ETA: ждём начала окна, помечаем опоздание, новый день', () => {
    const r = computeEta(
      540,
      [
        { legMin: 20, serviceMin: 10, dayOffset: 0, windowFromMin: 600, windowToMin: 700 },
        { legMin: 30, serviceMin: 10, dayOffset: 0, windowFromMin: null, windowToMin: 620 },
        { legMin: 10, serviceMin: 10, dayOffset: 1, windowFromMin: null, windowToMin: null },
      ],
      540,
    );
    expect(r.arriveMin[0]).toBe(600);
    expect(r.waitMin[0]).toBe(40);
    expect(r.arriveMin[1]).toBe(640);
    expect(r.late[1]).toBe(true);
    expect(r.arriveMin[2]).toBe(1440 + 540);
    expect(r.late[0]).toBe(false);
  });
  test('жадный подбор делит нагрузку и соблюдает вместимость', () => {
    const jobs = [job('1', 55.76, 37.61), job('2', 55.77, 37.62), job('3', 55.6, 37.3), job('4', 55.61, 37.31)];
    const s = solveGreedy(problem(jobs), 30);
    expect(s.unassigned).toEqual([]);
    expect(s.routes.length).toBe(2);
    const tight = solveGreedy(problem(jobs, [veh('a', 250)]), 30);
    expect(tight.routes[0]!.jobIds.length).toBe(2);
    expect(tight.unassigned.length).toBe(2);
  });
  test('точки без координат идут в конец, а не теряются', () => {
    const s = solveGreedy(problem([job('1', 55.76, 37.61), { ...job('2', 0, 0), location: null }], [veh('a')]), 30);
    expect(s.routes[0]!.jobIds).toEqual(['1', '2']);
  });
  test('порядок объезда: ближайший сосед', () => {
    const st = (id: string, lat: number, lon: number, o: Partial<OrderStop> = {}): OrderStop => ({ id, location: { lat, lon }, serviceMin: 10, dayOffset: 0, windowFromMin: null, windowToMin: null, ...o });
    const stops = [st('far', 55.9, 37.9), st('mid', 55.8, 37.7), st('near', 55.76, 37.61)];
    expect(orderGreedy(stops, { lat: 55.75, lon: 37.6 }, 540, 30)).toEqual(['near', 'mid', 'far']);
  });
  test('optimizeStops без провайдера: ETA, км и порядок', async () => {
    const stops: OrderStop[] = [
      { id: 'b', location: { lat: 55.8, lon: 37.7 }, serviceMin: 10, dayOffset: 0, windowFromMin: null, windowToMin: null },
      { id: 'a', location: { lat: 55.76, lon: 37.61 }, serviceMin: 10, dayOffset: 0, windowFromMin: null, windowToMin: null },
    ];
    const base = { stops, startMin: 540, settings: withSettings({}), kind: 'city' as const, date: '2026-10-30' };
    const r = await optimizeStops(null, { ...base, start: { lat: 55.75, lon: 37.6 }, reorder: true });
    expect(r.order).toEqual(['a', 'b']);
    expect(r.source).toBe('straight');
    expect(r.routeKm).toBeGreaterThan(0);
    expect(r.eta.arriveMin[1]!).toBeGreaterThan(r.eta.arriveMin[0]!);
    const keep = await optimizeStops(null, { ...base, start: null, reorder: false });
    expect(keep.order).toEqual(['b', 'a']);
    expect(keep.legs[0]).toEqual({ min: 0, km: 0 });
  });
});

describe('адаптеры на подменённом fetch', () => {
  test('Яндекс Геокодер: разбор', async () => {
    const calls: string[] = [];
    const f: Fetcher = async c => {
      calls.push(c.url);
      return { status: 200, text: '', json: { response: { GeoObjectCollection: { featureMember: [{ GeoObject: { Point: { pos: '37.6 55.75' }, metaDataProperty: { GeocoderMetaData: { precision: 'exact' } } } }] } } } };
    };
    const r = await yandexAdapter({ fetch: f, geocoderKey: 'K' }).geocode!('Москва, Тверская 1');
    expect(r).toEqual({ lat: 55.75, lon: 37.6, quality: 'exact' });
    expect(calls[0]).toContain('apikey=K');
    expect(calls[0]).toContain(encodeURIComponent('Москва, Тверская 1'));
    expect(parseYandexGeocode({})).toBeNull();
  });
  test('Яндекс без ключа — ошибка авторизации, без обращения в сеть', async () => {
    const f: Fetcher = async () => {
      throw new Error('network');
    };
    await expect(yandexAdapter({ fetch: f }).geocode!('x')).rejects.toMatchObject({ kind: 'auth' });
  });
  test('Яндекс Матрица: блоки и значения', async () => {
    const f: Fetcher = async c => {
      const u = decodeURIComponent(c.url);
      const n = u.split('origins=')[1]!.split('&')[0]!.split('|').length;
      const m = u.split('destinations=')[1]!.split('&')[0]!.split('|').length;
      return { status: 200, text: '', json: { rows: Array.from({ length: n }, () => ({ elements: Array.from({ length: m }, () => ({ status: 'OK', duration: { value: 60 }, distance: { value: 1000 } })) })) } };
    };
    const pts = Array.from({ length: 12 }, (_, i) => ({ lat: 55 + i / 100, lon: 37 }));
    const m = await yandexAdapter({ fetch: f, routerKey: 'K' }).matrix!(pts);
    expect(m.durationsS.length).toBe(12);
    expect(m.durationsS[11]![11]).toBe(60);
  });
  test('Яндекс VRP: отправка, опрос, разбор', async () => {
    const p = problem([job('j1', 55.76, 37.61), job('j2', 55.77, 37.62)]);
    expect((buildYandexVrp(p).locations as unknown[]).length).toBe(2);
    let polls = 0;
    const f: Fetcher = async c => {
      if (c.method === 'POST') return { status: 200, text: '', json: { id: 'task1' } };
      polls++;
      if (polls < 2) return { status: 202, text: '', json: { status: 'pending' } };
      return { status: 200, text: '', json: { result: { routes: [{ vehicle_id: 1, route: [{ node: { type: 'depot', value: {} } }, { node: { type: 'location', value: { id: 2, ref: 'j2' } } }, { node: { type: 'location', value: { id: 1, ref: 'j1' } } }] }] } } };
    };
    const s = await yandexAdapter({ fetch: f, routerKey: 'K', sleep: async () => {} }).solve!(p);
    expect(s.routes).toEqual([{ vehicleId: 'a', jobIds: ['j2', 'j1'] }]);
    expect(polls).toBe(2);
    expect(parseYandexVrp({}, p).unassigned).toEqual(['j1', 'j2']);
  });
  test('Яндекс VRP: не дождались решения — временная ошибка', async () => {
    const f: Fetcher = async c => (c.method === 'POST' ? { status: 200, text: '', json: { id: 't' } } : { status: 202, text: '', json: {} });
    await expect(yandexAdapter({ fetch: f, routerKey: 'K', sleep: async () => {}, polls: 2 }).solve!(problem([job('j', 55.7, 37.6)]))).rejects.toMatchObject({ kind: 'transient' });
  });
  test('OSRM table и VROOM', async () => {
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const f: Fetcher = async c => {
      urls.push(c.url);
      if (c.url.includes('/table/')) return { status: 200, text: '', json: { code: 'Ok', durations: [[0, 120], [130, 0]], distances: [[0, 2000], [2100, 0]] } };
      bodies.push(JSON.parse(c.body!));
      return { status: 200, text: '', json: { code: 0, routes: [{ vehicle: 2, steps: [{ type: 'start' }, { type: 'job', id: 2 }, { type: 'job', id: 1 }, { type: 'end' }] }], unassigned: [] } };
    };
    const a = osrmVroomAdapter({ fetch: f, osrmUrl: 'http://osrm/', vroomUrl: 'http://vroom:3000' });
    const m = await a.matrix!([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]);
    expect(urls[0]).toBe('http://osrm/table/v1/driving/2,1;4,3?annotations=duration,distance');
    expect(m.durationsS[0]![1]).toBe(120);
    const p = problem([job('j1', 55.76, 37.61, { windowFromMin: 600, windowToMin: 700 }), job('j2', 55.77, 37.62)]);
    const s = await a.solve!(p);
    expect(s.routes).toEqual([{ vehicleId: 'b', jobIds: ['j2', 'j1'] }]);
    const body = bodies[0] as { jobs: { time_windows?: number[][]; location: number[] }[] };
    expect(body.jobs[0]!.time_windows).toEqual([[36000, 42000]]);
    expect(body.jobs[0]!.location).toEqual([37.61, 55.76]);
    expect(a.geocode).toBeUndefined();
    expect(() => parseVroom({ code: 3, error: 'bad' }, p)).toThrow();
    expect((buildVroom(p).vehicles as unknown[]).length).toBe(2);
  });
  test('Nominatim геокодирует', async () => {
    const f: Fetcher = async () => ({ status: 200, text: '', json: [{ lat: '55.7', lon: '37.6', addresstype: 'house' }] });
    const a = osrmVroomAdapter({ fetch: f, osrmUrl: '', vroomUrl: '', nominatimUrl: 'https://nom.example.com' });
    expect(await a.geocode!('x')).toEqual({ lat: 55.7, lon: 37.6, quality: 'exact' });
    expect(a.matrix).toBeUndefined();
  });
  test('сбой провайдера при распределении — откат на жадный подбор с предупреждением', async () => {
    const adapter = {
      kind: 'yandex' as const,
      solve: async (): Promise<never> => {
        throw new Error('boom');
      },
    };
    const r = await distributeJobs(adapter, problem([job('1', 55.76, 37.61)]), withSettings({ provider: 'yandex' }));
    expect(r.source).toBe('straight');
    expect(r.warning).toBe('boom');
    expect(r.solution.routes.length).toBe(1);
  });
  test('распределение через провайдера: точки без координат добавляются', async () => {
    const adapter = { kind: 'osrm_vroom' as const, solve: async (p: VrpProblem) => ({ routes: [{ vehicleId: 'a', jobIds: p.jobs.map(j => j.id) }], unassigned: [] }) };
    const r = await distributeJobs(adapter, problem([job('1', 55.76, 37.61), { ...job('2', 0, 0), location: null }]), withSettings({}));
    expect(r.source).toBe('provider');
    expect(r.solution.routes.flatMap(x => x.jobIds).sort()).toEqual(['1', '2']);
  });
});
