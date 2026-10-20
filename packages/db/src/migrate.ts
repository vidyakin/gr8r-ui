/* Администрирование БД: создание базы, миграции, логин-роль приложения, полный сброс. Выполняется под ADMIN_DATABASE_URL. */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = new URL('../drizzle', import.meta.url).pathname;

/** Создаёт базу из URL, если её нет (подключается к служебной БД postgres) */
export async function ensureDatabase(url: string): Promise<void> {
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.slice(1));
  u.pathname = '/postgres';
  const admin = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try {
    const [row] = await admin`select 1 as ok from pg_database where datname = ${name}`;
    if (!row) await admin.unsafe(`create database "${name.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }
}

/** Применяет SQL-миграции из packages/db/drizzle (структура, uuid v7, роли, RLS) */
export async function runMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await sql.end();
  }
}

/** Создаёт (или обновляет пароль) логин-роль приложения и делает её членом app_user и app_worker.
    Рантайм подключается этой ролью: она не суперпользователь, не владелец таблиц и NOINHERIT — прав на таблицы у неё нет,
    пока код явно не сделает `SET ROLE app_user` (забытый SET ROLE даёт «permission denied», а не молчаливый доступ). */
export async function ensureAppLogin(url: string, user: string, password: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [q] = await sql<{ ident: string; lit: string }[]>`select format('%I', ${user}::text) as ident, format('%L', ${password}::text) as lit`;
    const [exists] = await sql`select 1 as ok from pg_roles where rolname = ${user}`;
    if (exists) await sql.unsafe(`alter role ${q!.ident} login password ${q!.lit} nosuperuser nobypassrls noinherit`);
    else await sql.unsafe(`create role ${q!.ident} login password ${q!.lit} nosuperuser nobypassrls noinherit`);
    // PG16: параметры членства задаются при выдаче; пересоздаём, чтобы старая выдача с INHERIT не осталась
    await sql.unsafe(`revoke app_user, app_worker from ${q!.ident}`);
    await sql.unsafe(`grant app_user, app_worker to ${q!.ident} with inherit false, set true`);
  } finally {
    await sql.end();
  }
}

/** Удаляет все объекты схем public и drizzle (роли кластера остаются: их создание идемпотентно) */
export async function wipeDatabase(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe('drop schema if exists drizzle cascade');
    await sql.unsafe('drop schema if exists public cascade');
    await sql.unsafe('create schema public');
  } finally {
    await sql.end();
  }
}

/** Миграции + (по окружению) логин-роль приложения */
export async function migrateAll(adminUrl: string): Promise<void> {
  await ensureDatabase(adminUrl);
  await runMigrations(adminUrl);
  const user = process.env.APP_DB_USER;
  const password = process.env.APP_DB_PASSWORD;
  if (user && password) await ensureAppLogin(adminUrl, user, password);
}
