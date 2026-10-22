/* Обеспечение материалов заказа на производство: автоматический резерв, ручная правка, размещение (заказ поставщику),
   дочерние заказы на полуфабрикаты, сводная потребность и заказы поставщикам по ней. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, uniq } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let table: string; // готовое изделие (складской товар)
let semiProduct: string;
let workshop: string; // склад-цех (материалы)
let main: string; // основной склад
let fg: string; // склад готовой продукции
let center: string; // участок
let supplier: string; // поставщик

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

/** Своя номенклатура на тест: материал с запасом на цехе и изделие с этим материалом в спецификации */
const setup = async (stock: string, spec = '2') => {
  const material = (await mk(owner, '/products', { name: `Брус ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
  if (Number(stock) > 0) {
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, lines: [{ productId: material, qty: stock, price: 80 }] });
    expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
  }
  const item = (await mk(owner, '/manufactured-items', { name: `Изделие ${uniq()}`, productId: table, overheadPct: 10 })).id;
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: material, qty: spec });
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'work', operation: 'Сборка', workCenterId: center, hours: 1 });
  return { material, item };
};

/** Заказ на производство с заполненным составом */
const order = async (itemId: string, qty: string, extra: Record<string, unknown> = {}) => {
  const o = await mk(owner, '/production-orders', { workCenterId: center, warehouseId: workshop, targetWarehouseId: fg, items: [{ itemId, qty }], ...extra });
  await owner.post(`/production-orders/${o.id}/fill-from-bom`);
  return o;
};

/** Строка обеспечения по материалу */
const rowOf = async (orderId: string, productId: string) => (await owner.get(`/production-orders/${orderId}/materials`)).body.items.find((r: any) => r.productId === productId);

/** Остаток материала на складе */
const balance = async (productId: string, warehouseId: string) => {
  const items = (await owner.get(`/stock/balances?productId=${productId}`)).body.items;
  return items.find((b: any) => b.warehouseId === warehouseId);
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Materials WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other materials WS' });

  table = (await mk(owner, '/products', { name: 'Стол', price: 5000 })).id;
  semiProduct = (await mk(owner, '/products', { name: 'Полуфабрикат', price: 900 })).id;
  const whs = (await owner.get('/warehouses')).body.items;
  main = whs[0].id;
  workshop = (await mk(owner, '/warehouses', { name: 'Склад цеха', kind: 'workshop' })).id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выпуска' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Столярный цех', hourlyRate: 600, warehouseId: workshop, outputWarehouseId: fg })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»' })).id;
});

describe('reserve of the materials', () => {
  test('posting an order reserves what is free', async () => {
    const { material, item } = await setup('10');
    const o = await order(item, '2'); // нужно 4 бруса
    expect((await owner.post(`/documents/${o.id}/post`)).status).toBe(200);
    const row = await rowOf(o.id, material);
    expect(row).toMatchObject({ need: '4.000', reserved: '4.000', placed: '0.000', notEnsured: '0.000', status: 'full' });
    expect(row.reserveWarehouseId).toBe(workshop);
    expect(row.reserves[0]).toMatchObject({ warehouseId: workshop, qty: '4.000' });
    // резерв виден в остатках
    expect((await balance(material, workshop)).reserved).toBe('4.000');
  });

  test('a part of the need is reserved when there is not enough stock', async () => {
    const { material, item } = await setup('10');
    const o = await order(item, '5'); // нужно 10 брусов — свободно 10
    await owner.post(`/documents/${o.id}/post`);
    const row = await rowOf(o.id, material);
    expect(row.reserved).toBe('10.000');
    expect(row.notEnsured).toBe('0.000');

    // второй заказ на тот же остаток: свободного уже нет
    const o2 = await order(item, '1');
    await owner.post(`/documents/${o2.id}/post`);
    const row2 = await rowOf(o2.id, material);
    expect(row2.reserved).toBe('0.000');
    expect(row2.notEnsured).toBe('2.000');
    expect(row2.status).toBe('none');
  });

  test('two orders posted at once do not reserve the same free stock', async () => {
    const { material, item } = await setup('10');
    const a = await order(item, '5'); // нужно 10 брусов
    const b = await order(item, '5');
    await Promise.all([owner.post(`/documents/${a.id}/post`), owner.post(`/documents/${b.id}/post`)]);
    const total = Number((await balance(material, workshop)).reserved);
    expect(total).toBeLessThanOrEqual(10);
  });

  test('the reserve can be changed by hand: less, more than free and another warehouse', async () => {
    const { material, item } = await setup('10');
    // часть материала лежит на основном складе — резерв можно перенести туда
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: main, lines: [{ productId: material, qty: 6, price: 80 }] });
    await owner.post(`/documents/${rc.id}/post`);
    const o = await order(item, '1'); // нужно 2 бруса
    await owner.post(`/documents/${o.id}/post`);
    const row = await rowOf(o.id, material);
    // уменьшить
    const less = await owner.patch(`/production-orders/${o.id}/materials/${row.componentId}/reservation`, { qty: '1', warehouseId: workshop });
    expect(less.status).toBe(200);
    expect(less.body.items.find((r: any) => r.componentId === row.componentId).reserved).toBe('1.000');
    // увеличить сверх свободного — нельзя
    const more = await owner.patch(`/production-orders/${o.id}/materials/${row.componentId}/reservation`, { qty: '100', warehouseId: workshop });
    expect(more.status).toBe(422);
    expect(more.body.error.code).toBe('insufficient_free');
    // перенести на склад, где товара нет, — тоже нельзя
    const empty = await mk(owner, '/warehouses', { name: 'Пустой склад' });
    const noStock = await owner.patch(`/production-orders/${o.id}/materials/${row.componentId}/reservation`, { qty: '2', warehouseId: empty.id });
    expect(noStock.status).toBe(422);
    expect(noStock.body.error.code).toBe('insufficient_free');
    // увеличить в пределах свободного — можно
    const ok = await owner.patch(`/production-orders/${o.id}/materials/${row.componentId}/reservation`, { qty: '5', warehouseId: workshop });
    expect(ok.status).toBe(200);
    expect(ok.body.items.find((r: any) => r.componentId === row.componentId).reserved).toBe('5.000');
    // перенести резерв на другой склад
    const move = await owner.patch(`/production-orders/${o.id}/materials/${row.componentId}/reservation`, { qty: '5', warehouseId: main });
    expect(move.status).toBe(200);
    const moved = move.body.items.find((r: any) => r.componentId === row.componentId);
    expect(moved.reserveWarehouseId).toBe(main);
    expect(moved.reserved).toBe('5.000');
  });

  test('a release reduces the reserve by the written off quantity, unposting brings it back', async () => {
    const { material, item } = await setup('10');
    const o = await order(item, '2'); // нужно 4 бруса
    await owner.post(`/documents/${o.id}/post`);
    const itemId = (await owner.get(`/production-orders/${o.id}`)).body.items[0].id;
    const rel = await owner.post(`/production-orders/${o.id}/production`, { date: '2026-04-01', lines: [{ orderItemId: itemId, qty: '1' }] });
    expect(rel.status).toBe(201);
    expect((await owner.post(`/documents/${rel.body.id}/post`)).status).toBe(200);
    const row = await rowOf(o.id, material);
    expect(row.written).toBe('2.000'); // списано 2 бруса на один стол
    expect(row.reserved).toBe('2.000');
    // отмена проведения выпуска возвращает резерв
    await owner.post(`/documents/${rel.body.id}/unpost`);
    const back = await rowOf(o.id, material);
    expect(back.written).toBe('0.000');
    expect(back.reserved).toBe('4.000');
  });

  test('unposting the order removes the whole reserve, closing it removes the remainder', async () => {
    const { material, item } = await setup('10');
    const o = await order(item, '2');
    await owner.post(`/documents/${o.id}/post`);
    expect((await balance(material, workshop)).reserved).not.toBe('0.000');
    await owner.post(`/documents/${o.id}/unpost`);
    expect((await rowOf(o.id, material)).reserved).toBe('0.000');

    const o2 = await order(item, '2');
    await owner.post(`/documents/${o2.id}/post`);
    await owner.post(`/production-orders/${o2.id}/state`, { state: 'in_progress' });
    await owner.post(`/production-orders/${o2.id}/state`, { state: 'done' });
    await owner.post(`/production-orders/${o2.id}/state`, { state: 'closed' });
    expect((await rowOf(o2.id, material)).reserved).toBe('0.000');
  });
});

describe('placing the materials', () => {
  test('a supplier order is created for the uncovered materials and provides the line', async () => {
    const { material, item } = await setup('4');
    const o = await order(item, '5'); // нужно 10 брусов, свободно 4
    await owner.post(`/documents/${o.id}/post`);
    const before = await rowOf(o.id, material);
    expect(before.notEnsured).toBe('6.000');
    const res = await owner.post(`/production-orders/${o.id}/supplier-orders`, { comment: 'Докупить брус' });
    expect(res.status).toBe(201);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].supplierName).toBe('ООО «Поставщик»');
    const after = await rowOf(o.id, material);
    expect(after.placed).toBe('6.000');
    expect(after.notEnsured).toBe('0.000');
    expect(after.status).toBe('full');
    // размещение видно в расшифровке
    expect(after.placements[0]).toMatchObject({ documentType: 'supplier_order' });
  });

  test('a receipt by the linked supplier order reserves the goods for the production order', async () => {
    const { material, item } = await setup('4');
    const o = await order(item, '5');
    await owner.post(`/documents/${o.id}/post`);
    const res = await owner.post(`/production-orders/${o.id}/supplier-orders`, {});
    const supplierOrderId = res.body.orders[0].id;
    // заказ поставщику нужно провести — поступление идёт на его основании
    expect((await owner.post(`/documents/${supplierOrderId}/post`)).status).toBe(200);
    const receipt = await owner.post(`/documents/${supplierOrderId}/based-on`, { type: 'receipt' });
    expect(receipt.status).toBe(201);
    await owner.patch(`/documents/${receipt.body.id}`, { warehouseId: workshop });
    expect((await owner.post(`/documents/${receipt.body.id}/post`)).status).toBe(200);
    const row = await rowOf(o.id, material);
    // полученный товар зарезервирован под заказ на производство
    expect(Number(row.reserved)).toBeGreaterThan(0);
    expect(row.reserves.length).toBeGreaterThan(0);
    // размещение уменьшилось на полученное
    expect(Number(row.placed)).toBeLessThan(6);
  });

  test('a receipt of more than ordered is rejected', async () => {
    const { item } = await setup('4');
    const o = await order(item, '5');
    await owner.post(`/documents/${o.id}/post`);
    const res = await owner.post(`/production-orders/${o.id}/supplier-orders`, {});
    const supplierOrderId = res.body.orders[0].id;
    await owner.post(`/documents/${supplierOrderId}/post`);
    const receipt = await owner.post(`/documents/${supplierOrderId}/based-on`, { type: 'receipt' });
    const line = receipt.body.lines[0];
    await owner.patch(`/documents/${receipt.body.id}`, { warehouseId: workshop, lines: [{ id: line.id, productId: line.productId, qty: '100', price: line.price }] });
    const posted = await owner.post(`/documents/${receipt.body.id}/post`);
    expect(posted.status).toBe(422);
    expect(posted.body.error.code).toBe('over_fulfilment');
  });
});

describe('checks found in review', () => {
  test('a supplier order placed for one production order is not free incoming for another', async () => {
    const { material, item } = await setup('4');
    const a = await order(item, '5'); // нужно 10, свободно 4 — 6 заказываем поставщику под заказ A
    await owner.post(`/documents/${a.id}/post`);
    const placed = await owner.post(`/production-orders/${a.id}/supplier-orders`, {});
    await owner.post(`/documents/${placed.body.orders[0].id}/post`);
    const b = await order(item, '1');
    await owner.post(`/documents/${b.id}/post`);
    const row = await rowOf(b.id, material);
    expect(row.incoming).toBe('0.000');
    expect(row.incomingDocs).toHaveLength(0);
  });

  test('the needs screen counts free incoming once, not once per order', async () => {
    const { material, item } = await setup('0');
    // свободный заказ поставщику на 5 брусов
    const so = await mk(owner, '/documents', { type: 'supplier_order', counterpartyId: supplier, warehouseId: workshop, lines: [{ productId: material, qty: 5, price: 80 }] });
    await owner.post(`/documents/${so.id}/post`);
    for (const qty of ['1', '1']) {
      const o = await order(item, qty);
      await owner.post(`/documents/${o.id}/post`);
    }
    const needs = (await owner.get(`/production/needs?productId=${material}`)).body.items as any[];
    expect(needs[0].incoming).toBe('5.000');
  });

  test('negative free stock does not add to the deficit', async () => {
    const { material, item } = await setup('2');
    // заказ покупателя резервирует больше, чем есть на складе цеха: свободно −3
    const customer = (await mk(owner, '/companies', { name: `Покупатель ${uniq()}` })).id;
    const co = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: workshop, lines: [{ productId: material, qty: 5, price: 100 }] });
    expect((await owner.post(`/documents/${co.id}/post`)).status).toBe(200);
    const o = await order(item, '1'); // нужно 2
    await owner.post(`/documents/${o.id}/post`);
    const needs = (await owner.get(`/production/needs?productId=${material}`)).body.items as any[];
    expect(needs[0].deficit).toBe('2.000');
  });

  test('unposting a receipt takes back the reserve it gave to the production order', async () => {
    const { material, item } = await setup('0');
    // поступлений ещё не было — поставщик берётся из карточки товара
    expect((await owner.patch(`/products/${material}`, { defaultSupplierId: supplier })).status).toBe(200);
    const o = await order(item, '2'); // нужно 4, на складе ничего
    await owner.post(`/documents/${o.id}/post`);
    const res = await owner.post(`/production-orders/${o.id}/supplier-orders`, {});
    const supplierOrderId = res.body.orders[0].id;
    await owner.post(`/documents/${supplierOrderId}/post`);
    const receipt = await owner.post(`/documents/${supplierOrderId}/based-on`, { type: 'receipt' });
    await owner.patch(`/documents/${receipt.body.id}`, { warehouseId: workshop });
    expect((await owner.post(`/documents/${receipt.body.id}/post`)).status).toBe(200);
    expect((await rowOf(o.id, material)).reserved).toBe('4.000');
    expect((await owner.post(`/documents/${receipt.body.id}/unpost`)).status).toBe(200);
    // товара больше нет — резерв под него тоже снят
    expect((await rowOf(o.id, material)).reserved).toBe('0.000');
    expect((await balance(material, workshop))?.reserved ?? '0.000').toBe('0.000');
  });
});

describe('semi-finished orders', () => {
  test('a child order is created by the deficit and its release reserves the semi for the parent', async () => {
    const { material } = await setup('10');
    // изделие с полуфабрикатом
    const chair = (await mk(owner, '/products', { name: `Стул ${uniq()}`, price: 3000 })).id;
    const semiItem = (await mk(owner, '/manufactured-items', { name: `Полуфабрикат ${uniq()}`, kind: 'semi', productId: semiProduct })).id;
    await mk(owner, `/manufactured-items/${semiItem}/lines`, { kind: 'material', productId: material, qty: 1 });
    const parent = (await mk(owner, '/manufactured-items', { name: `Стул ${uniq()}`, productId: chair })).id;
    await mk(owner, `/manufactured-items/${parent}/lines`, { kind: 'semi', childItemId: semiItem, qty: 2 });
    const o = await mk(owner, '/production-orders', { workCenterId: center, warehouseId: workshop, targetWarehouseId: fg, items: [{ itemId: parent, qty: '2' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const row = await rowOf(o.id, semiProduct);
    expect(row.kind).toBe('semi');
    expect(row.notEnsured).toBe('4.000'); // полуфабриката на складе нет

    const res = await owner.post(`/production-orders/${o.id}/semi-orders`, {});
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0].qty).toBe('4.000');
    // количество дочернего заказа — «Размещено» у родителя
    const placed = await rowOf(o.id, semiProduct);
    expect(placed.placed).toBe('4.000');
    expect(placed.notEnsured).toBe('0.000');

    // выпуск дочернего заказа резервирует полуфабрикат под родителя
    const childId = res.body.created[0].id;
    await owner.post(`/production-orders/${childId}/fill-from-bom`);
    await owner.post(`/documents/${childId}/post`);
    const childItem = (await owner.get(`/production-orders/${childId}`)).body.items[0].id;
    const rel = await owner.post(`/production-orders/${childId}/production`, { date: '2026-04-02', lines: [{ orderItemId: childItem, qty: '4' }] });
    expect(rel.status).toBe(201);
    expect((await owner.post(`/documents/${rel.body.id}/post`)).status).toBe(200);
    const parentRow = await rowOf(o.id, semiProduct);
    expect(parentRow.reserved).toBe('4.000');
  });
});

describe('needs and supplier orders', () => {
  test('the needs screen shows the deficit of the open orders', async () => {
    const { material, item } = await setup('4');
    const o = await order(item, '5');
    await owner.post(`/documents/${o.id}/post`);
    const needs = await owner.get('/production/needs');
    expect(needs.status).toBe(200);
    const row = needs.body.items.find((r: any) => r.productId === material);
    expect(row).toBeDefined();
    expect(Number(row.need)).toBeGreaterThan(0);
    expect(Number(row.deficit)).toBeGreaterThan(0);
    expect(row.orders.length).toBeGreaterThan(0);
  });

  test('supplier orders are created by the supplier of the product, lines without a supplier are separate', async () => {
    const { material } = await setup('4');
    // товар без поставщика по умолчанию: заказ по нему не создаётся
    const plank = (await mk(owner, '/products', { name: `Плашка ${uniq()}`, purchasePrice: 20 })).id;
    const res = await owner.post('/production/needs/supplier-orders', { lines: [{ productId: material, qty: '5' }, { productId: plank, qty: '3' }] });
    expect(res.status).toBe(201);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].lines[0].productId).toBe(material);
    expect(res.body.withoutSupplier).toHaveLength(1);
    expect(res.body.withoutSupplier[0].productId).toBe(plank);
    // созданный заказ — черновик
    expect((await owner.get(`/documents/${res.body.orders[0].id}`)).body.status).toBe('draft');
  });

  test('the supplier of the product is used when there is no default one', async () => {
    // брус приобретался у поставщика — заказ создаётся на него
    const { material } = await setup('4');
    const res = await owner.post('/production/needs/supplier-orders', { lines: [{ productId: material, qty: '4' }] });
    expect(res.status).toBe(201);
    expect(res.body.orders[0].supplierId).toBe(supplier);
  });
});

describe('rights and isolation', () => {
  test('another workspace cannot see or change the reserve', async () => {
    const { material, item } = await setup('10');
    const o = await order(item, '1');
    await owner.post(`/documents/${o.id}/post`);
    const row = await rowOf(o.id, material);
    expect((await other.get(`/production-orders/${o.id}/materials`)).status).toBe(404);
    const res = await other.patch(`/production-orders/${o.id}/materials/${row.componentId}/reservation`, { qty: '1', warehouseId: workshop });
    expect(res.status).toBe(404);
    expect((await other.get('/production/needs')).body.items).toEqual([]);
  });

  test('a supplier of another workspace is rejected', async () => {
    const { material } = await setup('4');
    const foreign = (await mk(other, '/companies', { name: 'Чужой поставщик' })).id;
    const res = await owner.post('/production/needs/supplier-orders', { lines: [{ productId: material, qty: '1', supplierId: foreign }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('invalid_reference');
  });

  test('a member reads the coverage but the cost of the composition is hidden', async () => {
    const { item } = await setup('10');
    const o = await order(item, '1');
    await owner.post(`/documents/${o.id}/post`);
    const res = await member.get(`/production-orders/${o.id}/materials`);
    expect(res.status).toBe(200);
    const detail = await member.get(`/production-orders/${o.id}`);
    expect(detail.body.components[0].plannedCost).toBeNull();
  });
});
