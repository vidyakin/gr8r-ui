/* Настройки. Личные настройки пользователя (часовой пояс, формат даты, начало недели, предпочтения, уведомления) лежат на сервере
   в users.prefs и приходят с сессией (session.user.prefs): они следуют за человеком на другие устройства. В браузере остаются
   только настройки этого устройства (проверка орфографии) и заготовки прав воркспейса, которые ещё не ходят на сервер.
   Язык — не здесь, а в src/i18n и users.locale; тема, плотность и движение — в Gr8rProvider (usePrefs). */
import * as React from 'react';
import { resolveUserPrefs, USER_PREFS_DEFAULTS, type UserPrefs } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { useSession } from './session';
import { errorMessage } from './api';

/** Настройки, которые хранятся только в этом браузере */
interface LocalSettings {
  spell: boolean;
  permCreate: boolean;
  permGuests: boolean;
  permPublic: boolean;
}

export type Settings = LocalSettings & UserPrefs;

const KEY = 'gr8r-ui.settings';

const LOCAL_DEFAULTS: LocalSettings = { spell: true, permCreate: true, permGuests: true, permPublic: false };
const LOCAL_KEYS = Object.keys(LOCAL_DEFAULTS) as (keyof LocalSettings)[];

function read(): LocalSettings {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...LOCAL_DEFAULTS, ...Object.fromEntries(LOCAL_KEYS.filter(k => typeof j[k] === 'boolean').map(k => [k, j[k]])) };
  } catch {
    return LOCAL_DEFAULTS;
  }
}

let local: LocalSettings = read();
const subs = new Set<() => void>();

function setLocal(patch: Partial<LocalSettings>) {
  local = { ...local, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(local));
  } catch {
    /* хранилище недоступно — работаем в памяти */
  }
  subs.forEach(f => f());
}

export const DEFAULT_SETTINGS: Settings = { ...LOCAL_DEFAULTS, ...USER_PREFS_DEFAULTS };

/** Личные настройки (с сервера, с умолчаниями) — без заготовок этого устройства */
export function useMyPrefs(): UserPrefs {
  const { user } = useSession();
  return React.useMemo(() => resolveUserPrefs(user?.prefs), [user?.prefs]);
}

/** Все настройки: [значения, patch]. Личные ключи пишутся на сервер (в кэше сразу, при ошибке — откат и сообщение), остальные — в браузер */
export function useSettings() {
  const loc = React.useSyncExternalStore(
    cb => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => local,
  );
  const { setMyPrefs } = useSession();
  const prefs = useMyPrefs();
  const set = React.useCallback(
    (patch: Record<string, unknown>) => {
      const lp: Record<string, unknown> = {};
      const up: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) (LOCAL_KEYS.includes(k as keyof LocalSettings) ? lp : up)[k] = v;
      if (Object.keys(lp).length) setLocal(lp as Partial<LocalSettings>);
      if (Object.keys(up).length) setMyPrefs(up as Partial<UserPrefs>).catch(e => toast.error(errorMessage(e)));
    },
    [setMyPrefs],
  );
  const value = React.useMemo<Settings>(() => ({ ...loc, ...prefs }), [loc, prefs]);
  return [value, set] as const;
}

/** Сброс настроек этого устройства (после «Delete workspace») */
export const resetSettings = () => setLocal(LOCAL_DEFAULTS);
