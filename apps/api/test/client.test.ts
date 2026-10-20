/* hono/client: AppType даёт типизированные запросы и ответы (проверяется и компилятором, и рантаймом). */
import { expect, test } from 'bun:test';
import { createApiClient } from '../src/client';
import { Client, app } from './helpers';

test('typed client calls the API with inferred request/response types', async () => {
  const c = new Client();
  await c.signup();
  const p = await c.project('HCL');
  await c.task(p.id, 'typed task', { priority: 7 });

  const api = createApiClient('http://localhost', {
    workspaceId: c.workspaceId!,
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set('cookie', c.cookie);
      return app.request(input as string, { ...init, headers });
    }) as typeof fetch,
  });
  const res = await api.tasks.$get({ query: { projectId: p.id, sort: '-priority' } });
  expect(res.status).toBe(200);
  if (res.status === 200) {
    const page = await res.json();
    // page.items[0] типизирован как строка таблицы tasks (даты — строки после сериализации)
    const first = page.items[0]!;
    const key: string = first.key;
    const priority: number | null = first.priority;
    expect(key).toBe('HCL-1');
    expect(priority).toBe(7);
    expect(page.total).toBe(1);
  }
  const created = await api.projects.$post({ json: { key: 'TYP', name: 'Typed' } });
  expect(created.status).toBe(201);
});
