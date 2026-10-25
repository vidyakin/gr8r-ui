/* Мультиязычность интерфейса: свой лёгкий словарь с типизированными ключами (решение — в docs/architecture/i18n.md).
   Английский словарь (./en) — источник ключей; ./ru обязан повторять его форму, иначе ошибка типов.
   t('catalog.title'), t('common.items', { count: 3 }) — плюрализация через Intl.PluralRules, подстановки {name} */
import * as React from 'react';
import { en } from './en';
import { ru } from './ru';
import { getLocale, intlLocale, useLocale, type Locale } from './locale';
import type { Plural, Widen } from './types';

export * from './locale';
export * from './format';
export type { Plural, Widen } from './types';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | { other: string } ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Любой ключ словаря: 'nav.home', 'catalog.product.new' */
export type TKey = Leaves<typeof en>;
export type TParams = Record<string, string | number | null | undefined>;

const DICTS: Record<Locale, Widen<typeof en>> = { en, ru };

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
  let v = lookup(DICTS[l], key) ?? lookup(en, key);
  if (v == null) return key;
  if (typeof v !== 'string') {
    const count = Number(params?.count ?? 0);
    let pr = pluralRules.get(l);
    if (!pr) pluralRules.set(l, (pr = new Intl.PluralRules(intlLocale(l))));
    v = v[pr.select(count) as keyof Plural] ?? v.other;
  }
  return interpolate(v, params);
}

/** Подпись значения из @gr8r/shared (VAT_LABELS и т. п.): enums.<group>.<value>, без перевода — fallback */
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
export const hasKey = (key: string): key is TKey => lookup(en, key) != null;

/** t с подпиской на смену языка: компонент перерисуется при переключении */
export function useT() {
  useLocale();
  return t;
}

/** Перемонтирует дерево при смене языка: обычные функции (fmtDate, money) тоже перечитают язык. Состояние экранов при этом
    сбрасывается — язык меняют редко, а кеш React Query живёт вне дерева */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  return <React.Fragment key={locale}>{children}</React.Fragment>;
}
