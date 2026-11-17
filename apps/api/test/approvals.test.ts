/* Согласование по маршрутам (задача 1199): маршруты, отправка, решения, проверка при проведении и подписании договора,
   заявка на расход по маршруту и без него, печать листа, модуль docflow, существующие сценарии (проведение без маршрутов, биллинг). */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, addMember, admin } from './helpers';
import { runBillingOnce } from '../../worker/src/billing';

let owner: Client;
let boss: Client;
let boss2: Client;
let guest: Client;
let other: Client;
let ids: Record<string, string> = {};
let customer: string;
let service: string;
let expenseItem: string;

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const memberId = async (c: Client) => ((await owner.get('/members')).body.items as any[]).find(m => m.email === c.user!.email).id as string;
const invoice = async (price = 1000, extra: Record<string, unknown> = {}) => (await mk(owner, '/documents', { type: 'invoice', counterpartyId: customer, lines: [{ productId: service, qty: 1, price }], ...extra })).id as string;
const route = (c: Client, body: Record<string, unknown>) =>
  mk(c, '/approval-routes', { name: 'Счета', targetKind: 'document', documentType: 'invoice', steps: [{ name: 'Руководитель', mode: 'sequential', participants: [{ memberId: ids.boss }] }], ...body });
const start = (c: Client, documentId: string) => c.post('/approvals', { targetKind: 'document', documentId });
const taskOf = async (approvalId: string, who: string) => ((await owner.get(`/approvals/${approvalId}`)).body.tasks as any[]).find(t => t.memberId === who);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Approvals WS' });
  boss = await addMember(owner, 'member');
  boss2 = await addMember(owner, 'member');
  guest = await addMember(owner, 'guest');
  other = new Client();
  await other.signup({ workspaceName: 'Other approvals WS' });
  ids = { boss: await memberId(boss), boss2: await memberId(boss2), owner: await memberId(owner) };
  customer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7707083893' })).id;
  service = (await mk(owner, '/products', { name: 'Консультация', kind: 'service', unitCode: '356', price: 1000, vatRate: 'none' })).id;
  expenseItem = (await mk(owner, '/cash-flow-items', { name: 'Аренда', kind: 'expense' })).id;
});

describe('справочник маршрутов', () => {
  test('читают все, правит admin и выше; архив вместо удаления', async () => {
    expect((await boss.post('/approval-routes', { name: 'X', steps: [{ participants: [{ memberId: ids.boss }] }] })).status).toBe(403);
    const r = await route(owner, { name: 'Для справочника', documentType: 'act', sortOrder: 5 });
    expect(r.steps[0].participants[0].memberId).toBe(ids.boss);
    expect(r.required).toBe(true);
    expect((await boss.get('/approval-routes')).body.items.some((x: any) => x.id === r.id)).toBe(true);
    const upd = await owner.patch(`/approval-routes/${r.id}`, { required: false, amountFrom: '100' });
    expect(upd.body.required).toBe(false);
    expect(upd.body.steps).toHaveLength(1); // этапы не пришли — не меняются
    expect((await owner.patch(`/approval-routes/${r.id}`, { amountFrom: null })).body.amountFrom).toBeNull();
    // участник — ровно сотрудник или должность
    expect((await owner.post('/approval-routes', { name: 'Y', steps: [{ participants: [{}] }] })).status).toBe(400);
    expect((await owner.post('/approval-routes', { name: 'Y', steps: [] })).status).toBe(400);
    expect((await owner.del(`/approval-routes/${r.id}`)).body.archived).toBe(true);
    expect((await owner.get('/approval-routes')).body.items.some((x: any) => x.id === r.id)).toBe(false);
    expect((await owner.get('/approval-routes?archived=true')).body.items.some((x: any) => x.id === r.id)).toBe(true);
    expect((await owner.post(`/approval-routes/${r.id}/restore`)).status).toBe(200);
    await owner.del(`/approval-routes/${r.id}`);
  });

  test('чужой арендатор не видит маршрутов', async () => {
    expect((await other.get('/approval-routes')).body.items).toHaveLength(0);
  });
});

describe('существующие сценарии без маршрутов', () => {
  test('документ проводится без согласования, by-object: согласование не нужно', async () => {
    const id = await invoice();
    const info = (await owner.get(`/approvals/by-object?targetKind=document&documentId=${id}`)).body;
    expect(info.enabled).toBe(true);
    expect(info.gate).toBe('not_required');
    expect(info.canStart).toBe(false);
    expect((await start(owner, id)).body.error.code).toBe('route_not_found');
    expect((await owner.post(`/documents/${id}/post`)).status).toBe(200);
  });
});

