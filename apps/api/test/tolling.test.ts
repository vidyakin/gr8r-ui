/* Переработка давальческого сырья: отдельный количественный учёт (склад, товар, давалец, заказ), приём, выпуск
   из давальческого, отчёт о переработке и возврат остатков; передача своего сырья переработчику и отчёт переработчика. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin, drainJobs } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let whMain: string;
let whShop: string;
let owner_company: string; // давалец
let processor: string; // сторонний переработчик
let material: string; // давальческое сырьё (товар)
let packaging: string; // своя упаковка
let service: string; // услуга переработки
let processingService: string; // услуга стороннего переработчика
let item: string; // изделие
let productId: string; // товар изделия

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const act = async (c: Client, id: string, action: string, body?: unknown) => c.post(`/documents/${id}/${action}`, body);
const line = (productId: string, qty: number | string, price: number | string = 0, extra: Record<string, unknown> = {}) => ({ productId, qty, price, ...extra });
let counter = 0;
const goods = async (name: string, purchasePrice = 100) => (await mk(owner, '/products', { name: `${name} ${++counter}`, unitCode: '006', price: 200, purchasePrice })).id;
const stock = async (productId: string, warehouseId: string) => {
  const r = await owner.get(`/stock/balances?productId=${productId}&warehouseId=${warehouseId}`);
  return (r.body.items[0] as { qty: string; avgCost: string | null } | undefined) ?? { qty: '0.000', avgCost: null };
};
/** Остаток давальца по (склад, товар, заказ) */
const customerQty = async (productId: string, warehouseId: string, processingOrderId?: string | null) => {
  const q = processingOrderId ? `&processingOrderId=${processingOrderId}` : '';
  const r = await owner.get(`/processing/balances?productId=${productId}&warehouseId=${warehouseId}${q}`);
  return r.body.items.reduce((s: number, i: any) => s + Number(i.qty), 0);
};
/** Приём давальческого сырья: приход на остаток давальца */
const receiveMaterials = async (lines: { productId: string; qty: number }[], processingOrderId?: string | null, counterpartyId?: string) => {
  const d = await mk(owner, '/documents', {
    type: 'tolling_receipt',
    counterpartyId: counterpartyId ?? owner_company,
    warehouseId: whShop,
    tollingOrderId: processingOrderId,
    lines: lines.map(l => line(l.productId, l.qty)),
  });
  const r = await act(owner, d.id, 'post');
  if (r.status !== 200) throw new Error(`tolling_receipt: ${r.status} ${JSON.stringify(r.body)}`);
  return d.id;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Переработка WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужой WS' });

  whMain = (await owner.get('/warehouses')).body.items[0].id;
  whShop = (await mk(owner, '/warehouses', { name: 'Цех переработки', kind: 'workshop' })).id;
  owner_company = (await mk(owner, '/companies', { name: 'ООО «Заказчик»', inn: '7728168971' })).id;
  processor = (await mk(owner, '/companies', { name: 'ООО «Переработчик»', inn: '7729145871' })).id;
  material = await goods('Дубовая доска', 900);
  packaging = await goods('Упаковка', 40);
  service = (await mk(owner, '/products', { name: 'Услуга переработки', kind: 'service', unitCode: '356', price: 5000 })).id;
  processingService = (await mk(owner, '/products', { name: 'Услуга окраски', kind: 'service', unitCode: '356', price: 1500 })).id;
  // изделие с простой спецификацией: дуб + упаковка + работа
  const [center] = (await owner.get('/work-centers')).body.items;
  const produced = await mk(owner, '/products', { name: `Стул «Обработка» ${++counter}`, unitCode: '796', price: 20000, purchasePrice: 9000 });
  productId = produced.id;
  item = (await mk(owner, '/manufactured-items', { name: 'Стул «Обработка»', kind: 'product', unitCode: '796', productId, batchQty: '1', overheadPct: '20' })).id;
  for (const l of [
    { kind: 'material', productId: material, qty: '2' },
    { kind: 'material', productId: packaging, qty: '1' },
    { kind: 'work', operation: 'Сборка', workCenterId: center?.id, hours: '1', rate: '1000' },
  ])
    await mk(owner, `/manufactured-items/${item}/lines`, l);
  // свой склад переработчика: склад контрагента
  await mk(owner, '/warehouses', { name: 'Склад переработчика «Вихрь»', counterpartyId: processor });
});

