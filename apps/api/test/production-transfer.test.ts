/* Передача материалов под заказ на производство (docs/architecture/production-materials.md, «Передача материалов»):
   перемещение ссылается на строку состава, лимит — норма × (1 + допуск участка или воркспейса), отмена проведения возвращает «передано». */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, uniq } from './helpers';

let owner: Client;
let other: Client;
let table: string;
let main: string; // основной склад: откуда берутся материалы
let workshop: string; // склад-цех участка
let fg: string;
let center: string;
let supplier: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

/** Материал с запасом на основном складе и изделие (2 материала на штуку) */
const setup = async (stock: string) => {
  const material = (await mk(owner, '/products', { name: `Брус ${uniq()}`, unitCode: '006', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: main, lines: [{ productId: material, qty: stock, price: 80 }] });
  expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
  const item = (await mk(owner, '/manufactured-items', { name: `Изделие ${uniq()}`, productId: table, overheadPct: 0 })).id;
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: material, qty: '2' });
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'work', operation: 'Сборка', workCenterId: center, hours: 1 });
  return { material, item };
};

/** Проведённый заказ на производство: материалы берутся с основного склада, участок — со складом-цехом */
const postedOrder = async (itemId: string, qty: string) => {
  const o = await mk(owner, '/production-orders', { workCenterId: center, warehouseId: main, targetWarehouseId: fg, items: [{ itemId, qty }] });
  await owner.post(`/production-orders/${o.id}/fill-from-bom`);
  expect((await owner.post(`/documents/${o.id}/post`)).status).toBe(200);
  return o.id as string;
};

const rowOf = async (orderId: string, productId: string) => (await owner.get(`/production-orders/${orderId}/materials`)).body.items.find((r: any) => r.productId === productId);

/** Перемещение на склад-цех со ссылкой на строку состава (черновик) */
const transferDraft = async (productId: string, componentId: string, qty: string) =>
  (await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: main, targetWarehouseId: workshop, lines: [{ productId, qty, price: 0, productionComponentId: componentId }] })).id as string;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Transfer WS' });
  other = new Client();
  await other.signup({ workspaceName: 'Other transfer WS' });
  table = (await mk(owner, '/products', { name: 'Стол', price: 5000 })).id;
  main = (await owner.get('/warehouses')).body.items[0].id;
  workshop = (await mk(owner, '/warehouses', { name: 'Склад цеха', kind: 'workshop' })).id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выпуска' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Столярный цех', hourlyRate: 600, warehouseId: workshop, outputWarehouseId: fg })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»' })).id;
});

