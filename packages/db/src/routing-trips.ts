/* «Распределить» и «Оптимизировать порядок» (задача 1213; docs/architecture/routing.md). API создаёт запуск (fleet_routing_runs) и ставит задачу
   в очередь; воркер выполняет её в три шага: чтение данных (короткая транзакция) → расчёт у провайдера (без транзакции, сеть) → запись
   рейсов и точек через обычные сервисы рейсов (занятость, вместимость, синхронизация доставок остаются в силе). */
import { and, desc, eq, inArray, lte, gte, ne } from 'drizzle-orm';
import {
  daysBetween,
  distributeJobs,
  hhmmToMin,
  optimizeStops,
  type GeoPoint,
  type OptimizeResult,
  type OrderStop,
  type RoutingAdapter,
  type RoutingSettings,
  type VrpJob,
  type VrpVehicle,
} from '@gr8r/shared';
import type { Db, Sql } from './client';
import { withContext } from './context';
import { DomainError } from './errors';
import { recordEvent } from './events';
import type { DocCtx } from './documents';
import { DISTRIBUTE_JOB, OPTIMIZE_JOB, loadAdapter, loadRoutingSettings } from './routing';
import { addStop, createTrip, deleteTrip, dispatchBoard, reorderStops } from './trips';
import { fleetRoutingRuns, fleetTripStops, fleetTrips, jobs, members, type RoutingRunSummary } from './schema';

export type RoutingRunRow = typeof fleetRoutingRuns.$inferSelect;

const num = (v: string | null | undefined): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const geoOf = (lat: string | null, lon: string | null): GeoPoint | null => (lat !== null && lon !== null ? { lat: Number(lat), lon: Number(lon) } : null);
const depotOf = (s: RoutingSettings): GeoPoint | null => (s.depotLat !== null && s.depotLon !== null ? { lat: s.depotLat, lon: s.depotLon } : null);
const RUN_END_MIN = 22 * 60;

async function runEvent(db: Db, run: RoutingRunRow, action: string) {
  await recordEvent(db, { workspaceId: run.workspaceId, type: `fleet_routing_run.${action}`, entity: 'fleet_routing_run', recordId: run.id, actorId: run.requestedBy, payload: { kind: run.kind, status: run.status } });
}

/* ---------------- запуск из API ---------------- */

export async function startDistribute(db: Db, ctx: DocCtx, input: { date: string; vehicleIds?: string[] }): Promise<RoutingRunRow> {
  const [busy] = await db.select({ id: fleetRoutingRuns.id }).from(fleetRoutingRuns).where(and(eq(fleetRoutingRuns.kind, 'distribute'), eq(fleetRoutingRuns.date, input.date), inArray(fleetRoutingRuns.status, ['queued', 'running']))).limit(1);
  if (busy) throw new DomainError(409, 'routing_run_busy', 'A distribution for this day is already running', { runId: busy.id });
  const [run] = await db.insert(fleetRoutingRuns).values({ workspaceId: ctx.workspaceId, kind: 'distribute', date: input.date, requestedBy: ctx.memberId }).returning();
  await db.insert(jobs).values({ workspaceId: ctx.workspaceId, type: DISTRIBUTE_JOB, payload: { runId: run!.id, vehicleIds: input.vehicleIds ?? null }, maxAttempts: 1 });
  await runEvent(db, run!, 'created');
  return run!;
}

export async function startOptimize(db: Db, ctx: DocCtx, tripId: string, reorder: boolean): Promise<RoutingRunRow> {
  const [t] = await db.select().from(fleetTrips).where(eq(fleetTrips.id, tripId)).limit(1);
  if (!t) throw new DomainError(404, 'not_found', 'trip not found');
  if (t.status === 'done' || t.status === 'cancelled') throw new DomainError(409, 'trip_closed', 'A finished or cancelled trip cannot be changed');
  if (reorder && t.status !== 'planned') throw new DomainError(409, 'trip_not_planned', 'The order can be optimized in a planned trip only');
  const [busy] = await db.select({ id: fleetRoutingRuns.id }).from(fleetRoutingRuns).where(and(eq(fleetRoutingRuns.tripId, tripId), inArray(fleetRoutingRuns.status, ['queued', 'running']))).limit(1);
  if (busy) throw new DomainError(409, 'routing_run_busy', 'The route of this trip is already being calculated', { runId: busy.id });
  const [run] = await db.insert(fleetRoutingRuns).values({ workspaceId: ctx.workspaceId, kind: 'optimize', date: t.dateFrom, tripId, requestedBy: ctx.memberId }).returning();
  await db.insert(jobs).values({ workspaceId: ctx.workspaceId, type: OPTIMIZE_JOB, payload: { runId: run!.id, reorder }, maxAttempts: 1 });
  await runEvent(db, run!, 'created');
  return run!;
}

