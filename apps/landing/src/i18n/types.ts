/* Типы и вспомогательные функции локализации лендинга (ru / en / es) */
import type { ru } from './ru';

export const LOCALES = ['ru', 'en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';

export const LOCALE_LABELS: Record<Locale, { short: string; name: string }> = {
  ru: { short: 'RU', name: 'Русский' },
  en: { short: 'EN', name: 'English' },
  es: { short: 'ES', name: 'Español' },
};

/** Рекурсивный тип словаря с ослабленными строковыми литералами, чтобы en и es могли иметь те же ключи */
type DeepString<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly DeepString<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepString<T[K]> }
      : T;

export type Dict = DeepString<typeof ru>;

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends readonly unknown[] ? never : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TKey = Leaves<typeof ru>;

/** Префикс URL для локали: '' для ru, '/en' для en, '/es' для es */
export const localePrefix = (locale: Locale): string => (locale === DEFAULT_LOCALE ? '' : `/${locale}`);

/** Строит путь с учётом локали: localePath('en', '/modules/crm/') -> '/en/modules/crm/' */
export function localePath(locale: Locale, path = '/'): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${localePrefix(locale)}${clean}`;
}
