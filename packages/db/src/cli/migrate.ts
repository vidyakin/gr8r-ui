import { adminDatabaseUrl, migrateAll } from '..';

const url = adminDatabaseUrl();
await migrateAll(url);
console.log(`[db] migrations applied: ${new URL(url).pathname.slice(1)}`);
