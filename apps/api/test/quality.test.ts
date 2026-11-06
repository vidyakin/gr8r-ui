/* Контроль качества (задача 1186): карантин блокирует обычный расход, перемещение снимает ограничение;
   анализы партий изолированы арендаторами, справочник причин доступен только admin и owner. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let quarantine: string;
let warehouse: string;
let supplier: string;
let product: string;
let batchId: string;

const ok = async (r: { status: number; body: any }, label: string) => {
  if (r.status >= 300) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Quality WS' });
  member = new Client();
  await member.signup();
  const invite = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: invite.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other Quality WS' });

  quarantine = (await ok(await owner.post('/warehouses', { name: 'Карантин ОТК 1186', kind: 'quarantine' }), 'quarantine')).id;
  warehouse = (await ok(await owner.post('/warehouses', { name: 'Основной склад ОТК 1186' }), 'warehouse')).id;
  supplier = (await ok(await owner.post('/companies', { name: 'Поставщик качества' }), 'supplier')).id;
  product = (await ok(await owner.post('/products', { name: 'Сырьё ОТК', kind: 'goods', unitCode: '796', trackBatches: true, vatRate: 'none' }), 'product')).id;
  const receipt = await ok(await owner.post('/documents', {
    type: 'receipt', warehouseId: quarantine, counterpartyId: supplier,
    lines: [{ productId: product, qty: 10, price: 20, batchNumber: 'QC-001' }],
  }), 'receipt');
  await ok(await owner.post(`/documents/${receipt.id}/post`), 'post receipt');
  batchId = (await ok(await owner.get(`/stock/batches?warehouseId=${quarantine}`), 'batches')).items[0].batchId;
});

const post = async (body: any, label: string) => {
  const doc = await ok(await owner.post('/documents', body), label);
  return owner.post(`/documents/${doc.id}/post`);
};
const stockBatchesOf = async (warehouseId: string) => (await ok(await owner.get(`/stock/batches?warehouseId=${warehouseId}`), 'batches')).items as any[];
const receiveAt = async (warehouseId: string, number: string, qty: number, expires?: string) =>
  ok(await post({ type: 'receipt', warehouseId, counterpartyId: supplier, lines: [{ productId: product, qty, price: 20, batchNumber: number, ...(expires ? { batchExpiresAt: expires } : {}) }] }, 'receipt ' + number), 'post ' + number);
const setStatus = async (id: string, status: string) => ok(await owner.patch(`/stock/batches/${id}/status`, { status }), 'status');
const costItem = async (brak: boolean) => (await owner.get('/cost-items')).body.items.find((x: any) => (x.systemKey === 'brak') === brak && !x.archivedAt);

describe('quality control', () => {
  test('receipt to a quarantine warehouse creates a quarantine batch', async () => {
    const [b] = await stockBatchesOf(quarantine);
    expect(b.status).toBe('quarantine');
  });

  test('blocks ordinary issue from quarantine', async () => {
    const cost = await costItem(false);
    const blocked = await post({ type: 'write_off', warehouseId: quarantine, costItemId: cost.id, lines: [{ productId: product, qty: 1, price: 0 }] }, 'issue');
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('quarantine_blocked');
  });

  test('transfer from quarantine: not accepted batch is blocked, accepted one moves with its status', async () => {
    const transfer = { type: 'stock_transfer', operation: 'transfer', warehouseId: quarantine, targetWarehouseId: warehouse, lines: [{ productId: product, qty: 2, price: 0 }] };
    const denied = await post(transfer, 'transfer');
    expect(denied.status).toBe(422);
    expect(denied.body.error.code).toBe('batch_blocked');
    await setStatus(batchId, 'ok');
    expect((await post(transfer, 'transfer 2')).status).toBe(200);
    const moved = (await stockBatchesOf(warehouse)).find(x => x.number === 'QC-001');
    expect(moved.status).toBe('ok');
    expect(Number(moved.qty)).toBe(2);
    await setStatus(batchId, 'quarantine');
  });

  test('rejected batch leaves quarantine by supplier return or defect write-off only', async () => {
    await setStatus(batchId, 'rejected');
    const brak = await costItem(true);
    const written = await post({ type: 'write_off', warehouseId: quarantine, costItemId: brak.id, lines: [{ productId: product, qty: 1, price: 0 }] }, 'brak');
    expect(written.status).toBe(200);
    const returned = await post({ type: 'supplier_return', warehouseId: quarantine, counterpartyId: supplier, lines: [{ productId: product, qty: 1, price: 20 }] }, 'return');
    expect(returned.status).toBe(200);
    const [left] = await stockBatchesOf(quarantine);
    expect(Number(left.qty)).toBe(6); // 10 - 2 (перемещение) - 1 (брак) - 1 (возврат)
  });

  test('FEFO skips batches that are not ok', async () => {
    await receiveAt(warehouse, 'FE-EARLY', 5, '2030-01-01');
    await receiveAt(warehouse, 'FE-LATE', 5, '2030-06-01');
    const early = (await stockBatchesOf(warehouse)).find(x => x.number === 'FE-EARLY');
    await setStatus(early.batchId, 'quarantine');
    const cost = await costItem(false);
    const issued = await post({ type: 'write_off', warehouseId: warehouse, costItemId: cost.id, lines: [{ productId: product, qty: 3, price: 0 }] }, 'fefo');
    expect(issued.status).toBe(200);
    const after = await stockBatchesOf(warehouse);
    expect(Number(after.find(x => x.number === 'FE-EARLY').qty)).toBe(5);
    expect(Number(after.find(x => x.number === 'FE-LATE').qty)).toBe(2);
    // в ok осталось 4 (FE-LATE 2 + принятая QC-001 2), остальное лежит в заблокированной партии
    const over = await post({ type: 'write_off', warehouseId: warehouse, costItemId: cost.id, lines: [{ productId: product, qty: 5, price: 0 }] }, 'fefo over');
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('batch_blocked');
  });

  test('batch analyses support create, list and delete with tenant isolation', async () => {
    const created = await owner.post(`/stock/batches/${batchId}/analyses`, { indicator: 'Влажность', result: '12.4', norm: '< 14', passed: true });
    expect(created.status).toBe(201);
    const listed = await owner.get(`/stock/batches/${batchId}/analyses`);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({ indicator: 'Влажность', passed: true });
    expect((await owner.del(`/stock/batches/${batchId}/analyses/${created.body.id}`)).status).toBe(200);
    expect((await other.get(`/stock/batches/${batchId}/analyses`)).status).toBe(404);
  });

  test('analysis of another batch is not reachable through this batch', async () => {
    const created = await ok(await owner.post(`/stock/batches/${batchId}/analyses`, { indicator: 'Белок', passed: false }), 'analysis');
    const foreign = (await stockBatchesOf(warehouse)).find(x => x.number === 'FE-LATE').batchId;
    expect((await owner.patch(`/stock/batches/${foreign}/analyses/${created.id}`, { result: '1' })).status).toBe(404);
    expect((await owner.del(`/stock/batches/${foreign}/analyses/${created.id}`)).status).toBe(404);
    expect((await owner.patch(`/stock/batches/${batchId}/analyses/${created.id}`, { result: '1' })).status).toBe(200);
  });

  test('defect reasons are writable by admin only', async () => {
    const created = await owner.post('/defect-reasons', { name: 'Недовес', note: 'Проверить дозирование' });
    expect(created.status).toBe(201);
    expect((await owner.get('/defect-reasons')).body.items[0].name).toBe('Недовес');
    expect((await member.post('/defect-reasons', { name: 'Попытка участника' })).status).toBe(403);
    expect((await owner.del(`/defect-reasons/${created.body.id}`)).status).toBe(200);
  });
});

describe('OTK of a production release', () => {
  let center: string;
  let item: string;
  let release: any;
  let itemId: string;

  beforeAll(async () => {
    const wood = (await ok(await owner.post('/products', { name: 'Брус ОТК', price: 100, purchasePrice: 80, vatRate: 'none' }), 'wood')).id;
    const workshop = (await ok(await owner.post('/warehouses', { name: 'Цех ОТК', kind: 'workshop' }), 'workshop')).id;
    const fg = (await ok(await owner.post('/warehouses', { name: 'Готовая ОТК' }), 'fg')).id;
    const defectWh = (await ok(await owner.post('/warehouses', { name: 'Брак ОТК' }), 'defectWh')).id;
    center = (await ok(await owner.post('/work-centers', { name: 'Участок ОТК', hourlyRate: 100, warehouseId: workshop, outputWarehouseId: fg, defectWarehouseId: defectWh }), 'center')).id;
    const prod = (await ok(await owner.post('/products', { name: 'Стол ОТК', price: 5000 }), 'prod')).id;
    item = (await ok(await owner.post('/manufactured-items', { name: 'Стол ОТК', productId: prod }), 'item')).id;
    await ok(await owner.post(`/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty: 2 }), 'line');
    const rc = await ok(await owner.post('/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, lines: [{ productId: wood, qty: 100, price: 80 }] }), 'rc');
    await ok(await owner.post(`/documents/${rc.id}/post`), 'post rc');
    const o = await ok(await owner.post('/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '4' }] }), 'order');
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const detail = (await owner.get(`/production-orders/${o.id}`)).body;
    release = await ok(await owner.post(`/production-orders/${o.id}/production`, { date: '2026-03-02', lines: [{ orderItemId: detail.items[0].id, qty: '4' }] }), 'release');
    itemId = release.items[0].id;
  });

  test('reason without defect is 422, then defect + reason + culprit + note; a note-only patch keeps the reason', async () => {
    const reason = (await ok(await owner.post('/defect-reasons', { name: 'Трещина ОТК' }), 'reason')).id;
    const me = (await owner.get('/members')).body.items[0].id;
    const bad = await owner.patch(`/production-orders/${release.id}/accounting`, { qc: [{ itemId, defectReasonId: reason }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('defect_required');
    await ok(await owner.patch(`/production-orders/${release.id}/accounting`, { defects: [{ itemId, defectQty: '2', defectMode: 'expense' }] }), 'defects');
    await ok(await owner.patch(`/production-orders/${release.id}/accounting`, { qc: [{ itemId, defectReasonId: reason, defectMemberId: me, qcNote: 'при сушке' }] }), 'qc');
    await ok(await owner.patch(`/production-orders/${release.id}/accounting`, { qc: [{ itemId, qcNote: 'повторно' }] }), 'note only');
    const it = (await owner.get(`/documents/${release.id}`)).body.items[0];
    expect(it).toMatchObject({ defectReasonId: reason, defectMemberId: me, qcNote: 'повторно' });
    await ok(await owner.patch(`/production-orders/${release.id}/accounting`, { qc: [{ itemId, defectReasonId: null }] }), 'clear');
    const cleared = (await owner.get(`/documents/${release.id}`)).body.items[0];
    expect(cleared.defectReasonId).toBeNull();
    expect(cleared.defectMemberId).toBe(me);
  });

  test('rework: 422 no_defects without defects, then an order for the defect quantity', async () => {
    const o2 = await ok(await owner.post('/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '2' }] }), 'order2');
    await owner.post(`/production-orders/${o2.id}/fill-from-bom`);
    await owner.post(`/documents/${o2.id}/post`);
    const d2 = (await owner.get(`/production-orders/${o2.id}`)).body;
    const clean = await ok(await owner.post(`/production-orders/${o2.id}/production`, { date: '2026-03-03', lines: [{ orderItemId: d2.items[0].id, qty: '2' }] }), 'clean');
    await ok(await owner.post(`/documents/${clean.id}/post`), 'post clean');
    const none = await owner.post(`/production/${clean.id}/rework`, { itemId: clean.items[0].id });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('no_defects');

    await ok(await owner.post(`/documents/${release.id}/post`), 'post release');
    const rw = await ok(await owner.post(`/production/${release.id}/rework`, { itemId }), 'rework');
    const order = (await owner.get(`/production-orders/${rw.id}`)).body;
    expect(order.items[0].qty).toBe('2.000');
  });
});
