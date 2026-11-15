/* Публичное демо с ежедневным сбросом: создание, идемпотентность в пределах суток, пересоздание после момента сброса
   (чужие данные пропадают, пароль возвращается), расчёт момента сброса по часовому поясу. */
import { describe, expect, test } from 'bun:test';
import { deleteTenant, lastDemoResetAt, resetDemoOnce, type DemoResetConfig } from '@erp/db';
import { createApp } from '../src/app';
import { admin, Client, ddl, sql, uniq } from './helpers';

describe('lastDemoResetAt', () => {
  test('03:00 Europe/Moscow = 00:00 UTC; до этого часа — вчерашний', () => {
    expect(lastDemoResetAt(new Date('2026-11-16T10:00:00Z'), 3, 'Europe/Moscow').toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(lastDemoResetAt(new Date('2026-11-15T23:30:00Z'), 3, 'Europe/Moscow').toISOString()).toBe('2026-11-15T00:00:00.000Z');
  });
  test('летнее время: 03:00 Europe/Berlin летом = 01:00 UTC, зимой = 02:00 UTC', () => {
    expect(lastDemoResetAt(new Date('2026-07-01T12:00:00Z'), 3, 'Europe/Berlin').toISOString()).toBe('2026-07-01T01:00:00.000Z');
    expect(lastDemoResetAt(new Date('2026-01-10T12:00:00Z'), 3, 'Europe/Berlin').toISOString()).toBe('2026-01-10T02:00:00.000Z');
  });
});

describe('общий демо-вход', () => {
  test('нельзя сменить пароль и закрыть сессии; обычному пользователю можно', async () => {
    const probe = new Client();
    const { user } = await probe.signup({ password: 'password123' });
    const demoApp = createApp({ sql, config: { logRequests: false, demoEmail: user.email.toLowerCase() } }).app;
    const demo = new Client(demoApp);
    await demo.post('/auth/signin', { email: user.email, password: 'password123' });
    const pw = await demo.post('/auth/password', { current: 'password123', next: 'new-password-1' });
    expect(pw.status).toBe(403);
    expect(pw.body.error.code).toBe('demo_account_locked');
    expect((await demo.req('DELETE', '/auth/sessions')).status).toBe(403);
    expect((await demo.get('/auth/me')).status).toBe(200); // остальное работает

    const regular = new Client(demoApp);
    await regular.signup({ password: 'password123' });
    expect((await regular.post('/auth/password', { current: 'password123', next: 'new-password-1' })).status).toBe(200);
  });
});

describe('resetDemoOnce', () => {
  const cfg: DemoResetConfig = { slug: `demo-${uniq()}`, name: 'Публичное демо', email: `pub-${uniq()}@demo.test`, password: 'demo-pass-1', hour: 3, timeZone: 'Europe/Moscow' };
  const wsOf = async () => (await admin`select id, created_at from workspaces where slug = ${cfg.slug}`)[0];

  test('создаёт, не трогает до следующего сброса, затем пересоздаёт с исходным паролем и без чужих данных', async () => {
    expect(await resetDemoOnce(sql, ddl, cfg)).toBe('created');
    const first = await wsOf();
    expect(first).toBeTruthy();
    expect(await resetDemoOnce(sql, ddl, cfg)).toBeNull(); // в те же сутки — ничего

    // посетитель «испортил» демо: переименовал воркспейс и сменил пароль
    await admin`update workspaces set name = 'Испорчено' where id = ${first!.id}`;
    await admin`update users set password_hash = 'x' where lower(email) = ${cfg.email}`;

    const tomorrow = new Date(Date.now() + 864e5 + 3600e3);
    expect(await resetDemoOnce(sql, ddl, cfg, tomorrow)).toBe('reset');
    const second = await wsOf();
    expect(second!.id).not.toBe(first!.id);
    expect((await admin`select name from workspaces where id = ${second!.id}`)[0]!.name).toBe('Публичное демо');
    const [u] = await admin`select password_hash from users where lower(email) = ${cfg.email}`;
    expect(await Bun.password.verify(cfg.password, u!.password_hash)).toBe(true);
    expect((await admin`select count(*)::int as n from tasks where workspace_id = ${second!.id}`)[0]!.n).toBeGreaterThan(0); // демо-данные на месте

    expect(await resetDemoOnce(sql, ddl, cfg, new Date(), true)).toBe('reset'); // --force
    await deleteTenant(sql, ddl, (await wsOf())!.id); // демо-данные с датами «от сегодня» мешают воркерам в других файлах
  }, 120_000);
});
