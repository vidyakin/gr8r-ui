/* Рейсы (задача 1211; docs/architecture/trips.md): рейс = машина + водитель(и) + период + точки в порядке объезда. Контроль вместимости
   (предупреждение или запрет — настройка воркспейса), временные окна, статусы план → в пути → выполнен / отменён, путевой лист из рейса,
   синхронизация с доставками (курьер, статус), экран диспетчера. Расчёты нагрузки и расстояния — чистые функции из @gr8r/shared (trips.ts). */
import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';
import {
  TRIP_CAPACITY_SETTING,
  dec,
  fmt,
  deliveryStatusOfStop,
  routeStraightKm,
  tripOverloads,
  tripPeakLoad,
  tripsOverlap,
  windowOrderConflicts,
  type Overload,
  type RouteSheetPrintData,
  type TripCapacityMode,
  type TripLoad,
  type VehicleLimits,
} from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { changeDeliveryStatus, listDeliveries, type DeliveryView } from './delivery';
import type { DocCtx } from './documents';
import { clearRoute, requestGeocode } from './routing';
import { assertMember, createWaybill, loadVehicle, nextNumber, type WaybillRow } from './fleet';
import { deliveries, documents, fleetTripStops, fleetTrips, fleetVehicles, fleetWaybills, members, workspaces } from './schema';

export type TripRow = typeof fleetTrips.$inferSelect;
export type TripStopRow = typeof fleetTripStops.$inferSelect;

const notFound = (what: string) => new DomainError(404, 'not_found', `${what} not found`);
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

async function event(db: Db, ctx: DocCtx, entity: string, action: string, id: string, payload: Record<string, unknown> = {}) {
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: `${entity}.${action}`, entity, recordId: id, actorId: ctx.memberId, payload });
}

/* ---------------- настройка ---------------- */

export async function tripCapacityMode(db: Db, workspaceId: string): Promise<TripCapacityMode> {
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return ws?.settings?.[TRIP_CAPACITY_SETTING] === 'block' ? 'block' : 'warn';
}

export async function saveTripSettings(db: Db, ctx: DocCtx, capacityMode: TripCapacityMode): Promise<{ capacityMode: TripCapacityMode }> {
  await db.update(workspaces).set({ settings: sql`${workspaces.settings} || ${JSON.stringify({ [TRIP_CAPACITY_SETTING]: capacityMode })}::jsonb`, updatedAt: new Date() }).where(eq(workspaces.id, ctx.workspaceId));
  return { capacityMode };
}

/* ---------------- загрузка ---------------- */