/** Заказ на переработку: заказ покупателя с видом операции «Переработка» */
const processingOrder = async (qty = 10, price = 5000) => {
  const d = await mk(owner, '/documents', { type: 'customer_order', operation: 'processing', counterpartyId: owner_company, warehouseId: whShop, lines: [line(service, qty, price)] });
  const r = await act(owner, d.id, 'post');
  if (r.status !== 200) throw new Error(`processing order: ${r.status} ${JSON.stringify(r.body)}`);
  return d.id;
};

describe('processing order', () => {
  test('a customer order with the processing kind of operation is the processing order', async () => {
    const d = await mk(owner, '/documents', { type: 'customer_order', operation: 'processing', counterpartyId: owner_company, warehouseId: whShop, lines: [line(service, 10, 5000)] });
    expect(d).toMatchObject({ type: 'customer_order', operation: 'processing' });
    // обычный заказ покупателя остаётся обычным
    const plain = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: owner_company, lines: [line(service, 1, 100)] });
    expect(plain.operation).toBe(null);
    // неизвестный вид операции — 422
    const bad = await owner.post('/documents', { type: 'customer_order', operation: 'transfer', counterpartyId: owner_company, lines: [line(service, 1, 100)] });
    expect(bad.status).toBe(422);
    // журнал заказов на переработку
    await act(owner, d.id, 'post');
    const list = (await owner.get('/processing/orders')).body;
    expect(list.items.some((i: any) => i.id === d.id)).toBe(true);
    expect(list.items.every((i: any) => i.operation === 'processing')).toBe(true);
  });

  test('a receipt without the processing order is rejected', async () => {
    const r = await owner.post('/documents', { type: 'tolling_receipt', counterpartyId: owner_company, warehouseId: whShop, lines: [line(material, 1)] });
    expect(r.status).toBe(201);
    const posted = await act(owner, r.body.id, 'post');
    expect(posted.status).toBe(422);
    expect(posted.body.error.code).toBe('tolling_order_required');
  });
});

describe('receipt of customer materials', () => {
  test('does not change own stock, average cost and the chain of month closing', async () => {
    const order = await processingOrder();
    // своя упаковка на основном складе: её средняя не должна меняться от приёма давальческого сырья
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: processor, warehouseId: whMain, priceIncludesVat: false, lines: [line(packaging, 100, 40)] });
    await act(owner, rc.id, 'post');
    const before = await stock(packaging, whMain);

    const receipt = await receiveMaterials([{ productId: material, qty: 30 }], order);
    const detail = (await owner.get(`/documents/${receipt}`)).body;
    expect(detail.number).toMatch(/^ППР-\d{4}-\d{5}$/);
    expect(detail.lines[0]).toMatchObject({ price: '0.00', vatRate: 'none' });
    expect(detail.total).toBe('0.00');
    // давальческое сырьё — только количество, у своего склада и средней ничего не меняется
    expect(await customerQty(material, whShop, order)).toBe(30);
    expect((await stock(material, whShop)).qty).toBe('0.000'); // своего остатка товара нет вовсе
    expect(await stock(packaging, whMain)).toEqual(before);
    // движения давальца видны в отчёте и не попадают в движения своего склада
    const own = (await owner.get(`/stock/moves?documentId=${receipt}`)).body.items;
    expect(own).toEqual([]);
  });

  test('closing the period does not see the customer movements', async () => {
    const order = await processingOrder();
    const own = await goods('Своя доска', 120);
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: processor, warehouseId: whMain, priceIncludesVat: false, lines: [line(own, 10, 120)] });
    await act(owner, rc.id, 'post');
    await receiveMaterials([{ productId: material, qty: 50 }], order);
    const before = await stock(own, whMain);
    // закрытие месяца: пересчёт средней по своим движениям не должен увидеть давальское сырьё
    const month = new Date().toISOString().slice(0, 7);
    expect((await owner.post(`/production/periods/${month}/close`)).status).toBe(202);
    await drainJobs();
    const after = await stock(own, whMain);
    expect(after).toEqual(before);
    expect(await customerQty(material, whShop, order)).toBe(50);
  });

  test('unposting the receipt rolls the balance back', async () => {
    const order = await processingOrder();
    const receipt = await receiveMaterials([{ productId: material, qty: 12 }], order);
    expect(await customerQty(material, whShop, order)).toBe(12);
    const r = await act(owner, receipt, 'unpost');
    expect(r.status).toBe(200);
    expect(await customerQty(material, whShop, order)).toBe(0);
    expect(await act(owner, receipt, 'post')).toMatchObject({ status: 200 });
    expect(await customerQty(material, whShop, order)).toBe(12);
    await act(owner, receipt, 'unpost');
  });
});

