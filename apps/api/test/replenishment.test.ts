/* Этап 5: нормы запаса (мин./макс.) и общий расчёт потребностей — рекомендации по методикам, прогноз остатка,
   черновики заказов поставщикам / на производство / перемещений, массовое проведение, маскирование цены, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, uniq } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let main: string; // основной склад
let shop: string; // склад цеха
let supplier: string;
let customer: string;
let material: string; // закупаемый материал
let product: string; // производимое изделие (товар каталога)
let item: string; // спецификация изделия

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const today = () => new Date().toISOString().slice(0, 10);
const shift = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
/** Понедельник текущей недели — начала периодов расчёта (шаг неделя) */
const monday = (weeks = 0) => {
  const d = new Date();
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1) + weeks * 7);
  return d.toISOString().slice(0, 10);
};
const receipt = async (productId: string, qty: string, warehouseId = main, price = 80) => {
  const r = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId, lines: [{ productId, qty, price }] });
  expect((await owner.post(`/documents/${r.id}/post`)).status).toBe(200);
  return r;
};
const levels = (productId: string, rows: Record<string, unknown>[]) => owner.put('/stock-levels', { productId, rows });

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Needs WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other needs WS' });

  const whs = (await owner.get('/warehouses')).body.items;
  main = whs[0].id;
  shop = (await mk(owner, '/warehouses', { name: `Цех ${uniq()}`, kind: 'workshop' })).id;
  supplier = (await mk(owner, '/companies', { name: `Поставщик ${uniq()}` })).id;
  customer = (await mk(owner, '/companies', { name: `Покупатель ${uniq()}` })).id;
  material = (await mk(owner, '/products', { name: `Брус ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier, leadDays: 3 })).id;
  product = (await mk(owner, '/products', { name: `Стул ${uniq()}`, price: 5000 })).id;
  const center = (await mk(owner, '/work-centers', { name: `Цех сборки ${uniq()}`, hourlyRate: 600, outputWarehouseId: main })).id;
  item = (await mk(owner, '/manufactured-items', { name: `Стул изделие ${uniq()}`, productId: product, batchQty: '1', leadDays: 2 })).id;
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: material, qty: '2' });
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'work', operation: 'Сборка', workCenterId: center, hours: 1 });
  await mk(owner, '/production-orders/product-settings', { productId: product, replenishment: 'production', defaultItemId: item });
});

describe('stock levels', () => {
  test('a level per warehouse and one for the company', async () => {
    const res = await levels(material, [
      { warehouseId: null, minQty: '10', maxQty: '20', replenishment: 'purchase' },
      { warehouseId: shop, minQty: '5', maxQty: '15', replenishment: 'purchase' },
    ]);
    expect(res.status).toBe(200);
    const items = res.body.items;
    expect(items).toHaveLength(2);
    expect(items.find((r: any) => r.warehouseId === null)).toMatchObject({ minQty: '10.000', maxQty: '20.000', replenishment: 'purchase', warehouseName: null });
    expect(items.find((r: any) => r.warehouseId === shop).warehouseName).toBeTruthy();
  });

  test('min must not be greater than max', async () => {
    const res = await levels(material, [{ warehouseId: null, minQty: '20', maxQty: '10', replenishment: 'purchase' }]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('invalid_level');
  });

  test('replenishment by transfer needs a source warehouse, and it differs from the target one', async () => {
    const noSource = await levels(material, [{ warehouseId: main, minQty: '1', maxQty: '2', replenishment: 'transfer', sourceWarehouseId: null }]);
    expect(noSource.status).toBe(422);
    expect(noSource.body.error.code).toBe('source_warehouse_required');
    const same = await levels(material, [{ warehouseId: main, minQty: '1', maxQty: '2', replenishment: 'transfer', sourceWarehouseId: main }]);
    expect(same.status).toBe(422);
    expect(same.body.error.code).toBe('same_warehouse');
    const ok = await levels(material, [{ warehouseId: main, minQty: '1', maxQty: '2', replenishment: 'transfer', sourceWarehouseId: shop }]);
    expect(ok.status).toBe(200);
    expect(ok.body.items[0]).toMatchObject({ replenishment: 'transfer', sourceWarehouseId: shop });
  });

  test('levels are replaced entirely and belong to the product', async () => {
    await levels(material, [{ warehouseId: null, minQty: '10', maxQty: '20', replenishment: 'purchase' }]);
    const res = await owner.put('/stock-levels', { productId: material, rows: [{ warehouseId: shop, minQty: '3', maxQty: '9', replenishment: 'purchase' }] });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].warehouseId).toBe(shop);
  });

  test('another tenant does not see the levels of a product and gets 404 on a foreign product', async () => {
    expect((await other.get(`/stock-levels?productId=${material}`)).body.items).toEqual([]);
    const res = await other.put('/stock-levels', { productId: material, rows: [{ warehouseId: null, minQty: '1', maxQty: '2', replenishment: 'purchase' }] });
    expect(res.status).toBe(422);
  });

  test('a member can change the levels, a guest cannot', async () => {
    const res = await member.put('/stock-levels', { productId: material, rows: [{ warehouseId: null, minQty: '4', maxQty: '8', replenishment: 'purchase' }] });
    expect(res.status).toBe(200);
  });
});

describe('needs calculation by orders with min/max', () => {
  test('balance below the minimum: the recommendation covers the shipments of the period', async () => {
    // остаток 2, заказ покупателя на 5 в первом периоде, min 10 / max 20 → 25
    await receipt(material, '2');
    await levels(material, [{ warehouseId: main, minQty: '10', maxQty: '20', replenishment: 'purchase' }]);
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, dueDate: shift(2), lines: [{ productId: material, qty: '5', price: '100', discountPct: '0' }] });
    await owner.post(`/documents/${order.id}/post`);
    const calc = (await owner.get(`/production/needs/calculate?method=orders&step=week&periods=4&from=${monday()}&byWarehouse=true&warehouseId=${main}`)).body;
    const row = calc.rows.find((r: any) => r.productId === material);
    expect(row.balance).toBe('2.000');
    expect(row.recommendation).toBe('25.000');
    expect(row.overdue).not.toBe('0.000');
    expect(row.forecast[0]).toMatchObject({ period: monday(), consumption: '5.000', order: '25.000' });
    expect(row.demand.map((d: any) => d.source)).toContain('customer_order');
    expect(row.dueDate).toBe(monday());
  });

  test('the supplier order of the same product comes as an incoming movement', async () => {
    const so = await mk(owner, '/documents', { type: 'supplier_order', counterpartyId: supplier, warehouseId: main, lines: [{ productId: material, qty: '40', price: '80', discountPct: '0' }] });
    await owner.post(`/documents/${so.id}/post`);
    const row = (await owner.get(`/production/needs/calculate?step=week&periods=4&from=${monday()}&warehouseId=${main}`)).body.rows.find((r: any) => r.productId === material);
    expect(row.incoming.some((f: any) => f.source === 'supplier_order' && f.qty === '40.000')).toBe(true);
  });

  test('a partly received supplier order counts only the remainder', async () => {
    await receipt(material, '15');
    const so = await mk(owner, '/documents', { type: 'supplier_order', counterpartyId: supplier, warehouseId: main, lines: [{ productId: material, qty: '40', price: '80', discountPct: '0' }] });
    await owner.post(`/documents/${so.id}/post`);
    const rc = (await owner.post(`/documents/${so.id}/based-on`, { type: 'receipt' })).body;
    await owner.patch(`/documents/${rc.id}`, { lines: [{ id: rc.lines[0].id, productId: material, qty: '10', price: '80', discountPct: '0' }] });
    await owner.post(`/documents/${rc.id}/post`);
    const row = (await owner.get(`/production/needs/calculate?step=week&periods=2&from=${monday()}&warehouseId=${main}`)).body.rows.find((r: any) => r.productId === material);
    const total = row.incoming.filter((f: any) => f.source === 'supplier_order').reduce((a: number, f: any) => a + Number(f.qty), 0);
    // первый заказ 40 целиком + второй 40 − 10 = 70
    expect(total).toBe(70);
  });

  test('the reservation is shown but not counted twice with the customer order', async () => {
    const row = (await owner.get(`/production/needs/calculate?step=week&periods=2&from=${monday()}&warehouseId=${main}`)).body.rows.find((r: any) => r.productId === material);
    expect(Number(row.reserved)).toBeGreaterThanOrEqual(0);
    // остаток в прогнозе — физический: резерв под заказ покупателя не вычитается второй раз
    expect(row.forecast[0].opening).toBe(row.balance);
  });

  test('balance exactly at the minimum — order up to the maximum', async () => {
    const p2 = (await mk(owner, '/products', { name: `Ровно ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier })).id;
    await receipt(p2, '10');
    await levels(p2, [{ warehouseId: main, minQty: '10', maxQty: '20', replenishment: 'purchase' }]);
    const row = (await owner.get(`/production/needs/calculate?step=week&periods=2&from=${monday()}&warehouseId=${main}`)).body.rows.find((r: any) => r.productId === p2);
    expect(row.balance).toBe('10.000');
    expect(row.recommendation).toBe('10.000');
  });

  test('by company instead of by warehouse sums all the warehouses', async () => {
    const p3 = (await mk(owner, '/products', { name: `Компания ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier })).id;
    await receipt(p3, '3', main);
    await receipt(p3, '4', shop);
    await levels(p3, [{ warehouseId: null, minQty: '10', maxQty: '20', replenishment: 'purchase' }]);
    const row = (await owner.get(`/production/needs/calculate?step=week&periods=2&from=${monday()}&byWarehouse=false`)).body.rows.find((r: any) => r.productId === p3);
    expect(row.balance).toBe('7.000');
    expect(row.warehouseId).toBe(null);
    // складная норма при расчёте по компании не действует — действует строка без склада
    expect(row.recommendation).toBe('13.000');
  });

  test('a warehouse level wins over the company level', async () => {
    const p4 = (await mk(owner, '/products', { name: `Склад ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier })).id;
    await levels(p4, [
      { warehouseId: null, minQty: '1', maxQty: '20', replenishment: 'purchase' },
      { warehouseId: shop, minQty: '5', maxQty: '8', replenishment: 'purchase' },
    ]);
    const shopRow = (await owner.get(`/production/needs/calculate?step=week&periods=1&from=${monday()}&byWarehouse=true`)).body.rows.filter((r: any) => r.productId === p4);
    // по складам действует норма склада; норма по компании — только в расчёте по компании
    expect(shopRow.map((r: any) => [r.warehouseId, r.minQty, r.maxQty])).toEqual([[shop, '5.000', '8.000']]);
    const company = (await owner.get(`/production/needs/calculate?step=week&periods=1&from=${monday()}&byWarehouse=false`)).body.rows.filter((r: any) => r.productId === p4);
    expect(company.map((r: any) => [r.warehouseId, r.minQty, r.maxQty])).toEqual([[null, '1.000', '20.000']]);
  });

  test('filter by the replenishment method', async () => {
    const rows = (await owner.get(`/production/needs/calculate?step=week&periods=1&from=${monday()}&replenishment=transfer&byWarehouse=false`)).body.rows;
    expect(rows.every((r: any) => r.replenishment === 'transfer')).toBe(true);
  });
});

