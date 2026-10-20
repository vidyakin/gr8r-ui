/* Точка входа API: Bun.serve + WebSocket + слушатель событий. */
import { createSql, databaseUrl } from '@gr8r/db';
import { createApp, websocket } from './app';
import { loadConfig } from './env';

const config = loadConfig();
const sql = createSql(databaseUrl());
const { app, hub } = createApp({ sql, config });
await hub.start();

const server = Bun.serve({ port: config.port, fetch: app.fetch, websocket, idleTimeout: 60 });
console.log(`[api] listening on http://localhost:${server.port} (${config.production ? 'production' : 'development'})`);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[api] ${signal}: shutting down`);
  server.stop();
  await hub.stop();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