describe('release from customer materials', () => {
  test('customer materials are written off by quantity, own ones at average cost; the output goes to the owner', async () => {
    const order = await processingOrder();
    await receiveMaterials([{ productId: material, qty: 30 }], order);
    // своя упаковка на складе материалов выпуска: списывается по средней и идёт в себестоимость услуги
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: processor, warehouseId: whShop, priceIncludesVat: false, lines: [line(packaging, 10, 40)] });
    await act(owner, rc.id, 'post');

    const prodOrder = await mk(owner, '/production-orders', { processingOrderId: order, warehouseId: whShop, targetWarehouseId: whShop, items: [{ itemId: item, qty: '5' }] });
    await owner.post(`/production-orders/${prodOrder.id}/fill-from-bom`);
    // снимок состава помечен: сырьё давальца — чужие строки, работы — свои
    const order3 = (await owner.get(`/production-orders/${prodOrder.id}`)).body;
    expect(order3.components.filter((c: any) => c.kind === 'material').every((c: any) => c.ownerKind === 'customer')).toBe(true);
    expect(order3.components.filter((c: any) => c.kind === 'work').every((c: any) => c.ownerKind === 'own')).toBe(true);
    // упаковку делаем своей — в одном выпуске можно смешать; в проведённом заказе уже нельзя
    const pack = order3.components.find((c: any) => c.productId === packaging);
    expect((await owner.patch(`/production-orders/${prodOrder.id}/components/${pack.id}`, { ownerKind: 'own' })).status).toBe(200);
    const posted = await act(owner, prodOrder.id, 'post');
    expect(posted.status).toBe(200);
    expect((await owner.patch(`/production-orders/${prodOrder.id}/components/${pack.id}`, { ownerKind: 'customer' })).status).toBe(409);

    const posId = order3.items[0].id;
    const release = (await mk(owner, `/production-orders/${prodOrder.id}/production`, { lines: [{ orderItemId: posId, qty: '4' }] })).id;
    const res = await act(owner, release, 'post');
    expect(res.status).toBe(200);

    // давальческое сырьё списано по количеству со своего ключа
    expect(await customerQty(material, whShop, order)).toBe(22);
    // своя упаковка списана по средней со своего склада
    expect(await stock(packaging, whShop)).toMatchObject({ qty: '6.000' });
    // продукция из давальческого сырья пришла на остаток давальца, а не на наш склад
    expect(await customerQty(productId, whShop, order)).toBe(4);
    expect(await stock(productId, whShop)).toMatchObject({ qty: '0.000' });
  });

  test('materials of one order cannot be written off for another (422)', async () => {
    const orderA = await processingOrder();
    const orderB = await processingOrder();
    await receiveMaterials([{ productId: material, qty: 5 }], orderA);
    const prodOrder = await mk(owner, '/production-orders', { processingOrderId: orderA, warehouseId: whShop, targetWarehouseId: whShop, items: [{ itemId: item, qty: '1' }] });
    await owner.post(`/production-orders/${prodOrder.id}/fill-from-bom`);
    const packA = (await owner.get(`/production-orders/${prodOrder.id}`)).body.components.find((c: any) => c.productId === packaging);
    await owner.patch(`/production-orders/${prodOrder.id}/components/${packA.id}`, { ownerKind: 'own' });
    await act(owner, prodOrder.id, 'post');
    // заказ на производство по заказу B, но сырьё числится по заказу A
    const other2 = await mk(owner, '/production-orders', { processingOrderId: orderB, warehouseId: whShop, targetWarehouseId: whShop, items: [{ itemId: item, qty: '1' }] });
    await owner.post(`/production-orders/${other2.id}/fill-from-bom`);
    // упаковка своя — есть на складе, давальческое сырьё числится только у заказа A
    const packB = (await owner.get(`/production-orders/${other2.id}`)).body.components.find((c: any) => c.productId === packaging);
    await owner.patch(`/production-orders/${other2.id}/components/${packB.id}`, { ownerKind: 'own' });
    await act(owner, other2.id, 'post');
    const posId = (await owner.get(`/production-orders/${other2.id}`)).body.items[0].id;
    const release = (await mk(owner, `/production-orders/${other2.id}/production`, { lines: [{ orderItemId: posId, qty: '1' }] })).id;
    const res = await act(owner, release, 'post');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('insufficient_customer_stock');
    // свой заказ списывается своим сырьём
    const ok = (await mk(owner, `/production-orders/${prodOrder.id}/production`, { lines: [{ orderItemId: (await owner.get(`/production-orders/${prodOrder.id}`)).body.items[0].id, qty: '1' }] })).id;
    expect(await act(owner, ok, 'post')).toMatchObject({ status: 200 });
    expect(await customerQty(material, whShop, orderA)).toBe(3);
    expect(await customerQty(material, whShop, orderB)).toBe(0);
    await act(owner, ok.id, 'unpost');
    await act(owner, release.id, 'cancel');
  });

  test('two parallel postings of one order do not drive the balance into minus', async () => {
    const order = await processingOrder();
    await receiveMaterials([{ productId: material, qty: 4 }], order);
    const prodOrder = await mk(owner, '/production-orders', { processingOrderId: order, warehouseId: whShop, targetWarehouseId: whShop, items: [{ itemId: item, qty: '2' }] });
    await owner.post(`/production-orders/${prodOrder.id}/fill-from-bom`);
    const packP = (await owner.get(`/production-orders/${prodOrder.id}`)).body.components.find((c: any) => c.productId === packaging);
    await owner.patch(`/production-orders/${prodOrder.id}/components/${packP.id}`, { ownerKind: 'own' });
    await act(owner, prodOrder.id, 'post');
    const posId = (await owner.get(`/production-orders/${prodOrder.id}`)).body.items[0].id;
    const ids = [];
    for (let i = 0; i < 2; i++) ids.push((await mk(owner, `/production-orders/${prodOrder.id}/production`, { lines: [{ orderItemId: posId, qty: '2' }] })).id);
    const res = await Promise.all(ids.map(id => act(owner, id, 'post')));
    expect(res.filter(r => r.status === 200).length).toBe(1);
    expect(res.filter(r => r.status === 422).length).toBe(1);
    expect(await customerQty(material, whShop, order)).toBe(0);
  });
});

