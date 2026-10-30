/* Языки интерфейса. Тексты переводит клиент (apps/web/src/i18n); сервер хранит только выбор: users.locale и workspaces.settings.locale */
import { z } from 'zod';

export const LOCALES = ['en', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const localeSchema = z.enum(LOCALES);

/** Допустимый часовой пояс IANA ('' — как в браузере) */
const tzSchema = z.string().max(64).refine(v => {
  if (v === '') return true;
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, 'Unknown time zone');

/** Личные настройки пользователя (users.prefs). Хранится частичный объект: чего нет — берётся значение по умолчанию (USER_PREFS_DEFAULTS) */
export const userPrefsSchema = z.object({
  /** Часовой пояс показа моментов времени; '' — как в браузере */
  tz: tzSchema,
  /** Формат даты: 'MMM d' — по языку («Oct 1» / «1 окт.»), остальные — числовые */
  dateFmt: z.enum(['MMM d', 'd/M', 'M/d', 'yyyy-MM-dd']),
  /** Первый день недели: 0 — воскресенье, 1 — понедельник, 6 — суббота */
  weekStart: z.enum(['0', '1', '6']),
  /** Формат времени: 'auto' — по языку */
  timeFmt: z.enum(['auto', '12', '24']),
  /** Что открывать при запуске */
  home: z.enum(['home', 'mytasks', 'inbox']),
  /** Где открывать задачи: боковая карточка или отдельное окно */
  openTasks: z.enum(['drawer', 'full']),
  confirmDel: z.boolean(),
  /** Вкладка проекта по умолчанию */
  defaultTab: z.enum(['overview', 'board', 'list', 'table', 'calendar', 'timeline']),
  showDoneBoard: z.boolean(),
  /** Уведомления внутри приложения: ключ → включено (нет ключа — включено) */
  np: z.record(z.string().max(40), z.boolean()),
});
export type UserPrefs = z.infer<typeof userPrefsSchema>;
export const userPrefsPatch = userPrefsSchema.partial();

export const USER_PREFS_DEFAULTS: UserPrefs = {
  tz: '',
  dateFmt: 'MMM d',
  weekStart: '1',
  timeFmt: 'auto',
  home: 'home',
  openTasks: 'drawer',
  confirmDel: true,
  defaultTab: 'board',
  showDoneBoard: true,
  np: {},
};

/** Сохранённое (возможно устаревшее или частично неверное) → полный набор: каждый ключ проверяется отдельно, негодный заменяется умолчанием */
export function resolveUserPrefs(raw: unknown): UserPrefs {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...USER_PREFS_DEFAULTS };
  for (const k of Object.keys(userPrefsSchema.shape) as (keyof UserPrefs)[]) {
    const r = userPrefsSchema.shape[k].safeParse(src[k]);
    if (r.success) out[k] = r.data;
  }
  return out as UserPrefs;
}

/** Включено ли уведомление внутри приложения (нет ключа — включено) */
export const notifyEnabled = (prefs: unknown, key: string): boolean => resolveUserPrefs(prefs).np[key] !== false;

/** PATCH /auth/me: locale (null — снять личный выбор и брать язык воркспейса) и/или часть личных настроек */
export const meUpdateBody = z.object({ locale: localeSchema.nullable().optional(), prefs: userPrefsPatch.optional() });

/** POST /auth/password: смена пароля, остальные сессии закрываются */
export const passwordChangeBody = z.object({ current: z.string().min(1).max(200), next: z.string().min(8).max(200) });
