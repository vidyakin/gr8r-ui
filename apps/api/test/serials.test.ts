/* Серийные номера (задача 1099): проведение без номеров — 422; путь номера поступление → перемещение → продажа (гарантия) →
   возврат; повторная продажа проданного; отмена проведения возвращает состояние; материалы заказ-наряда; RLS. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let other: Client;
let wh1: string;
let wh2: string;
let customer: string;
let phone: string; // с учётом по номерам, гарантия 12 мес.
let plain: string; // без учёта по номерам
let brak: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const doc = (type: string, body: Record<string, unknown>) => mk(owner, '/documents', { type, date: '2026-08-10', priceIncludesVat: false, ...body });
const post = (id: string) => owner.post(`/documents/${id}/post`);
const unpost = (id: string) => owner.post(`/documents/${id}/unpost`);
const serial = async (text: string) => ((await owner.get(`/serials?q=${text}`)).body.items as any[]).find(s => s.serial === text);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Серийные номера WS' });
  wh1 = (await owner.get('/warehouses')).body.items[0].id;
  wh2 = (await mk(owner, '/warehouses', { name: 'Второй склад', code: 'W2' })).id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7728168971' })).id;
  phone = (await mk(owner, '/products', { name: 'Телефон', kind: 'goods', unitCode: '796', price: 1000, purchasePrice: 500, vatRate: 'none', trackSerials: true, warrantyMonths: 12 })).id;
  plain = (await mk(owner, '/products', { name: 'Чехол', kind: 'goods', unitCode: '796', price: 100, purchasePrice: 50, vatRate: 'none' })).id;
  brak = ((await owner.get('/cost-items')).body.items as any[]).find(i => i.systemKey === 'brak').id;
  other = new Client();
  await other.signup({ workspaceName: 'Чужой WS' });
});

describe('serial numbers on stock documents', () => {
  let receipt: string;
  let sale: string;

  test('posting without serial numbers is 422 with a clear code', async () => {
    const d = await doc('receipt', { counterpartyId: customer, warehouseId: wh1, lines: [{ productId: phone, qty: 3, price: 500 }] });
    const r = await post(d.id);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('serials_required');
    // неполный список — тоже ошибка
    const line = (await owner.get(`/documents/${d.id}`)).body.lines[0].id;
    expect((await owner.put(`/documents/${d.id}/serials`, { lineId: line, serials: ['P1', 'P2'] })).status).toBe(200);
    expect((await post(d.id)).body.error.code).toBe('serials_required');
    expect((await owner.put(`/documents/${d.id}/serials`, { lineId: line, serials: ['P1', 'P2', 'P3'] })).status).toBe(200);
    expect((await post(d.id)).status).toBe(200);
    receipt = d.id;
    const p1 = await serial('P1');
    expect(p1).toMatchObject({ status: 'in_stock', warehouseId: wh1, productId: phone });
  });

  test('a product without tracking takes no serial numbers; a duplicate receipt of a number in stock fails', async () => {
    const d = await doc('receipt', { counterpartyId: customer, warehouseId: wh1, lines: [{ productId: plain, qty: 2, price: 50 }] });
    const line = (await owner.get(`/documents/${d.id}`)).body.lines[0].id;
    expect((await owner.put(`/documents/${d.id}/serials`, { lineId: line, serials: ['X'] })).body.error.code).toBe('serials_not_tracked');
    expect((await post(d.id)).status).toBe(200);
    const dup = await doc('receipt', { counterpartyId: customer, warehouseId: wh1, lines: [{ productId: phone, qty: 1, price: 500, serials: ['p1'] }] });
    const r = await post(dup.id);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('serial_in_stock');
  });

  test('transfer moves the number to another warehouse; sale sets the warranty; a sold number cannot be sold again', async () => {
    const t = await doc('stock_transfer', { warehouseId: wh1, targetWarehouseId: wh2, operation: 'transfer', lines: [{ productId: phone, qty: 2, price: 0, serials: ['P1', 'P2'] }] });
    expect((await post(t.id)).status).toBe(200);
    expect(await serial('P1')).toMatchObject({ status: 'in_stock', warehouseId: wh2 });
    // со склада 1 номера уже нет
    const wrong = await doc('realization', { counterpartyId: customer, warehouseId: wh1, lines: [{ productId: phone, qty: 1, price: 1000, serials: ['P1'] }] });
    expect((await post(wrong.id)).body.error.code).toBe('serial_wrong_warehouse');
    const s = await doc('realization', { counterpartyId: customer, warehouseId: wh2, lines: [{ productId: phone, qty: 1, price: 1000, serials: ['P1'] }] });
    expect((await post(s.id)).status).toBe(200);
    sale = s.id;
    const p1 = await serial('P1');
    expect(p1).toMatchObject({ status: 'sold', soldAt: '2026-08-10', warrantyUntil: '2027-08-10', ownerCompanyId: customer, soldDocumentId: sale });
    const again = await doc('realization', { counterpartyId: customer, warehouseId: wh2, lines: [{ productId: phone, qty: 1, price: 1000, serials: ['P1'] }] });
    const r = await post(again.id);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('serial_not_in_stock');
  });

  test('warranty lookup and the manual warranty date', async () => {
    const l = (await owner.get('/serials/lookup?serial=p1')).body.items as any[];
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ productName: 'Телефон', ownerName: 'ООО «Покупатель»', warrantyUntil: '2027-08-10', status: 'sold' });
    const id = l[0].serialId;
    const card = await owner.patch(`/serials/${id}`, { warrantyUntil: '2028-01-31' });
    expect(card.status).toBe(200);
    expect(card.body.warrantyUntil).toBe('2028-01-31');
    expect(card.body.events.map((e: any) => e.documentType)).toEqual(['receipt', 'stock_transfer', 'stock_transfer', 'realization']);
  });

  test('unposting the sale returns the number to stock; the receipt cannot be unposted while the number is used', async () => {
    const ur = await unpost(receipt);
    expect(ur.body.error.code).toBe('serial_conflict');
    expect((await unpost(sale)).status).toBe(200);
    expect(await serial('P1')).toMatchObject({ status: 'in_stock', warehouseId: wh2, soldAt: null, warrantyUntil: null });
    expect((await post(sale)).status).toBe(200);
    // возврат покупателя возвращает номер на склад
    const ret = await owner.post(`/documents/${sale}/based-on`, { type: 'customer_return' });
    expect(ret.status).toBe(201);
    const rid = ret.body.id;
    expect((await owner.get(`/documents/${rid}`)).body.lines).toHaveLength(1);
    const rline = (await owner.get(`/documents/${rid}`)).body.lines[0].id;
    expect((await post(rid)).body.error.code).toBe('serials_required');
    await owner.put(`/documents/${rid}/serials`, { lineId: rline, serials: ['P1'] });
    expect((await post(rid)).status).toBe(200);
    expect(await serial('P1')).toMatchObject({ status: 'in_stock', soldAt: null });
    expect((await unpost(rid)).status).toBe(200);
    expect(await serial('P1')).toMatchObject({ status: 'sold' });
  });

  test('write-off and an integer quantity', async () => {
    await post((await doc('receipt', { counterpartyId: customer, warehouseId: wh1, lines: [{ productId: phone, qty: 2, price: 500, serials: ['P4', 'P5'] }] })).id);
    const w = await doc('write_off', { warehouseId: wh1, costItemId: brak, lines: [{ productId: phone, qty: 1, price: 0, serials: ['P4'] }] });
    expect((await post(w.id)).status).toBe(200);
    expect(await serial('P4')).toMatchObject({ status: 'written_off', warehouseId: null });
    expect((await unpost(w.id)).status).toBe(200);
    expect(await serial('P4')).toMatchObject({ status: 'in_stock', warehouseId: wh1 });
    const frac = await doc('write_off', { warehouseId: wh1, costItemId: brak, lines: [{ productId: phone, qty: 1.5, price: 0, serials: ['P4'] }] });
    expect((await post(frac.id)).body.error.code).toBe('serial_qty_not_integer');
  });

  test('materials of a work order take serial numbers', async () => {
    const wo = await doc('work_order', { counterpartyId: customer, warehouseId: wh1, lines: [{ productId: plain, qty: 1, price: 100 }] });
    const m = await owner.post(`/work-orders/${wo.id}/materials`, { materials: [{ productId: phone, qty: 1 }] });
    expect(m.status).toBe(200);
    const mid = m.body.materials[0].id;
    const r = await owner.post(`/documents/${wo.id}/state`, { state: 'done' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('serials_required');
    await owner.put(`/documents/${wo.id}/serials`, { materialId: mid, serials: ['P3'] });
    expect((await owner.post(`/documents/${wo.id}/state`, { state: 'done' })).status).toBe(200);
    expect(await serial('P3')).toMatchObject({ status: 'written_off' });
    expect((await owner.post(`/documents/${wo.id}/state`, { state: 'in_progress' })).status).toBe(200);
    expect(await serial('P3')).toMatchObject({ status: 'in_stock', warehouseId: wh1 });
  });

  test('inventory: the counted numbers must match the register; the shortage document gets the missing ones', async () => {
    const inv = await doc('inventory_count', { warehouseId: wh1, lines: [{ productId: phone, qty: 2, bookQty: 3, price: 0, serials: ['P4', 'P5'] }] });
    expect((await post(inv.id)).status).toBe(200);
    const sh = await owner.post(`/documents/${inv.id}/based-on`, { type: 'write_off' });
    expect(sh.status).toBe(201);
    const wl = (await owner.get(`/documents/${sh.body.id}`)).body;
    expect(wl.serials.map((s: any) => s.serial)).toEqual(['P3']);
    expect((await post(sh.body.id)).status).toBe(200);
    expect(await serial('P3')).toMatchObject({ status: 'written_off' });
  });
});

describe('isolation', () => {
  test('another workspace sees neither the register nor the card', async () => {
    expect((await other.get('/serials')).body.items).toHaveLength(0);
    expect((await other.get('/serials/lookup?serial=P1')).body.items).toHaveLength(0);
    const id = (await owner.get('/serials/lookup?serial=P1')).body.items[0].serialId;
    expect((await other.get(`/serials/${id}`)).status).toBe(404);
  });
});
