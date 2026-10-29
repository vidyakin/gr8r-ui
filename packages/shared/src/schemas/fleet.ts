/* zod-схемы автопарка (задача 1210, docs/architecture/fleet.md). */
import { z } from 'zod';
import { FINE_STATUSES, FLEET_DOC_KIND_LIST, FUEL_TYPES, REPAIR_KINDS, REPAIR_LINE_KINDS, VEHICLE_KINDS, VEHICLE_STATUSES, WAYBILL_STATUSES } from '../fleet';
import { decimal, isoDate, isoDateTime, listQuery, toPatch, uuid } from './common';

const nonNeg = decimal.refine(v => Number(v) >= 0, 'Expected a non-negative number');
const text = (max: number) => z.string().trim().max(max);

export const vehicleSave = z.object({
  plate: z.string().trim().min(1).max(20),
  name: text(200).default(''),
  kind: z.enum(VEHICLE_KINDS).default('truck'),
  make: text(100).default(''),
  model: text(100).default(''),
  vin: text(30).default(''),
  year: z.number().int().min(1950).max(2100).nullish(),
  capacityKg: nonNeg.nullish(),
  volumeM3: nonNeg.nullish(),
  pallets: z.number().int().min(0).max(1000).nullish(),
  fuelType: z.enum(FUEL_TYPES).default('diesel'),
  fuelNormSummer: nonNeg.nullish(),
  fuelNormWinter: nonNeg.nullish(),
  tankL: nonNeg.nullish(),
  odometer: nonNeg.default('0'),
  status: z.enum(VEHICLE_STATUSES).default('active'),
  driverMemberId: uuid.nullish(),
  comment: text(2000).default(''),
});
export const vehicleUpdate = toPatch(vehicleSave);
export const vehicleQuery = listQuery.extend({ status: z.enum(VEHICLE_STATUSES).optional() });

export const driverProfileSave = z.object({
  licenseNumber: text(50).default(''),
  categories: z.array(z.string().trim().min(1).max(5)).max(20).default([]),
  phone: text(50).default(''),
  comment: text(2000).default(''),
});

export const fleetDocumentSave = z.object({
  kind: z.enum(FLEET_DOC_KIND_LIST),
  vehicleId: uuid.nullish(),
  memberId: uuid.nullish(),
  number: text(100).default(''),
  issuedOn: isoDate.nullish(),
  validUntil: isoDate.nullish(),
  remindDays: z.number().int().min(0).max(365).default(30),
  comment: text(2000).default(''),
});
export const fleetDocumentUpdate = toPatch(fleetDocumentSave);
export const fleetDocumentQuery = listQuery.extend({
  vehicleId: uuid.optional(),
  memberId: uuid.optional(),
  kind: z.enum(FLEET_DOC_KIND_LIST).optional(),
  /** ok | expiring | expired — состояние срока на сегодня */
  term: z.enum(['ok', 'expiring', 'expired']).optional(),
});

const waybillBody = {
  vehicleId: uuid,
  driverMemberId: uuid,
  date: isoDate,
  route: text(1000).default(''),
  departureAt: isoDateTime.nullish(),
  returnAt: isoDateTime.nullish(),
  odometerOut: nonNeg.optional(),
  fuelOut: nonNeg.default('0'),
  odometerBack: nonNeg.nullish(),
  fuelBack: nonNeg.nullish(),
  medicalOk: z.boolean().default(false),
  medicalTime: text(10).default(''),
  medicalBy: text(200).default(''),
  techOk: z.boolean().default(false),
  techTime: text(10).default(''),
  techBy: text(200).default(''),
  /** Рейс (задача 1211): рейс создаёт путевой лист и заполняет эту ссылку */
  tripId: uuid.nullish(),
  comment: text(2000).default(''),
};
export const waybillSave = z.object(waybillBody);
export const waybillUpdate = toPatch(waybillSave);
export const waybillQuery = listQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  vehicleId: uuid.optional(),
  driverId: uuid.optional(),
  status: z.enum(WAYBILL_STATUSES).optional(),
});

export const fuelCardSave = z.object({
  number: z.string().trim().min(1).max(50),
  name: text(200).default(''),
  vehicleId: uuid.nullish(),
});
export const fuelCardUpdate = toPatch(fuelCardSave);

export const fuelEntrySave = z.object({
  vehicleId: uuid,
  cardId: uuid.nullish(),
  waybillId: uuid.nullish(),
  date: isoDate,
  liters: decimal.refine(v => Number(v) > 0, 'Expected a positive number'),
  amount: nonNeg,
  odometer: nonNeg.nullish(),
  station: text(200).default(''),
  comment: text(1000).default(''),
});
export const fuelEntryUpdate = toPatch(fuelEntrySave);
export const fuelQuery = listQuery.extend({ from: isoDate.optional(), to: isoDate.optional(), vehicleId: uuid.optional(), waybillId: uuid.optional() });
export const fuelImport = z.object({ csv: z.string().min(1).max(2_000_000), dryRun: z.boolean().default(false) });

export const servicePlanSave = z.object({
  vehicleId: uuid,
  name: z.string().trim().min(1).max(200),
  everyKm: z.number().int().min(1).max(10_000_000).nullish(),
  everyMonths: z.number().int().min(1).max(600).nullish(),
  lastKm: nonNeg.nullish(),
  lastDate: isoDate.nullish(),
});
export const servicePlanUpdate = toPatch(servicePlanSave);

export const repairLineSave = z.object({
  kind: z.enum(REPAIR_LINE_KINDS),
  /** Запчасть со склада: товар каталога; пусто — купленная на стороне запчасть или работа */
  productId: uuid.nullish(),
  name: z.string().trim().min(1).max(300),
  qty: decimal.refine(v => Number(v) > 0, 'Expected a positive number').default('1'),
  price: nonNeg.default('0'),
});
export const repairSave = z.object({
  vehicleId: uuid,
  kind: z.enum(REPAIR_KINDS).default('repair'),
  date: isoDate,
  odometer: nonNeg.nullish(),
  /** Пункт регламента: при проведении ТО отмечается выполненным */
  planId: uuid.nullish(),
  warehouseId: uuid.nullish(),
  contractorId: uuid.nullish(),
  description: text(2000).default(''),
  lines: z.array(repairLineSave).max(200).default([]),
});
export const repairUpdate = toPatch(repairSave);
export const repairQuery = listQuery.extend({ from: isoDate.optional(), to: isoDate.optional(), vehicleId: uuid.optional(), kind: z.enum(REPAIR_KINDS).optional(), status: z.enum(['draft', 'posted', 'cancelled']).optional() });

export const fineSave = z.object({
  vehicleId: uuid,
  /** Пусто — определяется по путевому листу на дату */
  driverMemberId: uuid.nullish(),
  date: isoDate,
  uin: text(50).default(''),
  article: text(100).default(''),
  amount: nonNeg,
  status: z.enum(FINE_STATUSES).default('unpaid'),
  paidOn: isoDate.nullish(),
  chargeDriver: z.boolean().default(false),
  comment: text(1000).default(''),
});
export const fineUpdate = toPatch(fineSave);
export const fineQuery = listQuery.extend({ from: isoDate.optional(), to: isoDate.optional(), vehicleId: uuid.optional(), driverId: uuid.optional(), status: z.enum(FINE_STATUSES).optional() });

export const fleetCostsQuery = z.object({ from: isoDate, to: isoDate });
