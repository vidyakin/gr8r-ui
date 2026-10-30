/* Маршрутизация (задача 1213, docs/architecture/routing.md): общие типы адаптера провайдера, настройки, расчёт без провайдера
   (расстояние по прямой, жадный подбор, порядок «ближайший сосед + 2-opt»), время прибытия точек (ETA) и тайлы карты.
   Чистый код без сети и БД: сеть приходит снаружи (адаптеры — routing-adapters.ts, `Fetcher` из bank-api.ts). */
import { isForbiddenHostname, isIpLiteral, isPrivateAddress } from './automations/net';
import { straightKm } from './trips';

export const ROUTING_PROVIDERS = ['none', 'yandex', 'osrm_vroom'] as const;
export type RoutingProvider = (typeof ROUTING_PROVIDERS)[number];
export const ROUTING_SETTING = 'routing';
/** Имена секретов хранилища (docs/architecture/secrets.md): ключи Яндекса вводятся на экране настроек маршрутизации */
export const ROUTING_SECRETS = { yandexGeocoder: 'routing.yandex_geocoder_key', yandexRouter: 'routing.yandex_router_key' } as const;

export interface RoutingSettings {
  provider: RoutingProvider;
  /** Адрес своих серверов (OSRM, VROOM, Nominatim); пусто — адреса оператора из окружения (ROUTING_OSRM_URL …) */
  osrmUrl: string;
  vroomUrl: string;
  nominatimUrl: string;
  /** Ключ JavaScript API Яндекса для плиток карты: он виден в браузере по определению, поэтому лежит в настройках, а не в секретах */
  yandexMapsKey: string;
  /** База машин: адрес и координаты; пусто — маршрут начинается с первой точки */
  depotAddress: string;
  depotLat: number | null;
  depotLon: number | null;
  /** Время на точке, минут */
  serviceMinutes: number;
  /** Начало рабочего дня рейса, если у рейса нет времени начала, HH:MM */
  dayStart: string;
  /** Средняя скорость при расчёте без провайдера: по городу и по трассе (междугородний рейс), км/ч */
  citySpeedKmh: number;
  roadSpeedKmh: number;
}

export const DEFAULT_ROUTING_SETTINGS: RoutingSettings = {
  provider: 'none',
  osrmUrl: '',
  vroomUrl: '',
  nominatimUrl: '',
  yandexMapsKey: '',
  depotAddress: '',
  depotLat: null,
  depotLon: null,
  serviceMinutes: 10,
  dayStart: '09:00',
  citySpeedKmh: 30,
  roadSpeedKmh: 60,
};

/** Адрес своего сервера маршрутизации: только http(s) без учётных данных; частные и локальные адреса запрещены (как у вебхуков).
    Проверка имён без DNS; адреса из DNS проверяет сервер при каждом обращении. Возвращает текст ошибки или null */
export function routingUrlError(raw: string): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'invalid_url';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'invalid_url';
  if (url.username || url.password) return 'url_credentials';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIpLiteral(host) ? isPrivateAddress(host) : isForbiddenHostname(host)) return 'url_private';
  return null;
}

export const withSettings = (s: Partial<RoutingSettings> | null | undefined): RoutingSettings => ({ ...DEFAULT_ROUTING_SETTINGS, ...(s ?? {}) });

/* ---------------- модель задачи ---------------- */

export interface GeoPoint {
  lat: number;
  lon: number;
}
export interface GeoResult extends GeoPoint {
  /** exact — дом найден точно; approx — улица, район или город */
  quality: 'exact' | 'approx';
}
export interface Matrix {
  /** [i][j] — секунды и метры из точки i в точку j; null — проезда нет */
  durationsS: (number | null)[][];
  distancesM: (number | null)[][];
}
export interface VrpVehicle {
  id: string;
  start: GeoPoint | null;
  /** null — не ограничена */
  capacityKg: number | null;
  capacityM3: number | null;
  capacityPallets: number | null;
  /** Рабочее время в минутах от полуночи дня */
  fromMin: number;
  toMin: number;
}
export interface VrpJob {
  id: string;
  location: GeoPoint | null;
  serviceMin: number;
  weightKg: number;
  volumeM3: number;
  pallets: number;
  windowFromMin: number | null;
  windowToMin: number | null;
}
export interface VrpProblem {
  /** День, на который строятся рейсы (ГГГГ-ММ-ДД) — нужен провайдерам с календарём */
  date: string;
  depot: GeoPoint | null;
  vehicles: VrpVehicle[];
  jobs: VrpJob[];
}
export interface VrpSolution {
  routes: { vehicleId: string; jobIds: string[] }[];
  unassigned: string[];
}

