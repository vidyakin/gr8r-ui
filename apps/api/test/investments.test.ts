/* Инвестпроекты: факт из проведённых документов без двойного счёта (поле документа важнее статьи проекта),
   маскирование сумм для member, жизненный цикл (черновик → утверждён → закрыт) и изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let service: string;
let supplier: string;
let customer: string;
let equipment: string; // статья «Оборудование»
let mounting: string; // статья «Монтаж» — закреплена за проектом
let revenue: string; // статья доходов «Выручка цеха»
let projectId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

/** Проведённое поступление услуги со статьёй строки (и полем «Инвестпроект», если задано) */
async function receipt(amount: string, date: string, costItemId: string, investmentProjectId: string | null = null) {
  const doc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, date, investmentProjectId, lines: [{ productId: service, qty: 1, price: amount, vatRate: 'none', costItemId }] });
  const r = await owner.post(`/documents/${doc.id}/post`);
  if (r.status >= 300) throw new Error(`post: ${r.status} ${JSON.stringify(r.body)}`);
  return doc;
}

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Investments WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other investments WS' });

  service = (await mk(owner, '/products', { name: 'Монтаж оборудования', kind: 'service', price: 0, vatRate: 'none' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Подрядчик»' })).id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Заказчик»' })).id;
  equipment = (await mk(owner, '/cost-items', { name: 'Оборудование', kind: 'expense' })).id;
  mounting = (await mk(owner, '/cost-items', { name: 'Монтаж', kind: 'expense' })).id;
  revenue = (await mk(owner, '/cost-items', { name: 'Выручка цеха', kind: 'income' })).id;

  const p = await mk(owner, '/investments', {
    name: 'Новый участок окраски',
    periodKind: 'quarter',
    startDate: '2026-01-15',
    periods: 8,
    discountRate: '12',
    costItemIds: [mounting],
    lines: [
      { periodIndex: 0, costItemId: equipment, amount: '1000' },
      { periodIndex: 1, costItemId: mounting, amount: '200' },
      ...[2, 3, 4, 5, 6, 7].map(i => ({ periodIndex: i, costItemId: revenue, amount: '300' })),
    ],
  });
  projectId = p.id;
});

