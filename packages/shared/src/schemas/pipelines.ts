/* zod-схемы воронок продаж (задача 1176, docs/architecture/pipelines.md): воронки, этапы, причины проигрыша, отчёт-воронка. */
import { z } from 'zod';
import { LEAD_STATUS_COLORS } from '../leads';
import { DEAL_STAGE_CATEGORIES, isValidRequiredField } from '../pipelines';
import { isoDate, listQuery, shortText, toPatch, uuid } from './common';

const requiredFields = z.array(z.string().max(80).refine(isValidRequiredField, 'Unknown required field')).max(20);

export const dealStageInput = z.object({
  name: shortText,
  category: z.enum(DEAL_STAGE_CATEGORIES).default('in_progress'),
  color: z.enum(LEAD_STATUS_COLORS).default('gray'),
  probability: z.number().int().min(0).max(100).default(0),
  requiredFields: requiredFields.default([]),
  /** Норматив дней на этапе; null — без норматива */
  slaDays: z.number().int().min(0).max(3650).nullish(),
});

export const dealPipelineCreate = z.object({
  name: shortText,
  /** Шаблон набора этапов: sale | service | repeat; не задан — «sale». Либо свой список этапов */
  template: z.string().max(40).optional(),
  stages: z.array(dealStageInput).min(3).max(30).optional(),
});
export const dealPipelineUpdate = z.object({ name: shortText.optional(), isDefault: z.literal(true).optional() });
export const dealPipelineQuery = listQuery.extend({});
/** Порядок воронок: id в нужной последовательности */
export const dealPipelineReorder = z.object({ ids: z.array(uuid).min(1).max(100) });

export const dealStageCreate = dealStageInput.extend({ pipelineId: uuid, sortOrder: z.number().int().min(0).max(10_000).optional() });
export const dealStageUpdate = toPatch(dealStageInput.extend({}));
export const dealStageQuery = listQuery.extend({ pipelineId: uuid.optional() });
/** Порядок этапов воронки: id в нужной последовательности (все этапы воронки) */
export const dealStageReorder = z.object({ pipelineId: uuid, ids: z.array(uuid).min(1).max(100) });

export const dealLostReasonCreate = z.object({ name: shortText, sortOrder: z.number().int().min(0).max(10_000).optional() });
export const dealLostReasonUpdate = toPatch(dealLostReasonCreate);
export const dealLostReasonQuery = listQuery.extend({});
export const dealLostReasonReorder = z.object({ ids: z.array(uuid).min(1).max(100) });

export const dealFunnelQuery = z.object({ pipelineId: uuid.optional(), from: isoDate, to: isoDate });
