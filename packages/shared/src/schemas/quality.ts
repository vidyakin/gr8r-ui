/* zod-схемы контроля качества (задача 1186): справочник причин брака, анализы партий,
   переделка брака и статус партии. Раздел docs/architecture/quality.md. */
import { z } from 'zod';
import { clientId, isoDate, listQuery, shortText, toPatch, uuid } from './common';

/** Статусы партии входного контроля */
export const BATCH_STATUSES = ['ok', 'quarantine', 'rejected'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/* ---------------- справочник причин брака (admin и выше) ---------------- */

export const defectReasonCreate = z.object({
  id: clientId,
  name: shortText,
  note: z.string().trim().max(500).default(''),
});
export const defectReasonUpdate = toPatch(defectReasonCreate.omit({ id: true }));
export const defectReasonQuery = listQuery;

/* ---------------- анализы партии (входной контроль сырья) ---------------- */

export const batchAnalysisCreate = z.object({
  id: clientId,
  /** Показатель: что проверяли (влажность, кислотность, органолептика) */
  indicator: shortText,
  /** Результат анализа */
  result: z.string().trim().max(500).default(''),
  /** Норма или допустимый диапазон */
  norm: z.string().trim().max(500).default(''),
  /** Соответствие норме; пусто — не определено */
  passed: z.boolean().nullish(),
  /** Дата анализа; пусто — сегодня */
  analyzedAt: isoDate.optional(),
  note: z.string().trim().max(500).default(''),
});
export const batchAnalysisUpdate = toPatch(batchAnalysisCreate.omit({ id: true }));

/* ---------------- переделка брака ---------------- */

/** Заказ на производство на переделку брака выпуска: позиция и количество берутся из выпуска */
export const reworkCreate = z.object({
  /** Дата заказа; пусто — сегодня */
  date: isoDate.optional(),
  /** Участок; пусто — участок выпуска */
  workCenterId: uuid.nullish(),
  /** Количество к переделке; пусто — весь брак позиции */
  qty: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
});

/* ---------------- статус партии ---------------- */

/** Смена статуса партии входного контроля: ok, quarantine, rejected */
export const batchStatusUpdate = z.object({ status: z.enum(BATCH_STATUSES) });