async function loadTrip(db: Db, id: string, lock = false): Promise<TripRow> {
  const q = db.select().from(fleetTrips).where(eq(fleetTrips.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw notFound('trip');
  return row;
}

async function loadStops(db: Db, tripId: string): Promise<TripStopRow[]> {
  return db.select().from(fleetTripStops).where(eq(fleetTripStops.tripId, tripId)).orderBy(asc(fleetTripStops.seq), asc(fleetTripStops.createdAt));
}

const limitsOf = (v: { capacityKg: string | null; volumeM3: string | null; pallets: number | null }): VehicleLimits => ({ capacityKg: v.capacityKg, volumeM3: v.volumeM3, pallets: v.pallets });

function loadOf(stops: TripStopRow[]): { load: TripLoad; overloadsOf: (l: VehicleLimits) => Overload[] } {
  const load = tripPeakLoad(stops.map(s => ({ seq: s.seq, kind: s.kind, weightKg: s.weightKg, volumeM3: s.volumeM3, pallets: s.pallets })));
  return { load, overloadsOf: l => tripOverloads(load, l) };
}

function assertOpen(t: TripRow): void {
  if (t.status === 'done' || t.status === 'cancelled') throw new DomainError(409, 'trip_closed', 'A finished or cancelled trip cannot be changed');
}

/** Машина и водитель свободны на период рейса: рейсы без времени занимают весь день */
async function assertFree(db: Db, t: { id?: string; dateFrom: string; dateTo: string; startTime?: string | null; endTime?: string | null; vehicleId: string; driverMemberId: string; coDriverMemberId?: string | null }): Promise<void> {
  const people = [t.driverMemberId, ...(t.coDriverMemberId ? [t.coDriverMemberId] : [])];
  const rows = await db
    .select()
    .from(fleetTrips)
    .where(
      and(
        inArray(fleetTrips.status, ['planned', 'in_transit']),
        t.id ? ne(fleetTrips.id, t.id) : undefined,
        lte(fleetTrips.dateFrom, t.dateTo),
        gte(fleetTrips.dateTo, t.dateFrom),
        or(eq(fleetTrips.vehicleId, t.vehicleId), inArray(fleetTrips.driverMemberId, people), inArray(sql`coalesce(${fleetTrips.coDriverMemberId}, ${fleetTrips.driverMemberId})`, people)),
      ),
    );
  for (const o of rows) {
    if (!tripsOverlap(t, o)) continue;
    if (o.vehicleId === t.vehicleId) throw new DomainError(409, 'trip_vehicle_busy', `The vehicle is busy in trip ${o.number}`, { tripId: o.id, number: o.number });
    throw new DomainError(409, 'trip_driver_busy', `The driver is busy in trip ${o.number}`, { tripId: o.id, number: o.number });
  }
}

async function assertAssignable(db: Db, vehicleId: string, driverId: string, coDriverId?: string | null): Promise<void> {
  const v = await loadVehicle(db, vehicleId);
  if (v.archivedAt) throw new DomainError(422, 'vehicle_archived', 'The vehicle is archived');
  if (v.status !== 'active') throw new DomainError(422, 'vehicle_unavailable', 'The vehicle is in repair or inactive');
  await assertMember(db, driverId);
  await assertMember(db, coDriverId);
  const ids = [driverId, ...(coDriverId ? [coDriverId] : [])];
  const act = await db.select({ id: members.id, status: members.status }).from(members).where(inArray(members.id, ids));
  if (act.some(m => m.status === 'deactivated')) throw new DomainError(422, 'driver_inactive', 'The driver is deactivated');
  if (coDriverId && coDriverId === driverId) throw new DomainError(422, 'invalid_reference', 'The co-driver is the driver');
}

/** Проверка вместимости после изменения точек: запрет — по настройке, иначе предупреждение остаётся в карточке */
async function enforceCapacity(db: Db, ctx: DocCtx, t: TripRow): Promise<void> {
  const mode = await tripCapacityMode(db, ctx.workspaceId);
  if (mode !== 'block') return;
  const v = await loadVehicle(db, t.vehicleId);
  const over = loadOf(await loadStops(db, t.id)).overloadsOf(limitsOf(v));
  if (over.length) throw new DomainError(422, 'trip_overloaded', 'The load exceeds the capacity of the vehicle', { overloads: over });
}

/* ---------------- рейс ---------------- */

export interface TripInput {
  kind?: TripRow['kind'];
  name?: string;
  dateFrom: string;
  dateTo?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  vehicleId: string;
  driverMemberId: string;
  coDriverMemberId?: string | null;
  comment?: string;
}

function span(kind: TripRow['kind'], dateFrom: string, dateTo: string | null | undefined): string {
  const to = kind === 'city' ? dateFrom : (dateTo ?? dateFrom);
  if (to < dateFrom) throw new DomainError(422, 'trip_dates_invalid', 'The trip ends before it starts');
  return to;
}

export async function createTrip(db: Db, ctx: DocCtx, input: TripInput): Promise<TripRow> {
  const kind = input.kind ?? 'city';
  const dateTo = span(kind, input.dateFrom, input.dateTo);
  if (input.startTime && input.endTime && dateTo === input.dateFrom && input.endTime <= input.startTime) throw new DomainError(422, 'trip_dates_invalid', 'The trip ends before it starts');
  await assertAssignable(db, input.vehicleId, input.driverMemberId, input.coDriverMemberId);
  await assertFree(db, { ...input, dateTo });
  const number = await nextNumber(db, ctx.workspaceId, 'fleet_trips', 'РС', input.dateFrom);
  const [row] = await db
    .insert(fleetTrips)
    .values({
      workspaceId: ctx.workspaceId,
      number,
      kind,
      name: input.name ?? '',
      dateFrom: input.dateFrom,
      dateTo,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      vehicleId: input.vehicleId,
      driverMemberId: input.driverMemberId,
      coDriverMemberId: input.coDriverMemberId ?? null,
      comment: input.comment ?? '',
    })
    .returning();
  await event(db, ctx, 'fleet_trip', 'created', row!.id, { number });
  return row!;
}

/** Правка рейса. Машину, водителя, вид и даты меняет только план; в пути — название, время и комментарий.
    Смена водителя переносит курьера на доставки рейса */
export async function updateTrip(db: Db, ctx: DocCtx, id: string, input: Partial<TripInput>): Promise<TripRow> {
  const cur = await loadTrip(db, id, true);
  assertOpen(cur);
  const structural = input.kind !== undefined || input.dateFrom !== undefined || input.dateTo !== undefined || input.vehicleId !== undefined || input.driverMemberId !== undefined || input.coDriverMemberId !== undefined;
  if (structural && cur.status !== 'planned') throw new DomainError(409, 'trip_not_planned', 'The vehicle, driver and dates can be changed in a planned trip only');
  const next = {
    kind: input.kind ?? cur.kind,
    dateFrom: input.dateFrom ?? cur.dateFrom,
    vehicleId: input.vehicleId ?? cur.vehicleId,
    driverMemberId: input.driverMemberId ?? cur.driverMemberId,
    coDriverMemberId: input.coDriverMemberId !== undefined ? input.coDriverMemberId : cur.coDriverMemberId,
    startTime: input.startTime !== undefined ? input.startTime : cur.startTime,
    endTime: input.endTime !== undefined ? input.endTime : cur.endTime,
  };
  const dateTo = span(next.kind, next.dateFrom, input.dateTo !== undefined ? input.dateTo : cur.dateTo);
  if (structural) {
    await assertAssignable(db, next.vehicleId, next.driverMemberId, next.coDriverMemberId);
    await assertFree(db, { id, ...next, dateTo });
  }
  const [row] = await db
    .update(fleetTrips)
    .set({
      kind: next.kind,
      name: input.name ?? cur.name,
      dateFrom: next.dateFrom,
      dateTo,
      startTime: next.startTime ?? null,
      endTime: next.endTime ?? null,
      vehicleId: next.vehicleId,
      driverMemberId: next.driverMemberId,
      coDriverMemberId: next.coDriverMemberId ?? null,
      comment: input.comment ?? cur.comment,
      updatedAt: new Date(),
    })
    .where(eq(fleetTrips.id, id))
    .returning();
  if (next.driverMemberId !== cur.driverMemberId) {
    await db.update(deliveries).set({ courierMemberId: next.driverMemberId, updatedAt: new Date() }).where(inArray(deliveries.id, db.select({ id: fleetTripStops.deliveryId }).from(fleetTripStops).where(and(eq(fleetTripStops.tripId, id), sql`${fleetTripStops.deliveryId} is not null`, inArray(fleetTripStops.status, ['planned', 'arrived'])))));
  }
  if (next.dateFrom !== cur.dateFrom || dateTo !== cur.dateTo) {
    // точки вне нового периода переезжают на его границы
    await db.update(fleetTripStops).set({ day: sql`least(greatest(${fleetTripStops.day}, ${next.dateFrom}::date), ${dateTo}::date)` }).where(eq(fleetTripStops.tripId, id));
  }
  if (next.vehicleId !== cur.vehicleId) await enforceCapacity(db, ctx, row!);
  await event(db, ctx, 'fleet_trip', 'updated', id, { number: cur.number, changes: Object.keys(input) });
  return row!;
}

/** Удаление: только план; доставки освобождаются */
export async function deleteTrip(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const t = await loadTrip(db, id, true);
  if (t.status !== 'planned') throw new DomainError(409, 'trip_not_planned', 'Only a planned trip can be deleted; cancel it instead');
  await releaseDeliveries(db, ctx, await loadStops(db, id));
  await db.delete(fleetTrips).where(eq(fleetTrips.id, id));
  await event(db, ctx, 'fleet_trip', 'deleted', id, { number: t.number });
}

/** Доставки точек, не доставленные до конца, возвращаются в «новая» без курьера (кроме завершённых) */
async function releaseDeliveries(db: Db, ctx: DocCtx, stops: TripStopRow[]): Promise<void> {
  for (const s of stops) {
    if (!s.deliveryId || s.status === 'done' || s.status === 'failed') continue;
    const [d] = await db.select({ status: deliveries.status }).from(deliveries).where(eq(deliveries.id, s.deliveryId)).limit(1);
    if (!d || d.status === 'delivered' || d.status === 'failed') continue;
    await db.update(deliveries).set({ courierMemberId: null, status: 'new', updatedAt: new Date() }).where(eq(deliveries.id, s.deliveryId));
    await event(db, ctx, 'delivery', 'updated', s.deliveryId, { changes: ['courierMemberId', 'status'] });
  }
}

export async function startTrip(db: Db, ctx: DocCtx, id: string): Promise<TripRow> {
  const t = await loadTrip(db, id, true);
  if (t.status !== 'planned') throw new DomainError(409, 'invalid_status', 'Only a planned trip can be started');
  const stops = await loadStops(db, id);
  if (!stops.length) throw new DomainError(422, 'trip_empty', 'Add at least one stop before sending the trip');
  await enforceCapacity(db, ctx, t);
  const [row] = await db.update(fleetTrips).set({ status: 'in_transit', startedAt: new Date(), updatedAt: new Date() }).where(eq(fleetTrips.id, id)).returning();
  for (const s of stops) {
    if (!s.deliveryId || s.status === 'done' || s.status === 'failed') continue;
    await changeDeliveryStatus(db, ctx, s.deliveryId, deliveryStatusOfStop(s.status, 'in_transit'), undefined, true);
  }
  await event(db, ctx, 'fleet_trip', 'started', id, { number: t.number, vehicleId: t.vehicleId, driverMemberId: t.driverMemberId, stops: stops.length });
  return row!;
}

export async function completeTrip(db: Db, ctx: DocCtx, id: string): Promise<TripRow> {
  const t = await loadTrip(db, id, true);
  if (t.status !== 'in_transit') throw new DomainError(409, 'invalid_status', 'Only a trip in transit can be completed');
  const stops = await loadStops(db, id);
  const open = stops.filter(s => s.status === 'planned' || s.status === 'arrived');
  if (open.length) throw new DomainError(422, 'trip_stops_open', 'Mark every stop as done or failed before completing the trip', { open: open.length });
  const [row] = await db.update(fleetTrips).set({ status: 'done', finishedAt: new Date(), updatedAt: new Date() }).where(eq(fleetTrips.id, id)).returning();
  await event(db, ctx, 'fleet_trip', 'completed', id, { number: t.number, vehicleId: t.vehicleId, driverMemberId: t.driverMemberId, done: stops.filter(s => s.status === 'done').length, failed: stops.filter(s => s.status === 'failed').length });
  return row!;
}

export async function cancelTrip(db: Db, ctx: DocCtx, id: string): Promise<TripRow> {
  const t = await loadTrip(db, id, true);
  if (t.status !== 'planned' && t.status !== 'in_transit') throw new DomainError(409, 'invalid_status', 'Only a planned or in-transit trip can be cancelled');
  await releaseDeliveries(db, ctx, await loadStops(db, id));
  const [row] = await db.update(fleetTrips).set({ status: 'cancelled', finishedAt: new Date(), updatedAt: new Date() }).where(eq(fleetTrips.id, id)).returning();
  await event(db, ctx, 'fleet_trip', 'cancelled', id, { number: t.number });
  return row!;
}

/* ---------------- точки ---------------- */

export interface StopInput {
  kind?: TripStopRow['kind'];
  sourceKind?: TripStopRow['sourceKind'];
  sourceId?: string | null;
  deliveryId?: string | null;
  title?: string;
  address?: string;
  lat?: number | null;
  lon?: number | null;
  contactName?: string;
  contactPhone?: string;
  windowFrom?: string | null;
  windowTo?: string | null;
  day?: string | null;
  weightKg?: string;
  volumeM3?: string;
  pallets?: number;
  comment?: string;
  index?: number;
}

const coord = (n: number | null | undefined) => (n === null || n === undefined ? null : n.toFixed(6));

function assertWindow(from: string | null | undefined, to: string | null | undefined): void {
  if (from && to && to < from) throw new DomainError(422, 'delivery_window_invalid', 'The time window ends before it starts');
}

function assertDay(t: TripRow, day: string): void {
  if (day < t.dateFrom || day > t.dateTo) throw new DomainError(422, 'trip_stop_day', 'The stop day is outside the trip period');
}

/** Нумерация подряд с 1 в заданном порядке */
async function renumber(db: Db, ids: string[]): Promise<void> {
  for (const [i, sid] of ids.entries()) await db.update(fleetTripStops).set({ seq: i + 1 }).where(eq(fleetTripStops.id, sid));
}

async function insertAt(db: Db, ctx: DocCtx, t: TripRow, values: Omit<typeof fleetTripStops.$inferInsert, 'workspaceId' | 'tripId' | 'seq'>, index: number | undefined): Promise<TripStopRow> {
  const stops = await loadStops(db, t.id);
  const at = index === undefined || index > stops.length ? stops.length : index;
  const [row] = await db.insert(fleetTripStops).values({ ...values, workspaceId: ctx.workspaceId, tripId: t.id, seq: stops.length + 1 }).returning();
  const order = stops.map(s => s.id);
  order.splice(at, 0, row!.id);
  await renumber(db, order);
  return row!;
}

/** Точка рейса: своя или доставка документа (deliveryId). Доставка берёт курьера из рейса и становится «назначена» (в пути рейса — «в пути») */
export async function addStop(db: Db, ctx: DocCtx, tripId: string, input: StopInput): Promise<TripStopRow> {
  const t = await loadTrip(db, tripId, true);
  assertOpen(t);
  if (input.deliveryId || input.sourceKind === 'delivery') {
    if (!input.deliveryId) throw new DomainError(422, 'invalid_reference', 'A delivery stop needs a delivery');
    return addDeliveryStop(db, ctx, t, input.deliveryId, input.index);
  }
  assertWindow(input.windowFrom, input.windowTo);
  const day = input.day ?? t.dateFrom;
  assertDay(t, day);
  const row = await insertAt(
    db,
    ctx,
    t,
    {
      kind: input.kind ?? 'delivery',
      sourceKind: input.sourceKind === 'transport_order' ? 'transport_order' : 'manual',
      sourceId: input.sourceId ?? null,
      title: input.title ?? '',
      address: input.address ?? '',
      lat: coord(input.lat),
      lon: coord(input.lon),
      geoSource: input.lat != null && input.lon != null ? 'manual' : null,
      geoStatus: input.lat != null && input.lon != null ? 'ok' : null,
      contactName: input.contactName ?? '',
      contactPhone: input.contactPhone ?? '',
      day,
      windowFrom: input.windowFrom ?? null,
      windowTo: input.windowTo ?? null,
      weightKg: input.weightKg ?? '0',
      volumeM3: input.volumeM3 ?? '0',
      pallets: input.pallets ?? 0,
      comment: input.comment ?? '',
    },
    input.index,
  );
  if (row.geoSource !== 'manual' && row.address.trim()) await requestGeocode(db, ctx.workspaceId, 'stop', row.id);
  await clearRoute(db, [t.id]);
  await enforceCapacity(db, ctx, t);
  await event(db, ctx, 'fleet_trip', 'updated', tripId, { number: t.number, changes: ['stops'] });
  return row;
}

async function addDeliveryStop(db: Db, ctx: DocCtx, t: TripRow, deliveryId: string, index: number | undefined): Promise<TripStopRow> {
  const [d] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId)).for('update').limit(1);
  if (!d) throw notFound('delivery');
  if (d.status === 'delivered' || d.status === 'failed') throw new DomainError(422, 'delivery_finished', 'The delivery is already finished');
  const [busy] = await db
    .select({ tripId: fleetTrips.id, number: fleetTrips.number })
    .from(fleetTripStops)
    .innerJoin(fleetTrips, eq(fleetTrips.id, fleetTripStops.tripId))
    .where(and(eq(fleetTripStops.deliveryId, deliveryId), inArray(fleetTrips.status, ['planned', 'in_transit'])))
    .limit(1);
  if (busy) throw new DomainError(409, 'delivery_in_trip', `The delivery is already in trip ${busy.number}`, { tripId: busy.tripId, number: busy.number });
  const [doc] = await db.select({ number: documents.number }).from(documents).where(eq(documents.id, d.documentId)).limit(1);
  const day = d.deliveryDate && d.deliveryDate >= t.dateFrom && d.deliveryDate <= t.dateTo ? d.deliveryDate : t.dateFrom;
  const row = await insertAt(
    db,
    ctx,
    t,
    {
      kind: 'delivery',
      sourceKind: 'delivery',
      sourceId: deliveryId,
      deliveryId,
      title: doc?.number ?? '',
      address: d.address,
      lat: d.lat,
      lon: d.lon,
      geoSource: d.geoSource,
      geoStatus: d.geoStatus,
      contactName: d.contactName,
      contactPhone: d.contactPhone,
      day,
      windowFrom: d.windowFrom,
      windowTo: d.windowTo,
      weightKg: d.weightKg,
      volumeM3: '0',
      pallets: 0,
    },
    index,
  );
  if (!d.lat && !d.geoStatus && d.address.trim()) await requestGeocode(db, ctx.workspaceId, 'delivery', d.id);
  await clearRoute(db, [t.id]);
  // курьер доставки — водитель рейса; дата — день точки
  await db.update(deliveries).set({ courierMemberId: t.driverMemberId, deliveryDate: day, ...(d.status === 'new' ? { status: 'assigned' as const } : {}), updatedAt: new Date() }).where(eq(deliveries.id, deliveryId));
  if (t.status === 'in_transit') await changeDeliveryStatus(db, ctx, deliveryId, 'in_transit', undefined, true);
  await event(db, ctx, 'delivery', 'updated', deliveryId, { documentId: d.documentId, changes: ['courierMemberId', 'tripId'] });
  await enforceCapacity(db, ctx, t);
  await event(db, ctx, 'fleet_trip', 'updated', t.id, { number: t.number, changes: ['stops'] });
  return row;
}