describe('processing report', () => {
  test('gives the products to the owner, writes off the materials and returns the waste', async () => {
    const order = await processingOrder();
    await receiveMaterials([{ productId: material, qty: 20 }], order);
    const rcPack = (await mk(owner, '/documents', { type: 'receipt', counterpartyId: processor, warehouseId: whShop, priceIncludesVat: false, lines: [line(packaging, 10, 40)] })).id;
    await act(owner, rcPack, 'post');
    const prodOrder = (await mk(owner, '/production-orders', { processingOrderId: order, warehouseId: whShop, targetWarehouseId: whShop, items: [{ itemId: item, qty: '5' }] })).id;
    await owner.post(`/production-orders/${prodOrder}/fill-from-bom`);
    const packR = (await owner.get(`/production-orders/${prodOrder}`)).body.components.find((c: any) => c.productId === packaging);
    await owner.patch(`/production-orders/${prodOrder}/components/${packR.id}`, { ownerKind: 'own' });
    await act(owner, prodOrder, 'post');
    const posId = (await owner.get(`/production-orders/${prodOrder}`)).body.items[0].id;
    const release = (await mk(owner, `/production-orders/${prodOrder}/production`, { lines: [{ orderItemId: posId, qty: '5' }] })).id;
    expect((await act(owner, release, 'post')).status).toBe(200);
    const report = await mk(owner, '/documents', {
      type: 'tolling_report',
      counterpartyId: owner_company,
      warehouseId: whShop,
      tollingOrderId: order,
      lines: [
        line(productId, 5, 5000, { tollingRole: 'product' }),
        line(material, 2, 0, { tollingRole: 'material' }),
        line(material, 1, 0, { tollingRole: 'waste' }),
      ],
    });
    const posted = await act(owner, report.id, 'post');
    expect(posted.status).toBe(200);
    expect(posted.body.number).toMatch(/^ОРП-\d{4}-\d{5}$/);
    // продукция отдана давальцу, сырьё списано, отходы вернулись давальцу
    expect(await customerQty(productId, whShop, order)).toBe(0);
    // 20 принято, 10 списано выпуском, 2 списано отчётом, 1 вернулся отходом
    expect(await customerQty(material, whShop, order)).toBe(9);

    // акт услуги по отчёту: продуктовая строка и себестоимость услуги
    const actRes = await owner.post(`/processing/reports/${report.id}/act`);
    expect(actRes.status).toBe(201);
    expect(actRes.body.type).toBe('act');
    expect(actRes.body.total).toBe('25000.00');
    const detail = (await owner.get(`/processing/orders/${order}`)).body;
    expect(Number(detail.serviceCost)).toBeGreaterThan(0);
    // услуга переработки — наш доход, давальческое сырьё в её себестоимость не входит
    const card = (await owner.get(`/documents/${report.id}`)).body;
    expect(card.tollingOrderId).toBe(order);
  });

  test('the report is rejected without products and the balance is rolled back on unpost', async () => {
    const order = await processingOrder();
    await receiveMaterials([{ productId: material, qty: 5 }], order);
    const bad = await mk(owner, '/documents', { type: 'tolling_report', counterpartyId: owner_company, warehouseId: whShop, tollingOrderId: order, lines: [line(material, 1, 0, { tollingRole: 'material' })] });
    expect((await act(owner, bad.id, 'post')).status).toBe(422);
    await owner.del(`/documents/${bad.id}`);
    const report = await mk(owner, '/documents', { type: 'tolling_report', counterpartyId: owner_company, warehouseId: whShop, tollingOrderId: order, lines: [line(productId, 1, 5000, { tollingRole: 'product' })] });
    expect((await act(owner, report.id, 'post')).status).toBe(422); // продукции на остатке давальца нет
    expect(await customerQty(material, whShop, order)).toBe(5);
  });

  test('return of unused materials writes the owner balance off', async () => {
    const order = await processingOrder();
    await receiveMaterials([{ productId: material, qty: 9 }], order);
    const ret = await mk(owner, '/documents', { type: 'tolling_return', counterpartyId: owner_company, warehouseId: whShop, tollingOrderId: order, lines: [line(material, 4)] });
    expect((await act(owner, ret.id, 'post')).status).toBe(200);
    expect(await customerQty(material, whShop, order)).toBe(5);
    expect((await act(owner, ret.id, 'unpost')).status).toBe(200);
    expect(await customerQty(material, whShop, order)).toBe(9);
    // больше, чем числится, — 422
    const tooMuch = (await mk(owner, '/documents', { type: 'tolling_return', counterpartyId: owner_company, warehouseId: whShop, tollingOrderId: order, lines: [line(material, 100)] })).id;
    const r = await act(owner, tooMuch, 'post');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('insufficient_customer_stock');
  });
});

