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

describe('quality control', () => {
  test('blocks ordinary issue from quarantine and permits transfer out', async () => {
    const cost = (await owner.get('/cost-items')).body.items.find((x: any) => x.systemKey === 'brak');
    const issue = await owner.post('/documents', {
      type: 'write_off', warehouseId: quarantine, costItemId: cost.id,
      lines: [{ productId: product, qty: 1, price: 0 }],
    });
    const blocked = await owner.post(`/documents/${issue.body.id}/post`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('quarantine_blocked');

    const transfer = await owner.post('/documents', {
      type: 'stock_transfer', operation: 'transfer', warehouseId: quarantine, targetWarehouseId: warehouse,
      lines: [{ productId: product, qty: 2, price: 0 }],
    });
    expect((await owner.post(`/documents/${transfer.body.id}/post`)).status).toBe(200);
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

  test('defect reasons are writable by admin only', async () => {
    const created = await owner.post('/defect-reasons', { name: 'Недовес', note: 'Проверить дозирование' });
    expect(created.status).toBe(201);
    expect((await owner.get('/defect-reasons')).body.items[0].name).toBe('Недовес');
    expect((await member.post('/defect-reasons', { name: 'Попытка участника' })).status).toBe(403);
    expect((await owner.del(`/defect-reasons/${created.body.id}`)).status).toBe(200);
  });
});
