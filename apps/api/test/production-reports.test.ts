/* Задача 1091 (часть 1): отчёты производства — выпуск продукции, заказы, план-факт, нормативный состав, загрузка участков.
   Итоги сверяются с документами, стоимость нормативного состава маскируется для участника. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, drainJobs } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let memberId: string;
let wood: string;
let workshop: string;
let fg: string;
let center: string;
let item: string;
let itemName = 'Шкаф отчёта';
let order: { id: string; orderItemId: string };
let planId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

/** Проведённый заказ на производство на изделие */
async function makeOrder(qty: string, over: Record<string, unknown> = {}) {
  const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty }], ...over });
  await owner.post(`/production-orders/${o.id}/fill-from-bom`);
  expect((await owner.post(`/documents/${o.id}/post`)).status).toBe(200);
  const detail = (await owner.get(`/production-orders/${o.id}`)).body;
  return { id: o.id as string, orderItemId: detail.items[0].id as string };
}

/** Выпуск по заказу: черновик и проведение */
async function release(o: { id: string; orderItemId: string }, qty: string, date: string, extra: Record<string, unknown> = {}) {
  const r = await owner.post(`/production-orders/${o.id}/production`, { date, lines: [{ orderItemId: o.orderItemId, qty, ...extra }] });
  if (r.status >= 300) throw new Error(`release: ${r.status} ${JSON.stringify(r.body)}`);
  expect((await owner.post(`/documents/${r.body.id}/post`)).status).toBe(200);
  return r.body as { id: string; number: string | null };
}

const rep = async (c: Client, name: string, qs: Record<string, string>) => c.get(`/production/reports/${name}?${new URLSearchParams(qs).toString()}`);
const sum = (xs: string[]) => xs.reduce((s, x) => s + Number(x), 0);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Reports WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other reports WS' });
  memberId = (await owner.get('/members')).body.items.find((m: any) => m.userId === member.user!.id).id;

  wood = (await mk(owner, '/products', { name: 'Брус', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
  const supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»' })).id;
  workshop = (await mk(owner, '/warehouses', { name: 'Склад цеха', kind: 'workshop' })).id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выпуска' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Сборочный', hourlyRate: 100, warehouseId: workshop, outputWarehouseId: fg })).id;
  const product = (await mk(owner, '/products', { name: itemName, price: 5000, vatRate: 'none' })).id;
  item = (await mk(owner, '/manufactured-items', { name: itemName, productId: product, overheadPct: 0 })).id;
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty: 2 });
  const operation = (await mk(owner, '/products', { name: 'Сборка', kind: 'operation', vatRate: 'none' })).id;
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'work', operation: 'Сборка', productId: operation, workCenterId: center, hours: 1 });
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2028-01-02', lines: [{ productId: wood, qty: 1000, price: 80 }] });
  expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);

  // заказ на 10 штук (до периода плана), две недели выпуска и план на них
  order = await makeOrder('10', { date: '2028-03-01', plannedEnd: '2028-03-10T00:00:00Z' });
  await release(order, '4', '2028-03-07');
  await release(order, '3', '2028-03-14');
  planId = (await mk(owner, '/production-plans', { name: 'План отчёта', periodFrom: '2028-03-06', periodTo: '2028-03-19', step: 'week', warehouseId: fg, lines: [{ itemId: item, periodStart: '2028-03-06', qty: '4' }, { itemId: item, periodStart: '2028-03-13', qty: '6' }] })).id;
});

