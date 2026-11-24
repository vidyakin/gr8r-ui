/* Мультиязычность интерфейса: свой лёгкий словарь с типизированными ключами (решение — в docs/architecture/i18n.md).
   Английский словарь (./en) — источник ключей; ./ru обязан повторять его форму, иначе ошибка типов.
   t('catalog.title'), t('common.items', { count: 3 }) — плюрализация через Intl.PluralRules, подстановки {name} */
import * as React from 'react';
import type { en } from './en';
import { getLocale, intlLocale, setLocaleLoader, useLocale, type Locale } from './locale';
import { useFormatPrefsVersion } from './format-prefs';
import type { Plural, Widen } from './types';

export * from './locale';
export * from './format';
export * from './format-prefs';
export type { Plural, Widen } from './types';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | { other: string } ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Любой ключ словаря: 'nav.home', 'catalog.product.new' */
export type TKey = Leaves<typeof en>;
export type TParams = Record<string, string | number | null | undefined>;

type Dict = Widen<typeof en>;

/* Словари грузятся отдельными чанками, в браузер приходит только активный язык (Lighthouse: оба словаря — ~1,8 МБ JS
   при старте). main.tsx ждёт loadLocale(getLocale()) до первой отрисовки; setLocale на незагруженный язык сначала
   догружает словарь, потом переключает. Тесты, которые зовут t(), сначала ждут loadLocale нужных языков. */
const LOADERS: Record<Locale, () => Promise<Dict>> = {
  en: () => import('./en').then(m => m.en),
  ru: () => import('./ru').then(m => m.ru),
  es: () => import('./es').then(m => m.es),
};
const DICTS: Partial<Record<Locale, Dict>> = {};
const loading = new Map<Locale, Promise<void>>();

/** Загрузить словарь языка (повторный вызов — тот же промис) */
export function loadLocale(l: Locale): Promise<void> {
  if (DICTS[l]) return Promise.resolve();
  let p = loading.get(l);
  if (!p) {
    p = LOADERS[l]().then(d => {
      DICTS[l] = d;
    });
    p.catch(() => loading.delete(l));
    loading.set(l, p);
  }
  return p;
}
setLocaleLoader(l => (DICTS[l] ? null : loadLocale(l)));

/** Словарь текущего языка; пока он грузится — любой уже загруженный */
const activeDict = (l: Locale) => DICTS[l] ?? DICTS.en ?? DICTS.ru;

const pluralRules = new Map<Locale, Intl.PluralRules>();

function lookup(dict: unknown, key: string): string | Plural | undefined {
  let v: unknown = dict;
  for (const part of key.split('.')) v = (v as Record<string, unknown> | undefined)?.[part];
  return v as string | Plural | undefined;
}

function interpolate(s: string, params?: TParams) {
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] == null ? m : String(params[k]))) : s;
}

/** Перевод по ключу на текущем языке; нет перевода — английский текст, нет и его — сам ключ */
export function t(key: TKey, params?: TParams): string {
  const l = getLocale();
  let v = lookup(activeDict(l), key) ?? lookup(DICTS.en, key);
  if (v == null) return key;
  if (typeof v !== 'string') {
    const count = Number(params?.count ?? 0);
    let pr = pluralRules.get(l);
    if (!pr) pluralRules.set(l, (pr = new Intl.PluralRules(intlLocale(l))));
    v = v[pr.select(count) as keyof Plural] ?? v.other;
    // «#» в формах множественного числа — само число
    v = v.replace(/#/g, String(count));
  }
  return interpolate(v, params);
}

/** Подпись значения из @erp/shared (VAT_LABELS и т. п.): enums.<group>.<value>, без перевода — fallback */
export function tEnum(group: keyof typeof en.enums, value: string, fallback: string): string {
  const key = `enums.${group}.${value}`;
  return hasKey(key) ? t(key) : fallback;
}

/** Подпись значения из productionEnums (состояния заказов, планов, покрытия и т. п.); нет перевода — fallback */
export function tProductionEnum(group: keyof typeof en.productionEnums, value: string, fallback: string): string {
  const key = `productionEnums.${group}.${value}`;
  return hasKey(key) ? t(key as TKey) : fallback;
}

/** Есть ли ключ в словаре (для перевода по динамическим кодам, например кодам ошибок API) */
export const hasKey = (key: string): key is TKey => lookup(activeDict(getLocale()), key) != null;

/** t с подпиской на смену языка: компонент перерисуется при переключении */
export function useT() {
  useLocale();
  return t;
}

/** Перемонтирует дерево при смене языка и личных настроек показа дат: обычные функции (fmtDate, money) тоже перечитают язык. Состояние экранов при этом
    сбрасывается — язык меняют редко, а кеш React Query живёт вне дерева */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const fmt = useFormatPrefsVersion();
  return <React.Fragment key={`${locale}:${fmt}`}>{children}</React.Fragment>;
}
