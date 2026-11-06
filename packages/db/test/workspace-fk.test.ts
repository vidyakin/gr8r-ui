/* Каждая таблица арендатора ссылается на workspaces с ON DELETE CASCADE: удаление арендатора (deleteTenant)
   удаляет строку воркспейса и полагается на каскад. Пропущенный FK оставляет строки после удаления (бывало: 0090, 0091). */
import { describe, expect, test } from 'bun:test';
import { createSql, adminDatabaseUrl } from '../src';

describe('workspace foreign keys', () => {
  test('every table with workspace_id cascades from workspaces', async () => {
    const admin = createSql(adminDatabaseUrl(), { max: 1 });
    try {
      const rows = await admin`
        select c.relname as t
        from pg_class c
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped
        where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
          and not exists (
            select 1 from pg_constraint k
            where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.workspaces'::regclass
              and k.conkey = array[a.attnum] and k.confdeltype = 'c')
        order by 1`;
      expect(rows.map(r => r.t as string)).toEqual([]);
    } finally {
      await admin.end();
    }
  });
});
