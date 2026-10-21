/* Изоляция арендаторов: HTTP-уровень (подмена X-Workspace-Id, прямые запросы по id) и уровень БД (RLS под app_user). */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin, sql } from './helpers';

interface Tenant {
  c: Client;
  ws: string;
  userId: string;
  project: { id: string; key: string };
  task: { id: string; key: string };
  comment: { id: string };
  company: { id: string };
  deal: { id: string };
}

async function makeTenant(label: string, key: string): Promise<Tenant> {
  const c = new Client();
  const { user, workspaces } = await c.signup({ workspaceName: `${label} workspace` });
  const project = await c.project(key, `${label} project`);
  const task = await c.task(project.id, `${label} secret task`);
  const comment = (await c.post('/comments', { taskId: task.id, body: `${label} secret comment` })).body;
  const company = (await c.post('/companies', { name: `${label} Corp` })).body;
  const deal = (await c.post('/deals', { name: `${label} deal`, companyId: company.id, amount: '5000.50' })).body;
  return { c, ws: workspaces[0]!.id, userId: user.id, project, task, comment, company, deal };
}

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  A = await makeTenant('Alpha', 'ALP');
  B = await makeTenant('Beta', 'BET');
});

const RESOURCES = ['projects', 'tasks', 'comments', 'companies', 'deals', 'statuses', 'members', 'time-logs', 'notifications', 'activity', 'events', 'contacts', 'teams', 'files'];

describe('HTTP: tenant boundary', () => {
  test('A cannot use B workspace id (X-Workspace-Id substitution) on any resource', async () => {
    for (const r of RESOURCES) {
      const res = await A.c.get(`/${r}`, B.ws);
      expect(res.status, `GET /${r} with foreign workspace`).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    }
    expect((await A.c.post('/tasks', { projectId: B.project.id, title: 'intruder' }, B.ws)).status).toBe(403);
  });

  test('lists never contain the other tenant records', async () => {
    const tasks = (await A.c.get('/tasks?limit=200')).body;
    expect(tasks.items.map((t: any) => t.id)).toContain(A.task.id);
    expect(tasks.items.map((t: any) => t.id)).not.toContain(B.task.id);
    expect(tasks.items.every((t: any) => t.workspaceId === A.ws)).toBe(true);
    const deals = (await A.c.get('/deals')).body;
    expect(deals.items.map((d: any) => d.name)).toEqual(['Alpha deal']);
    const projects = (await A.c.get('/projects')).body;
    // кроме проекта арендатора в списке — системные проекты модулей (production, services)
    expect(projects.items.map((p: any) => p.key).sort()).toEqual(['ALP', 'PROD', 'SERV']);
    expect(projects.items.every((p: any) => p.workspaceId === A.ws)).toBe(true);
    // поиск по строке чужих данных ничего не находит
    expect((await A.c.get('/tasks?q=Beta')).body.total).toBe(0);
  });

  test('direct access to B records by id from A context: 404 for get / patch / delete', async () => {
    const targets: [string, string][] = [
      ['tasks', B.task.id],
      ['projects', B.project.id],
      ['comments', B.comment.id],
      ['companies', B.company.id],
      ['deals', B.deal.id],
    ];
    for (const [r, id] of targets) {
      expect((await A.c.get(`/${r}/${id}`)).status, `GET ${r}`).toBe(404);
      expect((await A.c.patch(`/${r}/${id}`, { name: 'hacked', title: 'hacked', body: 'hacked' })).status, `PATCH ${r}`).toBe(404);
      expect((await A.c.del(`/${r}/${id}`)).status, `DELETE ${r}`).toBe(404);
      expect((await A.c.del(`/${r}/${id}?hard=true`)).status, `hard DELETE ${r}`).toBe(404);
    }
    // данные B не изменились
    const stillThere = await B.c.get(`/tasks/${B.task.id}`);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.title).toBe('Beta secret task');
    expect(stillThere.body.archivedAt).toBeNull();
  });

  test('A cannot attach its records to B records (composite foreign keys + RLS)', async () => {
    // задача в чужом проекте
    const t = await A.c.post('/tasks', { projectId: B.project.id, title: 'sneaky' });
    expect(t.status).toBe(422);
    // комментарий к чужой задаче
    const cm = await A.c.post('/comments', { taskId: B.task.id, body: 'sneaky' });
    expect(cm.status).toBe(422);
    // сделка с чужой компанией
    const d = await A.c.post('/deals', { name: 'sneaky', companyId: B.company.id });
    expect(d.status).toBe(422);
    // зависимость от чужой задачи
    const dep = await A.c.patch(`/tasks/${A.task.id}`, { deps: [B.task.id] });
    expect(dep.status).toBe(422);
    // ничего не просочилось
    expect((await B.c.get('/tasks')).body.total).toBe(1);
    expect((await B.c.get(`/comments?taskId=${B.task.id}`)).body.total).toBe(1);
  });

  test('missing or malformed X-Workspace-Id', async () => {
    expect((await A.c.get('/tasks', null)).status).toBe(400);
    const bad = await A.c.get('/tasks', 'not-a-uuid');
    expect(bad.status).toBe(400);
    // несуществующий воркспейс — как чужой
    expect((await A.c.get('/tasks', '01a157ac-0000-7000-8000-000000000000')).status).toBe(403);
  });

  test('B events never show up in A feed', async () => {
    const ev = (await A.c.get('/events?limit=200')).body;
    expect(ev.items.length).toBeGreaterThan(0);
    expect(ev.items.every((e: any) => e.workspaceId === A.ws)).toBe(true);
  });

  test('roles: a guest can read and comment but cannot write', async () => {
    const guest = new Client();
    await guest.signup();
    const inv = await A.c.post(`/workspaces/${A.ws}/invites`, { email: guest.user!.email, role: 'guest' });
    expect(inv.status).toBe(201);
    expect((await guest.post('/invites/accept', { token: inv.body.token })).status).toBe(200);
    guest.workspaceId = A.ws;
    expect((await guest.get('/tasks')).status).toBe(200);
    expect((await guest.post('/tasks', { projectId: A.project.id, title: 'nope' })).status).toBe(403);
    expect((await guest.patch(`/tasks/${A.task.id}`, { title: 'nope' })).status).toBe(403);
    expect((await guest.del(`/tasks/${A.task.id}`)).status).toBe(403);
    expect((await guest.post('/comments', { taskId: A.task.id, body: 'guest comment' })).status).toBe(201);
  });
});

