/* Рейсы (задача 1211, docs/architecture/trips.md): рейс = машина + водитель(и) + период + точки в порядке объезда.
   Таблицы арендатора (workspace_id + RLS), ссылки — составные FK. Точка ссылается на доставку (delivery_id) или, в будущем, на заявку
   на перевозку (source_kind/source_id без внешнего ключа до задачи 1223). */
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, time, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './columns';
import { deliveries } from './delivery';
import { fleetVehicles } from './fleet';
import { documents, organizations } from './documents';
import { cashRegisters } from './payments';
import { members, wsCol } from './people';

export const fleetTrips = pgTable(
  'fleet_trips',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** РС-ГГГГ-NNNNN */
    number: text('number').notNull(),
    kind: text('kind', { enum: ['city', 'intercity'] }).notNull().default('city'),
    status: text('status', { enum: ['planned', 'in_transit', 'done', 'cancelled'] }).notNull().default('planned'),
    name: text('name').notNull().default(''),
    dateFrom: date('date_from', { mode: 'string' }).notNull(),
    dateTo: date('date_to', { mode: 'string' }).notNull(),
    startTime: time('start_time'),
    endTime: time('end_time'),
    vehicleId: uuid('vehicle_id').notNull(),
    driverMemberId: uuid('driver_member_id').notNull(),
    coDriverMemberId: uuid('co_driver_member_id'),
    comment: text('comment').notNull().default(''),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    /** Расчёт маршрута (задача 1213): длина, время в пути (без стоянок), откуда числа (провайдер или прямая) и когда считали; пусто — не считали или порядок менялся после */
    routeKm: numeric('route_km', { precision: 9, scale: 1 }),
    routeMin: integer('route_min'),
    routeSource: text('route_source', { enum: ['provider', 'straight'] }),
    routedAt: ts('routed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('fleet_trips_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('fleet_trips_ws_number_uq').on(t.workspaceId, t.number),
    foreignKey({ columns: [t.workspaceId, t.vehicleId], foreignColumns: [fleetVehicles.workspaceId, fleetVehicles.id], name: 'fleet_trips_vehicle_fk' }),
    foreignKey({ columns: [t.workspaceId, t.driverMemberId], foreignColumns: [members.workspaceId, members.id], name: 'fleet_trips_driver_fk' }),
    foreignKey({ columns: [t.workspaceId, t.coDriverMemberId], foreignColumns: [members.workspaceId, members.id], name: 'fleet_trips_co_driver_fk' }),
    check('fleet_trips_status_chk', sql`${t.status} in ('planned','in_transit','done','cancelled')`),
    check('fleet_trips_kind_chk', sql`${t.kind} in ('city','intercity')`),
    check('fleet_trips_dates_chk', sql`${t.dateTo} >= ${t.dateFrom}`),
    index('fleet_trips_date_idx').on(t.workspaceId, t.dateFrom),
    index('fleet_trips_vehicle_idx').on(t.vehicleId, t.dateFrom),
    index('fleet_trips_driver_idx').on(t.driverMemberId, t.dateFrom),
  ],
);

