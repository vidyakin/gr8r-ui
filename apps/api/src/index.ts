/* Точка входа API: Bun.serve + WebSocket + слушатель событий. */
import { createSql, databaseUrl, listenChannel } from '@erp/db';
import { createApp, websocket } from './app';
import { apiSqlOptions, loadConfig } from './env';
import { SESSION_REVOKED_CHANNEL } from './session-cache';

const config = loadConfig();
const sql = createSql(databaseUrl(), apiSqlOptions(config));
const { app, hub, sessionCache } = createApp({ sql, config });
await hub.start();
// Закрытые на других экземплярах API сессии сбрасываются и из кэша этого процесса
const stopRevokeListener = await listenChannel(databaseUrl(), SESSION_REVOKED_CHANNEL, p => sessionCache.onNotify(p));

const server = Bun.serve({ port: config.port, fetch: app.fetch, websocket, idleTimeout: 60 });
console.log(`[api] listening on http://localhost:${server.port} (${config.production ? "production" : "development"}, db pool ${config.dbPoolMax})`);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[api] ${signal}: shutting down`);
  server.stop();
  await hub.stop();
  await stopRevokeListener();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
