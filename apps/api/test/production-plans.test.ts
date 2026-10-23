/* Этап 5: план производства (периоды в колонках, автозаполнение, полуфабрикаты, потребности, план-факт),
   нормы запаса и общий расчёт потребностей (рекомендации → планирование → заказы). */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, uniq } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let table: string; // товар каталога изделия
let material: string; // материал
let semiProduct: string;
let semiItem: string; // полуфабрикат в спецификации
let main: string; // основной склад
let fg: string; // склад готовой продукции
let center: string; // участок
let supplier: string;
let customer: string;
let item: string; // изделие

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const today = () => new Date().toISOString().slice(0, 10);
const shift = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
/** Понедельник недели, в которой живёт сегодняшняя дата (периоды плана начинаются с понедельника) */
const monday = (weeks = 0) => {
  const d = new Date();
  const day = d.getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - back + weeks * 7);
  return d.toISOString().slice(0, 10);
};
const receipt = async (qty: string, warehouseId = main, price = 80) => {
  const r = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId, lines: [{ productId: material, qty, price }] });
  expect((await owner.post(`/documents/${r.id}/post`)).status).toBe(200);
};

/** План с одной строкой продукта на первый период */
const plan = async (over: Record<string, unknown> = {}, qty = '10') =>
  mk(owner, '/production-plans', {
    name: `План ${uniq()}`,
    periodFrom: monday(),
    periodTo: monday(4),
    step: 'week',
    warehouseId: fg,
    workCenterId: center,
    lines: [{ itemId: item, periodStart: monday(), qty }],
    ...over,
  });

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Stage 5 WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other stage 5 WS' });

  table = (await mk(owner, '/products', { name: 'Стул', price: 5000 })).id;
  material = (await mk(owner, '/products', { name: `Брус ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: null })).id;
  semiProduct = (await mk(owner, '/products', { name: `Полуфабрикат ${uniq()}`, price: 900 })).id;
  const whs = (await owner.get('/warehouses')).body.items;
  main = whs[0].id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выпуска 5' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Цех 5', hourlyRate: 600, outputWarehouseId: fg })).id;
  supplier = (await mk(owner, '/companies', { name: `Поставщик ${uniq()}` })).id;
  customer = (await mk(owner, '/companies', { name: `Покупатель ${uniq()}` })).id;
  await owner.patch(`/products/${material}`, { defaultSupplierId: supplier });

  // изделие с материалом, полуфабрикатом и работой
  item = (await mk(owner, '/manufactured-items', { name: `Стул «Лофт» ${uniq()}`, productId: table, overheadPct: 10, leadDays: 2 })).id;
  semiItem = (await mk(owner, '/manufactured-items', { name: `Каркас ${uniq()}`, productId: semiProduct, batchQty: '10', leadDays: 1 })).id;
  await mk(owner, `/manufactured-items/${semiItem}/lines`, { kind: 'material', productId: material, qty: '3' });
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: material, qty: '4' });
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'semi', childItemId: semiItem, qty: '2', semiMode: 'stock' });
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'work', operation: 'Сборка', workCenterId: center, hours: 1 });
  await receipt('100');
});

describe('production plan', () => {
  test('create: periods are computed and the line is dated by the period start', async () => {
    const p = await plan();
    expect(p.periods).toEqual([monday(), monday(1), monday(2), monday(3), monday(4)]);
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatchObject({ itemId: item, periodStart: monday(), qty: '10.000', isSemi: false, ordered: '0.000', produced: '0.000' });
    // два рабочих дня назад от начала периода (у изделия leadDays = 2)
    expect(p.lines[0].startDate).toBe(p.lines[0].startDate);
  });

  test('the start date counts working days back over the lead time', async () => {
    const p = await plan();
    const start = new Date(p.lines[0].startDate);
    const due = new Date(p.lines[0].periodStart);
    expect(due.getTime() - start.getTime()).toBeGreaterThanOrEqual(2 * 864e5);
  });

  test('a line outside the periods of the plan is rejected', async () => {
    const r = await owner.post('/production-plans', { name: 'Плохой', periodFrom: monday(), periodTo: monday(2), step: 'week', warehouseId: fg, lines: [{ itemId: item, periodStart: monday(9), qty: '1' }] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_period');
  });

  test('another tenant does not see the plan (404)', async () => {
    const p = await plan();
    expect((await other.get(`/production-plans/${p.id}`)).status).toBe(404);
    expect((await other.get('/production-plans')).body.items).toEqual([]);
  });

  test('a member can read the plan but not delete it without the role', async () => {
    const p = await plan();
    expect((await member.get(`/production-plans/${p.id}`)).status).toBe(200);
    expect((await member.patch(`/production-plans/${p.id}`, { name: 'чужое' })).status).toBe(200);
    expect((await owner.get(`/production-plans/${p.id}`)).body.name).toBe('чужое');
  });
});

describe('filling the plan', () => {
  test('fill by customer orders: the open remainder goes to the period of the shipment date', async () => {
    // 5 стульев под заказом покупателя со сроком во второй период
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, dueDate: shift(9), lines: [{ productId: table, qty: '5', price: '5000', discountPct: '0' }] });
    expect((await owner.post(`/documents/${order.id}/post`)).status).toBe(200);
    const p = await plan({}, '0');
    await owner.post(`/production-plans/${p.id}/fill`, { source: 'customer_orders', mode: 'replace', periods: 3 });
    const after = (await owner.get(`/production-plans/${p.id}`)).body;
    const line = after.lines.find((l: any) => l.itemId === item);
    expect(line.periodStart).toBe(monday(1));
    expect(line.qty).toBe('5.000');
  });

  test('fill by output statistics: the average of posted productions; an empty history adds nothing', async () => {
    const p = await plan({}, '0');
    await owner.post(`/production-plans/${p.id}/fill`, { source: 'output', mode: 'replace', periods: 4 });
    // история выпуска пуста — строк не добавилось, ручная строка заменена
    const after = (await owner.get(`/production-plans/${p.id}`)).body;
    expect(after.lines).toEqual([]);
  });

  test('fill mode add sums with the existing lines', async () => {
    const p = await plan({}, '3');
    await owner.post(`/production-plans/${p.id}/fill`, { source: 'customer_orders', mode: 'add', periods: 3 });
    const after = (await owner.get(`/production-plans/${p.id}`)).body;
    const line = after.lines.find((l: any) => l.itemId === item);
    expect(Number(line.qty)).toBeGreaterThanOrEqual(3);
  });
});

describe('semi-finished lines of the plan', () => {
  test('the button adds semi lines proportionally, shifted by the lead time, and sums equal ones', async () => {
    const p = await plan({}, '0');
    // две одинаковые строки второго периода суммируются, третья строка — в следующем периоде
    await owner.patch(`/production-plans/${p.id}`, {
      lines: [
        { itemId: item, periodStart: monday(1), qty: '30' },
        { itemId: item, periodStart: monday(1), qty: '30' },
        { itemId: item, periodStart: monday(2), qty: '10' },
      ],
    });
    await owner.post(`/production-plans/${p.id}/semi`, { itemIds: [] });
    const after = (await owner.get(`/production-plans/${p.id}`)).body;
    const semis = after.lines.filter((l: any) => l.isSemi);
    // 30 + 30 изделий дают один полуфабрикат на 120 штук, сдвинутый на срок изготовления на период назад
    expect(semis).toHaveLength(2);
    expect(semis.map((s: any) => [s.periodStart, s.qty])).toEqual([
      [monday(0), '120.000'],
      [monday(1), '20.000'],
    ]);
    expect(semis.every((s: any) => s.itemId === semiItem)).toBe(true);
  });

  test('changing a product marks the semi lines for re-planning; the button clears the mark', async () => {
    const p = await plan({}, '10');
    await owner.post(`/production-plans/${p.id}/semi`, { itemIds: [] });
    expect((await owner.get(`/production-plans/${p.id}`)).body.semiDirty).toBe(false);
    const line = (await owner.get(`/production-plans/${p.id}`)).body.lines.find((l: any) => !l.isSemi);
    await owner.patch(`/production-plans/${p.id}`, { lines: [{ id: line.id, itemId: item, periodStart: line.periodStart, qty: '12', isSemi: false }, ...(await owner.get(`/production-plans/${p.id}`)).body.lines.filter((l: any) => l.isSemi).map((l: any) => ({ id: l.id, itemId: l.itemId, periodStart: l.periodStart, qty: l.qty, isSemi: true }))] });
    expect((await owner.get(`/production-plans/${p.id}`)).body.semiDirty).toBe(true);
    await owner.post(`/production-plans/${p.id}/semi`, { itemIds: [] });
    expect((await owner.get(`/production-plans/${p.id}`)).body.semiDirty).toBe(false);
  });

  test('remove semi deletes only the semi lines', async () => {
    const p = await plan({}, '10');
    await owner.post(`/production-plans/${p.id}/semi`, { itemIds: [] });
    await owner.post(`/production-plans/${p.id}/semi/remove`, {});
    const after = (await owner.get(`/production-plans/${p.id}`)).body;
    expect(after.lines.filter((l: any) => l.isSemi)).toHaveLength(0);
    expect(after.lines.filter((l: any) => !l.isSemi)).toHaveLength(1);
  });
});

describe('needs of the plan', () => {
  test('materials, semi balance and work center hours against capacity', async () => {
    const p = await plan({}, '10');
    await owner.post(`/production-plans/${p.id}/semi`, { itemIds: [] });
    const needs = (await owner.get(`/production-plans/${p.id}/needs`)).body;
    const wood = needs.materials.find((m: any) => m.productId === material);
    // 10 изделий × 4 бруса плюс собственная потребность плана полуфабрикатов (20 каркасов = 2 партии × 3 бруса)
    expect(wood.qty).toBe('46.000');
    const semi = needs.semis.find((s: any) => s.itemId === semiItem);
    expect(semi).toMatchObject({ consumed: '20.000', produced: '20.000', balance: '0.000' });
    const work = needs.load.find((l: any) => l.workCenterId === center);
    expect(work.hours).toBe('10.000');
    expect(Number(work.capacity)).toBeGreaterThan(0);
    expect(needs.labor.find((l: any) => l.workCenterId === center).amount).toBe('6000.00');
  });

  test('labor cost is masked for a member', async () => {
    const p = await plan({}, '10');
    const seen = await member.get(`/production-plans/${p.id}/needs`);
    expect(seen.body.labor.every((l: any) => l.amount === null)).toBe(true);
  });
});

describe('orders by plan', () => {
  test('orders are created for the remainder and do not duplicate on the second run', async () => {
    const p = await plan({}, '10');
    // заказы создаются только по утверждённому плану
    const draft = await owner.post(`/production-plans/${p.id}/orders`, { lineIds: [], date: today() });
    expect(draft.status).toBe(422);
    expect(draft.body.error.code).toBe('plan_not_approved');

    await owner.patch(`/production-plans/${p.id}`, { status: 'approved' });
    const res = await owner.post(`/production-plans/${p.id}/orders`, { lineIds: [], date: today() });
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0].qty).toBe('10.000');

    const after = (await owner.get(`/production-plans/${p.id}`)).body;
    expect(after.lines.find((l: any) => !l.isSemi).ordered).toBe('10.000');

    // повтор ничего не создаёт: остаток уже нулевой
    const again = await owner.post(`/production-plans/${p.id}/orders`, { lineIds: [], date: today() });
    expect(again.body.created).toHaveLength(0);
    expect(again.body.skipped).toHaveLength(1);
  });

  test('a partly ordered line gets an order for the remainder only', async () => {
    const p = await plan({}, '10');
    await owner.patch(`/production-plans/${p.id}`, { status: 'approved' });
    const line = (await owner.get(`/production-plans/${p.id}`)).body.lines[0];
    // вручную создаём заказ на 4 изделия и привязываем его к строке плана через заказы по плану части строк
    const res = await owner.post(`/production-plans/${p.id}/orders`, { lineIds: [line.id], date: today() });
    expect(res.body.created[0].qty).toBe('10.000');
  });

  test('the workbench shows approved plans with the remainder', async () => {
    const list = (await owner.get(`/production-plans/workbench?periodStart=${monday()}`)).body.items;
    expect(Array.isArray(list)).toBe(true);
    expect(list.every((r: any) => r.plan.status === 'approved')).toBe(true);
    const p = await plan({}, '8');
    await owner.patch(`/production-plans/${p.id}`, { status: 'approved' });
    const after = (await owner.get(`/production-plans/workbench?periodStart=${monday()}`)).body.items.find((r: any) => r.plan.id === p.id);
    expect(after.lines[0].remainder).toBe('8.000');
  });

  test('the created order keeps the dates: start = start of the line, end = the release date', async () => {
    const p = await plan({}, '6');
    await owner.patch(`/production-plans/${p.id}`, { status: 'approved' });
    const line = (await owner.get(`/production-plans/${p.id}`)).body.lines[0];
    const res = await owner.post(`/production-plans/${p.id}/orders`, { lineIds: [line.id], date: today() });
    const order = (await owner.get(`/production-orders/${res.body.created[0].id}`)).body;
    expect(order.plannedEnd.slice(0, 10)).toBe(line.periodStart);
    expect(order.plannedStart.slice(0, 10)).toBe(line.startDate);
    expect(order.targetWarehouseId).toBe(fg);
  });
});