export const fleetTripStops = pgTable(
  'fleet_trip_stops',
  {
    id: pk(),
    workspaceId: wsCol(),
    tripId: uuid('trip_id').notNull(),
    /** Порядок объезда, с 1 подряд */
    seq: integer('seq').notNull(),
    kind: text('kind', { enum: ['load', 'unload', 'delivery'] }).notNull().default('delivery'),
    /** Источник точки: manual | delivery | transport_order (заявка — задача 1223, внешнего ключа пока нет) */
    sourceKind: text('source_kind', { enum: ['manual', 'delivery', 'transport_order'] }).notNull().default('manual'),
    sourceId: uuid('source_id'),
    deliveryId: uuid('delivery_id'),
    title: text('title').notNull().default(''),
    address: text('address').notNull().default(''),
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lon: numeric('lon', { precision: 9, scale: 6 }),
    contactName: text('contact_name').notNull().default(''),
    contactPhone: text('contact_phone').notNull().default(''),
    /** День рейса, на который назначена точка (для междугородних) */
    day: date('day', { mode: 'string' }).notNull(),
    windowFrom: time('window_from'),
    windowTo: time('window_to'),
    weightKg: numeric('weight_kg', { precision: 18, scale: 3 }).notNull().default('0'),
    volumeM3: numeric('volume_m3', { precision: 12, scale: 3 }).notNull().default('0'),
    pallets: integer('pallets').notNull().default(0),
    /** Геокодирование адреса точки (задача 1213) */
    geoSource: text('geo_source', { enum: ['manual', 'geocoder'] }),
    geoStatus: text('geo_status', { enum: ['pending', 'ok', 'approx', 'not_found', 'error'] }),
    /** Участок от предыдущей точки (или от базы) и ожидаемое прибытие: минуты от полуночи первого дня рейса; опоздание относительно окна */
    legKm: numeric('leg_km', { precision: 9, scale: 1 }),
    legMin: integer('leg_min'),
    etaMin: integer('eta_min'),
    etaLate: boolean('eta_late').notNull().default(false),
    status: text('status', { enum: ['planned', 'arrived', 'done', 'failed'] }).notNull().default('planned'),
    arrivedAt: ts('arrived_at'),
    doneAt: ts('done_at'),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('fleet_trip_stops_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.tripId], foreignColumns: [fleetTrips.workspaceId, fleetTrips.id], name: 'fleet_trip_stops_trip_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.deliveryId], foreignColumns: [deliveries.workspaceId, deliveries.id], name: 'fleet_trip_stops_delivery_fk' }).onDelete('set null'),
    check('fleet_trip_stops_kind_chk', sql`${t.kind} in ('load','unload','delivery')`),
    check('fleet_trip_stops_source_chk', sql`${t.sourceKind} in ('manual','delivery','transport_order')`),
    check('fleet_trip_stops_status_chk', sql`${t.status} in ('planned','arrived','done','failed')`),
    check('fleet_trip_stops_cargo_chk', sql`${t.weightKg} >= 0 and ${t.volumeM3} >= 0 and ${t.pallets} >= 0`),
    index('fleet_trip_stops_trip_idx').on(t.tripId, t.seq),
    index('fleet_trip_stops_delivery_idx').on(t.deliveryId),
  ],
);

/** Транспортная накладная (задача 1214, постановление Правительства РФ № 2200): только номер и привязка; содержимое печатной формы собирается из живых данных.
    Область: рейс (trip_id), точка рейса (+ stop_id), доставка (+ delivery_id, с рейсом или без). Номер сквозной по арендатору и не меняется при повторной печати.
    Ссылки на рейс, точку и доставку — ON DELETE SET NULL ("колонка") (миграция 0067), чтобы выданный номер пережил удаление. etrn_status — место под ЭТрН (ГИС ЭПД, после ЭДО сессии 48) */
export const transportWaybills = pgTable(
  'transport_waybills',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** ТН-NNNNN, сквозной по арендатору */
    number: text('number').notNull(),
    tripId: uuid('trip_id'),
    stopId: uuid('stop_id'),
    deliveryId: uuid('delivery_id'),
    /** Статус электронной накладной: пока всегда «не оформлена» */
    etrnStatus: text('etrn_status', { enum: ['none', 'draft', 'sent', 'signed', 'rejected'] }).notNull().default('none'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('transport_waybills_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('transport_waybills_ws_number_uq').on(t.workspaceId, t.number),
    foreignKey({ columns: [t.workspaceId, t.tripId], foreignColumns: [fleetTrips.workspaceId, fleetTrips.id], name: 'transport_waybills_trip_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.stopId], foreignColumns: [fleetTripStops.workspaceId, fleetTripStops.id], name: 'transport_waybills_stop_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.deliveryId], foreignColumns: [deliveries.workspaceId, deliveries.id], name: 'transport_waybills_delivery_fk' }).onDelete('set null'),
    check('transport_waybills_etrn_chk', sql`${t.etrnStatus} in ('none','draft','sent','signed','rejected')`),
    index('transport_waybills_trip_idx').on(t.tripId),
    index('transport_waybills_delivery_idx').on(t.deliveryId),
  ],
);
/** Запуски маршрутизации (задача 1213): «Распределить» на день и «Оптимизировать порядок» рейса. Строка создаётся в API,
    задача воркера ведёт статус и пишет итог — по ней интерфейс показывает ход и результат */