export async function listRuns(db: Db, q: { date?: string; tripId?: string; limit?: number }): Promise<RoutingRunRow[]> {
  return db
    .select()
    .from(fleetRoutingRuns)
    .where(and(q.date ? eq(fleetRoutingRuns.date, q.date) : undefined, q.tripId ? eq(fleetRoutingRuns.tripId, q.tripId) : undefined, q.tripId ? undefined : eq(fleetRoutingRuns.kind, 'distribute')))
    .orderBy(desc(fleetRoutingRuns.createdAt))
    .limit(q.limit ?? 5);
}

export async function getRun(db: Db, id: string): Promise<RoutingRunRow> {
  const [r] = await db.select().from(fleetRoutingRuns).where(eq(fleetRoutingRuns.id, id)).limit(1);
  if (!r) throw new DomainError(404, 'not_found', 'run not found');
  return r;
}

/* ---------------- запись маршрута рейса ---------------- */

interface StopRoute {
  legKm: number | null;
  legMin: number | null;
  etaMin: number;
  late: boolean;
}

/** Участки, ETA и итоги рейса по результату расчёта; ключ — id точки */
function routeByStop(order: string[], r: OptimizeResult): Map<string, StopRoute> {
  return new Map(order.map((id, i) => [id, { legKm: r.legs[i]!.km, legMin: r.legs[i]!.min, etaMin: Math.round(r.eta.arriveMin[i]!), late: r.eta.late[i]! }]));
}

async function writeRoute(db: Db, tripId: string, perStop: Map<string, StopRoute>, totals: { km: number; min: number; source: 'provider' | 'straight' }): Promise<void> {
  for (const [stopId, v] of perStop)
    await db.update(fleetTripStops).set({ legKm: v.legKm === null ? null : v.legKm.toFixed(1), legMin: v.legMin, etaMin: v.etaMin, etaLate: v.late }).where(eq(fleetTripStops.id, stopId));
  await db.update(fleetTrips).set({ routeKm: totals.km.toFixed(1), routeMin: totals.min, routeSource: totals.source, routedAt: new Date() }).where(eq(fleetTrips.id, tripId));
}

/* ---------------- выполнение (воркер) ---------------- */

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);

/** Выполняет запуск. Статус ведёт сам: ошибка записывается в запуск и не повторяется (повтор создал бы рейсы дважды) */
export async function executeRoutingRun(sql: Sql, workspaceId: string, runId: string, opts: { vehicleIds?: string[] | null; reorder?: boolean } = {}): Promise<void> {
  const run = await withContext(sql, { workspaceId }, async db => {
    const [r] = await db.select().from(fleetRoutingRuns).where(eq(fleetRoutingRuns.id, runId)).for('update').limit(1);
    if (!r || r.status !== 'queued') return null;
    const [u] = await db.update(fleetRoutingRuns).set({ status: 'running' }).where(eq(fleetRoutingRuns.id, runId)).returning();
    await runEvent(db, u!, 'started');
    return u!;
  });
  if (!run) return;
  try {
    const out = run.kind === 'distribute' ? await distribute(sql, run, opts.vehicleIds ?? null) : await optimize(sql, run, opts.reorder !== false);
    await withContext(sql, { workspaceId }, async db => {
      const [u] = await db.update(fleetRoutingRuns).set({ status: 'done', source: out.source, warning: out.warning, summary: out.summary, finishedAt: new Date() }).where(eq(fleetRoutingRuns.id, runId)).returning();
      await runEvent(db, u!, 'finished');
    });
  } catch (e) {
    await withContext(sql, { workspaceId }, async db => {
      const [u] = await db.update(fleetRoutingRuns).set({ status: 'failed', error: e instanceof DomainError ? e.code : msg(e), finishedAt: new Date() }).where(eq(fleetRoutingRuns.id, runId)).returning();
      await runEvent(db, u!, 'finished');
    });
  }
}

interface RunOut {
  source: 'provider' | 'straight';
  warning: string | null;
  summary: RoutingRunSummary;
}

const docCtx = (run: RoutingRunRow): DocCtx => ({ workspaceId: run.workspaceId, memberId: run.requestedBy, role: 'member' });

