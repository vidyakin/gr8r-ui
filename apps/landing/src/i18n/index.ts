/* Лёгкий t() лендинга: типизированные ключи, подстановки {name}, поддержка локалей ru / en / es */
import { ru } from './ru';
import { en } from './en';
import { es } from './es';
import { DEFAULT_LOCALE, LOCALES, LOCALE_LABELS, localePath, localePrefix, type Dict, type Locale, type TKey } from './types';

export { DEFAULT_LOCALE, LOCALES, LOCALE_LABELS, localePath, localePrefix };
export type { Dict, Locale, TKey };

const dicts: Record<Locale, Dict> = { ru, en, es };

export const getDict = (locale: Locale = DEFAULT_LOCALE): Dict => dicts[locale] ?? dicts[DEFAULT_LOCALE];

function lookup(dict: Dict, key: string): unknown {
  let v: unknown = dict;
  for (const part of key.split('.')) v = (v as Record<string, unknown> | undefined)?.[part];
  return v;
}

export function t(key: TKey, params?: Record<string, string | number>, locale: Locale = DEFAULT_LOCALE): string {
  const v = lookup(getDict(locale), key);
  if (typeof v !== 'string') return key;
  return params ? v.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] == null ? m : String(params[k]))) : v;
}

/** Привязанный набор хелперов для конкретной локали (удобно в Astro-страницах и React-островах) */
export function useI18n(locale: Locale = DEFAULT_LOCALE) {
  const d = getDict(locale);
  return {
    locale,
    dict: d,
    t: (key: TKey, params?: Record<string, string | number>) => t(key, params, locale),
    path: (p = '/') => localePath(locale, p),
    home: () => d.home,
    flowSteps: () => d.hero.flow.steps,
    modulePage: <K extends keyof Dict['modulePages'] & keyof Dict['alternative']['modules']>(id: K) => d.modulePages[id],
  };
}

/** Списки словаря (обратная совместимость для существующих импортов) */
export const features = <K extends keyof Dict['modules']>(m: K, locale: Locale = DEFAULT_LOCALE): readonly (readonly string[])[] =>
  getDict(locale).modules[m].features;
export const moreItems = (locale: Locale = DEFAULT_LOCALE): readonly (readonly string[])[] => getDict(locale).more.items;
export const flowSteps = (locale: Locale = DEFAULT_LOCALE): readonly (readonly string[])[] => getDict(locale).hero.flow.steps;
export const modulePage = <K extends keyof Dict['modulePages'] & keyof Dict['alternative']['modules']>(
  id: K,
  locale: Locale = DEFAULT_LOCALE,
): Dict['modulePages'][K] => getDict(locale).modulePages[id];
export const home = (locale: Locale = DEFAULT_LOCALE): Dict['home'] => getDict(locale).home;
