/* Заказ на производство и выпуск: снимок спецификации, списание материалов, приход продукции по себестоимости,
   превышение заказанного, нехватка материалов, резерв под заказ покупателя, один документ выпуска за день на участок. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let wood: string; // материал: закупочная 80
let table: string; // готовое изделие (товар каталога)
let item: string; // спецификация изделия
let semiItem: string; // полуфабрикат на складе (режим stock)
let semiProduct: string;
let workshop: string; // склад-цех (материалы)
let main: string; // склад готовой продукции
let fg: string; // склад, куда участок выпускает продукцию
let center: string; // участок

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const itemOf = (name: string, extra: Record<string, unknown> = {}) => mk(owner, '/manufactured-items', { name, ...extra });
const lineOf = (itemId: string, body: Record<string, unknown>) => mk(owner, `/manufactured-items/${itemId}/lines`, body);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Production orders WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other production WS' });

  wood = (await mk(owner, '/products', { name: 'Брус', unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
  table = (await mk(owner, '/products', { name: 'Стол', price: 5000 })).id;
  semiProduct = (await mk(owner, '/products', { name: 'Доска', price: 900 })).id;
  const whs = (await owner.get('/warehouses')).body.items;
  main = whs[0].id;
  workshop = (await mk(owner, '/warehouses', { name: 'Склад цеха', kind: 'workshop' })).id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выпуска' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Столярный цех', hourlyRate: 600, warehouseId: workshop, outputWarehouseId: fg })).id;

  // изделие: 2 бруса + 1 час работы ставкой участка, накладные 10%
  item = (await itemOf('Стол', { productId: table, overheadPct: 10 })).id;
  await lineOf(item, { kind: 'material', productId: wood, qty: 2 });
  await lineOf(item, { kind: 'work', operation: 'Сборка', workCenterId: center, hours: 1 });
  // полуфабрикат на складе: режим stock — списывается со склада
  semiItem = (await itemOf('Доска', { kind: 'semi', productId: semiProduct })).id;
  await lineOf(semiItem, { kind: 'material', productId: wood, qty: 1 });

  // материалы на склад цеха: 10 брусов по 80
  const supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»' })).id;
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, lines: [{ productId: wood, qty: 20, price: 80 }] });
  expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
});

/** Заказ на производство: изделие и количество */
const order = (qty: string, extra: Record<string, unknown> = {}) => mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty }], ...extra });

describe('production order', () => {
  test('a new order is a draft in the planned state; the snapshot fills the composition', async () => {
    const o = await order('2');
    expect(o.type).toBe('production_order');
    expect(o.state).toBe('planned');
    expect(o.status).toBe('draft');
    expect(o.number).toBeNull();
    expect(o.items).toHaveLength(1);
    expect(o.items[0]).toMatchObject({ itemId: item, qty: '2.000', produced: '0.000' });

    const filled = await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    expect(filled.status).toBe(200);
    // 2 изделия: 4 бруса и 2 часа работы; плановая себестоимость единицы — 836 (320 + 1200 + 152)
    expect(filled.body.components.map((c: any) => [c.kind, c.qty, c.hours, c.plannedCost])).toEqual([
      ['material', '4.000', '0.000', '320.0000'],
      ['work', '0.000', '2.000', '1200.0000'],
    ]);
    expect(filled.body.items[0].plannedUnitCost).toBe('836.0000');

    // заказ без позиций не провести
    const empty = await mk(owner, '/production-orders', { items: [] });
    expect((await owner.post(`/documents/${empty.id}/post`)).body.error.code).toBe('no_items');
  });

  test('posting assigns the number; the state is separate from posting', async () => {
    const o = await order('2');
    const posted = await owner.post(`/documents/${o.id}/post`);
    expect(posted.status).toBe(200);
    expect(posted.body.number).toMatch(/^ЗП-\d{4}-\d{5}$/);
    // состояние меняется отдельно от проведения
    expect((await owner.post(`/production-orders/${o.id}/state`, { state: 'in_progress' })).body.state).toBe('in_progress');
    expect((await owner.post(`/production-orders/${o.id}/state`, { state: 'closed' })).status).toBe(422);
    expect((await owner.post(`/production-orders/${o.id}/state`, { state: 'done' })).body.state).toBe('done');
  });

  test('the journal lists orders with the state filter', async () => {
    const list = await owner.get('/production-orders?limit=50');
    expect(list.status).toBe(200);
    expect(list.body.items.every((o: any) => o.type === 'production_order')).toBe(true);
    const done = await owner.get('/production-orders?state=done');
    expect(done.body.items.every((o: any) => o.state === 'done')).toBe(true);
  });
});

