/* Арендаторы оператора: создание пустого и демо, удаление целиком без следов и без вреда соседям, выгрузка → загрузка
   без потерь, очистка просроченных демо, доступ к /admin/tenants только оператору (docs/architecture/deploy.md). */
import { describe, expect, test } from 'bun:test';
import { createTenant, deleteTenant, exportTenant, importTenant, purgeTenantsOnce, setOperator } from '@gr8r/db';
import { admin, Client, ddl, drainJobs, sql, uniq } from './helpers';

/** Все таблицы с workspace_id, кроме очереди jobs (её архив не переносит) */
async function tenantTables(): Promise<string[]> {
  const rows = await admin`
    select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and not c.relispartition and c.relname <> 'jobs' order by 1`;
  return rows.map(r => r.relname as string);
}

/** Отпечаток данных арендатора: таблица → «число строк:md5 строк». processed_at событий не сравнивается (загрузка помечает их обработанными) */
async function fingerprint(wsId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of await tenantTables()) {
    const [r] = await admin.unsafe(
      `select count(*)::int as n, md5(coalesce(string_agg((to_jsonb(t) - 'processed_at')::text, '|' order by (to_jsonb(t) - 'processed_at')::text), '')) as h from "${t}" t where workspace_id = $1`,
      [wsId],
    );
    out[t] = `${r!.n}:${r!.h}`;
  }
  const [w] = await admin`select md5(to_jsonb(w)::text) as h from workspaces w where id = ${wsId}`;
  out.workspaces = w?.h ?? 'missing';
  return out;
}

const totalRows = (fp: Record<string, string>) => Object.entries(fp).reduce((s, [t, v]) => s + (t === 'workspaces' ? 0 : Number(v.split(':')[0])), 0);

