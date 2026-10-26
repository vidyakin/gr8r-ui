/* Себестоимость работ заказ-наряда (задача 1096): ручной расчёт труда (ставка назначения и запасная из нормы, без участка —
   предупреждение), материалы и товары после выполнения, прочие затраты на основании заказ-наряда, косвенные после закрытия
   месяца, услуги без затрат, маскирование для member и отчёт за период. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin, drainJobs } from './helpers';

let owner: Client;
let adminUser: Client;
let member: Client;
let ws: string;
let warehouse: string;
let customer: string;
let memberId: string;
let centerA: string; // ставка 500
let centerB: string; // ставка 300 (запасной участок из нормы)
let workNorm: string; // работа с нормой 2 ч и участком B
let goodsG: string; // закупка по 100
let materialM: string; // закупка по 40
let serviceS: string;
let hoursItem: string; // статья затрат «по часам»
let plainItem: string; // статья без распределения (прочие затраты)
let wo: { id: string; lineWork: string };

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const costOf = async (id: string, c: Client = owner) => (await c.get(`/work-orders/${id}/cost`)).body as any;
const receive = async (productId: string, qty: number, price: number, date = '2026-08-10') => {
  const d = await mk(owner, '/documents', { type: 'receipt', counterpartyId: customer, warehouseId: warehouse, priceIncludesVat: false, date, lines: [{ productId, qty, price }] });
  const r = await owner.post(`/documents/${d.id}/post`);
  if (r.status !== 200) throw new Error(`receipt ${r.status} ${JSON.stringify(r.body)}`);
};
const logTime = async (taskId: string, hours: string) => {
  const r = await owner.post('/time-logs', { taskId, hours, logDate: '2026-09-10', memberId });
  if (r.status !== 201) throw new Error(`time-log ${r.status} ${JSON.stringify(r.body)}`);
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Себестоимость ЗН WS' });
  ws = owner.workspaceId!;
  const invite = async (role: string) => {
    const c = new Client();
    await c.signup();
    const inv = await owner.post(`/workspaces/${ws}/invites`, { email: c.user!.email, role });
    await c.post('/invites/accept', { token: inv.body.token });
    c.workspaceId = ws;
    return c;
  };
  adminUser = await invite('admin');
  member = await invite('member');
  memberId = ((await owner.get('/members')).body.items as any[]).find(m => m.email === member.user!.email)!.id;
  warehouse = (await owner.get('/warehouses')).body.items[0].id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Заказчик»', inn: '7728168971' })).id;
  centerA = (await mk(owner, '/work-centers', { name: 'Монтаж', hourlyRate: 500 })).id;
  centerB = (await mk(owner, '/work-centers', { name: 'Наладка', hourlyRate: 300 })).id;
  workNorm = (await mk(owner, '/products', { name: 'Монтаж с нормой', kind: 'work', unitCode: '356', price: 2000, vatRate: 'none' })).id;
  await owner.put(`/services/work-norms/${workNorm}`, { normHours: '2', workCenterId: centerB });
  goodsG = (await mk(owner, '/products', { name: 'Датчик', kind: 'goods', unitCode: '796', price: 200, purchasePrice: 100, vatRate: 'none' })).id;
  materialM = (await mk(owner, '/products', { name: 'Кабель', kind: 'goods', unitCode: '796', price: 60, purchasePrice: 40, vatRate: 'none' })).id;
  serviceS = (await mk(owner, '/products', { name: 'Консультация', kind: 'service', unitCode: '876', price: 400, vatRate: 'none' })).id;
  hoursItem = (await mk(owner, '/cost-items', { name: 'Электроэнергия по часам', kind: 'expense', distributionMethod: 'work_hours' })).id;
  plainItem = (await mk(owner, '/cost-items', { name: 'Субподряд', kind: 'expense', distributionMethod: 'none' })).id;
  await receive(goodsG, 20, 100);
  await receive(materialM, 10, 40);

  // заказ-наряд: работа 2 × 2000, товар 3 × 200, услуга 1 × 400; выручка без НДС 5000
  const doc = await mk(owner, '/documents', {
    type: 'work_order',
    counterpartyId: customer,
    warehouseId: warehouse,
    lines: [
      { productId: workNorm, qty: 2, price: 2000 },
      { productId: goodsG, qty: 3, price: 200 },
      { productId: serviceS, qty: 1, price: 400 },
    ],
  });
  const lines = (await owner.get(`/documents/${doc.id}`)).body.lines as any[];
  wo = { id: doc.id, lineWork: lines.find(l => l.productId === workNorm).id };
});

describe('labor and materials of one work order', () => {
  test('assignments: own center, center from the work norm, and none (warning)', async () => {
    // a1: участок назначения A, 4 ч плана; a2: участок из нормы (B), план 2 × 2 = 4 ч; a3: без строки и участка
    const a1 = await mk(owner, `/work-orders/${wo.id}/assignments`, { lineId: wo.lineWork, assigneeId: memberId, workCenterId: centerA, plannedHours: '4' });
    const a2 = await mk(owner, `/work-orders/${wo.id}/assignments`, { lineId: wo.lineWork, assigneeId: memberId });
    const a3 = await mk(owner, `/work-orders/${wo.id}/assignments`, { title: 'Разное', assigneeId: memberId, plannedHours: '1' });
    await logTime(a1.taskId, '5');
    await logTime(a2.taskId, '2');
    await logTime(a3.taskId, '1');
    expect((await owner.post(`/work-orders/${wo.id}/materials`, { materials: [{ productId: materialM, qty: 5 }] })).status).toBe(200);

    const c = await costOf(wo.id);
    expect(c.labor.plan).toBe('3200.00'); // 4×500 + 4×300
    expect(c.labor.fact).toBe('3100.00'); // 5×500 + 2×300
    expect(c.labor.plannedHours).toBe('9.000');
    expect(c.labor.actualHours).toBe('8.000');
    expect(c.labor.rows.find((r: any) => r.workCenterId === centerB)).toMatchObject({ rate: '300.00', plannedHours: '4.000', factAmount: '600.00' });
    expect(c.warnings).toEqual([expect.objectContaining({ kind: 'no_work_center', plannedHours: '1.000', actualHours: '1.000' })]);
  });

  test('before completion materials and goods are estimated by the average cost', async () => {
    const c = await costOf(wo.id);
    expect(c.estimated).toBe(true);
    expect(c.materials).toMatchObject({ plan: '200.00', fact: '200.00', estimated: true }); // 5 × 40
    expect(c.goods).toMatchObject({ plan: '300.00', fact: '300.00', estimated: true }); // 3 × 100
    expect(c.revenue).toBe('5000.00');
    expect(c.cost).toEqual({ plan: '3700.00', fact: '3600.00' });
    expect(c.margin).toEqual({ plan: '1300.00', fact: '1400.00' });
    expect(c.marginPct).toEqual({ plan: '26.00', fact: '28.00' });
  });

  test('after completion the fact comes from the stock moves of the work order', async () => {
    // средняя кабеля меняется: 10 по 40 + 10 по 60 → 50; списание пойдёт по 50
    await receive(materialM, 10, 60);
    const done = await owner.post(`/documents/${wo.id}/state`, { state: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('posted');
    const c = await costOf(wo.id);
    expect(c.estimated).toBe(false);
    expect(c.materials.fact).toBe('250.00'); // 5 × 50
    expect(c.goods.fact).toBe('300.00');
    expect(c.cost.fact).toBe('3650.00');
    expect(c.margin.fact).toBe('1350.00');
    expect(c.marginPct.fact).toBe('27.00');
  });

  test('a service-only work order has no costs: the whole revenue is margin', async () => {
    const d = await mk(owner, '/documents', { type: 'work_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId: serviceS, qty: 1, price: 700 }] });
    expect((await owner.post(`/documents/${d.id}/state`, { state: 'done' })).status).toBe(200);
    const c = await costOf(d.id);
    expect(c.cost).toEqual({ plan: '0.00', fact: '0.00' });
    expect(c.margin.fact).toBe('700.00');
    expect(c.marginPct.fact).toBe('100.00');
  });
});

describe('other costs on the basis of a work order', () => {
  test('lines with a work order are direct costs and stay out of the indirect pool', async () => {
    const own = await mk(owner, '/other-costs', { date: '2026-11-05', workOrderId: wo.id, lines: [{ costItemId: plainItem, amount: '100' }] });
    expect((await owner.post(`/other-costs/${own.id}/post`)).status).toBe(200);
    // на основании заказ-наряда: черновик с заказ-нарядом в шапке, строки добавляет пользователь
    const based = await owner.post(`/documents/${wo.id}/based-on`, { type: 'other_costs' });
    expect(based.status).toBe(201);
    const draft = (await owner.get(`/other-costs/${based.body.id}`)).body;
    expect(draft.workOrder.id).toBe(wo.id);
    const saved = await owner.patch(`/other-costs/${based.body.id}`, { date: '2026-11-06', lines: [{ costItemId: plainItem, amount: '50' }] });
    expect(saved.status).toBe(200);
    expect(saved.body.lines[0].workOrderId).toBe(wo.id);
    expect((await owner.post(`/other-costs/${based.body.id}/post`)).status).toBe(200);
    // обычная прочая затрата без заказ-наряда идёт в пул месяца
    const plain = await mk(owner, '/other-costs', { date: '2026-11-07', lines: [{ costItemId: plainItem, amount: '200' }] });
    await owner.post(`/other-costs/${plain.id}/post`);

    const c = await costOf(wo.id);
    expect(c.other).toEqual({ plan: '150.00', fact: '150.00' });
    expect(c.cost.fact).toBe('3800.00');
    expect(c.margin.fact).toBe('1200.00');
    expect((await owner.get('/production/periods/2026-11/preview')).body.total).toBe('200.00');
  });

  test('a document cannot point at a document that is not a work order', async () => {
    const r = await owner.post('/other-costs', { date: '2026-11-08', lines: [{ costItemId: plainItem, amount: '10', workOrderId: customer }] });
    expect(r.status).toBe(422);
  });
});

describe('indirect costs after the month closing', () => {
  test('the work order done in the month gets the share of its center and loses it on reopen', async () => {
    // выполнен в сентябре
    await admin`update documents set posted_at = '2026-09-15T10:00:00Z' where id = ${wo.id}`;
    // косвенные 800 участка A по часам: других получателей нет — вся сумма заказ-наряду
    const sv = await mk(owner, '/documents', { type: 'receipt', counterpartyId: customer, warehouseId: warehouse, date: '2026-09-20', lines: [{ productId: serviceS, qty: 1, price: 800, costItemId: hoursItem, workCenterId: centerA }] });
    await owner.post(`/documents/${sv.id}/post`);
    expect((await owner.post('/production/periods/2026-09/close')).status).toBe(202);
    await drainJobs();
    const closing = ((await owner.get('/production/periods')).body.items as any[]).find(i => i.month === '2026-09');
    expect(closing.status).toBe('done');
    expect(closing.totals.undistributed).toBe('0.00');
    // получатель — пара «заказ-наряд × участок труда»: A (5 ч) получает всё, B (2 ч) — ничего, статья привязана к A
    const shares = closing.totals.byWorkOrder as any[];
    expect(shares).toHaveLength(2);
    expect(shares.find(w => w.workCenterId === centerA)).toMatchObject({ documentId: wo.id, hours: '5.000', directCost: '3000.00', allocated: '800.00' }); // 2500 труда + 700 × 5/7
    expect(shares.find(w => w.workCenterId === centerB)).toMatchObject({ hours: '2.000', allocated: '0.00' });

    const c = await costOf(wo.id);
    expect(c.indirect.fact).toBe('800.00');
    expect(c.indirectMonths).toEqual(['2026-09']);
    expect(c.cost.fact).toBe('4600.00'); // 3100 + 250 + 300 + 150 + 800
    expect(c.margin.fact).toBe('400.00');
    expect(c.marginPct.fact).toBe('8.00');

    // отмена закрытия снимает долю, повторное закрытие возвращает
    expect((await owner.post('/production/periods/2026-09/reopen')).status).toBeLessThan(300);
    await drainJobs();
    expect((await costOf(wo.id)).indirect.fact).toBe('0.00');
    await owner.post('/production/periods/2026-09/close');
    await drainJobs();
    expect((await costOf(wo.id)).indirect.fact).toBe('800.00');
  });
});

describe('visibility and the report', () => {
  test('member gets 403 and no cost in the journal; admin sees both', async () => {
    const r = await costOf(wo.id, member);
    expect(r.error.code).toBe('cost_access_required');
    const journal = (await member.get('/work-orders')).body.items as any[];
    expect(journal.length).toBeGreaterThan(0);
    expect(journal.every(i => i.cost === null && i.margin === null)).toBe(true);
    const a = (await adminUser.get('/work-orders')).body.items as any[];
    const row = a.find(i => i.id === wo.id);
    expect(row).toMatchObject({ cost: '4600.00', margin: '400.00', marginPct: '8.00', costBasis: 'fact' });
    expect((await adminUser.get(`/work-orders/${wo.id}/cost`)).status).toBe(200);
    const rep = await member.get('/production/reports/work-order-cost?from=2026-09-01&to=2026-09-30');
    expect(rep.status).toBe(403);
  });

  test('the report lists the work orders done in the period by kind of cost', async () => {
    const r = (await owner.get('/production/reports/work-order-cost?from=2026-09-01&to=2026-09-30')).body;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ documentId: wo.id, counterpartyName: 'ООО «Заказчик»', doneDate: '2026-09-15', revenue: '5000.00', labor: '3100.00', materials: '250.00', goods: '300.00', other: '150.00', indirect: '800.00', cost: '4600.00', margin: '400.00', marginPct: '8.00' });
    expect(r.totals).toMatchObject({ revenue: '5000.00', cost: '4600.00', margin: '400.00', marginPct: '8.00' });
    const empty = (await owner.get('/production/reports/work-order-cost?from=2026-01-01&to=2026-01-31')).body;
    expect(empty.rows).toHaveLength(0);
    expect(empty.totals.marginPct).toBeNull();
  });
});
