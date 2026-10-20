/* Подключения к БД из окружения.
   DATABASE_URL         — рантайм (API, воркер): логин-роль, входящая в app_user/app_worker (не суперпользователь).
   ADMIN_DATABASE_URL   — миграции, создание БД и ролей: суперпользователь/владелец. По умолчанию совпадает с DATABASE_URL. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/* Bun подхватывает .env только из текущей папки, а скрипты запускаются из пакетов (--cwd) — поэтому ищем .env
   вверх по дереву до корня монорепозитория. Уже заданные переменные окружения не перезаписываются. */
function loadRootEnv() {
  let dir = import.meta.dir;
  for (let i = 0; i < 6; i++, dir = dirname(dir)) {
    const f = join(dir, '.env');
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trimStart().startsWith('#') && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
    return;
  }
}
loadRootEnv();

const DEFAULT_ADMIN = 'postgres://postgres@127.0.0.1:5433/gr8r_dev';

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? process.env.ADMIN_DATABASE_URL ?? DEFAULT_ADMIN;
}

export function adminDatabaseUrl(): string {
  return process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_ADMIN;
}
