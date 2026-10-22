/* Рабочее место «Выпуск продукции»: отбор заказов с остатком к выпуску, выполнение (простой и расширенный режим),
   один документ выпуска на участок и дату, откат при нехватке материалов, права и изоляция. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let wood: string; // материал
let table: string; // готовое изделие (товар каталога)
let item: string; // спецификация изделия
let workshop: string; // склад-цех (материалы)
let fg: string; // склад готовой продукции
let center: string; // участок
let customer: string; // заказчик

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Workbench WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other workbench WS' });

  wood = (await mk(owner, '/products', { name: 'Брус', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
  table = (await mk(owner, '/products', { name: 'Стол', price: 5000 })).id;
  workshop = (await mk(owner, '/warehouses', { name: 'Склад цеха', kind: 'workshop' })).id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выпуска' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Столярный цех', hourlyRate: 600, warehouseId: workshop, outputWarehouseId: fg })).id;

  // изделие: 2 бруса на партию
  item = (await mk(owner, '/manufactured-items', { name: 'Стол', productId: table })).id;
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty: 2 });
  // товар производится: способ пополнения и спецификация по умолчанию
  await owner.post('/production-orders/product-settings', { productId: table, replenishment: 'production', defaultItemId: item });

  // материалы на склад цеха: 20 брусов по 80
  const supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»' })).id;
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, lines: [{ productId: wood, qty: 20, price: 80 }] });
  expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);

  customer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»' })).id;
});

/** Заказ покупателя на производимый товар */
const customerOrder = async (qty: string) => {
  const co = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, lines: [{ productId: table, qty, price: 5000 }] });
  await owner.post(`/documents/${co.id}/post`);
  const line = (await owner.get(`/documents/${co.id}`)).body.lines[0];
  return { id: co.id as string, lineId: line.id as string };
};

/** Заказ на производство с заполненным составом */
const productionOrder = async (qty: string) => {
  const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty }] });
  await owner.post(`/production-orders/${o.id}/fill-from-bom`);
  await owner.post(`/documents/${o.id}/post`);
  const detail = await owner.get(`/production-orders/${o.id}`);
  return { id: o.id as string, itemId: detail.body.items[0].id as string };
};

describe('workbench selection', () => {
  test('the workbench lists customer orders and production orders with the remainder', async () => {
    const co = await customerOrder('3');
    const po = await productionOrder('2');
    const list = await owner.get('/production/workbench');
    expect(list.status).toBe(200);
    const customerOrderRow = list.body.orders.find((o: any) => o.id === co.id);
    const productionOrderRow = list.body.orders.find((o: any) => o.id === po.id);
    expect(customerOrderRow.type).toBe('customer_order');
    expect(customerOrderRow.counterparty.name).toBe('ООО «Покупатель»');
    expect(customerOrderRow.rows[0]).toMatchObject({ source: 'customer_order', id: co.lineId, qty: '3.000', produced: '0.000', remaining: '3.000', stage: 'final' });
    expect(productionOrderRow.type).toBe('production_order');
    expect(productionOrderRow.workCenterName).toBe('Столярный цех');
    expect(productionOrderRow.rows[0]).toMatchObject({ source: 'production_order', id: po.itemId, qty: '2.000', remaining: '2.000' });
    // участки — для выбора изготовителя
    expect(list.body.workCenters.map((w: any) => w.name)).toContain('Столярный цех');
  });

  test('the selection is filtered by product, order and state', async () => {
    const po = await productionOrder('1');
    const byProduct = await owner.get(`/production/workbench?productId=${table}`);
    expect(byProduct.body.orders.every((o: any) => o.rows.every((r: any) => r.productId === table))).toBe(true);
    const byOrder = await owner.get(`/production/workbench?productionOrderId=${po.id}`);
    expect(byOrder.body.orders).toHaveLength(1);
    expect(byOrder.body.orders[0].id).toBe(po.id);
    const byState = await owner.get('/production/workbench?state=planned');
    expect(byState.body.orders.every((o: any) => o.type !== 'production_order' || o.state === 'planned')).toBe(true);
  });

  test('a product that is bought, not produced, is not in the workbench', async () => {
    const co = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, lines: [{ productId: wood, qty: 5, price: 100 }] });
    await owner.post(`/documents/${co.id}/post`);
    const list = await owner.get('/production/workbench');
    expect(list.body.orders.some((o: any) => o.id === co.id)).toBe(false);
  });
});

