/* Проход воркера «сводка о ходе объекта по расписанию» (задача 1277, docs/architecture/construction.md): раз в минуту
   выбирает объекты, у которых наступил день и время отправки (по часовому поясу воркспейса), и ставит задачу
   object.progress_report на каждое расписание. Выключенный модуль construction — объект пропускается.
   Повторный проход в том же окне безопасен: отправка отмечает last_sent_at (packages/db/src/object-reports.ts). */
import { and, eq, inArray } from 'drizzle-orm';
import { dueSchedules, jobs, modulesByWorkspace, OBJECT_REPORT_JOB, withContext, type Sql } from '@erp/db';

/** Поставленные задачи за проход (для журнала воркера) */
export async function runObjectReportsOnce(sql: Sql, at: Date = new Date()): Promise<number> {
  const due = await withContext(sql, {}, db => dueSchedules(db, at), 'app_worker');
  if (!due.length) return 0;
  const modules = await modulesByWorkspace(sql);
  // уже поставленные задачи: вторая минута того же окна не должна добавить дубль, пока первая ещё в очереди
  const pending = await withContext(
    sql,
    {},
    db =>
      db
        .select({ payload: jobs.payload })
        .from(jobs)
        .where(and(eq(jobs.type, OBJECT_REPORT_JOB), inArray(jobs.status, ['queued', 'running']))),
    'app_worker',
  );
  const queued = new Set(pending.map(p => String((p.payload as { scheduleId?: unknown }).scheduleId ?? '')));
  let n = 0;
  for (const s of due) {
    if (!modules.get(s.workspaceId)?.has('construction')) continue; // модуль «Строительство» выключен — не рассылаем
    if (queued.has(s.scheduleId)) continue;
    await withContext(
      sql,
      { workspaceId: s.workspaceId },
      db => db.insert(jobs).values({ workspaceId: s.workspaceId, type: OBJECT_REPORT_JOB, payload: { scheduleId: s.scheduleId, at: at.toISOString() } }),
      'app_worker',
    );
    queued.add(s.scheduleId);
    n++;
  }
  return n;
}
