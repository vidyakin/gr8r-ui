/* Этап 2: то, что нужно фронтенду для оптимистичных обновлений и Undo — id от клиента, прежний ключ задачи, перенос между проектами. */
import { describe, expect, test } from 'bun:test';
import { uuidv7 } from '@gr8r/db';
import { Client, admin } from './helpers';

describe('client-supplied ids', () => {
  test('create accepts an id and returns it; reusing it is a 409; garbage is a 400', async () => {
    const c = new Client();
    await c.signup();
    const p = await c.project('CID');
    const id = uuidv7();
    const t = await c.post('/tasks', { id, projectId: p.id, title: 'With my id' });
    expect(t.status).toBe(201);
    expect(t.body.id).toBe(id);
    expect(t.body.key).toBe('CID-1');
    expect((await c.post('/tasks', { id, projectId: p.id, title: 'Again' })).status).toBe(409);
    expect((await c.post('/tasks', { id: 'not-a-uuid', projectId: p.id, title: 'Bad' })).status).toBe(400);

    const cid = uuidv7();
    const cm = await c.post('/comments', { id: cid, taskId: id, body: 'hi' });
    expect(cm.body.id).toBe(cid);
    const dealId = uuidv7();
    expect((await c.post('/deals', { id: dealId, name: 'Deal' })).body.id).toBe(dealId);
  });

  test('PATCH ignores an id in the body', async () => {
    const c = new Client();
    await c.signup();
    const p = await c.project('CIP');
    const t = await c.task(p.id, 'T');
    const res = await c.patch(`/tasks/${t.id}`, { id: uuidv7(), title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(t.id);
  });

  test('a deleted task can be re-created with its old id and key (Undo); the counter is not rolled back', async () => {
    const c = new Client();
    await c.signup();
    const p = await c.project('UND');
    const a = await c.task(p.id, 'A');
    const b = await c.task(p.id, 'B');
    expect(b.key).toBe('UND-2');
    expect((await c.del(`/tasks/${a.id}?hard=true`)).status).toBe(200);
    const back = await c.post('/tasks', { id: a.id, key: a.key, projectId: p.id, title: 'A' });
    expect(back.status).toBe(201);
    expect(back.body.key).toBe('UND-1');
    // номер не занят дважды и счётчик идёт дальше
    expect((await c.post('/tasks', { key: 'UND-1', projectId: p.id, title: 'dup' })).status).toBe(409);
    expect((await c.task(p.id, 'C')).key).toBe('UND-3');
    // ключ должен принадлежать проекту
    expect((await c.post('/tasks', { key: 'OTHER-9', projectId: p.id, title: 'x' })).status).toBe(422);
    // старый номер выше счётчика поднимает счётчик
    expect((await c.post('/tasks', { key: 'UND-10', projectId: p.id, title: 'x' })).body.key).toBe('UND-10');
    expect((await c.task(p.id, 'D')).key).toBe('UND-11');
  });
});

describe('invites and workspace deletion', () => {
  test('an invite can name the id of the invited profile, so it can be referenced at once', async () => {
    const c = new Client();
    await c.signup();
    const id = uuidv7();
    const inv = await c.post(`/workspaces/${c.workspaceId}/invites`, { email: 'newbie@test.dev', role: 'guest', memberId: id });
    expect(inv.status).toBe(201);
    expect(inv.body.memberId).toBe(id);
    const m = await c.get(`/members/${id}`);
    expect(m.body).toMatchObject({ email: 'newbie@test.dev', status: 'invited', role: 'guest' });
    // повторное приглашение того же адреса возвращает id существующего профиля
    const again = await c.post(`/workspaces/${c.workspaceId}/invites`, { email: 'newbie@test.dev', role: 'guest' });
    expect(again.body.memberId).toBe(id);
  });

  test('only an owner can delete a workspace; its data goes with it and it disappears from "mine"', async () => {
    const owner = new Client();
    await owner.signup({ workspaceName: 'Doomed' });
    const ws = owner.workspaceId!;
    const p = await owner.project('DEL');
    await owner.task(p.id, 'goes away');
    const admn = new Client();
    await admn.signup();
    const inv = await owner.post(`/workspaces/${ws}/invites`, { email: admn.user!.email, role: 'admin' });
    await admn.post('/invites/accept', { token: inv.body.token });
    admn.workspaceId = ws;
    expect((await admn.del(`/workspaces/${ws}`)).status).toBe(403);
    expect((await owner.del(`/workspaces/${ws}`)).status).toBe(200);
    expect((await owner.get('/workspaces')).body.items.map((w: any) => w.id)).not.toContain(ws);
    expect((await admin.unsafe(`select count(*)::int as n from tasks where workspace_id = '${ws}'`))[0]!.n).toBe(0);
    expect((await owner.get('/projects')).status).toBe(403);
  });
});

describe('moving tasks and time logs', () => {
  test('PATCH projectId moves a task, issues a key from the target project and logs activity', async () => {
    const c = new Client();
    await c.signup();
    const p1 = await c.project('MVA');
    const p2 = await c.project('MVB');
    await c.task(p2.id, 'existing in B');
    const t = await c.task(p1.id, 'Mover');
    expect(t.key).toBe('MVA-1');
    const res = await c.patch(`/tasks/${t.id}`, { projectId: p2.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ projectId: p2.id, key: 'MVB-2' });
    expect((await c.task(p2.id, 'next in B')).key).toBe('MVB-3');
    const act = await c.get(`/activity?taskId=${t.id}`);
    expect(act.body.items.some((a: any) => a.verb === 'moved' && a.extra === 'from MVA-1 to MVB-2')).toBe(true);
    const ev = await admin.unsafe(`select payload from events where record_id = '${t.id}' and type = 'task.updated'`);
    expect(Object.keys(ev[0]!.payload.changes)).toEqual(expect.arrayContaining(['projectId', 'key']));
    // в несуществующий проект — нельзя
    expect((await c.patch(`/tasks/${t.id}`, { projectId: uuidv7() })).status).toBe(422);
  });

  test('a time log can be moved to another task (subtask promoted into a task)', async () => {
    const c = new Client();
    await c.signup();
    const p = await c.project('TLM');
    const a = await c.task(p.id, 'A');
    const b = await c.task(p.id, 'B');
    const log = await c.post('/time-logs', { taskId: a.id, subId: 's1', hours: 1.5, logDate: '2026-01-02' });
    expect(log.status).toBe(201);
    const moved = await c.patch(`/time-logs/${log.body.id}`, { taskId: b.id, subId: null });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ taskId: b.id, subId: null });
  });
});