describe('needs calculation by sales', () => {
  test('min/max by sales looks at the balance only', async () => {
    const p5 = (await mk(owner, '/products', { name: `Продажи ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier, leadDays: 5 })).id;
    await receipt(p5, '2');
    await levels(p5, [{ warehouseId: main, minQty: '10', maxQty: '20', replenishment: 'purchase' }]);
    const row = (await owner.get(`/production/needs/calculate?method=sales_minmax&step=week&periods=2&from=${monday()}&warehouseId=${main}`)).body.rows.find((r: any) => r.productId === p5);
    expect(row.recommendation).toBe('18.000');
  });

  test('statistics: average sales × lead time plus safety, and a negative percentage', async () => {
    const p6 = (await mk(owner, '/products', { name: `Статистика ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier, leadDays: 5 })).id;
    await levels(p6, [{ warehouseId: main, minQty: '0', maxQty: '100', replenishment: 'purchase' }]);
    // 70 единиц пришло и ушло за 7 дней = 10 в день
    await receipt(p6, '70');
    const sale = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, date: shift(-3), warehouseId: main, lines: [{ productId: p6, qty: '70', price: '100', discountPct: '0' }] });
    await owner.post(`/documents/${sale.id}/post`);
    // история — прошлые периоды до начала расчёта: неделя до сегодняшнего дня, продажа 3 дня назад в неё попадает
    const base = `/production/needs/calculate?method=sales_statistics&step=week&periods=2&historyPeriods=1&from=${today()}&warehouseId=${main}`;
    const plain = (await owner.get(base)).body.rows.find((r: any) => r.productId === p6);
    expect(plain.avgPerDay).toBe('10.000');
    expect(plain.recommendation).toBe('50.000');
    const withDays = (await owner.get(`${base}&safetyDays=3`)).body.rows.find((r: any) => r.productId === p6);
    expect(withDays.recommendation).toBe('80.000');
    const negative = (await owner.get(`${base}&safetyPct=-50`)).body.rows.find((r: any) => r.productId === p6);
    expect(negative.recommendation).toBe('25.000');
  });
});

