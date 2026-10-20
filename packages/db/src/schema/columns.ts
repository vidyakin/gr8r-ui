/* Общие колонки. Идентификаторы — UUID v7: по умолчанию генерирует БД (функция uuid_generate_v7(),
   создаётся в миграции 0000), в коде — uuidv7() из ../uuid.ts (для сидов и заранее известных id). */
import { sql } from 'drizzle-orm';
import { numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

export const pk = () => uuid('id').primaryKey().default(sql`uuid_generate_v7()`);

export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const createdAt = () => ts('created_at').notNull().defaultNow();
export const updatedAt = () => ts('updated_at').notNull().defaultNow();
export const archivedAt = () => ts('archived_at');

/** Деньги: numeric(18,2); в JSON ходят строками */
export const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
/** Часы: numeric(10,2) */
export const hours = (name: string) => numeric(name, { precision: 10, scale: 2 });
