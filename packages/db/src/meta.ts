/* Конструктор сущностей: общий код API и сидов — регистрация системных сущностей, SQL-выражения по ключам jsonb, индексы полей. */
import { eq } from 'drizzle-orm';
import { FIELD_KEY_RE, SYSTEM_ENTITIES, isNumericType, type FieldType } from '@gr8r/shared';
import type { Db, Sql } from './client';
import { entities } from './schema';

/** Регистрирует task / project / deal / company / contact в entities (повторный вызов ничего не дублирует). Возвращает ключ → id */
export async function registerSystemEntities(db: Db, workspaceId: string): Promise<Map<string, string>> {
  await db
    .insert(entities)
    .values(SYSTEM_ENTITIES.map((e, i) => ({ workspaceId, key: e.key, name: e.name, kind: 'system' as const, icon: e.icon, titleField: e.titleField, sortOrder: i })))
    .onConflictDoNothing();
  const rows = await db.select({ id: entities.id, key: entities.key }).from(entities).where(eq(entities.workspaceId, workspaceId));
  return new Map(rows.map(r => [r.key, r.id]));
}

/** Таблица и колонка jsonb, где лежат значения сущности */
export const SYSTEM_TABLES: Record<string, string> = { task: 'tasks', project: 'projects', deal: 'deals', company: 'companies', contact: 'contacts' };

/** Выражение для значения поля: число — numeric, остальное — текст (даты ISO сортируются как текст). Ключ проверяется по FIELD_KEY_RE, поэтому его можно вставлять в SQL */
export function fieldExprSql(column: string, key: string, type: FieldType): string {
  if (!FIELD_KEY_RE.test(key)) throw new Error(`Invalid field key "${key}"`);
  return isNumericType(type) ? `((${column}->>'${key}')::numeric)` : `(${column}->>'${key}')`;
}

export interface IndexTarget {
  fieldId: string;
  key: string;
  type: FieldType;
  entityId: string;
  entityKey: string;
}

/** Имя индекса поля: стабильно и не зависит от ключа (ключ не меняется, но имя короче и без спецсимволов) */
export const fieldIndexName = (fieldId: string) => `idx_cf_${fieldId.replace(/-/g, '')}`;

/** DDL индекса по выражению. Системные сущности — индекс по custom таблицы, пользовательские — частичный индекс records по entity_id */
export function fieldIndexDdl(t: IndexTarget): string {
  const table = SYSTEM_TABLES[t.entityKey];
  const name = fieldIndexName(t.fieldId);
  if (table) return `create index concurrently if not exists ${name} on ${table} (${fieldExprSql('custom', t.key, t.type)})`;
  if (!/^[0-9a-f-]{36}$/.test(t.entityId)) throw new Error('Invalid entity id');
  return `create index concurrently if not exists ${name} on records (${fieldExprSql('data', t.key, t.type)}) where entity_id = '${t.entityId}'`;
}

/** Выполняет DDL вне транзакции запроса: CREATE INDEX CONCURRENTLY нельзя запускать в транзакции. Отдельное соединение
    пула под ролью app_owner (владелец таблиц; логин-роль приложения получает её через ensureAppLogin). RLS индекс не затрагивает. */
async function ownerDdl(sql: Sql, statements: string[]) {
  const conn = await sql.reserve();
  try {
    await conn.unsafe('set role app_owner');
    for (const s of statements) await conn.unsafe(s);
  } finally {
    try {
      await conn.unsafe('reset role');
    } finally {
      conn.release();
    }
  }
}

/** Создаёт индекс поля. Сбой CONCURRENTLY оставляет INVALID-индекс — его убираем, чтобы повторная попытка начала с нуля */
export async function createFieldIndex(sql: Sql, t: IndexTarget) {
  try {
    await ownerDdl(sql, [fieldIndexDdl(t)]);
  } catch (e) {
    await dropFieldIndex(sql, t.fieldId).catch(() => {});
    throw e;
  }
}

export async function dropFieldIndex(sql: Sql, fieldId: string) {
  await ownerDdl(sql, [`drop index concurrently if exists ${fieldIndexName(fieldId)}`]);
}