export const fleetRoutingRuns = pgTable(
  'fleet_routing_runs',
  {
    id: pk(),
    workspaceId: wsCol(),
    kind: text('kind', { enum: ['distribute', 'optimize'] }).notNull(),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] }).notNull().default('queued'),
    /** День распределения; для оптимизации — день начала рейса */
    date: date('date', { mode: 'string' }).notNull(),
    tripId: uuid('trip_id'),
    requestedBy: uuid('requested_by'),
    /** Чем считали: провайдер или прямая; предупреждение — провайдер ответил ошибкой, и расчёт сделан по прямой */
    source: text('source', { enum: ['provider', 'straight'] }),
    warning: text('warning'),
    /** Итог: созданные рейсы, число точек, нераспределённые доставки, пропущенные машины с причиной */
    summary: jsonb('summary').$type<RoutingRunSummary>(),
    error: text('error'),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  t => [
    unique('fleet_routing_runs_ws_id_uq').on(t.workspaceId, t.id),
    check('fleet_routing_runs_kind_chk', sql`${t.kind} in ('distribute','optimize')`),
    check('fleet_routing_runs_status_chk', sql`${t.status} in ('queued','running','done','failed')`),
    index('fleet_routing_runs_date_idx').on(t.workspaceId, t.date, t.createdAt),
  ],
);

export interface RoutingRunSummary {
  tripIds: string[];
  stops: number;
  unassigned: { deliveryId: string; reason: string }[];
  skippedVehicles: { vehicleId: string; reason: string }[];
  /** «Оптимизировать порядок»: длина и время в пути, менялся ли порядок */
  routeKm?: number;
  routeMin?: number;
  reordered?: boolean;
}

