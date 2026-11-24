/* zod-схемы подмодуля «Добыча»: взвешивания (весовая). */
import { z } from 'zod';
import { isoDateTime, listQuery, uuid } from './common';

export const weighingDirectionSchema = z.enum(['out', 'in']);
export const weighingSourceSchema = z.enum(['manual', 'scale_api']);
export const fleetMeterTypeSchema = z.enum(['odometer', 'engine_hours']);
export type WeighingDirection = z.infer<typeof weighingDirectionSchema>;
export type WeighingSource = z.infer<typeof weighingSourceSchema>;
export type FleetMeterType = z.infer<typeof fleetMeterTypeSchema>;

const text = (max: number) => z.string().trim().max(max);

const weighingShape = z.object({
  weighedAt: isoDateTime.optional(),
  direction: weighingDirectionSchema,
  vehicleId: uuid.nullish(),
  plateNumber: text(20).optional(),
  driverName: text(200).optional(),
  counterpartyId: uuid.nullish(),
  productId: uuid.nullish(),
  grossKg: z.coerce.number().min(0),
  tareKg: z.coerce.number().min(0),
  bulkDensity: z.coerce.number().positive().max(100).nullish(),
  waybillNumber: text(50).optional(),
  source: weighingSourceSchema.optional(),
  notes: text(2000).optional(),
});

export const weighingCreateBody = weighingShape.refine(v => v.grossKg >= v.tareKg, { message: 'grossKg must be >= tareKg', path: ['grossKg'] });
export const weighingPatchBody = weighingShape.partial().refine(v => v.grossKg === undefined || v.tareKg === undefined || v.grossKg >= v.tareKg, { message: 'grossKg must be >= tareKg', path: ['grossKg'] });
export const weighingListQuery = listQuery.extend({
  direction: weighingDirectionSchema.optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  productId: uuid.optional(),
  vehicleId: uuid.optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
export type WeighingCreateBody = z.infer<typeof weighingCreateBody>;
export type WeighingPatchBody = z.infer<typeof weighingPatchBody>;
export type WeighingListQuery = z.infer<typeof weighingListQuery>;