describe('transfer of materials under a production order', () => {
  test('the button fills a draft with the missing materials of the composition', async () => {
    const { material, item } = await setup('50');
    const orderId = await postedOrder(item, '3'); // нужно 6
    const res = await owner.post(`/production-orders/${orderId}/transfer`, {});
    expect(res.status).toBe(201);
    const doc = (await owner.get(`/documents/${res.body.id}`)).body;
    expect(doc).toMatchObject({ type: 'stock_transfer', status: 'draft', warehouseId: main, targetWarehouseId: workshop, basedOnId: orderId });
    const line = doc.lines.find((l: any) => l.productId === material);
    expect(line.qty).toBe('6.000');
    expect(line.productionComponentId).toBeTruthy();
    // после проведения «передано» растёт, повторная кнопка ничего не создаёт
    expect((await owner.post(`/documents/${res.body.id}/post`)).status).toBe(200);
    expect((await rowOf(orderId, material)).transferred).toBe('6.000');
    expect((await owner.post(`/production-orders/${orderId}/transfer`, {})).status).toBe(422);
  });

  test('a transfer above the norm is rejected with transfer_exceeds_norm', async () => {
    const { material, item } = await setup('50');
    const orderId = await postedOrder(item, '3'); // нужно 6, допуск 0%
    const comp = (await rowOf(orderId, material)).componentId;
    const d = await transferDraft(material, comp, '7');
    const res = await owner.post(`/documents/${d}/post`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('transfer_exceeds_norm');
    // ровно по норме — проходит
    await owner.patch(`/documents/${d}`, { lines: [{ id: (await owner.get(`/documents/${d}`)).body.lines[0].id, productId: material, qty: '6', price: 0 }] });
    expect((await owner.post(`/documents/${d}/post`)).status).toBe(200);
    const row = await rowOf(orderId, material);
    expect(row).toMatchObject({ transferred: '6.000', overTransferred: '0.000' });
  });

  test('the workspace tolerance allows a transfer over the norm and the coverage shows the excess', async () => {
    const { material, item } = await setup('50');
    expect((await owner.patch('/production/settings', { materialOvertransferPct: '10' })).status).toBe(200);
    try {
      const orderId = await postedOrder(item, '5'); // нужно 10, предел 11
      const comp = (await rowOf(orderId, material)).componentId;
      const ok = await transferDraft(material, comp, '11');
      expect((await owner.post(`/documents/${ok}/post`)).status).toBe(200);
      const row = await rowOf(orderId, material);
      expect(row).toMatchObject({ transferred: '11.000', overTransferred: '1.000', transferLimit: '11.000' });
      // ещё чуть-чуть — уже сверх предела
      const more = await transferDraft(material, comp, '0.5');
      const res = await owner.post(`/documents/${more}/post`);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('transfer_exceeds_norm');
    } finally {
      await owner.patch('/production/settings', { materialOvertransferPct: '0' });
    }
  });

  test('the work center tolerance overrides the workspace one', async () => {
    const { material, item } = await setup('50');
    const c2 = (await mk(owner, '/work-centers', { name: `Цех ${uniq()}`, hourlyRate: 100, warehouseId: workshop, outputWarehouseId: fg, materialOvertransferPct: 50 })).id;
    const o = await mk(owner, '/production-orders', { workCenterId: c2, warehouseId: main, targetWarehouseId: fg, items: [{ itemId: item, qty: '5' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const comp = (await rowOf(o.id, material)).componentId;
    const d = await transferDraft(material, comp, '15'); // норма 10 + 50%
    expect((await owner.post(`/documents/${d}/post`)).status).toBe(200);
    expect((await rowOf(o.id, material)).overTransferred).toBe('5.000');
  });

  test('unposting a transfer decreases the transferred quantity', async () => {
    const { material, item } = await setup('50');
    const orderId = await postedOrder(item, '3');
    const comp = (await rowOf(orderId, material)).componentId;
    const d = await transferDraft(material, comp, '6');
    await owner.post(`/documents/${d}/post`);
    expect((await rowOf(orderId, material)).transferred).toBe('6.000');
    expect((await owner.post(`/documents/${d}/unpost`)).status).toBe(200);
    expect((await rowOf(orderId, material)).transferred).toBe('0.000');
    // после отмены можно передать заново
    expect((await owner.post(`/documents/${d}/post`)).status).toBe(200);
  });

  test('a transfer without a link works as before', async () => {
    const { material } = await setup('50');
    const d = (await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: main, targetWarehouseId: workshop, lines: [{ productId: material, qty: '40', price: 0 }] })).id;
    expect((await owner.post(`/documents/${d}/post`)).status).toBe(200);
  });

  test('two transfers posted at once cannot exceed the norm together', async () => {
    const { material, item } = await setup('50');
    const orderId = await postedOrder(item, '3'); // нужно 6
    const comp = (await rowOf(orderId, material)).componentId;
    const a = await transferDraft(material, comp, '4');
    const b = await transferDraft(material, comp, '4');
    const res = await Promise.all([owner.post(`/documents/${a}/post`), owner.post(`/documents/${b}/post`)]);
    expect(res.map(r => r.status).sort()).toEqual([200, 422]);
    expect((await rowOf(orderId, material)).transferred).toBe('4.000');
  });

  test('a link to a material of another product or workspace is rejected', async () => {
    const { material, item } = await setup('50');
    const orderId = await postedOrder(item, '1');
    const comp = (await rowOf(orderId, material)).componentId;
    const wrong = (await mk(owner, '/products', { name: `Другой ${uniq()}`, unitCode: '006', price: 1 })).id;
    const bad = await owner.post('/documents', { type: 'stock_transfer', warehouseId: main, targetWarehouseId: workshop, lines: [{ productId: wrong, qty: '1', price: 0, productionComponentId: comp }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('transfer_component_mismatch');
    const foreign = await other.post(`/production-orders/${orderId}/transfer`, {});
    expect(foreign.status).toBe(404);
  });

  test('a work center without a shop warehouse cannot receive a transfer from the button', async () => {
    const { item } = await setup('10');
    const c3 = (await mk(owner, '/work-centers', { name: `Без склада ${uniq()}`, hourlyRate: 100 })).id;
    const o = await mk(owner, '/production-orders', { workCenterId: c3, warehouseId: main, targetWarehouseId: fg, items: [{ itemId: item, qty: '1' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const res = await owner.post(`/production-orders/${o.id}/transfer`, {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('work_center_warehouse_required');
  });
});
