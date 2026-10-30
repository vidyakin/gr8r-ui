/* Маршрутизация (задача 1213; docs/architecture/routing.md): настройки провайдера арендатора, защищённый исходящий fetch,
   сборка адаптера (Яндекс | OSRM + VROOM) с ключами из хранилища секретов, геокодирование адресов доставок и точек в фоне.
   Расчёты и сами адаптеры — чистый код в @gr8r/shared (routing.ts, routing-adapters.ts). Рейсы и «Распределить» — routing-trips.ts. */
import { lookup } from 'node:dns/promises';
import { and, eq, inArray, sql as dsql } from 'drizzle-orm';
import {
  ROUTING_SECRETS,
  ROUTING_SETTING,
  RoutingError,
  YANDEX_BASE,
  isForbiddenHostname,
  isIpLiteral,
  isPrivateAddress,
  osrmVroomAdapter,
  tileConfig,
  withSettings,
  yandexAdapter,
  type Fetcher,
  type HttpCall,
  type HttpReply,
  type RoutingAdapter,
  type RoutingSettings,
  type TileConfig,
} from '@gr8r/shared';
import type { Db, Sql } from './client';
import { withContext } from './context';
import { recordEvent } from './events';
import type { DocCtx } from './documents';
import { readSecret, listSecrets } from './secrets';
import { deliveries, fleetTripStops, fleetTrips, jobs, workspaces } from './schema';

export const GEOCODE_JOB = 'routing.geocode';
export const DISTRIBUTE_JOB = 'routing.distribute';
export const OPTIMIZE_JOB = 'routing.optimize';

type Env = Record<string, string | undefined>;

/** Окружение и сеть процесса; тесты подменяют `fetch` фикстурами — наружу запросов нет */
export const routingRuntime: { env: Env; fetch: Fetcher | null; sleep?: (ms: number) => Promise<void> } = { env: process.env, fetch: null };

/* ---------------- настройки ---------------- */

export async function loadRoutingSettings(db: Db, workspaceId: string): Promise<RoutingSettings> {
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return withSettings((ws?.settings as Record<string, unknown> | undefined)?.[ROUTING_SETTING] as Partial<RoutingSettings> | undefined);
}

export async function saveRoutingSettings(db: Db, ctx: DocCtx, input: RoutingSettings): Promise<RoutingSettings> {
  const s = withSettings(input);
  await db.update(workspaces).set({ settings: dsql`${workspaces.settings} || ${JSON.stringify({ [ROUTING_SETTING]: s })}::jsonb`, updatedAt: new Date() }).where(eq(workspaces.id, ctx.workspaceId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'fleet_routing.settings_updated', entity: 'fleet_routing', actorId: ctx.memberId, payload: { provider: s.provider } });
  return s;
}

/** Серверные адреса оператора (ROUTING_*_URL): им доверяем — это его сервисы в той же сети, поэтому частные адреса разрешены */
const serverUrls = (env: Env) => ({ osrm: env.ROUTING_OSRM_URL?.trim() ?? '', vroom: env.ROUTING_VROOM_URL?.trim() ?? '', nominatim: env.ROUTING_NOMINATIM_URL?.trim() ?? '' });

export interface RoutingView {
  /** Для не-admin адреса серверов скрыты */
  settings: RoutingSettings;
  tile: TileConfig;
  secrets: { yandexGeocoder: boolean; yandexRouter: boolean };
  /** Есть ли у провайдера геокодирование / матрица / подбор — интерфейс подсказывает, чего не хватает */
  capabilities: { geocode: boolean; matrix: boolean; solve: boolean };
  /** Серверные сервисы оператора заданы окружением */
  server: { osrm: boolean; vroom: boolean; nominatim: boolean };
}

export async function routingView(db: Db, workspaceId: string, admin: boolean, env: Env = routingRuntime.env): Promise<RoutingView> {
  const s = await loadRoutingSettings(db, workspaceId);
  const names = new Set((await listSecrets(db)).map(x => x.key));
  const srv = serverUrls(env);
  const caps = capabilitiesOf(s, srv, names);
  return {
    settings: admin ? s : { ...s, osrmUrl: '', vroomUrl: '', nominatimUrl: '' },
    tile: tileConfig(s),
    secrets: { yandexGeocoder: names.has(ROUTING_SECRETS.yandexGeocoder), yandexRouter: names.has(ROUTING_SECRETS.yandexRouter) },
    capabilities: caps,
    server: { osrm: !!srv.osrm, vroom: !!srv.vroom, nominatim: !!srv.nominatim },
  };
}