describe('reservations and needs', () => {
  test('customer materials are not reserved from own stock and are not a deficit', async () => {
    const order = await processingOrder();
    await receiveMaterials([{ productId: material, qty: 40 }], order);
    const prodOrder = await mk(owner, '/production-orders', { processingOrderId: order, warehouseId: whShop, targetWarehouseId: whShop, items: [{ itemId: item, qty: '20' }] });
    await owner.post(`/production-orders/${prodOrder.id}/fill-from-bom`);
    await act(owner, prodOrder.id, 'post');
    const rows = (await owner.get(`/production-orders/${prodOrder.id}/materials`)).body.items as any[];
    const board = rows.find(r => r.productId === material);
    // своё сырьё давальца не резервируется и не считается дефицитом
    expect(board.ownerKind).toBe('customer');
    expect(board.reserved).toBe('0.000');
    expect(board.notEnsured).toBe('0.000');
    const needs = (await owner.get('/production/needs')).body.items as any[];
    expect(needs.some(n => n.productId === material && n.orderId === prodOrder.id)).toBe(false);
  });
});

describe('our own materials at the processor', () => {
  test('transfer to the counterparty warehouse and the processor report', async () => {
    const whProc = (await owner.get('/warehouses')).body.items.find((w: any) => w.counterpartyId === processor);
    expect(whProc).toBeTruthy();
    // своё сырьё на основном складе, затем заказ поставщику с видом операции «Переработка» и передача переработчику
    const own = await mk(owner, '/documents', { type: 'receipt', counterpartyId: processor, warehouseId: whMain, priceIncludesVat: false, lines: [line(material, 12, 900)] });
    await act(owner, own.id, 'post');
    const so = await mk(owner, '/documents', { type: 'supplier_order', operation: 'processing', counterpartyId: processor, warehouseId: whMain, lines: [line(material, 10, 900)] });
    await act(owner, so.id, 'post');
    const transfer = await owner.post(`/supplier-orders/${so.id}/processing-transfer`);
    expect(transfer.status).toBe(201);
    expect((await act(owner, transfer.body.id, 'post')).status).toBe(200);
    // товар уехал по своей средней
    expect((await stock(material, whProc.id)).qty).not.toBe('0.000');
    expect((await stock(material, whProc.id)).avgCost).not.toBe('0.0000');
    const atProcessor = Number((await stock(material, whProc.id)).qty);

    // отчёт переработчика: материалы с его склада + услуга в себестоимость, продукция — на наш склад
    const report = await owner.post('/processor-reports', {
      itemId: item,
      qty: '1',
      processorWarehouseId: whProc.id,
      warehouseId: whMain,
      basedOnId: so.id,
      materials: [{ productId: material, qty: '2' }],
      services: [{ productId: processingService, qty: '1', price: '3000' }],
    });
    expect(report.status).toBe(201);
    const res = await act(owner, report.body.id, 'post');
    expect(res.status).toBe(200);
    // услуга переработчика попала в себестоимость продукции (материал + 3000 + накладные)
    const prod = await stock(productId, whMain);
    expect(Number(prod.qty)).toBe(1);
    expect(Number(prod.avgCost)).toBeGreaterThan(3000);
    // остаток у переработчика — обычный отчёт остатков по его складу
    expect(Number((await stock(material, whProc.id)).qty)).toBeLessThan(atProcessor);
  });

  test('the processor report needs a counterparty warehouse', async () => {
    const r = await owner.post('/processor-reports', { itemId: item, qty: '1', processorWarehouseId: whMain, warehouseId: whMain });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('processor_warehouse_required');
  });
});

