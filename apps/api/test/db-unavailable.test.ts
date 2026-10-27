/* Недоступная зависимость внутри транзакции арендатора: запрос не висит, транзакция откатывается, пул остаётся рабочим.
   Регрессия 2026-10-23: соединения gr8r_app подолгу стояли `idle in transaction` после запроса членства в tenant(),
   пул (max 10) исчерпался, /health и вход висели. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createSql, members, type Sql } from '@gr8r/db';
import { createApp } from '../src/app';
import { apiSqlOptions, loadConfig } from '../src/env';
import { onError } from '../src/errors';
import { requireSession, tenant } from '../src/middleware';
import type { AppConfig, AppEnv } from '../src/types';
import { Client, admin, testConfig } from './helpers';

const APP_NAME = 'tx-hang-test';
const config: AppConfig = { ...loadConfig(), ...testConfig({ txTimeoutMs: 500 }) };

/* «Чёрная дыра»: принимает TCP и никогда не отвечает — как админская база, до которой не дойти (сеть, фаервол) */
const blackhole = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
const deadAdmin = createSql(`postgres://postgres:wrong@127.0.0.1:${blackhole.port}/gr8r`, { max: 1 });
// Пул API из одного соединения: любое зависшее соединение сразу видно. Опции — как у настоящего API;
// серверные таймауты (2 × 2 с) длиннее, чем тест держит транзакцию, иначе Postgres оборвёт её раньше
const opts = apiSqlOptions({ txTimeoutMs: 2000 });
const pool: Sql = createSql(process.env.DATABASE_URL!, { ...opts, max: 1, connection: { ...opts.connection, application_name: APP_NAME } });
const { app: fullApp } = createApp({ sql: pool, config });

let gate: () => void = () => {};
let zombieError: unknown = null;

/* Та же цепочка, что у ресурсов арендатора: sql/config в контексте → сессия → tenant() */
const probe = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.set('sql', pool);
    c.set('config', config);
    c.set('requestId', 'test');
    await next();
  })
  .use('*', requireSession, tenant())
  .get('/admin', async c => {
    // Обработчик внутри транзакции ждёт второе подключение, которое никогда не ответит
    await deadAdmin`select 1`;
    return c.json({ ok: true });
  })
  .get('/zombie', async c => {
    const db = c.get('db');
    // Ждём, пока тест разрешит продолжить (уже после ответа 503), затем пытаемся читать в закрытой транзакции
    await new Promise<void>(r => (gate = r));
    try {
      await db.select({ id: members.id }).from(members).limit(1);
    } catch (e) {
      zombieError = (e as { cause?: unknown }).cause ?? e;
    }
    return c.json({ ok: true });
  })
  .get('/ok', async c => {
    const rows = await c.get('db').select({ id: members.id }).from(members).limit(1);
    return c.json({ n: rows.length });
  })
  .onError(onError);

let user: Client;
const asProbe = () => Object.assign(new Client(probe), { cookie: user.cookie, workspaceId: user.workspaceId });
const hangingSessions = () => admin`select state from pg_stat_activity where application_name = ${APP_NAME} and state like 'idle in transaction%'`;

beforeAll(async () => {
  user = new Client();
  await user.signup();
});

afterAll(async () => {
  gate();
  await pool.end({ timeout: 1 });
  await deadAdmin.end({ timeout: 0 });
  blackhole.stop(true);
});

describe('database unavailable inside a tenant transaction', () => {
  test('a hanging dependency yields 503 quickly and the transaction is rolled back', async () => {
    const t0 = performance.now();
    const res = await asProbe().get('/admin');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('db_unavailable');
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(await hangingSessions()).toHaveLength(0);

    // Единственное соединение пула свободно: обычный запрос арендатора и /health проходят
    expect((await asProbe().get('/ok')).status).toBe(200);
    expect((await fullApp.request('/health')).status).toBe(200);
  }, 10_000);

  test('a handler resumed after the deadline cannot run queries on the released connection', async () => {
    const res = await asProbe().get('/zombie');
    expect(res.status).toBe(503);
    gate();
    for (let i = 0; i < 50 && !zombieError; i++) await Bun.sleep(10);
    expect(String(zombieError)).toContain('transaction is closed');
    expect((await asProbe().get('/ok')).status).toBe(200);
  }, 10_000);

  test('/health answers 503 instead of waiting when the pool is exhausted', async () => {
    let release: () => void = () => {};
    const held = pool.begin(() => new Promise<void>(r => (release = r)));
    try {
      const t0 = performance.now();
      const res = await fullApp.request('/health');
      expect(res.status).toBe(503);
      expect(performance.now() - t0).toBeLessThan(3000);
    } finally {
      release();
      await held;
    }
    expect((await fullApp.request('/health')).status).toBe(200);
  }, 10_000);

  test('API sessions carry server-side timeouts as a safety net', async () => {
    const [row] = await pool`select current_setting('idle_in_transaction_session_timeout') as idle, current_setting('statement_timeout') as stmt`;
    expect(row).toEqual({ idle: '4s', stmt: '4s' });
  });
});
