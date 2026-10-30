/* Закрытые проекты: доступ проверяет БД (RLS), поэтому обойти его прямым вызовом API нельзя. docs/architecture/tenancy.md */
import { describe, expect, test } from 'bun:test';
import { Client, addMember } from './helpers';

async function setup() {
  const owner = new Client();
  await owner.signup();
  const insider = await addMember(owner); // участник закрытого проекта
  const outsider = await addMember(owner); // обычный участник воркспейса, не в проекте
  const admin = await addMember(owner, 'admin');
  const memberId = async (c: Client) => (await owner.get('/members')).body.items.find((m: any) => m.userId === c.user!.id).id as string;
  const open = await owner.project('OPN', 'Open');
  const p = (await owner.post('/projects', { key: 'SEC', name: 'Secret', isPrivate: true, access: 'private', members: [{ memberId: await memberId(insider), permission: 'edit' }] })).body;
  const t = await owner.task(p.id, 'Secret task');
  const comment = (await owner.post('/comments', { taskId: t.id, body: 'secret note' })).body;
  const log = (await owner.post('/time-logs', { taskId: t.id, hours: '1.5', logDate: '2026-10-01' })).body;
  const file = (await owner.post('/files', { projectId: p.id, name: 'plan.pdf' })).body;
  const ev = (await owner.post('/calendar-events', { projectId: p.id, title: 'Secret meeting', eventDate: '2026-10-02' })).body;
  const view = (await owner.post('/saved-views', { projectId: p.id, name: 'Mine', type: 'list' })).body;
  return { owner, insider, outsider, admin, open, p, t, comment, log, file, ev, view };
}

describe('закрытые проекты', () => {
  test('посторонний участник не видит проект и его содержимое ни в списках, ни по id', async () => {
    const s = await setup();
    for (const x of [s.insider, s.admin, s.owner]) {
      expect((await x.get(`/projects/${s.p.id}`)).status).toBe(200);
      expect((await x.get(`/tasks/${s.t.id}`)).status).toBe(200);
      expect((await x.get(`/comments?taskId=${s.t.id}`)).body.items).toHaveLength(1);
    }
    const o = s.outsider;
    const visible = (await o.get('/projects')).body.items.map((x: any) => x.id);
    expect(visible).toContain(s.open.id);
    expect(visible).not.toContain(s.p.id);
    expect((await o.get(`/projects/${s.p.id}`)).status).toBe(404);
    expect((await o.get('/tasks')).body.items.map((x: any) => x.id)).not.toContain(s.t.id);
    expect((await o.get(`/tasks?projectId=${s.p.id}`)).body.items).toHaveLength(0);
    expect((await o.get(`/tasks/${s.t.id}`)).status).toBe(404);
    expect((await o.get(`/comments?taskId=${s.t.id}`)).body.items).toHaveLength(0);
    expect((await o.get(`/comments/${s.comment.id}`)).status).toBe(404);
    expect((await o.get(`/time-logs?taskId=${s.t.id}`)).body.items).toHaveLength(0);
    expect((await o.get(`/time-logs/${s.log.id}`)).status).toBe(404);
    expect((await o.get(`/files?projectId=${s.p.id}`)).body.items).toHaveLength(0);
    expect((await o.get(`/files/${s.file.id}`)).status).toBe(404);
    expect((await o.get('/calendar-events')).body.items.map((x: any) => x.id)).not.toContain(s.ev.id);
    expect((await o.get(`/saved-views?projectId=${s.p.id}`)).body.items).toHaveLength(0);
    const activity = (await o.get('/activity')).body.items as any[];
    expect(activity.some(a => a.projectId === s.p.id)).toBe(false);
    // журнал событий не отдаёт снимки записей закрытого проекта
    const events = (await o.get('/events?limit=200')).body.items as any[];
    expect(events.some(e => e.recordId === s.p.id || e.recordId === s.t.id || e.recordId === s.comment.id)).toBe(false);
    expect(((await s.insider.get('/events?limit=200')).body.items as any[]).some(e => e.recordId === s.t.id)).toBe(true);
  });

  test('посторонний не может писать в закрытый проект прямым вызовом API', async () => {
    const s = await setup();
    const o = s.outsider;
    expect((await o.post('/tasks', { projectId: s.p.id, title: 'Intruder' })).status).toBeGreaterThanOrEqual(400);
    expect((await o.patch(`/tasks/${s.t.id}`, { title: 'Hacked' })).status).toBe(404);
    expect((await o.del(`/tasks/${s.t.id}`)).status).toBe(404);
    expect((await o.post('/comments', { taskId: s.t.id, body: 'hi' })).status).toBeGreaterThanOrEqual(400);
    expect((await o.post('/time-logs', { taskId: s.t.id, hours: '1', logDate: '2026-10-01' })).status).toBeGreaterThanOrEqual(400);
    expect((await o.post('/files', { projectId: s.p.id, name: 'x.pdf' })).status).toBeGreaterThanOrEqual(400);
    expect((await o.post('/calendar-events', { projectId: s.p.id, title: 'x', eventDate: '2026-10-02' })).status).toBeGreaterThanOrEqual(400);
    expect((await o.patch(`/projects/${s.p.id}`, { name: 'Hacked', isPrivate: false, access: 'workspace' })).status).toBe(404);
    expect((await o.del(`/projects/${s.p.id}`)).status).toBe(404);
    // перенос своей задачи в закрытый проект тоже закрыт
    const mine = await o.task(s.open.id, 'Mine');
    expect((await o.patch(`/tasks/${mine.id}`, { projectId: s.p.id })).status).toBeGreaterThanOrEqual(400);
    // ничего не изменилось
    expect((await s.owner.get(`/tasks/${s.t.id}`)).body.title).toBe('Secret task');
  });

  test('участник проекта работает в нём; открытие проекта возвращает видимость', async () => {
    const s = await setup();
    const t2 = await s.insider.task(s.p.id, 'By insider');
    expect((await s.insider.post('/comments', { taskId: t2.id, body: 'ok' })).status).toBe(201);
    expect((await s.outsider.get(`/tasks/${t2.id}`)).status).toBe(404);
    expect((await s.owner.patch(`/projects/${s.p.id}`, { isPrivate: false, access: 'workspace' })).status).toBe(200);
    expect((await s.outsider.get(`/projects/${s.p.id}`)).status).toBe(200);
    expect((await s.outsider.get(`/tasks/${t2.id}`)).status).toBe(200);
  });

  test('создатель закрытого проекта видит его сразу, даже если не указал себя участником', async () => {
    const owner = new Client();
    await owner.signup();
    const m = await addMember(owner);
    const res = await m.post('/projects', { key: 'MINE', name: 'Mine', isPrivate: true, members: [] });
    expect(res.status).toBe(201);
    expect((await m.get(`/projects/${res.body.id}`)).status).toBe(200);
    expect((await m.task(res.body.id, 'T')).key).toBe('MINE-1');
  });
});
