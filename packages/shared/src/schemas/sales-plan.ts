/* zod-схемы планирования продаж (задача 1133): сценарии, документ «План продаж», план-фактный анализ. */
import { z } from 'zod';
import { clientId, decimal, isoDate, listQuery, shortText, toPatch, uuid } from './common';

export const salesPlanScenarioCreate = z.object({
  id: clientId,
  name: shortText,
  periodicity: z.enum(['month', 'quarter', 'year']).default('month'),
  dimension: z.enum(['manager', 'category', 'product']).default('manager'),
});
export const salesPlanScenarioUpdate = toPatch(salesPlanScenarioCreate.omit({ id: true }));
export const salesPlanScenarioQuery = listQuery;

export const salesPlanLineInput = z.object({
  id: uuid.optional(),
  /** Начало периода сценария */
  periodStart: isoDate,
  /** Значение разреза: по разрезу сценария заполняется одно из полей; пусто — «без менеджера/категории» */
  memberId: uuid.nullish(),
  categoryId: uuid.nullish(),
  productId: uuid.nullish(),
  amount: decimal,
  /** Количество — только у разреза «товар» */
  qty: decimal.default('0'),
});

export const salesPlanCreate = z.object({
  id: clientId,
  scenarioId: uuid,
  /** Начало плана; нормализуется до начала периода сценария */
  periodStart: isoDate,
  date: isoDate.optional(),
  organizationId: uuid.nullish(),
  warehouseId: uuid.nullish(),
  comment: z.string().max(5000).default(''),
  lines: z.array(salesPlanLineInput).max(2000).default([]),
});
export const salesPlanUpdate = z.object({
  scenarioId: uuid.optional(),
  periodStart: isoDate.optional(),
  date: isoDate.optional(),
  organizationId: uuid.nullish(),
  warehouseId: uuid.nullish(),
  comment: z.string().max(5000).optional(),
  lines: z.array(salesPlanLineInput).max(2000).optional(),
});
export const salesPlanListQuery = listQuery.extend({ scenarioId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional() });

/** План-фактный анализ: сценарий и период; склад и организация необязательны */
export const salesPlanAnalysisQuery = z.object({ scenarioId: uuid, from: isoDate, to: isoDate, warehouseId: uuid.optional(), organizationId: uuid.optional() });
