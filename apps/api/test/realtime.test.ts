/* WebSocket: события воркспейса приходят после коммита, чужие воркспейсы изолированы, пропущенное догоняется по ?since. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { websocket } from '../src/app';
import { Client, app, hub } from './helpers';

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(async () => {
  await hub.start();
  server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
  base = `ws://localhost:${server.port}`;
});
afterAll(async () => {
  server.stop(true);
  await hub.stop();
});

/** Открывает сокет и собирает сообщения */
function connect(url: string, cookie: string) {
  const messages: any[] = [];
  const ws = new WebSocket(url, { headers: { cookie } } as never);
  const waiters: (() => void)[] = [];
  ws.onmessage = e => {
    messages.push(JSON.parse(String(e.data)));
    waiters.splice(0).forEach(w => w());
  };
  const opened = new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error('ws error'));
    ws.onclose = e => rej(new Error(`closed ${e.code}`));
  });
  const until = async (pred: (m: any[]) => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (!pred(messages)) {
      if (Date.now() - t0 > ms) throw new Error(`timeout; got ${JSON.stringify(messages)}`);
      await new Promise<void>(r => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  };
  return { ws, messages, opened, until };
}

describe('websocket /ws', () => {
  test('events of own workspace arrive after commit; other workspaces get nothing', async () => {
    const a = new Client();
    await a.signup();
    const b = new Client();
    await b.signup();
    const sa = connect(`${base}/ws?workspace=${a.workspaceId}`, a.cookie);
    const sb = connect(`${base}/ws?workspace=${b.workspaceId}`, b.cookie);
    await Promise.all([sa.opened, sb.opened]);
    await sa.until(m => m.some(x => x.type === 'ready'));
    await sb.until(m => m.some(x => x.type === 'ready'));

    const p = await a.project('RTA');
    const t = await a.task(p.id, 'Realtime task');
    await sa.until(m => m.some(x => x.type === 'event' && x.event.type === 'task.created' && x.event.recordId === t.id));
    const ev = sa.messages.find(x => x.type === 'event' && x.event.type === 'task.created')!.event;
    expect(ev).toMatchObject({ workspaceId: a.workspaceId, entity: 'task', recordId: t.id });
    expect(ev.id).toBeString();
    expect(ev.payload).toBeUndefined(); // конверт без payload

    // изменение другого арендатора
    const pb = await b.project('RTB');
    await b.task(pb.id, 'B task');
    await sb.until(m => m.some(x => x.type === 'event' && x.event.type === 'task.created'));
    await new Promise(r => setTimeout(r, 150));
    expect(sa.messages.filter(x => x.type === 'event').every(x => x.event.workspaceId === a.workspaceId)).toBe(true);
    expect(sb.messages.filter(x => x.type === 'event').every(x => x.event.workspaceId === b.workspaceId)).toBe(true);
    sa.ws.close();
    sb.ws.close();
  });

  test('a rolled back request produces no event', async () => {
    const a = new Client();
    await a.signup();
    const p = await a.project('RBK');
    const s = connect(`${base}/ws?workspace=${a.workspaceId}`, a.cookie);
    await s.opened;
    await s.until(m => m.some(x => x.type === 'ready'));
    expect((await a.post('/tasks', { projectId: p.id, title: 'x', status: 'nope' })).status).toBe(422);
    await new Promise(r => setTimeout(r, 200));
    expect(s.messages.filter(x => x.type === 'event')).toHaveLength(0);
    s.ws.close();
  });

  test('rejects unauthenticated and foreign-workspace connections', async () => {
    const a = new Client();
    await a.signup();
    const b = new Client();
    await b.signup();
    const noAuth = await fetch(`http://localhost:${server.port}/ws?workspace=${a.workspaceId}`, { headers: { upgrade: 'websocket', connection: 'upgrade', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } });
    expect(noAuth.status).toBe(401);
    const foreign = await fetch(`http://localhost:${server.port}/ws?workspace=${a.workspaceId}`, { headers: { cookie: b.cookie, upgrade: 'websocket', connection: 'upgrade', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } });
    expect(foreign.status).toBe(403);
    const missing = await fetch(`http://localhost:${server.port}/ws`, { headers: { cookie: a.cookie } });
    expect(missing.status).toBe(400);
  });

  test('?since replays missed events', async () => {
    const a = new Client();
    await a.signup();
    const p = await a.project('RPL');
    const t1 = await a.task(p.id, 'one');
    const events = (await a.get('/events?limit=200')).body.items;
    const since = events.find((e: any) => e.recordId === t1.id).id;
    const t2 = await a.task(p.id, 'two'); // пока «клиент отключён»
    const s = connect(`${base}/ws?workspace=${a.workspaceId}&since=${since}`, a.cookie);
    await s.opened;
    await s.until(m => m.some(x => x.replay && x.event.recordId === t2.id));
    expect(s.messages.filter(x => x.replay).every(x => x.event.id > since)).toBe(true);
    s.ws.close();
  });
});
