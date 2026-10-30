/* Заявки на перевозку, тарифы по направлениям и экспедирование (задача 1223, docs/architecture/transport-orders.md).
   Решения — docs/plans/2026-10-30-tms.md, п. 8. Таблицы арендатора (workspace_id + RLS), ссылки — составные FK (workspace_id, id).
   Заявка — документ заказчика (не документ продаж): маршрут, груз, даты, ставка клиенту; из неё создаются рейс (fleet_trips, 1211),
   счёт и акт (documents: invoice / act). Наём перевозчика — отдельная таблица на рейс (одна запись на рейс), чтобы не трогать схему
   рейсов 1211/1212: ставка перевозчику, реквизиты его машины и водителя, печать договора-заявки. */
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { companies } from './crm';
import { documents, organizations } from './documents';
import { fleetTrips } from './trips';
import { wsCol } from './people';

/** Тариф по направлению: откуда/куда свободным текстом (город или область), вид ставки и её размер.
    Используется заявкой как справочная подсказка расчётной ставки; сама заявка хранит выбранную ставку числом. */
export const transportRateSchedules = pgTable(
  'transport_rate_schedules',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    fromPlace: text('from_place').notNull().default(''),
    toPlace: text('to_place').notNull().default(''),
    /** Тип кузова, под который действует тариф; пусто — любой */
    bodyType: text('body_type').notNull().default(''),
    /** Вид ставки: за весь рейс, за километр, за тонну (на км домножается расстояние, на тонну — вес груза) */
    rateKind: text('rate_kind', { enum: ['flat', 'per_km', 'per_ton'] }).notNull().default('flat'),
    rate: money('rate').notNull().default('0'),
    /** Ориентировочное расстояние направления, км — для расчёта per_km без карты (1213 посчитает точнее) */
    distanceKm: numeric('distance_km', { precision: 9, scale: 1 }),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('transport_rate_schedules_ws_id_uq').on(t.workspaceId, t.id),
    check('transport_rate_schedules_rate_chk', sql`${t.rateKind} in ('flat','per_km','per_ton')`),
    check('transport_rate_schedules_amount_chk', sql`${t.rate} >= 0`),
    index('transport_rate_schedules_route_idx').on(t.workspaceId, t.fromPlace, t.toPlace),
  ],
);

/** Заявка на перевозку: документ заказчика. Номер сквозной по арендатору (ЗП-ГГГГ-NNNNN, как у других документов,
    но это не бухгалтерский документ — своя последовательность под advisory-блокировкой). */
export const transportOrders = pgTable(
  'transport_orders',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** ЗП-ГГГГ-NNNNN */
    number: text('number').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    status: text('status', { enum: ['draft', 'confirmed', 'in_progress', 'done', 'cancelled'] }).notNull().default('draft'),
    organizationId: uuid('organization_id').notNull(),
    /** Заказчик перевозки */
    customerCompanyId: uuid('customer_company_id').notNull(),
    /** Маршрут верхнего уровня для списков и печати; точки — transport_order_points */
    fromPlace: text('from_place').notNull().default(''),
    toPlace: text('to_place').notNull().default(''),
    /** Даты готовности груза и требуемой доставки */
    readyDate: date('ready_date', { mode: 'string' }),
    deliveryDate: date('delivery_date', { mode: 'string' }),
    /** Груз */
    cargoName: text('cargo_name').notNull().default(''),
    weightKg: numeric('weight_kg', { precision: 18, scale: 3 }).notNull().default('0'),
    volumeM3: numeric('volume_m3', { precision: 12, scale: 3 }).notNull().default('0'),
    places: integer('places').notNull().default(0),
    bodyType: text('body_type').notNull().default(''),
    /** Ставка клиенту: по тарифу направления (rateScheduleId) или договорная (rateScheduleId пусто) */
    rateScheduleId: uuid('rate_schedule_id'),
    rateKind: text('rate_kind', { enum: ['flat', 'per_km', 'per_ton'] }).notNull().default('flat'),
    rate: money('rate').notNull().default('0'),
    distanceKm: numeric('distance_km', { precision: 9, scale: 1 }),
    /** Итоговая сумма клиенту = computeTransportOrderAmount(...), хранится для списка и печати */
    amount: money('amount').notNull().default('0'),
    comment: text('comment').notNull().default(''),
    /** Рейс, выполняющий заявку (назначается созданием рейса из заявки или добавлением точек заявки в существующий рейс) */
    tripId: uuid('trip_id'),
    /** Документы продаж, созданные из заявки (услуга «Перевозка») */
    invoiceDocumentId: uuid('invoice_document_id'),
    actDocumentId: uuid('act_document_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('transport_orders_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('transport_orders_ws_number_uq').on(t.workspaceId, t.number),
    foreignKey({ columns: [t.workspaceId, t.organizationId], foreignColumns: [organizations.workspaceId, organizations.id], name: 'transport_orders_org_fk' }),
    foreignKey({ columns: [t.workspaceId, t.customerCompanyId], foreignColumns: [companies.workspaceId, companies.id], name: 'transport_orders_customer_fk' }),
    foreignKey({ columns: [t.workspaceId, t.rateScheduleId], foreignColumns: [transportRateSchedules.workspaceId, transportRateSchedules.id], name: 'transport_orders_rate_schedule_fk' }),
    foreignKey({ columns: [t.workspaceId, t.tripId], foreignColumns: [fleetTrips.workspaceId, fleetTrips.id], name: 'transport_orders_trip_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.invoiceDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'transport_orders_invoice_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.actDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'transport_orders_act_fk' }).onDelete('set null'),
    check('transport_orders_status_chk', sql`${t.status} in ('draft','confirmed','in_progress','done','cancelled')`),
    check('transport_orders_rate_chk', sql`${t.rateKind} in ('flat','per_km','per_ton')`),
    check('transport_orders_cargo_chk', sql`${t.weightKg} >= 0 and ${t.volumeM3} >= 0 and ${t.places} >= 0 and ${t.rate} >= 0 and ${t.amount} >= 0`),
    index('transport_orders_date_idx').on(t.workspaceId, t.date),
    index('transport_orders_customer_idx').on(t.customerCompanyId),
    index('transport_orders_trip_idx').on(t.tripId),
  ],
);

