/* Прослеживаемость партий (задача 1253): связи «сырьё → продукция» при выпуске, обратная и прямая
   трассировка, очистка связей при отмене проведения, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let other: Client;
let wh: string;
let target: string;
let supplier: string;
let raw: string; // сырьё с партионным учётом
let finished: string; // продукция с партионным учётом

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const post = (id: string) => owner.post(`/documents/${id}/post`);
const unpost = (id: string) => owner.post(`/documents/${id}/unpost`);

const trackedProduct = async (name: string, extra: Record<string, unknown> = {}) =>
  (await mk(owner, '/products', { name, kind: 'goods', unitCode: '796', price: 100, vatRate: 'none', trackBatches: true, ...extra })).id as string;

/** Плоский список узлов дерева (для проверок) */
function flatten(node: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(node);
  return out;
}

/** Поступление партии сырья */
async function receive(productId: string, qty: number, number: string) {
  const d = await mk(owner, '/documents', {
    type: 'receipt',
    date: '2026-07-01',
    warehouseId: wh,
    counterpartyId: supplier,
    lines: [{ productId, qty, price: 50, batchNumber: number, batchProducedAt: '2026-06-01', batchExpiresAt: '2027-06-01' }],
  });
  expect((await post(d.id)).status).toBe(200);
  return d.id as string;
}

/** Выпуск продукции из сырья с номером партии продукции; возвращает id документа выпуска */
async function releaseFinished(rawProduct: string, finishedProduct: string, batchNumber: string, date = '2026-07-10') {
  const spec = (await mk(owner, '/manufactured-items', { name: `Спецификация ${batchNumber}`, productId: finishedProduct, batchQty: 1 })).id;
  await mk(owner, `/manufactured-items/${spec}/lines`, { kind: 'material', productId: rawProduct, qty: 1 });
  await mk(owner, `/manufactured-items/${spec}/lines`, { kind: 'work', operation: 'Сборка', workCenterId: (await owner.get('/work-centers')).body.items[0].id, hours: 1, rate: 0 });
  const order = await mk(owner, '/production-orders', { operation: 'assembly', workCenterId: (await owner.get('/work-centers')).body.items[0].id, warehouseId: wh, targetWarehouseId: wh, items: [{ itemId: spec, qty: '1' }] });
  const filled = await mk(owner, `/production-orders/${order.id}/fill-from-bom`, {});
  expect((await post(order.id)).status).toBe(200);
  const release = await mk(owner, `/production-orders/${order.id}/production`, { date, lines: [{ orderItemId: filled.items[0].id, qty: '1' }] });
  // номер партии продукции задаётся в строке прихода выпуска
  const edited = await owner.patch(`/documents/${release.id}`, {
    lines: release.lines.map((l: any) => ({ id: l.id, productId: l.productId, qty: l.qty, price: l.price, ...(l.stockRole === 'in' ? { batchNumber, batchProducedAt: '2026-07-10', batchExpiresAt: '2027-07-10' } : {}) })),
  });
  expect(edited.status).toBe(200);
  expect((await post(release.id)).status).toBe(200);
  return release.id as string;
}

const batchIdOf = async (productId: string, warehouseId: string, number: string): Promise<string> => {
  const rows = (await owner.get(`/stock/batches?productId=${productId}&warehouseId=${warehouseId}`)).body.items as any[];
  const b = rows.find(r => r.number === number);
  if (!b) throw new Error(`batch ${number} not found`);
  return b.batchId as string;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Traceability WS' });
  wh = (await mk(owner, '/warehouses', { name: 'Склад сырья', kind: 'workshop' })).id;
  target = (await mk(owner, '/warehouses', { name: 'Целевой склад' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Сырьё»' })).id;
  await mk(owner, '/work-centers', { name: 'Участок сборки', warehouseId: wh, outputWarehouseId: wh, hourlyRate: 0 });
  raw = await trackedProduct('Сырьё');
  finished = await trackedProduct('Готовое изделие');
  other = new Client();
  await other.signup({ workspaceName: 'Чужой WS трассировки' });
});

describe('batch traceability', () => {
  test('backward: из чего сделана партия (сырьё и поступление до поставщика)', async () => {
    await receive(raw, 10, 'RAW-1');
    await releaseFinished(raw, finished, 'FG-1');
    const fgBatch = await batchIdOf(finished, wh, 'FG-1');
    const res = await owner.get(`/stock/batches/${fgBatch}/from`);
    expect(res.status).toBe(200);
    const root = res.body.root;
    expect(root.kind).toBe('batch');
    const nodes = flatten(root);
    // есть узел сырьевой партии и узел поступления (документ)
    expect(nodes.some(n => n.kind === 'batch' && n.number === 'RAW-1')).toBe(true);
    expect(nodes.some(n => n.kind === 'document')).toBe(true);
    // поступление ведёт к поставщику
    expect(nodes.some(n => n.kind === 'supplier')).toBe(true);
  });

  test('forward: куда ушло сырьё (выпуск и выпущенная партия)', async () => {
    const rawBatch = await batchIdOf(raw, wh, 'RAW-1');
    const res = await owner.get(`/stock/batches/${rawBatch}/where-used`);
    expect(res.status).toBe(200);
    const nodes = flatten(res.body.root);
    expect(nodes.some(n => n.kind === 'document' && n.documentType === 'production')).toBe(true);
    expect(nodes.some(n => n.kind === 'batch' && n.number === 'FG-1')).toBe(true);
  });

  test('перенос партии: связь «склад-источник → получатель»', async () => {
    const fgBatch = await batchIdOf(finished, wh, 'FG-1');
    const transfer = await mk(owner, '/documents', { type: 'stock_transfer', date: '2026-07-11', warehouseId: wh, targetWarehouseId: target, lines: [{ productId: finished, qty: 1, price: 0 }] });
    expect((await post(transfer.id)).status).toBe(200);
    const destBatch = await batchIdOf(finished, target, 'FG-1');
    const res = await owner.get(`/stock/batches/${destBatch}/from`);
    expect(res.status).toBe(200);
    const nodes = flatten(res.body.root);
    expect(nodes.some(n => n.kind === 'document' && n.documentType === 'stock_transfer')).toBe(true);
    // цепочка доводит до исходной партии на складе-источнике
    expect(nodes.some(n => n.kind === 'batch' && n.batchId === fgBatch)).toBe(true);
  });

  test('отмена проведения очищает связи трассировки', async () => {
    const raw2 = await trackedProduct('Сырьё 2');
    const fin2 = await trackedProduct('Изделие 2');
    await receive(raw2, 5, 'RAW-2');
    const releaseDoc = await releaseFinished(raw2, fin2, 'FG-2', '2026-07-15');
    const rawBatch = await batchIdOf(raw2, wh, 'RAW-2');
    const before = flatten((await owner.get(`/stock/batches/${rawBatch}/where-used`)).body.root);
    expect(before.some(n => n.kind === 'document' && n.documentType === 'production')).toBe(true);
    expect((await unpost(releaseDoc)).status).toBe(200);
    const after = flatten((await owner.get(`/stock/batches/${rawBatch}/where-used`)).body.root);
    expect(after.some(n => n.kind === 'document' && n.documentType === 'production')).toBe(false);
  });

  test('чужой арендатор не видит партию (404)', async () => {
    const fgBatch = await batchIdOf(finished, target, 'FG-1');
    expect((await other.get(`/stock/batches/${fgBatch}/from`)).status).toBe(404);
  });
});
