/* Пачка параллельных запросов к корневым путям арендатора не исчерпывает пул.
   Регрессия 2026-11-13: `/projects` совпадал и с use('/projects'), и с use('/projects/*') — цепочка сессия → tenant()
   шла дважды, вложенная транзакция ждала второе соединение, держа первое. При перезагрузке страницы (~20 запросов)
   все соединения стояли `idle in transaction` после запроса members до дедлайна (30 с), браузер получал 503. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSql, type Sql } from '@gr8r/db';
import { createApp } from '../src/app';
import { apiSqlOptions, loadConfig } from '../src/env';
import type { AppConfig } from '../src/types';
import { Client, hub, testConfig } from './helpers';

const TX_TIMEOUT_MS = 3000;
const config: AppConfig = { ...loadConfig(), ...testConfig({ txTimeoutMs: TX_TIMEOUT_MS }) };
// Маленький пул: при двойной транзакции на запрос взаимная блокировка наступает уже с трёх параллельных запросов
const opts = apiSqlOptions(config);
const pool: Sql = createSql(process.env.DATABASE_URL!, { ...opts, max: 3 });
const { app } = createApp({ sql: pool, config, hub });

let user: Client;

beforeAll(async () => {
  user = new Client();
  await user.signup();
  await user.project('BRST');
});

afterAll(async () => {
  await pool.end({ timeout: 1 });
});

describe('burst of parallel tenant requests', () => {
  test('30 parallel requests to root tenant paths complete without exhausting the pool', async () => {
    const paths = ['/projects', '/statuses', '/tasks', '/members', '/teams', '/saved-views'];
    const client = Object.assign(new Client(app), { cookie: user.cookie, workspaceId: user.workspaceId });
    const t0 = performance.now();
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => client.get(paths[i % paths.length]!)));
    const ms = performance.now() - t0;
    expect(res.map(r => r.status)).toEqual(res.map(() => 200));
    expect(ms).toBeLessThan(TX_TIMEOUT_MS);
  });
});
