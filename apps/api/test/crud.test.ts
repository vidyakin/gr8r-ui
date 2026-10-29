/* CRUD задач и других сущностей: события в outbox, транзакционность, фильтры, пагинация, валидация. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin, stageId } from './helpers';

let c: Client;
let ws: string;
let project: { id: string; key: string };

const events = async (type?: string) =>
  (await admin.unsafe(`select type, entity, record_id, actor_id, payload, processed_at from events where workspace_id = '${ws}' ${type ? `and type = '${type}'` : ''} order by id`)) as any[];

beforeAll(async () => {
  c = new Client();
  await c.signup({ workspaceName: 'CRUD WS' });
  ws = c.workspaceId!;
  project = await c.project('CRD', 'CRUD project');
});

describe('tasks CRUD + outbox', () => {
  test('create: key from project counter, defaults, event task.created in the same transaction', async () => {
    const before = (await events('task.created')).length;
    const res = await c.post('/tasks', { projectId: project.id, title: 'First task', priority: 8, labels: ['bug'], planHours: 2.5, dueDate: '2026-12-31' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ key: 'CRD-1', title: 'First task', status: 'todo', priority: 8, labels: ['bug'], planHours: '2.50', dueDate: '2026-12-31', subtasks: [], deps: [], workspaceId: ws });
    expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); // uuid v7
    const second = await c.post('/tasks', { projectId: project.id, title: 'Second' });
    expect(second.body.key).toBe('CRD-2');
    const ev = await events('task.created');
    expect(ev.length).toBe(before + 2);
    const last = ev[before]!;
    expect(last.entity).toBe('task');
    expect(last.record_id).toBe(res.body.id);
    expect(last.actor_id).toBe((await admin.unsafe(`select id from members where workspace_id='${ws}' and user_id='${c.user!.id}'`))[0]!.id);
    expect(last.payload.record.title).toBe('First task');
    expect(last.processed_at).toBeNull(); // воркер ещё не обработал
  });

  test('patch: event with a field diff, no event for a no-op patch, status change sets completedAt/prevStatus', async () => {
    const t = await c.task(project.id, 'Patch me');
    const before = (await events('task.updated')).length;
    const noop = await c.patch(`/tasks/${t.id}`, { title: 'Patch me' });
    expect(noop.status).toBe(200);
    expect((await events('task.updated')).length).toBe(before);

    const r = await c.patch(`/tasks/${t.id}`, { title: 'Patched', status: 'done', priority: 3 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ title: 'Patched', status: 'done', prevStatus: 'todo', priority: 3 });
    expect(r.body.completedAt).toBeString();
    const ev = await events('task.updated');
    expect(ev.length).toBe(before + 1);
    expect(ev.at(-1)!.payload.changes.title).toEqual({ from: 'Patch me', to: 'Patched' });
    expect(ev.at(-1)!.payload.changes.status).toEqual({ from: 'todo', to: 'done' });

    const reopened = await c.patch(`/tasks/${t.id}`, { status: 'progress' });
    expect(reopened.body.completedAt).toBeNull();
    expect(reopened.body.prevStatus).toBe('done');
    // PATCH не сбрасывает остальные поля к значениям по умолчанию
    expect(reopened.body.title).toBe('Patched');
    expect(reopened.body.priority).toBe(3);
  });

  test('patch keeps untouched fields (zod defaults must not leak into PATCH)', async () => {
    const t = await c.task(project.id, 'Keep fields', { labels: ['design', 'qa'], description: 'important', priority: 9, status: 'review' });
    const r = await c.patch(`/tasks/${t.id}`, { title: 'Renamed' });
    expect(r.body).toMatchObject({ title: 'Renamed', labels: ['design', 'qa'], description: 'important', priority: 9, status: 'review' });
  });

  test('subtasks tree (jsonb) round-trips', async () => {
    const tree = [{ id: 's1', title: 'A', done: false, planHours: 3, subtasks: [{ id: 's2', title: 'B', done: true, subtasks: [] }] }];
    const t = await c.task(project.id, 'With subtasks', { subtasks: tree });
    expect((await c.get(`/tasks/${t.id}`)).body.subtasks).toEqual(tree);
  });

  test('archive (soft delete) -> hidden from list, visible with archived=only/include, restore, hard delete is admin-only and emits events', async () => {
    const t = await c.task(project.id, 'Archive me');
    const del = await c.del(`/tasks/${t.id}`);
    expect(del.body).toMatchObject({ id: t.id, archived: true, deleted: false });
    expect((await c.get('/tasks?limit=200')).body.items.map((x: any) => x.id)).not.toContain(t.id);
    expect((await c.get('/tasks?archived=only')).body.items.map((x: any) => x.id)).toEqual([t.id]);
    expect((await c.get('/tasks?archived=include&limit=200')).body.items.map((x: any) => x.id)).toContain(t.id);
    expect((await events('task.archived')).some(e => e.record_id === t.id)).toBe(true);

    const restored = await c.post(`/tasks/${t.id}/restore`);
    expect(restored.body.archivedAt).toBeNull();
    expect((await events('task.restored')).some(e => e.record_id === t.id)).toBe(true);

    const hard = await c.del(`/tasks/${t.id}?hard=true`); // владелец воркспейса — admin и выше
    expect(hard.body).toMatchObject({ deleted: true });
    expect((await c.get(`/tasks/${t.id}`)).status).toBe(404);
    expect((await events('task.deleted')).some(e => e.record_id === t.id)).toBe(true);
  });

  test('a failed request leaves no trace: no event, no counter bump (transaction rolled back)', async () => {
    const counterBefore = (await admin.unsafe(`select task_counter from projects where id = '${project.id}'`))[0]!.task_counter;
    const evBefore = (await events()).length;
    const bad = await c.post('/tasks', { projectId: project.id, title: 'Unknown status', status: 'does-not-exist' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('invalid_reference');
    expect((await admin.unsafe(`select task_counter from projects where id = '${project.id}'`))[0]!.task_counter).toBe(counterBefore);
    expect((await events()).length).toBe(evBefore);
    const next = await c.task(project.id, 'After failure');
    expect(next.key).toBe(`CRD-${counterBefore + 1}`);
  });

  test('list: filters, sorting, pagination, search', async () => {
    const p = await c.project('LST', 'List project');
    for (const [i, status] of ['todo', 'todo', 'progress', 'done'].entries()) await c.task(p.id, `Item ${i} ${i === 2 ? 'needle' : ''}`, { status, priority: i + 1, assigneeId: null });
    const all = await c.get(`/tasks?projectId=${p.id}`);
    expect(all.body).toMatchObject({ total: 4, limit: 50, offset: 0 });
    expect((await c.get(`/tasks?projectId=${p.id}&status=todo`)).body.total).toBe(2);
    const sorted = await c.get(`/tasks?projectId=${p.id}&sort=-priority`);
    expect(sorted.body.items.map((t: any) => t.priority)).toEqual([4, 3, 2, 1]);
    const page = await c.get(`/tasks?projectId=${p.id}&sort=priority&limit=2&offset=1`);
    expect(page.body.items.map((t: any) => t.priority)).toEqual([2, 3]);
    expect(page.body.total).toBe(4);
    expect((await c.get(`/tasks?projectId=${p.id}&q=needle`)).body.total).toBe(1);
    expect((await c.get(`/tasks?projectId=${p.id}&assigneeId=none`)).body.total).toBe(4);
    expect((await c.get(`/tasks?projectId=${p.id}&priority=3`)).body.items[0].priority).toBe(3);
    // LIKE-спецсимволы в поиске экранируются
    expect((await c.get('/tasks?q=%25')).body.total).toBe(0);
  });

  test('validation errors share one format', async () => {
    const cases: [string, unknown][] = [
      ['/tasks', { projectId: project.id }], // нет title
      ['/tasks', { projectId: 'nope', title: 'x' }],
      ['/tasks', { projectId: project.id, title: 'x', priority: 11 }],
      ['/tasks', { projectId: project.id, title: 'x', dueDate: '31.12.2026' }],
      ['/tasks', { projectId: project.id, title: '   ' }],
      ['/projects', { key: 'a', name: 'x' }],
      ['/deals', { name: 'x', amount: 'lots' }],
      ['/time-logs', { taskId: 'x', hours: 5, logDate: '2026-01-01' }],
    ];
    for (const [path, body] of cases) {
      const res = await c.post(path, body);
      expect(res.status, `${path} ${JSON.stringify(body)}`).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
      expect(res.body.error.message).toBeString();
      expect(res.body.error.details.issues.length).toBeGreaterThan(0);
    }
    expect((await c.get('/tasks?limit=1000')).status).toBe(400);
    expect((await c.get('/tasks?sort=nonsense')).body.error.code).toBe('invalid_sort');
    expect((await c.get('/tasks/not-a-uuid')).status).toBe(400);
    const badJson = await c.req('POST', '/tasks', { headers: { 'content-type': 'application/json' } });
    expect(badJson.status).toBe(400);
  });

  test('unique constraints are reported as 409', async () => {
    const dup = await c.post('/projects', { key: 'crd', name: 'Duplicate key' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('conflict');
  });
});

describe('other resources', () => {
  test('comments: author is the current member, notification for the assignee, reactions toggle', async () => {
    const other = new Client();
    await other.signup();
    const inv = await c.post(`/workspaces/${ws}/invites`, { email: other.user!.email, role: 'member' });
    await other.post('/invites/accept', { token: inv.body.token });
    other.workspaceId = ws;
    const otherMember = (await other.get('/members')).body.items.find((m: any) => m.userId === other.user!.id);

    const t = await c.task(project.id, 'Discuss', { assigneeId: otherMember.id });
    const cm = await c.post('/comments', { taskId: t.id, body: 'Hello there' });
    expect(cm.status).toBe(201);
    expect(cm.body.re).toEqual({});
    const mineId = (await c.get('/members')).body.items.find((m: any) => m.userId === c.user!.id).id;
    expect(cm.body.authorId).toBe(mineId);

    // уведомление ушло исполнителю, а не автору
    const notifs = (await other.get('/notifications?limit=100')).body.items;
    expect(notifs.some((n: any) => n.type === 'comment' && n.taskId === t.id)).toBe(true);
    expect((await c.get('/notifications?limit=100')).body.items.some((n: any) => n.taskId === t.id && n.type === 'comment')).toBe(false);

    const r1 = await other.post(`/comments/${cm.body.id}/reactions`, { emoji: '👍' });
    expect(r1.body.re).toEqual({ '👍': [otherMember.id] });
    const r2 = await other.post(`/comments/${cm.body.id}/reactions`, { emoji: '👍' });
    expect(r2.body.re).toEqual({});

    // чужой комментарий нельзя править/удалять (не автор и не admin)
    expect((await other.patch(`/comments/${cm.body.id}`, { body: 'edit' })).status).toBe(403);
    expect((await c.patch(`/comments/${cm.body.id}`, { body: 'edited' })).status).toBe(200);
    expect((await other.del(`/comments/${cm.body.id}`)).status).toBe(403);
  });

  test('notifications: only own, mark read, read-all', async () => {
    const me = new Client();
    await me.signup();
    const p = await me.project('NTF');
    const mine = (await me.get('/members')).body.items[0];
    const buddy = new Client();
    await buddy.signup();
    const inv = await me.post(`/workspaces/${me.workspaceId}/invites`, { email: buddy.user!.email });
    await buddy.post('/invites/accept', { token: inv.body.token });
    buddy.workspaceId = me.workspaceId;
    // buddy назначает задачу мне -> уведомление мне
    const t = (await buddy.post('/tasks', { projectId: p.id, title: 'For you', assigneeId: mine.id })).body;
    const list = (await me.get('/notifications')).body;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ type: 'assign', taskId: t.id, read: false });
    expect((await buddy.get('/notifications')).body.total).toBe(0); // у buddy своих нет
    const patched = await me.patch(`/notifications/${list.items[0].id}`, { read: true });
    expect(patched.body.read).toBe(true);
    expect((await buddy.patch(`/notifications/${list.items[0].id}`, { read: false })).status).toBe(404); // чужое уведомление
    await buddy.post('/tasks', { projectId: p.id, title: 'Another', assigneeId: mine.id });
    expect((await me.post('/notifications/read-all')).body.updated).toBe(1);
    expect((await me.get('/notifications?read=false')).body.total).toBe(0);
  });

  test('time logs: validation, member defaults to the current user', async () => {
    const t = await c.task(project.id, 'Timed');
    const ok = await c.post('/time-logs', { taskId: t.id, hours: 1.5, logDate: '2026-10-01', note: 'work' });
    expect(ok.status).toBe(201);
    expect(ok.body.hours).toBe('1.50');
    expect((await c.post('/time-logs', { taskId: t.id, hours: 0, logDate: '2026-10-01' })).status).toBe(400);
    expect((await c.post('/time-logs', { taskId: t.id, hours: 25, logDate: '2026-10-01' })).status).toBe(400);
    expect((await c.get(`/time-logs?taskId=${t.id}`)).body.total).toBe(1);
  });

  test('statuses: built-in statuses are protected; custom ones work and tasks may use them', async () => {
    const list = (await c.get('/statuses')).body;
    expect(list.items.map((s: any) => s.key)).toEqual(['backlog', 'todo', 'progress', 'review', 'done']);
    const done = list.items.find((s: any) => s.key === 'done');
    expect((await c.del(`/statuses/${done.id}`)).status).toBe(422);
    expect((await c.patch(`/statuses/${done.id}`, { name: 'Finished' })).status).toBe(422);
    const created = await c.post('/statuses', { key: 'qa', name: 'QA' });
    expect(created.status).toBe(201);
    expect((await c.task(project.id, 'In QA', { status: 'qa' })).status).toBe('qa');
    // нельзя удалить статус, который используют задачи
    expect((await c.del(`/statuses/${created.body.id}`)).status).toBe(422);
  });

  test('projects: members/permissions are replaced as a set and returned', async () => {
    const mine = (await c.get('/members')).body.items.find((m: any) => m.userId === c.user!.id);
    const p = await c.post('/projects', { key: 'PRM', name: 'Perms', members: [{ memberId: mine.id, permission: 'admin' }] });
    expect(p.body.members).toEqual([{ memberId: mine.id, permission: 'admin' }]);
    const upd = await c.patch(`/projects/${p.body.id}`, { members: [{ memberId: mine.id, permission: 'view' }] });
    expect(upd.body.members).toEqual([{ memberId: mine.id, permission: 'view' }]);
    const named = await c.patch(`/projects/${p.body.id}`, { name: 'Perms 2' });
    expect(named.body.members).toHaveLength(1); // PATCH без members не трогает участников
    expect((await events('project.members_changed')).length).toBeGreaterThan(0);
  });

  test('CRM: deal stage transitions set closedAt, add a system activity, money stays exact', async () => {
    const co = (await c.post('/companies', { name: 'Deal Co' })).body;
    const ct = (await c.post('/contacts', { name: 'Jane', companyId: co.id, email: 'jane@deal.co' })).body;
    const d = await c.post('/deals', { name: 'Big deal', companyId: co.id, amount: 1234567.891, contactIds: [ct.id] });
    expect(d.status).toBe(201);
    expect(d.body.amount).toBe('1234567.89');
    expect(d.body.contactIds).toEqual([ct.id]);
    expect(d.body.closedAt).toBeNull();
    const won = await c.patch(`/deals/${d.body.id}`, { stageId: await stageId(c, 'won') });
    expect(won.body.stageId).toBe(await stageId(c, 'won'));
    expect(won.body.closedAt).toBe(new Date().toISOString().slice(0, 10));
    const reopened = await c.patch(`/deals/${d.body.id}`, { stageId: await stageId(c, 'negotiation') });
    expect(reopened.body.closedAt).toBeNull();
    const acts = (await c.get(`/crm-activities?dealId=${d.body.id}`)).body.items;
    expect(acts.filter((a: any) => a.system).length).toBe(2);
    expect((await c.get(`/deals?stageId=${await stageId(c, 'negotiation')}&companyId=${co.id}`)).body.total).toBe(1);
    const task = await c.post('/crm-activities', { type: 'task', subject: 'Call back', dealId: d.body.id, dueDate: '2026-11-01' });
    expect(task.body).toMatchObject({ done: false, companyId: co.id, system: false });
    // системные записи не редактируются
    expect((await c.patch(`/crm-activities/${acts.find((a: any) => a.system).id}`, { subject: 'x' })).status).toBe(403);
  });

  test('members: profile edit rules; teams are admin-managed', async () => {
    const mine = (await c.get('/members')).body.items.find((m: any) => m.userId === c.user!.id);
    expect((await c.patch(`/members/${mine.id}`, { title: 'CEO', color: '#123456' })).body).toMatchObject({ title: 'CEO', color: '#123456' });
    expect((await c.patch(`/members/${mine.id}`, { status: 'deactivated' })).status).toBe(422); // владельца нельзя деактивировать
    const team = await c.post('/teams', { key: 'core', name: 'Core' });
    expect(team.status).toBe(201);
    expect((await c.patch(`/members/${mine.id}`, { teamId: team.body.id })).body.teamId).toBe(team.body.id);
    expect((await c.post('/members', { name: 'x' })).status).toBe(405);
  });

  test('GET /events?since= returns only newer events, in order', async () => {
    const first = (await c.get('/events?limit=5')).body.items;
    const since = first[2].id;
    const rest = (await c.get(`/events?since=${since}&limit=200`)).body.items;
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((e: any) => e.id > since)).toBe(true);
    expect([...rest].sort((a: any, b: any) => (a.id < b.id ? -1 : 1))).toEqual(rest);
  });

  test('health endpoint', async () => {
    const res = await c.req('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });
});
