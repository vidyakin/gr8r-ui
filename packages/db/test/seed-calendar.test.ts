/* Демо-данные платёжного календаря (1174г): сид проходит целиком, заявки лежат в разных состояниях, оплаченная заявка закрыта. */
import { expect, test } from 'bun:test';
import { createSql } from '../src';
import { runSeed } from '../src/seed';

test('сид создаёт заявки на расход в разных состояниях', async () => {
  const sql = createSql(process.env.ADMIN_DATABASE_URL!, { max: 2 });
  try {
    await runSeed(sql, () => {});
    const rows = await sql<{ state: string | null; comment: string }[]>`select state, comment from documents where type = 'payment_request' order by created_at`;
    expect(rows.map(r => r.state)).toEqual(['approved', 'pending', 'rejected', 'paid']);
  } finally {
    await sql.end();
  }
}, 120_000);
