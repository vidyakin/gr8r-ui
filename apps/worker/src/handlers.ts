/* Обработчики воркера. Реальные обработчики событий появятся с автоматизациями (этап 6), печатью PDF и пересчётами.
   Задачи jobs: служебная noop и DDL по белому списку (индексы полей конструктора). */
import { and, eq } from 'drizzle-orm';
import { createFieldIndex, dropFieldIndex, entities, events, fields, isUuid, jobs, withContext, type Db, type Sql } from '@gr8r/db';
import { FIELD_TYPES, type FieldType } from '@gr8r/shared';

export type EventRow = typeof events.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;

/** Вызывается для каждого события из outbox внутри транзакции (под ролью app_worker, RLS обходится).
    Здесь будут: запуск автоматизаций по триггерам, уведомления, лента Activity. Пока намеренно пуст. */
export async function handleEvent(_event: EventRow, _db: Db): Promise<void> {
  // no-op
}

/** Что получает обработчик задачи. Транзакцию на время долгой операции держать нельзя (CREATE INDEX CONCURRENTLY ждёт
    все открытые транзакции), поэтому чтение метаданных — короткие вызовы `read`, а DDL идёт на своём подключении */
export interface JobContext {
  /** Короткая транзакция под ролью app_worker (BYPASSRLS) */
  read: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
  /** Подключение роли-владельца (DATABASE_URL_DDL); null — не настроено */
  ddl: Sql | null;
}

export const makeJobContext = (sql: Sql, ddl: Sql | null): JobContext => ({ read: fn => withContext(sql, {}, fn, 'app_worker'), ddl });

/** Поле, по которому строится индекс, — по метаданным из БД, а не по содержимому задачи: из payload берётся только uuid поля */
async function loadIndexTarget(job: JobRow, h: JobContext) {
  const fieldId = (job.payload as { fieldId?: unknown }).fieldId;
  if (!isUuid(fieldId)) throw new Error('index job: payload.fieldId must be a uuid');
  return h.read(async db => {
    const [row] = await db
      .select({ id: fields.id, key: fields.key, type: fields.type, filterable: fields.filterable, archivedAt: fields.archivedAt, entityId: entities.id, entityKey: entities.key, entityArchivedAt: entities.archivedAt })
      .from(fields)
      .innerJoin(entities, eq(entities.id, fields.entityId))
      .where(and(eq(fields.id, fieldId), eq(fields.workspaceId, job.workspaceId)))
      .limit(1);
    const eligible = !!row && row.filterable && !row.archivedAt && !row.entityArchivedAt && FIELD_TYPES.includes(row.type as FieldType);
    return { fieldId, eligible, target: row ? { fieldId, key: row.key, type: row.type as FieldType, entityId: row.entityId, entityKey: row.entityKey } : null };
  });
}

const needDdl = (h: JobContext) => {
  if (!h.ddl) throw new Error('DATABASE_URL_DDL is not configured: the worker cannot run DDL');
  return h.ddl;
};

/** Реестр обработчиков фоновых задач по jobs.type. Задачи работают по состоянию метаданных на момент выполнения
    (а не на момент постановки), поэтому порядок задач и повторы безопасны */
export const jobHandlers: Record<string, (job: JobRow, h: JobContext) => Promise<void>> = {
  /** Служебная задача для проверки очереди */
  noop: async () => {},
  /** Построить индекс по выражению для поля сущности. Пропускается, если поле уже не требует индекса (удалено, скрыто, не filterable) */
  'index.create': async (job, h) => {
    const { eligible, target } = await loadIndexTarget(job, h);
    if (!eligible || !target) return;
    await createFieldIndex(needDdl(h), target);
  },
  /** Удалить индекс поля. Пропускается, если поле снова требует индекса (восстановлено раньше, чем сработала задача) */
  'index.drop': async (job, h) => {
    const { fieldId, eligible } = await loadIndexTarget(job, h);
    if (eligible) return;
    await dropFieldIndex(needDdl(h), fieldId);
  },
};
