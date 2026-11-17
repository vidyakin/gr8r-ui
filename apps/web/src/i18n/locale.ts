/* Текущий язык интерфейса — внешний store (как settings.ts): t() и форматтеры читают его вне компонентов,
   а I18nProvider подписывает дерево на смену языка. Порядок выбора: users.locale → язык воркспейса → localStorage → браузер → en */
import * as React from 'react';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@erp/shared';

export type { Locale };
export { LOCALES };

const KEY = 'erp-ui.locale';
/** Прежняя заглушка Settings → Language хранила подпись языка в erp-ui.settings.lang */
const LEGACY: Record<string, Locale> = { 'English (US)': 'en', 'English (UK)': 'en', Русский: 'ru' };

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/** Язык, запомненный в браузере: экран входа и первый кадр до ответа /auth/me */
function stored(): Locale | null {
  try {
    const v = localStorage.getItem(KEY);
    if (isLocale(v)) return v;
    const legacy = JSON.parse(localStorage.getItem('erp-ui.settings') || '{}').lang;
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

/** Догрузка словаря (регистрирует index.tsx): null — словарь уже есть, иначе промис загрузки */
let ensureDict: (l: Locale) => Promise<void> | null = () => null;
export function setLocaleLoader(f: (l: Locale) => Promise<void> | null) {
  ensureDict = f;
}

/** Последний запрошенный язык: при быстрых переключениях побеждает он, а не тот, чей словарь догрузился позже */
let target: Locale = current;

function switchTo(l: Locale) {
  if (l === current) return;
  current = l;
  apply(l);
  subs.forEach(f => f());
}

/** Сменить язык (и запомнить в браузере для экрана входа). Словарь загружен — сразу, иначе после его загрузки */
export function setLocale(l: Locale) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* хранилище недоступно */
  }
  target = l;
  const pending = ensureDict(l);
  if (!pending) return switchTo(l);
  pending.then(
    () => {
      if (target === l) switchTo(l);
    },
    () => {
      /* чанк словаря не загрузился (сеть) — остаёмся на текущем языке */
    },
  );
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
    // снимок для серверного рендера (рендер-тесты экранов через react-dom/server)
    () => current,
  );
}

/** Локаль для Intl: en → en-US, ru → ru-RU */
export const intlLocale = (l: Locale = current) => (l === 'ru' ? 'ru-RU' : 'en-US');
