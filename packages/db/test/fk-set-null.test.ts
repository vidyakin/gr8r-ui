/* Составные FK (workspace_id, X) с ON DELETE SET NULL: при удалении родителя обнуляется только X, а не workspace_id (NOT NULL).
   Без списка колонок Postgres обнуляет весь ключ — удаление родителя падает с not-null violation. */
import { describe, expect, test } from 'bun:test';
import { createSql, adminDatabaseUrl } from '../src';
import { runSeed } from '../src/seed';

interface Fk { name: string; child: string; parent: string; childCols: string[]; parentCols: string[]; def: string }

async function compositeSetNullFks(admin: ReturnType<typeof createSql>): Promise<Fk[]> {
  const rows = await admin`
    select c.conname as name, c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
      array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as child_cols,
      array(select a.attname::text from unnest(c.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i) as parent_cols,
      pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.contype = 'f' and c.confdeltype = 'n' and array_length(c.conkey, 1) > 1
    order by c.conname`;
  return rows.map(r => ({ name: r.name, child: r.child, parent: r.parent, childCols: r.child_cols, parentCols: r.parent_cols, def: r.def }));
}

describe('composite FKs with ON DELETE SET NULL', () => {
  test('null out only their own column, never workspace_id', async () => {
    const admin = createSql(adminDatabaseUrl(), { max: 1 });
    const fks = await compositeSetNullFks(admin);
    await admin.end();
    expect(fks.length).toBeGreaterThanOrEqual(8);
    const bad = fks.filter(f => {
      const own = f.childCols.filter(c => c !== 'workspace_id');
      return !f.def.endsWith(`ON DELETE SET NULL (${own.join(', ')})`);
    });
    expect(bad.map(f => `${f.name}: ${f.def}`)).toEqual([]);
  });

  test('deleting a referenced parent keeps the child row and clears the link (seed data)', async () => {
    const sql = createSql(process.env.DATABASE_URL!, { max: 2 });
    await runSeed(sql, () => {});
    await sql.end();
    const admin = createSql(adminDatabaseUrl(), { max: 1 });
    const fks = await compositeSetNullFks(admin);
    const checked: string[] = [];
    const failures: string[] = [];
    // каждый случай — в транзакции с откатом: сид не меняется; строка находится по ctid (не у всех таблиц есть колонка id)
    for (const fk of fks) {
      const col = fk.childCols.find(c => c !== 'workspace_id')!;
      const pcol = fk.parentCols[fk.childCols.indexOf(col)]!;
      const [row] = await admin.unsafe(`select ctid::text as rid, workspace_id, ${col} as ref from ${fk.child} where ${col} is not null limit 1`);
      if (!row) continue;
      await admin.begin(async tx => {
        try {
          await tx.unsafe('savepoint s');
          await tx.unsafe(`delete from ${fk.parent} where workspace_id = $1 and ${pcol} = $2`, [row.workspace_id, row.ref]);
          const [after] = await tx.unsafe(`select workspace_id, ${col} as ref from ${fk.child} where ctid = $1::text::tid`, [row.rid]);
          // строка могла уйти каскадом по другой ссылке — тогда проверять нечего
          if (after) {
            if (after.ref !== null || after.workspace_id !== row.workspace_id) failures.push(`${fk.name}: link not cleared`);
          }
          checked.push(fk.name);
        } catch (e: any) {
          await tx.unsafe('rollback to savepoint s');
          // родителя держит другая ссылка (RESTRICT) — к этому FK отношения не имеет
          if (e.code !== '23503') failures.push(`${fk.name}: ${e.code} ${e.message}`);
        }
        throw new Error('rollback');
      }).catch(e => { if (e.message !== 'rollback') throw e; });
    }
    await admin.end();
    console.log('checked:', checked.join(', '));
    expect(failures).toEqual([]);
    expect(checked.length).toBeGreaterThan(0);
  });
});