export async function updateStop(db: Db, ctx: DocCtx, tripId: string, stopId: string, input: Omit<StopInput, 'sourceKind' | 'sourceId' | 'deliveryId' | 'index'>): Promise<TripStopRow> {
  const t = await loadTrip(db, tripId, true);
  assertOpen(t);
  const [s] = await db.select().from(fleetTripStops).where(and(eq(fleetTripStops.id, stopId), eq(fleetTripStops.tripId, tripId))).for('update').limit(1);
  if (!s) throw notFound('stop');
  if (s.status === 'done' || s.status === 'failed') throw new DomainError(409, 'stop_finished', 'A finished stop cannot be changed');
  const windowFrom = input.windowFrom !== undefined ? input.windowFrom : s.windowFrom;
  const windowTo = input.windowTo !== undefined ? input.windowTo : s.windowTo;
  assertWindow(windowFrom, windowTo);
  const day = input.day ?? s.day;
  assertDay(t, day);
  const set: Partial<typeof fleetTripStops.$inferInsert> = { day, windowFrom, windowTo, updatedAt: new Date() };
  for (const k of ['kind', 'title', 'address', 'contactName', 'contactPhone', 'weightKg', 'volumeM3', 'pallets', 'comment'] as const) if (input[k] !== undefined) (set as Record<string, unknown>)[k] = input[k];
  if (input.lat !== undefined) set.lat = coord(input.lat);
  if (input.lon !== undefined) set.lon = coord(input.lon);
  const manualCoords = (input.lat !== undefined || input.lon !== undefined) && (set.lat ?? null) !== null && (set.lon ?? null) !== null;
  const addrChanged = input.address !== undefined && input.address !== s.address;
  if (manualCoords) Object.assign(set, { geoSource: 'manual', geoStatus: 'ok' });
  else if ((input.lat !== undefined || input.lon !== undefined) || (addrChanged && s.geoSource !== 'manual')) Object.assign(set, { lat: null, lon: null, geoSource: null, geoStatus: null });
  const [row] = await db.update(fleetTripStops).set(set).where(eq(fleetTripStops.id, stopId)).returning();
  if (!manualCoords && row!.geoSource !== 'manual' && row!.address.trim() && (addrChanged || input.lat !== undefined || input.lon !== undefined)) await requestGeocode(db, ctx.workspaceId, 'stop', stopId);
  await clearRoute(db, [t.id]);
  await enforceCapacity(db, ctx, t);
  await event(db, ctx, 'fleet_trip', 'updated', tripId, { number: t.number, changes: ['stops'] });
  return row!;
}

