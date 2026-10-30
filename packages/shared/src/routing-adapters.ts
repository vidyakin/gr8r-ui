/* Адаптеры провайдеров маршрутизации (задача 1213, docs/architecture/routing.md): Яндекс (Геокодер, Матрица расстояний, Маршрутизация)
   и OSRM + VROOM (+ необязательный Nominatim) на своём сервере. Сеть — только через `Fetcher`, поэтому адаптеры проверяются на подменённом ответе.
   ВНИМАНИЕ: формы запросов и ответов собраны по документации без живых вызовов (ключей нет) — сверить с боевым API до включения. */
import type { Fetcher, HttpReply } from './bank-api';
import { RoutingError, type GeoPoint, type GeoResult, type Matrix, type RoutingAdapter, type VrpProblem, type VrpSolution } from './routing';

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

export function checkReply(r: HttpReply, what: string): void {
  if (r.status >= 200 && r.status < 300) return;
  if (r.status === 401 || r.status === 403) throw new RoutingError('auth', `${what}: access denied (HTTP ${r.status})`);
  if (r.status === 408 || r.status === 425 || r.status === 429 || r.status >= 500) throw new RoutingError('transient', `${what}: HTTP ${r.status}`);
  throw new RoutingError('permanent', `${what}: HTTP ${r.status}`);
}

export const YANDEX_BASE = {
  geocoder: 'https://geocode-maps.yandex.ru/1.x',
  matrix: 'https://api.routing.yandex.net/v2/distancematrix',
  vrp: 'https://courier.yandex.ru/vrs/api/v1',
};

const minToHm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const win = (a: number | null, b: number | null) => (a === null && b === null ? undefined : `${minToHm(a ?? 0)}-${minToHm(b ?? 1439)}`);

/* ---------------- Яндекс ---------------- */

/** Ответ Геокодера (format=json) → точка. Точность `exact`/`number` — дом найден, остальное — приблизительно */
export function parseYandexGeocode(json: unknown): GeoResult | null {
  const members = arr(rec(rec(rec(json).response).GeoObjectCollection).featureMember);
  const geo = rec(rec(members[0]).GeoObject);
  const pos = typeof rec(geo.Point).pos === 'string' ? (rec(geo.Point).pos as string).split(/\s+/) : [];
  const lon = num(pos[0]);
  const lat = num(pos[1]);
  if (lat === null || lon === null) return null;
  const precision = rec(rec(rec(geo.metaDataProperty).GeocoderMetaData)).precision;
  return { lat, lon, quality: precision === 'exact' || precision === 'number' ? 'exact' : 'approx' };
}

/** Ответ Матрицы расстояний → блок значений */
export function parseYandexMatrix(json: unknown): { durationsS: (number | null)[][]; distancesM: (number | null)[][] } {
  const rows = arr(rec(json).rows);
  const durationsS: (number | null)[][] = [];
  const distancesM: (number | null)[][] = [];
  for (const row of rows) {
    const d: (number | null)[] = [];
    const m: (number | null)[] = [];
    for (const el of arr(rec(row).elements)) {
      const e = rec(el);
      const ok = e.status === 'OK';
      d.push(ok ? num(rec(e.duration).value) : null);
      m.push(ok ? num(rec(e.distance).value) : null);
    }
    durationsS.push(d);
    distancesM.push(m);
  }
  return { durationsS, distancesM };
}

/** Запрос задачи маршрутизации Яндекса. Идентификаторы — числа (1..n), внешний id кладётся в `ref` */
export function buildYandexVrp(p: VrpProblem): Record<string, unknown> {
  const depot = p.depot ?? p.vehicles.find(v => v.start)?.start ?? p.jobs.find(j => j.location)?.location;
  if (!depot) throw new RoutingError('permanent', 'No coordinates for the depot');
  const lim = (v: number | null, key: string) => (v === null ? {} : { [key]: { value: v } });
  return {
    depot: { id: 0, point: { lat: depot.lat, lon: depot.lon }, time_window: win(Math.min(...p.vehicles.map(v => v.fromMin)), Math.max(...p.vehicles.map(v => v.toMin))) },
    vehicles: p.vehicles.map((v, i) => ({
      id: i + 1,
      ref: v.id,
      capacity: { limits: { ...lim(v.capacityKg, 'weight'), ...lim(v.capacityM3, 'volume'), ...lim(v.capacityPallets, 'units') } },
      visited_locations_limit: undefined,
    })),
    locations: p.jobs.map((j, i) => ({
      id: i + 1,
      ref: j.id,
      point: { lat: j.location!.lat, lon: j.location!.lon },
      time_window: win(j.windowFromMin, j.windowToMin),
      penalty: { out_of_time: { fixed: 0, minute: 1 } },
      shipment_size: { weight: { value: j.weightKg }, volume: { value: j.volumeM3 }, units: { value: j.pallets } },
      service_duration_s: j.serviceMin * 60,
    })),
    options: { quality: 'normal', date: p.date, time_zone: 3 },
  };
}

