/* Отраслевые опции воркспейса (задача 1258, docs/architecture/industry-options.md).
   Это бесплатная настройка вида интерфейса, а не модуль тарифа: каталог модулей (licensing.ts) отраслевые опции не трогает.
   Выключенная опция прячет свои разделы меню, поля и колонки; данные, правила проведения и API не меняются. */
import { z } from 'zod';

/** Известные отрасли. Новая отраслевая фича регистрирует себя за одной из них (или добавляет сюда опцию) */
/* Строительство (`construction`) было опцией до миграции 0131, теперь это модуль тарифа «Строительство» (licensing.ts) */
export const INDUSTRY_OPTIONS = ['food'] as const;
export type IndustryOption = (typeof INDUSTRY_OPTIONS)[number];

/** Все опции включены (миграция существующих воркспейсов и демо-данные) */
export const ALL_INDUSTRY_OPTIONS: IndustryOption[] = [...INDUSTRY_OPTIONS];

export const industryOptionsSchema = z.array(z.enum(INDUSTRY_OPTIONS));

/** Включена ли опция в наборе воркспейса (пустой набор — ничего не включено) */
export const hasIndustry = (options: readonly string[] | null | undefined, option: IndustryOption): boolean => !!options?.includes(option);

/** Сохранённое значение (например, из БД) → набор опций: неизвестное отбрасывается, повторы схлопываются */
export function resolveIndustryOptions(raw: unknown): IndustryOption[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is IndustryOption => (INDUSTRY_OPTIONS as readonly unknown[]).includes(v)))];
}