export async function removeStop(db: Db, ctx: DocCtx, tripId: string, stopId: string): Promise<void> {
  const t = await loadTrip(db, tripId, true);
  assertOpen(t);
  const stops = await loadStops(db, tripId);
  const s = stops.find(x => x.id === stopId);
  if (!s) throw notFound('stop');
  if (s.status === 'done' || s.status === 'failed') throw new DomainError(409, 'stop_finished', 'A finished stop cannot be removed');
  await releaseDeliveries(db, ctx, [s]);
  await db.delete(fleetTripStops).where(eq(fleetTripStops.id, stopId));
  await renumber(db, stops.filter(x => x.id !== stopId).map(x => x.id));
  await clearRoute(db, [t.id]);
  await event(db, ctx, 'fleet_trip', 'updated', tripId, { number: t.number, changes: ['stops'] });
}

/** Новый порядок объезда: все точки рейса ровно по одному разу */
export async function reorderStops(db: Db, ctx: DocCtx, tripId: string, stopIds: string[]): Promise<TripStopRow[]> {
  const t = await loadTrip(db, tripId, true);
  assertOpen(t);
  const stops = await loadStops(db, tripId);
  const same = stopIds.length === stops.length && new Set(stopIds).size === stops.length && stops.every(s => stopIds.includes(s.id));
  if (!same) throw new DomainError(422, 'trip_order_invalid', 'The order must list every stop of the trip exactly once');
  await renumber(db, stopIds);
  await clearRoute(db, [t.id]);
  await event(db, ctx, 'fleet_trip', 'updated', tripId, { number: t.number, changes: ['order'] });
  return loadStops(db, tripId);
}