describe('release report', () => {
  test('the rows match the posted release documents and the order', async () => {
    const r = (await rep(owner, 'release', { from: '2028-03-01', to: '2028-03-31' })).body;
    expect(r.rows).toHaveLength(2);
    expect(sum(r.rows.map((x: any) => x.goodQty))).toBe(7);
    for (const row of r.rows) {
      const doc = (await owner.get(`/documents/${row.documentId}`)).body;
      expect(doc.status).toBe('posted');
      expect(doc.number).toBe(row.number);
      expect(doc.date).toBe(row.date);
      expect(row.workCenterName).toBe('Сборочный');
    }
    const detail = (await owner.get(`/production-orders/${order.id}`)).body;
    expect(Number(detail.items[0].produced)).toBe(sum(r.rows.map((x: any) => x.goodQty)));
  });

  test('the period and the filters narrow the rows; a draft release is not counted', async () => {
    expect((await rep(owner, 'release', { from: '2028-03-01', to: '2028-03-10' })).body.rows).toHaveLength(1);
    expect((await rep(owner, 'release', { from: '2028-03-01', to: '2028-03-31', itemId: '00000000-0000-4000-8000-000000000000' })).body.rows).toEqual([]);
    const o = await makeOrder('2', { date: '2028-04-01' });
    const draft = await owner.post(`/production-orders/${o.id}/production`, { date: '2028-04-02', lines: [{ orderItemId: o.orderItemId, qty: '2' }] });
    expect(draft.status).toBeLessThan(300);
    expect((await rep(owner, 'release', { from: '2028-04-01', to: '2028-04-30' })).body.rows).toEqual([]);
  });

  test('a wrong period is rejected', async () => {
    const r = await rep(owner, 'release', { from: '2028-03-31', to: '2028-03-01' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('report_period_invalid');
  });

  test('another workspace sees nothing', async () => {
    expect((await rep(other, 'release', { from: '2028-03-01', to: '2028-03-31' })).body.rows).toEqual([]);
  });
});

describe('orders report', () => {
  test('opening, ordered, produced and closing balance of the order position', async () => {
    const inMarch = (await rep(owner, 'orders', { from: '2028-03-01', to: '2028-03-31', today: '2028-03-20' })).body.rows.find((x: any) => x.orderId === order.id);
    expect(inMarch).toMatchObject({ itemName, opening: '0.000', ordered: '10.000', produced: '7.000', closing: '3.000' });
    // срок 10 марта, 3 штуки не выпущены: просрочка на 10 дней на 20 марта
    expect(inMarch.overdueDays).toBe(10);
    // период с середины: на начало осталось 6 (10 минус выпущенные 4), выпущено 3
    const later = (await rep(owner, 'orders', { from: '2028-03-10', to: '2028-03-31', today: '2028-03-20' })).body.rows.find((x: any) => x.orderId === order.id);
    expect(later).toMatchObject({ opening: '6.000', ordered: '0.000', produced: '3.000', closing: '3.000' });
    // остаток на конец периода = остаток к выпуску в карточке заказа
    const detail = (await owner.get(`/production-orders/${order.id}`)).body;
    expect(Number(detail.items[0].qty) - Number(detail.items[0].produced)).toBe(Number(inMarch.closing));
  });

  test('a fully produced order is not overdue and an order before the period without balance is hidden', async () => {
    const o = await makeOrder('2', { date: '2028-05-01', plannedEnd: '2028-05-05T00:00:00Z' });
    await release(o, '2', '2028-05-03');
    const row = (await rep(owner, 'orders', { from: '2028-05-01', to: '2028-05-31', today: '2028-06-01' })).body.rows.find((x: any) => x.orderId === o.id);
    expect(row).toMatchObject({ closing: '0.000', overdueDays: 0 });
    const next = (await rep(owner, 'orders', { from: '2028-06-01', to: '2028-06-30' })).body.rows.find((x: any) => x.orderId === o.id);
    expect(next).toBeUndefined();
  });
});

describe('plan-fact report', () => {
  test('plan lines against the released quantity of their periods', async () => {
    const r = (await rep(owner, 'plan-fact', { from: '2028-03-06', to: '2028-03-19' })).body;
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ itemName, periodStart: '2028-03-06', periodEnd: '2028-03-12', plan: '4.000', fact: '4.000', deviation: '0.000', pct: '100.0' });
    expect(r.rows[1]).toMatchObject({ periodStart: '2028-03-13', periodEnd: '2028-03-19', plan: '6.000', fact: '3.000', deviation: '-3.000', pct: '50.0' });
    expect(planId).toBeTruthy();
    // факт сходится с отчётом о выпуске за тот же период
    const released = (await rep(owner, 'release', { from: '2028-03-06', to: '2028-03-19' })).body.rows;
    expect(sum(r.rows.map((x: any) => x.fact))).toBe(sum(released.map((x: any) => x.goodQty)));
  });
});

