/* Согласование по маршрутам (задача 1199): сервис packages/db/src/approvals.ts на тестовой БД, под ролью app_user. */
import { afterAll, describe, expect, test } from 'bun:test';
import { adminDatabaseUrl, assertApproved, approvalDetail, approvalGate, approvalsOfObject, cancelApproval, createRoute, createSql, createTenant, databaseUrl, decide, listApprovals, matchRoute, scanOverdue, startApproval, updateRoute, withContext, type Db } from '../src';

const sql = createSql(databaseUrl(), { max: 10 });
const admin = createSql(adminDatabaseUrl(), { max: 2 });
afterAll(async () => {
  await sql.end();
  await admin.end();
});

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${seq++}`;

interface Ws {
  id: string;
  owner: string;
  org: string;
  other: string;
  third: string;
  holders: [string, string];
  position: string;
  emptyPosition: string;
}

const run = <T>(ws: { id: string }, fn: (db: Db) => Promise<T>): Promise<T> => withContext(sql, { workspaceId: ws.id }, fn);
const ctxOf = (ws: { id: string }, memberId: string, role: 'owner' | 'admin' | 'member' = 'member') => ({ workspaceId: ws.id, memberId, role });

async function member(wsId: string, name: string, role = 'member'): Promise<string> {
  const [m] = await admin`insert into members (workspace_id, email, name, role) values (${wsId}, ${`${name}-${uniq()}@t.dev`}, ${name}, ${role}) returning id`;
  return m!.id;
}

async function makeWs(docflow = true): Promise<Ws> {
  const t = await createTenant(sql, { name: `Appr ${uniq()}`, owner: { email: `owner-${uniq()}@t.dev` } });
  const id = t.workspaceId;
  // тариф по умолчанию в тестовой БД — «Полный»; без модуля — «Базовый» (ядро, CRM, торговля)
  if (!docflow) await admin`insert into workspace_licenses (workspace_id, plan_id) select ${id}, id from license_plans where key = 'basic'`;
  const [o] = await admin`select id from members where workspace_id = ${id} order by created_at limit 1`;
  const [org] = await admin`select id from organizations where workspace_id = ${id} order by created_at limit 1`;
  const [pos] = await admin`insert into positions (workspace_id, name) values (${id}, 'Бухгалтер') returning id`;
  const [empty] = await admin`insert into positions (workspace_id, name) values (${id}, 'Пустая') returning id`;
  const h1 = await member(id, 'Holder1');
  const h2 = await member(id, 'Holder2');
  for (const h of [h1, h2]) await admin`insert into member_positions (workspace_id, member_id, position_id) values (${id}, ${h}, ${pos!.id})`;
  return { id, owner: o!.id, org: org!.id, other: await member(id, 'Other'), third: await member(id, 'Third'), holders: [h1, h2], position: pos!.id, emptyPosition: empty!.id };
}

async function doc(ws: Ws, total = '1000.00', type = 'realization'): Promise<string> {
  const [d] = await admin`insert into documents (workspace_id, type, date, organization_id, total) values (${ws.id}, ${type}, '2026-11-10', ${ws.org}, ${total}) returning id`;
  return d!.id;
}

const seqRoute = (ws: Ws, over: Record<string, unknown> = {}) =>
  run(ws, db =>
    createRoute(db, ctxOf(ws, ws.owner), {
      name: 'Заказ',
      targetKind: 'document',
      documentType: 'realization',
      steps: [{ name: 'Руководитель', mode: 'sequential', participants: [{ memberId: ws.other }, { memberId: ws.third }] }],
      ...over,
    } as never),
  );

const tasksOf = (ws: Ws, approvalId: string) => run(ws, async db => (await approvalDetail(db, approvalId)).tasks);

describe('matchRoute', () => {
  test('conditions: type, organization, amount; first by sort order; archived skipped', async () => {
    const ws = await makeWs();
    const [org2] = await admin`insert into organizations (workspace_id, name) values (${ws.id}, 'Вторая') returning id`;
    await seqRoute(ws, { name: 'Дорогие', amountFrom: '100000', sortOrder: 1 });
    await seqRoute(ws, { name: 'Чужая орг', organizationId: org2!.id, sortOrder: 2 });
    await seqRoute(ws, { name: 'Любые', sortOrder: 3 });
    const cheap = await doc(ws, '500.00');
    const dear = await doc(ws, '150000.00');
    const invoice = await doc(ws, '150000.00', 'invoice');
    await run(ws, async db => {
      expect((await matchRoute(db, { kind: 'document', id: cheap }))?.name).toBe('Любые');
      expect((await matchRoute(db, { kind: 'document', id: dear }))?.name).toBe('Дорогие');
      // другой тип документа — маршруты на реализацию не подходят
      expect(await matchRoute(db, { kind: 'document', id: invoice })).toBeNull();
    });
  });

  test('a contract route does not match documents and vice versa', async () => {
    const ws = await makeWs();
    await seqRoute(ws, { name: 'Договоры', targetKind: 'contract', documentType: null });
    const d = await doc(ws);
    await run(ws, async db => expect(await matchRoute(db, { kind: 'document', id: d })).toBeNull());
  });
});

describe('sequential and parallel steps', () => {
  test('sequential: participants one by one, the final approval stores the fingerprint', async () => {
    const ws = await makeWs();
    await seqRoute(ws);
    const d = await doc(ws);
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), { kind: 'document', id: d }));
    let tasks = await tasksOf(ws, id);
    expect(tasks.map(t => [t.memberId, t.state])).toEqual([[ws.other, 'pending'], [ws.third, 'waiting']]);
    await run(ws, db => decide(db, ctxOf(ws, ws.other), tasks[0]!.id, { decision: 'approve', comment: 'ok' }));
    tasks = await tasksOf(ws, id);
    expect(tasks.map(t => t.state)).toEqual(['done', 'pending']);
    await run(ws, db => decide(db, ctxOf(ws, ws.third), tasks[1]!.id, { decision: 'approve' }));
    const detail = await run(ws, db => approvalDetail(db, id));
    expect(detail.state).toBe('approved');
    expect(detail.finishedAt).not.toBeNull();
    const [ap] = await admin`select approved_fingerprint, fingerprint from approvals where id = ${id}`;
    expect(ap!.approved_fingerprint).toBe(ap!.fingerprint);
    const events = await admin`select type from events where workspace_id = ${ws.id} and entity = 'approval' order by created_at`;
    expect(events.map(e => e.type)).toEqual(['approval.started', 'approval.decided', 'approval.decided', 'approval.completed']);
    // автор уведомлён
    const [n] = await admin`select count(*)::int as n from notifications where workspace_id = ${ws.id} and approval_id = ${id} and recipient_id = ${ws.owner} and type = 'approval'`;
    expect(n!.n).toBe(1);
  });

  test('only the assignee decides; an approval of someone else is forbidden', async () => {
    const ws = await makeWs();
    await seqRoute(ws);
    const d = await doc(ws);
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), { kind: 'document', id: d }));
    const tasks = await tasksOf(ws, id);
    await expect(run(ws, db => decide(db, ctxOf(ws, ws.third), tasks[0]!.id, { decision: 'approve' }))).rejects.toMatchObject({ status: 403 });
    // очередь: задача второго ещё не активна
    await expect(run(ws, db => decide(db, ctxOf(ws, ws.third), tasks[1]!.id, { decision: 'approve' }))).rejects.toMatchObject({ code: 'task_not_pending' });
  });

  test('parallel: all pending at once, needs every decision; a comment does not move the process', async () => {
    const ws = await makeWs();
    await seqRoute(ws, { steps: [{ name: 'Все', mode: 'parallel', participants: [{ memberId: ws.other }, { memberId: ws.third }] }, { name: 'Финиш', mode: 'sequential', participants: [{ memberId: ws.owner }] }] });
    const d = await doc(ws);
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), { kind: 'document', id: d }));
    let tasks = await tasksOf(ws, id);
    expect(tasks.filter(t => t.state === 'pending')).toHaveLength(2);
    await run(ws, db => decide(db, ctxOf(ws, ws.other), tasks[0]!.id, { decision: 'comment', comment: 'вопрос' }));
    tasks = await tasksOf(ws, id);
    expect(tasks[0]!.state).toBe('pending');
    expect(tasks[0]!.notes).toHaveLength(1);
    await run(ws, db => decide(db, ctxOf(ws, ws.other), tasks[0]!.id, { decision: 'approve' }));
    let detail = await run(ws, db => approvalDetail(db, id));
    expect(detail.currentStep).toBe(0);
    tasks = await tasksOf(ws, id);
    await run(ws, db => decide(db, ctxOf(ws, ws.third), tasks[1]!.id, { decision: 'approve' }));
    detail = await run(ws, db => approvalDetail(db, id));
    expect(detail.state).toBe('in_progress');
    expect(detail.currentStep).toBe(1);
    expect(detail.tasks.find(t => t.stepIndex === 1)!.state).toBe('pending');
    await run(ws, db => decide(db, ctxOf(ws, ws.owner), detail.tasks.find(t => t.stepIndex === 1)!.id, { decision: 'approve' }));
    expect((await run(ws, db => approvalDetail(db, id))).state).toBe('approved');
  });
});

describe('position participant', () => {
  test('the first holder decides, the other task is skipped and cannot be decided', async () => {
    const ws = await makeWs();
    await seqRoute(ws, { steps: [{ name: 'Бухгалтерия', mode: 'sequential', participants: [{ positionId: ws.position }] }] });
    const d = await doc(ws);
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), { kind: 'document', id: d }));
    const tasks = await tasksOf(ws, id);
    expect(tasks).toHaveLength(2);
    expect(tasks.every(t => t.state === 'pending' && t.positionName === 'Бухгалтер')).toBe(true);
    const [first, second] = [tasks.find(t => t.memberId === ws.holders[0])!, tasks.find(t => t.memberId === ws.holders[1])!];
    await run(ws, db => decide(db, ctxOf(ws, ws.holders[0]), first.id, { decision: 'approve' }));
    expect((await tasksOf(ws, id)).find(t => t.id === second.id)!.state).toBe('skipped');
    await expect(run(ws, db => decide(db, ctxOf(ws, ws.holders[1]), second.id, { decision: 'approve' }))).rejects.toMatchObject({ status: 409 });
    expect((await run(ws, db => approvalDetail(db, id))).state).toBe('approved');
  });

  test('two holders decide at the same time: exactly one decision is counted', async () => {
    const ws = await makeWs();
    await seqRoute(ws, { steps: [{ name: 'Бухгалтерия', mode: 'sequential', participants: [{ positionId: ws.position }] }] });
    const d = await doc(ws);
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), { kind: 'document', id: d }));
    const tasks = await tasksOf(ws, id);
    const results = await Promise.allSettled(tasks.map(t => run(ws, db => decide(db, ctxOf(ws, t.memberId), t.id, { decision: 'approve' }))));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(['task_not_pending', 'approval_not_in_progress']).toContain(failed.reason.code);
    expect(failed.reason.status).toBe(409);
    const rows = await admin`select state, decision from approval_tasks where approval_id = ${id} order by state`;
    expect(rows.map(r => r.state)).toEqual(['done', 'skipped']);
    expect((await run(ws, db => approvalDetail(db, id))).state).toBe('approved');
  });

  test('a position without holders gives 422 route_step_empty and nothing is created', async () => {
    const ws = await makeWs();
    await seqRoute(ws, { steps: [{ name: 'Пусто', mode: 'sequential', participants: [{ positionId: ws.emptyPosition }] }] });
    const d = await doc(ws);
    await expect(run(ws, db => startApproval(db, ctxOf(ws, ws.owner), { kind: 'document', id: d }))).rejects.toMatchObject({ status: 422, code: 'route_step_empty' });
    const [n] = await admin`select count(*)::int as n from approvals where workspace_id = ${ws.id}`;
    expect(n!.n).toBe(0);
  });
});

describe('rejection, rounds, cancel', () => {
  test('a rejection finishes the process; a new round gets round + 1 and keeps the history', async () => {
    const ws = await makeWs();
    await seqRoute(ws);
    const d = await doc(ws);
    const ref = { kind: 'document' as const, id: d };
    const id1 = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), ref));
    await expect(run(ws, db => startApproval(db, ctxOf(ws, ws.owner), ref))).rejects.toMatchObject({ code: 'approval_in_progress' });
    const t1 = await tasksOf(ws, id1);
    await run(ws, db => decide(db, ctxOf(ws, ws.other), t1[0]!.id, { decision: 'reject', comment: 'нет' }));
    const d1 = await run(ws, db => approvalDetail(db, id1));
    expect(d1.state).toBe('rejected');
    expect(d1.tasks.map(t => t.state)).toEqual(['done', 'skipped']);
    const id2 = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), ref));
    const all = await run(ws, db => approvalsOfObject(db, ref));
    expect(all.rounds.map(r => [r.round, r.state])).toEqual([[2, 'in_progress'], [1, 'rejected']]);
    expect(all.current!.id).toBe(id2);
    expect(all.gate).toBe('in_progress');
  });

  test('cancel: the author or an admin; a stranger cannot; a finished process cannot be cancelled', async () => {
    const ws = await makeWs();
    await seqRoute(ws);
    const d = await doc(ws);
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.other), { kind: 'document', id: d }));
    await expect(run(ws, db => cancelApproval(db, ctxOf(ws, ws.third), id))).rejects.toMatchObject({ status: 403 });
    const done = await run(ws, db => cancelApproval(db, ctxOf(ws, ws.owner, 'admin'), id, { reason: 'ошибка' }));
    expect(done.state).toBe('cancelled');
    expect(done.cancelReason).toBe('ошибка');
    expect((await tasksOf(ws, id)).every(t => t.state === 'skipped')).toBe(true);
    await expect(run(ws, db => cancelApproval(db, ctxOf(ws, ws.owner, 'admin'), id))).rejects.toMatchObject({ status: 409 });
  });

  test('a route edit does not change a running process (snapshot)', async () => {
    const ws = await makeWs();
    const route = await seqRoute(ws);
    const d = await doc(ws);
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), { kind: 'document', id: d }));
    await run(ws, db => updateRoute(db, ctxOf(ws, ws.owner), route.id, { steps: [{ name: 'Новый', mode: 'parallel', participants: [{ memberId: ws.owner }] }] }));
    const detail = await run(ws, db => approvalDetail(db, id));
    expect(detail.snapshot.steps).toHaveLength(1);
    expect(detail.snapshot.steps[0]!.name).toBe('Руководитель');
    expect(detail.tasks).toHaveLength(2);
  });
});

describe('assertApproved and the fingerprint', () => {
  test('required route: required → in_progress → approved → outdated after an edit; no route and no module do not block', async () => {
    const ws = await makeWs();
    await seqRoute(ws, { steps: [{ name: 'Один', mode: 'sequential', participants: [{ memberId: ws.other }] }] });
    const d = await doc(ws, '1000.00');
    const ref = { kind: 'document' as const, id: d };
    await run(ws, db => Promise.resolve(expect(assertApproved(db, ref)).rejects.toMatchObject({ code: 'approval_required' })));
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), ref));
    await run(ws, db => Promise.resolve(expect(assertApproved(db, ref)).rejects.toMatchObject({ code: 'approval_in_progress' })));
    const [t] = await tasksOf(ws, id);
    await run(ws, db => decide(db, ctxOf(ws, ws.other), t!.id, { decision: 'approve' }));
    await run(ws, db => assertApproved(db, ref)); // не бросает
    expect((await run(ws, db => approvalGate(db, ref))).gate).toBe('approved');
    // правка суммы после согласования
    await admin`update documents set total = '1500.00' where id = ${d}`;
    await run(ws, db => Promise.resolve(expect(assertApproved(db, ref)).rejects.toMatchObject({ code: 'approval_outdated' })));
    // другой документ без маршрута (тип invoice) не блокируется
    const free = await doc(ws, '1.00', 'invoice');
    await run(ws, db => assertApproved(db, { kind: 'document', id: free }));
  });

  test('the fingerprint catches a changed document line', async () => {
    const ws = await makeWs();
    await seqRoute(ws, { steps: [{ name: 'Один', mode: 'sequential', participants: [{ memberId: ws.other }] }] });
    const d = await doc(ws);
    const [p] = await admin`insert into products (workspace_id, name) values (${ws.id}, 'Товар') returning id`;
    const [line] = await admin`insert into document_lines (workspace_id, document_id, product_id, name, qty, price) values (${ws.id}, ${d}, ${p!.id}, 'Товар', 1, 100) returning id`;
    const ref = { kind: 'document' as const, id: d };
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), ref));
    const [t] = await tasksOf(ws, id);
    await run(ws, db => decide(db, ctxOf(ws, ws.other), t!.id, { decision: 'approve' }));
    await run(ws, db => assertApproved(db, ref));
    await admin`update document_lines set qty = 2 where id = ${line!.id}`;
    await run(ws, db => Promise.resolve(expect(assertApproved(db, ref)).rejects.toMatchObject({ code: 'approval_outdated' })));
  });

  test('an optional route (required = false) does not block', async () => {
    const ws = await makeWs();
    await seqRoute(ws, { required: false });
    const d = await doc(ws);
    await run(ws, db => assertApproved(db, { kind: 'document', id: d }));
  });

  test('without the docflow module nothing is blocked and no route matches the gate', async () => {
    const ws = await makeWs(false);
    await seqRoute(ws);
    const d = await doc(ws);
    await run(ws, async db => {
      await assertApproved(db, { kind: 'document', id: d });
      expect((await approvalsOfObject(db, { kind: 'document', id: d })).enabled).toBe(false);
    });
  });

  test('a contract: required route blocks until approved', async () => {
    const ws = await makeWs();
    await seqRoute(ws, { name: 'Договоры', targetKind: 'contract', documentType: null, steps: [{ name: 'Юрист', mode: 'sequential', participants: [{ memberId: ws.other }] }] });
    const [co] = await admin`insert into companies (workspace_id, name) values (${ws.id}, 'Клиент') returning id`;
    const [c] = await admin`insert into contracts (workspace_id, company_id, organization_id, number, date, valid_from) values (${ws.id}, ${co!.id}, ${ws.org}, '1', '2026-11-01', '2026-11-01') returning id`;
    const ref = { kind: 'contract' as const, id: c!.id };
    await run(ws, db => Promise.resolve(expect(assertApproved(db, ref)).rejects.toMatchObject({ code: 'approval_required' })));
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), ref));
    const [t] = await tasksOf(ws, id);
    await run(ws, db => decide(db, ctxOf(ws, ws.other), t!.id, { decision: 'approve' }));
    await run(ws, db => assertApproved(db, ref));
    await admin`update contracts set note = 'правка' where id = ${c!.id}`;
    await run(ws, db => Promise.resolve(expect(assertApproved(db, ref)).rejects.toMatchObject({ code: 'approval_outdated' })));
  });
});

describe('overdue scan', () => {
  test('notifies the approver and the author once and writes approval.step_overdue', async () => {
    const ws = await makeWs();
    await seqRoute(ws, { steps: [{ name: 'Срок', mode: 'sequential', dueHours: 4, participants: [{ memberId: ws.other }] }] });
    const d = await doc(ws);
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), { kind: 'document', id: d }));
    const [t] = await tasksOf(ws, id);
    expect(t!.dueAt).not.toBeNull();
    expect(await run(ws, db => scanOverdue(db))).toBe(0);
    await admin`update approval_tasks set due_at = now() - interval '3 hours' where approval_id = ${id}`;
    expect(await run(ws, db => scanOverdue(db))).toBe(1);
    expect(await run(ws, db => scanOverdue(db))).toBe(0);
    const ns = await admin`select recipient_id from notifications where approval_id = ${id} and text like 'Согласование просрочено%'`;
    expect(ns.map(n => n.recipient_id).sort()).toEqual([ws.other, ws.owner].sort());
    const ev = await admin`select payload from events where workspace_id = ${ws.id} and type = 'approval.step_overdue'`;
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload.overdueHours).toBe(3);
    expect((await tasksOf(ws, id))[0]!.overdueHours).toBeGreaterThanOrEqual(3);
  });

  test('a finished process is not scanned', async () => {
    const ws = await makeWs();
    await seqRoute(ws, { steps: [{ name: 'Срок', mode: 'sequential', dueHours: 1, participants: [{ memberId: ws.other }] }] });
    const d = await doc(ws);
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), { kind: 'document', id: d }));
    await run(ws, db => cancelApproval(db, ctxOf(ws, ws.owner), id));
    await admin`update approval_tasks set due_at = now() - interval '3 hours' where approval_id = ${id}`;
    expect(await run(ws, db => scanOverdue(db))).toBe(0);
  });
});

describe('lists and RLS', () => {
  test('boxes: mine (my open task), sent, all', async () => {
    const ws = await makeWs();
    await seqRoute(ws);
    const d = await doc(ws);
    const id = await run(ws, db => startApproval(db, ctxOf(ws, ws.owner), { kind: 'document', id: d }));
    const p = { state: undefined, targetKind: undefined, limit: 50, offset: 0 };
    const mine = await run(ws, db => listApprovals(db, ctxOf(ws, ws.other), { ...p, box: 'mine' }));
    expect(mine.items.map(i => i.id)).toEqual([id]);
    expect(mine.items[0]!.myTaskId).not.toBeNull();
    expect((await run(ws, db => listApprovals(db, ctxOf(ws, ws.third), { ...p, box: 'mine' }))).items).toHaveLength(0);
    expect((await run(ws, db => listApprovals(db, ctxOf(ws, ws.owner), { ...p, box: 'sent' }))).total).toBe(1);
    expect((await run(ws, db => listApprovals(db, ctxOf(ws, ws.third), { ...p, box: 'sent' }))).total).toBe(0);
    expect((await run(ws, db => listApprovals(db, ctxOf(ws, ws.third, 'admin'), { ...p, box: 'all' }))).total).toBe(1);
  });

  test('RLS: another tenant sees neither routes nor processes nor tasks', async () => {
    const a = await makeWs();
    const b = await makeWs();
    await seqRoute(a);
    const d = await doc(a);
    await run(a, db => startApproval(db, ctxOf(a, a.owner), { kind: 'document', id: d }));
    await run(b, async db => {
      for (const t of ['approval_routes', 'approval_route_steps', 'approval_route_participants', 'approvals', 'approval_tasks']) {
        const rows = (await db.execute(`select count(*)::int as n from ${t}` as never)) as unknown as { n: number }[];
        expect(rows[0]!.n).toBe(0);
      }
    });
    // чужой документ не подбирает маршрут
    await run(b, db => Promise.resolve(expect(matchRoute(db, { kind: 'document', id: d })).rejects.toMatchObject({ status: 404 })));
  });
});
