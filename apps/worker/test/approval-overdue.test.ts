/* Проход просрочки согласований и порт submitApproval (задача 1199): модуль docflow, один раз на задачу, изоляция арендаторов. */
import { afterAll, describe, expect, test } from 'bun:test';
import { adminDatabaseUrl, approvalDetail, createRoute, createSql, createTenant, databaseUrl, startApproval, withContext } from '@erp/db';
import { runApprovalOverdueOnce } from '../src/approval-overdue';
import { submitApproval } from '../src/flows/records';

const sql = createSql(databaseUrl(), { max: 10 });
const admin = createSql(adminDatabaseUrl(), { max: 2 });
afterAll(async () => {
  await sql.end();
  await admin.end();
});

let n = 0;
const uniq = () => `${Date.now().toString(36)}${n++}`;

/** Воркспейс с маршрутом «исполнитель → срок 4 ч» и процессом в работе; docflow выключается тарифом «Базовый» */
async function setup(docflow: boolean) {
  const t = await createTenant(sql, { name: `Ovd ${uniq()}`, owner: { email: `o-${uniq()}@t.dev` } });
  const ws = t.workspaceId;
  if (!docflow) await admin`insert into workspace_licenses (workspace_id, plan_id) select ${ws}, id from license_plans where key = 'basic'`;
  const [owner] = await admin`select id from members where workspace_id = ${ws} order by created_at limit 1`;
  const [org] = await admin`select id from organizations where workspace_id = ${ws} order by created_at limit 1`;
  const [m] = await admin`insert into members (workspace_id, email, name, role) values (${ws}, ${`a-${uniq()}@t.dev`}, 'Approver', 'member') returning id`;
  const [d] = await admin`insert into documents (workspace_id, type, date, organization_id, total) values (${ws}, 'realization', '2026-11-10', ${org!.id}, '1000.00') returning id`;
  const ctx = { workspaceId: ws, memberId: owner!.id as string, role: 'owner' as const };
  const id = await withContext(sql, { workspaceId: ws }, async db => {
    // создание маршрута и запуск процесса не зависят от модуля на уровне сервиса — модуль проверяют API и проход
    await createRoute(db, ctx, { name: 'R', targetKind: 'document', documentType: 'realization', steps: [{ name: 'S', mode: 'sequential', dueHours: 4, participants: [{ memberId: m!.id }] }] } as never);
    return startApproval(db, ctx, { kind: 'document', id: d!.id });
  });
  await admin`update approval_tasks set due_at = now() - interval '3 hours' where approval_id = ${id}`;
  return { ws, id, doc: d!.id as string, owner: owner!.id as string };
}

describe('runApprovalOverdueOnce', () => {
  test('объявляет просрочку один раз: уведомления и событие', async () => {
    const a = await setup(true);
    expect(await runApprovalOverdueOnce(sql)).toBeGreaterThanOrEqual(1);
    expect(await runApprovalOverdueOnce(sql)).toBe(0); // повтор ничего не создаёт
    const ev = await admin`select payload from events where workspace_id = ${a.ws} and type = 'approval.step_overdue'`;
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload.overdueHours).toBe(3);
    const ns = await admin`select 1 from notifications where approval_id = ${a.id} and text like 'Согласование просрочено%'`;
    expect(ns).toHaveLength(2); // согласующий и автор
  });

  test('воркспейс без модуля docflow пропускается', async () => {
    const a = await setup(false);
    await runApprovalOverdueOnce(sql);
    expect(await admin`select 1 from events where workspace_id = ${a.ws} and type = 'approval.step_overdue'`).toHaveLength(0);
    expect((await admin`select overdue_notified_at from approval_tasks where approval_id = ${a.id}`)[0]!.overdue_notified_at).toBeNull();
  });
});

describe('submitApproval (порт узла)', () => {
  test('отправляет черновик на согласование от имени автора flow; повтор — 422 approval_in_progress', async () => {
    const a = await setup(true);
    const [d2] = await admin`insert into documents (workspace_id, type, date, organization_id, total) select ${a.ws}, 'realization', '2026-11-11', organization_id, '5.00' from documents where id = ${a.doc} returning id`;
    const r = await withContext(sql, { workspaceId: a.ws }, db => submitApproval(db, a.ws, a.owner, { targetKind: 'document', objectId: d2!.id }));
    const detail = await withContext(sql, { workspaceId: a.ws }, db => approvalDetail(db, r.approvalId));
    expect(detail.state).toBe('in_progress');
    expect(detail.authorId).toBe(a.owner);
    await expect(withContext(sql, { workspaceId: a.ws }, db => submitApproval(db, a.ws, a.owner, { targetKind: 'document', objectId: d2!.id }))).rejects.toMatchObject({ code: 'approval_in_progress' });
  });

  test('без модуля docflow — ошибка', async () => {
    const a = await setup(false);
    await expect(withContext(sql, { workspaceId: a.ws }, db => submitApproval(db, a.ws, a.owner, { targetKind: 'document', objectId: a.doc }))).rejects.toThrow('module');
  });

  test('неверный id — ошибка до обращения к БД', async () => {
    const a = await setup(true);
    await expect(withContext(sql, { workspaceId: a.ws }, db => submitApproval(db, a.ws, a.owner, { targetKind: 'contract', objectId: 'not-a-uuid' }))).rejects.toThrow();
  });
});
