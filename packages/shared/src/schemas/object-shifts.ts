/* Табель прораба (задача 1271, docs/architecture/construction.md): тела запросов API смены, бригады, бейджей
   и рабочих без входа. Часы работника за смену — итогом, с распределением по позициям сметы; объём смены
   вводится один раз на бригаду. Стоимость часа считает сервер: клиент её не присылает. */
import { z } from 'zod';
import { SHIFT_HOURS_MAX } from '../labor-cost';
import { clientId, decimal, isoDate, shortText, uuid } from './common';

/** Часы за смену: больше нуля и не больше предела (24 ч); сумма по работнику проверяется сервисом */
const hoursValue = decimal.refine(v => Number(v) > 0, 'Hours must be greater than zero').refine(v => Number(v) <= Number(SHIFT_HOURS_MAX), `Hours cannot exceed ${SHIFT_HOURS_MAX} per shift`);

/** Открыть смену: объект, дата и прораб (по умолчанию — сам автор). Повторный вызов возвращает открытую смену */
export const objectShiftCreate = z.object({
  workDate: isoDate,
  /** Прораб смены: member может вести только свои объекты и только от своего имени, admin/owner — любого */
  foremanId: uuid.nullish(),
  note: z.string().max(5000).default(''),
});

/** Строка часов: работник, часы и позиция сметы вида work (пусто — часы без позиции) */
const shiftHourLine = z.object({
  memberId: uuid,
  hours: hoursValue,
  estimateItemId: uuid.nullish(),
  note: z.string().max(500).default(''),
});

/** Объём смены по позиции сметы: один раз на бригаду, не на работника */
const shiftVolumeLine = z.object({
  estimateItemId: uuid,
  qty: decimal.refine(v => Number(v) > 0, 'Quantity must be greater than zero'),
});

/** Пакетное сохранение смены: часы бригады, объёмы и заметка заменяются целиком.
    hours/volumes undefined — не трогать (только заметка), [] — очистить */
export const objectShiftSave = z.object({
  hours: z.array(shiftHourLine).max(500).optional(),
  volumes: z.array(shiftVolumeLine).max(500).optional(),
  note: z.string().max(5000).optional(),
  /** Причина правки подтверждённой смены: обязательна для admin/owner, пишется в журнал смены */
  reason: z.string().trim().max(500).optional(),
});

/** Отмена подтверждения: только admin/owner, причина обязательна */
export const objectShiftUnconfirm = z.object({ reason: z.string().trim().min(1).max(500) });

/** Смены объекта и табель за период */
export const objectShiftQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Рабочий без входа: участник воркспейса без user_id и без membership (status active) */
export const workerCreate = z.object({
  id: clientId,
  name: shortText,
  /** Табельный номер — печатается на бейдже */
  personnelNumber: z.string().trim().max(50).default(''),
  title: z.string().max(200).default(''),
});

/** Бейджи для печати: участники, которым уже выпущен код */
export const badgePrintQuery = z.object({
  ids: z.string().max(4000).optional(),
});

/** Поиск работника по коду бейджа (скан камеры или ручной ввод) */
export const badgeCodeParam = z.object({ code: z.string().trim().min(1).max(40) });
