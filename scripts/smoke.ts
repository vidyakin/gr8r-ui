/* Сквозной сценарий против запущенного API: signup → signin → воркспейс → проект и задача → список → событие по WebSocket.
   Запуск: bun scripts/smoke.ts [http://localhost:3000]   (то же самое можно повторить руками через curl — см. README). */
const base = process.argv[2] ?? process.env.API_URL ?? 'http://localhost:3000';
const email = `smoke-${Date.now()}@example.com`;
const step = (n: number, msg: string) => console.log(`${n}. ${msg}`);
const fail = (msg: string): never => {
  console.error('FAIL:', msg);
  process.exit(1);
};

let cookie = '';
async function call(method: string, path: string, body?: unknown, ws?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(ws ? { 'x-workspace-id': ws } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie().find(c => c.startsWith('gr8r_session='));
  if (set) cookie = set.split(';')[0]!;
  const json = (await res.json().catch(() => null)) as any;
  return { status: res.status, json };
}

let r = await call('POST', '/auth/signup', { email, password: 'smoke-pass-123', name: 'Smoke Test' });
if (r.status !== 201) fail(`signup ${r.status} ${JSON.stringify(r.json)}`);
step(1, `signup ${email} -> 201`);

await call('POST', '/auth/signout');
cookie = '';
r = await call('POST', '/auth/signin', { email, password: 'smoke-pass-123' });
if (r.status !== 200 || !cookie) fail(`signin ${r.status}`);
step(2, 'signin -> 200, session cookie set');

r = await call('POST', '/workspaces', { name: 'Smoke Workspace' });
if (r.status !== 201) fail(`workspace ${r.status} ${JSON.stringify(r.json)}`);
const ws: string = r.json.id;
step(3, `workspace created: ${ws} (role ${r.json.role})`);

// WebSocket подписываемся ДО изменений
const events: any[] = [];
const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?workspace=${ws}`, { headers: { cookie } } as never);
socket.onmessage = e => events.push(JSON.parse(String(e.data)));
await new Promise<void>((res, rej) => {
  socket.onopen = () => res();
  socket.onerror = () => rej(new Error('websocket failed'));
});
step(4, 'websocket connected');

r = await call('POST', '/projects', { key: 'SMK', name: 'Smoke project' }, ws);
if (r.status !== 201) fail(`project ${r.status} ${JSON.stringify(r.json)}`);
const projectId: string = r.json.id;
r = await call('POST', '/tasks', { projectId, title: 'Smoke task', priority: 7 }, ws);
if (r.status !== 201) fail(`task ${r.status} ${JSON.stringify(r.json)}`);
step(5, `project + task created: ${r.json.key} (${r.json.id})`);

r = await call('GET', `/tasks?projectId=${projectId}&sort=-priority`, undefined, ws);
if (r.status !== 200 || r.json.total !== 1) fail(`list ${r.status} ${JSON.stringify(r.json)}`);
step(6, `list tasks -> total ${r.json.total}: ${r.json.items.map((t: any) => `${t.key} "${t.title}" p${t.priority}`).join(', ')}`);

const t0 = Date.now();
while (!events.some(e => e.type === 'event' && e.event.type === 'task.created') && Date.now() - t0 < 3000) await Bun.sleep(25);
const got = events.find(e => e.type === 'event' && e.event.type === 'task.created');
if (!got) fail(`no task.created event over websocket; got ${JSON.stringify(events)}`);
step(7, `websocket event received in ${Date.now() - t0} ms: ${got.event.type} record ${got.event.recordId}`);

socket.close();
console.log('OK');
