/* zod-схемы доставки (задача 1100, docs/architecture/delivery.md). */
import { z } from 'zod';
import { DELIVERY_KINDS, DELIVERY_STATUSES } from '../delivery';
import { decimal, hhmm, isoDate, listQuery, uuid } from './common';

const nonNeg = decimal.refine(v => Number(v) >= 0, 'Expected a non-negative number');

/** Тариф: недостающие части — 0 (при правке не затирают прежние значения) */
export const deliveryRate = z.object({ base: nonNeg.optional(), perKm: nonNeg.optional(), perKg: nonNeg.optional(), min: nonNeg.optional() });

export const deliveryMethodSave = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(DELIVERY_KINDS).default('own_courier'),
  productId: uuid.nullish(),
  carrierCompanyId: uuid.nullish(),
  clientRate: deliveryRate.default({}),
  costRate: deliveryRate.default({}),
  freeFrom: nonNeg.nullish(),
});
export const deliveryMethodUpdate = deliveryMethodSave.partial();
export const deliveryMethodQuery = z.object({ archived: z.enum(['exclude', 'include', 'only']).default('exclude') });

/** Доставка документа: пересчёт цены и себестоимости — сервером, если поля не заданы явно */
export const deliverySave = z.object({
  methodId: uuid.nullish(),
  address: z.string().trim().max(500).optional(),
  contactName: z.string().trim().max(200).optional(),
  contactPhone: z.string().trim().max(50).optional(),
  deliveryDate: isoDate.nullish(),
  windowFrom: hhmm.nullish(),
  windowTo: hhmm.nullish(),
  distanceKm: nonNeg.optional(),
  weightKg: nonNeg.optional(),
  price: nonNeg.optional(),
  ourCost: nonNeg.optional(),
  courierMemberId: uuid.nullish(),
  carrierCompanyId: uuid.nullish(),
  comment: z.string().max(2000).optional(),
  /** Пересчитать цену и себестоимость по тарифу (иначе значения остаются, как заданы) */
  recalc: z.boolean().optional(),
  /** Пересчитать вес по строкам документа */
  recalcWeight: z.boolean().optional(),
});

export const deliveryStatusChange = z.object({
  status: z.enum(DELIVERY_STATUSES),
  comment: z.string().max(2000).optional(),
});

export const deliveryAssign = z.object({ courierMemberId: uuid.nullable() });

export const deliveryQuery = listQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  courierId: uuid.optional(),
  methodId: uuid.optional(),
  status: z.enum(DELIVERY_STATUSES).optional(),
});

export const deliveryReportQuery = z.object({
  from: isoDate,
  to: isoDate,
  by: z.enum(['method', 'courier', 'day', 'month']).default('method'),
});

export const courierFlag = z.object({ isCourier: z.boolean() });