describe('обязательный маршрут на счета', () => {
  let routeId: string;
  beforeAll(async () => {
    routeId = (await route(owner, { name: 'Счета обязательные', sortOrder: 1 })).id;
  });

  test('проведение: нужно согласование → идёт → согласовано → проведено; правка после согласования — устарело', async () => {
    const id = await invoice();
    let r = await owner.post(`/documents/${id}/post`);
    expect([r.status, r.body.error.code]).toEqual([422, 'approval_required']);
    const info = (await owner.get(`/approvals/by-object?targetKind=document&documentId=${id}`)).body;
    expect([info.gate, info.canStart, info.route.name]).toEqual(['required', true, 'Счета обязательные']);

    const ap = await start(owner, id);
    expect(ap.status).toBe(201);
    expect(ap.body.state).toBe('in_progress');
    expect(ap.body.round).toBe(1);
    r = await owner.post(`/documents/${id}/post`);
    expect(r.body.error.code).toBe('approval_in_progress');
    expect((await start(owner, id)).body.error.code).toBe('approval_in_progress');

    // входящие согласующего
    const inbox = (await boss.get('/approvals?box=mine')).body;
    expect(inbox.items.map((i: any) => i.id)).toContain(ap.body.id);
    const task = inbox.items.find((i: any) => i.id === ap.body.id).myTaskId;
    // уведомление согласующему
    const notes = (await boss.get('/notifications?type=approval')).body.items as any[];
    expect(notes.some(n => n.approvalId === ap.body.id)).toBe(true);
    // чужую задачу не решить
    expect((await boss2.post(`/approval-tasks/${task}/decide`, { decision: 'approve' })).status).toBe(403);
    expect((await guest.post(`/approval-tasks/${task}/decide`, { decision: 'approve' })).status).toBe(403);
    const done = await boss.post(`/approval-tasks/${task}/decide`, { decision: 'approve', comment: 'ок' });
    expect(done.status).toBe(200);
    expect(done.body.state).toBe('approved');
    // повторное решение
    expect((await boss.post(`/approval-tasks/${task}/decide`, { decision: 'approve' })).status).toBe(409);

    // правка суммы после согласования — проведение требует нового круга
    expect((await owner.patch(`/documents/${id}`, { lines: [{ productId: service, qty: 2, price: 1000 }] })).status).toBe(200);
    r = await owner.post(`/documents/${id}/post`);
    expect([r.status, r.body.error.code]).toEqual([422, 'approval_outdated']);
    const ap2 = await mk(owner, '/approvals', { targetKind: 'document', documentId: id });
    expect(ap2.round).toBe(2);
    await boss.post(`/approval-tasks/${(await taskOf(ap2.id, ids.boss)).id}/decide`, { decision: 'approve' });
    expect((await owner.post(`/documents/${id}/post`)).status).toBe(200);
    const hist = (await owner.get(`/approvals/by-object?targetKind=document&documentId=${id}`)).body;
    expect(hist.rounds.map((x: any) => [x.round, x.state])).toEqual([[2, 'approved'], [1, 'approved']]);
  });

  test('отказ и новый круг; отзыв автором и admin; чужой не отзовёт; лист согласования печатается', async () => {
    const id = await invoice();
    const ap = await mk(owner, '/approvals', { targetKind: 'document', documentId: id });
    const task = await taskOf(ap.id, ids.boss);
    const rej = await boss.post(`/approval-tasks/${task.id}/decide`, { decision: 'reject', comment: 'дорого' });
    expect(rej.body.state).toBe('rejected');
    expect((await owner.post(`/documents/${id}/post`)).body.error.code).toBe('approval_required');
    const ap2 = await mk(owner, '/approvals', { targetKind: 'document', documentId: id });
    expect(ap2.round).toBe(2);
    expect((await boss2.post(`/approvals/${ap2.id}/cancel`, { reason: 'x' })).status).toBe(403);
    const cancelled = await owner.post(`/approvals/${ap2.id}/cancel`, { reason: 'ошибка' });
    expect(cancelled.body.state).toBe('cancelled');
    expect((await owner.post(`/approvals/${ap2.id}/cancel`, {})).status).toBe(409);
    const html = await owner.get(`/approvals/${ap.id}/print`);
    expect(html.status).toBe(200);
    expect(String(html.body)).toContain('Лист согласования');
    expect(String(html.body)).toContain('дорого');
  });

  test('списки: «все» только admin, «отправленные» — автору', async () => {
    expect((await boss.get('/approvals?box=all')).status).toBe(403);
    expect((await owner.get('/approvals?box=all')).body.total).toBeGreaterThan(0);
    expect((await owner.get('/approvals?box=sent')).body.total).toBeGreaterThan(0);
    expect((await boss.get('/approvals?box=sent')).body.total).toBe(0);
    expect((await other.get('/approvals?box=all')).body.total).toBe(0);
  });

  test('системное проведение (биллинг) не блокируется обязательным маршрутом', async () => {
    const plan = (await mk(owner, '/tariff-plans', { name: 'Тариф' })).id;
    await owner.post(`/tariff-plans/${plan}/lines`, { lines: [{ productId: service, qty: '1', price: '1000', isSubscription: true }] });
    const contract = (await mk(owner, '/contracts', { companyId: customer, number: 'Д-БИЛ', date: '2026-01-01', validFrom: '2026-01-01', isService: true, tariffPlanId: plan, periodicity: 'month', billingDay: 1 })).id;
    await runBillingOnce(admin, new Date('2026-03-31T21:00:00Z'));
    const docs = ((await owner.get('/documents?type=invoice&limit=200')).body.items as any[]).filter(d => d.contractId === contract);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every(d => d.status === 'posted')).toBe(true);
  });

  test('сумма в условии: маршрут «от 100 000» не берёт дешёвый документ', async () => {
    await owner.patch(`/approval-routes/${routeId}`, { amountFrom: '100000' });
    const cheap = await invoice(500);
    expect((await owner.post(`/documents/${cheap}/post`)).status).toBe(200);
    await owner.patch(`/approval-routes/${routeId}`, { amountFrom: null });
  });
});

