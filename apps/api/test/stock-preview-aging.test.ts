/* Движения документа до проведения (GET /documents/:id/stock-moves) и отчёт «Старение запасов» (GET /stock/aging).
   Предпросмотр — проведение в savepoint с откатом: после него остатки, номер, статус и события документа не меняются. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { admin, Client } from './helpers';

let owner: Client;
let wh: string;
let wh2: string;
let supplier: string;
let buyer: string;
let goods: string;
let tracked: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const doc = (type: string, body: Record<string, unknown>) => mk(owner, '/documents', { type, date: '2026-08-10', priceIncludesVat: false, ...body });
const post = async (id: string) => {
  const r = await owner.post(`/documents/${id}/post`);
  expect(r.status).toBe(200);
};
const moves = async (id: string) => (await owner.get(`/documents/${id}/stock-moves`)).body as any;
const balance = async (productId: string, warehouseId: string) => ((await owner.get(`/stock/balances?productId=${productId}&warehouseId=${warehouseId}`)).body.items[0]?.qty ?? '0.000') as string;
const aging = async (query: string) => (await owner.get(`/stock/aging?${query}`)).body as any;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Движения и старение WS' });
  wh = (await owner.get('/warehouses')).body.items[0].id;
  wh2 = (await mk(owner, '/warehouses', { name: 'Второй склад' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»', inn: '7728168971' })).id;
  buyer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7707083893' })).id;
  goods = (await mk(owner, '/products', { name: 'Болт', kind: 'goods', unitCode: '796', price: 100, purchasePrice: 50, vatRate: 'none' })).id;
  tracked = (await mk(owner, '/products', { name: 'Сыр', kind: 'goods', unitCode: '796', price: 100, purchasePrice: 50, vatRate: 'none', trackBatches: true, shelfLifeDays: 90 })).id;
});

describe('document stock moves preview', () => {
  test('draft receipt shows its moves and changes nothing', async () => {
    const d = await doc('receipt', { warehouseId: wh, counterpartyId: supplier, lines: [{ productId: goods, qty: 10, price: 50 }] });
    const before = await balance(goods, wh);
    const r = await moves(d.id);
    expect(r.mode).toBe('preview');
    expect(r.error).toBeNull();
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0]).toMatchObject({ warehouseId: wh, productId: goods, qty: '10.000', cost: '50.0000', amount: '500.00' });
    // данные не изменились: остаток, статус, номер, повторный расчёт даёт то же
    expect(await balance(goods, wh)).toBe(before);
    const detail = (await owner.get(`/documents/${d.id}`)).body;
    expect(detail.status).toBe('draft');
    expect(detail.number).toBeNull();
    const [{ n }] = await admin`select count(*)::int as n from stock_moves where document_id=${d.id}`;
    expect(n).toBe(0);
    expect((await moves(d.id)).moves).toHaveLength(1);
    // после настоящего проведения — фактические движения, номер выдан первым (счётчик предпросмотром не потрачен)
    await post(d.id);
    const posted = await moves(d.id);
    expect(posted.mode).toBe('actual');
    expect(posted.moves).toHaveLength(1);
    expect(posted.moves[0]).toMatchObject({ qty: '10.000', amount: '500.00' });
    expect((await owner.get(`/documents/${d.id}`)).body.number).toMatch(/-00001$/);
  });

  test('draft shipment previews outgoing moves at the average cost; shortage is reported as an error', async () => {
    const ok = await doc('realization', { warehouseId: wh, counterpartyId: buyer, lines: [{ productId: goods, qty: 4, price: 100 }] });
    const r = await moves(ok.id);
    expect(r.moves[0]).toMatchObject({ qty: '-4.000', cost: '50.0000', amount: '-200.00' });
    expect(await balance(goods, wh)).toBe('10.000');
    const big = await doc('realization', { warehouseId: wh, counterpartyId: buyer, lines: [{ productId: goods, qty: 999, price: 100 }] });
    const bad = await owner.get(`/documents/${big.id}/stock-moves`);
    expect(bad.status).toBe(200);
    expect(bad.body.moves).toHaveLength(0);
    expect(bad.body.error.code).toBe('insufficient_stock');
    expect((await owner.get(`/documents/${big.id}`)).body.status).toBe('draft');
  });

  test('transfer previews both sides; batches are shown by number', async () => {
    const t = await doc('stock_transfer', { warehouseId: wh, targetWarehouseId: wh2, lines: [{ productId: goods, qty: 3, price: 0 }] });
    const r = await moves(t.id);
    const byWh = Object.fromEntries(r.moves.map((m: any) => [m.warehouseId, m.qty]));
    expect(byWh[wh]).toBe('-3.000');
    expect(byWh[wh2]).toBe('3.000');
    expect(await balance(goods, wh2)).toBe('0.000');
    const rc = await doc('receipt', { warehouseId: wh, counterpartyId: supplier, lines: [{ productId: tracked, qty: 5, price: 10, batchNumber: 'П-1' }] });
    expect((await moves(rc.id)).moves[0].batchNumber).toBe('П-1');
    expect((await admin`select count(*)::int as n from stock_batches where workspace_id=${owner.workspaceId!}`)[0]!.n).toBe(0);
  });

  test('unknown document is 404', async () => {
    expect((await owner.get('/documents/00000000-0000-7000-8000-000000000000/stock-moves')).status).toBe(404);
  });
});

describe('stock aging report', () => {
  const today = '2026-11-08';
  test('FIFO layers: outflows eat the oldest receipts', async () => {
    const p = (await mk(owner, '/products', { name: 'Гайка', kind: 'goods', unitCode: '796', price: 10, purchasePrice: 5, vatRate: 'none' })).id;
    const rcv = async (date: string, qty: number, price: number) => post((await doc('receipt', { date, warehouseId: wh, counterpartyId: supplier, lines: [{ productId: p, qty, price }] })).id);
    await rcv('2026-11-01', 5, 10); // 7 дней
    await rcv('2026-09-20', 10, 8); // 49 день
    await rcv('2026-05-01', 20, 6); // >180
    await post((await doc('realization', { date: '2026-11-02', warehouseId: wh, counterpartyId: buyer, lines: [{ productId: p, qty: 25, price: 20 }] })).id);
    // остаток 10: расход 25 съедает 20 (>180) и 5 из партии 49 дней
    const r = await aging(`productId=${p}&asOf=${today}`);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].qty).toBe('10.000');
    expect(r.items[0].bucketsQty).toEqual(['5.000', '5.000', '0.000', '0.000', '0.000']);
    expect(r.items[0].bucketsValue).toEqual(['50.00', '40.00', '0.00', '0.00', '0.00']);
    expect(r.totals.qty).toBe('10.000');
    // на более раннюю дату — другая картина: на 2026-10-01 расхода и свежего прихода ещё нет
    const early = await aging(`productId=${p}&asOf=2026-10-01`);
    expect(early.items[0].qty).toBe('30.000');
    expect(early.items[0].bucketsQty).toEqual(['10.000', '0.000', '0.000', '20.000', '0.000']);
  });

  test('batch-tracked product is aged by batch', async () => {
    const p = (await mk(owner, '/products', { name: 'Творог', kind: 'goods', unitCode: '796', price: 10, purchasePrice: 5, vatRate: 'none', trackBatches: true, shelfLifeDays: 30 })).id;
    await post((await doc('receipt', { date: '2026-11-05', warehouseId: wh, counterpartyId: supplier, lines: [{ productId: p, qty: 4, price: 10, batchNumber: 'Н' }] })).id);
    await post((await doc('receipt', { date: '2026-04-01', warehouseId: wh, counterpartyId: supplier, lines: [{ productId: p, qty: 6, price: 10, batchNumber: 'С', batchExpiresAt: '2027-01-01' }] })).id);
    const r = await aging(`productId=${p}&asOf=${today}&warehouseId=${wh}`);
    expect(r.items[0].bucketsQty).toEqual(['4.000', '0.000', '0.000', '0.000', '6.000']);
  });

  test('filters by warehouse and category; empty on other warehouse', async () => {
    const cat = (await mk(owner, '/product-categories', { name: 'Крепёж' })).id;
    const p = (await mk(owner, '/products', { name: 'Шайба', kind: 'goods', unitCode: '796', price: 10, purchasePrice: 5, vatRate: 'none', categoryId: cat })).id;
    await post((await doc('receipt', { date: '2026-11-07', warehouseId: wh, counterpartyId: supplier, lines: [{ productId: p, qty: 2, price: 1 }] })).id);
    const byCat = await aging(`categoryId=${cat}&asOf=${today}`);
    expect(byCat.items.map((i: any) => i.productId)).toEqual([p]);
    expect((await aging(`categoryId=${cat}&warehouseId=${wh2}&asOf=${today}`)).items).toHaveLength(0);
  });
});