describe('production', () => {
  let orderId: string;

  beforeAll(async () => {
    const o = await order('2');
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    orderId = o.id;
  });

  test('the release writes off the materials and receives the product at its cost', async () => {
    const detail = await owner.get(`/production-orders/${orderId}`);
    const orderItem = detail.body.items[0];
    const rel = await owner.post(`/production-orders/${orderId}/production`, { lines: [{ orderItemId: orderItem.id, qty: '2' }] });
    expect(rel.status).toBe(201);
    expect(rel.body.type).toBe('production');
    // строки: продукция (приход) и материал (расход)
    const roles = rel.body.lines.map((l: any) => [l.stockRole, l.name, l.qty]);
    expect(roles).toEqual([
      ['in', 'Стол', '2.000'],
      ['out', 'Брус', '4.000'],
    ]);

    const posted = await owner.post(`/documents/${rel.body.id}/post`);
    expect(posted.status).toBe(200);
    // себестоимость партии: 4 бруса по 80 = 320 + 2 часа по 600 = 1200 + накладные 10% = 152 -> 1672, единица 836
    const balances = (await owner.get('/stock/balances?productId=' + table)).body.items;
    expect(balances.find((b: any) => b.warehouseId === fg)).toMatchObject({ qty: '2.000', avgCost: '836.0000' });
    const woodBalance = (await owner.get('/stock/balances?productId=' + wood)).body.items.find((b: any) => b.warehouseId === workshop);
    expect(woodBalance.qty).toBe('16.000');

    // отмена проведения возвращает остаток и среднюю
    await owner.post(`/documents/${rel.body.id}/unpost`);
    const after = (await owner.get('/stock/balances?productId=' + table)).body.items;
    expect(after[0]?.qty ?? '0.000').toBe('0.000');
    const woodAfter = (await owner.get('/stock/balances?productId=' + wood)).body.items.find((b: any) => b.warehouseId === workshop);
    expect(woodAfter.qty).toBe('20.000');
  });

  test('more than ordered cannot be produced', async () => {
    const detail = await owner.get(`/production-orders/${orderId}`);
    const orderItem = detail.body.items[0];
    const rel = await owner.post(`/production-orders/${orderId}/production`, { date: '2026-03-01', lines: [{ orderItemId: orderItem.id, qty: '2' }] });
    expect(rel.status).toBe(201);
    expect((await owner.post(`/documents/${rel.body.id}/post`)).status).toBe(200);
    // произведено всё заказанное: больше нельзя
    const more = await owner.post(`/production-orders/${orderId}/production`, { date: '2026-03-02', lines: [{ orderItemId: orderItem.id, qty: '1' }] });
    expect(more.status).toBe(422);
    expect(more.body.error.code).toBe('over_fulfilment');
  });

  test('not enough materials: the release is not posted and nothing moves', async () => {
    const o = await order('20');
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const detail = await owner.get(`/production-orders/${o.id}`);
    const rel = await owner.post(`/production-orders/${o.id}/production`, { date: '2026-03-03', lines: [{ orderItemId: detail.body.items[0].id, qty: '20' }] });
    expect(rel.status).toBe(201);
    const before = (await owner.get('/stock/balances?productId=' + table)).body.items[0]?.qty ?? '0.000';
    const res = await owner.post(`/documents/${rel.body.id}/post`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('insufficient_stock');
    const balances = (await owner.get('/stock/balances?productId=' + table)).body.items;
    expect(balances.find((b: any) => b.warehouseId === fg)?.qty ?? '0.000').toBe(before);
  });

  test('one release document per day per work center', async () => {
    const o = await order('1');
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const date = '2026-03-05';
    const first = await owner.post(`/production-orders/${o.id}/production`, { date, lines: [{ orderItemId: (await owner.get(`/production-orders/${o.id}`)).body.items[0].id, qty: '1' }] });
    const o2 = await order('1');
    await owner.post(`/production-orders/${o2.id}/fill-from-bom`);
    await owner.post(`/documents/${o2.id}/post`);
    const second = await owner.post(`/production-orders/${o2.id}/production`, { date, lines: [{ orderItemId: (await owner.get(`/production-orders/${o2.id}`)).body.items[0].id, qty: '1' }] });
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.lines).toHaveLength(4);
  });
});

