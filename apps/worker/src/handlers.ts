/* Обработчики воркера. Реальные обработчики событий появятся с автоматизациями (этап 6), печатью PDF и пересчётами.
   Задачи jobs: служебная noop и DDL по белому списку (индексы полей конструктора). */
import { and, eq } from 'drizzle-orm';
import { buildPrintData, createFieldIndex, documentFiles, dropFieldIndex, entities, events, fields, isUuid, jobs, withContext, type Db, type Sql } from '@gr8r/db';
import { DOCUMENT_META, FIELD_TYPES, renderPrintForm, type FieldType, type PrintForm } from '@gr8r/shared';
import { renderPdf } from './pdf/render';
import { pdfStoreFromEnv, type PdfStore } from './pdf/storage';

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

/** Хранилище PDF (PDF_STORE=db по умолчанию; s3 — заготовка); тесты подменяют его */
export const pdfRuntime: { store: PdfStore; render: typeof renderPdf } = { store: pdfStoreFromEnv(), render: renderPdf };

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
  /** Печатная форма документа → PDF (headless Chromium). Данные и шаблон те же, что у предпросмотра в браузере.
      Ошибка формирования не повторяется вслепую: файл помечается failed с текстом ошибки, форму можно запросить заново */
  'document.pdf': async (job, h) => {
    const fileId = (job.payload as { fileId?: unknown }).fileId;
    if (!isUuid(fileId)) throw new Error('document.pdf job: payload.fileId must be a uuid');
    const file = await h.read(async db => (await db.select().from(documentFiles).where(eq(documentFiles.id, fileId)).limit(1))[0]);
    if (!file) return; // документ удалён вместе с файлом
    try {
      const html = await h.read(async db => {
        const data = await buildPrintData(db, file.documentId);
        if (!DOCUMENT_META[data.type].forms.includes(file.form as PrintForm)) throw new Error(`form "${file.form}" is not available for ${data.type}`);
        return renderPrintForm(file.form as PrintForm, data);
      });
      const bytes = await pdfRuntime.render(html, file.form as PrintForm);
      await h.read(db => pdfRuntime.store.save(db, { id: file.id, workspaceId: file.workspaceId }, bytes));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await h.read(db => db.update(documentFiles).set({ status: 'failed', error: msg.slice(0, 1000), finishedAt: new Date() }).where(eq(documentFiles.id, file.id)));
    }
  },
};