/** Точки маршрута заявки (откуда, куда и промежуточные) — порядок объезда, перенесётся в точки рейса при создании рейса из заявки. */
export const transportOrderPoints = pgTable(
  'transport_order_points',
  {
    id: pk(),
    workspaceId: wsCol(),
    orderId: uuid('order_id').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind', { enum: ['load', 'unload'] }).notNull().default('load'),
    address: text('address').notNull().default(''),
    contactName: text('contact_name').notNull().default(''),
    contactPhone: text('contact_phone').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [
    unique('transport_order_points_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.orderId], foreignColumns: [transportOrders.workspaceId, transportOrders.id], name: 'transport_order_points_order_fk' }).onDelete('cascade'),
    check('transport_order_points_kind_chk', sql`${t.kind} in ('load','unload')`),
    index('transport_order_points_order_idx').on(t.orderId, t.seq),
  ],
);

/** Экспедирование: рейс отдан наёмному перевозчику. Одна запись на рейс (составной уникальный индекс), чтобы не менять
    схему fleet_trips (её же меняет задача 1212). Ставка клиенту берётся из заявок рейса; здесь — вторая ставка (перевозчику)
    и реквизиты его машины/водителя для печати договора-заявки. Маржа экспедитора = ставка клиенту − ставка перевозчику. */
export const fleetTripCarriers = pgTable(
  'fleet_trip_carriers',
  {
    id: pk(),
    workspaceId: wsCol(),
    tripId: uuid('trip_id').notNull(),
    /** Перевозчик (компания-контрагент) */
    carrierCompanyId: uuid('carrier_company_id').notNull(),
    /** Ставка перевозчику за рейс */
    rate: money('rate').notNull().default('0'),
    /** Реквизиты машины и водителя перевозчика — свободный текст, т. к. это не наш автопарк (fleet_vehicles/members) */
    vehiclePlate: text('vehicle_plate').notNull().default(''),
    vehicleModel: text('vehicle_model').notNull().default(''),
    driverName: text('driver_name').notNull().default(''),
    driverPhone: text('driver_phone').notNull().default(''),
    driverLicense: text('driver_license').notNull().default(''),
    contractNumber: text('contract_number').notNull().default(''),
    contractDate: date('contract_date', { mode: 'string' }),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('fleet_trip_carriers_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('fleet_trip_carriers_trip_uq').on(t.tripId),
    foreignKey({ columns: [t.workspaceId, t.tripId], foreignColumns: [fleetTrips.workspaceId, fleetTrips.id], name: 'fleet_trip_carriers_trip_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.carrierCompanyId], foreignColumns: [companies.workspaceId, companies.id], name: 'fleet_trip_carriers_company_fk' }),
    check('fleet_trip_carriers_rate_chk', sql`${t.rate} >= 0`),
    index('fleet_trip_carriers_carrier_idx').on(t.carrierCompanyId),
  ],
);

/** Прочие затраты рейса сверх автопарка (платные дороги, амортизация ставкой на км…): топливо и зарплата считаются по автопарку
    и путевому листу, а эти — вручную статьёй затрат, как у доставки и ремонта (см. docs/architecture/fleet.md, «Затраты»). */
export const fleetTripCosts = pgTable(
  'fleet_trip_costs',
  {
    id: pk(),
    workspaceId: wsCol(),
    tripId: uuid('trip_id').notNull(),
    costItemId: uuid('cost_item_id').notNull(),
    amount: money('amount').notNull().default('0'),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('fleet_trip_costs_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.tripId], foreignColumns: [fleetTrips.workspaceId, fleetTrips.id], name: 'fleet_trip_costs_trip_fk' }).onDelete('cascade'),
    check('fleet_trip_costs_amount_chk', sql`${t.amount} >= 0`),
    index('fleet_trip_costs_trip_idx').on(t.tripId),
  ],
);
