/* Цикл воркера: очередь jobs и outbox events на FOR UPDATE SKIP LOCKED — несколько воркеров безопасно работают параллельно.
   Воркер ходит под ролью app_worker (BYPASSRLS): задачи и события относятся ко всем арендаторам. */
import { sql as dsql } from 'drizzle-orm';
import { events, withContext, type Sql } from '@gr8r/db';
import { handleEvent, jobHandlers, makeJobContext, type EventRow, type JobRow } from './handlers';

export interface WorkerOptions {
  workerId: string;
  concurrency: number;
  /** Через сколько секунд «зависшая» running-задача возвращается в очередь */
  staleAfterSec: number;
  log: (msg: string) => void;
  /** Подключение роли-владелец для DDL (DATABASE_URL_DDL); без него DDL-задачи завершаются ошибкой и повторяются */
  ddl?: Sql | null;
}

export const defaultOptions = (over: Partial<WorkerOptions> = {}): WorkerOptions => ({
  workerId: `worker-${process.pid}`,
  concurrency: 4,
  staleAfterSec: 300,
  log: m => console.log(`[worker] ${m}`),
  ...over,
});

const backoffSec = (attempt: number) => Math.min(3600, 2 ** attempt * 5);

/** Забирает пачку задач одним UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) и сразу коммитит захват */
export async function claimJobs(sql: Sql, o: WorkerOptions): Promise<JobRow[]> {
  return withContext(
    sql,
    {},
    async db =>
      db.execute<JobRow>(dsql`
        update jobs set status = 'running', locked_at = now(), locked_by = ${o.workerId}, attempts = attempts + 1
        where id in (
          select id from jobs where status = 'queued' and run_at <= now()
          order by run_at, id
          for update skip locked
          limit ${o.concurrency}
        )
        returning id, workspace_id as "workspaceId", queue, type, payload, status, run_at as "runAt", attempts, max_attempts as "maxAttempts",
                  locked_at as "lockedAt", locked_by as "lockedBy", last_error as "lastError", created_at as "createdAt", finished_at as "finishedAt"`) as unknown as Promise<JobRow[]>,
    'app_worker',
  );
}

/** Выполняет одну задачу; успех → done, ошибка → повтор с экспоненциальной паузой или failed после max_attempts */
async function runJob(sql: Sql, job: JobRow, o: WorkerOptions): Promise<void> {
  try {
    const handler = jobHandlers[job.type];
    if (!handler) throw new Error(`no handler for job type "${job.type}"`);
    await handler(job, makeJobContext(sql, o.ddl ?? null));
    await withContext(sql, {}, async db => db.execute(dsql`update jobs set status = 'done', finished_at = now(), last_error = null where id = ${job.id}`), 'app_worker');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const final = job.attempts >= job.maxAttempts;
    o.log(`job ${job.id} (${job.type}) failed [attempt ${job.attempts}/${job.maxAttempts}]: ${msg}`);
    await withContext(
      sql,
      {},
      async db =>
        db.execute(dsql`update jobs set status = ${final ? 'failed' : 'queued'}, last_error = ${msg}, locked_at = null, locked_by = null,
          finished_at = ${final ? dsql`now()` : null}, run_at = now() + make_interval(secs => ${backoffSec(job.attempts)}) where id = ${job.id}`),
      'app_worker',
    );
  }
}

/** Возвращает в очередь задачи, которые давно «выполняются» (воркер упал) */
export async function requeueStale(sql: Sql, o: WorkerOptions): Promise<number> {
  const r = await withContext(sql, {}, db => db.execute(dsql`update jobs set status = 'queued', locked_at = null, locked_by = null where status = 'running' and locked_at < now() - make_interval(secs => ${o.staleAfterSec}) returning id`), 'app_worker');
  return r.length;
}

/** Один проход по очереди. Возвращает число обработанных задач */
export async function processJobsOnce(sql: Sql, o: WorkerOptions): Promise<number> {
  const claimed = await claimJobs(sql, o);
  await Promise.all(claimed.map(j => runJob(sql, j, o)));
  return claimed.length;
}

const failures = new Map<string, number>();

/** Один проход по outbox: берёт необработанные события (SKIP LOCKED), вызывает handleEvent, ставит processed_at.
    processed_at, а не «курсор по id»: транзакции коммитятся не в порядке id, курсор пропустил бы поздно закоммиченное событие. */
export async function processEventsOnce(sql: Sql, o: WorkerOptions, batch = 100): Promise<number> {
  return withContext(
    sql,
    {},
    async db => {
      const rows = await db.select().from(events).where(dsql`${events.processedAt} is null`).orderBy(events.id).limit(batch).for('update', { skipLocked: true });
      for (const ev of rows as EventRow[]) {
        try {
          await handleEvent(ev, db);
        } catch (e) {
          const n = (failures.get(ev.id) ?? 0) + 1;
          failures.set(ev.id, n);
          o.log(`event ${ev.id} (${ev.type}) handler failed (${n}): ${e instanceof Error ? e.message : e}`);
          if (n < 5) continue; // оставляем необработанным — повторим на следующем проходе
          failures.delete(ev.id); // после 5 неудач отмечаем обработанным, чтобы не зациклиться (событие остаётся в журнале)
        }
        await db.update(events).set({ processedAt: new Date() }).where(dsql`${events.id} = ${ev.id}`);
      }
      return rows.length;
    },
    'app_worker',
  );
}
