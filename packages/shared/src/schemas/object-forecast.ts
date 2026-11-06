/* Прогноз прибыли объекта (задача 1275): тела запросов API. Ручная правка остатка — по позиции сметы или по
   категории затрат (ровно одна цель), с обязательной причиной; пустое значение не трогает поле. */
import { z } from 'zod';
import { OBJECT_COST_CATEGORIES } from '../constants';
import { decimal, isoDate, uuid } from './common';

/** Правка остатка: новое значение, причина и цель — позиция сметы или категория затрат */
export const forecastOverrideInput = z.object({
  estimateItemId: uuid.nullish(),
  category: z.enum(OBJECT_COST_CATEGORIES).nullish(),
  /** Новое значение остатка (ожидаемых затрат) без НДС */
  remaining: decimal,
  /** Причина обязательна: сервис отвечает 422 forecast_reason_required */
  reason: z.string().max(2000).default(''),
});

/** Снятие правки: по id или по цели — позиция сметы / категория затрат */
export const forecastOverrideDelete = z.object({
  id: uuid.optional(),
  estimateItemId: uuid.optional(),
  category: z.enum(OBJECT_COST_CATEGORIES).optional(),
});

/** Период исполнителей (необязателен): по датам подтверждённых смен */
export const forecastExecutorsQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});
