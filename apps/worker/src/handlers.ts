/* Обработчики воркера. Сейчас — каркас: реальные обработчики появятся с автоматизациями (этап 6), печатью PDF и пересчётами. */
import type { Db } from '@gr8r/db';
import { events, jobs } from '@gr8r/db';

export type EventRow = typeof events.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;

/** Вызывается для каждого события из outbox внутри транзакции (под ролью app_worker, RLS обходится).
    Здесь будут: запуск автоматизаций по триггерам, уведомления, лента Activity. Пока намеренно пуст. */
export async function handleEvent(_event: EventRow, _db: Db): Promise<void> {
  // no-op
}

/** Реестр обработчиков фоновых задач по jobs.type */
export const jobHandlers: Record<string, (job: JobRow, db: Db) => Promise<void>> = {
  /** Служебная задача для проверки очереди */
  noop: async () => {},
};
