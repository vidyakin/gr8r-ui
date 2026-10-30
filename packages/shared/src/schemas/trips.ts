/* zod-схемы рейсов (задача 1211, docs/architecture/trips.md). */
import { z } from 'zod';
import { STOP_KINDS, STOP_SOURCES, STOP_STATUSES, TRIP_CAPACITY_MODES, TRIP_KINDS, TRIP_STATUSES } from '../trips';
import { decimal, hhmm, isoDate, listQuery, toPatch, uuid } from './common';

const nonNeg = decimal.refine(v => Number(v) >= 0, 'Expected a non-negative number');
const text = (max: number) => z.string().trim().max(max);

export const tripSave = z.object({
  kind: z.enum(TRIP_KINDS).default('city'),
  name: text(200).default(''),
  dateFrom: isoDate,
  /** Пусто — рейс на один день (= dateFrom) */
  dateTo: isoDate.nullish(),
  startTime: hhmm.nullish(),
  endTime: hhmm.nullish(),
  vehicleId: uuid,
  driverMemberId: uuid,
  coDriverMemberId: uuid.nullish(),
  comment: text(2000).default(''),
});
export const tripUpdate = toPatch(tripSave);
export const tripQuery = listQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  vehicleId: uuid.optional(),
  driverId: uuid.optional(),
  status: z.enum(TRIP_STATUSES).optional(),
  kind: z.enum(TRIP_KINDS).optional(),
});

export const tripStopSave = z.object({
  kind: z.enum(STOP_KINDS).default('delivery'),
  /** manual — своя точка; delivery — доставка документа (deliveryId); transport_order — заявка на перевозку (задача 1223) */
  sourceKind: z.enum(STOP_SOURCES).default('manual'),
  sourceId: uuid.nullish(),
  deliveryId: uuid.nullish(),
  title: text(200).default(''),
  address: text(500).default(''),
  lat: z.number().min(-90).max(90).nullish(),
  lon: z.number().min(-180).max(180).nullish(),
  contactName: text(200).default(''),
  contactPhone: text(50).default(''),
  windowFrom: hhmm.nullish(),
  windowTo: hhmm.nullish(),
  /** Какого дня рейса точка; пусто — первого */
  day: isoDate.nullish(),
  weightKg: nonNeg.default('0'),
  volumeM3: nonNeg.default('0'),
  pallets: z.number().int().min(0).max(1000).default(0),
  comment: text(1000).default(''),
  /** Позиция в порядке объезда (с 0); пусто — в конец */
  index: z.number().int().min(0).max(500).optional(),
});
export const tripStopUpdate = toPatch(tripStopSave.omit({ sourceKind: true, sourceId: true, deliveryId: true, index: true }));
export const tripStopOrder = z.object({ stopIds: z.array(uuid).min(1).max(500) });
export const tripStopStatus = z.object({ status: z.enum(STOP_STATUSES), comment: text(1000).optional() });
export const tripAddDelivery = z.object({ deliveryId: uuid, index: z.number().int().min(0).max(500).optional() });

/** Транспортная накладная (1214): область — рейс, точка рейса или доставка; нужна ровно одна из ссылок (доставка может сопровождаться рейсом) */
export const tnCreate = z.object({ tripId: uuid.optional(), stopId: uuid.optional(), deliveryId: uuid.optional() }).refine(v => !!(v.tripId || v.stopId || v.deliveryId), { message: 'tripId, stopId or deliveryId is required' });

export const tripSettingsSave = z.object({ capacityMode: z.enum(TRIP_CAPACITY_MODES) });
export const dispatchQuery = z.object({ date: isoDate });

/** Водительская отметка: координаты задаются парой; POD ограничен и хранится в БД. */
export const driverStopEvent = z.object({
  clientId: z.uuid(),
  status: z.enum(['arrived', 'done', 'failed']),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  comment: z.string().max(1000).optional(),
  photo: z.string().max(2_097_152).optional(),
  signature: z.string().max(524_288).optional(),
}).refine(v => (v.latitude === undefined) === (v.longitude === undefined), { message: 'Coordinates must be supplied together' });

export const driverCashPayment = z.object({ clientId: z.uuid(), amount: decimal.refine(v => /^\d+(?:\.\d{1,2})?$/.test(v) && Number(v) > 0, 'Positive amount with at most two decimals required') });

export const driverPartialReturn = z.object({ clientId: z.uuid(), lines: z.array(z.object({ lineId: z.uuid(), qty: decimal.refine(v => /^\d+(?:\.\d{1,3})?$/.test(v) && Number(v) > 0, 'Positive quantity required') })).min(1).max(200) }).refine(v => new Set(v.lines.map(l => l.lineId)).size === v.lines.length, 'Duplicate lines');