/** Результат решения Яндекса → маршруты (по `ref`). `unassigned` — не вошедшие в маршруты */
export function parseYandexVrp(json: unknown, p: VrpProblem): VrpSolution {
  const result = rec(rec(json).result);
  const routes: VrpSolution['routes'] = [];
  const seen = new Set<string>();
  for (const r of arr(result.routes)) {
    const rr = rec(r);
    const vehicleId = typeof rr.vehicle_ref === 'string' ? rr.vehicle_ref : (p.vehicles[(num(rr.vehicle_id) ?? 0) - 1]?.id ?? '');
    const ids: string[] = [];
    for (const n of arr(rr.route)) {
      const node = rec(rec(n).node);
      if (node.type !== 'location') continue;
      const v = rec(node.value);
      const id = typeof v.ref === 'string' ? v.ref : p.jobs[(num(v.id) ?? 0) - 1]?.id;
      if (id) {
        ids.push(id);
        seen.add(id);
      }
    }
    if (vehicleId && ids.length) routes.push({ vehicleId, jobIds: ids });
  }
  return { routes, unassigned: p.jobs.map(j => j.id).filter(id => !seen.has(id)) };
}

export interface YandexOptions {
  fetch: Fetcher;
  geocoderKey?: string;
  routerKey?: string;
  base?: Partial<typeof YANDEX_BASE>;
  sleep?: (ms: number) => Promise<void>;
  /** Сколько раз опросить готовность решения и с какой паузой */
  polls?: number;
  pollMs?: number;
}

export function yandexAdapter(o: YandexOptions): RoutingAdapter {
  const base = { ...YANDEX_BASE, ...o.base };
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const need = (k: string | undefined, what: string) => {
    if (!k) throw new RoutingError('auth', `${what}: the API key is not set`);
    return k;
  };
  return {
    kind: 'yandex',
    async geocode(address) {
      const key = need(o.geocoderKey, 'Yandex Geocoder');
      const url = `${base.geocoder}/?apikey=${encodeURIComponent(key)}&format=json&results=1&lang=ru_RU&geocode=${encodeURIComponent(address)}`;
      const r = await o.fetch({ method: 'GET', url });
      checkReply(r, 'Yandex Geocoder');
      return parseYandexGeocode(r.json);
    },
    async matrix(points) {
      const key = need(o.routerKey, 'Yandex Distance Matrix');
      const n = points.length;
      const durationsS: (number | null)[][] = Array.from({ length: n }, () => Array<number | null>(n).fill(null));
      const distancesM: (number | null)[][] = Array.from({ length: n }, () => Array<number | null>(n).fill(null));
      const pt = (p: GeoPoint) => `${p.lat},${p.lon}`;
      const B = 10; // блоками 10×10: у API есть ограничение на число пар в запросе
      for (let i = 0; i < n; i += B)
        for (let j = 0; j < n; j += B) {
          const org = points.slice(i, i + B);
          const dst = points.slice(j, j + B);
          const url = `${base.matrix}?apikey=${encodeURIComponent(key)}&mode=driving&origins=${org.map(pt).join('|')}&destinations=${dst.map(pt).join('|')}`;
          const r = await o.fetch({ method: 'GET', url });
          checkReply(r, 'Yandex Distance Matrix');
          const m = parseYandexMatrix(r.json);
          m.durationsS.forEach((row, a) => row.forEach((v, b) => { durationsS[i + a]![j + b] = v; distancesM[i + a]![j + b] = m.distancesM[a]![b] ?? null; }));
        }
      return { durationsS, distancesM };
    },
    async solve(problem) {
      const key = need(o.routerKey, 'Yandex Routing');
      if (!problem.jobs.length) return { routes: [], unassigned: [] };
      const add = await o.fetch({ method: 'POST', url: `${base.vrp}/add/mvrp?apikey=${encodeURIComponent(key)}`, headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildYandexVrp(problem)) });
      checkReply(add, 'Yandex Routing');
      const id = rec(add.json).id;
      if (typeof id !== 'string' || !id) throw new RoutingError('permanent', 'Yandex Routing: no task id in the response');
      const polls = o.polls ?? 30;
      for (let i = 0; i < polls; i++) {
        const r = await o.fetch({ method: 'GET', url: `${base.vrp}/result/mvrp/${encodeURIComponent(id)}` });
        if (r.status === 200 && rec(r.json).result) return parseYandexVrp(r.json, problem);
        if (r.status !== 200 && r.status !== 202 && r.status !== 404) checkReply(r, 'Yandex Routing');
        await sleep(o.pollMs ?? 2000);
      }
      throw new RoutingError('transient', 'Yandex Routing: the solution is not ready');
    },
  };
}

