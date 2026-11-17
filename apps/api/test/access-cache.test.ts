/* Кэш доступа к воркспейсу (src/access-cache.ts): членство, роль и лицензия кэшируются, но любая правка доступа действует сразу —
   на своём экземпляре по метке транзакции, на других по NOTIFY erp_access_changed из триггеров миграции 0125. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { databaseUrl, listenChannel } from '@erp/db';
import { createApp } from '../src/app';
import { ACCESS_CHANGED_CHANNEL, AccessCache } from '../src/access-cache';
import { Client, addMember, admin, hub, sql, testConfig } from './helpers';

let owner: Client;
const stops: (() => Promise<void>)[] = [];

const memberIdOf = async (c: Client) => {
  const res = await owner.get('/members?limit=200');
  return (res.body.items as { id: string; email: string }[]).find(m => m.email === c.user!.email)!.id;
};
const waitFor = async (cond: () => boolean) => {
  const t0 = performance.now();
  while (!cond() && performance.now() - t0 < 3000) await Bun.sleep(20);
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup();
});
afterAll(async () => {
  for (const s of stops) await s();
});

describe('AccessCache', () => {
  test('entries expire, invalidate drops one workspace or all, ttl 0 disables', async () => {
    const c = new AccessCache(40);
    c.setMembership('w1', 'u1', { role: 'member', memberId: 'm1', status: 'active' });
    c.setMembership('w2', 'u1', { role: 'admin', memberId: 'm2', status: 'active' });
    c.setLicense('w1', null);
    expect(c.membership('w1', 'u1')?.role).toBe('member');
    expect(c.license('w1')).toBeNull();
    expect(c.license('w2')).toBeUndefined();
    c.invalidate('W1');
    expect(c.membership('w1', 'u1')).toBeNull();
    expect(c.membership('w2', 'u1')?.role).toBe('admin');
    c.invalidate('*');
    expect(c.size).toBe(0);
    c.setSections('w3', 'm3', 'member', ['crm']);
    await Bun.sleep(50);
    expect(c.sections('w3', 'm3', 'member')).toBeNull();
    const off = new AccessCache(0);
    off.setMembership('w1', 'u1', { role: 'member', memberId: 'm1', status: 'active' });
    expect(off.membership('w1', 'u1')).toBeNull();
  });
});

describe('access cache in the API', () => {
  test('membership is served from the cache after the first request', async () => {
    const { app, accessCache } = createApp({ sql, hub, config: testConfig({}) });
    const c = Object.assign(new Client(app), { cookie: owner.cookie, workspaceId: owner.workspaceId });
    expect((await c.get('/projects')).status).toBe(200);
    expect(accessCache.membership(owner.workspaceId!, owner.user!.id)?.role).toBe('owner');
  });

  test('role change and deactivation through the API take effect on the next request', async () => {
    const m = await addMember(owner, 'member');
    expect((await m.post('/projects', { name: 'До понижения', key: 'ACA' })).status).toBe(201);
    const id = await memberIdOf(m);
    expect((await owner.patch(`/workspaces/${owner.workspaceId}/members/${id}`, { role: 'guest' })).status).toBe(200);
    expect((await m.post('/projects', { name: 'После понижения', key: 'ACB' })).status).toBe(403);
    expect((await owner.patch(`/members/${id}`, { status: 'deactivated' })).status).toBe(200);
    const res = await m.get('/projects');
    expect(res.status).toBe(403);
  });

  test('a change made elsewhere (worker, CLI, another API instance) reaches the cache through NOTIFY', async () => {
    const { app, accessCache } = createApp({ sql, hub, config: testConfig({}) });
    stops.push(await listenChannel(databaseUrl(), ACCESS_CHANGED_CHANNEL, ws => accessCache.invalidate(ws)));
    const m = await addMember(owner, 'member');
    const onB = Object.assign(new Client(app), { cookie: m.cookie, workspaceId: owner.workspaceId });
    expect((await onB.get('/projects')).status).toBe(200);
    expect(accessCache.membership(owner.workspaceId!, m.user!.id)).not.toBeNull();
    // удаление членства мимо API — как сделали бы воркер или CLI арендаторов
    await admin`delete from memberships where workspace_id = ${owner.workspaceId} and user_id = ${m.user!.id}`;
    await waitFor(() => accessCache.membership(owner.workspaceId!, m.user!.id) === null);
    expect((await onB.get('/projects')).status).toBe(403);
  });
});
