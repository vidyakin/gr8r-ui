import { describe, expect, test } from 'bun:test';
import { createApp } from '../src/app';
import { Client, admin, app, sql, testConfig, uniq } from './helpers';

describe('auth', () => {
  test('signup creates a user, a session cookie (httpOnly, SameSite=Lax) and a workspace with owner role', async () => {
    const c = new Client();
    const email = `a-${uniq()}@test.dev`;
    const res = await c.post('/auth/signup', { email, password: 'password123', name: 'Alice', workspaceName: 'Alice WS' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email);
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0].role).toBe('owner');
    expect(JSON.stringify(res.body)).not.toContain('password');
    const setCookie = res.headers.getSetCookie()[0]!;
    expect(setCookie).toContain('gr8r_session=');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect((await c.get('/auth/me')).body.user.email).toBe(email);
  });

  test('password is stored as Argon2id and the session token is stored only as a hash', async () => {
    const c = new Client();
    const { user } = await c.signup();
    const [row] = await admin.unsafe(`select password_hash from users where id = '${user.id}'`);
    expect(row!.password_hash).toStartWith('$argon2id$');
    const token = c.cookie.split('=')[1]!;
    const sessions = await admin.unsafe(`select id from sessions where user_id = '${user.id}'`);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).not.toBe(token);
    expect(sessions[0]!.id).toHaveLength(64);
  });

  test('duplicate email -> 409, weak password and bad email -> 400 with the unified error format', async () => {
    const c = new Client();
    const { user } = await c.signup();
    const dup = await new Client().post('/auth/signup', { email: user.email.toUpperCase(), password: 'password123', name: 'Dup' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('email_taken');
    const weak = await new Client().post('/auth/signup', { email: `w-${uniq()}@test.dev`, password: 'short', name: 'W' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('validation_error');
    expect(weak.body.error.requestId).toBeString();
    const bad = await new Client().post('/auth/signup', { email: 'not-an-email', password: 'password123', name: 'B' });
    expect(bad.status).toBe(400);
  });

  test('signin: success, wrong password and unknown email give the same 401', async () => {
    const email = `s-${uniq()}@test.dev`;
    await new Client().signup({ email, password: 'correct-horse' });
    const ok = new Client();
    const good = await ok.post('/auth/signin', { email, password: 'correct-horse' });
    expect(good.status).toBe(200);
    expect(good.body.workspaces).toHaveLength(1);
    expect((await ok.get('/auth/me')).status).toBe(200);

    const wrong = await new Client().post('/auth/signin', { email, password: 'wrong-password' });
    const unknown = await new Client().post('/auth/signin', { email: `nobody-${uniq()}@test.dev`, password: 'whatever123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('invalid_credentials');
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  test('signout destroys the session', async () => {
    const c = new Client();
    await c.signup();
    const stale = c.cookie;
    expect((await c.post('/auth/signout')).status).toBe(200);
    // старая cookie больше не работает
    const again = new Client();
    again.cookie = stale;
    expect((await again.get('/auth/me')).status).toBe(401);
  });

  test('requests without a session or with a garbage / expired session are rejected', async () => {
    expect((await new Client().get('/auth/me')).status).toBe(401);
    const c = new Client();
    c.cookie = 'gr8r_session=garbage';
    expect((await c.get('/auth/me')).status).toBe(401);

    const real = new Client();
    const { user } = await real.signup();
    await admin.unsafe(`update sessions set expires_at = now() - interval '1 minute' where user_id = '${user.id}'`);
    expect((await real.get('/auth/me')).status).toBe(401);
  });

  test('tenant routes require authentication', async () => {
    const res = await new Client().get('/projects', '01a157ac-676a-718a-ad30-b3da57581683');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  test('sign-in is rate limited per email and per IP', async () => {
    const { app: limited } = createApp({ sql, config: testConfig({ authRateLimitMax: 3, trustProxy: true }) });
    const email = `rl-${uniq()}@test.dev`;
    await new Client().signup({ email, password: 'password123' });
    const c = new Client(limited, { 'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await c.post('/auth/signin', { email, password: 'bad-password' })).status);
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3)).toEqual([429, 429]);
    // даже верный пароль не пускает, пока окно не истекло
    const blocked = await c.post('/auth/signin', { email, password: 'password123' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    // другой IP, но тот же email: лимит по email тоже держит
    const other = new Client(limited, { 'x-forwarded-for': '10.9.9.9' });
    expect((await other.post('/auth/signin', { email, password: 'password123' })).status).toBe(429);
  });

  test('a successful sign-in resets the per-email counter', async () => {
    const { app: limited } = createApp({ sql, config: testConfig({ authRateLimitMax: 3, trustProxy: true }) });
    const email = `rc-${uniq()}@test.dev`;
    await new Client().signup({ email, password: 'password123' });
    const c = new Client(limited, { 'x-forwarded-for': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
    await c.post('/auth/signin', { email, password: 'bad-password' });
    await c.post('/auth/signin', { email, password: 'bad-password' });
    expect((await admin.unsafe(`select hits from rate_limits where key = 'signin:email:${email}'`))[0]!.hits).toBe(2);
    expect((await c.post('/auth/signin', { email, password: 'password123' })).status).toBe(200);
    expect(await admin.unsafe(`select hits from rate_limits where key = 'signin:email:${email}'`)).toHaveLength(0);
  });

  test('unknown routes return a JSON 404', async () => {
    const res = await app.request('/no/such/route');
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe('not_found');
  });

  test('interface language: personal (users.locale) and workspace default (settings.locale)', async () => {
    const c = new Client();
    const { user, workspaces } = await c.signup();
    expect((await c.get('/auth/me')).body.user.locale).toBeNull();
    expect(workspaces[0]).toMatchObject({ locale: null });

    const me = await c.patch('/auth/me', { locale: 'ru' });
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: user.id, locale: 'ru' });
    expect((await c.get('/auth/me')).body.user.locale).toBe('ru');
    expect((await c.patch('/auth/me', { locale: 'de' })).body.error.code).toBe('validation_error');
    expect((await c.patch('/auth/me', { locale: null })).body.user.locale).toBeNull();

    const wsId = workspaces[0]!.id;
    expect((await c.patch(`/workspaces/${wsId}`, { locale: 'ru' }, wsId)).status).toBe(200);
    expect((await c.get('/auth/me')).body.workspaces[0].locale).toBe('ru');
    // смена названия не трогает язык, null снимает его
    await c.patch(`/workspaces/${wsId}`, { name: 'Renamed' }, wsId);
    expect((await c.get('/auth/me')).body.workspaces[0]).toMatchObject({ name: 'Renamed', locale: 'ru' });
    await c.patch(`/workspaces/${wsId}`, { locale: null }, wsId);
    expect((await c.get('/auth/me')).body.workspaces[0].locale).toBeNull();
  });
});
