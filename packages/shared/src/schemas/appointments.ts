/* zod-схемы записи на приём (задача 1171). */
import { z } from 'zod';
import { APPOINTMENT_STATUSES, SLOT_MINUTES } from '../appointments';
import { decimal, isoDate, listQuery, uuid } from './common';

const minute = z.number().int().min(0).max(1439);

export const scheduleUpdate = z
  .object({
    slotMinutes: z.number().int().refine(v => (SLOT_MINUTES as readonly number[]).includes(v), 'invalid_slot_minutes'),
    dayStartMin: z.number().int().min(0).max(1439),
    dayEndMin: z.number().int().min(1).max(1440),
    week: z.record(z.string().regex(/^[1-7]$/), z.array(minute).max(200)),
  })
  .refine(v => v.dayEndMin > v.dayStartMin, { message: 'invalid_range', path: ['dayEndMin'] });

export const scheduleExceptionUpdate = z.object({
  /** null — выходной */
  slots: z.array(minute).max(200).nullable(),
  note: z.string().max(500).default(''),
});

export const appointmentCreate = z
  .object({
    specialistId: uuid,
    contactId: uuid.nullish(),
    companyId: uuid.nullish(),
    productId: uuid,
    date: isoDate,
    startMin: minute,
    price: decimal.optional(),
    comment: z.string().max(2000).default(''),
  })
  .refine(v => !!v.contactId || !!v.companyId, { message: 'client_required', path: ['contactId'] });

/** Новый клиент прямо в диалоге записи: физлицо с телефоном */
export const appointmentClientCreate = z.object({ name: z.string().trim().min(1).max(200), phone: z.string().trim().min(3).max(40) });

export const appointmentUpdate = z.object({ comment: z.string().max(2000).optional(), price: decimal.optional() });
export const appointmentCancel = z.object({ reason: z.string().trim().min(1).max(1000) });
export const appointmentMove = z.object({ specialistId: uuid.optional(), date: isoDate, startMin: minute });

export const appointmentListQuery = listQuery.extend({
  specialistId: uuid.optional(),
  contactId: uuid.optional(),
  companyId: uuid.optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export const appointmentDayQuery = z.object({ date: isoDate });
export const appointmentWeekQuery = z.object({ specialistId: uuid, from: isoDate });
export const appointmentFreeQuery = z.object({ productId: uuid, specialistId: uuid.optional(), from: isoDate.optional(), fromMin: z.coerce.number().int().min(0).max(1439).optional() });
export const unclosedDaysQuery = z.object({ specialistId: uuid.optional() });

export const serviceDayLineInput = z.object({
  id: uuid.optional(),
  companyId: uuid,
  contactId: uuid.nullish(),
  productId: uuid,
  startMin: minute.nullish(),
  qty: decimal.default('1'),
  price: decimal,
});
export const serviceDayCreate = z.object({ specialistId: uuid, date: isoDate, comment: z.string().max(2000).default('') });
export const serviceDayUpdate = z.object({ comment: z.string().max(2000).optional(), lines: z.array(serviceDayLineInput).max(500).optional() });
