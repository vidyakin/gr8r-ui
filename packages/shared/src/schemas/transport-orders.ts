/* zod-схемы заявок на перевозку, тарифов по направлениям и экспедирования (задача 1223). */
import { z } from 'zod';
import { TRANSPORT_ORDER_STATUSES, TRANSPORT_RATE_KINDS } from '../transport-orders';
import { decimal, isoDate, listQuery, toPatch, uuid } from './common';

const nonNeg = decimal.refine(v => Number(v) >= 0, 'Expected a non-negative number');
const text = (max: number) => z.string().trim().max(max);

/* ---------------- тарифы по направлениям ---------------- */

export const rateScheduleSave = z.object({
  name: text(200).min(1),
  fromPlace: text(200).default(''),
  toPlace: text(200).default(''),
  bodyType: text(100).default(''),
  rateKind: z.enum(TRANSPORT_RATE_KINDS).default('flat'),
  rate: nonNeg.default('0'),
  distanceKm: nonNeg.nullish(),
  comment: text(2000).default(''),
});
export const rateScheduleUpdate = toPatch(rateScheduleSave);
export const rateScheduleQuery = listQuery.extend({ archived: z.enum(['exclude', 'include', 'only']).default('exclude') });

/* ---------------- точки маршрута заявки ---------------- */

export const transportOrderPointSave = z.object({
  kind: z.enum(['load', 'unload']).default('load'),
  address: text(500).default(''),
  contactName: text(200).default(''),
  contactPhone: text(50).default(''),
});

/* ---------------- заявка на перевозку ---------------- */

export const transportOrderSave = z.object({
  date: isoDate,
  organizationId: uuid,
  customerCompanyId: uuid,
  fromPlace: text(200).default(''),
  toPlace: text(200).default(''),
  readyDate: isoDate.nullish(),
  deliveryDate: isoDate.nullish(),
  cargoName: text(500).default(''),
  weightKg: nonNeg.default('0'),
  volumeM3: nonNeg.default('0'),
  places: z.number().int().min(0).max(100000).default(0),
  bodyType: text(100).default(''),
  rateScheduleId: uuid.nullish(),
  rateKind: z.enum(TRANSPORT_RATE_KINDS).default('flat'),
  rate: nonNeg.default('0'),
  distanceKm: nonNeg.nullish(),
  /** Сумма можно задать вручную (договорная); пусто — считается по rateKind/rate */
  amount: nonNeg.optional(),
  comment: text(2000).default(''),
  points: z.array(transportOrderPointSave).max(50).optional(),
});
export const transportOrderUpdate = toPatch(transportOrderSave);

export const transportOrderStatusChange = z.object({ status: z.enum(TRANSPORT_ORDER_STATUSES), comment: text(1000).optional() });

export const transportOrderQuery = listQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(TRANSPORT_ORDER_STATUSES).optional(),
  customerCompanyId: uuid.optional(),
  tripId: uuid.optional(),
});

/** Создать рейс из заявки (новый) или добавить точки заявки в существующий рейс */
export const transportOrderToTrip = z.object({ tripId: uuid.optional() });

/** Создать счёт/акт на основании заявки — услуга «Перевозка» строкой на сумму заявки */
export const transportOrderBilling = z.object({ productId: uuid });

/* ---------------- экспедирование: наёмный перевозчик рейса ---------------- */

export const fleetTripCarrierSave = z.object({
  carrierCompanyId: uuid,
  rate: nonNeg.default('0'),
  vehiclePlate: text(32).default(''),
  vehicleModel: text(200).default(''),
  driverName: text(200).default(''),
  driverPhone: text(50).default(''),
  driverLicense: text(100).default(''),
  contractNumber: text(100).default(''),
  contractDate: isoDate.nullish(),
  comment: text(2000).default(''),
});
export const fleetTripCarrierUpdate = toPatch(fleetTripCarrierSave);

/* ---------------- прочие затраты рейса ---------------- */

export const fleetTripCostSave = z.object({
  costItemId: uuid,
  amount: nonNeg.default('0'),
  comment: text(1000).default(''),
});
export const fleetTripCostUpdate = toPatch(fleetTripCostSave);