function capabilitiesOf(s: RoutingSettings, srv: ReturnType<typeof serverUrls>, secretNames: Set<string>) {
  if (s.provider === 'yandex') return { geocode: secretNames.has(ROUTING_SECRETS.yandexGeocoder), matrix: secretNames.has(ROUTING_SECRETS.yandexRouter), solve: secretNames.has(ROUTING_SECRETS.yandexRouter) };
  if (s.provider === 'osrm_vroom') return { geocode: !!(s.nominatimUrl || srv.nominatim), matrix: !!(s.osrmUrl || srv.osrm), solve: !!(s.vroomUrl || srv.vroom) };
  return { geocode: false, matrix: false, solve: false };
}

/* ---------------- сеть ---------------- */

type HostKind = 'trusted' | 'public' | 'yandex';

/** Исходящие запросы маршрутизации. Разрешены только хосты из настроек: фиксированные хосты Яндекса (только https), адреса оператора из
    окружения (доверенные) и адрес арендатора — он проходит те же проверки, что вебхуки (http/https, без учётных данных, имя и все адреса
    DNS не частные и не служебные; ROUTING_ALLOW_PRIVATE=1 — только для закрытых установок и тестов). Редиректы не выполняются */
export function routingFetcher(hosts: Map<string, HostKind>, env: Env = routingRuntime.env): Fetcher {
  const allowPrivate = env.ROUTING_ALLOW_PRIVATE === '1';
  const timeoutMs = Number(env.ROUTING_HTTP_TIMEOUT_MS ?? 20_000);
  return async (call: HttpCall): Promise<HttpReply> => {
    let url: URL;
    try {
      url = new URL(call.url);
    } catch {
      throw new RoutingError('permanent', 'Invalid URL');
    }
    const kind = hosts.get(url.host);
    if (!kind) throw new RoutingError('permanent', 'The host is not allowed for routing');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new RoutingError('permanent', 'Only http and https are allowed');
    if (url.username || url.password) throw new RoutingError('permanent', 'Credentials in the URL are not allowed');
    if (kind === 'yandex' && url.protocol !== 'https:' && !allowPrivate) throw new RoutingError('permanent', 'Only https is allowed');
    if (kind !== 'trusted' && !allowPrivate) {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (isIpLiteral(host)) {
        if (isPrivateAddress(host)) throw new RoutingError('permanent', 'Requests to private or local addresses are blocked');
      } else {
        if (isForbiddenHostname(host)) throw new RoutingError('permanent', 'Requests to private or local addresses are blocked');
        let addrs: string[];
        try {
          addrs = (await lookup(host, { all: true })).map(a => a.address);
        } catch {
          throw new RoutingError('transient', `DNS lookup failed for ${host}`);
        }
        if (!addrs.length || addrs.some(isPrivateAddress)) throw new RoutingError('permanent', 'Requests to private or local addresses are blocked');
      }
    }
    let res: Response;
    try {
      res = await fetch(url, { method: call.method, headers: call.headers, body: call.body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const name = (e as Error).name;
      throw new RoutingError('transient', name === 'TimeoutError' || name === 'AbortError' ? 'Request timed out' : `Network error: ${(e as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      throw new RoutingError('permanent', 'Redirects are not followed');
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 20 * 1024 * 1024) throw new RoutingError('permanent', 'The response is too large');
    const text = new TextDecoder().decode(buf);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* не JSON */
    }
    return { status: res.status, json, text };
  };
}

const hostOf = (u: string): string | null => {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
};

/** Адаптер арендатора: ключи Яндекса читаются из хранилища секретов (только внутри серверного кода); нет провайдера — null */
export async function loadAdapter(db: Db, workspaceId: string, settings?: RoutingSettings, env: Env = routingRuntime.env): Promise<RoutingAdapter | null> {
  const s = settings ?? (await loadRoutingSettings(db, workspaceId));
  if (s.provider === 'none') return null;
  if (s.provider === 'yandex') {
    const geocoderKey = (await readSecret(db, workspaceId, ROUTING_SECRETS.yandexGeocoder)) ?? undefined;
    const routerKey = (await readSecret(db, workspaceId, ROUTING_SECRETS.yandexRouter)) ?? undefined;
    const hosts = new Map<string, HostKind>(Object.values(YANDEX_BASE).map(u => [new URL(u).host, 'yandex' as const]));
    return yandexAdapter({ fetch: routingRuntime.fetch ?? routingFetcher(hosts, env), geocoderKey, routerKey, ...(routingRuntime.sleep ? { sleep: routingRuntime.sleep } : {}) });
  }
  const srv = serverUrls(env);
  const hosts = new Map<string, HostKind>();
  const pick = (own: string, server: string) => {
    if (own) {
      const h = hostOf(own);
      if (h) hosts.set(h, hosts.get(h) === 'trusted' ? 'trusted' : 'public');
      return own;
    }
    const h = hostOf(server);
    if (h) hosts.set(h, 'trusted');
    return server;
  };
  const osrmUrl = pick(s.osrmUrl, srv.osrm);
  const vroomUrl = pick(s.vroomUrl, srv.vroom);
  const nominatimUrl = pick(s.nominatimUrl, srv.nominatim);
  if (!osrmUrl && !vroomUrl && !nominatimUrl) return null;
  return osrmVroomAdapter({ fetch: routingRuntime.fetch ?? routingFetcher(hosts, env), osrmUrl, vroomUrl, nominatimUrl });
}

/* ---------------- геокодирование в фоне ---------------- */

export type GeoKind = 'delivery' | 'stop';

/** Можно ли геокодировать при текущих настройках (без обращения к ключам: нет ключа — задача завершится статусом ошибки) */
export function canGeocode(s: RoutingSettings, env: Env = routingRuntime.env): boolean {
  if (s.provider === 'yandex') return true;
  if (s.provider === 'osrm_vroom') return !!(s.nominatimUrl || serverUrls(env).nominatim);
  return false;
}

/** Ставит геокодирование адреса в очередь: строка помечается «в обработке», одинаковая задача не дублируется. Возвращает false, если провайдер не умеет */
export async function requestGeocode(db: Db, workspaceId: string, kind: GeoKind, id: string): Promise<boolean> {
  const s = await loadRoutingSettings(db, workspaceId);
  if (!canGeocode(s)) return false;
  if (kind === 'delivery') await db.update(deliveries).set({ geoStatus: 'pending' }).where(eq(deliveries.id, id));
  else await db.update(fleetTripStops).set({ geoStatus: 'pending' }).where(eq(fleetTripStops.id, id));
  const [busy] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, GEOCODE_JOB), eq(jobs.status, 'queued'), dsql`${jobs.payload}->>'kind' = ${kind}`, dsql`${jobs.payload}->>'id' = ${id}`))
    .limit(1);
  if (!busy) await db.insert(jobs).values({ workspaceId, type: GEOCODE_JOB, payload: { kind, id } });
  return true;
}

const coord = (n: number) => n.toFixed(6);

/** Сбрасывает расчёт маршрута рейсов: порядок или адреса изменились, ETA и участки устарели */
export async function clearRoute(db: Db, tripIds: string[]): Promise<void> {
  if (!tripIds.length) return;
  await db.update(fleetTripStops).set({ legKm: null, legMin: null, etaMin: null, etaLate: false }).where(and(inArray(fleetTripStops.tripId, tripIds), dsql`(${fleetTripStops.etaMin} is not null or ${fleetTripStops.legMin} is not null)`));
  await db.update(fleetTrips).set({ routeKm: null, routeMin: null, routeSource: null, routedAt: null }).where(and(inArray(fleetTrips.id, tripIds), dsql`${fleetTrips.routedAt} is not null`));
}

/** Координаты доставки, заданные вручную, переходят в её точки рейсов */
export async function syncStopCoords(db: Db, deliveryId: string, lat: string | null, lon: string | null): Promise<void> {
  const stops = await db
    .update(fleetTripStops)
    .set({ lat, lon, geoSource: lat && lon ? 'manual' : null, geoStatus: lat && lon ? 'ok' : null, updatedAt: new Date() })
    .where(eq(fleetTripStops.deliveryId, deliveryId))
    .returning({ tripId: fleetTripStops.tripId });
  await clearRoute(db, [...new Set(stops.map(x => x.tripId))]);
}

/** Задача routing.geocode: адрес → координаты. Ручные координаты не перезаписываются; адрес, изменившийся за время запроса, пропускается
    (его геокодирует следующая задача). `final` — последняя попытка: временный сбой превращается в статус ошибки */
export async function runGeocode(sql: Sql, workspaceId: string, kind: GeoKind, id: string, final: boolean): Promise<void> {
  const prep = await withContext(sql, { workspaceId }, async db => {
    const row =
      kind === 'delivery'
        ? (await db.select({ address: deliveries.address, geoSource: deliveries.geoSource }).from(deliveries).where(eq(deliveries.id, id)).limit(1))[0]
        : (await db.select({ address: fleetTripStops.address, geoSource: fleetTripStops.geoSource }).from(fleetTripStops).where(eq(fleetTripStops.id, id)).limit(1))[0];
    if (!row || row.geoSource === 'manual' || !row.address.trim()) return null;
    const s = await loadRoutingSettings(db, workspaceId);
    return { address: row.address, adapter: canGeocode(s) ? await loadAdapter(db, workspaceId, s) : null };
  });
  if (!prep) return;
  let status: 'ok' | 'approx' | 'not_found' | 'error' = 'error';
  let point: { lat: number; lon: number } | null = null;
  if (prep.adapter?.geocode) {
    try {
      const r = await prep.adapter.geocode(prep.address);
      if (r) {
        point = { lat: r.lat, lon: r.lon };
        status = r.quality === 'exact' ? 'ok' : 'approx';
      } else status = 'not_found';
    } catch (e) {
      if (e instanceof RoutingError && e.kind === 'transient' && !final) throw e;
      status = 'error';
    }
  }
  await withContext(sql, { workspaceId }, async db => {
    const now = new Date();
    if (kind === 'delivery') {
      const [cur] = await db.select({ address: deliveries.address, geoSource: deliveries.geoSource }).from(deliveries).where(eq(deliveries.id, id)).limit(1);
      if (!cur || cur.geoSource === 'manual' || cur.address !== prep.address) return;
      await db
        .update(deliveries)
        .set({ lat: point ? coord(point.lat) : null, lon: point ? coord(point.lon) : null, geoSource: point ? 'geocoder' : null, geoStatus: status })
        .where(eq(deliveries.id, id));
      // точки рейсов этой доставки получают те же координаты (если не заданы вручную)
      const stops = await db.select({ id: fleetTripStops.id, tripId: fleetTripStops.tripId, geoSource: fleetTripStops.geoSource }).from(fleetTripStops).where(eq(fleetTripStops.deliveryId, id));
      const upd = stops.filter(x => x.geoSource !== 'manual');
      if (upd.length) {
        await db
          .update(fleetTripStops)
          .set({ lat: point ? coord(point.lat) : null, lon: point ? coord(point.lon) : null, geoSource: point ? 'geocoder' : null, geoStatus: status, updatedAt: now })
          .where(inArray(fleetTripStops.id, upd.map(x => x.id)));
        await clearRoute(db, [...new Set(upd.map(x => x.tripId))]);
        await recordEvent(db, { workspaceId, type: 'fleet_trip.updated', entity: 'fleet_trip', recordId: upd[0]!.tripId, payload: { changes: ['geocode'] } });
      }
      await recordEvent(db, { workspaceId, type: 'delivery.geocoded', entity: 'delivery', recordId: id, payload: { status } });
    } else {
      const [cur] = await db.select({ address: fleetTripStops.address, geoSource: fleetTripStops.geoSource, tripId: fleetTripStops.tripId }).from(fleetTripStops).where(eq(fleetTripStops.id, id)).limit(1);
      if (!cur || cur.geoSource === 'manual' || cur.address !== prep.address) return;
      await db
        .update(fleetTripStops)
        .set({ lat: point ? coord(point.lat) : null, lon: point ? coord(point.lon) : null, geoSource: point ? 'geocoder' : null, geoStatus: status, updatedAt: now })
        .where(eq(fleetTripStops.id, id));
      await clearRoute(db, [cur.tripId]);
      await recordEvent(db, { workspaceId, type: 'fleet_trip.updated', entity: 'fleet_trip', recordId: cur.tripId, payload: { changes: ['geocode'] } });
    }
  });
}