export interface RoutingAdapter {
  readonly kind: Exclude<RoutingProvider, 'none'>;
  geocode?(address: string): Promise<GeoResult | null>;
  matrix?(points: readonly GeoPoint[]): Promise<Matrix>;
  solve?(problem: VrpProblem): Promise<VrpSolution>;
}

/** Ошибка провайдера маршрутизации: transient — стоит повторить, auth — ключ не принят, permanent — запрос отклонён */
export class RoutingError extends Error {
  constructor(
    public readonly kind: 'auth' | 'transient' | 'permanent',
    message: string,
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}

/* ---------------- время ---------------- */

export const hhmmToMin = (t: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const minToHhmm = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/* ---------------- расчёт без провайдера ---------------- */

/** Коэффициент извилистости дорог относительно прямой */
export const DETOUR = 1.3;

/** Матрица по прямой: путь = прямая × DETOUR, время = путь / скорость */
export function straightMatrix(points: readonly GeoPoint[], speedKmh: number): Matrix {
  const n = points.length;
  const durationsS: (number | null)[][] = [];
  const distancesM: (number | null)[][] = [];
  for (let i = 0; i < n; i++) {
    const dr: (number | null)[] = [];
    const ds: (number | null)[] = [];
    for (let j = 0; j < n; j++) {
      const m = i === j ? 0 : straightKm(points[i]!, points[j]!) * DETOUR * 1000;
      ds.push(Math.round(m));
      dr.push(Math.round((m / 1000 / Math.max(speedKmh, 1)) * 3600));
    }
    durationsS.push(dr);
    distancesM.push(ds);
  }
  return { durationsS, distancesM };
}

/** Участок маршрута: минуты и километры (null — нет координат или проезда нет) */
export interface Leg {
  min: number | null;
  km: number | null;
}

export interface EtaStop {
  legMin: number | null;
  serviceMin: number;
  /** Номер дня рейса точки (0 — первый день) */
  dayOffset: number;
  windowFromMin: number | null;
  windowToMin: number | null;
}
export interface EtaResult {
  /** Прибытие и убытие, минут от полуночи первого дня рейса */
  arriveMin: number[];
  departMin: number[];
  /** Прибытие позже конца окна */
  late: boolean[];
  /** Ожидание начала окна, минут */
  waitMin: number[];
  /** От выезда до убытия с последней точки */
  totalMin: number;
}

/** Время прибытия по точкам: выезд + участок; раньше окна — ждём его начала; новый день рейса начинается с `dayStartMin` */
export function computeEta(startMin: number, stops: readonly EtaStop[], dayStartMin: number): EtaResult {
  const arriveMin: number[] = [];
  const departMin: number[] = [];
  const late: boolean[] = [];
  const waitMin: number[] = [];
  let t = startMin;
  let day = stops.length ? Math.floor(startMin / 1440) : 0;
  for (const s of stops) {
    let arrive = t + (s.legMin ?? 0);
    if (s.dayOffset > day) {
      arrive = Math.max(arrive, s.dayOffset * 1440 + dayStartMin);
      day = s.dayOffset;
    }
    const from = s.windowFromMin !== null ? s.dayOffset * 1440 + s.windowFromMin : null;
    const to = s.windowToMin !== null ? s.dayOffset * 1440 + s.windowToMin : null;
    const wait = from !== null && arrive < from ? from - arrive : 0;
    late.push(to !== null && arrive > to);
    waitMin.push(wait);
    arriveMin.push(arrive + wait);
    t = arrive + wait + s.serviceMin;
    departMin.push(t);
  }
  return { arriveMin, departMin, late, waitMin, totalMin: Math.max(0, t - startMin) };
}

const secToMin = (s: number | null) => (s === null ? null : Math.ceil(s / 60));

/** Время и км участков по матрице для точек в порядке `idx` (индексы матрицы); `startIdx` — откуда выезд (null — с первой точки) */
export function legsOf(matrix: Matrix, order: readonly (number | null)[], startIdx: number | null): Leg[] {
  const out: Leg[] = [];
  let prev = startIdx;
  for (const i of order) {
    if (i === null || prev === null) out.push({ min: null, km: null });
    else {
      const d = matrix.durationsS[prev]?.[i] ?? null;
      const m = matrix.distancesM[prev]?.[i] ?? null;
      out.push({ min: secToMin(d), km: m === null ? null : Math.round(m / 100) / 10 });
    }
    prev = i ?? prev;
  }
  return out;
}

/* ---------------- жадный подбор (без провайдера) ---------------- */

/** Распределение доставок по машинам: каждый шаг — ближайшая допустимая точка по вместимости и окну среди всех машин (ближайший сосед
    сразу для всех машин, поэтому нагрузка делится). Точки, которые не успеть в окно, добираются вторым проходом с опозданием;
    точки без координат идут в конец маршрутов по окнам. Не поместившиеся по вместимости — в `unassigned` */
export function solveGreedy(problem: VrpProblem, speedKmh: number): VrpSolution {
  const located = problem.jobs.filter(j => j.location);
  const noGeo = problem.jobs.filter(j => !j.location);
  const pts: GeoPoint[] = [...located.map(j => j.location!), ...problem.vehicles.map(v => v.start ?? problem.depot).filter((p): p is GeoPoint => !!p)];
  const m = straightMatrix(pts, speedKmh);
  const jobIdx = new Map(located.map((j, i) => [j.id, i]));
  let next = located.length;
  const vehIdx = new Map<string, number | null>();
  for (const v of problem.vehicles) vehIdx.set(v.id, v.start ?? problem.depot ? next++ : null);

  interface State {
    v: VrpVehicle;
    pos: number | null;
    t: number;
    kg: number;
    m3: number;
    pal: number;
    jobs: string[];
  }
  const st: State[] = problem.vehicles.map(v => ({ v, pos: vehIdx.get(v.id) ?? null, t: v.fromMin, kg: 0, m3: 0, pal: 0, jobs: [] }));
  const fits = (s: State, j: VrpJob) =>
    (s.v.capacityKg === null || s.kg + j.weightKg <= s.v.capacityKg + 1e-9) &&
    (s.v.capacityM3 === null || s.m3 + j.volumeM3 <= s.v.capacityM3 + 1e-9) &&
    (s.v.capacityPallets === null || s.pal + j.pallets <= s.v.capacityPallets);
  const take = (s: State, j: VrpJob, arrive: number) => {
    s.jobs.push(j.id);
    s.kg += j.weightKg;
    s.m3 += j.volumeM3;
    s.pal += j.pallets;
    s.t = Math.max(arrive, j.windowFromMin ?? 0) + j.serviceMin;
    s.pos = jobIdx.get(j.id) ?? s.pos;
  };

  // машины без базы стартуют с разных концов: зерно маршрута — точка, самая дальняя от центра и уже занятых зёрен
  if (located.length) {
    const taken: number[] = st.filter(s => s.pos !== null).map(s => s.pos!);
    const cx = located.reduce((a, j) => a + j.location!.lat, 0) / located.length;
    const cy = located.reduce((a, j) => a + j.location!.lon, 0) / located.length;
    const used = new Set<number>();
    for (const s of st) {
      if (s.pos !== null) continue;
      let bi = -1;
      let bd = -1;
      located.forEach((j, i) => {
        if (used.has(i)) return;
        const d = taken.length ? Math.min(...taken.map(t => straightKm(pts[t]!, j.location!))) : straightKm({ lat: cx, lon: cy }, j.location!);
        if (d > bd) {
          bd = d;
          bi = i;
        }
      });
      if (bi < 0) break;
      used.add(bi);
      taken.push(bi);
      s.pos = bi;
    }
  }
  const left = new Set(located.map(j => j.id));
  for (const strict of [true, false]) {
    for (;;) {
      let best: { s: State; j: VrpJob; arrive: number; cost: number } | null = null;
      for (const j of located) {
        if (!left.has(j.id)) continue;
        const ji = jobIdx.get(j.id)!;
        for (const s of st) {
          if (!fits(s, j)) continue;
          const driveS = s.pos === null ? 0 : (m.durationsS[s.pos]![ji] ?? 0);
          const arrive = s.t + Math.ceil(driveS / 60);
          if (strict && j.windowToMin !== null && arrive > j.windowToMin) continue;
          if (s.t >= s.v.toMin && s.jobs.length) continue;
          // дорога + ожидание окна + запас до конца окна (срочные точки раньше) + небольшой штраф за длину маршрута (выравнивает нагрузку)
          const wait = j.windowFromMin !== null && arrive < j.windowFromMin ? j.windowFromMin - arrive : 0;
          const slack = j.windowToMin === null ? 0 : Math.max(0, j.windowToMin - arrive);
          const cost = driveS + wait * 60 + slack * 15 + s.jobs.length * 30;
          if (!best || cost < best.cost) best = { s, j, arrive, cost };
        }
      }
      if (!best) break;
      take(best.s, best.j, best.arrive);
      left.delete(best.j.id);
    }
  }
  // без координат: по началу окна, в машину с наименьшим числом точек, куда поместится
  for (const j of [...noGeo].sort((a, b) => (a.windowFromMin ?? 1e9) - (b.windowFromMin ?? 1e9))) {
    const cand = st.filter(s => fits(s, j)).sort((a, b) => a.jobs.length - b.jobs.length)[0];
    if (cand) take(cand, j, cand.t);
    else left.add(j.id);
  }
  return { routes: st.filter(s => s.jobs.length).map(s => ({ vehicleId: s.v.id, jobIds: s.jobs })), unassigned: [...left] };
}

/* ---------------- порядок точек одного рейса ---------------- */

export interface OrderStop {
  id: string;
  location: GeoPoint | null;
  serviceMin: number;
  dayOffset: number;
  windowFromMin: number | null;
  windowToMin: number | null;
}

/** Стоимость порядка: сначала число опозданий, потом время в пути (секунды матрицы) */
function orderCost(matrix: Matrix, order: readonly number[], start: number | null, stops: readonly OrderStop[], startMin: number): [number, number] {
  let drive = 0;
  let prev = start;
  const etaStops: EtaStop[] = order.map(i => {
    const d = prev === null ? 0 : (matrix.durationsS[prev]![i] ?? 0);
    drive += d;
    prev = i;
    const s = stops[i]!;
    return { legMin: Math.ceil(d / 60), serviceMin: s.serviceMin, dayOffset: s.dayOffset, windowFromMin: s.windowFromMin, windowToMin: s.windowToMin };
  });
  const eta = computeEta(startMin, etaStops, 0);
  return [eta.late.filter(Boolean).length, drive];
}

/** Порядок объезда без провайдера: ближайший сосед от старта (с учётом окон), затем улучшение 2-opt. Индексы — позиции в `stops`.
    Точки без координат остаются в конце в прежнем порядке. Дни рейса не перемешиваются: порядок строится внутри каждого дня */
export function orderGreedy(stops: readonly OrderStop[], start: GeoPoint | null, startMin: number, speedKmh: number): string[] {
  const days = [...new Set(stops.map(s => s.dayOffset))].sort((a, b) => a - b);
  const out: string[] = [];
  let from = start;
  for (const d of days) {
    const group = stops.filter(s => s.dayOffset === d);
    const geo = group.filter(s => s.location);
    const rest = group.filter(s => !s.location);
    const pts = [...geo.map(s => s.location!), ...(from ? [from] : [])];
    const m = straightMatrix(pts, speedKmh);
    const st = from ? geo.length : null;
    const left = new Set(geo.map((_, i) => i));
    const order: number[] = [];
    let pos = st;
    while (left.size) {
      let bi = -1;
      let bc = Infinity;
      for (const i of left) {
        const base = pos === null ? 0 : (m.durationsS[pos]![i] ?? 0);
        // окно, которое закрывается раньше, получает приоритет: считаем «срочность» как конец окна
        const c = base + ((geo[i]!.windowToMin ?? 1440) / 1440) * 600;
        if (c < bc) {
          bc = c;
          bi = i;
        }
      }
      order.push(bi);
      left.delete(bi);
      pos = bi;
    }
    // 2-opt: разворот отрезка, если уменьшает (опоздания, дорога)
    const better = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    let cur = orderCost(m, order, st, geo, startMin);
    for (let pass = 0, improved = true; improved && pass < 20; pass++) {
      improved = false;
      for (let i = 0; i < order.length - 1; i++)
        for (let j = i + 1; j < order.length; j++) {
          const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
          const c = orderCost(m, cand, st, geo, startMin);
          if (better(c, cur)) {
            order.splice(0, order.length, ...cand);
            cur = c;
            improved = true;
          }
        }
    }
    for (const i of order) out.push(geo[i]!.id);
    for (const s of rest) out.push(s.id);
    const last = order.length ? geo[order[order.length - 1]!]!.location! : from;
    from = last;
  }
  return out;
}

/* ---------------- плитки карты ---------------- */

export interface TileConfig {
  url: string;
  attribution: string;
  /** EPSG3857 — обычная проекция OSM; EPSG3395 — эллипсоидальный Меркатор плиток Яндекса */
  crs: 'EPSG3857' | 'EPSG3395';
  maxZoom: number;
}

/** Плитки: OSM по умолчанию; при провайдере Яндекс и ключе карты — плитки Яндекса */
export function tileConfig(s: Pick<RoutingSettings, 'provider' | 'yandexMapsKey'>): TileConfig {
  if (s.provider === 'yandex' && s.yandexMapsKey)
    return {
      url: `https://tiles.api-maps.yandex.ru/v1/tiles/?lang=ru_RU&x={x}&y={y}&z={z}&l=map&apikey=${encodeURIComponent(s.yandexMapsKey)}`,
      attribution: '&copy; Яндекс',
      crs: 'EPSG3395',
      maxZoom: 19,
    };
  return { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap', crs: 'EPSG3857', maxZoom: 19 };
}

/* ---------------- оркестрация поверх адаптера ---------------- */

export type RouteSource = 'provider' | 'straight';

export interface OptimizeInput {
  start: GeoPoint | null;
  stops: OrderStop[];
  startMin: number;
  reorder: boolean;
  settings: RoutingSettings;
  kind: 'city' | 'intercity';
  /** Дата первого дня рейса — для провайдеров с календарём */
  date: string;
}
export interface OptimizeResult {
  /** Идентификаторы точек в порядке объезда */
  order: string[];
  legs: Leg[];
  eta: EtaResult;
  routeKm: number;
  routeMin: number;
  source: RouteSource;
  /** Провайдер был, но ответил ошибкой — расчёт сделан по прямой */
  warning: string | null;
}

const speedOf = (s: RoutingSettings, kind: 'city' | 'intercity') => (kind === 'intercity' ? s.roadSpeedKmh : s.citySpeedKmh);

/** Порядок точек рейса и время прибытия. Провайдер недоступен или без нужной возможности — расчёт по прямой, причина в `warning` */
export async function optimizeStops(adapter: RoutingAdapter | null, inp: OptimizeInput): Promise<OptimizeResult> {
  const { stops, settings } = inp;
  const speed = speedOf(settings, inp.kind);
  let order = stops.map(s => s.id);
  let warning: string | null = null;
  let source: RouteSource = 'straight';

  if (inp.reorder) {
    let solved: string[] | null = null;
    const geo = stops.filter(s => s.location);
    if (adapter?.solve && geo.length > 1 && inp.kind === 'city') {
      try {
        const sol = await adapter.solve({
          date: inp.date,
          depot: inp.start,
          vehicles: [{ id: 'v', start: inp.start, capacityKg: null, capacityM3: null, capacityPallets: null, fromMin: inp.startMin, toMin: 1440 }],
          jobs: geo.map(s => ({ id: s.id, location: s.location, serviceMin: s.serviceMin, weightKg: 0, volumeM3: 0, pallets: 0, windowFromMin: s.windowFromMin, windowToMin: s.windowToMin })),
        });
        const r = sol.routes[0]?.jobIds ?? [];
        // точки, которые провайдер не взял, и точки без координат — в конец в прежнем порядке
        const rest = stops.map(s => s.id).filter(id => !r.includes(id));
        solved = [...r, ...rest];
        source = 'provider';
      } catch (e) {
        warning = e instanceof Error ? e.message : String(e);
      }
    }
    order = solved ?? orderGreedy(stops, inp.start, inp.startMin, speed);
  }

  const byId = new Map(stops.map(s => [s.id, s]));
  const ordered = order.map(id => byId.get(id)!);
  const pts: GeoPoint[] = [];
  const idx: (number | null)[] = ordered.map(s => (s.location ? pts.push(s.location) - 1 : null));
  let startIdx: number | null = null;
  if (inp.start) startIdx = pts.push(inp.start) - 1;
  else startIdx = idx.find(i => i !== null) ?? null;
  let matrix: Matrix | null = null;
  if (adapter?.matrix && pts.length > 1) {
    try {
      matrix = await adapter.matrix(pts);
      source = 'provider';
    } catch (e) {
      warning = warning ?? (e instanceof Error ? e.message : String(e));
    }
  }
  if (!matrix) matrix = straightMatrix(pts, speed);
  // выезд без базы: первая точка — сразу на месте (участок 0), следующие считаются от неё
  const legs = legsOf(matrix, idx, startIdx).map((l, i) => (!inp.start && idx[i] === startIdx && i === idx.findIndex(x => x !== null) ? { min: 0, km: 0 } : l));
  const etaStops: EtaStop[] = ordered.map((s, i) => ({ legMin: legs[i]!.min, serviceMin: s.serviceMin, dayOffset: s.dayOffset, windowFromMin: s.windowFromMin, windowToMin: s.windowToMin }));
  const eta = computeEta(inp.startMin, etaStops, hhmmToMin(settings.dayStart) ?? 540);
  const routeKm = Math.round(legs.reduce((a, l) => a + (l.km ?? 0), 0) * 10) / 10;
  const routeMin = legs.reduce((a, l) => a + (l.min ?? 0), 0);
  return { order, legs, eta, routeKm, routeMin, source, warning };
}

export interface DistributeResult {
  solution: VrpSolution;
  source: RouteSource;
  warning: string | null;
}

/** Распределение доставок по машинам: решает провайдер (VRP), при ошибке или без провайдера — жадный подбор */
export async function distributeJobs(adapter: RoutingAdapter | null, problem: VrpProblem, settings: RoutingSettings): Promise<DistributeResult> {
  if (adapter?.solve) {
    const withGeo = { ...problem, jobs: problem.jobs.filter(j => j.location) };
    const noGeo = problem.jobs.filter(j => !j.location);
    try {
      const sol = await adapter.solve(withGeo);
      // точки без координат провайдеру не отдаются — добавляются в конец наименее загруженных маршрутов
      const routes = sol.routes.map(r => ({ ...r, jobIds: [...r.jobIds] }));
      const unassigned = [...sol.unassigned];
      for (const j of noGeo) {
        const r = [...routes].sort((a, b) => a.jobIds.length - b.jobIds.length)[0];
        if (r) r.jobIds.push(j.id);
        else unassigned.push(j.id);
      }
      return { solution: { routes, unassigned }, source: 'provider', warning: null };
    } catch (e) {
      return { solution: solveGreedy(problem, settings.citySpeedKmh), source: 'straight', warning: e instanceof Error ? e.message : String(e) };
    }
  }
  return { solution: solveGreedy(problem, settings.citySpeedKmh), source: 'straight', warning: null };
}