/** Отметка точки в пути: прибыл / выполнена / не выполнена / вернуть в план. Доставка точки получает свой статус */
export async function setStopStatus(db: Db, ctx: DocCtx, tripId: string, stopId: string, status: TripStopRow['status'], comment?: string): Promise<TripStopRow> {
  const t = await loadTrip(db, tripId, true);
  assertOpen(t);
  if (t.status !== 'in_transit') throw new DomainError(409, 'trip_not_started', 'Send the trip before marking its stops');
  const [s] = await db.select().from(fleetTripStops).where(and(eq(fleetTripStops.id, stopId), eq(fleetTripStops.tripId, tripId))).for('update').limit(1);
  if (!s) throw notFound('stop');
  const now = new Date();
  const [row] = await db
    .update(fleetTripStops)
    .set({ status, arrivedAt: status === 'planned' ? null : (s.arrivedAt ?? now), doneAt: status === 'done' || status === 'failed' ? now : null, ...(comment !== undefined ? { comment } : {}), updatedAt: now })
    .where(eq(fleetTripStops.id, stopId))
    .returning();
  if (s.deliveryId) {
    const next = deliveryStatusOfStop(status, 'in_transit');
    const [d] = await db.select({ status: deliveries.status }).from(deliveries).where(eq(deliveries.id, s.deliveryId)).limit(1);
    if (d && d.status !== next) await changeDeliveryStatus(db, ctx, s.deliveryId, next, status === 'failed' ? comment : undefined, true);
  }
  await event(db, ctx, 'fleet_trip', 'stop_changed', tripId, { number: t.number, stopId, status });
  return row!;
}

