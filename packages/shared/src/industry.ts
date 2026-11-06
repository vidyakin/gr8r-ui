/* Отраслевые опции воркспейса (задача 1258, docs/architecture/industry-options.md).
   Это бесплатная настройка вида интерфейса, а не модуль тарифа: каталог модулей (licensing.ts) отраслевые опции не трогает.
   Выключенная опция прячет свои разделы меню, поля и колонки; данные, правила проведения и API не меняются. */
import { z } from 'zod';

/** Известные отрасли. Новая отраслевая фича регистрирует себя за одной из них (или добавляет сюда опцию) */
export const INDUSTRY_OPTIONS = ['food', 'construction'] as const;
export type IndustryOption = (typeof INDUSTRY_OPTIONS)[number];

/** Все опции включены (миграция существующих воркспейсов и демо-данные) */
export const ALL_INDUSTRY_OPTIONS: IndustryOption[] = [...INDUSTRY_OPTIONS];

export const industryOptionsSchema = z.array(z.enum(INDUSTRY_OPTIONS));

/** Включена ли опция в наборе воркспейса (пустой набор — ничего не включено) */
export const hasIndustry = (options: readonly string[] | null | undefined, option: IndustryOption): boolean => !!options?.includes(option);

/** Сохранённое значение (например, из БД) → набор опций: неизвестное отбрасывается, повторы схлопываются */
export function resolveIndustryOptions(raw: unknown): IndustryOption[] {
  if (!Array.isArray(raw)) return [];
  const parsed = industryOptionsSchema.safeParse(raw);
  return parsed.success ? [...new Set(parsed.data)] : [];
}