async function distribute(sql: Sql, run: RoutingRunRow, only: string[] | null): Promise<RunOut> {
  const date = run.date;
  // 1. данные
  const data = await withContext(sql, { workspaceId: run.workspaceId }, async db => {
    const ctx = docCtx(run);
    const board = await dispatchBoard(db, ctx, date);
    const settings = await loadRoutingSettings(db, run.workspaceId);
    const adapter = await loadAdapter(db, run.workspaceId, settings);
    const busy = await db
      .select({ vehicleId: fleetTrips.vehicleId, driver: fleetTrips.driverMemberId, co: fleetTrips.coDriverMemberId })
      .from(fleetTrips)
      .where(and(lte(fleetTrips.dateFrom, date), gte(fleetTrips.dateTo, date), inArray(fleetTrips.status, ['planned', 'in_transit'])));
    const inactive = new Set((await db.select({ id: members.id }).from(members).where(ne(members.status, 'active'))).map(m => m.id));
    return { board, settings, adapter, busyVehicles: new Set(busy.map(b => b.vehicleId)), busyDrivers: new Set(busy.flatMap(b => [b.driver, b.co])), inactive };
  });
  const { board, settings, adapter } = data;
  const skipped: RoutingRunSummary['skippedVehicles'] = [];
  const usedDrivers = new Set<string>();
  const vehicles: (VrpVehicle & { driverMemberId: string })[] = [];
  const depot = depotOf(settings);
  const dayStart = hhmmToMin(settings.dayStart) ?? 540;
  for (const v of board.vehicles) {
    if (only && !only.includes(v.id)) continue;
    const reason = !v.driverMemberId ? 'no_driver' : data.busyVehicles.has(v.id) ? 'vehicle_busy' : data.inactive.has(v.driverMemberId) ? 'driver_inactive' : data.busyDrivers.has(v.driverMemberId) || usedDrivers.has(v.driverMemberId) ? 'driver_busy' : null;
    if (reason) {
      skipped.push({ vehicleId: v.id, reason });
      continue;
    }
    usedDrivers.add(v.driverMemberId!);
    vehicles.push({ id: v.id, driverMemberId: v.driverMemberId!, start: depot, capacityKg: num(v.capacityKg), capacityM3: num(v.volumeM3), capacityPallets: v.pallets, fromMin: dayStart, toMin: RUN_END_MIN });
  }
  const jobsIn: VrpJob[] = board.unassigned.map(d => ({
    id: d.id,
    location: geoOf(d.lat, d.lon),
    serviceMin: settings.serviceMinutes,
    weightKg: Number(d.weightKg),
    volumeM3: 0,
    pallets: 0,
    windowFromMin: hhmmToMin(d.windowFrom),
    windowToMin: hhmmToMin(d.windowTo),
  }));
  const empty = (reason: string): RunOut => ({ source: 'straight', warning: null, summary: { tripIds: [], stops: 0, unassigned: jobsIn.map(j => ({ deliveryId: j.id, reason })), skippedVehicles: skipped } });
  if (!jobsIn.length) return { ...empty('none'), summary: { tripIds: [], stops: 0, unassigned: [], skippedVehicles: skipped } };
  if (!vehicles.length) return empty('no_vehicle');

  // 2. расчёт (сеть, без транзакции)
  const solved = await distributeJobs(adapter, { date, depot, vehicles, jobs: jobsIn }, settings);
  const jobById = new Map(jobsIn.map(j => [j.id, j]));
  const routes: { vehicle: (typeof vehicles)[number]; jobIds: string[]; result: OptimizeResult }[] = [];
  let warning = solved.warning;
  for (const r of solved.solution.routes) {
    const vehicle = vehicles.find(v => v.id === r.vehicleId);
    if (!vehicle || !r.jobIds.length) continue;
    const stops: OrderStop[] = r.jobIds.map(id => {
      const j = jobById.get(id)!;
      return { id, location: j.location, serviceMin: j.serviceMin, dayOffset: 0, windowFromMin: j.windowFromMin, windowToMin: j.windowToMin };
    });
    const result = await optimizeStops(adapter, { start: depot, stops, startMin: dayStart, reorder: false, settings, kind: 'city', date });
    warning = warning ?? result.warning;
    routes.push({ vehicle, jobIds: r.jobIds, result });
  }

  // 3. запись
  const summary = await withContext(sql, { workspaceId: run.workspaceId }, async db => {
    const ctx = docCtx(run);
    const out: RoutingRunSummary = { tripIds: [], stops: 0, unassigned: solved.solution.unassigned.map(id => ({ deliveryId: id, reason: 'no_fit' })), skippedVehicles: skipped };
    for (const r of routes) {
      let trip;
      try {
        trip = await createTrip(db, ctx, { kind: 'city', dateFrom: date, vehicleId: r.vehicle.id, driverMemberId: r.vehicle.driverMemberId });
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        skipped.push({ vehicleId: r.vehicle.id, reason: e.code });
        for (const id of r.jobIds) out.unassigned.push({ deliveryId: id, reason: e.code });
        continue;
      }
      const added = new Map<string, string>(); // id доставки → id точки
      for (const id of r.jobIds) {
        try {
          const s = await addStop(db, ctx, trip.id, { sourceKind: 'delivery', deliveryId: id });
          added.set(id, s.id);
        } catch (e) {
          if (!(e instanceof DomainError)) throw e;
          out.unassigned.push({ deliveryId: id, reason: e.code });
        }
      }
      if (!added.size) {
        await deleteTrip(db, ctx, trip.id);
        continue;
      }
      const per = routeByStop(r.jobIds, r.result);
      const byStop = new Map<string, StopRoute>();
      for (const [delId, stopId] of added) byStop.set(stopId, per.get(delId)!);
      await writeRoute(db, trip.id, byStop, { km: r.result.routeKm, min: r.result.routeMin, source: r.result.source });
      out.tripIds.push(trip.id);
      out.stops += added.size;
    }
    return out;
  });
  return { source: solved.source, warning, summary };
}

