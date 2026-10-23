/* Текущий язык интерфейса — внешний store (как settings.ts): t() и форматтеры читают его вне компонентов,
   а I18nProvider подписывает дерево на смену языка. Порядок выбора: users.locale → язык воркспейса → localStorage → браузер → en */
import * as React from 'react';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@gr8r/shared';

export type { Locale };
export { LOCALES };

const KEY = 'gr8r-ui.locale';
/** Прежняя заглушка Settings → Language хранила подпись языка в gr8r-ui.settings.lang */
const LEGACY: Record<string, Locale> = { 'English (US)': 'en', 'English (UK)': 'en', Русский: 'ru' };

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/** Язык, запомненный в браузере: экран входа и первый кадр до ответа /auth/me */
function stored(): Locale | null {
  try {
    const v = localStorage.getItem(KEY);
    if (isLocale(v)) return v;
    const legacy = JSON.parse(localStorage.getItem('gr8r-ui.settings') || '{}').lang;
    return LEGACY[legacy] ?? null;
  } catch {
    return null;
  }
}

function fromBrowser(): Locale {
  const langs = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
  for (const l of langs) {
    const base = l?.slice(0, 2).toLowerCase();
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

let current: Locale = stored() ?? fromBrowser();
const subs = new Set<() => void>();

function apply(l: Locale) {
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}
apply(current);

export const getLocale = () => current;

/** Сменить язык (и запомнить в браузере для экрана входа) */
export function setLocale(l: Locale) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* хранилище недоступно */
  }
  if (l === current) return;
  current = l;
  apply(l);
  subs.forEach(f => f());
}

/** Язык из настроек сервера: личный, иначе воркспейса; если оба пусты — остаётся текущий */
export function resolveLocale(user?: string | null, workspace?: string | null): Locale {
  return isLocale(user) ? user : isLocale(workspace) ? workspace : (stored() ?? fromBrowser());
}

export function useLocale(): Locale {
  return React.useSyncExternalStore(
    cb => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
}

/** Локаль для Intl: en → en-US, ru → ru-RU */
export const intlLocale = (l: Locale = current) => (l === 'ru' ? 'ru-RU' : 'en-US');
