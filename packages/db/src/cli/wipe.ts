import { adminDatabaseUrl, ensureDatabase, wipeDatabase } from '..';

if (process.env.NODE_ENV === 'production') throw new Error('db:wipe is disabled in production');
const url = adminDatabaseUrl();
await ensureDatabase(url);
await wipeDatabase(url);
console.log(`[db] wiped: ${new URL(url).pathname.slice(1)}`);
