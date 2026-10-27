/* Конструктор сущностей: общий код API и сидов — регистрация системных сущностей, SQL-выражения по ключам jsonb, индексы полей. */
import { eq } from 'drizzle-orm';
import { FIELD_KEY_RE, FIELD_TYPES, SYSTEM_ENTITIES, isNumericType, type FieldType } from '@gr8r/shared';
import type { Db, Sql } from './client';
import { entities, jobs } from './schema';
import { isUuid } from './uuid';

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
export const SYSTEM_TABLES: Record<string, string> = { task: 'tasks', project: 'projects', deal: 'deals', company: 'companies', contact: 'contacts', product: 'products', lead: 'leads' };

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
  // Белый список: только индекс по выражению над ключом поля; всё, что попадает в SQL, проверено здесь
  if (!isUuid(t.fieldId)) throw new Error('Invalid field id');
  if (!FIELD_TYPES.includes(t.type)) throw new Error(`Invalid field type "${t.type}"`);
  const table = SYSTEM_TABLES[t.entityKey];
  const name = fieldIndexName(t.fieldId);
  if (table) return `create index concurrently if not exists ${name} on ${table} (${fieldExprSql('custom', t.key, t.type)})`;
  if (!/^[0-9a-f-]{36}$/.test(t.entityId)) throw new Error('Invalid entity id');
  return `create index concurrently if not exists ${name} on records (${fieldExprSql('data', t.key, t.type)}) where entity_id = '${t.entityId}'`;
}

/** Построение и удаление индексов выполняет ТОЛЬКО воркер на отдельном подключении `DATABASE_URL_DDL` (роль-владелец таблиц):
    CREATE INDEX CONCURRENTLY нельзя запускать в транзакции, а логин-роль API права владельца не имеет. API лишь ставит
    задачу в `jobs` (enqueueFieldIndex) в той же транзакции, что и изменение поля. */

/** Постановка задачи построить/удалить индекс поля. Вызывается в транзакции запроса арендатора: откат запроса отменяет и задачу */
export async function enqueueFieldIndex(db: Db, workspaceId: string, op: 'create' | 'drop', fieldId: string) {
  await db.insert(jobs).values({ workspaceId, queue: 'ddl', type: `index.${op}`, payload: { fieldId } });
}

/** DDL идёт строго по одному (на всех воркерах): параллельные CREATE INDEX CONCURRENTLY по одной таблице упираются
    друг в друга и дают deadlock. Блокировка — рекомендательная, на время одного оператора, на зарезервированном соединении.
    Берём её через pg_try_advisory_lock с ожиданием в коде: ждущий `pg_advisory_lock` — это открытая транзакция со снимком, а CREATE INDEX
    CONCURRENTLY ждёт завершения таких транзакций, то есть держатель блокировки и ожидающий упёрлись бы друг в друга */
const DDL_LOCK = 4_700_001;

async function serialDdl(ddl: Sql, fn: (run: (statement: string) => Promise<unknown>) => Promise<void>) {
  const conn = await ddl.reserve();
  try {
    for (;;) {
      const [r] = (await conn.unsafe(`select pg_try_advisory_lock(${DDL_LOCK}) as ok`)) as unknown as { ok: boolean }[];
      if (r?.ok) break;
      await new Promise(res => setTimeout(res, 50));
    }
    try {
      await fn(s => conn.unsafe(s));
    } finally {
      await conn.unsafe(`select pg_advisory_unlock(${DDL_LOCK})`);
    }
  } finally {
    conn.release();
  }
}

/** Создаёт индекс поля. Сбой CONCURRENTLY оставляет INVALID-индекс — его убираем, чтобы повторная попытка начала с нуля */
export async function createFieldIndex(ddl: Sql, t: IndexTarget) {
  const statement = fieldIndexDdl(t);
  await serialDdl(ddl, async run => {
    try {
      await run(statement);
    } catch (e) {
      await run(`drop index concurrently if exists ${fieldIndexName(t.fieldId)}`).catch(() => {});
      throw e;
    }
  });
}

export async function dropFieldIndex(ddl: Sql, fieldId: string) {
  if (!isUuid(fieldId)) throw new Error('Invalid field id');
  await serialDdl(ddl, async run => void (await run(`drop index concurrently if exists ${fieldIndexName(fieldId)}`)));
}