describe('договор', () => {
  test('«подписан» только после согласования; правка договора после согласования — устарело', async () => {
    await mk(owner, '/approval-routes', { name: 'Договоры', targetKind: 'contract', steps: [{ name: 'Юрист', participants: [{ memberId: ids.boss }] }] });
    const c = await mk(owner, '/contracts', { companyId: customer, number: 'Д-СОГЛ', date: '2026-11-01', validFrom: '2026-11-01' });
    let r = await owner.patch(`/contracts/${c.id}`, { isSigned: true });
    expect([r.status, r.body.error.code]).toEqual([422, 'approval_required']);
    // создание сразу подписанным тоже закрыто
    expect((await owner.post('/contracts', { companyId: customer, number: 'Д-2', date: '2026-11-01', validFrom: '2026-11-01', isSigned: true })).body.error.code).toBe('approval_required');
    const ap = await mk(owner, '/approvals', { targetKind: 'contract', contractId: c.id });
    expect(ap.targetKind).toBe('contract');
    expect((await owner.patch(`/contracts/${c.id}`, { isSigned: true })).body.error.code).toBe('approval_in_progress');
    await boss.post(`/approval-tasks/${(await taskOf(ap.id, ids.boss)).id}/decide`, { decision: 'approve' });
    expect((await owner.patch(`/contracts/${c.id}`, { note: 'правка' })).status).toBe(200);
    expect((await owner.patch(`/contracts/${c.id}`, { isSigned: true })).body.error.code).toBe('approval_outdated');
    const ap2 = await mk(owner, '/approvals', { targetKind: 'contract', contractId: c.id });
    await boss.post(`/approval-tasks/${(await taskOf(ap2.id, ids.boss)).id}/decide`, { decision: 'approve' });
    r = await owner.patch(`/contracts/${c.id}`, { isSigned: true });
    expect(r.status).toBe(200);
    expect(r.body.isSigned).toBe(true);
  });
});

