/* Заявки на перевозку, тарифы по направлениям и экспедирование (задача 1223, docs/architecture/transport-orders.md).
   Заявка — документ заказчика (маршрут, груз, ставка клиенту). Из неё: рейс (точки добавляются как source_kind='transport_order',
   см. trips.ts), счёт и акт на услугу «Перевозка» (documents). Экспедирование — наём перевозчика на рейс (fleet_trip_carriers,
   одна запись на рейс) и прочие затраты рейса (fleet_trip_costs). Маржа рейса и подбор тарифа — чистые функции @gr8r/shared. */
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { computeForwardingMargin, computeTransportRateAmount, computeTripMargin, findRateSchedule, type TransportOrderStatus, type TransportRateKind } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import type { DocCtx } from './documents';
import { createDocument } from './documents';
import { nextNumber } from './fleet';
import { fleetCosts } from './fleet';
import { loadTrip } from './trips';
import { addStop } from './trips';
import { companies, costItems, fleetTripCarriers, fleetTripCosts, organizations, transportOrderPoints, transportOrders, transportRateSchedules } from './schema';

const notFound = (what: string) => new DomainError(404, 'not_found', `${what} not found`);
async function event(db: Db, ctx: DocCtx, entity: string, action: string, id: string, payload: Record<string, unknown> = {}) {
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: `${entity}.${action}`, entity, recordId: id, actorId: ctx.memberId, payload });
}

export type RateScheduleRow = typeof transportRateSchedules.$inferSelect;
export type TransportOrderRow = typeof transportOrders.$inferSelect;
export type TransportOrderPointRow = typeof transportOrderPoints.$inferSelect;
export type FleetTripCarrierRow = typeof fleetTripCarriers.$inferSelect;
export type FleetTripCostRow = typeof fleetTripCosts.$inferSelect;

/* ---------------- тарифы по направлениям ---------------- */

export interface RateScheduleInput {
  name: string;
  fromPlace?: string;
  toPlace?: string;
  bodyType?: string;
  rateKind?: TransportRateKind;
  rate?: string;
  distanceKm?: string | null;
  comment?: string;
}

export async function listRateSchedules(db: Db, q: { archived?: 'exclude' | 'include' | 'only'; q?: string; limit?: number; offset?: number } = {}): Promise<RateScheduleRow[]> {
  const archived = q.archived ?? 'exclude';
  const where = and(
    archived === 'exclude' ? isNull(transportRateSchedules.archivedAt) : archived === 'only' ? sql`${transportRateSchedules.archivedAt} is not null` : undefined,
    q.q ? sql`(${transportRateSchedules.name} ilike ${'%' + q.q + '%'} or ${transportRateSchedules.fromPlace} ilike ${'%' + q.q + '%'} or ${transportRateSchedules.toPlace} ilike ${'%' + q.q + '%'})` : undefined,
  );
  return db.select().from(transportRateSchedules).where(where).orderBy(asc(transportRateSchedules.fromPlace), asc(transportRateSchedules.toPlace)).limit(q.limit ?? 200).offset(q.offset ?? 0);
}

async function loadRateSchedule(db: Db, id: string): Promise<RateScheduleRow> {
  const [row] = await db.select().from(transportRateSchedules).where(eq(transportRateSchedules.id, id)).limit(1);
  if (!row) throw notFound('rate schedule');
  return row;
}

export async function createRateSchedule(db: Db, ctx: DocCtx, input: RateScheduleInput): Promise<RateScheduleRow> {
  const [row] = await db
    .insert(transportRateSchedules)
    .values({ workspaceId: ctx.workspaceId, name: input.name, fromPlace: input.fromPlace ?? '', toPlace: input.toPlace ?? '', bodyType: input.bodyType ?? '', rateKind: input.rateKind ?? 'flat', rate: input.rate ?? '0', distanceKm: input.distanceKm ?? null, comment: input.comment ?? '' })
    .returning();
  await event(db, ctx, 'transport_rate_schedule', 'created', row!.id, { name: row!.name });
  return row!;
}

