import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let supplier: string;
let product: string;
let warehouse: string;

const ok = async (r: { status: number; body: any }, label: string) => {
  if (r.status >= 300) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'SR WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other SR WS' });

  supplier = (await ok(await owner.post('/companies', { name: 'Поставщик рейтинга' }), 'supplier')).id;
  product = (await ok(await owner.post('/products', { name: 'Товар рейтинга', kind: 'goods', unitCode: '796', trackBatches: true, vatRate: 'none' }), 'product')).id;
  warehouse = (await ok(await owner.post('/warehouses', { name: 'Склад рейтинга' }), 'warehouse')).id;
});

const postDoc = async (docId: string) => ok(await owner.post(`/documents/${docId}/post`), 'post');
const setBatch = async (docId: string, bn: string) => { const d = await owner.get(`/documents/${docId}`); const l = d.body.lines[0]; await owner.patch(`/documents/${docId}`, { lines: [{ id: l.id, productId: l.productId, qty: l.qty, price: l.price, batchNumber: bn }] }); };

describe('supplier rating', () => {
  test('on-time 50% with two orders', async () => {
    const o1 = await ok(await owner.post('/documents', { type: 'supplier_order', counterpartyId: supplier, warehouseId: warehouse, dueDate: '2026-11-10', lines: [{ productId: product, qty: 10, price: 20 }] }), 'order1');
    await postDoc(o1.id);
    const o2 = await ok(await owner.post('/documents', { type: 'supplier_order', counterpartyId: supplier, warehouseId: warehouse, dueDate: '2026-11-10', lines: [{ productId: product, qty: 10, price: 20 }] }), 'order2');
    await postDoc(o2.id);

    const r1 = (await ok(await owner.post(`/documents/${o1.id}/based-on`, { type: 'receipt' }), 'based1'));
    await setBatch(r1.id, 'B1');
    await owner.patch(`/documents/${r1.id}`, { date: '2026-11-05' });
    await postDoc(r1.id);

    const r2 = (await ok(await owner.post(`/documents/${o2.id}/based-on`, { type: 'receipt' }), 'based2'));
    await setBatch(r2.id, 'B2');
    await owner.patch(`/documents/${r2.id}`, { date: '2026-11-15' });
    await postDoc(r2.id);

    const detail = await owner.get(`/supplier-ratings/${supplier}?from=2026-01-01&to=2026-12-31`);
    expect(detail.status).toBe(200);
    expect(detail.body.onTimeRate).toBe(50);
  });

  test('partial receipt -> completeness', async () => {
    const s2 = (await ok(await owner.post('/companies', { name: 'Поставщик полнота' }), 's2')).id;
    const o = await ok(await owner.post('/documents', { type: 'supplier_order', counterpartyId: s2, warehouseId: warehouse, dueDate: '2026-11-10', lines: [{ productId: product, qty: 10, price: 20 }] }), 'order');
    await postDoc(o.id);
    const r = (await ok(await owner.post(`/documents/${o.id}/based-on`, { type: 'receipt' }), 'based'));
    const detailDoc = await owner.get(`/documents/${r.id}`);
    const lineId = detailDoc.body.lines[0].id;
    await owner.patch(`/documents/${r.id}`, { lines: [{ id: lineId, productId: product, qty: 4, price: 20, batchNumber: 'B3' }] });
    await owner.patch(`/documents/${r.id}`, { date: '2026-11-05' });
    await postDoc(r.id);

    const detail = await owner.get(`/supplier-ratings/${s2}?from=2026-01-01&to=2026-12-31`);
    expect(detail.body.completenessRate).toBe(40);
  });

  test('rejected batch -> quality', async () => {
    const s3 = (await ok(await owner.post('/companies', { name: 'Поставщик качество' }), 's3')).id;
    const o = await ok(await owner.post('/documents', { type: 'supplier_order', counterpartyId: s3, warehouseId: warehouse, dueDate: '2026-11-10', lines: [{ productId: product, qty: 10, price: 20 }] }), 'order');
    await postDoc(o.id);
    const r = (await ok(await owner.post(`/documents/${o.id}/based-on`, { type: 'receipt' }), 'based'));
    await setBatch(r.id, 'BREJ');
    await owner.patch(`/documents/${r.id}`, { date: '2026-11-05' });
    await postDoc(r.id);
    const batches = (await ok(await owner.get(`/stock/batches?warehouseId=${warehouse}`), 'batches')).items as any[];
    const lastBatch = batches[batches.length - 1];
    await ok(await owner.patch(`/stock/batches/${lastBatch.batchId ?? lastBatch.id}/status`, { status: 'rejected' }), 'reject');
    const detail = await owner.get(`/supplier-ratings/${s3}?from=2026-01-01&to=2026-12-31`);
    expect(detail.body.qualityRate).toBeLessThan(100);
  });

  test('no data -> null', async () => {
    const s4 = (await ok(await owner.post('/companies', { name: 'Пустой поставщик' }), 's4')).id;
    const detail = await owner.get(`/supplier-ratings/${s4}?from=2026-01-01&to=2026-12-31`);
    expect(detail.body.rating).toBeNull();
    expect(detail.body.level).toBeNull();
  });

  test('block policy -> 422', async () => {
    await owner.patch('/supplier-ratings/settings', { dPolicy: 'block' });
    const s5 = (await ok(await owner.post('/companies', { name: 'D поставщик' }), 's5')).id;
    const r = await ok(await owner.post('/documents', { type: 'receipt', counterpartyId: s5, warehouseId: warehouse, date: '2026-11-05', lines: [{ productId: product, qty: 10, price: 20, batchNumber: 'BD' }] }), 'receipt');
    await postDoc(r.id);
    const batches = (await ok(await owner.get(`/stock/batches?warehouseId=${warehouse}`), 'batches')).items as any[];
    const lastBatch = batches[batches.length - 1];
    await ok(await owner.patch(`/stock/batches/${lastBatch.batchId ?? lastBatch.id}/status`, { status: 'rejected' }), 'reject');

    const o2 = await ok(await owner.post('/documents', { type: 'supplier_order', counterpartyId: s5, warehouseId: warehouse, dueDate: '2026-11-10', lines: [{ productId: product, qty: 10, price: 20 }] }), 'order2');
    const postRes = await owner.post(`/documents/${o2.id}/post`);
    expect(postRes.status).toBe(422);
    expect(postRes.body.error.code).toBe('supplier_rating_blocked');
    await owner.patch('/supplier-ratings/settings', { dPolicy: 'none' });
  });

  test('warn policy -> 200 with warning', async () => {
    await owner.patch('/supplier-ratings/settings', { dPolicy: 'warn' });
    const s6 = (await ok(await owner.post('/companies', { name: 'Warn поставщик' }), 's6')).id;
    const r = await ok(await owner.post('/documents', { type: 'receipt', counterpartyId: s6, warehouseId: warehouse, date: '2026-11-05', lines: [{ productId: product, qty: 10, price: 20, batchNumber: 'BW' }] }), 'receipt');
    await postDoc(r.id);
    const batches = (await ok(await owner.get(`/stock/batches?warehouseId=${warehouse}`), 'batches')).items as any[];
    const lastBatch = batches[batches.length - 1];
    await ok(await owner.patch(`/stock/batches/${lastBatch.batchId ?? lastBatch.id}/status`, { status: 'rejected' }), 'reject');

    const o2 = await ok(await owner.post('/documents', { type: 'supplier_order', counterpartyId: s6, warehouseId: warehouse, dueDate: '2026-11-10', lines: [{ productId: product, qty: 10, price: 20 }] }), 'order2');
    const postRes = await owner.post(`/documents/${o2.id}/post`);
    expect(postRes.status).toBe(200);
    expect(Array.isArray(postRes.body.warnings)).toBe(true);
    expect(postRes.body.warnings.length).toBeGreaterThan(0);
    await owner.patch('/supplier-ratings/settings', { dPolicy: 'none' });
  });

  test('none policy -> 200', async () => {
    const s7 = (await ok(await owner.post('/companies', { name: 'None поставщик' }), 's7')).id;
    const r = await ok(await owner.post('/documents', { type: 'receipt', counterpartyId: s7, warehouseId: warehouse, date: '2026-11-05', lines: [{ productId: product, qty: 10, price: 20, batchNumber: 'BN' }] }), 'receipt');
    await postDoc(r.id);
    const batches = (await ok(await owner.get(`/stock/batches?warehouseId=${warehouse}`), 'batches')).items as any[];
    const lastBatch = batches[batches.length - 1];
    await ok(await owner.patch(`/stock/batches/${lastBatch.batchId ?? lastBatch.id}/status`, { status: 'rejected' }), 'reject');

    const o2 = await ok(await owner.post('/documents', { type: 'supplier_order', counterpartyId: s7, warehouseId: warehouse, dueDate: '2026-11-10', lines: [{ productId: product, qty: 10, price: 20 }] }), 'order2');
    const postRes = await owner.post(`/documents/${o2.id}/post`);
    expect(postRes.status).toBe(200);
  });

  test('tenant isolation', async () => {
    const list = await other.get('/supplier-ratings?from=2026-01-01&to=2026-12-31');
    expect(list.status).toBe(200);
    expect((list.body.items as any[]).some((x: any) => x.companyName === 'Поставщик рейтинга')).toBe(false);
  });

  test('member patch settings -> 403', async () => {
    const r = await member.patch('/supplier-ratings/settings', { dPolicy: 'warn' });
    expect(r.status).toBe(403);
  });

  test('list returns items', async () => {
    const list = await owner.get('/supplier-ratings?from=2026-01-01&to=2026-12-31');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.items)).toBe(true);
  });
});
