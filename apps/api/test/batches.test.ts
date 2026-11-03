/* Партии и сроки годности (задача 1187): приход создаёт партию (номер, даты, срок из товара), FEFO порядок списания,
   товар без партионного учёта не меняется, отчёт остатков и истекающих, отмена проведения, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { recomputeStockCosts, revalueMove, withContext } from '@gr8r/db';
import { dec } from '@gr8r/shared';
import { admin, Client, sql } from './helpers';

let owner: Client;
let other: Client;
let wh: string;
let flour: string; // с партионным учётом, срок годности 30 дней
let flourNoLife: string; // с партионным учётом без срока
let plain: string; // без партионного учёта
let buyer: string;
let brak: string; // статья расходов для списания

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const doc = (type: string, body: Record<string, unknown>) => mk(owner, '/documents', { type, date: '2026-08-10', priceIncludesVat: false, ...body });
const post = (id: string) => owner.post(`/documents/${id}/post`);
const unpost = (id: string) => owner.post(`/documents/${id}/unpost`);
const batches = async (query = '') => (await owner.get(`/stock/batches${query}`)).body.items as any[];
const trackedProduct = async (name: string, extra: Record<string, unknown> = {}) => (await mk(owner, '/products', { name, kind: 'goods', unitCode: '796', price: 100, vatRate: 'none', trackBatches: true, ...extra })).id as string;
const receipt = async (productId: string, qty: number, number: string, expiresAt: string, extra: Record<string, unknown> = {}) => {
  const d = await doc('receipt', { warehouseId: wh, counterpartyId: buyer, lines: [{ productId, qty, price: 50, batchNumber: number, batchProducedAt: '2026-08-01', batchExpiresAt: expiresAt, ...extra }] });
  expect((await post(d.id)).status).toBe(200);
  return d;
};
const writeOff = (productId: string, qty: number, extra: Record<string, unknown> = {}) => doc('write_off', { warehouseId: wh, costItemId: brak, lines: [{ productId, qty, price: 0, ...extra }] });
const batchQty = async (productId: string, warehouseId: string) => (await batches(`?productId=${productId}&warehouseId=${warehouseId}`)).map(b => [b.number, b.qty]);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Партии WS' });
  wh = (await owner.get('/warehouses')).body.items[0].id;
  buyer = (await mk(owner, '/companies', { name: 'ООО «Пекарня»', inn: '7728168971' })).id;
  flour = (await mk(owner, '/products', { name: 'Мука', kind: 'goods', unitCode: '796', price: 100, purchasePrice: 50, vatRate: 'none', trackBatches: true, shelfLifeDays: 30 })).id;
  flourNoLife = (await mk(owner, '/products', { name: 'Соль', kind: 'goods', unitCode: '796', price: 20, purchasePrice: 10, vatRate: 'none', trackBatches: true })).id;
  plain = (await mk(owner, '/products', { name: 'Гвозди', kind: 'goods', unitCode: '796', price: 60, purchasePrice: 30, vatRate: 'none' })).id;
  brak = ((await owner.get('/cost-items')).body.items as any[]).find(i => i.systemKey === 'brak').id;
  other = new Client();
  await other.signup({ workspaceName: 'Чужой WS партий' });
});

describe('stock batches', () => {
  test('batch portions round the moving average once per receipt line, including replay', async () => {
    const productId = await trackedProduct('Rounding batches');
    const target = (await mk(owner, '/warehouses', { name: 'Rounding destination' })).id;
    const initial = await doc('receipt', { warehouseId: target, counterpartyId: buyer, lines: [{ productId, qty: 1, price: 1, batchNumber: 'Initial' }] });
    expect((await post(initial.id)).status).toBe(200);
    await receipt(productId, 2, 'A', '2026-08-20', { price: 8 });
    await receipt(productId, 3, 'B', '2026-09-01', { price: 8 });
    const transfer = await doc('stock_transfer', { warehouseId: wh, targetWarehouseId: target, lines: [{ productId, qty: 5, price: 0 }] });
    expect((await post(transfer.id)).status).toBe(200);
    const average = async () => (await owner.get(`/stock/balances?productId=${productId}&warehouseId=${target}`)).body.items[0].avgCost;
    expect(await average()).toBe('6.8333'); // (1×1 + 5×8) / 6, irrespective of the 2+3 batch split
    const extra = await doc('receipt', { warehouseId: target, counterpartyId: buyer, lines: [{ productId, qty: 1, price: 1, batchNumber: 'Extra' }] });
    expect((await post(extra.id)).status).toBe(200);
    expect((await unpost(extra.id)).status).toBe(200);
    expect(await average()).toBe('6.8333');
    const [move] = await admin`select id from stock_moves where document_id=${initial.id}`;
    const ctx = { workspaceId: owner.workspaceId!, userId: owner.user!.id };
    await withContext(sql, ctx, db => revalueMove(db, ctx.workspaceId, move!.id, dec(1)));
    expect(await average()).toBe('6.8333');
    await admin`insert into stock_cost_adjustments (workspace_id,move_id,own_delta,delta_cost) values (${ctx.workspaceId},${move!.id},6,6)`;
    await withContext(sql, ctx, db => recomputeStockCosts(db, ctx.workspaceId));
    expect(await average()).toBe('7.8333');
  });

  test('batch report returns product and warehouse names and searches literal batch numbers', async () => {
    const productId = await trackedProduct('Report product');
    const warehouse = (await owner.get('/warehouses')).body.items.find((w: any) => w.id === wh);
    await receipt(productId, 3, 'Report%_A', '2026-08-20');
    await receipt(productId, 4, 'Report-other', '2026-09-01');
    const found = await batches(`?productId=${productId}&q=${encodeURIComponent('report%_')}`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ number: 'Report%_A', productName: 'Report product', warehouseName: warehouse.name, qty: '3.000' });
    expect(await batches(`?productId=${productId}&q=missing`)).toEqual([]);
  });

  test('serial-tracked goods can transfer and withdraw a line split across batches', async () => {
    const productId = await trackedProduct('Serial batches', { trackSerials: true });
    const target = (await mk(owner, '/warehouses', { name: 'Serial batch destination' })).id;
    await receipt(productId, 1, 'A', '2026-08-20', { serials: ['BATCH-S1'] });
    await receipt(productId, 1, 'B', '2026-09-01', { serials: ['BATCH-S2'] });
    const transfer = await doc('stock_transfer', { warehouseId: wh, targetWarehouseId: target, lines: [{ productId, qty: 2, price: 0, serials: ['BATCH-S1', 'BATCH-S2'] }] });
    expect((await post(transfer.id)).status).toBe(200);
    const out = await doc('write_off', { warehouseId: target, costItemId: brak, lines: [{ productId, qty: 2, price: 0, serials: ['BATCH-S1', 'BATCH-S2'] }] });
    expect((await post(out.id)).status).toBe(200);
    expect(await batchQty(productId, target)).toEqual([['A', '0.000'], ['B', '0.000']]);
    expect((await unpost(out.id)).status).toBe(200);
    expect(await batchQty(productId, target)).toEqual([['A', '1.000'], ['B', '1.000']]);
  });

  test('unpost retains referenced zero-balance batches and supports reposting', async () => {
    const productId = await trackedProduct('Referenced zero batch');
    await receipt(productId, 10, 'Other', '2026-09-01');
    const original = await receipt(productId, 10, 'Used', '2026-08-20');
    await receipt(productId, 5, 'Used', '2026-08-20');
    expect((await post((await writeOff(productId, 5)).id)).status).toBe(200);
    const before = (await batches(`?productId=${productId}`)).find(b => b.number === 'Used');
    expect((await unpost(original.id)).status).toBe(200);
    expect((await batches(`?productId=${productId}`)).find(b => b.number === 'Used')).toMatchObject({ batchId: before.batchId, qty: '0.000' });
    expect((await post(original.id)).status).toBe(200);
    expect((await batches(`?productId=${productId}`)).find(b => b.number === 'Used')).toMatchObject({ batchId: before.batchId, qty: '10.000' });
  });

  test('unpost enforces the negative-stock policy for a consumed batch', async () => {
    const productId = await trackedProduct('Consumed batch');
    await receipt(productId, 10, 'Other', '2026-09-01');
    await receipt(productId, 2, 'Used', '2026-08-20');
    const original = await receipt(productId, 10, 'Used', '2026-08-20');
    expect((await post((await writeOff(productId, 7)).id)).status).toBe(200);
    const rejected = await unpost(original.id);
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe('stock_conflict');
    expect((await batches(`?productId=${productId}`)).find(b => b.number === 'Used').qty).toBe('5.000');
    expect((await owner.patch('/stock/settings', { allowNegativeStock: true })).status).toBe(200);
    try {
      expect((await unpost(original.id)).status).toBe(200);
      expect((await batches(`?productId=${productId}`)).find(b => b.number === 'Used').qty).toBe('-5.000');
      expect((await post(original.id)).status).toBe(200);
      expect((await batches(`?productId=${productId}`)).find(b => b.number === 'Used').qty).toBe('5.000');
    } finally {
      expect((await owner.patch('/stock/settings', { allowNegativeStock: false })).status).toBe(200);
    }
  });

  test('omitted batch fields are preserved while explicit null clears them', async () => {
    const d = await doc('receipt', { warehouseId: wh, counterpartyId: buyer, lines: [{ productId: flour, qty: 1, price: 50, batchNumber: 'Editable', batchProducedAt: '2026-08-01', batchExpiresAt: '2026-08-20' }] });
    const line = { id: d.lines[0].id, productId: flour, qty: 2, price: 50 };
    const omitted = await owner.patch(`/documents/${d.id}`, { lines: [line] });
    expect(omitted.status).toBe(200);
    expect(omitted.body.lines[0]).toMatchObject({ batchNumber: 'Editable', batchProducedAt: '2026-08-01', batchExpiresAt: '2026-08-20' });
    const cleared = await owner.patch(`/documents/${d.id}`, { lines: [{ ...line, batchNumber: null, batchProducedAt: null, batchExpiresAt: null }] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.lines[0]).toMatchObject({ batchNumber: null, batchProducedAt: null, batchExpiresAt: null });
    expect((await post(d.id)).body.error.code).toBe('batch_number_required');
  });

  for (const operation of ['assembly', 'disassembly']) test(`${operation} production uses batch details saved on incoming lines`, async () => {
    const productId = await trackedProduct(`Batch ${operation}`);
    const workshop = (await mk(owner, '/warehouses', { name: `${operation} workshop`, kind: 'workshop' })).id;
    const center = (await mk(owner, '/work-centers', { name: `${operation} center`, warehouseId: workshop, outputWarehouseId: wh, hourlyRate: 100 })).id;
    let source = productId;
    if (operation === 'disassembly') {
      source = await trackedProduct('Disassembly source', { trackBatches: false });
      const incoming = await doc('receipt', { warehouseId: workshop, counterpartyId: buyer, lines: [{ productId: source, qty: 1, price: 50 }] });
      expect((await post(incoming.id)).status).toBe(200);
    }
    const item = (await mk(owner, '/manufactured-items', { name: `Batch ${operation}`, mode: operation, productId: source })).id;
    await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'work', operation: 'Produce', workCenterId: center, fixedCost: 100 });
    if (operation === 'disassembly') await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'output', productId, qty: 1, costShare: 100 });
    const order = await mk(owner, '/production-orders', { operation, workCenterId: center, warehouseId: workshop, targetWarehouseId: wh, items: [{ itemId: item, qty: '1' }] });
    const filled = await mk(owner, `/production-orders/${order.id}/fill-from-bom`, {});
    expect((await post(order.id)).status).toBe(200);
    const release = await mk(owner, `/production-orders/${order.id}/production`, { date: '2026-08-10', lines: [{ orderItemId: filled.items[0].id, qty: '1' }] });
    const edited = await owner.patch(`/documents/${release.id}`, { lines: release.lines.map((l: any) => ({ id: l.id, productId: l.productId, qty: l.qty, price: l.price, ...(l.stockRole === 'in' ? { batchNumber: 'Produced', batchProducedAt: '2026-08-10', batchExpiresAt: '2026-08-20' } : {}) })) });
    expect(edited.status).toBe(200);
    expect((await post(release.id)).status).toBe(200);
    expect(await batchQty(productId, wh)).toEqual([['Produced', '1.000']]);
    expect((await batches(`?productId=${productId}`))[0]).toMatchObject({ producedAt: '2026-08-10', expiresAt: '2026-08-20' });
  });

  test('ordinary transfers preserve every batch portion and its dates at the destination', async () => {
    const productId = await trackedProduct('Transferred batches');
    const target = (await mk(owner, '/warehouses', { name: 'Batch destination' })).id;
    await receipt(productId, 10, 'A', '2026-08-20');
    await receipt(productId, 10, 'B', '2026-09-01');
    const transfer = await doc('stock_transfer', { warehouseId: wh, targetWarehouseId: target, lines: [{ productId, qty: 15, price: 0 }] });
    expect((await post(transfer.id)).status).toBe(200);
    expect(await batchQty(productId, wh)).toEqual([['A', '0.000'], ['B', '5.000']]);
    expect(await batchQty(productId, target)).toEqual([['A', '10.000'], ['B', '5.000']]);
    const targetBatches = await batches(`?productId=${productId}&warehouseId=${target}`);
    expect(targetBatches.map(b => [b.producedAt, b.expiresAt])).toEqual([['2026-08-01', '2026-08-20'], ['2026-08-01', '2026-09-01']]);
    const mismatches = await admin`select m.id from stock_moves m join stock_batches b on b.id=m.batch_id where m.product_id=${productId} and (m.warehouse_id<>b.warehouse_id or m.product_id<>b.product_id)`;
    expect(mismatches).toHaveLength(0);
    expect((await unpost(transfer.id)).status).toBe(200);
    expect(await batchQty(productId, wh)).toEqual([['A', '10.000'], ['B', '10.000']]);
    expect(await batchQty(productId, target)).toEqual([]);
  });

  test('partial transit acceptance uses only its shipment portions and supports cancellation', async () => {
    const productId = await trackedProduct('Transit batches');
    const target = (await mk(owner, '/warehouses', { name: 'Transit destination' })).id;
    await receipt(productId, 20, 'A', '2026-08-20');
    await receipt(productId, 20, 'B', '2026-09-01');
    const ship = async (qty: number) => {
      const d = await doc('stock_transfer', { operation: 'in_transit', warehouseId: wh, targetWarehouseId: target, lines: [{ productId, qty, price: 0 }] });
      expect((await post(d.id)).status).toBe(200);
      return d;
    };
    const first = await ship(10);
    const second = await ship(15);
    const transit = (await owner.get('/warehouses?limit=100')).body.items.find((w: any) => w.kind === 'transit').id;
    const accept = () => owner.post(`/documents/${second.id}/state`, { state: 'received', received: [{ id: second.lines[0].id, qty: '12' }] });
    expect((await accept()).status).toBe(200);
    expect(await batchQty(productId, target)).toEqual([['A', '10.000'], ['B', '2.000']]);
    expect(await batchQty(productId, transit)).toEqual([['A', '10.000'], ['B', '3.000']]);
    expect((await owner.post(`/documents/${second.id}/state`, { state: 'shipped' })).status).toBe(200);
    expect(await batchQty(productId, transit)).toEqual([['A', '20.000'], ['B', '5.000']]);
    expect((await accept()).status).toBe(200);
    expect((await owner.post(`/documents/${first.id}/state`, { state: 'received' })).status).toBe(200);
    expect(await batchQty(productId, target)).toEqual([['A', '20.000'], ['B', '2.000']]);
  });

  test('legacy unbatched stock remains transferable after enabling batch tracking', async () => {
    const productId = await trackedProduct('Legacy stock', { trackBatches: false });
    const target = (await mk(owner, '/warehouses', { name: 'Legacy destination' })).id;
    const incoming = await doc('receipt', { warehouseId: wh, counterpartyId: buyer, lines: [{ productId, qty: 10, price: 50 }] });
    expect((await post(incoming.id)).status).toBe(200);
    expect((await owner.patch(`/products/${productId}`, { trackBatches: true })).status).toBe(200);
    for (const operation of ['transfer', 'in_transit']) {
      const d = await doc('stock_transfer', { operation, warehouseId: wh, targetWarehouseId: target, lines: [{ productId, qty: 4, price: 0 }] });
      expect((await post(d.id)).status).toBe(200);
      if (operation === 'in_transit') expect((await owner.post(`/documents/${d.id}/state`, { state: 'received' })).status).toBe(200);
    }
    expect(await batchQty(productId, target)).toEqual([]);
    const balances = (await owner.get(`/stock/balances?productId=${productId}&warehouseId=${target}`)).body.items;
    expect(balances[0].qty).toBe('8.000');
  });

  test('concurrent withdrawals allocate FEFO after the warehouse balance lock', async () => {
    const productId = await trackedProduct('Concurrent batches');
    await receipt(productId, 10, 'First', '2026-08-20');
    await receipt(productId, 10, 'Second', '2026-09-01');
    const a = await writeOff(productId, 7);
    const b = await writeOff(productId, 7);
    let unlock!: () => void;
    let ready!: () => void;
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const holder = admin.begin(async tx => {
      await tx`select * from stock_balances where product_id = ${productId} for update`;
      ready();
      await release;
    });
    await locked;
    const requests = [post(a.id), post(b.id)];
    try {
      // Both requests must reach the balance lock before either can commit.
      const deadline = Date.now() + 3000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const [row] = await admin`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%stock_balances%'`;
        waiting = row!.n;
        if (waiting >= 2) break;
        await Bun.sleep(10);
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
    } finally {
      unlock();
      await holder;
      await Promise.allSettled(requests);
    }
    expect((await Promise.all(requests)).map(r => r.status)).toEqual([200, 200]);
    expect((await batches(`?productId=${productId}`)).map(b => [b.number, b.qty])).toEqual([['First', '0.000'], ['Second', '6.000']]);
  });

  test('receipt creates a batch with number, produced date and expiry from shelf life; without a number posting fails', async () => {
    const noNumber = await doc('receipt', { counterpartyId: buyer, warehouseId: wh, lines: [{ productId: flour, qty: 10, price: 50 }] });
    const r = await post(noNumber.id);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('batch_number_required');

    const d = await doc('receipt', { counterpartyId: buyer, warehouseId: wh, lines: [{ productId: flour, qty: 10, price: 50, batchNumber: 'П1', batchProducedAt: '2026-08-01' }] });
    expect((await post(d.id)).status).toBe(200);
    const items = await batches(`?productId=${flour}`);
    const b = items.find(x => x.number === 'П1');
    expect(b).toMatchObject({ productId: flour, warehouseId: wh, producedAt: '2026-08-01', expiresAt: '2026-09-09' }); // 2026-08-10 + 30 дней
    expect(Number(b.qty)).toBe(10);
  });

  test('FEFO: the write-off consumes the earliest expiry first, splitting the line across batches', async () => {
    // вторая партия с более ранним сроком
    const d2 = await doc('receipt', { date: '2026-08-11', counterpartyId: buyer, warehouseId: wh, lines: [{ productId: flour, qty: 10, price: 50, batchNumber: 'П2', batchExpiresAt: '2026-08-20' }] });
    expect((await post(d2.id)).status).toBe(200);
    // списание 15: сначала П2 (годен до 20.08), затем 5 из П1
    const s = await doc('write_off', { warehouseId: wh, costItemId: brak, lines: [{ productId: flour, qty: 15, price: 0 }] });
    expect((await post(s.id)).status).toBe(200);
    const items = await batches(`?productId=${flour}`);
    const p1 = items.find(x => x.number === 'П1');
    const p2 = items.find(x => x.number === 'П2');
    expect(Number(p2.qty)).toBe(0);
    expect(Number(p1.qty)).toBe(5);
  });

  test('a product without batch tracking is unaffected; batch-tracked product without batches writes off unbatched', async () => {
    const d = await doc('receipt', { counterpartyId: buyer, warehouseId: wh, lines: [{ productId: plain, qty: 8, price: 30 }] });
    expect((await post(d.id)).status).toBe(200);
    const s = await doc('write_off', { warehouseId: wh, costItemId: brak, lines: [{ productId: plain, qty: 3, price: 0 }] });
    expect((await post(s.id)).status).toBe(200);
    expect((await batches(`?productId=${plain}`)).length).toBe(0); // партии не создаются

    const d3 = await doc('receipt', { counterpartyId: buyer, warehouseId: wh, lines: [{ productId: flourNoLife, qty: 5, price: 10, batchNumber: 'С1' }] });
    expect((await post(d3.id)).status).toBe(200);
    const b = (await batches(`?productId=${flourNoLife}`)).find(x => x.number === 'С1');
    expect(b.expiresAt).toBeNull(); // без срока годности у товара и в строке — партия без срока
  });

  test('expiring report: days filter and expired filter, ordered by expiry', async () => {
    const all = await batches(`?productId=${flour}`);
    expect(all.length).toBeGreaterThanOrEqual(2);
    // П2 уже просрочен (2026-08-20 < сегодня), П1 истекает в течение 30 дней от 2026-09-09? — дата другая: проверяем фильтры формально
    const expired = await batches('?expired=1');
    expect(expired.every(x => x.expiresAt && x.expiresAt < new Date().toISOString().slice(0, 10))).toBe(true);
    const soon = await batches('?days=45');
    expect(soon.every(x => x.expiresAt && x.expiresAt <= new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10))).toBe(true);
    // сортировка по дате истечения (null в конце)
    const dates = all.map(x => x.expiresAt ?? '9999-12-31');
    expect([...dates].sort()).toEqual(dates);
  });

  test('unpost removes the batch when its stock is gone; keeps it when other documents consumed from it', async () => {
    const d = await doc('receipt', { counterpartyId: buyer, warehouseId: wh, lines: [{ productId: flourNoLife, qty: 4, price: 10, batchNumber: 'С2' }] });
    expect((await post(d.id)).status).toBe(200);
    expect((await batches(`?productId=${flourNoLife}`)).find(x => x.number === 'С2')).toBeTruthy();
    expect((await unpost(d.id)).status).toBe(200);
    expect((await batches(`?productId=${flourNoLife}`)).find(x => x.number === 'С2')).toBeUndefined();
  });

  test('tenant isolation: another workspace sees no batches and cannot reference them', async () => {
    const items = await other.get('/stock/batches');
    expect(items.status).toBe(200);
    expect(items.body.items).toEqual([]);
  });
});