export async function updateRateSchedule(db: Db, ctx: DocCtx, id: string, input: Partial<RateScheduleInput>): Promise<RateScheduleRow> {
  const cur = await loadRateSchedule(db, id);
  const [row] = await db
    .update(transportRateSchedules)
    .set({
      name: input.name ?? cur.name,
      fromPlace: input.fromPlace ?? cur.fromPlace,
      toPlace: input.toPlace ?? cur.toPlace,
      bodyType: input.bodyType ?? cur.bodyType,
      rateKind: input.rateKind ?? cur.rateKind,
      rate: input.rate ?? cur.rate,
      distanceKm: input.distanceKm !== undefined ? input.distanceKm : cur.distanceKm,
      comment: input.comment ?? cur.comment,
      updatedAt: new Date(),
    })
    .where(eq(transportRateSchedules.id, id))
    .returning();
  await event(db, ctx, 'transport_rate_schedule', 'updated', id, { changes: Object.keys(input) });
  return row!;
}

export async function archiveRateSchedule(db: Db, ctx: DocCtx, id: string, archived: boolean): Promise<RateScheduleRow> {
  await loadRateSchedule(db, id);
  const [row] = await db.update(transportRateSchedules).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(eq(transportRateSchedules.id, id)).returning();
  await event(db, ctx, 'transport_rate_schedule', archived ? 'archived' : 'restored', id);
  return row!;
}

/** Подбор тарифа по направлению для подсказки заявке (задача 1223) */
export async function suggestRateSchedule(db: Db, q: { fromPlace: string; toPlace: string; bodyType?: string }): Promise<RateScheduleRow | null> {
  const schedules = await listRateSchedules(db, { archived: 'exclude', limit: 1000 });
  return findRateSchedule(schedules, q) as RateScheduleRow | null;
}

/* ---------------- заявка на перевозку ---------------- */

export interface TransportOrderPointInput {
  kind?: 'load' | 'unload';
  address?: string;
  contactName?: string;
  contactPhone?: string;
}

export interface TransportOrderInput {
  date: string;
  organizationId: string;
  customerCompanyId: string;
  fromPlace?: string;
  toPlace?: string;
  readyDate?: string | null;
  deliveryDate?: string | null;
  cargoName?: string;
  weightKg?: string;
  volumeM3?: string;
  places?: number;
  bodyType?: string;
  rateScheduleId?: string | null;
  rateKind?: TransportRateKind;
  rate?: string;
  distanceKm?: string | null;
  /** Сумма вручную (договорная); пусто — считается по rateKind/rate/distanceKm/weightKg */
  amount?: string;
  comment?: string;
  points?: TransportOrderPointInput[];
}

async function assertOrg(db: Db, _workspaceId: string, id: string): Promise<void> {
  const [row] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!row) throw new DomainError(422, 'invalid_reference', 'The organization does not exist');
}

async function assertCompany(db: Db, id: string, label = 'company'): Promise<void> {
  const [row] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id)).limit(1);
  if (!row) throw new DomainError(422, 'invalid_reference', `The ${label} does not exist`);
}

function amountOf(input: { rateKind?: TransportRateKind; rate?: string; amount?: string; distanceKm?: string | null; weightKg?: string }): string {
  if (input.amount !== undefined) return input.amount;
  return computeTransportRateAmount({ rateKind: input.rateKind ?? 'flat', rate: input.rate ?? '0' }, { distanceKm: input.distanceKm ?? undefined, weightKg: input.weightKg ?? undefined });
}