async function optimize(sql: Sql, run: RoutingRunRow, reorder: boolean): Promise<RunOut> {
  const tripId = run.tripId!;
  const data = await withContext(sql, { workspaceId: run.workspaceId }, async db => {
    const [trip] = await db.select().from(fleetTrips).where(eq(fleetTrips.id, tripId)).limit(1);
    if (!trip) throw new DomainError(404, 'not_found', 'trip not found');
    const stops = await db.select().from(fleetTripStops).where(eq(fleetTripStops.tripId, tripId)).orderBy(fleetTripStops.seq);
    const settings = await loadRoutingSettings(db, run.workspaceId);
    return { trip, stops, settings, adapter: await loadAdapter(db, run.workspaceId, settings) };
  });
  const { trip, stops, settings, adapter } = data;
  if (trip.status === 'done' || trip.status === 'cancelled') throw new DomainError(409, 'trip_closed', 'A finished or cancelled trip cannot be changed');
  if (reorder && trip.status !== 'planned') throw new DomainError(409, 'trip_not_planned', 'The order can be optimized in a planned trip only');
  const startMin = hhmmToMin(trip.startTime) ?? hhmmToMin(settings.dayStart) ?? 540;
  const orderStops: OrderStop[] = stops.map(s => ({ id: s.id, location: geoOf(s.lat, s.lon), serviceMin: settings.serviceMinutes, dayOffset: Math.max(0, daysBetween(trip.dateFrom, s.day)), windowFromMin: hhmmToMin(s.windowFrom), windowToMin: hhmmToMin(s.windowTo) }));
  const result = await optimizeStops(adapter, { start: depotOf(settings), stops: orderStops, startMin, reorder, settings, kind: trip.kind, date: trip.dateFrom });

  const reordered = await withContext(sql, { workspaceId: run.workspaceId }, async db => {
    const ctx = docCtx(run);
    const cur = await db.select({ id: fleetTripStops.id, seq: fleetTripStops.seq }).from(fleetTripStops).where(eq(fleetTripStops.tripId, tripId)).orderBy(fleetTripStops.seq);
    const same = cur.length === stops.length && cur.every((c, i) => c.id === stops[i]!.id);
    if (!same) throw new DomainError(409, 'trip_changed', 'The trip was changed while the route was being calculated');
    const changed = result.order.some((id, i) => id !== stops[i]!.id);
    if (changed) await reorderStops(db, ctx, tripId, result.order);
    await writeRoute(db, tripId, routeByStop(result.order, result), { km: result.routeKm, min: result.routeMin, source: result.source });
    await recordEvent(db, { workspaceId: run.workspaceId, type: 'fleet_trip.updated', entity: 'fleet_trip', recordId: tripId, actorId: run.requestedBy, payload: { number: trip.number, changes: ['route'] } });
    return changed;
  });
  return { source: result.source, warning: result.warning, summary: { tripIds: [tripId], stops: stops.length, unassigned: [], skippedVehicles: [], routeKm: result.routeKm, routeMin: result.routeMin, reordered } };
}

export type { RoutingAdapter };