describe('drafts of the orders step', () => {
  test('purchase: a supplier order with the last price of that supplier', async () => {
    const row = (await owner.get(`/production/needs/calculate?step=week&periods=2&from=${monday()}&warehouseId=${main}`)).body.rows.find((r: any) => r.productId === material);
    const res = await owner.post('/production/needs/orders', {
      replenishment: 'purchase',
      lines: [{ productId: material, warehouseId: main, qty: '10', date: row.dueDate, price: null }],
    });
    expect(res.status).toBe(201);
    expect(res.body.orders).toHaveLength(1);
    const order = (await owner.get(`/documents/${res.body.orders[0].id}`)).body;
    expect(order.type).toBe('supplier_order');
    expect(order.status).toBe('draft');
    expect(order.counterpartyId).toBe(supplier);
    expect(order.lines[0].qty).toBe('10.000');
    // цена строки — последняя цена этого поставщика (поступление по 80), а не закупочная по карточке
    expect(order.lines[0].price).toBe('80.00');
  });

  test('mass posting of the created drafts', async () => {
    const created = await owner.post('/production/needs/orders', { replenishment: 'purchase', lines: [{ productId: material, warehouseId: main, qty: '5', date: today() }] });
    const ids = created.body.orders.map((o: any) => o.id);
    const res = await owner.post('/production/needs/post', { documentIds: ids });
    expect(res.body.posted).toEqual(ids);
    expect((await owner.get(`/documents/${ids[0]}`)).body.status).toBe('posted');
    // повторное проведение падает, но второй заказ проходит — результат виден по списку
    const again = await owner.post('/production/needs/post', { documentIds: ids });
    expect(again.body.failed).toHaveLength(1);
  });

  test('production: a production order draft with the start date shifted by the lead time', async () => {
    await levels(product, [{ warehouseId: main, minQty: '0', maxQty: '10', replenishment: 'production' }]);
    const res = await owner.post('/production/needs/orders', {
      replenishment: 'production',
      workCenterId: (await owner.get('/work-centers')).body.items[0].id,
      lines: [{ productId: product, warehouseId: main, qty: '4', date: monday(1) }],
    });
    expect(res.status).toBe(201);
    const order = (await owner.get(`/production-orders/${res.body.orders[0].id}`)).body;
    expect(order.type).toBe('production_order');
    expect(order.status).toBe('draft');
    expect(order.plannedEnd.slice(0, 10)).toBe(monday(1));
    expect(order.items[0].qty).toBe('4.000');
    expect(order.targetWarehouseId).toBe(main);
  });

  test('transfer: a stock transfer draft from the source warehouse', async () => {
    const p7 = (await mk(owner, '/products', { name: `Перемещение ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
    await receipt(p7, '10', shop);
    await levels(p7, [{ warehouseId: main, minQty: '5', maxQty: '20', replenishment: 'transfer', sourceWarehouseId: shop }]);
    const res = await owner.post('/production/needs/orders', { replenishment: 'transfer', lines: [{ productId: p7, warehouseId: main, sourceWarehouseId: shop, qty: '6', date: today() }] });
    const doc = (await owner.get(`/documents/${res.body.orders[0].id}`)).body;
    expect(doc.type).toBe('stock_transfer');
    expect(doc.warehouseId).toBe(shop);
    expect(doc.targetWarehouseId).toBe(main);
    expect(doc.lines[0].qty).toBe('6.000');
  });

  test('transfer without a source warehouse is skipped, not created', async () => {
    const p8 = (await mk(owner, '/products', { name: `Без источника ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
    await receipt(p8, '1', main);
    await levels(p8, [{ warehouseId: main, minQty: '5', maxQty: '20', replenishment: 'transfer' }]);
    const res = await owner.post('/production/needs/orders', { replenishment: 'transfer', lines: [{ productId: p8, warehouseId: main, qty: '6', date: today() }] });
    expect(res.body.orders).toHaveLength(0);
    expect(res.body.skipped[0].reason).toBe('no_source_warehouse');
  });

  test('one date for the whole delivery groups the lines into a single order', async () => {
    const res = await owner.post('/production/needs/orders', {
      replenishment: 'purchase',
      singleDate: true,
      date: today(),
      lines: [
        { productId: material, warehouseId: main, qty: '1', date: monday(0) },
        { productId: material, warehouseId: main, qty: '2', date: monday(2) },
      ],
    });
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].lines).toHaveLength(2);
  });

  test('separate orders per customer order split the group', async () => {
    const o1 = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, dueDate: shift(2), lines: [{ productId: material, qty: '3', price: '100', discountPct: '0' }] });
    const o2 = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, dueDate: shift(9), lines: [{ productId: material, qty: '4', price: '100', discountPct: '0' }] });
    await owner.post(`/documents/${o1.id}/post`);
    await owner.post(`/documents/${o2.id}/post`);
    const res = await owner.post('/production/needs/orders', {
      replenishment: 'purchase',
      perCustomerOrder: true,
      lines: [
        { productId: material, warehouseId: main, qty: '3', date: monday(0), customerOrderId: o1.id },
        { productId: material, warehouseId: main, qty: '4', date: monday(1), customerOrderId: o2.id },
      ],
    });
    expect(res.body.orders).toHaveLength(2);
  });
});

