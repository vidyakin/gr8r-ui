/* Нумерация документов отдельной транзакцией (packages/db/src/numbering.ts): в запросе API номер коммитится сразу —
   откат проведения оставляет пропуск; вне режима (воркер) откат возвращает счётчик; занятая строка счётчика даёт 503, а не зависание. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { assignDocumentNumber, createSql, databaseUrl, withContext, withSeparateNumbering, type Sql } from '@erp/db';
import { Client, admin, sql } from './helpers';

const numbering: Sql = createSql(databaseUrl(), { max: 2 });
let owner: Client;

const draft = async () => {
  const res = await owner.post('/documents', { type: 'invoice' });
  expect(res.status).toBe(201);
  return res.body as { id: string; organizationId: string };
};
const counter = async (orgId: string) => (await admin`select last_number from document_counters where organization_id = ${orgId} and type = 'invoice'`)[0]?.last_number ?? 0;
const ctx = () => ({ userId: owner.user!.id, workspaceId: owner.workspaceId! });

beforeAll(async () => {
  owner = new Client();
  await owner.signup();
});
afterAll(async () => {
  await numbering.end({ timeout: 1 });
});

describe('separate numbering', () => {
  test('a number taken in API mode survives the rollback of the request transaction (gap)', async () => {
    const d = await draft();
    const before = await counter(d.organizationId);
    const failed = withSeparateNumbering(numbering, () =>
      withContext(sql, ctx(), async db => {
        await assignDocumentNumber(db, d.id);
        throw new Error('posting failed after the number');
      }),
    );
    await expect(failed).rejects.toThrow('posting failed');
    expect(await counter(d.organizationId)).toBe(before + 1);
    expect((await admin`select number from documents where id = ${d.id}`)[0]!.number).toBeNull();
  });

  test('without API mode the rollback returns the counter (worker keeps gapless numbering)', async () => {
    const d = await draft();
    const before = await counter(d.organizationId);
    await expect(
      withContext(sql, ctx(), async db => {
        await assignDocumentNumber(db, d.id);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await counter(d.organizationId)).toBe(before);
  });

  test('posting through the API does not wait for the counter row held by another transaction until the deadline', async () => {
    const d = await draft();
    await withSeparateNumbering(numbering, () => withContext(sql, ctx(), db => assignDocumentNumber(db, (d as { id: string }).id)));
    const other = await draft();
    // долгая транзакция «воркера» держит строку счётчика
    let release!: () => void;
    const held = admin.begin(async tx => {
      await tx`select 1 from document_counters where organization_id = ${d.organizationId} and type = 'invoice' for update`;
      await new Promise<void>(r => (release = r));
    });
    await Bun.sleep(50);
    const t0 = performance.now();
    try {
      const res = withSeparateNumbering(numbering, () => withContext(sql, ctx(), db => assignDocumentNumber(db, other.id)));
      await expect(res).rejects.toMatchObject({ status: 503, code: 'numbering_busy' });
      expect(performance.now() - t0).toBeLessThan(8000);
    } finally {
      release();
      await held;
    }
  }, 15_000);
});
