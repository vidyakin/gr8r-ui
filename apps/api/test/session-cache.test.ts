/* Кэш сессий в памяти API (src/session-cache.ts): попадание, сброс при выходе и правке профиля, рассылка другим экземплярам. */
import { afterAll, describe, expect, test } from 'bun:test';
import { databaseUrl, listenChannel } from '@erp/db';
import { createApp } from '../src/app';
import { SESSION_REVOKED_CHANNEL, SessionCache } from '../src/session-cache';
import { Client, admin, hub, sql, testConfig } from './helpers';

const user = (id: string) => ({ id, email: `${id}@t.dev`, name: id, locale: null, prefs: {}, isOperator: false });
const far = new Date(Date.now() + 86_400_000);

describe('SessionCache', () => {
  test('entry lives ttl and not longer than the session', async () => {
    const c = new SessionCache(50);
    c.set('a', user('u1'), far);
    c.set('b', user('u1'), new Date(Date.now() + 10));
    expect(c.get('a')?.id).toBe('u1');
    await Bun.sleep(20);
    expect(c.get('b')).toBeNull();
    await Bun.sleep(40);
    expect(c.get('a')).toBeNull();
  });

  test('evicts the oldest entry when full; revokes by session and by user', () => {
    const c = new SessionCache(60_000, 2);
    c.set('a', user('u1'), far);
    c.set('b', user('u2'), far);
    c.set('c', user('u1'), far);
    expect(c.get('a')).toBeNull();
    expect(c.size).toBe(2);
    c.revoke({ userId: 'u1' });
    expect(c.get('c')).toBeNull();
    c.revoke({ sessionIds: ['b'] });
    expect(c.size).toBe(0);
  });

  test('ttl 0 disables the cache', () => {
    const c = new SessionCache(0);
    c.set('a', user('u1'), far);
    expect(c.get('a')).toBeNull();
  });
});

describe('session cache in the API', () => {
  const stops: (() => Promise<void>)[] = [];
  afterAll(async () => {
    for (const s of stops) await s();
  });

  test('a cached session skips the database lookup until revoked', async () => {
    const { app, sessionCache } = createApp({ sql, hub, config: testConfig({}) });
    const c = new Client(app);
    const { user: u } = await c.signup();
    expect((await c.get('/auth/me')).status).toBe(200);
    // удаление мимо API кэш не видит до конца ttl — это и есть попадание в кэш
    await admin.unsafe(`delete from sessions where user_id = '${u.id}'`);
    expect((await c.get('/auth/me')).status).toBe(200);
    sessionCache.revoke({ userId: u.id });
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  test('profile change is visible at once', async () => {
    const c = new Client();
    await c.signup();
    expect((await c.get('/auth/me')).body.user.locale).toBeNull();
    await c.patch('/auth/me', { locale: 'ru' });
    expect((await c.get('/auth/me')).body.user.locale).toBe('ru');
  });

  test('sign-out on one API instance revokes the cached session on another', async () => {
    const a = createApp({ sql, hub, config: testConfig({}) });
    const b = createApp({ sql, hub, config: testConfig({}) });
    stops.push(await listenChannel(databaseUrl(), SESSION_REVOKED_CHANNEL, p => b.sessionCache.onNotify(p)));
    const onA = new Client(a.app);
    await onA.signup();
    const onB = Object.assign(new Client(b.app), { cookie: onA.cookie });
    expect((await onB.get('/auth/me')).status).toBe(200);
    expect((await onA.post('/auth/signout', {})).status).toBe(200);
    const t0 = performance.now();
    while (b.sessionCache.size && performance.now() - t0 < 3000) await Bun.sleep(20);
    expect((await onB.get('/auth/me')).status).toBe(401);
  });
});
