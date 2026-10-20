/* db:reset — с нуля: сброс схем → миграции → сид */
import { adminDatabaseUrl, createSql, databaseUrl, ensureDatabase, migrateAll, wipeDatabase } from '..';
import { runSeed } from '../seed';

if (process.env.NODE_ENV === 'production') throw new Error('db:reset is disabled in production');
const admin = adminDatabaseUrl();
await ensureDatabase(admin);
await wipeDatabase(admin);
await migrateAll(admin);
const sql = createSql(databaseUrl(), { max: 4 });
try {
  await runSeed(sql);
} finally {
  await sql.end();
}
console.log('[db] reset complete');