describe('investment project card', () => {
  test('start date is normalised to the period start; plan metrics are computed', async () => {
    const d = (await owner.get(`/investments/${projectId}`)).body;
    expect(d.startDate).toBe('2026-01-01');
    expect(d.periodList[1]).toMatchObject({ label: '2026 Q2', start: '2026-04-01' });
    expect(d.plan.metrics).toMatchObject({ totalOutflow: '1200.00', totalInflow: '1800.00', net: '600.00', payback: '5.00' });
    expect(Number(d.plan.metrics.npv)).toBeGreaterThan(0);
    expect(Number(d.plan.metrics.irr)).toBeGreaterThan(12);
  });

  test('a cost item can be linked to one project only', async () => {
    const r = await owner.post('/investments', { name: 'Другой проект', startDate: '2026-01-01', periods: 4, costItemIds: [mounting] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('cost_item_taken');
  });
});

describe('fact', () => {
  test('a document with the field and a document by a linked cost item each count exactly once', async () => {
    const other = await mk(owner, '/investments', { name: 'Склад готовой продукции', startDate: '2026-01-01', periods: 4 });
    await receipt('1000', '2026-02-10', equipment, projectId); // поле → вложение, период 0
    await receipt('200', '2026-04-05', mounting); // статья проекта → период 1
    await receipt('50', '2026-05-20', mounting, projectId); // поле и статья одновременно — только один раз
    await receipt('70', '2026-05-21', mounting, other.id); // поле другого проекта — не наш, хотя статья наша
    await receipt('999', '2026-05-22', equipment); // статья не закреплена, поля нет — не учитывается
    const act = await mk(owner, '/documents', { type: 'act', counterpartyId: customer, date: '2026-07-01', investmentProjectId: projectId, lines: [{ productId: service, qty: 1, price: '500', vatRate: 'none' }] });
    expect((await owner.post(`/documents/${act.id}/post`)).status).toBe(200);

    const d = (await owner.get(`/investments/${projectId}`)).body;
    expect(d.fact.metrics).toMatchObject({ totalOutflow: '1250.00', totalInflow: '500.00' });
    expect(d.fact.cashflow.slice(0, 3).map((r: any) => [r.outflow, r.inflow])).toEqual([
      ['1000.00', '0.00'],
      ['250.00', '0.00'],
      ['0.00', '500.00'],
    ]);
    expect(d.factDocuments).toBe(4);

    const pf = (await owner.get(`/investments/${projectId}/plan-fact`)).body;
    const m = pf.rows.find((r: any) => r.costItemId === mounting);
    expect(m).toMatchObject({ direction: 'out', planTotal: '200.00', factTotal: '250.00', deviation: '50.00' });
    expect(pf.documents.map((x: any) => x.via).sort()).toEqual(['cost_item', 'field', 'field', 'field']);
    // строка акта без статьи относится к единственной доходной статье проекта
    expect(pf.rows.find((r: any) => r.direction === 'in')).toMatchObject({ costItemId: revenue, planTotal: '1800.00', factTotal: '500.00', deviation: '-1300.00' });
    expect(pf.rows.some((r: any) => r.costItemId === null)).toBe(false);
    // проект с полем «чужого» документа получил его
    expect((await owner.get(`/investments/${other.id}`)).body.fact.metrics.totalOutflow).toBe('70.00');
  });

  test('a document of a type without investment fact rejects the field', async () => {
    const r = await owner.post('/documents', { type: 'quote', counterpartyId: customer, investmentProjectId: projectId });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('investment_not_applicable');
  });
});

describe('rights', () => {
  test('member sees the project but no amounts or metrics', async () => {
    const d = (await member.get(`/investments/${projectId}`)).body;
    expect(d.name).toBe('Новый участок окраски');
    expect(d.discountRate).toBeNull();
    expect(d.lines.every((l: any) => l.amount === null)).toBe(true);
    expect(d.plan.metrics).toBeNull();
    expect(d.fact.cashflow[0]).toEqual({ index: 0 });
    const list = (await member.get('/investments')).body;
    expect(list.items.find((x: any) => x.id === projectId).plan).toBeNull();
    const pf = (await member.get(`/investments/${projectId}/plan-fact`)).body;
    expect(pf.rows.every((r: any) => r.planTotal === null && r.fact === null)).toBe(true);
    expect(pf.documents.every((x: any) => x.amount === null)).toBe(true);
  });

  test('member cannot create or edit a project, but can pick it for a document', async () => {
    expect((await member.post('/investments', { name: 'X', startDate: '2026-01-01', periods: 1 })).status).toBe(403);
    expect((await member.patch(`/investments/${projectId}`, { name: 'X' })).status).toBe(403);
    expect((await member.get('/investments/options')).body.items.some((x: any) => x.id === projectId)).toBe(true);
  });

  test('another workspace does not see the project', async () => {
    expect((await other.get(`/investments/${projectId}`)).status).toBe(404);
  });
});

describe('lifecycle', () => {
  test('approved plan is frozen, closed project takes no documents', async () => {
    // черновик, привязанный до закрытия проекта
    const draft = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, date: '2026-08-01', investmentProjectId: projectId, lines: [{ productId: service, qty: 1, price: '10', vatRate: 'none', costItemId: equipment }] });
    expect((await owner.post(`/investments/${projectId}/status`, { action: 'approve' })).body.status).toBe('approved');
    const edit = await owner.patch(`/investments/${projectId}`, { discountRate: '15' });
    expect(edit.status).toBe(422);
    expect(edit.body.error.code).toBe('investment_not_draft');
    // статьи и ссылки утверждённого проекта править можно
    expect((await owner.patch(`/investments/${projectId}`, { comment: 'Согласовано' })).status).toBe(200);
    expect((await owner.post(`/investments/${projectId}/status`, { action: 'close' })).body.status).toBe('closed');
    const r = await owner.post('/documents', { type: 'receipt', counterpartyId: supplier, investmentProjectId: projectId });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('investment_closed');
    // привязанный черновик правится (поле не меняется), но не проводится
    expect((await owner.patch(`/documents/${draft.id}`, { comment: 'Правка после закрытия', investmentProjectId: projectId })).status).toBe(200);
    const post = await owner.post(`/documents/${draft.id}/post`);
    expect(post.status).toBe(422);
    expect(post.body.error.code).toBe('investment_closed');
    // по статье закрытого проекта новые документы не попадают
    const before = (await owner.get(`/investments/${projectId}`)).body.fact.metrics.totalOutflow;
    await receipt('30', '2026-09-01', mounting);
    expect((await owner.get(`/investments/${projectId}`)).body.fact.metrics.totalOutflow).toBe(before);
    expect((await owner.get('/investments/options')).body.items.some((x: any) => x.id === projectId)).toBe(false);
    expect((await owner.post(`/investments/${projectId}/status`, { action: 'reopen' })).body.status).toBe('approved');
  });
});
