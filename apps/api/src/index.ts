/* Точка входа API: Bun.serve + WebSocket + слушатель событий. */
import { createSql, databaseUrl, listenChannel } from '@erp/db';
import { createApp, websocket } from './app';
import { apiSqlOptions, loadConfig } from './env';
import { SESSION_REVOKED_CHANNEL } from './session-cache';
import { ACCESS_CHANGED_CHANNEL } from './access-cache';

const config = loadConfig();
const sql = createSql(databaseUrl(), apiSqlOptions(config));
const { app, hub, sessionCache, accessCache, numberingSql } = createApp({ sql, config });
await hub.start();
// Закрытые на других экземплярах API сессии сбрасываются и из кэша этого процесса
const stopRevokeListener = await listenChannel(databaseUrl(), SESSION_REVOKED_CHANNEL, payload => {
  const revoke = sessionCache.onNotify(payload);
  if (revoke && ('sessionIds' in revoke || revoke.closeSockets)) hub.revokeSessions(revoke);
});
// Доступ к воркспейсу поменялся (триггеры миграции 0125): сбрасываем кэш членства, лицензии и разделов
const stopAccessListener = await listenChannel(databaseUrl(), ACCESS_CHANGED_CHANNEL, ws => accessCache.invalidate(ws));

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
  await stopAccessListener();
  await sql.end({ timeout: 5 });
  await numberingSql.end({ timeout: 2 });
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
