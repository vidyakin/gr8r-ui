/* Лёгкий t() лендинга по образцу apps/web/src/i18n: типизированные ключи, подстановки {name}. Пока один язык — русский */
import { ru } from './ru';

export type Dict = typeof ru;

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends readonly unknown[] ? never : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TKey = Leaves<Dict>;

const dict: Dict = ru;

function lookup(key: string): unknown {
  let v: unknown = dict;
  for (const part of key.split('.')) v = (v as Record<string, unknown> | undefined)?.[part];
  return v;
}

export function t(key: TKey, params?: Record<string, string | number>): string {
  const v = lookup(key);
  if (typeof v !== 'string') return key;
  return params ? v.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] == null ? m : String(params[k]))) : v;
}

/** Списки словаря (возможности модуля — название и пояснение, пункты «Что ещё есть») */
export const features = <K extends keyof Dict['modules']>(m: K): readonly (readonly string[])[] => dict.modules[m].features;
export const moreItems = (): readonly (readonly string[])[] => dict.more.items;
export const flowSteps = (): readonly (readonly string[])[] => dict.hero.flow.steps;
