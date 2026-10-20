/* Личные настройки, которым не нужен бэкенд, — состояние Settings из S.prefs / D().notifPrefs / sessions / tfa / plan оригинала.
   Тема, акцент, плотность и движение живут в Gr8rProvider (usePrefs), имя и воркспейс — в store.tsx. */
import * as React from 'react';

export interface Session {
  id: string;
  dev: string;
  loc: string;
  at: string;
  cur?: boolean;
}

export type Plan = 'Free' | 'Team' | 'Business';

export interface Settings {
  lang: string;
  spell: boolean;
  tz: string;
  dateFmt: string;
  weekStart: string;
  timeFmt: string;
  defaultTab: string;
  showDoneBoard: boolean;
  permCreate: boolean;
  permGuests: boolean;
  permPublic: boolean;
  home: string;
  openTasks: string;
  confirmDel: boolean;
  /** Уведомления: email_*, push_*, mention_*, assign_* */
  np: Record<string, boolean>;
  sessions: Session[];
  tfa: boolean;
  plan: Plan;
}

const KEY = 'gr8r-ui.settings';

export const DEFAULT_SETTINGS: Settings = {
  lang: 'English (US)',
  spell: true,
  tz: '(GMT-08:00) Pacific Time',
  dateFmt: 'MMM d',
  weekStart: '1',
  timeFmt: '12',
  defaultTab: 'board',
  showDoneBoard: true,
  permCreate: true,
  permGuests: true,
  permPublic: false,
  home: 'home',
  openTasks: 'drawer',
  confirmDel: true,
  np: {
    email_mention: true,
    email_assign: true,
    email_digest: true,
    email_comment: false,
    push_mention: true,
    push_assign: true,
    push_comment: true,
    push_due: true,
    mention_all: true,
    mention_team: true,
    mention_ws: false,
    assign_self: true,
    assign_status: true,
    assign_over: true,
  },
  sessions: [
    { id: 'se1', dev: 'MacBook Pro · Chrome', loc: 'San Francisco, US', at: 'Active now', cur: true },
    { id: 'se2', dev: 'iPhone 15 · Gr8r app', loc: 'San Francisco, US', at: '2 hours ago' },
    { id: 'se3', dev: 'Windows · Edge', loc: 'Oakland, US', at: 'Sep 12' },
  ],
  tfa: false,
  plan: 'Team',
};

function read(): Settings {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...j, np: { ...DEFAULT_SETTINGS.np, ...(j.np || {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let state: Settings = read();
const subs = new Set<() => void>();

function set(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* хранилище недоступно — работаем в памяти */
  }
  subs.forEach(f => f());
}

/** Настройки с сохранением в localStorage; [значения, patch] */
export function useSettings() {
  const s = React.useSyncExternalStore(
    cb => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
  );
  return [s, set] as const;
}

/** Сброс к исходным (после «Delete workspace», как восстановление демо-данных в оригинале) */
export const resetSettings = () => set({ ...DEFAULT_SETTINGS, np: { ...DEFAULT_SETTINGS.np } });
