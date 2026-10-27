/* Ремонт и гарантия (задача 1099): тип вида заказ-наряда, изделие в ремонте (склад не меняется), материалы заказчика,
   гарантийный заказ-наряд (выручка 0, затраты на статью «Гарантийный ремонт», счёт недоступен), путь номера до ремонта, RLS. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let other: Client;
let wh: string;
let customer: string;
let phone: string;
let part: string;
let repairWork: string;
let repairKind: string;
let warrantyKind: string;
let warrantyItem: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const kind = async (name: string, kindType: string) => {
  const k = await mk(owner, '/work-order-kinds', { name, kindType });
  for (const [i, [key, label, category]] of [['accepted', 'Принят', 'new'], ['repairing', 'В ремонте', 'in_progress'], ['ready', 'Готов', 'done'], ['issued', 'Выдан', 'delivered'], ['cancelled', 'Отменён', 'cancelled']].entries()) {
    await mk(owner, '/document-states', { kindId: k.id, key, label, category, sortOrder: i });
  }
  return k.id as string;
};
const balance = async (productId: string) => ((await owner.get(`/stock/balances?productId=${productId}`)).body.items as any[]).reduce((s, b) => s + Number(b.qty), 0);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Ремонт WS' });
  other = new Client();
  await other.signup({ workspaceName: 'Чужой ремонт WS' });
  wh = (await owner.get('/warehouses')).body.items[0].id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Клиент»', inn: '7728168971' })).id;
  phone = (await mk(owner, '/products', { name: 'Смартфон', kind: 'goods', unitCode: '796', price: 1000, purchasePrice: 500, vatRate: 'none', trackSerials: true, warrantyMonths: 12 })).id;
  part = (await mk(owner, '/products', { name: 'Дисплей', kind: 'goods', unitCode: '796', price: 300, purchasePrice: 150, vatRate: 'none' })).id;
  repairWork = (await mk(owner, '/products', { name: 'Замена дисплея', kind: 'work', unitCode: '356', price: 500, vatRate: 'none', warrantyMonths: 3 })).id;
  repairKind = await kind('Ремонт', 'repair');
  warrantyKind = await kind('Гарантийный ремонт', 'warranty');
  warrantyItem = ((await owner.get('/cost-items')).body.items as any[]).find(i => i.systemKey === 'garantiynyy_remont').id;
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: customer, warehouseId: wh, priceIncludesVat: false, date: '2026-08-10', lines: [{ productId: phone, qty: 2, price: 500, serials: ['S-1', 'S-2'] }, { productId: part, qty: 10, price: 150 }] });
  expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
  const sale = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, warehouseId: wh, priceIncludesVat: false, date: '2026-08-10', lines: [{ productId: phone, qty: 1, price: 1000, serials: ['S-1'] }] });
  expect((await owner.post(`/documents/${sale.id}/post`)).status).toBe(200);
});

describe('kinds', () => {
  test('the kind type is stored; a regular work order takes no repair item', async () => {
    const kinds = (await owner.get('/work-order-kinds')).body.items as any[];
    expect(kinds.find(k => k.id === repairKind).kindType).toBe('repair');
    expect(kinds.find(k => k.id === warrantyKind).kindType).toBe('warranty');
    const plain = await mk(owner, '/documents', { type: 'work_order', counterpartyId: customer, warehouseId: wh, lines: [] });
    const r = await owner.put(`/work-orders/${plain.id}/repair`, { name: 'Что-то' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('not_repair_kind');
  });
});

describe('repair work order', () => {
  let wo: string;
  test('accepting an item does not change the stock; the number is linked to the register', async () => {
    const before = [await balance(phone), await balance(part)];
    wo = (await mk(owner, '/documents', { type: 'work_order', counterpartyId: customer, warehouseId: wh, workOrderKindId: repairKind, lines: [{ productId: repairWork, qty: 1, price: 500 }, { productId: part, qty: 1, price: 300 }] })).id;
    const r = await owner.put(`/work-orders/${wo}/repair`, { productId: phone, serialText: 's-1', defect: 'Не включается', completeness: 'Зарядное', appearance: 'Царапина', receivedAt: '2026-09-01' });
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({ serialText: 's-1', registrySerial: 'S-1', defect: 'Не включается' });
    expect(r.body.item.serialId).toBeTruthy();
    expect([await balance(phone), await balance(part)]).toEqual(before);
    expect((await owner.get('/stock/moves')).body.items.filter((m: any) => m.documentId === wo)).toHaveLength(0);
  });

  test('customer materials are informational: no stock', async () => {
    const before = await balance(part);
    const r = await owner.put(`/work-orders/${wo}/customer-materials`, { materials: [{ name: 'Клей клиента', qty: '2', comment: 'принёс' }, { productId: part, qty: '1' }] });
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
    expect(await balance(part)).toBe(before);
    expect((await owner.put(`/work-orders/${wo}/customer-materials`, { materials: [{ qty: '1' }] })).status).toBe(422);
  });

  test('the item list and the history of the number show the repair; the delivered state sets the return date', async () => {
    const list = (await owner.get('/repair-items?open=1')).body.items as any[];
    expect(list.map(i => i.documentId)).toContain(wo);
    expect(list.find(i => i.documentId === wo)).toMatchObject({ kindType: 'repair', counterpartyName: 'ООО «Клиент»', atPartner: false });
    const card = (await owner.get(`/serials/${(await owner.get(`/work-orders/${wo}/repair`)).body.item.serialId}`)).body;
    expect(card.repairs.map((x: any) => x.documentId)).toEqual([wo]);
    expect((await owner.post(`/documents/${wo}/state`, { state: 'repairing' })).status).toBe(200);
    expect((await owner.post(`/documents/${wo}/state`, { state: 'ready' })).status).toBe(200);
    expect((await owner.post(`/documents/${wo}/state`, { state: 'issued' })).status).toBe(200);
    const item = (await owner.get(`/work-orders/${wo}/repair`)).body.item;
    expect(item.returnedAt).toBeTruthy();
    expect(((await owner.get('/repair-items?open=1')).body.items as any[]).map(i => i.documentId)).not.toContain(wo);
  });

  test('outsourcing: at partner until it is returned', async () => {
    const d = (await mk(owner, '/documents', { type: 'work_order', counterpartyId: customer, warehouseId: wh, workOrderKindId: repairKind, lines: [] })).id;
    const partner = (await mk(owner, '/companies', { name: 'Сервис-партнёр' })).id;
    await owner.put(`/work-orders/${d}/repair`, { name: 'Ноутбук', outsourceCompanyId: partner, outsourcedAt: '2026-09-02' });
    const row = ((await owner.get('/repair-items?open=1')).body.items as any[]).find(i => i.documentId === d);
    expect(row).toMatchObject({ atPartner: true, outsourceName: 'Сервис-партнёр' });
    expect((await owner.put(`/work-orders/${d}/repair`, { name: 'Ноутбук', outsourceCompanyId: partner, outsourcedAt: '2026-09-02', outsourceReturnedAt: '2026-09-01' })).status).toBe(422);
  });
});

describe('warranty repair work order', () => {
  let wo: string;
  test('prices are zero, the cost item is the system one, invoices are unavailable', async () => {
    wo = (await mk(owner, '/documents', { type: 'work_order', counterpartyId: customer, warehouseId: wh, workOrderKindId: warrantyKind, lines: [{ productId: repairWork, qty: 1, price: 500 }, { productId: part, qty: 2, price: 300 }] })).id;
    const d = (await owner.get(`/documents/${wo}`)).body;
    expect(d.total).toBe('0.00');
    expect(d.lines.every((l: any) => l.price === '0.00' && l.total === '0.00')).toBe(true);
    expect(d.costItemId).toBe(warrantyItem);
    // правка строк с ценой остаётся нулевой
    await owner.patch(`/documents/${wo}`, { lines: d.lines.map((l: any) => ({ id: l.id, productId: l.productId, qty: l.qty, price: '999' })) });
    expect((await owner.get(`/documents/${wo}`)).body.total).toBe('0.00');
    const r = await owner.post(`/documents/${wo}/based-on`, { type: 'invoice' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('warranty_no_billing');
  });

  test('completion: no revenue, the cost goes to the warranty cost item', async () => {
    await mk(owner, `/work-orders/${wo}/materials`, { materials: [] }).catch(() => null);
    const before = await balance(part);
    expect((await owner.post(`/documents/${wo}/state`, { state: 'repairing' })).status).toBe(200);
    expect((await owner.post(`/documents/${wo}/state`, { state: 'ready' })).status).toBe(200);
    expect(await balance(part)).toBe(before - 2);
    const c = (await owner.get(`/work-orders/${wo}/cost`)).body;
    expect(c.revenue).toBe('0.00');
    expect(c.goods.fact).toBe('300.00'); // 2 × 150
    expect(c.margin.fact).toBe('-300.00');
    const report = (await owner.get(`/production/reports/work-order-cost?from=2000-01-01&to=2100-01-01`)).body;
    expect(report.warrantyCost).toBe('300.00');
    expect(report.rows.find((r: any) => r.documentId === wo).warranty).toBe(true);
  });

  test('changing the kind to a regular one releases the cost item', async () => {
    const d = (await mk(owner, '/documents', { type: 'work_order', counterpartyId: customer, warehouseId: wh, workOrderKindId: warrantyKind, lines: [] })).id;
    expect((await owner.get(`/documents/${d}`)).body.costItemId).toBe(warrantyItem);
    const plain = ((await owner.get('/work-order-kinds')).body.items as any[]).find(k => k.kindType === 'regular').id;
    expect((await owner.patch(`/documents/${d}`, { workOrderKindId: plain })).status).toBe(200);
    expect((await owner.get(`/documents/${d}`)).body.costItemId).toBeNull();
  });
});

describe('print forms', () => {
  test('warranty card, acceptance and return acts render', async () => {
    const wo = (await mk(owner, '/documents', { type: 'work_order', counterpartyId: customer, warehouseId: wh, workOrderKindId: repairKind, lines: [{ productId: repairWork, qty: 1, price: 500 }] })).id;
    await owner.put(`/work-orders/${wo}/repair`, { productId: phone, serialText: 'S-1', defect: 'Не включается' });
    for (const form of ['repair_receipt', 'repair_return', 'warranty_card']) {
      const r = await owner.get(`/documents/${wo}/print/${form}`);
      expect(r.status).toBe(200);
    }
    const html = (await owner.get(`/documents/${wo}/print/repair_receipt`)).body as string;
    expect(html).toContain('Акт приёма в ремонт');
    expect(html).toContain('действует');
  });
});

describe('isolation', () => {
  test('another workspace sees no repair items', async () => {
    expect((await other.get('/repair-items')).body.items).toHaveLength(0);
  });
});
