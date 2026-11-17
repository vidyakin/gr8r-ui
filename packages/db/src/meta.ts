/* Конструктор сущностей: общий код API и сидов — регистрация системных сущностей, SQL-выражения по ключам jsonb, индексы полей. */
import { eq } from 'drizzle-orm';
import { FIELD_KEY_RE, FIELD_TYPES, SYSTEM_ENTITIES, isNumericType, type FieldType } from '@erp/shared';
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

/** Журнал долгих операций (CLI оператора печатает шаги, воркер молчит) */
export type StepLog = (msg: string) => void;

/** Сессии, которые держат DDL-лок или блокируют pid: для журнала ожидания */
async function describeSessions(q: (s: string) => Promise<unknown>, where: string): Promise<string> {
  const rows = (await q(
    `select a.pid, a.application_name as app, a.state, extract(epoch from now() - coalesce(a.xact_start, a.query_start))::int as sec, left(regexp_replace(a.query, '\\s+', ' ', 'g'), 90) as query from pg_stat_activity a where ${where}`,
  )) as { pid: number; app: string; state: string; sec: number; query: string }[];
  return rows.length ? rows.map(r => `pid ${r.pid} ${r.app || '-'} ${r.state} ${r.sec}s: ${r.query}`).join(' | ') : 'не найдены';
}

async function serialDdl(ddl: Sql, fn: (run: (statement: string) => Promise<unknown>) => Promise<void>, log?: StepLog) {
  const conn = await ddl.reserve();
  try {
    const t0 = Date.now();
    let next = 5000;
    for (;;) {
      const [r] = (await conn.unsafe(`select pg_try_advisory_lock(${DDL_LOCK}) as ok`)) as unknown as { ok: boolean }[];
      if (r?.ok) break;
      if (log && Date.now() - t0 >= next) {
        next += 10_000;
        log(`  жду DDL-лок ${Math.round((Date.now() - t0) / 1000)} с, держит: ${await describeSessions(s => conn.unsafe(s), `a.pid in (select pid from pg_locks where locktype = 'advisory' and objid = ${DDL_LOCK} and granted)`)}`);
      }
      await new Promise(res => setTimeout(res, 50));
    }
    // пока оператор ждёт (CONCURRENTLY ждёт старые транзакции), раз в 10 с пишем, кто его блокирует
    const [{ pid }] = (await conn.unsafe('select pg_backend_pid() as pid')) as unknown as { pid: number }[];
    const t1 = Date.now();
    const timer = log
      ? setInterval(() => {
          void describeSessions(s => ddl.unsafe(s), `a.datname = current_database() and a.pid <> ${pid} and (a.pid = any(pg_blocking_pids(${pid})) or (a.backend_xid is not null or a.backend_xmin is not null) and a.xact_start < now() - interval '10 seconds')`)
            .then(who => log(`  DDL выполняется ${Math.round((Date.now() - t1) / 1000)} с, ждёт транзакции: ${who}`))
            .catch(() => {});
        }, 10_000)
      : null;
    try {
      await fn(s => conn.unsafe(s));
    } finally {
      if (timer) clearInterval(timer);
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

export async function dropFieldIndex(ddl: Sql, fieldId: string, log?: StepLog) {
  if (!isUuid(fieldId)) throw new Error('Invalid field id');
  await serialDdl(ddl, async run => void (await run(`drop index concurrently if exists ${fieldIndexName(fieldId)}`)), log);
}
