/* DDL вынесен из API: логин-роль API не может стать владельцем таблиц, индексы полей конструктора строит воркер
   по задачам из очереди jobs через отдельное подключение (DATABASE_URL_DDL) и только по белому списку операций. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { uuidv7 } from '@gr8r/db';
import { defaultOptions, processJobsOnce } from '../../worker/src/worker';
import { Client, admin, ddl, drainJobs, sql } from './helpers';

let owner: Client;

const idxName = (id: string) => `idx_cf_${id.replace(/-/g, '')}`;
const hasIndex = async (id: string) => (await admin.unsafe(`select 1 from pg_indexes where indexname = '${idxName(id)}'`)).length > 0;
const rejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  return undefined;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'DDL WS' });
  await owner.post('/entities', { name: 'Parts' });
});

describe('the API login role has no owner rights', () => {
  test('SET ROLE app_owner fails under the API login; it cannot create indexes or DDL either', async () => {
    const e = await rejection(sql.unsafe('set role app_owner'));
    expect(e?.message).toMatch(/permission denied to set role|must be member/i);
    expect((await rejection(sql.unsafe('create index tmp_idx on tasks (title)')))?.message).toMatch(/permission denied|must be owner|does not exist/i);
    expect((await rejection(sql.unsafe('create table public.sneaky (id int)')))?.message).toMatch(/permission denied/i);
    // и через транзакцию арендатора (SET LOCAL ROLE app_user уже сделан): стать владельцем нельзя
    const e2 = await rejection(sql.begin(async tx => (await tx.unsafe('set local role app_user'), tx.unsafe('set local role app_owner'))));
    expect(e2?.message).toMatch(/permission denied/i);
  });

  test('role memberships: gr8r_app is only in app_user / app_worker; the DDL role inherits app_owner and nothing else', async () => {
    const m = (user: string) =>
      admin.unsafe(`select r.rolname, am.inherit_option as inherit, am.set_option as "set" from pg_auth_members am join pg_roles r on r.oid = am.roleid join pg_roles u on u.oid = am.member where u.rolname = '${user}' order by 1`);
    expect((await m('gr8r_app')).map((r: any) => r.rolname)).toEqual(['app_user', 'app_worker']);
    expect(JSON.parse(JSON.stringify(await m('gr8r_ddl')))).toEqual([{ rolname: 'app_owner', inherit: true, set: false }]);
    const [r] = await admin`select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = 'gr8r_ddl'`;
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
  });
});

describe('indexes are built by the worker from the jobs table', () => {
  test('the API only enqueues a job; the index appears after the worker handles it', async () => {
    const before = await admin`select count(*)::int as n from jobs where type = 'index.create'`;
    const f = (await owner.post('/entities/parts/fields', { name: 'Length', type: 'number', filterable: true })).body;
    expect(await hasIndex(f.id)).toBe(false); // API DDL не выполняет
    const queued = await admin`select payload, queue, status from jobs where type = 'index.create' and payload->>'fieldId' = ${f.id}`;
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ queue: 'ddl', status: 'queued', payload: { fieldId: f.id } });
    expect((await admin`select count(*)::int as n from jobs where type = 'index.create'`)[0]!.n).toBe(before[0]!.n + 1);
    await drainJobs();
    expect(await hasIndex(f.id)).toBe(true);
    expect((await admin`select status from jobs where payload->>'fieldId' = ${f.id}`)[0]!.status).toBe('done');
    // выключили флаг — задача index.drop, индекс уходит после обработки
    await owner.patch(`/entities/parts/fields/${f.id}`, { filterable: false });
    expect(await hasIndex(f.id)).toBe(true);
    await drainJobs();
    expect(await hasIndex(f.id)).toBe(false);
  });

  test('without a DDL connection the worker builds nothing: the job fails and is retried later', async () => {
    const f = (await owner.post('/entities/parts/fields', { name: 'Height', type: 'number', filterable: true })).body;
    const quiet = defaultOptions({ log: () => {}, ddl: null });
    await processJobsOnce(sql, quiet);
    expect(await hasIndex(f.id)).toBe(false);
    const [j] = await admin`select status, attempts, last_error from jobs where payload->>'fieldId' = ${f.id}`;
    expect(j).toMatchObject({ status: 'queued', attempts: 1 });
    expect(j!.last_error).toContain('DATABASE_URL_DDL');
    await admin`update jobs set run_at = now() where payload->>'fieldId' = ${f.id}`;
    await drainJobs();
    expect(await hasIndex(f.id)).toBe(true);
  });

  test('a stale job is judged by the current metadata: a deleted or hidden field gets no index', async () => {
    const f = (await owner.post('/entities/parts/fields', { name: 'Stale', type: 'number', filterable: true })).body;
    await owner.del(`/entities/parts/fields/${f.id}?confirm=stale`); // скрыто до выполнения задачи create
    await drainJobs();
    expect(await hasIndex(f.id)).toBe(false);
    // восстановление ставит create, повторный drop (поставленный при скрытии) не снимает индекс
    await owner.post(`/entities/parts/fields/${f.id}/restore`);
    await drainJobs();
    expect(await hasIndex(f.id)).toBe(true);
    await owner.del(`/entities/parts/fields/${f.id}?confirm=stale`);
    await drainJobs();
    expect(await hasIndex(f.id)).toBe(false);
  });

  test('white list: forged or invalid jobs execute nothing', async () => {
    const quiet = defaultOptions({ log: () => {}, ddl, concurrency: 10 });
    const ws = owner.workspaceId!;
    const fakeField = uuidv7();
    const jobs = [
      { type: 'index.create', payload: { fieldId: "x'; drop table tasks; --" } }, // не uuid
      { type: 'index.create', payload: { fieldId: fakeField } }, // поля нет
      { type: 'index.drop', payload: { fieldId: "x'; drop table tasks; --" } },
      { type: 'index.create', payload: { sql: 'drop table tasks', key: "a'); drop table tasks; --" } },
      { type: 'sql.exec', payload: { statement: 'drop table tasks' } }, // операции вне белого списка
    ];
    for (const j of jobs) await admin`insert into jobs (workspace_id, queue, type, payload, max_attempts) values (${ws}, 'ddl', ${j.type}, ${JSON.stringify(j.payload)}::jsonb, 1)`;
    await processJobsOnce(sql, quiet);
    const rows = await admin`select type, status, last_error from jobs where workspace_id = ${ws} and type in ('sql.exec') or (workspace_id = ${ws} and payload::text like '%drop table%')`;
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((r: any) => r.status === 'failed')).toBe(true);
    expect(rows.find((r: any) => r.type === 'sql.exec')!.last_error).toContain('no handler');
    expect((await admin`select 1 from pg_tables where tablename = 'tasks'`).length).toBe(1);
    // поле не найдено — задача завершается без действий
    expect((await admin`select status from jobs where payload->>'fieldId' = ${fakeField}`)[0]!.status).toBe('done');
    expect(await hasIndex(fakeField)).toBe(false);
  });

  test('the DDL role can build indexes on the tables it inherits, but has no way to read tenant rows', async () => {
    // владелец подчиняется FORCE RLS: без app.workspace_id строк нет
    expect((await ddl.unsafe('select count(*)::int as n from tasks'))[0]!.n).toBe(0);
    expect((await rejection(ddl.unsafe('set role app_user')))?.message).toMatch(/permission denied/i);
  });
});
