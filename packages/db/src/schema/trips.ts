/* Рейсы (задача 1211, docs/architecture/trips.md): рейс = машина + водитель(и) + период + точки в порядке объезда.
   Таблицы арендатора (workspace_id + RLS), ссылки — составные FK. Точка ссылается на доставку (delivery_id) или, в будущем, на заявку
   на перевозку (source_kind/source_id без внешнего ключа до задачи 1223). */
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, numeric, pgTable, text, time, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './columns';
import { deliveries } from './delivery';
import { fleetVehicles } from './fleet';
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