/* ---------------- путевой лист из рейса ---------------- */

export async function createTripWaybill(db: Db, ctx: DocCtx, tripId: string): Promise<WaybillRow> {
  const t = await loadTrip(db, tripId, true);
  if (t.status === 'cancelled') throw new DomainError(409, 'trip_closed', 'A cancelled trip has no waybill');
  const [have] = await db.select({ id: fleetWaybills.id, number: fleetWaybills.number }).from(fleetWaybills).where(and(eq(fleetWaybills.tripId, tripId), ne(fleetWaybills.status, 'cancelled'))).limit(1);
  if (have) throw new DomainError(409, 'trip_waybill_exists', `The trip already has waybill ${have.number}`, { waybillId: have.id, number: have.number });
  const stops = await loadStops(db, tripId);
  const route = (stops.map(s => s.address || s.title).filter(Boolean).join(' — ') || t.name).slice(0, 1000);
  const w = await createWaybill(db, ctx, { vehicleId: t.vehicleId, driverMemberId: t.driverMemberId, date: t.dateFrom, route, tripId, comment: `${t.number}${t.name ? ' · ' + t.name : ''}`.slice(0, 2000) });
  await event(db, ctx, 'fleet_trip', 'updated', tripId, { number: t.number, changes: ['waybill'] });
  return w;
}

/* ---------------- представления ---------------- */

export interface TripStopView extends TripStopRow {
  legKm: string | null;
  deliveryStatus: string | null;
  documentNumber: string | null;
  documentTotal: string | null;
}

export interface TripWarning {
  code: 'window_order' | 'overload';
  seq?: number;
  overloads?: Overload[];
}

export interface TripView extends TripRow {
  plate: string;
  vehicleName: string;
  driverName: string;
  coDriverName: string | null;
  limits: VehicleLimits;
  load: TripLoad;
  overloads: Overload[];
  stopsTotal: number;
  stopsDone: number;
  straightKm: string | null;
}

