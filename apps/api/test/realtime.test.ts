/* WebSocket: события воркспейса приходят после коммита, чужие воркспейсы изолированы, пропущенное догоняется по ?since. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { recordEvent, recordEvents, withContext, type EventEnvelope } from '@gr8r/db';
import { websocket } from '../src/app';
import { Hub, coalesceEvents } from '../src/realtime';
import { Client, admin, app, hub } from './helpers';

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

  test('тихая запись (recordEvents notify: false) — в журнале есть, по сокету не приходит; обычное событие приходит', async () => {
    const a = new Client();
    await a.signup();
    const s = connect(`${base}/ws?workspace=${a.workspaceId}`, a.cookie);
    await s.opened;
    await s.until(m => m.some(x => x.type === 'ready'));
    const ctx = { workspaceId: a.workspaceId! };
    await withContext(admin, ctx, db => recordEvents(db, Array.from({ length: 50 }, () => ({ workspaceId: a.workspaceId!, type: 'product.created', entity: 'product' })), { notify: false }));
    await withContext(admin, ctx, db => recordEvent(db, { workspaceId: a.workspaceId!, type: 'supplier_price_line.updated', entity: 'supplier_price_line' }));
    await s.until(m => m.some(x => x.type === 'event' && x.event.type === 'supplier_price_line.updated'));
    await new Promise(r => setTimeout(r, 250));
    expect(s.messages.filter(x => x.type === 'event' && x.event.type === 'product.created')).toHaveLength(0);
    const [n] = await admin`select count(*)::int as n from events where workspace_id = ${a.workspaceId} and type = 'product.created'`;
    expect(n!.n).toBe(50);
    s.ws.close();
  });
});

describe('Hub: сжатие пачек событий', () => {
  const ev = (i: number, entity = 'product', type = 'product.created'): EventEnvelope => ({ id: `01a1d000-0000-7000-8000-${String(i).padStart(12, '0')}`, workspaceId: 'w1', type, entity, recordId: `r${i}`, actorId: null, createdAt: '' });
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  test('первое событие уходит сразу, поток в окне — одним сообщением на пару «сущность + тип»', async () => {
    const h = new Hub('unused', 30);
    const got: any[] = [];
    h.join('w1', { send: m => got.push(JSON.parse(m)) });
    h.dispatch(ev(0));
    expect(got).toHaveLength(1);
    expect(got[0].coalesced).toBeUndefined();
    for (let i = 1; i <= 1000; i++) h.dispatch(ev(i));
    h.dispatch(ev(1001, 'supplier_price_line', 'supplier_price_line.updated'));
    expect(got).toHaveLength(1);
    await sleep(45);
    expect(got).toHaveLength(3);
    expect(got[1]).toMatchObject({ type: 'event', coalesced: 1000, event: { id: ev(1000).id, entity: 'product' } });
    expect(got[2]).toMatchObject({ event: { entity: 'supplier_price_line' } });
    expect(got[2].coalesced).toBeUndefined();
    // окно закрылось без новых событий — следующее снова уходит сразу
    await sleep(45);
    h.dispatch(ev(2000));
    expect(got).toHaveLength(4);
    await h.stop();
  });

  test('без подключённых сокетов воркспейса события не копятся', () => {
    const h = new Hub('unused', 30);
    for (let i = 0; i < 100; i++) h.dispatch(ev(i));
    expect((h as any).windows.size).toBe(0);
  });

  test('coalesceEvents сохраняет порядок по id и последнее событие пары', () => {
    const r = coalesceEvents([ev(3), ev(1, 'task', 'task.updated'), ev(5), ev(2, 'task', 'task.updated')]);
    expect(r.map(c => [c.event.id, c.count])).toEqual([
      [ev(2).id, 2],
      [ev(5).id, 2],
    ]);
  });
});
