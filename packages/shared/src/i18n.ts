/* Языки интерфейса. Тексты переводит клиент (apps/web/src/i18n); сервер хранит только выбор: users.locale и workspaces.settings.locale */
import { z } from 'zod';

export const LOCALES = ['en', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const localeSchema = z.enum(LOCALES);

/** PATCH /auth/me: null — снять личный выбор и брать язык воркспейса */
export const meUpdateBody = z.object({ locale: localeSchema.nullable() });