/** Выполняет SQL «как приложение»: транзакция, SET LOCAL ROLE app_user и (опционально) контекст арендатора — но БЕЗ фильтров в запросах */
async function asAppUser(ctx: { ws?: string; user?: string }, fn: (tx: any) => Promise<any>): Promise<any> {
  return (await sql.begin(async tx => {
    await tx.unsafe('set local role app_user');
    if (ctx.ws) await tx`select set_config('app.workspace_id', ${ctx.ws}, true)`;
    if (ctx.user) await tx`select set_config('app.user_id', ${ctx.user}, true)`;
    return fn(tx);
  })) as any;
}

describe('DB: RLS works even if the application code "forgets" the filter', () => {
  test('SELECT without WHERE returns only the current tenant rows, for every tenant table', async () => {
    const tables = (await admin`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'workspace_id' and table_name not in ('memberships')`).map(r => r.table_name as string);
    expect(tables.length).toBeGreaterThanOrEqual(20);
    for (const t of tables) {
      const rows = await asAppUser({ ws: A.ws }, tx => tx.unsafe(`select workspace_id from "${t}"`));
      expect(
        rows.every((r: any) => r.workspace_id === A.ws),
        `table ${t} leaked foreign rows`,
      ).toBe(true);
    }
    const aTasks = await asAppUser({ ws: A.ws }, tx => tx`select id from tasks`);
    expect(aTasks.map((r: any) => r.id)).toEqual([A.task.id]);
  });

  test('without app.workspace_id nothing is visible (fail closed)', async () => {
    expect(await asAppUser({}, tx => tx`select id from tasks`)).toHaveLength(0);
    expect(await asAppUser({}, tx => tx`select id from projects`)).toHaveLength(0);
    expect(await asAppUser({}, tx => tx`select id from deals`)).toHaveLength(0);
    expect(await asAppUser({}, tx => tx`select id from workspaces`)).toHaveLength(0);
  });

  test('SELECT by a foreign id returns nothing', async () => {
    expect(await asAppUser({ ws: A.ws }, tx => tx`select * from tasks where id = ${B.task.id}`)).toHaveLength(0);
    expect(await asAppUser({ ws: A.ws }, tx => tx`select * from deals where id = ${B.deal.id}`)).toHaveLength(0);
  });

  test('UPDATE / DELETE without WHERE touch only the current tenant rows', async () => {
    const victim = new Client();
    await victim.signup();
    const p = await victim.project('VIC');
    const t = await victim.task(p.id, 'keep me');
    const upd = await asAppUser({ ws: A.ws }, tx => tx`update tasks set title = 'pwned'`);
    expect(upd.count).toBe(1); // только задача A
    const del = await asAppUser({ ws: A.ws }, tx => tx`delete from comment_reactions`);
    expect(del.count).toBe(0);
    expect((await victim.get(`/tasks/${t.id}`)).body.title).toBe('keep me');
    expect((await B.c.get(`/tasks/${B.task.id}`)).body.title).toBe('Beta secret task');
    await A.c.patch(`/tasks/${A.task.id}`, { title: 'Alpha secret task' }); // вернуть как было
  });

  test('INSERT with another tenant workspace_id is rejected by WITH CHECK', async () => {
    const attempt = asAppUser({ ws: A.ws }, tx => tx`insert into companies (workspace_id, name) values (${B.ws}, 'planted')`);
    await expect(attempt).rejects.toThrow(/row-level security/i);
    // и обратная подмена: id чужого проекта в своей задаче
    const fk = asAppUser({ ws: A.ws }, tx => tx`insert into tasks (workspace_id, key, project_id, title, status) values (${A.ws}, 'X-1', ${B.project.id}, 't', 'todo')`);
    await expect(fk).rejects.toThrow();
  });

  test('moving a row to another tenant via UPDATE workspace_id is rejected', async () => {
    const attempt = asAppUser({ ws: A.ws }, tx => tx`update companies set workspace_id = ${B.ws} where id = ${A.company.id}`);
    await expect(attempt).rejects.toThrow(/row-level security/i);
  });

  test('workspaces / memberships: a user sees only own memberships; foreign ones are invisible', async () => {
    const mine = await asAppUser({ user: A.userId }, tx => tx`select workspace_id, user_id from memberships`);
    expect(mine.every((r: any) => r.user_id === A.userId)).toBe(true);
    expect(mine.map((r: any) => r.workspace_id)).toContain(A.ws);
    expect(mine.map((r: any) => r.workspace_id)).not.toContain(B.ws);
    const wss = await asAppUser({ user: A.userId }, tx => tx`select id from workspaces`);
    expect(wss.map((r: any) => r.id)).toEqual([A.ws]);
    // знание чужого workspace_id не даёт читать его членов/воркспейс
    expect(await asAppUser({ user: A.userId }, tx => tx`select id from workspaces where id = ${B.ws}`)).toHaveLength(0);
    expect(await asAppUser({ user: A.userId }, tx => tx`select id from memberships where workspace_id = ${B.ws}`)).toHaveLength(0);
  });

  test('events are append-only for the application role', async () => {
    await expect(asAppUser({ ws: A.ws }, tx => tx`update events set type = 'forged'`)).rejects.toThrow(/permission denied/i);
    await expect(asAppUser({ ws: A.ws }, tx => tx`delete from events`)).rejects.toThrow(/permission denied/i);
  });

  test('app_user has no BYPASSRLS, is not a superuser, and the login role has no table privileges of its own (no SET ROLE -> denied)', async () => {
    const [r] = await admin`select rolsuper, rolbypassrls from pg_roles where rolname = 'app_user'`;
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
    const [login] = await admin`select rolsuper, rolbypassrls, rolinherit from pg_roles where rolname = 'gr8r_app'`;
    expect(login).toEqual({ rolsuper: false, rolbypassrls: false, rolinherit: false });
    const err = await (async () => {
      try {
        await sql`select * from tasks`;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err?.message).toMatch(/permission denied|does not exist/i); // после wipe у public нет USAGE для PUBLIC: таблицы «не видны»
  });

  test('RLS coverage: every table with workspace_id (and workspaces/memberships) has RLS ENABLED + FORCED and a policy', async () => {
    const rows = await admin`
      select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
             pg_get_userbyid(c.relowner) as owner
      from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and (exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped) or c.relname = 'workspaces')`;
    expect(rows.length).toBeGreaterThanOrEqual(23);
    for (const r of rows) {
      expect(r.rls, `${r.relname}: RLS enabled`).toBe(true);
      expect(r.forced, `${r.relname}: RLS forced`).toBe(true);
      expect(r.policies, `${r.relname}: has policies`).toBeGreaterThan(0);
      expect(r.owner, `${r.relname}: owner`).toBe('app_owner');
    }
  });
});
