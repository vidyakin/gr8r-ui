import { afterAll, describe, expect, test } from 'bun:test';
import { adminDatabaseUrl, createSql, databaseUrl, recordEvent, uuidv7, withContext } from '@gr8r/db';
import { defaultOptions, processEventsOnce, processJobsOnce } from '../src/worker';

const sql = createSql(databaseUrl(), { max: 10 });
const admin = createSql(adminDatabaseUrl(), { max: 2 });
afterAll(async () => {
  await sql.end();
  await admin.end();
});
const quiet = () => defaultOptions({ log: () => {}, concurrency: 5 });

async function workspace() {
  const id = uuidv7();
  await admin`insert into workspaces (id, name, slug) values (${id}, 'W', ${'w-' + id.slice(-8)})`;
  return id;
}

describe('worker: jobs on SKIP LOCKED', () => {
  test('two workers never process the same job twice', async () => {
    const ws = await workspace();
    await admin`insert into jobs (workspace_id, type) select ${ws}, 'noop' from generate_series(1, 40)`;
    const w1 = { ...quiet(), workerId: 'w1' };
    const w2 = { ...quiet(), workerId: 'w2' };
    let total = 0;
    const loop = async (o: typeof w1) => {
      for (;;) {
        const n = await processJobsOnce(sql, o);
        if (n === 0) break;
        total += n;
      }
    };
    await Promise.all([loop(w1), loop(w2), loop({ ...w1, workerId: 'w3' })]);
    expect(total).toBe(40);
    const rows = await admin`select status, attempts, locked_by from jobs where workspace_id = ${ws}`;
    expect(rows.every(r => r.status === 'done' && r.attempts === 1)).toBe(true);
  });

  test('failed job is retried with backoff and ends as failed after max_attempts', async () => {
    const ws = await workspace();
    const [job] = await admin`insert into jobs (workspace_id, type, max_attempts) values (${ws}, 'no-such-handler', 2) returning id`;
    const o = quiet();
    expect(await processJobsOnce(sql, o)).toBeGreaterThanOrEqual(1);
    let [row] = await admin`select status, attempts, last_error, run_at > now() as delayed from jobs where id = ${job!.id}`;
    expect(row).toMatchObject({ status: 'queued', attempts: 1, delayed: true });
    expect(row!.last_error).toContain('no handler');
    await admin`update jobs set run_at = now() where id = ${job!.id}`; // пропускаем паузу
    await processJobsOnce(sql, o);
    [row] = await admin`select status, attempts from jobs where id = ${job!.id}`;
    expect(row).toMatchObject({ status: 'failed', attempts: 2 });
  });

  test('future jobs wait for run_at', async () => {
    const ws = await workspace();
    const [job] = await admin`insert into jobs (workspace_id, type, run_at) values (${ws}, 'noop', now() + interval '1 hour') returning id`;
    await processJobsOnce(sql, quiet());
    expect((await admin`select status from jobs where id = ${job!.id}`)[0]!.status).toBe('queued');
  });
});

describe('worker: events outbox', () => {
  test('marks events processed across tenants (BYPASSRLS role), exactly once', async () => {
    const wsA = await workspace();
    const wsB = await workspace();
    for (const ws of [wsA, wsB]) await withContext(sql, { workspaceId: ws }, db => recordEvent(db, { workspaceId: ws, type: 'test.happened', entity: 'test' }));
    const o = quiet();
    // Один проход берёт только `batch` событий (по умолчанию 100), а в общей тестовой БД могут
    // оставаться необработанные события от других файлов — крутим, как настоящий воркер, до опустошения.
    let taken = 0;
    for (let n = await processEventsOnce(sql, o); n > 0; n = await processEventsOnce(sql, o)) taken += n;
    expect(taken).toBeGreaterThanOrEqual(2);
    const rows = await admin`select workspace_id, processed_at from events where type = 'test.happened' and workspace_id in ${admin([wsA, wsB])}`;
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.processed_at !== null)).toBe(true);
    expect(await processEventsOnce(sql, o)).toBe(0); // повторно ничего нет
  });

  test('concurrent workers split events without overlap', async () => {
    const ws = await workspace();
    await withContext(sql, { workspaceId: ws }, async db => {
      for (let i = 0; i < 30; i++) await recordEvent(db, { workspaceId: ws, type: 'test.bulk', entity: 'test' });
    });
    const o = quiet();
    const counts = await Promise.all([processEventsOnce(sql, o, 10), processEventsOnce(sql, o, 10), processEventsOnce(sql, o, 10)]);
    expect(counts.every(n => n <= 10)).toBe(true);
    while ((await processEventsOnce(sql, o)) > 0);
    const [{ n }] = await admin`select count(*)::int as n from events where workspace_id = ${ws} and processed_at is not null`;
    expect(n).toBe(30);
  });
});
