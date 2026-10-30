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

/** Тестовая база с ICU-локалью: lower() и ILIKE понимают кириллицу, даже если кластер создан с locale C.
    Базу другой локали пересоздаёт — вызывать только для тестовых баз. */
export async function ensureTestDatabase(url: string): Promise<void> {
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.slice(1));
  const ident = `"${name.replace(/"/g, '""')}"`;
  u.pathname = '/postgres';
  const admin = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try {
    const [row] = await admin`select datlocprovider as provider from pg_database where datname = ${name}`;
    if (row?.provider === 'i') return;
    if (row) await admin.unsafe(`drop database ${ident}`);
    await admin.unsafe(`create database ${ident} template template0 encoding 'UTF8' locale_provider icu icu_locale 'und'`);
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
    await sql.unsafe(`revoke app_user, app_worker, app_owner from ${q!.ident}`);
    await sql.unsafe(`grant app_user, app_worker to ${q!.ident} with inherit false, set true`);
    // app_owner логин-роли API НЕ выдаётся: DDL (индексы полей конструктора) выполняет воркер через отдельную роль, см. ensureDdlLogin
  } finally {
    await sql.end();
  }
}

/** Создаёт (или обновляет пароль) логин-роль для DDL воркера: наследует права app_owner (владельца таблиц) и больше ничего.
    Её URL (DATABASE_URL_DDL) знает только воркер; API и обычные запросы под ней не идут. Операции — белый список в apps/worker/src/handlers.ts */
export async function ensureDdlLogin(url: string, user: string, password: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [q] = await sql<{ ident: string; lit: string }[]>`select format('%I', ${user}::text) as ident, format('%L', ${password}::text) as lit`;
    const [exists] = await sql`select 1 as ok from pg_roles where rolname = ${user}`;
    const attrs = 'login nosuperuser nobypassrls nocreatedb nocreaterole';
    if (exists) await sql.unsafe(`alter role ${q!.ident} ${attrs} password ${q!.lit}`);
    else await sql.unsafe(`create role ${q!.ident} ${attrs} password ${q!.lit}`);
    await sql.unsafe(`revoke app_user, app_worker, app_owner from ${q!.ident}`);
    await sql.unsafe(`grant app_owner to ${q!.ident} with inherit true, set false`);
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
  const ddlUser = process.env.DDL_DB_USER;
  const ddlPassword = process.env.DDL_DB_PASSWORD;
  if (ddlUser && ddlPassword) await ensureDdlLogin(adminUrl, ddlUser, ddlPassword);
}