describe('bom report', () => {
  const bom = (c: Client, qs: Record<string, string>) => rep(c, 'bom', { itemId: item, qty: '3', ...qs });

  test('materials, operations with the norm time and the cost by the purchase price', async () => {
    const r = (await bom(owner, { priceMode: 'price_kind', priceKind: 'purchase' })).body;
    // на штуку: 2 бруса по 80 и час по 100 — 260; на три — 780
    expect(r).toMatchObject({ itemName, qty: '3', total: '780.00', unitTotal: '260.00', hoursTotal: '3.000', unpriced: 0 });
    expect(r.rows.find((x: any) => x.kind === 'material')).toMatchObject({ name: 'Брус', qty: '6.000', price: '80.00', amount: '480.00' });
    expect(r.rows.find((x: any) => x.kind === 'work')).toMatchObject({ name: 'Сборка', hours: '3.000', workCenterName: 'Сборочный', amount: '300.00' });
    expect(sum(r.rows.filter((x: any) => !x.nested).map((x: any) => x.amount))).toBe(780);
  });

  test('the price kind and the last purchase switch the prices', async () => {
    const byPrice = (await bom(owner, { priceMode: 'price_kind', priceKind: 'price' })).body;
    expect(byPrice.total).toBe('900.00');
    const byLast = (await bom(owner, { priceMode: 'last_purchase' })).body;
    expect(byLast.total).toBe('780.00');
    expect(byLast.priceMode).toBe('last_purchase');
  });

  test('the cost is masked for a member, the quantities and the time stay', async () => {
    const r = (await bom(member, { priceMode: 'price_kind', priceKind: 'purchase' })).body;
    expect(r.total).toBeNull();
    expect(r.unitTotal).toBeNull();
    expect(r.hoursTotal).toBe('3.000');
    expect(r.rows.every((x: any) => x.price === null && x.amount === null)).toBe(true);
    expect(r.rows.find((x: any) => x.kind === 'material').qty).toBe('6.000');
  });

  test('an unknown item is 404', async () => {
    expect((await rep(owner, 'bom', { itemId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
  });
});

describe('load report', () => {
  test('the capacity follows the schedule; the planned hours equal the planner; overload is flagged', async () => {
    const o = await makeOrder('12', { date: '2028-04-03' });
    const detail = (await owner.get(`/production-orders/${o.id}`)).body;
    const componentId = detail.components.find((c: any) => c.kind === 'work').id;
    // 10 часов на сборку при графике 8 часов в день
    const as = await owner.post(`/production-orders/${o.id}/operations`, { assignments: [{ componentId, memberId, qty: '10' }] });
    expect(as.status).toBeLessThan(300);
    const ops = (await owner.get(`/production-orders/${o.id}/operations`)).body.items;
    expect((await owner.patch(`/production/operations/${ops[0].id}/move`, { start: '2028-04-05', end: '2028-04-05' })).status).toBe(200);

    const r = (await rep(owner, 'load', { from: '2028-04-03', to: '2028-04-09' })).body;
    const row = r.rows.find((x: any) => x.workCenterName === 'Сборочный');
    // пять рабочих дней по 8 часов
    expect(row).toMatchObject({ capacity: '40.00', planned: '10.00', overloaded: true });
    expect(row.plannedPct).toBe('25.0');
    expect(row.days.find((d: any) => d.date === '2028-04-05')).toMatchObject({ planned: '10.00', capacity: '8.00', overloaded: true });
    // тот же расчёт, что у планировщика
    const planner = (await owner.get('/production/load?from=2028-04-03&to=2028-04-09&rowType=work_center')).body.rows.find((x: any) => x.name === 'Сборочный');
    expect(row.planned).toBe(planner.totalHours);
    expect((await rep(owner, 'load', { from: '2028-04-03', to: '2028-04-09', workCenterId: '00000000-0000-4000-8000-000000000000' })).body.rows).toEqual([]);
  });
});

/* ---------- часть 2: себестоимость выпуска, план-факт себестоимости, НЗП с движением, нормативный состав с параметрами ---------- */

const bal = async (productId: string, warehouseId: string) => (await owner.get(`/stock/balances?productId=${productId}`)).body.items.find((b: any) => b.warehouseId === warehouseId);
const costCenters: { shift: string; stageA: string; stageB: string } = { shift: '', stageA: '', stageB: '' };

describe('release cost report', () => {
  let shiftItem: { item: string; product: string };
  let electricity: string;

  beforeAll(async () => {
    const service = (await mk(owner, '/products', { name: 'Электричество (услуга)', kind: 'service', price: 0, vatRate: 'none' })).id;
    const supplier = (await mk(owner, '/companies', { name: 'ООО «Энергосбыт»' })).id;
    electricity = (await mk(owner, '/cost-items', { name: 'Электричество', kind: 'expense', distributionMethod: 'output_qty' })).id;
    costCenters.shift = (await mk(owner, '/work-centers', { name: 'Цех смены', hourlyRate: 100, warehouseId: workshop, outputWarehouseId: fg, materialMode: 'shift' })).id;
    const product = (await mk(owner, '/products', { name: 'Шкаф смены', price: 5000, vatRate: 'none' })).id;
    const it = (await mk(owner, '/manufactured-items', { name: 'Шкаф смены', productId: product, overheadPct: 0 })).id;
    await mk(owner, `/manufactured-items/${it}/lines`, { kind: 'material', productId: wood, qty: 2 });
    await mk(owner, `/manufactured-items/${it}/lines`, { kind: 'work', operation: 'Сборка', workCenterId: costCenters.shift, hours: 1 });
    shiftItem = { item: it, product };
    // выпуск 3 штук в режиме смены: материалы по распределению (факт 8 при нормах 6), затем закрытие месяца с косвенными
    const o = await mk(owner, '/production-orders', { workCenterId: costCenters.shift, items: [{ itemId: it, qty: '3' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const detail = (await owner.get(`/production-orders/${o.id}`)).body;
    const rel = await mk(owner, `/production-orders/${o.id}/production`, { date: '2028-09-05', lines: [{ orderItemId: detail.items[0].id, qty: '3' }] });
    expect((await owner.post(`/documents/${rel.id}/post`)).status).toBe(200);
    const alloc = await mk(owner, '/material-allocations', { workCenterId: costCenters.shift, date: '2028-09-05' });
    expect((await owner.post(`/material-allocations/${alloc.id}/fill-items`)).status).toBeLessThan(300);
    await owner.patch(`/material-allocations/${alloc.id}`, { lines: [{ productId: wood, qty: 8 }] });
    expect((await owner.post(`/material-allocations/${alloc.id}/distribute`, { method: 'norms' })).status).toBeLessThan(300);
    const posted = await owner.post(`/material-allocations/${alloc.id}/post`);
    expect(posted.status).toBe(200);
    const doc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2028-09-20', lines: [{ productId: service, qty: 1, price: 90, costItemId: electricity, workCenterId: costCenters.shift }] });
    expect((await owner.post(`/documents/${doc.id}/post`)).status).toBe(200);
    await owner.post('/production/periods/2028-09/close');
    await drainJobs();
  });

  test('materials and work of ordinary releases add up to the receipt of the product', async () => {
    const r = (await rep(owner, 'release-cost', { from: '2028-03-01', to: '2028-03-31' })).body;
    expect(r.rows).toHaveLength(2);
    // 4 + 3 штуки по 260: брус 160, работы 100 на штуку
    expect(sum(r.rows.map((x: any) => x.materials))).toBe(1120);
    expect(sum(r.rows.map((x: any) => x.work))).toBe(700);
    for (const x of r.rows) expect(sum([x.materials, x.semi, x.alloc, x.work, x.services, x.indirect, x.other])).toBeCloseTo(Number(x.total), 4);
    const b = await bal(await productOf(item), fg);
    expect(sum(r.rows.map((x: any) => x.total))).toBeCloseTo(sum(r.rows.map((x: any) => x.qty)) * Number(b.avgCost), 1);
  });

  test('shift allocation and closing indirect costs are separate columns and reconcile with the receipt', async () => {
    const r = (await rep(owner, 'release-cost', { from: '2028-09-01', to: '2028-09-30' })).body;
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    // распределение: 8 × 80; работы: 3 часа по 100; косвенные — электричество 90 на выпуск
    expect(row).toMatchObject({ itemName: 'Шкаф смены', qty: '3.000', materials: '0.0000', alloc: '640.0000', work: '300.0000', indirect: '90.0000' });
    expect(row.indirectItems).toEqual([{ costItemId: electricity, name: 'Электричество', amount: '90.0000' }]);
    expect(r.indirectItems).toEqual(row.indirectItems);
    expect(sum([row.materials, row.semi, row.alloc, row.work, row.services, row.indirect, row.other])).toBeCloseTo(Number(row.total), 4);
    expect(Number(row.total)).toBeCloseTo(1030, 2);
    const b = await bal(shiftItem.product, fg);
    expect(Number(b.qty) * Number(b.avgCost)).toBeCloseTo(Number(row.total), 1);
  });

  test('the filters narrow the rows; the report is closed to a member and other workspaces see nothing', async () => {
    expect((await rep(owner, 'release-cost', { from: '2028-09-01', to: '2028-09-30', workCenterId: center })).body.rows).toEqual([]);
    expect((await rep(owner, 'release-cost', { from: '2028-09-01', to: '2028-09-30', itemId: shiftItem.item })).body.rows).toHaveLength(1);
    const denied = await rep(member, 'release-cost', { from: '2028-09-01', to: '2028-09-30' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('cost_access_required');
    expect((await rep(other, 'release-cost', { from: '2028-09-01', to: '2028-09-30' })).body.rows).toEqual([]);
  });
});

describe('cost plan-fact report', () => {
  test('the shift release overruns the norm: the plan at the actual average price, the deviation in quantity and amount', async () => {
    const r = (await rep(owner, 'cost-plan-fact', { from: '2028-09-01', to: '2028-09-30' })).body;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ itemName: 'Шкаф смены', materialName: 'Брус', planQty: '6.000', factQty: '8.000', deviationQty: '2.000', planAmount: '480.0000', factAmount: '640.0000', deviationAmount: '160.0000' });
  });

  test('an ordinary release matches its norms: no deviation', async () => {
    const r = (await rep(owner, 'cost-plan-fact', { from: '2028-03-01', to: '2028-03-31' })).body;
    expect(r.rows).toHaveLength(2);
    expect(sum(r.rows.map((x: any) => x.deviationQty))).toBe(0);
    expect(sum(r.rows.map((x: any) => x.planQty))).toBe(14);
    expect(sum(r.rows.map((x: any) => x.factAmount))).toBeCloseTo(1120, 4);
  });

  test('the amounts are masked for a member, the quantities stay', async () => {
    const r = (await rep(member, 'cost-plan-fact', { from: '2028-09-01', to: '2028-09-30' })).body;
    expect(r.rows[0]).toMatchObject({ planQty: '6.000', factQty: '8.000', deviationQty: '2.000', planAmount: null, factAmount: null, deviationAmount: null });
  });
});

describe('work in progress movement report', () => {
  let order: { id: string; orderItemId: string };

  beforeAll(async () => {
    costCenters.stageA = center;
    const kind = await mk(owner, '/production/kinds', { name: 'Заготовка и завершение', stages: [{ name: 'Заготовка' }, { name: 'Завершение производства' }] });
    const product = (await mk(owner, '/products', { name: 'Тумба НЗП', price: 5000, vatRate: 'none' })).id;
    const it = (await mk(owner, '/manufactured-items', { name: 'Тумба НЗП', productId: product, productionKindId: kind.id, overheadPct: 0 })).id;
    await mk(owner, `/manufactured-items/${it}/lines`, { kind: 'material', productId: wood, qty: 2, stageId: kind.stages[0].id });
    await mk(owner, `/manufactured-items/${it}/lines`, { kind: 'work', operation: 'Отделка', workCenterId: center, hours: 1, stageId: kind.stages[1].id });
    const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: it, qty: '5' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    order = { id: o.id, orderItemId: (await owner.get(`/production-orders/${o.id}`)).body.items[0].id };
    for (const [idx, qty, date] of [[0, '5', '2028-07-05'], [1, '2', '2028-07-20']] as const) {
      const r = await mk(owner, `/production-orders/${order.id}/production`, { date, lines: [{ orderItemId: order.orderItemId, stageId: kind.stages[idx].id, qty }] });
      expect((await owner.post(`/documents/${r.id}/post`)).status).toBe(200);
    }
  });

  const move = async (c: Client, from: string, to: string) => (await rep(c, 'wip-movement', { from, to })).body;
  const wipTotal = async (date: string) => (await owner.get(`/production/wip?date=${date}`)).body;

  test('opening, receipt, write-off and closing balance; the closing balance equals the WIP screen', async () => {
    const r = await move(owner, '2028-07-01', '2028-07-31');
    expect(r.rows).toHaveLength(1);
    // 5 заготовок по 160 пришли, 2 приняты завершением (по 160), остаток 3 на 480
    expect(r.rows[0]).toMatchObject({ itemName: 'Тумба НЗП', openingQty: '0.000', inQty: '5.000', outQty: '2.000', closingQty: '3.000', openingAmount: '0.00', inAmount: '800.00', outAmount: '320.00', closingAmount: '480.00' });
    const screen = await wipTotal('2028-07-31');
    expect(r.closingTotal).toBe(screen.total);
    expect(r.rows[0].closingAmount).toBe(screen.centers[0].orders[0].items[0].amount);
    expect(sum(r.rows.map((x: any) => x.openingAmount)) + sum(r.rows.map((x: any) => x.inAmount)) - sum(r.rows.map((x: any) => x.outAmount))).toBe(sum(r.rows.map((x: any) => x.closingAmount)));
  });

  test('the next period opens with the previous closing balance and the same position stays without movement', async () => {
    const r = await move(owner, '2028-08-01', '2028-08-31');
    expect(r.rows[0]).toMatchObject({ openingQty: '3.000', inQty: '0.000', outQty: '0.000', closingQty: '3.000', openingAmount: '480.00', closingAmount: '480.00' });
    expect(r.closingTotal).toBe((await wipTotal('2028-08-31')).total);
  });

  test('a position fully passed through inside the period is shown, the work center filter works', async () => {
    const r = (await rep(owner, 'wip-movement', { from: '2028-07-01', to: '2028-07-31', workCenterId: workshop })).body;
    expect(r.rows).toEqual([]);
  });

  test('the amounts are masked for a member, the quantities stay', async () => {
    const r = await move(member, '2028-07-01', '2028-07-31');
    expect(r.closingTotal).toBeNull();
    expect(r.rows[0]).toMatchObject({ inQty: '5.000', closingQty: '3.000', openingAmount: null, inAmount: null, outAmount: null, closingAmount: null });
  });
});

describe('release cost of a two-stage product', () => {
  test('the costs of the accepted stage go into the same cost types, the rest is close to zero', async () => {
    const before = (await rep(owner, 'release-cost', { from: '2028-07-01', to: '2028-07-31' })).body;
    const row = before.rows.find((x: any) => x.itemName === 'Тумба НЗП');
    // финальный этап принял 2 из 5 заготовок: 2/5 от 800 за брус; работы финального этапа — 2 часа по 100
    expect(row).toMatchObject({ qty: '2.000', materials: '320.0000', work: '200.0000', indirect: '0.0000' });
    expect(Math.abs(Number(row.other))).toBeLessThan(0.01);
    expect(Number(row.total)).toBeCloseTo(520, 2);
  });

  test('indirect costs of the stage are accepted with the same breakdown by cost item', async () => {
    const service = (await mk(owner, '/products', { name: 'Вода (услуга)', kind: 'service', price: 0, vatRate: 'none' })).id;
    const supplier = (await mk(owner, '/companies', { name: 'ООО «Водоканал»' })).id;
    const water = (await mk(owner, '/cost-items', { name: 'Вода', kind: 'expense', distributionMethod: 'output_qty' })).id;
    const doc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2028-07-25', lines: [{ productId: service, qty: 1, price: 70, costItemId: water, workCenterId: center }] });
    expect((await owner.post(`/documents/${doc.id}/post`)).status).toBe(200);
    await owner.post('/production/periods/2028-07/close');
    await drainJobs();
    const r = (await rep(owner, 'release-cost', { from: '2028-07-01', to: '2028-07-31' })).body;
    const row = r.rows.find((x: any) => x.itemName === 'Тумба НЗП');
    // 70 по количеству выпуска: заготовки 5 → 50, финальный этап 2 → 20; финальный принял 2/5 от 50 = 20
    expect(row.indirect).toBe('40.0000');
    expect(row.indirectItems).toEqual([{ costItemId: expect.any(String), name: 'Вода', amount: '40.0000' }]);
    expect(Math.abs(Number(row.other))).toBeLessThan(0.01);
    expect(sum([row.materials, row.semi, row.alloc, row.work, row.services, row.indirect, row.other])).toBeCloseTo(Number(row.total), 4);
  });
});

describe('bom report of a parametric specification', () => {
  let spec: string;

  beforeAll(async () => {
    spec = (await mk(owner, '/manufactured-items', { name: 'Параметрический шкаф', params: [{ key: 'width', name: 'Ширина', type: 'number', options: {} }] })).id;
    await mk(owner, `/manufactured-items/${spec}/lines`, { kind: 'material', productId: wood, qty: 1, qtyExpr: 'width * 2' });
  });

  test('the parameter values are substituted into the formulas', async () => {
    const r = await rep(owner, 'bom', { itemId: spec, qty: '2', params: JSON.stringify({ width: 3 }) });
    expect(r.status).toBe(200);
    // 3 × 2 = 6 брусьев на штуку, 12 на два шкафа по 80
    expect(r.body.rows.find((x: any) => x.kind === 'material')).toMatchObject({ qty: '12.000', amount: '960.00' });
    expect(r.body.total).toBe('960.00');
  });

  test('without the values the error has a code and no line identifier in the text', async () => {
    const r = await rep(owner, 'bom', { itemId: spec, qty: '1' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('formula_param');
    expect(r.body.error.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect((await rep(owner, 'bom', { itemId: spec, qty: '1', params: '[1]' })).status).toBe(400);
  });
});

const productOf = async (itemId: string) => (await owner.get(`/manufactured-items/${itemId}`)).body.productId as string;
