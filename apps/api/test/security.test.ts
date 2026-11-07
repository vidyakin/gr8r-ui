/* Безопасность: хранимый XSS в описании задачи (HTML вставляется в интерфейс), запись гостем. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, addMember } from './helpers';

let owner: Client;
let project: { id: string };

beforeAll(async () => {
  owner = new Client();
  await owner.signup();
  project = await owner.project('SEC');
});

describe('task description html', () => {
  const evil = '<p>Текст <b>жирный</b></p><img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">ссылка</a><a href="https://example.com" onclick="x()">ok</a><iframe src="https://evil.test"></iframe>';

  test('create: scripts, handlers, images and javascript links are cut, the toolbar markup stays', async () => {
    const member = await addMember(owner, 'member');
    const r = await member.post('/tasks', { projectId: project.id, title: 'XSS', description: evil });
    expect(r.status).toBe(201);
    const d: string = r.body.description;
    expect(d).toContain('<b>жирный</b>');
    expect(d).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a>');
    for (const bad of ['<img', 'onerror', '<script', 'javascript:', 'onclick', '<iframe']) expect(d).not.toContain(bad);
    // в базе то же, что в ответе
    expect((await owner.get(`/tasks/${r.body.id}`)).body.description).toBe(d);
  });

  test('update: the patched description is cleaned too', async () => {
    const t = await owner.task(project.id, 'Patch');
    const r = await owner.patch(`/tasks/${t.id}`, { description: '<h4>Заголовок</h4><svg onload="alert(1)"></svg>' });
    expect(r.status).toBe(200);
    expect(r.body.description).toBe('<h4>Заголовок</h4>');
  });
});

describe('guests are read-only', () => {
  test('a guest cannot react to comments; a member can', async () => {
    const t = await owner.task(project.id, 'Reactions');
    const cm = await owner.post('/comments', { taskId: t.id, body: 'Привет' });
    const guest = await addMember(owner, 'guest');
    expect((await guest.post(`/comments/${cm.body.id}/reactions`, { emoji: '👍' })).status).toBe(403);
    const member = await addMember(owner, 'member');
    expect((await member.post(`/comments/${cm.body.id}/reactions`, { emoji: '👍' })).status).toBe(200);
  });
});