async function viewRows(db: Db, rows: TripRow[]): Promise<TripView[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const vehicles = new Map((await db.select().from(fleetVehicles).where(inArray(fleetVehicles.id, [...new Set(rows.map(r => r.vehicleId))]))).map(v => [v.id, v]));
  const people = new Map((await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, [...new Set(rows.flatMap(r => [r.driverMemberId, ...(r.coDriverMemberId ? [r.coDriverMemberId] : [])]))]))).map(m => [m.id, m.name]));
  const stops = await db.select().from(fleetTripStops).where(inArray(fleetTripStops.tripId, ids)).orderBy(asc(fleetTripStops.seq));
  const byTrip = new Map<string, TripStopRow[]>();
  for (const s of stops) byTrip.set(s.tripId, [...(byTrip.get(s.tripId) ?? []), s]);
  return rows.map(r => {
    const v = vehicles.get(r.vehicleId)!;
    const ss = byTrip.get(r.id) ?? [];
    const { load, overloadsOf } = loadOf(ss);
    const limits = limitsOf(v);
    const route = routeStraightKm(ss.map(s => ({ lat: s.lat === null ? null : Number(s.lat), lon: s.lon === null ? null : Number(s.lon) })));
    return {
      ...r,
      plate: v.plate,
      vehicleName: v.name,
      driverName: people.get(r.driverMemberId) ?? '',
      coDriverName: r.coDriverMemberId ? (people.get(r.coDriverMemberId) ?? null) : null,
      limits,
      load,
      overloads: overloadsOf(limits),
      stopsTotal: ss.length,
      stopsDone: ss.filter(s => s.status === 'done' || s.status === 'failed').length,
      straightKm: route?.km ?? null,
    };
  });
}

export async function listTrips(db: Db, q: { from?: string; to?: string; vehicleId?: string; driverId?: string; status?: TripRow['status']; kind?: TripRow['kind']; q?: string; limit?: number; offset?: number }) {
  const like = q.q ? `%${q.q.replace(/[%_\\]/g, m => '\\' + m)}%` : null;
  const where = and(
    q.from ? gte(fleetTrips.dateTo, q.from) : undefined,
    q.to ? lte(fleetTrips.dateFrom, q.to) : undefined,
    q.vehicleId ? eq(fleetTrips.vehicleId, q.vehicleId) : undefined,
    q.driverId ? or(eq(fleetTrips.driverMemberId, q.driverId), eq(fleetTrips.coDriverMemberId, q.driverId)) : undefined,
    q.status ? eq(fleetTrips.status, q.status) : undefined,
    q.kind ? eq(fleetTrips.kind, q.kind) : undefined,
    like ? sql`(${fleetTrips.number} ilike ${like} or ${fleetTrips.name} ilike ${like})` : undefined,
  );
  const rows = await db.select().from(fleetTrips).where(where).orderBy(desc(fleetTrips.dateFrom), desc(fleetTrips.number)).limit(q.limit ?? 100).offset(q.offset ?? 0);
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(fleetTrips).where(where);
  return { items: await viewRows(db, rows), total: n, limit: q.limit ?? 100, offset: q.offset ?? 0 };
}

export async function getTrip(db: Db, ctx: DocCtx, id: string) {
  const t = await loadTrip(db, id);
  const [view] = await viewRows(db, [t]);
  const stopRows = await db
    .select({ s: fleetTripStops, deliveryStatus: deliveries.status, documentNumber: documents.number, documentTotal: documents.total })
    .from(fleetTripStops)
    .leftJoin(deliveries, eq(deliveries.id, fleetTripStops.deliveryId))
    .leftJoin(documents, eq(documents.id, deliveries.documentId))
    .where(eq(fleetTripStops.tripId, id))
    .orderBy(asc(fleetTripStops.seq));
  const route = routeStraightKm(stopRows.map(r => ({ lat: r.s.lat === null ? null : Number(r.s.lat), lon: r.s.lon === null ? null : Number(r.s.lon) })));
  const stops: TripStopView[] = stopRows.map((r, i) => ({ ...r.s, legKm: r.s.legKm ?? route?.legs[i] ?? null, deliveryStatus: r.deliveryStatus ?? null, documentNumber: r.documentNumber ?? null, documentTotal: r.documentTotal ?? null }));
  const warnings: TripWarning[] = windowOrderConflicts(stopRows.map(r => ({ seq: r.s.seq, windowFrom: r.s.windowFrom, windowTo: r.s.windowTo }))).map(seq => ({ code: 'window_order' as const, seq }));
  if (view!.overloads.length) warnings.push({ code: 'overload', overloads: view!.overloads });
  const waybills = await db
    .select({ id: fleetWaybills.id, number: fleetWaybills.number, status: fleetWaybills.status, date: fleetWaybills.date })
    .from(fleetWaybills)
    .where(eq(fleetWaybills.tripId, id))
    .orderBy(asc(fleetWaybills.createdAt));
  return { ...view!, stops, warnings, waybills, capacityMode: await tripCapacityMode(db, ctx.workspaceId) };
}