describe('заявка на расход', () => {
  const request = async (amount: number) => {
    const sup = (await mk(owner, '/companies', { name: `Поставщик ${amount}` })).id;
    return (await mk(owner, '/payment-requests', { counterpartyId: sup, lines: [{ amount, cashFlowItemId: expenseItem }] })).id as string;
  };

  test('без маршрута согласует admin вручную, как раньше', async () => {
    const id = await request(1000);
    await mk(owner, `/documents/${id}/post`);
    expect((await mk(owner, `/payment-requests/${id}/state`, { state: 'approved' })).state).toBe('approved');
  });

  test('с маршрутом проведение запускает процесс, вручную не согласовать, итог ставит состояние; снятие с проведения отзывает процесс', async () => {
    const rid = (await mk(owner, '/approval-routes', { name: 'Заявки', documentType: 'payment_request', amountFrom: '50000', steps: [{ participants: [{ memberId: ids.boss }] }] })).id;
    const id = await request(60000);
    await mk(owner, `/documents/${id}/post`);
    const info = (await owner.get(`/approvals/by-object?targetKind=document&documentId=${id}`)).body;
    expect(info.current.state).toBe('in_progress');
    expect(info.canStart).toBe(false);
    expect((await owner.get(`/payment-requests/${id}`)).body.state).toBe('pending');
    const manual = await owner.post(`/payment-requests/${id}/state`, { state: 'approved' });
    expect(manual.status).toBe(422);
    expect(manual.body.error.code).toBe('approval_in_progress');
    // отправить заявку напрямую нельзя — только проведением
    expect((await start(owner, id)).body.error.code).toBe('approval_not_applicable');
    const t = await taskOf(info.current.id, ids.boss);
    await boss.post(`/approval-tasks/${t.id}/decide`, { decision: 'approve' });
    expect((await owner.get(`/payment-requests/${id}`)).body.state).toBe('approved');

    // отказ → rejected → снять с проведения → подать снова: круг 2
    const id2 = await request(70000);
    await mk(owner, `/documents/${id2}/post`);
    const a2 = (await owner.get(`/approvals/by-object?targetKind=document&documentId=${id2}`)).body.current;
    await boss.post(`/approval-tasks/${(await taskOf(a2.id, ids.boss)).id}/decide`, { decision: 'reject', comment: 'нет' });
    expect((await owner.get(`/payment-requests/${id2}`)).body.state).toBe('rejected');
    await mk(owner, `/documents/${id2}/unpost`);
    await mk(owner, `/documents/${id2}/post`);
    expect((await owner.get(`/approvals/by-object?targetKind=document&documentId=${id2}`)).body.current.round).toBe(2);

    // снятие с проведения идущего процесса отзывает его
    const id3 = await request(80000);
    await mk(owner, `/documents/${id3}/post`);
    const a3 = (await owner.get(`/approvals/by-object?targetKind=document&documentId=${id3}`)).body.current;
    await mk(owner, `/documents/${id3}/unpost`);
    expect((await owner.get(`/approvals/${a3.id}`)).body.state).toBe('cancelled');

    // подходит по условию суммы только от 50 000: дешёвая заявка идёт вручную
    const cheap = await request(1000);
    await mk(owner, `/documents/${cheap}/post`);
    expect((await mk(owner, `/payment-requests/${cheap}/state`, { state: 'approved' })).state).toBe('approved');
    await owner.del(`/approval-routes/${rid}`);
  });

  test('должность без держателей: проведение заявки отвечает 422 route_step_empty и откатывается', async () => {
    const pos = (await mk(owner, '/positions', { name: 'Казначей' })).id;
    const rid = (await mk(owner, '/approval-routes', { name: 'Пустая должность', documentType: 'payment_request', steps: [{ participants: [{ positionId: pos }] }] })).id;
    const id = await request(1234);
    const r = await owner.post(`/documents/${id}/post`);
    expect([r.status, r.body.error.code]).toEqual([422, 'route_step_empty']);
    expect((await owner.get(`/documents/${id}`)).body.status).toBe('draft');
    await owner.del(`/approval-routes/${rid}`);
  });
});

describe('модуль docflow', () => {
  test('без модуля пути закрыты, а обязательный маршрут ничего не блокирует', async () => {
    const c = new Client();
    await c.signup({ workspaceName: 'No docflow WS' });
    await admin`insert into workspace_licenses (workspace_id, plan_id) select ${c.workspaceId!}, id from license_plans where key = 'basic'`;
    const cust = (await mk(c, '/companies', { name: 'Покупатель' })).id;
    const svc = (await mk(c, '/products', { name: 'Услуга', kind: 'service', unitCode: '356', price: 1, vatRate: 'none' })).id;
    // маршрут, созданный раньше (модуль был включён), после отключения не блокирует
    const me = ((await c.get('/members')).body.items as any[])[0].id;
    await admin`insert into approval_routes (workspace_id, name, target_kind, document_type) values (${c.workspaceId!}, 'Старый', 'document', 'invoice')`;
    expect(me).toBeTruthy();
    const r = await c.get('/approvals');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('module_disabled');
    const doc = (await mk(c, '/documents', { type: 'invoice', counterpartyId: cust, lines: [{ productId: svc, qty: 1, price: 1 }] })).id;
    expect((await c.post(`/documents/${doc}/post`)).status).toBe(200);
  });
});
