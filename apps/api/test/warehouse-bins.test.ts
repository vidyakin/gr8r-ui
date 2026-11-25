import { beforeAll, expect, test } from 'bun:test';
import { Client } from './helpers';

const owner = new Client();
let warehouseId: string;
let supplierId: string;
let customerId: string;
let binA: string;
let binB: string;
const declaration = '10005030/250326/0000123';

async function create(path: string, payload: Record<string, unknown>) {
  const response = await owner.post(path, payload);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}

const post = (id: string) => owner.post(`/documents/${id}/post`);
const unpost = (id: string) => owner.post(`/documents/${id}/unpost`);
const line = (productId: string, qty: number, extra: Record<string, unknown> = {}) => ({ productId, qty, price: 100, ...extra });
const document = (type: string, lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
  create('/documents', { type, warehouseId, lines, ...extra });

beforeAll(async () => {
  await owner.signup({ workspaceName: 'Адресный склад' });
  warehouseId = (await owner.get('/warehouses')).body.items[0].id;
  const warehouse = await owner.patch(`/warehouses/${warehouseId}`, { useBins: true });
  expect(warehouse.body).toMatchObject({ useBins: true });
  supplierId = (await create('/companies', { name: 'Поставщик' })).id;
  customerId = (await create('/companies', { name: 'Покупатель' })).id;
  const path = `/warehouses/${warehouseId}/bins`;
  const zone = await create(path, { code: 'A', zone: 'A' });
  binA = (await create(path, { code: 'A-01', parentId: zone.id })).id;
  binB = (await create(path, { code: 'A-02', parentId: zone.id })).id;
  expect((await owner.patch(`${path}/${zone.id}`, { parentId: binA })).status).toBe(422);
  expect((await owner.del(`${path}/${zone.id}`)).status).toBe(422);
});

test('concurrent shipments compete for the selected bin and print the customs data from its batch', async () => {
  const { id: productId } = await create('/products', { name: 'Импортная фурнитура', unitCode: '796', trackBatches: true });
  const receipt = await document('receipt', [
    line(productId, 6, { binId: binA, batchNumber: 'CN', batchExpiresAt: '2028-03-01', gtdNumber: declaration, originCountry: 'CN' }),
    line(productId, 8, { binId: binB, batchNumber: 'DE', batchExpiresAt: '2028-01-01', gtdNumber: '200/300/400', originCountry: 'DE' }),
  ], { counterpartyId: supplierId });
  expect((await post(receipt.id)).status).toBe(200);
  const first = await document('realization', [line(productId, 4, { binId: binA })], { counterpartyId: customerId });
  const second = await document('realization', [line(productId, 4, { binId: binA })], { counterpartyId: customerId });

  const results = await Promise.all([post(first.id), post(second.id)]);
  expect(results.map(r => r.status).sort()).toEqual([200, 422]);
  expect(results.find(r => r.status === 422)?.body.error.code).toBe('insufficient_bin_stock');
  const shipment = results.find(r => r.status === 200)!.body;
  expect(shipment.lines[0]).toMatchObject({ binId: binA, gtdNumber: declaration, originCountry: 'CN' });
  for (const form of ['upd', 'vat_invoice']) {
    const html = await owner.get<string>(`/documents/${shipment.id}/print/${form}`);
    expect(html.status).toBe(200);
    expect(html.body).toContain(`>156</td><td class="center">Китай</td><td class="center">${declaration}</td>`);
  }
  expect((await unpost(receipt.id)).body.error.code).toBe('stock_conflict');
  expect((await unpost(shipment.id)).status).toBe(200);
  const balances = await owner.get(`/warehouses/${warehouseId}/bin-balances`);
  expect(balances.body.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ binId: binA, productId, qty: '6.000' }),
    expect.objectContaining({ binId: binB, productId, qty: '8.000' }),
  ]));
});

test('direct placement from unassigned stock, write-off and partial transit receipt use the proper bins', async () => {
  const { id: productId } = await create('/products', { name: 'Крепёж', unitCode: '796' });
  const receipt = await document('receipt', [line(productId, 5)], { counterpartyId: supplierId });
  expect((await post(receipt.id)).status).toBe(200);
  const placement = await document('stock_transfer', [line(productId, 5, { toBinId: binA })], { targetWarehouseId: warehouseId });
  expect((await post(placement.id)).status).toBe(200);
  const move = await document('stock_transfer', [line(productId, 2, { binId: binA, toBinId: binB })], { targetWarehouseId: warehouseId });
  expect((await post(move.id)).status).toBe(200);
  const scrap = (await owner.get('/cost-items')).body.items.find((item: { systemKey: string }) => item.systemKey === 'brak').id;
  const writeOff = await document('write_off', [line(productId, 1, { binId: binB })], { costItemId: scrap });
  expect((await post(writeOff.id)).status).toBe(200);

  const other = await create('/warehouses', { name: 'Приёмный склад', useBins: true });
  const target = await create(`/warehouses/${other.id}/bins`, { code: 'P-01' });
  const transit = await document('stock_transfer', [line(productId, 2, { binId: binA, toBinId: target.id })], {
    operation: 'in_transit', targetWarehouseId: other.id,
  });
  expect((await post(transit.id)).status).toBe(200);
  const targetBalances = `/warehouses/${other.id}/bin-balances`;
  expect((await owner.get(targetBalances)).body.items).toEqual([]);
  const state = `/documents/${transit.id}/state`;
  expect((await owner.post(state, { state: 'received', received: [{ id: transit.lines[0].id, qty: '1' }] })).status).toBe(200);
  expect((await owner.get(targetBalances)).body.items).toEqual([expect.objectContaining({ binId: target.id, qty: '1.000' })]);
  expect((await owner.post(state, { state: 'shipped' })).status).toBe(200);
  expect((await owner.get(targetBalances)).body.items).toEqual([]);
  expect((await owner.del(`/warehouses/${warehouseId}/bins/${binB}`)).body.error.code).toBe('warehouse_bin_not_empty');
});

test('a warehouse with bin storage disabled continues to ship from its warehouse balance', async () => {
  const wh = await create('/warehouses', { name: 'Обычный склад' });
  expect(wh.useBins).toBe(false);
  const { id: productId } = await create('/products', { name: 'Обычная номенклатура', unitCode: '796' });
  const receipt = await document('receipt', [line(productId, 3)], { warehouseId: wh.id, counterpartyId: supplierId });
  expect((await post(receipt.id)).status).toBe(200);
  const shipment = await document('realization', [line(productId, 2)], { warehouseId: wh.id, counterpartyId: customerId });
  expect((await post(shipment.id)).status).toBe(200);
  expect((await owner.get(`/warehouses/${wh.id}/bin-balances`)).body.items).toEqual([]);
  expect((await owner.get(`/stock/balances?warehouseId=${wh.id}&productId=${productId}`)).body.items[0].qty).toBe('1.000');
});