describe('production from a customer order', () => {
  let customerOrderId: string;
  let lineId: string;

  beforeAll(async () => {
    // товар производится: способ пополнения и спецификация по умолчанию
    await owner.post('/production-orders/product-settings', { productId: table, replenishment: 'production', defaultItemId: item });
    const customer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»' })).id;
    const co = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: main, lines: [{ productId: table, qty: 3, price: 5000 }] });
    await owner.post(`/documents/${co.id}/post`);
    customerOrderId = co.id;
    lineId = (await owner.get(`/documents/${co.id}`)).body.lines[0].id;
  });

  test('the released goods are reserved for the customer order', async () => {
    const rel = await owner.post('/production-orders/production', { customerOrderId, date: '2026-03-06', workCenterId: center, lines: [{ customerOrderLineId: lineId, qty: '2' }] });
    expect(rel.status).toBe(201);
    const posted = await owner.post(`/documents/${rel.body.id}/post`);
    expect(posted.status).toBe(200);
    const balances = (await owner.get('/stock/balances?productId=' + table)).body.items;
    const stock = balances.find((b: any) => b.warehouseId === fg)!;
    expect(Number(stock.qty)).toBe(4); // 2 из предыдущего выпуска + 2 из заказа покупателя
    expect(stock.reserved).toBe('2.000'); // продукция закреплена за заказом покупателя
    expect(Number(stock.available)).toBe(Number(stock.qty) - 2);

    // отмена проведения снимает резерв
    await owner.post(`/documents/${rel.body.id}/unpost`);
    const after = (await owner.get('/stock/balances?productId=' + table)).body.items.find((b: any) => b.warehouseId === fg)!;
    expect(after.reserved).toBe('0.000');
  });

  test('shipping the customer order releases the reserve of the produced goods', async () => {
    const rel = await owner.post('/production-orders/production', { customerOrderId, date: '2026-03-07', workCenterId: center, lines: [{ customerOrderLineId: lineId, qty: '2' }] });
    expect((await owner.post(`/documents/${rel.body.id}/post`)).status).toBe(200);
    const reservedAtFg = async () => (await owner.get('/stock/balances?productId=' + table)).body.items.find((b: any) => b.warehouseId === fg)!.reserved;
    expect(await reservedAtFg()).toBe('2.000');

    // отгрузка 2 из 3 по заказу со склада выпуска: остаток заказа к отгрузке — 1, резерв продукции урезается до 1
    const real = await owner.post(`/documents/${customerOrderId}/based-on`, { type: 'realization' });
    expect(real.status).toBe(201);
    const realLine = real.body.lines[0];
    expect((await owner.patch(`/documents/${real.body.id}`, { warehouseId: fg, lines: [{ id: realLine.id, productId: realLine.productId, qty: 2, price: realLine.price, originLineId: realLine.originLineId }] })).status).toBe(200);
    expect((await owner.post(`/documents/${real.body.id}/post`)).status).toBe(200);
    expect(await reservedAtFg()).toBe('1.000');

    // отмена отгрузки возвращает остаток заказа, но резерв не растёт обратно сам — его даёт только выпуск
    await owner.post(`/documents/${real.body.id}/unpost`);
    await owner.post(`/documents/${rel.body.id}/unpost`);
    expect(await reservedAtFg()).toBe('0.000');
  });

  test('a production order can be created from the customer order', async () => {
    const o = await owner.post('/production-orders/from-customer-order', { customerOrderId });
    expect(o.status).toBe(201);
    expect(o.body.type).toBe('production_order');
    expect(o.body.items).toHaveLength(1);
    expect(o.body.items[0].customerOrderLineId).toBe(lineId);
  });

  test('a product that is not produced cannot be released', async () => {
    const customer = (await mk(owner, '/companies', { name: 'ООО «Другой»' })).id;
    const co = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: main, lines: [{ productId: wood, qty: 1, price: 100 }] });
    await owner.post(`/documents/${co.id}/post`);
    const line = (await owner.get(`/documents/${co.id}`)).body.lines[0].id;
    const res = await owner.post('/production-orders/production', { customerOrderId: co.id, lines: [{ customerOrderLineId: line, qty: '1' }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('not_produced');
  });
});

describe('rights and isolation', () => {
  test('members read orders but the cost of the composition is hidden', async () => {
    const o = await order('1');
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    const asMember = await member.get(`/production-orders/${o.id}`);
    expect(asMember.status).toBe(200);
    expect(asMember.body.components[0].plannedCost).toBeNull();
    const asOwner = await owner.get(`/production-orders/${o.id}`);
    expect(asOwner.body.components[0].plannedCost).not.toBeNull();
  });

  test('another workspace sees nothing', async () => {
    const o = await order('1');
    expect((await other.get('/production-orders')).body.total).toBe(0);
    expect((await other.get(`/production-orders/${o.id}`)).status).toBe(404);
    expect((await other.patch(`/production-orders/${o.id}`, { comment: 'hack' })).status).toBe(404);
    expect((await other.post(`/production-orders/${o.id}/fill-from-bom`)).status).toBe(404);
    expect((await other.get('/production-orders/product-settings')).body.items).toEqual([]);
  });
});
