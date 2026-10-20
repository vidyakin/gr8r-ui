/* Общие zod-схемы API: идентификаторы, даты, десятичные числа, список (пагинация/сортировка/архив). */
import { z } from 'zod';

export const uuid = z.uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected time in HH:MM format');
/** Десятичное число: принимается числом или строкой, хранится и отдаётся строкой (numeric в БД) */
export const decimal = z
  .union([z.number().finite(), z.string().regex(/^-?\d+(\.\d+)?$/, 'Expected a decimal number')])
  .transform(v => String(v));
export const color = z.string().min(1).max(64);
export const shortText = z.string().trim().min(1).max(200);

/** Булево из query-строки */
export const queryBool = z.enum(['true', 'false', '1', '0']).transform(v => v === 'true' || v === '1');

/** Параметры списка, общие для всех сущностей */
export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Поле сортировки; префикс "-" — по убыванию. Допустимые поля — у каждой сущности свои */
  sort: z.string().max(64).optional(),
  /** Полнотекстовый поиск по основным текстовым полям */
  q: z.string().trim().max(200).optional(),
  /** Мягко удалённые: exclude (по умолчанию) | include | only */
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
});
export type ListQuery = z.infer<typeof listQuery>;

export const idParam = z.object({ id: uuid });

/** Ответ списка */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Единый формат ошибки API */
export interface ApiError {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

/** Схема PATCH: все поля необязательны, значения по умолчанию снимаются.
    (zod `.partial()` оставляет `.default()` в силе, и PATCH {title} сбросил бы остальные поля к значениям по умолчанию.) */
export function toPatch<S extends z.ZodObject>(schema: S): z.ZodType<Partial<z.output<S>>, Partial<z.input<S>>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(schema.shape as Record<string, z.ZodType>)) shape[k] = (v instanceof z.ZodDefault ? (v.unwrap() as z.ZodType) : v).optional();
  return z.object(shape) as unknown as z.ZodType<Partial<z.output<S>>, Partial<z.input<S>>>;
}