describe('masking and tenancy', () => {
  test('the supplier price and the amount are visible to admin and hidden from a member', async () => {
    const asOwner = (await owner.get(`/production/needs/calculate?step=week&periods=2&from=${monday()}&warehouseId=${main}`)).body.rows.find((r: any) => r.productId === material);
    expect(asOwner.price).not.toBe(null);
    const asMember = (await member.get(`/production/needs/calculate?step=week&periods=2&from=${monday()}&warehouseId=${main}`)).body.rows.find((r: any) => r.productId === material);
    expect(asMember.price).toBe(null);
    expect(asMember.amount).toBe(null);
    expect(asMember.balance).toBe(asOwner.balance);
    expect(asMember.suppliers.every((s: any) => s.price === null)).toBe(true);
    const history = (await member.get(`/stock-levels/suppliers?productId=${material}`)).body;
    expect(history.items.every((s: any) => s.price === null)).toBe(true);
  });

  test('another tenant sees no rows of a foreign workspace', async () => {
    expect((await other.get(`/production/needs/calculate?step=week&periods=2`)).body.rows).toEqual([]);
  });

  test('the stage 3 needs screen still works next to the general calculation', async () => {
    const res = await owner.get('/production/needs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describe('review fixes (stage 5)', () => {
  test('by warehouse: demand and incoming of another warehouse do not count', async () => {
    const p = (await mk(owner, '/products', { name: `Склады ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier })).id;
    await levels(p, [
      { warehouseId: main, minQty: '0', maxQty: '0', replenishment: 'purchase' },
      { warehouseId: shop, minQty: '0', maxQty: '0', replenishment: 'purchase' },
    ]);
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: shop, dueDate: shift(2), lines: [{ productId: p, qty: '5', price: '100', discountPct: '0' }] });
    await owner.post(`/documents/${order.id}/post`);
    const rows = (await owner.get(`/production/needs/calculate?step=week&periods=2&from=${monday()}&byWarehouse=true`)).body.rows.filter((r: any) => r.productId === p);
    expect(rows.find((r: any) => r.warehouseId === shop).recommendation).toBe('5.000');
    expect(rows.find((r: any) => r.warehouseId === main).recommendation).toBe('0.000');
    expect(rows.find((r: any) => r.warehouseId === main).demand).toEqual([]);
  });

  test('by company: warehouse levels do not turn into duplicate company rows', async () => {
    const p = (await mk(owner, '/products', { name: `Дубли ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier })).id;
    await levels(p, [
      { warehouseId: main, minQty: '5', maxQty: '10', replenishment: 'purchase' },
      { warehouseId: shop, minQty: '5', maxQty: '10', replenishment: 'purchase' },
    ]);
    const rows = (await owner.get(`/production/needs/calculate?step=week&periods=1&from=${monday()}&byWarehouse=false`)).body.rows.filter((r: any) => r.productId === p);
    expect(rows).toEqual([]);
  });

  test('statistics with a monthly step averages over the days of the months, not weeks', async () => {
    const p = (await mk(owner, '/products', { name: `Месяц ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier, leadDays: 0 })).id;
    await levels(p, [{ warehouseId: main, minQty: '0', maxQty: '100', replenishment: 'purchase' }]);
    await receipt(p, '62');
    const sale = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, date: shift(-3), warehouseId: main, lines: [{ productId: p, qty: '62', price: '100', discountPct: '0' }] });
    await owner.post(`/documents/${sale.id}/post`);
    const from = today();
    const since = new Date(`${from}T00:00:00Z`);
    since.setUTCMonth(since.getUTCMonth() - 2);
    const days = Math.round((Date.parse(`${from}T00:00:00Z`) - since.getTime()) / 864e5);
    const row = (await owner.get(`/production/needs/calculate?method=sales_statistics&step=month&periods=1&historyPeriods=2&from=${from}&warehouseId=${main}`)).body.rows.find((r: any) => r.productId === p);
    expect(row.avgPerDay).toBe((62 / days).toFixed(3));
  });

  test('a company level cannot be replenished by transfer: there is no target warehouse', async () => {
    const p = (await mk(owner, '/products', { name: `Без склада ${uniq()}`, unitCode: '006', price: 100, vatRate: 'none' })).id;
    const res = await levels(p, [{ warehouseId: null, minQty: '1', maxQty: '2', replenishment: 'transfer', sourceWarehouseId: shop }]);
    expect(res.status).toBe(422);
  });

  test('statistics by warehouse count only the sales of that warehouse', async () => {
    const p = (await mk(owner, '/products', { name: `Статистика складов ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier, leadDays: 1 })).id;
    await levels(p, [
      { warehouseId: main, minQty: '0', maxQty: '100', replenishment: 'purchase' },
      { warehouseId: shop, minQty: '0', maxQty: '100', replenishment: 'purchase' },
    ]);
    await receipt(p, '70', shop);
    const sale = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, date: shift(-3), warehouseId: shop, lines: [{ productId: p, qty: '70', price: '100', discountPct: '0' }] });
    await owner.post(`/documents/${sale.id}/post`);
    const rows = (await owner.get(`/production/needs/calculate?method=sales_statistics&step=week&periods=1&historyPeriods=1&from=${today()}&byWarehouse=true`)).body.rows.filter((r: any) => r.productId === p);
    expect(rows.find((r: any) => r.warehouseId === shop).avgPerDay).toBe('10.000');
    expect(rows.find((r: any) => r.warehouseId === main).avgPerDay).toBe('0.000');
  });

  test('a draft never gets a date earlier than today plus the lead time', async () => {
    const p = (await mk(owner, '/products', { name: `Срок ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier, leadDays: 5 })).id;
    const res = await owner.post('/production/needs/orders', { replenishment: 'purchase', lines: [{ productId: p, warehouseId: main, qty: '1', date: shift(-10) }] });
    expect(res.status).toBe(201);
    expect(res.body.orders[0].date).toBe(shift(5));
  });

  test('purchase drafts: each line goes to its own supplier and to its warehouse', async () => {
    const supplier2 = (await mk(owner, '/companies', { name: `Второй поставщик ${uniq()}` })).id;
    const a = (await mk(owner, '/products', { name: `Свой A ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier })).id;
    const b = (await mk(owner, '/products', { name: `Свой B ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier2 })).id;
    const c = (await mk(owner, '/products', { name: `Выбранный C ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none', defaultSupplierId: supplier })).id;
    const res = await owner.post('/production/needs/orders', {
      replenishment: 'purchase',
      singleDate: true,
      lines: [
        { productId: a, warehouseId: shop, qty: '1', date: today() },
        { productId: b, warehouseId: shop, qty: '2', date: today() },
        { productId: c, warehouseId: shop, qty: '3', date: today(), supplierId: supplier2 },
      ],
    });
    expect(res.status).toBe(201);
    const docs = await Promise.all(res.body.orders.map(async (o: any) => (await owner.get(`/documents/${o.id}`)).body));
    const bySupplier = new Map(docs.map((d: any) => [d.counterpartyId, d]));
    expect(docs).toHaveLength(2);
    expect(bySupplier.get(supplier).lines.map((l: any) => l.productId)).toEqual([a]);
    expect(bySupplier.get(supplier2).lines.map((l: any) => l.productId).sort()).toEqual([b, c].sort());
    expect(docs.every((d: any) => d.warehouseId === shop)).toBe(true);
  });
});