/** Неизменяемые отметки водителя; client_id защищает повторную отправку из очереди. */
export const fleetDriverEvents = pgTable('fleet_driver_events', {
  id: pk(),
  workspaceId: wsCol(),
  tripId: uuid('trip_id').notNull(),
  stopId: uuid('stop_id').notNull(),
  driverMemberId: uuid('driver_member_id').notNull(),
  clientId: uuid('client_id').notNull(),
  status: text('status', { enum: ['arrived', 'done', 'failed'] }).notNull(),
  latitude: numeric('latitude', { precision: 9, scale: 6 }),
  longitude: numeric('longitude', { precision: 9, scale: 6 }),
  comment: text('comment').notNull().default(''),
  photo: text('photo'),
  signature: text('signature'),
  createdAt: createdAt(),
}, t => [
  unique('fleet_driver_events_ws_client_uq').on(t.workspaceId, t.clientId),
  foreignKey({ columns: [t.workspaceId, t.tripId], foreignColumns: [fleetTrips.workspaceId, fleetTrips.id], name: 'fleet_driver_events_trip_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.workspaceId, t.stopId], foreignColumns: [fleetTripStops.workspaceId, fleetTripStops.id], name: 'fleet_driver_events_stop_fk' }).onDelete('cascade'),
  foreignKey({ columns: [t.workspaceId, t.driverMemberId], foreignColumns: [members.workspaceId, members.id], name: 'fleet_driver_events_driver_fk' }),
  check('fleet_driver_events_status_chk', sql`${t.status} in ('arrived','done','failed')`),
  check('fleet_driver_events_coords_chk', sql`(${t.latitude} is null and ${t.longitude} is null) or (${t.latitude} is not null and ${t.longitude} is not null and ${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180)`),
  check('fleet_driver_events_pod_size_chk', sql`coalesce(octet_length(${t.photo}), 0) <= 2097152 and coalesce(octet_length(${t.signature}), 0) <= 524288`),
  index('fleet_driver_events_stop_idx').on(t.stopId, t.createdAt),
]);

/** Касса закрепляется за водителем и организацией, а не выбирается из общих касс. */
export const fleetDriverRegisters = pgTable('fleet_driver_registers', {
  id: pk(), workspaceId: wsCol(), driverMemberId: uuid('driver_member_id').notNull(),
  organizationId: uuid('organization_id').notNull(), cashRegisterId: uuid('cash_register_id').notNull(),
}, t => [
  unique('fleet_driver_registers_driver_org_uq').on(t.workspaceId, t.driverMemberId, t.organizationId),
  foreignKey({ columns: [t.workspaceId, t.driverMemberId], foreignColumns: [members.workspaceId, members.id], name: 'fleet_driver_registers_driver_fk' }),
  foreignKey({ columns: [t.workspaceId, t.organizationId], foreignColumns: [organizations.workspaceId, organizations.id], name: 'fleet_driver_registers_org_fk' }),
  foreignKey({ columns: [t.workspaceId, t.cashRegisterId], foreignColumns: [cashRegisters.workspaceId, cashRegisters.id], name: 'fleet_driver_registers_cash_fk' }),
]);

export const fleetDriverPayments = pgTable('fleet_driver_payments', {
  id: pk(), workspaceId: wsCol(), clientId: uuid('client_id').notNull(),
  tripId: uuid('trip_id').notNull(), stopId: uuid('stop_id').notNull(), driverMemberId: uuid('driver_member_id').notNull(),
  paymentId: uuid('payment_id').notNull(), amount: numeric('amount', { precision: 18, scale: 2 }).notNull(), createdAt: createdAt(),
}, t => [
  unique('fleet_driver_payments_client_uq').on(t.workspaceId, t.clientId),
  foreignKey({ columns: [t.workspaceId, t.tripId], foreignColumns: [fleetTrips.workspaceId, fleetTrips.id], name: 'fleet_driver_payments_trip_fk' }),
  foreignKey({ columns: [t.workspaceId, t.stopId], foreignColumns: [fleetTripStops.workspaceId, fleetTripStops.id], name: 'fleet_driver_payments_stop_fk' }),
  foreignKey({ columns: [t.workspaceId, t.driverMemberId], foreignColumns: [members.workspaceId, members.id], name: 'fleet_driver_payments_driver_fk' }),
  foreignKey({ columns: [t.workspaceId, t.paymentId], foreignColumns: [documents.workspaceId, documents.id], name: 'fleet_driver_payments_payment_fk' }),
]);

export const fleetDriverReturns = pgTable('fleet_driver_returns', {
  id: pk(), workspaceId: wsCol(), clientId: uuid('client_id').notNull(), tripId: uuid('trip_id').notNull(),
  stopId: uuid('stop_id').notNull(), driverMemberId: uuid('driver_member_id').notNull(), returnId: uuid('return_id').notNull(),
  lines: jsonb('lines').$type<{ lineId: string; qty: string }[]>().notNull(), createdAt: createdAt(),
}, t => [
  unique('fleet_driver_returns_client_uq').on(t.workspaceId, t.clientId),
  foreignKey({ columns: [t.workspaceId, t.tripId], foreignColumns: [fleetTrips.workspaceId, fleetTrips.id], name: 'fleet_driver_returns_trip_fk' }),
  foreignKey({ columns: [t.workspaceId, t.stopId], foreignColumns: [fleetTripStops.workspaceId, fleetTripStops.id], name: 'fleet_driver_returns_stop_fk' }),
  foreignKey({ columns: [t.workspaceId, t.driverMemberId], foreignColumns: [members.workspaceId, members.id], name: 'fleet_driver_returns_driver_fk' }),
  foreignKey({ columns: [t.workspaceId, t.returnId], foreignColumns: [documents.workspaceId, documents.id], name: 'fleet_driver_returns_document_fk' }),
]);