export async function loadTransportOrder(db: Db, id: string, lock = false): Promise<TransportOrderRow> {
  const q = db.select().from(transportOrders).where(eq(transportOrders.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw notFound('transport order');
  return row;
}

export async function listOrderPoints(db: Db, orderId: string): Promise<TransportOrderPointRow[]> {
  return db.select().from(transportOrderPoints).where(eq(transportOrderPoints.orderId, orderId)).orderBy(asc(transportOrderPoints.seq));
}

async function replacePoints(db: Db, ctx: DocCtx, orderId: string, points: TransportOrderPointInput[] | undefined): Promise<void> {
  if (points === undefined) return;
  await db.delete(transportOrderPoints).where(eq(transportOrderPoints.orderId, orderId));
  for (const [i, p] of points.entries()) {
    await db.insert(transportOrderPoints).values({ workspaceId: ctx.workspaceId, orderId, seq: i + 1, kind: p.kind ?? 'load', address: p.address ?? '', contactName: p.contactName ?? '', contactPhone: p.contactPhone ?? '' });
  }
}

export async function createTransportOrder(db: Db, ctx: DocCtx, input: TransportOrderInput): Promise<TransportOrderRow> {
  await assertOrg(db, ctx.workspaceId, input.organizationId);
  await assertCompany(db, input.customerCompanyId, 'customer');
  if (input.rateScheduleId) await loadRateSchedule(db, input.rateScheduleId);
  const number = await nextNumber(db, ctx.workspaceId, 'transport_orders', 'ЗП', input.date);
  const amount = amountOf(input);
  const [row] = await db
    .insert(transportOrders)
    .values({
      workspaceId: ctx.workspaceId,
      number,
      date: input.date,
      organizationId: input.organizationId,
      customerCompanyId: input.customerCompanyId,
      fromPlace: input.fromPlace ?? '',
      toPlace: input.toPlace ?? '',
      readyDate: input.readyDate ?? null,
      deliveryDate: input.deliveryDate ?? null,
      cargoName: input.cargoName ?? '',
      weightKg: input.weightKg ?? '0',
      volumeM3: input.volumeM3 ?? '0',
      places: input.places ?? 0,
      bodyType: input.bodyType ?? '',
      rateScheduleId: input.rateScheduleId ?? null,
      rateKind: input.rateKind ?? 'flat',
      rate: input.rate ?? '0',
      distanceKm: input.distanceKm ?? null,
      amount,
    })
    .returning();
  await replacePoints(db, ctx, row!.id, input.points);
  await event(db, ctx, 'transport_order', 'created', row!.id, { number: row!.number });
  return row!;
}

function assertEditable(order: TransportOrderRow): void {
  if (order.status === 'done' || order.status === 'cancelled') throw new DomainError(409, 'transport_order_closed', 'A finished or cancelled order cannot be changed');
}

export async function updateTransportOrder(db: Db, ctx: DocCtx, id: string, input: Partial<TransportOrderInput>): Promise<TransportOrderRow> {
  const cur = await loadTransportOrder(db, id, true);
  assertEditable(cur);
  if (input.organizationId) await assertOrg(db, ctx.workspaceId, input.organizationId);
  if (input.customerCompanyId) await assertCompany(db, input.customerCompanyId, 'customer');
  if (input.rateScheduleId) await loadRateSchedule(db, input.rateScheduleId);
  const next = {
    rateKind: input.rateKind ?? (cur.rateKind as TransportRateKind),
    rate: input.rate ?? cur.rate,
    distanceKm: input.distanceKm !== undefined ? input.distanceKm : cur.distanceKm,
    weightKg: input.weightKg ?? cur.weightKg,
    amount: input.amount,
  };
  // сумма пересчитывается только если явно задана или изменились составляющие расчёта ставки;
  // иначе правка несвязанного поля (комментарий, статус) сбросит ранее заданную вручную сумму
  const rateChanged = input.rateKind !== undefined || input.rate !== undefined || input.distanceKm !== undefined || input.weightKg !== undefined;
  const amount = input.amount !== undefined ? input.amount : rateChanged ? amountOf(next) : cur.amount;
  const [row] = await db
    .update(transportOrders)
    .set({
      date: input.date ?? cur.date,
      organizationId: input.organizationId ?? cur.organizationId,
      customerCompanyId: input.customerCompanyId ?? cur.customerCompanyId,
      fromPlace: input.fromPlace ?? cur.fromPlace,
      toPlace: input.toPlace ?? cur.toPlace,
      readyDate: input.readyDate !== undefined ? input.readyDate : cur.readyDate,
      deliveryDate: input.deliveryDate !== undefined ? input.deliveryDate : cur.deliveryDate,
      cargoName: input.cargoName ?? cur.cargoName,
      weightKg: next.weightKg,
      volumeM3: input.volumeM3 ?? cur.volumeM3,
      places: input.places ?? cur.places,
      bodyType: input.bodyType ?? cur.bodyType,
      rateScheduleId: input.rateScheduleId !== undefined ? input.rateScheduleId : cur.rateScheduleId,
      rateKind: next.rateKind,
      rate: next.rate,
      distanceKm: next.distanceKm,
      amount,
      comment: input.comment ?? cur.comment,
      updatedAt: new Date(),
    })
    .where(eq(transportOrders.id, id))
    .returning();
  await replacePoints(db, ctx, id, input.points);
  await event(db, ctx, 'transport_order', 'updated', id, { number: cur.number, changes: Object.keys(input) });
  return row!;
}

const TRANSITIONS: Record<TransportOrderStatus, TransportOrderStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

export async function setTransportOrderStatus(db: Db, ctx: DocCtx, id: string, status: TransportOrderStatus): Promise<TransportOrderRow> {
  const cur = await loadTransportOrder(db, id, true);
  if (!TRANSITIONS[cur.status as TransportOrderStatus].includes(status)) throw new DomainError(409, 'invalid_transition', `Cannot move the order from "${cur.status}" to "${status}"`);
  const [row] = await db.update(transportOrders).set({ status, updatedAt: new Date() }).where(eq(transportOrders.id, id)).returning();
  await event(db, ctx, 'transport_order', 'status_changed', id, { number: cur.number, from: cur.status, to: status });
  return row!;
}

export async function deleteTransportOrder(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const cur = await loadTransportOrder(db, id, true);
  if (cur.status !== 'draft') throw new DomainError(409, 'transport_order_not_draft', 'Only a draft order can be deleted');
  await db.delete(transportOrders).where(eq(transportOrders.id, id));
  await event(db, ctx, 'transport_order', 'deleted', id, { number: cur.number });
}

export interface TransportOrderQuery {
  from?: string;
  to?: string;
  status?: TransportOrderStatus;
  customerCompanyId?: string;
  tripId?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listTransportOrders(db: Db, q: TransportOrderQuery = {}): Promise<TransportOrderRow[]> {
  const where = and(
    q.from ? gte(transportOrders.date, q.from) : undefined,
    q.to ? lte(transportOrders.date, q.to) : undefined,
    q.status ? eq(transportOrders.status, q.status) : undefined,
    q.customerCompanyId ? eq(transportOrders.customerCompanyId, q.customerCompanyId) : undefined,
    q.tripId ? eq(transportOrders.tripId, q.tripId) : undefined,
    q.q ? sql`(${transportOrders.number} ilike ${'%' + q.q + '%'} or ${transportOrders.cargoName} ilike ${'%' + q.q + '%'} or ${transportOrders.fromPlace} ilike ${'%' + q.q + '%'} or ${transportOrders.toPlace} ilike ${'%' + q.q + '%'})` : undefined,
  );
  return db.select().from(transportOrders).where(where).orderBy(desc(transportOrders.date), desc(transportOrders.number)).limit(q.limit ?? 200).offset(q.offset ?? 0);
}

/* ---------------- заявка → рейс ---------------- */

/** Создаёт рейс из заявки (tripId не передан) или добавляет точки заявки в существующий рейс.
    Точки заявки (загрузка/разгрузка) становятся точками рейса с sourceKind='transport_order' (см. trips.ts addStop). */
export async function attachTransportOrderToTrip(db: Db, ctx: DocCtx, orderId: string, tripId?: string): Promise<TransportOrderRow> {
  const order = await loadTransportOrder(db, orderId, true);
  if (order.tripId) throw new DomainError(409, 'transport_order_has_trip', 'The order is already attached to a trip');
  const points = await listOrderPoints(db, orderId);
  if (!points.length) throw new DomainError(422, 'transport_order_no_points', 'Add at least one route point before creating a trip');
  let trip = tripId ? await loadTrip(db, tripId, true) : null;
  if (!trip) throw new DomainError(422, 'trip_required', 'Select an existing trip for the order (create it first in Trips)');
  for (const p of points) {
    await addStop(db, ctx, trip.id, { kind: p.kind === 'load' ? 'delivery' : 'delivery', sourceKind: 'transport_order', sourceId: order.id, address: p.address, contactName: p.contactName, contactPhone: p.contactPhone, weightKg: order.weightKg, volumeM3: order.volumeM3 });
  }
  const [row] = await db.update(transportOrders).set({ tripId: trip.id, updatedAt: new Date() }).where(eq(transportOrders.id, orderId)).returning();
  await event(db, ctx, 'transport_order', 'attached_to_trip', orderId, { number: order.number, tripId: trip.id });
  return row!;
}

/* ---------------- заявка → счёт / акт ---------------- */

const SERVICE_TYPE: Record<'invoice' | 'act', 'invoice' | 'act'> = { invoice: 'invoice', act: 'act' };

/** Счёт или акт на услугу «Перевозка» (товар productId, количество 1, цена = сумма заявки) */
export async function billTransportOrder(db: Db, ctx: DocCtx, orderId: string, target: 'invoice' | 'act', productId: string): Promise<string> {
  const order = await loadTransportOrder(db, orderId, true);
  if (order.status === 'cancelled') throw new DomainError(422, 'transport_order_cancelled', 'A cancelled order cannot be billed');
  const existing = target === 'invoice' ? order.invoiceDocumentId : order.actDocumentId;
  if (existing) throw new DomainError(409, 'already_billed', `A ${target === 'invoice' ? 'invoice' : 'act'} has already been created for this order`);
  const docId = await createDocument(db, ctx, {
    type: SERVICE_TYPE[target],
    organizationId: order.organizationId,
    counterpartyId: order.customerCompanyId,
    comment: `${order.number}: ${order.fromPlace} → ${order.toPlace}`,
    lines: [{ productId, name: `Перевозка ${order.fromPlace} — ${order.toPlace} (${order.number})`, unitCode: '796', qty: '1', price: order.amount, discountPct: '0' }],
  });
  await db.update(transportOrders).set(target === 'invoice' ? { invoiceDocumentId: docId, updatedAt: new Date() } : { actDocumentId: docId, updatedAt: new Date() }).where(eq(transportOrders.id, orderId));
  await event(db, ctx, 'transport_order', `${target}_created`, orderId, { number: order.number, documentId: docId });
  return docId;
}

/* ---------------- экспедирование: наём перевозчика ---------------- */

export interface FleetTripCarrierInput {
  carrierCompanyId: string;
  rate?: string;
  vehiclePlate?: string;
  vehicleModel?: string;
  driverName?: string;
  driverPhone?: string;
  driverLicense?: string;
  contractNumber?: string;
  contractDate?: string | null;
  comment?: string;
}

export async function getFleetTripCarrier(db: Db, tripId: string): Promise<FleetTripCarrierRow | null> {
  const [row] = await db.select().from(fleetTripCarriers).where(eq(fleetTripCarriers.tripId, tripId)).limit(1);
  return row ?? null;
}

export async function saveFleetTripCarrier(db: Db, ctx: DocCtx, tripId: string, input: FleetTripCarrierInput): Promise<FleetTripCarrierRow> {
  await loadTrip(db, tripId);
  await assertCompany(db, input.carrierCompanyId, 'carrier');
  const values = {
    workspaceId: ctx.workspaceId,
    tripId,
    carrierCompanyId: input.carrierCompanyId,
    rate: input.rate ?? '0',
    vehiclePlate: input.vehiclePlate ?? '',
    vehicleModel: input.vehicleModel ?? '',
    driverName: input.driverName ?? '',
    driverPhone: input.driverPhone ?? '',
    driverLicense: input.driverLicense ?? '',
    contractNumber: input.contractNumber ?? '',
    contractDate: input.contractDate ?? null,
    comment: input.comment ?? '',
  };
  const [row] = await db
    .insert(fleetTripCarriers)
    .values(values)
    .onConflictDoUpdate({ target: fleetTripCarriers.tripId, set: { ...values, updatedAt: new Date() } })
    .returning();
  await event(db, ctx, 'fleet_trip_carrier', 'saved', row!.id, { tripId });
  return row!;
}

export async function deleteFleetTripCarrier(db: Db, ctx: DocCtx, tripId: string): Promise<void> {
  const row = await getFleetTripCarrier(db, tripId);
  if (!row) return;
  await db.delete(fleetTripCarriers).where(eq(fleetTripCarriers.tripId, tripId));
  await event(db, ctx, 'fleet_trip_carrier', 'deleted', row.id, { tripId });
}

/* ---------------- прочие затраты рейса ---------------- */

export interface FleetTripCostInput {
  costItemId: string;
  amount?: string;
  comment?: string;
}

async function assertCostItem(db: Db, id: string): Promise<void> {
  const [row] = await db.select({ id: costItems.id }).from(costItems).where(eq(costItems.id, id)).limit(1);
  if (!row) throw new DomainError(422, 'invalid_reference', 'The cost item does not exist');
}

export async function listFleetTripCosts(db: Db, tripId: string): Promise<FleetTripCostRow[]> {
  return db.select().from(fleetTripCosts).where(eq(fleetTripCosts.tripId, tripId)).orderBy(asc(fleetTripCosts.createdAt));
}

export async function addFleetTripCost(db: Db, ctx: DocCtx, tripId: string, input: FleetTripCostInput): Promise<FleetTripCostRow> {
  await loadTrip(db, tripId);
  await assertCostItem(db, input.costItemId);
  const [row] = await db.insert(fleetTripCosts).values({ workspaceId: ctx.workspaceId, tripId, costItemId: input.costItemId, amount: input.amount ?? '0', comment: input.comment ?? '' }).returning();
  await event(db, ctx, 'fleet_trip_cost', 'created', row!.id, { tripId });
  return row!;
}

export async function updateFleetTripCost(db: Db, ctx: DocCtx, id: string, input: Partial<FleetTripCostInput>): Promise<FleetTripCostRow> {
  const [cur] = await db.select().from(fleetTripCosts).where(eq(fleetTripCosts.id, id)).limit(1);
  if (!cur) throw notFound('trip cost');
  if (input.costItemId) await assertCostItem(db, input.costItemId);
  const [row] = await db.update(fleetTripCosts).set({ costItemId: input.costItemId ?? cur.costItemId, amount: input.amount ?? cur.amount, comment: input.comment ?? cur.comment, updatedAt: new Date() }).where(eq(fleetTripCosts.id, id)).returning();
  await event(db, ctx, 'fleet_trip_cost', 'updated', id, { tripId: cur.tripId });
  return row!;
}

export async function deleteFleetTripCost(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const [cur] = await db.select().from(fleetTripCosts).where(eq(fleetTripCosts.id, id)).limit(1);
  if (!cur) return;
  await db.delete(fleetTripCosts).where(eq(fleetTripCosts.id, id));
  await event(db, ctx, 'fleet_trip_cost', 'deleted', id, { tripId: cur.tripId });
}

/* ---------------- маржа рейса ---------------- */

export interface TripMarginView {
  income: string;
  fleetCosts: string;
  carrierRate: string;
  otherCosts: string;
  totalCosts: string;
  margin: string;
  marginPct: string | null;
  forwarding: { margin: string; marginPct: string | null } | null;
}

/** Маржа рейса: доход заявок рейса минус затраты автопарка (топливо/ремонт/штрафы за период рейса), ставка наёмному перевозчику
    и прочие статьи (fleet_trip_costs). Если рейс отдан перевозчику — отдельно показывается маржа экспедитора. */
export async function tripMargin(db: Db, ctx: DocCtx, tripId: string): Promise<TripMarginView> {
  const trip = await loadTrip(db, tripId);
  const orders = await db.select({ amount: transportOrders.amount }).from(transportOrders).where(and(eq(transportOrders.tripId, tripId), sql`${transportOrders.status} != 'cancelled'`));
  const ordersAmount = orders.reduce((s, o) => s + Number(o.amount), 0).toFixed(2);
  const costs = await fleetCosts(db, ctx, { from: trip.dateFrom, to: trip.dateTo });
  const vehicleCost = costs.items.find(c => c.vehicleId === trip.vehicleId);
  const extra = await listFleetTripCosts(db, tripId);
  const otherCosts = extra.reduce((s, c) => s + Number(c.amount), 0).toFixed(2);
  const carrier = await getFleetTripCarrier(db, tripId);
  const r = computeTripMargin({
    ordersAmount,
    fleetFuelAmount: vehicleCost?.fuelAmount ?? '0',
    fleetRepairAmount: vehicleCost?.repairAmount ?? '0',
    fleetFinesAmount: vehicleCost?.finesAmount ?? '0',
    carrierRate: carrier?.rate ?? null,
    otherCosts,
  });
  const forwarding = carrier ? computeForwardingMargin(ordersAmount, carrier.rate) : null;
  return { ...r, forwarding };
}