/* ---------------- OSRM + VROOM ---------------- */

/** Запрос VROOM: целочисленные id (индекс+1), вместимость — [кг, литры, паллеты]; всё везём с начала (поставка `delivery`) */
export function buildVroom(p: VrpProblem): Record<string, unknown> {
  const kg = (x: number) => Math.ceil(x);
  const l = (x: number) => Math.ceil(x * 1000);
  const cap = (v: number | null, f: (x: number) => number) => (v === null ? 2_000_000_000 : f(v));
  return {
    vehicles: p.vehicles.map((v, i) => {
      const s = v.start ?? p.depot;
      return {
        id: i + 1,
        ...(s ? { start: [s.lon, s.lat] } : {}),
        capacity: [cap(v.capacityKg, kg), cap(v.capacityM3, l), v.capacityPallets ?? 2_000_000_000],
        time_window: [v.fromMin * 60, v.toMin * 60],
      };
    }),
    jobs: p.jobs.map((j, i) => ({
      id: i + 1,
      location: [j.location!.lon, j.location!.lat],
      service: j.serviceMin * 60,
      delivery: [kg(j.weightKg), l(j.volumeM3), j.pallets],
      ...(j.windowFromMin !== null || j.windowToMin !== null ? { time_windows: [[(j.windowFromMin ?? 0) * 60, (j.windowToMin ?? 1439) * 60]] } : {}),
    })),
    options: { g: false },
  };
}

export function parseVroom(json: unknown, p: VrpProblem): VrpSolution {
  const o = rec(json);
  if (o.code !== undefined && o.code !== 0) throw new RoutingError('permanent', `VROOM: ${typeof o.error === 'string' ? o.error : `code ${String(o.code)}`}`);
  const routes: VrpSolution['routes'] = [];
  const seen = new Set<string>();
  for (const r of arr(o.routes)) {
    const rr = rec(r);
    const vehicleId = p.vehicles[(num(rr.vehicle) ?? 0) - 1]?.id;
    const ids: string[] = [];
    for (const s of arr(rr.steps)) {
      const st = rec(s);
      if (st.type !== 'job') continue;
      const id = p.jobs[(num(st.id) ?? num(st.job) ?? 0) - 1]?.id;
      if (id) {
        ids.push(id);
        seen.add(id);
      }
    }
    if (vehicleId && ids.length) routes.push({ vehicleId, jobIds: ids });
  }
  return { routes, unassigned: p.jobs.map(j => j.id).filter(id => !seen.has(id)) };
}

export function parseOsrmTable(json: unknown, n: number): Matrix {
  const o = rec(json);
  if (o.code !== 'Ok') throw new RoutingError('permanent', `OSRM: ${typeof o.message === 'string' ? o.message : String(o.code)}`);
  const grid = (v: unknown) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => num(arr(arr(v)[i])[j])));
  return { durationsS: grid(o.durations), distancesM: grid(o.distances) };
}

export interface OsrmVroomOptions {
  fetch: Fetcher;
  osrmUrl: string;
  vroomUrl: string;
  nominatimUrl?: string;
}

const trimUrl = (u: string) => u.replace(/\/+$/, '');

export function osrmVroomAdapter(o: OsrmVroomOptions): RoutingAdapter {
  return {
    kind: 'osrm_vroom',
    ...(o.nominatimUrl
      ? {
          async geocode(address: string): Promise<GeoResult | null> {
            const r = await o.fetch({ method: 'GET', url: `${trimUrl(o.nominatimUrl!)}/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}` });
            checkReply(r, 'Nominatim');
            const first = rec(arr(r.json)[0]);
            const lat = num(first.lat);
            const lon = num(first.lon);
            if (lat === null || lon === null) return null;
            return { lat, lon, quality: first.addresstype === 'house' || first.category === 'building' || first.type === 'house' ? 'exact' : 'approx' };
          },
        }
      : {}),
    ...(o.osrmUrl
      ? {
          async matrix(points: readonly GeoPoint[]): Promise<Matrix> {
            const coords = points.map(p => `${p.lon},${p.lat}`).join(';');
            const r = await o.fetch({ method: 'GET', url: `${trimUrl(o.osrmUrl)}/table/v1/driving/${coords}?annotations=duration,distance` });
            checkReply(r, 'OSRM');
            return parseOsrmTable(r.json, points.length);
          },
        }
      : {}),
    ...(o.vroomUrl
      ? {
          async solve(problem: VrpProblem): Promise<VrpSolution> {
            if (!problem.jobs.length) return { routes: [], unassigned: [] };
            const r = await o.fetch({ method: 'POST', url: `${trimUrl(o.vroomUrl)}/`, headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildVroom(problem)) });
            checkReply(r, 'VROOM');
            return parseVroom(r.json, problem);
          },
        }
      : {}),
  };
}
