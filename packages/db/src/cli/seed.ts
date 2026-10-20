import { createSql, databaseUrl } from '..';
import { runSeed } from '../seed';

const sql = createSql(databaseUrl(), { max: 4 });
try {
  await runSeed(sql);
} finally {
  await sql.end();
}