describe('tenants', () => {
  test('пустой арендатор: владелец создаётся с паролем и входит', async () => {
    const email = `owner-${uniq()}@test.dev`;
    const t = await createTenant(sql, { name: 'Ромашка', owner: { email, name: 'Иван' } });
    expect(t.kind).toBe('regular');
    expect(t.password).toBeTruthy();
    const c = new Client();
    const res = await c.post('/auth/signin', { email, password: t.password });
    expect(res.status).toBe(200);
    expect(res.body.workspaces.map((w: { id: string }) => w.id)).toContain(t.workspaceId);
    // существующий владелец — пароль не меняется
    const again = await createTenant(sql, { name: 'Ромашка-2', owner: { email } });
    expect(again.password).toBeNull();
  });

  test('два демо подряд, удаление одного не трогает другого и соседей', async () => {
    const neighbour = new Client();
    await neighbour.signup();
    await neighbour.project('NBR');
    const a = await createTenant(sql, { name: 'Демо A', owner: { email: `a-${uniq()}@test.dev` }, demo: true, ttlDays: 3 });
    const b = await createTenant(sql, { name: 'Демо B', owner: { email: `b-${uniq()}@test.dev` }, demo: true });
    expect(a.kind).toBe('demo');
    expect(a.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 2 * 864e5);
    await drainJobs(); // индексы полей конструктора
    const fpA = await fingerprint(a.workspaceId);
    expect(totalRows(fpA)).toBeGreaterThan(500);
    const fpB = await fingerprint(b.workspaceId);
    const fpN = await fingerprint(neighbour.workspaceId!);
    const fieldIds = (await admin`select id from fields where workspace_id = ${a.workspaceId} and filterable`).map(r => (r.id as string).replace(/-/g, ''));
    expect(fieldIds.length).toBeGreaterThan(0);

    expect(await deleteTenant(sql, ddl, a.workspaceId)).toBe(true);
    const after = await fingerprint(a.workspaceId);
    expect(totalRows(after)).toBe(0);
    expect(after.workspaces).toBe('missing');
    expect(await fingerprint(b.workspaceId)).toEqual(fpB);
    expect(await fingerprint(neighbour.workspaceId!)).toEqual(fpN);
    // владелец без других членств удалён, индексы полей сняты
    expect((await admin`select 1 from users where lower(email) = ${a.ownerEmail}`).length).toBe(0);
    const idx = await admin`select indexname from pg_indexes where indexname = any(${fieldIds.map(f => `idx_cf_${f}`)})`;
    expect(idx.length).toBe(0);
    await deleteTenant(sql, ddl, b.workspaceId); // демо-данные с датами «от сегодня» мешают воркерам в других файлах
  }, 60_000);

  test('выгрузка → удаление → загрузка восстанавливает данные без потерь', async () => {
    const t = await createTenant(sql, { name: 'Демо архив', owner: { email: `arc-${uniq()}@test.dev` }, demo: true });
    const before = await fingerprint(t.workspaceId);
    const archive = await exportTenant(sql, t.workspaceId);
    // поверх живого арендатора загрузка запрещена
    await expect(importTenant(admin, archive)).rejects.toThrow(/already exists/);
    await deleteTenant(sql, ddl, t.workspaceId);
    await importTenant(admin, archive);
    expect(await fingerprint(t.workspaceId)).toEqual(before);
    // владелец пересоздан и снова входит в свой воркспейс; события не отправятся автоматизациям повторно
    const [{ n }] = await admin`select count(*)::int as n from events where workspace_id = ${t.workspaceId} and processed_at is null`;
    expect(n).toBe(0);
    const [m] = await admin`select u.email from memberships m join users u on u.id = m.user_id where m.workspace_id = ${t.workspaceId} and m.role = 'owner'`;
    expect(m!.email).toBe(t.ownerEmail);
    await deleteTenant(sql, ddl, t.workspaceId);
  }, 60_000);

  test('загрузка сопоставляет владельца с существующим пользователем по email', async () => {
    const email = `map-${uniq()}@test.dev`;
    const t = await createTenant(sql, { name: 'Сопоставление', owner: { email } });
    const archive = await exportTenant(sql, t.workspaceId);
    await deleteTenant(sql, ddl, t.workspaceId); // владелец удалён вместе с арендатором
    const c = new Client();
    const me = await c.signup({ email }); // тот же email, новый id
    await importTenant(admin, archive);
    const ws = await c.get('/workspaces');
    expect(ws.body.items.map((w: { id: string }) => w.id)).toContain(t.workspaceId);
    const [m] = await admin`select user_id from members where workspace_id = ${t.workspaceId} and role = 'owner'`;
    expect(m!.user_id).toBe(me.user.id);
  });

  test('очистка: просроченные демо и запрошенные к удалению, остальные живут', async () => {
    const owner = { email: `p-${uniq()}@test.dev` };
    const expired = await createTenant(sql, { name: 'Старое демо', owner });
    const alive = await createTenant(sql, { name: 'Живое', owner });
    const requested = await createTenant(sql, { name: 'К удалению', owner });
    await admin`update workspaces set kind = 'demo', expires_at = now() - interval '1 hour' where id = ${expired.workspaceId}`;
    await admin`update workspaces set delete_requested_at = now() where id = ${requested.workspaceId}`;
    const purged = await purgeTenantsOnce(sql, ddl);
    expect(purged).toContain(expired.workspaceId);
    expect(purged).toContain(requested.workspaceId);
    expect(purged).not.toContain(alive.workspaceId);
    expect((await admin`select 1 from workspaces where id = ${alive.workspaceId}`).length).toBe(1);
    expect((await admin`select 1 from users where lower(email) = ${owner.email}`).length).toBe(1); // ещё владеет «Живым»
  });

  test('/admin/tenants: только оператор; оператор не видит данных арендатора', async () => {
    const user = new Client();
    await user.signup();
    expect((await user.get('/admin/tenants')).status).toBe(403);
    expect((await user.post('/admin/tenants', { name: 'X', ownerEmail: `x-${uniq()}@test.dev` })).status).toBe(403);

    const op = new Client();
    await op.signup();
    await setOperator(sql, op.user!.email, true);
    const created = await op.post('/admin/tenants', { name: 'Клиент', ownerEmail: `c-${uniq()}@test.dev`, ownerName: 'Клиент' });
    expect(created.status).toBe(201);
    expect(created.body.password).toBeTruthy();
    const list = await op.get('/admin/tenants');
    expect(list.status).toBe(200);
    const row = list.body.items.find((r: { id: string }) => r.id === created.body.workspaceId);
    expect(row.owner_email).toBe(created.body.ownerEmail);
    expect(list.body.items.length).toBeGreaterThan(2); // видит и чужих арендаторов — только метаданные
    // данные арендатора оператору недоступны: он не участник
    expect((await op.get('/projects', created.body.workspaceId)).status).toBe(403);

    const exp = await op.get(`/admin/tenants/${created.body.workspaceId}/export`);
    expect(exp.status).toBe(200);
    expect(JSON.parse(new TextDecoder().decode(exp.bytes).split('\n')[0]!).workspaceId).toBe(created.body.workspaceId);

    // владелец входит, после запроса удаления воркспейс пропадает из списка, воркер удаляет его
    const owner = new Client();
    await owner.post('/auth/signin', { email: created.body.ownerEmail, password: created.body.password });
    expect((await op.del(`/admin/tenants/${created.body.workspaceId}`)).status).toBe(202);
    expect((await owner.get('/workspaces')).body.items.length).toBe(0);
    await purgeTenantsOnce(sql, ddl);
    expect((await admin`select 1 from workspaces where id = ${created.body.workspaceId}`).length).toBe(0);

    // снятый флаг действует сразу
    await setOperator(sql, op.user!.email, false);
    expect((await op.get('/admin/tenants')).status).toBe(403);
  });
});