/* ---------------- экран диспетчера ---------------- */

/** День диспетчера: нераспределённые доставки (на день или раньше, без рейса), машины и рейсы дня с точками для таймлайна */
export async function dispatchBoard(db: Db, ctx: DocCtx, date: string) {
  const activeIds = new Set(
    (await db.select({ id: fleetTripStops.deliveryId }).from(fleetTripStops).innerJoin(fleetTrips, eq(fleetTrips.id, fleetTripStops.tripId)).where(and(inArray(fleetTrips.status, ['planned', 'in_transit']), sql`${fleetTripStops.deliveryId} is not null`))).map(r => r.id as string),
  );
  const all = await listDeliveries(db, ctx, { to: date, limit: 200 });
  const unassigned: DeliveryView[] = all.items.filter(d => (d.status === 'new' || d.status === 'assigned') && !activeIds.has(d.id) && (d.deliveryDate === null || d.deliveryDate <= date));
  const geo = new Map(
    unassigned.length ? (await db.select({ id: deliveries.id, lat: deliveries.lat, lon: deliveries.lon }).from(deliveries).where(inArray(deliveries.id, unassigned.map(d => d.id)))).map(r => [r.id, r] as const) : [],
  );
  const trips = await db.select().from(fleetTrips).where(and(lte(fleetTrips.dateFrom, date), gte(fleetTrips.dateTo, date), ne(fleetTrips.status, 'cancelled'))).orderBy(asc(fleetTrips.startTime), asc(fleetTrips.number));
  const views = await viewRows(db, trips);
  const stops = trips.length ? await db.select().from(fleetTripStops).where(inArray(fleetTripStops.tripId, trips.map(t => t.id))).orderBy(asc(fleetTripStops.seq)) : [];
  const vehicles = await db.select().from(fleetVehicles).where(and(sql`${fleetVehicles.archivedAt} is null`, eq(fleetVehicles.status, 'active'))).orderBy(asc(fleetVehicles.plate));
  const drivers = await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.status, 'active')).orderBy(asc(members.name));
  return {
    date,
    capacityMode: await tripCapacityMode(db, ctx.workspaceId),
    unassigned: unassigned.map(d => ({ id: d.id, documentNumber: d.documentNumber, counterpartyName: d.counterpartyName, address: d.address, lat: geo.get(d.id)?.lat ?? null, lon: geo.get(d.id)?.lon ?? null, windowFrom: hhmm(d.windowFrom), windowTo: hhmm(d.windowTo), weightKg: d.weightKg, deliveryDate: d.deliveryDate, status: d.status, documentTotal: d.documentTotal })),
    vehicles: vehicles.map(v => ({ id: v.id, plate: v.plate, name: v.name, capacityKg: v.capacityKg, volumeM3: v.volumeM3, pallets: v.pallets, driverMemberId: v.driverMemberId })),
    drivers,
    trips: views.map(v => ({ ...v, stops: stops.filter(s => s.tripId === v.id).map(s => ({ id: s.id, seq: s.seq, kind: s.kind, title: s.title, address: s.address, day: s.day, windowFrom: hhmm(s.windowFrom), windowTo: hhmm(s.windowTo), status: s.status, weightKg: s.weightKg, lat: s.lat, lon: s.lon, legKm: s.legKm, legMin: s.legMin, etaMin: s.etaMin, etaLate: s.etaLate })) })),
  };
}

/* ---------------- печать ---------------- */

/** Маршрутный лист рейса: форма маршрутного листа курьера (shared/print/route-sheet.ts) с точками рейса */
export async function tripPrintData(db: Db, ctx: DocCtx, id: string): Promise<RouteSheetPrintData> {
  const t = await getTrip(db, ctx, id);
  const drivers = [t.driverName, t.coDriverName].filter(Boolean).join(', ');
  const total = t.stops.reduce((s, x) => s + (x.documentTotal ? dec(x.documentTotal) : 0n), 0n);
  const period = t.dateFrom === t.dateTo ? t.dateFrom : `${t.dateFrom} — ${t.dateTo}`;
  return {
    date: t.dateFrom,
    courierName: t.driverName,
    heading: `Маршрутный лист рейса ${t.number}`,
    meta: `${period}. Машина: ${t.plate}${t.vehicleName ? ' ' + t.vehicleName : ''}. Водитель: ${drivers}. Точек: ${t.stops.length}.${t.name ? ' ' + t.name : ''}`,
    items: t.stops.map(s => ({
      time: [t.dateFrom !== t.dateTo ? s.day : null, [hhmm(s.windowFrom), hhmm(s.windowTo)].filter(Boolean).join('–')].filter(Boolean).join(' '),
      address: [{ load: 'Погрузка', unload: 'Выгрузка', delivery: '' }[s.kind], s.address || s.title].filter(Boolean).join(': '),
      contact: s.contactName,
      phone: s.contactPhone,
      document: s.documentNumber ?? s.title,
      total: s.documentTotal ?? '0',
      comment: s.comment,
    })),
    total: fmt(total, 2),
  };
}