describe('access rights and closed period', () => {
  test('the cost of the processing service is visible to admin and owner only', async () => {
    const list = (await member.get('/processing/orders')).body.items as any[];
    expect(list.every(i => i.serviceCost === null)).toBe(true);
  });

  test('a document in a closed period is rejected', async () => {
    const wsId = ws;
    await owner.patch('/production/periods/settings', { closedThrough: '2020-01-31' });
    const order = await processingOrder();
    const r = await mk(owner, '/documents', { type: 'tolling_receipt', counterpartyId: owner_company, warehouseId: whShop, tollingOrderId: order, date: '2020-01-15', lines: [line(material, 1)] });
    const posted = await act(owner, r.id, 'post');
    expect(posted.status).toBe(422);
    expect(posted.body.error.code).toBe('period_closed');
    await owner.patch('/production/periods/settings', { closedThrough: null });
    void wsId;
  });

  test('another workspace sees neither the balances nor the orders', async () => {
    const bal = (await other.get('/processing/balances')).body;
    expect(bal.total).toBe(0);
    expect((await other.get('/processing/orders')).body.total).toBe(0);
    expect((await other.get('/warehouses')).body.items.every((w: any) => w.counterpartyId === null)).toBe(true);
  });
});

describe('review fixes (stage 8)', () => {
  test('each processing report carries the cost of its own releases, the act copies the cost of its report', async () => {
    const order = await processingOrder();
    // всё сырьё давальческое (и доска, и упаковка): своя часть себестоимости — работа и накладные
    await receiveMaterials([{ productId: material, qty: 20 }, { productId: packaging, qty: 10 }], order);
    const prodOrder = (await mk(owner, '/production-orders', { processingOrderId: order, warehouseId: whShop, targetWarehouseId: whShop, items: [{ itemId: item, qty: '4' }] })).id;
    await owner.post(`/production-orders/${prodOrder}/fill-from-bom`);
    await act(owner, prodOrder, 'post');
    const posId = (await owner.get(`/production-orders/${prodOrder}`)).body.items[0].id;
    const report = async (qty: number) => {
      const r = await mk(owner, '/documents', { type: 'tolling_report', counterpartyId: owner_company, warehouseId: whShop, tollingOrderId: order, lines: [line(productId, qty, 5000, { tollingRole: 'product' })] });
      expect((await act(owner, r.id, 'post')).status).toBe(200);
      return r.id as string;
    };
    const costOf = async (documentId: string) => Number((await admin`select amount from processing_service_costs where document_id = ${documentId}`)[0]?.amount ?? NaN);
    // первая партия: выпуск 1 шт. и отчёт по ней
    const r1 = (await mk(owner, `/production-orders/${prodOrder}/production`, { lines: [{ orderItemId: posId, qty: '1' }] })).id;
    expect((await act(owner, r1, 'post')).status).toBe(200);
    const rep1 = await report(1);
    const first = await costOf(rep1);
    expect(first).toBeGreaterThan(0);
    // вторая партия: выпуск 3 шт. — отчёт по ней получает только её затраты
    const r2 = (await mk(owner, `/production-orders/${prodOrder}/production`, { lines: [{ orderItemId: posId, qty: '3' }] })).id;
    expect((await act(owner, r2, 'post')).status).toBe(200);
    const rep2 = await report(3);
    expect(await costOf(rep2)).toBeCloseTo(first * 3, 2);
    // акт по первому отчёту — себестоимость первого отчёта, а не всего заказа (карточка документа)
    const actRes = await owner.post(`/processing/reports/${rep1}/act`);
    expect(actRes.status).toBe(201);
    expect(Number((await owner.get(`/documents/${actRes.body.id}`)).body.serviceCost)).toBeCloseTo(first, 2);
    expect(Number((await owner.get(`/documents/${rep2}`)).body.serviceCost)).toBeCloseTo(first * 3, 2);
    // member себестоимость не видит
    expect((await member.get(`/documents/${rep2}`)).body.serviceCost).toBeNull();
    // по заказу в целом — обе партии
    expect(Number((await owner.get(`/processing/orders/${order}`)).body.serviceCost)).toBeCloseTo(first * 4, 2);
  });

  test('indirect costs of the month on a processing release go to the service cost and are added to the posted report', async () => {
    const center = await mk(owner, '/work-centers', { name: 'Участок переработки', hourlyRate: 0 });
    const order = await processingOrder();
    await receiveMaterials([{ productId: material, qty: 4 }, { productId: packaging, qty: 2 }], order);
    const prodOrder = (await mk(owner, '/production-orders', { processingOrderId: order, workCenterId: center.id, warehouseId: whShop, targetWarehouseId: whShop, items: [{ itemId: item, qty: '2' }] })).id;
    await owner.post(`/production-orders/${prodOrder}/fill-from-bom`);
    await act(owner, prodOrder, 'post');
    const posId = (await owner.get(`/production-orders/${prodOrder}`)).body.items[0].id;
    const rel = (await mk(owner, `/production-orders/${prodOrder}/production`, { date: '2026-09-10', lines: [{ orderItemId: posId, qty: '2' }] })).id;
    expect((await act(owner, rel, 'post')).status).toBe(200);
    const rep = await mk(owner, '/documents', { type: 'tolling_report', counterpartyId: owner_company, warehouseId: whShop, tollingOrderId: order, date: '2026-09-20', lines: [line(productId, 2, 5000, { tollingRole: 'product' })] });
    expect((await act(owner, rep.id, 'post')).status).toBe(200);
    const reportCost = async () => Number((await admin`select coalesce(sum(amount), 0) as s from processing_service_costs where document_id = ${rep.id} or report_id = ${rep.id}`)[0]!.s);
    const orderCost = async () => Number((await owner.get(`/processing/orders/${order}`)).body.serviceCost);
    const before = await reportCost();
    expect(before).toBeCloseTo(await orderCost(), 2);
    // косвенные участка за сентябрь: 600 по объёму — единственный выпуск месяца на участке
    const costItem = (await mk(owner, '/cost-items', { name: 'Аренда цеха переработки', distributionMethod: 'output_qty' })).id;
    const rent = (await mk(owner, '/products', { name: 'Аренда цеха', kind: 'service', unitCode: '356', price: 600 })).id;
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: processor, warehouseId: whShop, date: '2026-09-25', priceIncludesVat: false, lines: [line(rent, 1, 600, { costItemId: costItem, workCenterId: center.id })] });
    expect((await act(owner, rc.id, 'post')).status).toBe(200);
    await owner.post('/production/periods/2026-09/close');
    await drainJobs();
    const closing = (await owner.get('/production/periods')).body.items.find((c: any) => c.month === '2026-09');
    expect(closing.status).toBe('done');
    // доля выпуска переработки не теряется: она в себестоимости услуги — и по заказу, и в проведённом отчёте
    expect(await orderCost()).toBeCloseTo(before + 600, 2);
    expect(await reportCost()).toBeCloseTo(before + 600, 2);
    // отмена закрытия возвращает прежнюю себестоимость
    expect((await owner.post('/production/periods/2026-09/reopen')).status).toBeLessThan(300);
    await drainJobs();
    expect(await orderCost()).toBeCloseTo(before, 2);
    expect(await reportCost()).toBeCloseTo(before, 2);
  });
});