describe('workbench execution', () => {
  test('two customer orders on one work center make one release document', async () => {
    const first = await customerOrder('2');
    const second = await customerOrder('1');
    const res = await owner.post('/production/workbench/execute', {
      date: '2026-04-01',
      mode: 'simple',
      rows: [
        { orderId: first.id, source: 'customer_order', lineId: first.lineId, workCenterId: center },
        { orderId: second.id, source: 'customer_order', lineId: second.lineId, workCenterId: center },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.documents).toHaveLength(1);
    const docId = res.body.documents[0].id;
    expect(res.body.documents[0].number).toMatch(/^ПР-\d{4}-\d{5}$/);
    // документ проведён: продукция пришла на склад выпуска
    const balances = (await owner.get(`/stock/balances?productId=${table}`)).body.items;
    expect(balances.find((b: any) => b.warehouseId === fg).qty).toBe('3.000');
    // обе строки заказа покупателя в одном документе
    const doc = (await owner.get(`/documents/${docId}`)).body;
    expect(doc.lines.filter((l: any) => l.stockRole === 'in')).toHaveLength(2);
    // остаток к выпуску уменьшился: заказ выпущен полностью и из рабочего места исчез
    const list = await owner.get('/production/workbench');
    expect(list.body.orders.some((o: any) => o.id === first.id)).toBe(false);
  });

  test('the extended mode releases part of the remainder', async () => {
    const co = await customerOrder('3');
    const res = await owner.post('/production/workbench/execute', {
      date: '2026-04-02',
      mode: 'extended',
      rows: [{ orderId: co.id, source: 'customer_order', lineId: co.lineId, qty: '1', workCenterId: center }],
    });
    expect(res.status).toBe(201);
    const list = await owner.get('/production/workbench');
    const row = list.body.orders.find((o: any) => o.id === co.id).rows[0];
    expect(row.remaining).toBe('2.000');
    // в расширенном режиме количество обязательно
    const bad = await owner.post('/production/workbench/execute', {
      date: '2026-04-03',
      mode: 'extended',
      rows: [{ orderId: co.id, source: 'customer_order', lineId: co.lineId, workCenterId: center }],
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('quantity_required');
  });

  test('more than the remainder cannot be released', async () => {
    const co = await customerOrder('2');
    const res = await owner.post('/production/workbench/execute', {
      date: '2026-04-04',
      mode: 'extended',
      rows: [{ orderId: co.id, source: 'customer_order', lineId: co.lineId, qty: '3', workCenterId: center }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('over_fulfilment');
  });

  test('a release for the same day and work center joins the same document', async () => {
    const first = await customerOrder('1');
    const second = await customerOrder('1');
    const date = '2026-04-05';
    const one = await owner.post('/production/workbench/execute', { date, mode: 'simple', rows: [{ orderId: first.id, source: 'customer_order', lineId: first.lineId, workCenterId: center }] });
    const two = await owner.post('/production/workbench/execute', { date, mode: 'simple', rows: [{ orderId: second.id, source: 'customer_order', lineId: second.lineId, workCenterId: center }] });
    expect(two.body.documents[0].id).toBe(one.body.documents[0].id);
    const doc = (await owner.get(`/documents/${one.body.documents[0].id}`)).body;
    expect(doc.status).toBe('posted');
    expect(doc.lines.filter((l: any) => l.stockRole === 'in')).toHaveLength(2);
  });

  test('not enough materials: nothing is created and nothing moves', async () => {
    const co = await customerOrder('20');
    const before = (await owner.get(`/stock/balances?productId=${table}`)).body.items.find((b: any) => b.warehouseId === fg)?.qty ?? '0.000';
    const res = await owner.post('/production/workbench/execute', {
      date: '2026-04-06',
      mode: 'simple',
      rows: [{ orderId: co.id, source: 'customer_order', lineId: co.lineId, workCenterId: center }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('insufficient_stock');
    const after = (await owner.get(`/stock/balances?productId=${table}`)).body.items.find((b: any) => b.warehouseId === fg)?.qty ?? '0.000';
    expect(after).toBe(before);
    // заказ остался в рабочем месте с тем же остатком
    const list = await owner.get('/production/workbench');
    expect(list.body.orders.find((o: any) => o.id === co.id).rows[0].remaining).toBe('20.000');
  });

  test('a line covered by a production order is not released twice', async () => {
    const co = await customerOrder('2');
    // заказ на производство на ту же строку заказа покупателя
    const po = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '2', customerOrderLineId: co.lineId }] });
    await owner.post(`/production-orders/${po.id}/fill-from-bom`);
    await owner.post(`/documents/${po.id}/post`);
    // строка заказа покупателя закрыта заказом на производство — в рабочем месте её нет
    const list = await owner.get('/production/workbench');
    expect(list.body.orders.some((o: any) => o.id === co.id)).toBe(false);
    const res = await owner.post('/production/workbench/execute', { date: '2026-04-10', mode: 'simple', rows: [{ orderId: co.id, source: 'customer_order', lineId: co.lineId, workCenterId: center }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('already_ordered');
  });

  test('a work center is required', async () => {
    const co = await customerOrder('1');
    const res = await owner.post('/production/workbench/execute', { date: '2026-04-07', mode: 'simple', rows: [{ orderId: co.id, source: 'customer_order', lineId: co.lineId }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('work_center_required');
  });

  test('a production order is released by its own position', async () => {
    const po = await productionOrder('2');
    const res = await owner.post('/production/workbench/execute', {
      date: '2026-04-08',
      mode: 'simple',
      rows: [{ orderId: po.id, source: 'production_order', lineId: po.itemId }],
    });
    expect(res.status).toBe(201);
    expect(res.body.documents[0].workCenterId).toBe(center);
    const list = await owner.get('/production/workbench');
    expect(list.body.orders.some((o: any) => o.id === po.id)).toBe(false);
  });
});

describe('workbench rights and isolation', () => {
  test('a member reads the workbench and releases', async () => {
    const co = await customerOrder('1');
    const list = await member.get('/production/workbench');
    expect(list.status).toBe(200);
    const res = await member.post('/production/workbench/execute', { date: '2026-04-09', mode: 'simple', rows: [{ orderId: co.id, source: 'customer_order', lineId: co.lineId, workCenterId: center }] });
    expect(res.status).toBe(201);
  });

  test('another workspace sees nothing', async () => {
    const list = await other.get('/production/workbench');
    expect(list.status).toBe(200);
    expect(list.body.orders).toEqual([]);
    expect(list.body.workCenters).toEqual([]);
  });
});
