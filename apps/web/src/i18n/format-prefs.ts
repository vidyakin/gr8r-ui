/* Личные настройки показа дат и времени (Настройки → Дата и время): внешний store, как locale.ts. Форматтеры читают его вне React,
   I18nProvider перемонтирует дерево при смене. Заполняется из session.user.prefs (SessionProvider) */
import * as React from 'react';
import { USER_PREFS_DEFAULTS, type UserPrefs } from '@gr8r/shared';

export type FormatPrefs = Pick<UserPrefs, 'tz' | 'dateFmt' | 'weekStart' | 'timeFmt'>;

const pick = (p: UserPrefs): FormatPrefs => ({ tz: p.tz, dateFmt: p.dateFmt, weekStart: p.weekStart, timeFmt: p.timeFmt });

let current: FormatPrefs = pick(USER_PREFS_DEFAULTS);
let version = 0;
const subs = new Set<() => void>();

export const getFormatPrefs = () => current;
/** Первый день недели числом (0 — воскресенье) */
export const weekStartsOn = (): 0 | 1 | 6 => Number(current.weekStart) as 0 | 1 | 6;

export function setFormatPrefs(p: UserPrefs) {
  const next = pick(p);
  if (next.tz === current.tz && next.dateFmt === current.dateFmt && next.weekStart === current.weekStart && next.timeFmt === current.timeFmt) return;
  current = next;
  version++;
  subs.forEach(f => f());
}

/** Счётчик смен: меняется, когда поменялась настройка показа дат */
export function useFormatPrefsVersion(): number {
  return React.useSyncExternalStore(
    cb => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => version,
  );
}
