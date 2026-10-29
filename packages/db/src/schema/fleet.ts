/* Автопарк (задача 1210, docs/architecture/fleet.md): машины, профили водителей, документы со сроками, путевые листы, топливо,
   регламент ТО, ремонты, штрафы. Таблицы арендатора (workspace_id + RLS), ссылки — составные FK. */
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, numeric, pgTable, smallint, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, ts, updatedAt } from './columns';
import { products } from './catalog';
import { companies } from './crm';
import { costItems, documents, warehouses } from './documents';
import { members, wsCol } from './people';

const km = (name: string) => numeric(name, { precision: 12, scale: 3 });
const liters = (name: string) => numeric(name, { precision: 12, scale: 3 });

export const fleetVehicles = pgTable(
  'fleet_vehicles',
  {
    id: pk(),
    workspaceId: wsCol(),
    plate: text('plate').notNull(),
    name: text('name').notNull().default(''),
    kind: text('kind', { enum: ['car', 'van', 'truck', 'tractor', 'trailer', 'special', 'misc'] }).notNull().default('truck'),
    make: text('make').notNull().default(''),
    model: text('model').notNull().default(''),
    vin: text('vin').notNull().default(''),
    year: integer('year'),
    capacityKg: numeric('capacity_kg', { precision: 12, scale: 3 }),
    volumeM3: numeric('volume_m3', { precision: 12, scale: 3 }),
    pallets: integer('pallets'),
    fuelType: text('fuel_type', { enum: ['petrol', 'diesel', 'gas', 'electric'] }).notNull().default('diesel'),
    /** Норма расхода, л/100 км: летняя и зимняя */
    fuelNormSummer: numeric('fuel_norm_summer', { precision: 8, scale: 2 }),
    fuelNormWinter: numeric('fuel_norm_winter', { precision: 8, scale: 2 }),
    tankL: numeric('tank_l', { precision: 8, scale: 2 }),
    /** Текущий пробег, км: растёт при закрытии путевого листа и вводе заправки с одометром */
    odometer: km('odometer').notNull().default('0'),
    status: text('status', { enum: ['active', 'repair', 'inactive'] }).notNull().default('active'),
    /** Закреплённый водитель (по умолчанию в путевом листе) */
    driverMemberId: uuid('driver_member_id'),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('fleet_vehicles_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('fleet_vehicles_ws_plate_uq').on(t.workspaceId, sql`lower(${t.plate})`).where(sql`${t.archivedAt} is null`),
    foreignKey({ columns: [t.workspaceId, t.driverMemberId], foreignColumns: [members.workspaceId, members.id], name: 'fleet_vehicles_driver_fk' }),
    check('fleet_vehicles_nums_chk', sql`${t.odometer} >= 0 and (${t.capacityKg} is null or ${t.capacityKg} >= 0) and (${t.volumeM3} is null or ${t.volumeM3} >= 0) and (${t.pallets} is null or ${t.pallets} >= 0)`),
  ],
);

/** Данные водителя сверх участника: удостоверение, категории (сам водитель — участник с должностью-функцией `driver`) */
export const fleetDriverProfiles = pgTable(
  'fleet_driver_profiles',
  {
    id: pk(),
    workspaceId: wsCol(),
    memberId: uuid('member_id').notNull(),
    licenseNumber: text('license_number').notNull().default(''),
    categories: text('categories').array().notNull().default(sql`'{}'::text[]`),
    phone: text('phone').notNull().default(''),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('fleet_driver_profiles_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('fleet_driver_profiles_member_uq').on(t.workspaceId, t.memberId),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'fleet_driver_profiles_member_fk' }).onDelete('cascade'),
  ],
);

/** Документ со сроком: машины (ОСАГО, КАСКО, техосмотр, тахограф, СТС) или водителя (права, медсправка) */
export const fleetDocuments = pgTable(
  'fleet_documents',
  {
    id: pk(),
    workspaceId: wsCol(),
    kind: text('kind').notNull(),
    ownerKind: text('owner_kind', { enum: ['vehicle', 'driver'] }).notNull(),
    vehicleId: uuid('vehicle_id'),
    memberId: uuid('member_id'),
    number: text('number').notNull().default(''),
    issuedOn: date('issued_on', { mode: 'string' }),
    /** Пусто — бессрочный */
    validUntil: date('valid_until', { mode: 'string' }),
    remindDays: integer('remind_days').notNull().default(30),
    /** Для какого срока уже отправлено напоминание и какое: 0 — нет, 1 — «истекает», 2 — «истёк» (при продлении сбрасывается) */
    notifiedFor: date('notified_for', { mode: 'string' }),
    notifiedStage: smallint('notified_stage').notNull().default(0),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('fleet_documents_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.vehicleId], foreignColumns: [fleetVehicles.workspaceId, fleetVehicles.id], name: 'fleet_documents_vehicle_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'fleet_documents_member_fk' }).onDelete('cascade'),
    check('fleet_documents_owner_chk', sql`(${t.ownerKind} = 'vehicle' and ${t.vehicleId} is not null and ${t.memberId} is null) or (${t.ownerKind} = 'driver' and ${t.memberId} is not null and ${t.vehicleId} is null)`),
    check('fleet_documents_stage_chk', sql`${t.notifiedStage} between 0 and 2 and ${t.remindDays} >= 0`),
    index('fleet_documents_valid_idx').on(t.workspaceId, t.validUntil),
  ],
);

/** Путевой лист. `trip_id` — рейс (задача 1211): внешний ключ добавит она, рейс создаёт путевой лист через createWaybill */
export const fleetWaybills = pgTable(
  'fleet_waybills',
  {
    id: pk(),
    workspaceId: wsCol(),
    number: text('number').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    status: text('status', { enum: ['draft', 'issued', 'closed', 'cancelled'] }).notNull().default('draft'),
    vehicleId: uuid('vehicle_id').notNull(),
    driverMemberId: uuid('driver_member_id').notNull(),
    tripId: uuid('trip_id'),
    organizationId: uuid('organization_id'),
    route: text('route').notNull().default(''),
    departureAt: ts('departure_at'),
    returnAt: ts('return_at'),
    odometerOut: km('odometer_out').notNull().default('0'),
    odometerBack: km('odometer_back'),
    fuelOut: liters('fuel_out').notNull().default('0'),
    fuelBack: liters('fuel_back'),
    /** Норма л/100 км, зафиксированная на дату листа, и расчёт при закрытии */
    normPer100: numeric('norm_per_100', { precision: 8, scale: 2 }).notNull().default('0'),
    distanceKm: km('distance_km'),
    normLiters: liters('norm_liters'),
    actualLiters: liters('actual_liters'),
    medicalOk: boolean('medical_ok').notNull().default(false),
    medicalTime: text('medical_time').notNull().default(''),
    medicalBy: text('medical_by').notNull().default(''),
    techOk: boolean('tech_ok').notNull().default(false),
    techTime: text('tech_time').notNull().default(''),
    techBy: text('tech_by').notNull().default(''),
    comment: text('comment').notNull().default(''),
    issuedAt: ts('issued_at'),
    closedAt: ts('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('fleet_waybills_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('fleet_waybills_ws_number_uq').on(t.workspaceId, t.number),
    foreignKey({ columns: [t.workspaceId, t.vehicleId], foreignColumns: [fleetVehicles.workspaceId, fleetVehicles.id], name: 'fleet_waybills_vehicle_fk' }),
    foreignKey({ columns: [t.workspaceId, t.driverMemberId], foreignColumns: [members.workspaceId, members.id], name: 'fleet_waybills_driver_fk' }),
    check('fleet_waybills_status_chk', sql`${t.status} in ('draft','issued','closed','cancelled')`),
    check('fleet_waybills_nums_chk', sql`${t.odometerOut} >= 0 and ${t.fuelOut} >= 0 and (${t.odometerBack} is null or ${t.odometerBack} >= ${t.odometerOut})`),
    index('fleet_waybills_date_idx').on(t.workspaceId, t.date),
    index('fleet_waybills_vehicle_idx').on(t.vehicleId, t.date),
    index('fleet_waybills_driver_idx').on(t.driverMemberId, t.date),
  ],
);

export const fleetFuelCards = pgTable(
  'fleet_fuel_cards',
  {
    id: pk(),
    workspaceId: wsCol(),
    number: text('number').notNull(),
    name: text('name').notNull().default(''),
    vehicleId: uuid('vehicle_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('fleet_fuel_cards_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('fleet_fuel_cards_ws_number_uq').on(t.workspaceId, sql`lower(${t.number})`).where(sql`${t.archivedAt} is null`),
    foreignKey({ columns: [t.workspaceId, t.vehicleId], foreignColumns: [fleetVehicles.workspaceId, fleetVehicles.id], name: 'fleet_fuel_cards_vehicle_fk' }),
  ],
);

/** Заправка. Расход в затраты: статья «ГСМ», сумма и день хранятся в самой записи (как у доставки, delivery.md) */
export const fleetFuelEntries = pgTable(
  'fleet_fuel_entries',
  {
    id: pk(),
    workspaceId: wsCol(),
    vehicleId: uuid('vehicle_id').notNull(),
    cardId: uuid('card_id'),
    waybillId: uuid('waybill_id'),
    date: date('date', { mode: 'string' }).notNull(),
    liters: liters('liters').notNull(),
    amount: money('amount').notNull().default('0'),
    odometer: km('odometer'),
    station: text('station').notNull().default(''),
    source: text('source', { enum: ['manual', 'csv'] }).notNull().default('manual'),
    /** Ключ строки выписки: повторная загрузка не создаёт дублей */
    externalKey: text('external_key'),
    expenseCostItemId: uuid('expense_cost_item_id'),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('fleet_fuel_entries_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('fleet_fuel_entries_key_uq').on(t.workspaceId, t.externalKey).where(sql`${t.externalKey} is not null`),
    foreignKey({ columns: [t.workspaceId, t.vehicleId], foreignColumns: [fleetVehicles.workspaceId, fleetVehicles.id], name: 'fleet_fuel_entries_vehicle_fk' }),
    foreignKey({ columns: [t.workspaceId, t.cardId], foreignColumns: [fleetFuelCards.workspaceId, fleetFuelCards.id], name: 'fleet_fuel_entries_card_fk' }),
    foreignKey({ columns: [t.workspaceId, t.waybillId], foreignColumns: [fleetWaybills.workspaceId, fleetWaybills.id], name: 'fleet_fuel_entries_waybill_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.expenseCostItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'fleet_fuel_entries_cost_item_fk' }),
    check('fleet_fuel_entries_nums_chk', sql`${t.liters} > 0 and ${t.amount} >= 0`),
    index('fleet_fuel_entries_vehicle_idx').on(t.vehicleId, t.date),
    index('fleet_fuel_entries_waybill_idx').on(t.waybillId),
  ],
);

/** Регламент ТО: через сколько км и/или месяцев, когда делали в последний раз */
export const fleetServicePlans = pgTable(
  'fleet_service_plans',
  {
    id: pk(),
    workspaceId: wsCol(),
    vehicleId: uuid('vehicle_id').notNull(),
    name: text('name').notNull(),
    everyKm: integer('every_km'),
    everyMonths: integer('every_months'),
    lastKm: km('last_km'),
    lastDate: date('last_date', { mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('fleet_service_plans_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.vehicleId], foreignColumns: [fleetVehicles.workspaceId, fleetVehicles.id], name: 'fleet_service_plans_vehicle_fk' }),
    check('fleet_service_plans_chk', sql`(${t.everyKm} is null or ${t.everyKm} > 0) and (${t.everyMonths} is null or ${t.everyMonths} > 0)`),
  ],
);

/** ТО или ремонт — документ: запчасти со склада (списание), работы и сторонние запчасти (прямой расход) */
export const fleetRepairs = pgTable(
  'fleet_repairs',
  {
    id: pk(),
    workspaceId: wsCol(),
    number: text('number').notNull(),
    kind: text('kind', { enum: ['maintenance', 'repair'] }).notNull().default('repair'),
    status: text('status', { enum: ['draft', 'posted', 'cancelled'] }).notNull().default('draft'),
    vehicleId: uuid('vehicle_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    odometer: km('odometer'),
    planId: uuid('plan_id'),
    warehouseId: uuid('warehouse_id'),
    contractorId: uuid('contractor_id'),
    description: text('description').notNull().default(''),
    /** Списание запчастей со склада: документ «Списание», созданный при проведении */
    writeOffDocumentId: uuid('write_off_document_id'),
    /** Затраты: запчасти со склада (по себестоимости), работы и сторонние запчасти (статья «Ремонт и ТО транспорта») */
    partsCost: money('parts_cost').notNull().default('0'),
    directCost: money('direct_cost').notNull().default('0'),
    expenseCostItemId: uuid('expense_cost_item_id'),
    postedAt: ts('posted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('fleet_repairs_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('fleet_repairs_ws_number_uq').on(t.workspaceId, t.number),
    foreignKey({ columns: [t.workspaceId, t.vehicleId], foreignColumns: [fleetVehicles.workspaceId, fleetVehicles.id], name: 'fleet_repairs_vehicle_fk' }),
    foreignKey({ columns: [t.workspaceId, t.planId], foreignColumns: [fleetServicePlans.workspaceId, fleetServicePlans.id], name: 'fleet_repairs_plan_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'fleet_repairs_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.contractorId], foreignColumns: [companies.workspaceId, companies.id], name: 'fleet_repairs_contractor_fk' }),
    foreignKey({ columns: [t.workspaceId, t.writeOffDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'fleet_repairs_write_off_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.expenseCostItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'fleet_repairs_cost_item_fk' }),
    check('fleet_repairs_status_chk', sql`${t.status} in ('draft','posted','cancelled')`),
    index('fleet_repairs_vehicle_idx').on(t.vehicleId, t.date),
  ],
);

export const fleetRepairLines = pgTable(
  'fleet_repair_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    repairId: uuid('repair_id').notNull(),
    kind: text('kind', { enum: ['part', 'work'] }).notNull(),
    /** Запчасть со склада; пусто — работа или купленная запчасть */
    productId: uuid('product_id'),
    name: text('name').notNull(),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('1'),
    price: money('price').notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    unique('fleet_repair_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.repairId], foreignColumns: [fleetRepairs.workspaceId, fleetRepairs.id], name: 'fleet_repair_lines_repair_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'fleet_repair_lines_product_fk' }),
    check('fleet_repair_lines_chk', sql`${t.qty} > 0 and ${t.price} >= 0 and ${t.kind} in ('part','work')`),
    index('fleet_repair_lines_repair_idx').on(t.repairId),
  ],
);

export const fleetFines = pgTable(
  'fleet_fines',
  {
    id: pk(),
    workspaceId: wsCol(),
    vehicleId: uuid('vehicle_id').notNull(),
    /** Водитель: введён вручную или определён по путевому листу на дату */
    driverMemberId: uuid('driver_member_id'),
    waybillId: uuid('waybill_id'),
    date: date('date', { mode: 'string' }).notNull(),
    uin: text('uin').notNull().default(''),
    article: text('article').notNull().default(''),
    amount: money('amount').notNull(),
    status: text('status', { enum: ['unpaid', 'paid', 'appealed'] }).notNull().default('unpaid'),
    paidOn: date('paid_on', { mode: 'string' }),
    /** Удержать с водителя (информация для зарплаты); иначе штраф — затраты компании */
    chargeDriver: boolean('charge_driver').notNull().default(false),
    expenseCostItemId: uuid('expense_cost_item_id'),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('fleet_fines_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('fleet_fines_uin_uq').on(t.workspaceId, t.uin).where(sql`${t.uin} <> ''`),
    foreignKey({ columns: [t.workspaceId, t.vehicleId], foreignColumns: [fleetVehicles.workspaceId, fleetVehicles.id], name: 'fleet_fines_vehicle_fk' }),
    foreignKey({ columns: [t.workspaceId, t.driverMemberId], foreignColumns: [members.workspaceId, members.id], name: 'fleet_fines_driver_fk' }),
    foreignKey({ columns: [t.workspaceId, t.waybillId], foreignColumns: [fleetWaybills.workspaceId, fleetWaybills.id], name: 'fleet_fines_waybill_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.expenseCostItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'fleet_fines_cost_item_fk' }),
    check('fleet_fines_chk', sql`${t.amount} >= 0 and ${t.status} in ('unpaid','paid','appealed')`),
    index('fleet_fines_vehicle_idx').on(t.vehicleId, t.date),
  ],
);
