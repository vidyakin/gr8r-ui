/* Тестовая БД: пересоздаётся с нуля на каждый запуск `bun test`, миграции применяются заново.
   Подключение рантайма — НЕ суперпользователь (логин-роль gr8r_app в app_user/app_worker), как в проде. */
import { adminDatabaseUrl, ensureDatabase, ensureAppLogin, ensureDdlLogin, runMigrations, wipeDatabase } from '.';

const APP_USER = 'gr8r_app';
const APP_PASSWORD = 'gr8r_app';
const DDL_USER = 'gr8r_ddl';
const DDL_PASSWORD = 'gr8r_ddl';

export interface TestDb {
  adminUrl: string;
  appUrl: string;
  /** Подключение воркера для DDL (роль-владелец) */
  ddlUrl: string;
}

export async function setupTestDatabase(): Promise<TestDb> {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/gr8r_test';
  const name = new URL(adminUrl).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`Refusing to wipe "${name}": test database name must end with _test`);
  await ensureDatabase(adminUrl);
  await wipeDatabase(adminUrl);
  await runMigrations(adminUrl);
  await ensureAppLogin(adminUrl, APP_USER, APP_PASSWORD);
  await ensureDdlLogin(adminUrl, DDL_USER, DDL_PASSWORD);
  const u = new URL(adminUrl);
  u.username = APP_USER;
  u.password = APP_PASSWORD;
  const d = new URL(adminUrl);
  d.username = DDL_USER;
  d.password = DDL_PASSWORD;
  return { adminUrl, appUrl: u.toString(), ddlUrl: d.toString() };
}

export { adminDatabaseUrl };
