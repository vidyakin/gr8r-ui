/* Упаковки товара (docs/plans/2026-11-14-product-packages.md): «ящик = 100 шт». Строка документа хранит единицу и коэффициент,
   количество — в базовых единицах: приход 2 ящиков даёт 200 шт, отгрузка ящика уходит 100 шт, себестоимость — за штуку. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { MemoryFileStore, setFileStore } from '@erp/db';
import { buildXlsx } from '../src/xlsx';
import { Client } from './helpers';

let owner: Client;
let other: Client;
let wh: string;
let supplier: string;
let customer: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const act = (id: string, action: string, body?: unknown) => owner.post(`/documents/${id}/${action}`, body);
const posted = async (id: string) => {
  const r = await act(id, 'post');
  if (r.status !== 200) throw new Error(`post: ${r.status} ${JSON.stringify(r.body)}`);
};
const balance = async (productId: string) => (await owner.get(`/stock/balances?productId=${productId}&warehouseId=${wh}`)).body.items[0] as { qty: string; avgCost: string | null } | undefined;
const detail = async (id: string) => (await owner.get(`/documents/${id}`)).body as any;
/** Строка в ящиках: форма присылает количество в единице строки (unitQty) */
const boxes = (productId: string, n: number, price: number) => ({ productId, unitCode: '778', unitQty: n, qty: n, price });

let counter = 0;
/** Товар в штуках с упаковкой «упак = 100 шт» */
const packed = async (name: string) => {
  const p = await mk(owner, '/products', { name: `${name} ${++counter}`, unitCode: '796', price: 30, vatRate: '20' });
  const r = await owner.put(`/products/${p.id}/units`, { items: [{ unitCode: '778', factor: '100' }] });
  if (r.status !== 200) throw new Error(`units: ${r.status} ${JSON.stringify(r.body)}`);
  return p.id as string;
};

beforeAll(async () => {
  setFileStore(new MemoryFileStore());
  owner = new Client();
  await owner.signup({ workspaceName: 'Упаковки WS' });
  other = new Client();
  await other.signup({ workspaceName: 'Чужие упаковки WS' });
  wh = (await owner.get('/warehouses')).body.items[0].id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Ящики»', inn: '7728168971' })).id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Покупатель ящиков»' })).id;
});

describe('упаковки товара', () => {
  test('список заменяется целиком; базовая единица, повтор и нулевой коэффициент — 422; чужой арендатор не видит', async () => {
    const p = await packed('Кабель-канал');
    const list = (await owner.get(`/products/${p}/units`)).body.items;
    expect(list).toMatchObject([{ unitCode: '778', factor: '100.000000' }]);
    expect((await owner.get(`/products/${p}/units`)).body.baseUnitCode).toBe('796');
    expect((await owner.put(`/products/${p}/units`, { items: [{ unitCode: '796', factor: '10' }] })).body.error.code).toBe('product_unit_base');
    expect((await owner.put(`/products/${p}/units`, { items: [{ unitCode: '778', factor: '10' }, { unitCode: '778', factor: '20' }] })).body.error.code).toBe('product_unit_duplicate');
    expect((await owner.put(`/products/${p}/units`, { items: [{ unitCode: '778', factor: '0' }] })).body.error.code).toBe('product_unit_invalid');
    const two = await owner.put(`/products/${p}/units`, { items: [{ unitCode: '736', factor: '25.5' }, { unitCode: '778', factor: '100' }] });
    expect(two.body.items.map((u: any) => [u.unitCode, u.factor])).toEqual([['736', '25.500000'], ['778', '100.000000']]);
    expect((await other.get(`/products/${p}/units`)).status).toBe(404);
    expect((await other.put(`/products/${p}/units`, { items: [] })).status).toBe(404);
  });
});

describe('документы в упаковках', () => {
  test('приход 2 ящиков по 1500 → 200 шт по 15; отгрузка ящика → минус 100 шт; отмена проведения возвращает', async () => {
    const p = await packed('Розетка');
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: wh, priceIncludesVat: false, lines: [boxes(p, 2, 1500)] });
    const l = (await detail(rc.id)).lines[0];
    expect(l).toMatchObject({ unitCode: '778', unitFactor: '100.000000', qty: '200.000', unitQty: '2.000', price: '1500.00', net: '3000.00' });
    await posted(rc.id);
    expect(await balance(p)).toMatchObject({ qty: '200.000' });
    expect(Number((await balance(p))!.avgCost)).toBe(15);

    const sh = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, warehouseId: wh, priceIncludesVat: true, lines: [boxes(p, 1, 3000)] });
    expect((await detail(sh.id)).lines[0]).toMatchObject({ qty: '100.000', unitQty: '1.000', total: '3000.00' });
    await posted(sh.id);
    expect((await balance(p))!.qty).toBe('100.000');
    expect((await act(sh.id, 'unpost')).status).toBe(200);
    expect((await balance(p))!.qty).toBe('200.000');
  });

  test('заказ в ящиках, отгрузка частью в штуках: остаток к отгрузке — в штуках, вторая отгрузка — полупустой ящик', async () => {
    const p = await packed('Выключатель');
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: wh, priceIncludesVat: false, lines: [boxes(p, 3, 1000)] });
    await posted(rc.id);
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: wh, priceIncludesVat: true, lines: [boxes(p, 1, 2000)] });
    await posted(order.id);
    // реализация на основании: та же единица и коэффициент строки заказа
    const sh1 = (await act(order.id, 'based-on', { type: 'realization' })).body;
    const l1 = (await detail(sh1.id)).lines[0];
    expect(l1).toMatchObject({ unitCode: '778', unitFactor: '100.000000', qty: '100.000', total: '2000.00' });
    // отгружаем 40 шт: строка переводится на штуки по 20 ₽
    const upd = await owner.patch(`/documents/${sh1.id}`, { lines: [{ id: l1.id, productId: p, unitCode: '796', unitQty: 40, qty: 40, price: 20 }] });
    expect(upd.status).toBe(200);
    expect((await detail(sh1.id)).lines[0]).toMatchObject({ unitCode: '796', unitFactor: '1.000000', qty: '40.000', total: '800.00' });
    await posted(sh1.id);
    expect((await balance(p))!.qty).toBe('260.000');
    // заказ: отгружено 40 шт из 100
    expect((await detail(order.id)).lines[0]).toMatchObject({ qty: '100.000', shipped: '40.000' });
    // вторая отгрузка: остаток 60 шт в ящиках заказа = 0,6 ящика, сумма = 0,6 × 2000
    const sh2 = (await act(order.id, 'based-on', { type: 'realization' })).body;
    expect((await detail(sh2.id)).lines[0]).toMatchObject({ unitCode: '778', qty: '60.000', unitQty: '0.600', total: '1200.00' });
    await posted(sh2.id);
    expect((await balance(p))!.qty).toBe('200.000');
  });

  test('коэффициент строки фиксируется при вводе: правка упаковки не меняет сохранённый документ', async () => {
    const p = await packed('Лампа');
    const d = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: wh, priceIncludesVat: false, lines: [boxes(p, 1, 500)] });
    await owner.put(`/products/${p}/units`, { items: [{ unitCode: '778', factor: '50' }] });
    const l = (await detail(d.id)).lines[0];
    // повторное сохранение формой (unitQty) — прежний коэффициент строки
    await owner.patch(`/documents/${d.id}`, { lines: [{ id: l.id, productId: p, unitCode: '778', unitQty: 2, qty: 2, price: 500 }] });
    expect((await detail(d.id)).lines[0]).toMatchObject({ unitFactor: '100.000000', qty: '200.000', net: '1000.00' });
    // новая строка — по новой упаковке
    await owner.patch(`/documents/${d.id}`, { lines: [{ id: l.id, productId: p, unitCode: '778', unitQty: 2, qty: 2, price: 500 }, boxes(p, 1, 500)] });
    expect((await detail(d.id)).lines.map((x: any) => x.qty)).toEqual(['200.000', '50.000']);
  });

  test('оприходование в ящиках: цена за ящик, себестоимость прихода — за штуку; дробная штука — 422', async () => {
    const p = await packed('Клемма');
    const surplus = ((await owner.get('/cost-items')).body.items as any[]).find(i => i.systemKey === 'izlishki').id;
    const d = await mk(owner, '/documents', { type: 'stock_posting', warehouseId: wh, costItemId: surplus, lines: [boxes(p, 1, 700)] });
    await posted(d.id);
    expect(await balance(p)).toMatchObject({ qty: '100.000' });
    expect(Number((await balance(p))!.avgCost)).toBe(7);
    const p2 = await mk(owner, '/products', { name: 'Провод', unitCode: '006', price: 1 });
    await owner.put(`/products/${p2.id}/units`, { items: [{ unitCode: '736', factor: '0.5' }] });
    const bad = await owner.post('/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: wh, lines: [{ productId: p2.id, unitCode: '736', unitQty: '0.001', qty: '0.001', price: 1 }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('invalid_qty');
  });

  test('печатная форма — в единице строки: 3 упак по 100, а не 300', async () => {
    const p = await packed('Патрон');
    const d = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, warehouseId: wh, priceIncludesVat: true, lines: [boxes(p, 3, 100)] });
    const r = await owner.get(`/documents/${d.id}/print/torg12`);
    expect(r.status).toBe(200);
    const html = String(r.body);
    expect(html).toContain('упак');
    expect(html).not.toMatch(/>\s*300(,000)?\s*</);
    expect(html).toMatch(/>\s*3(,000)?\s*</);
  });
});

describe('инвентаризация, перемещение и выпуск в упаковках', () => {
  /** Приход в ящиках на склад (остаток — в штуках) */
  const stockUp = async (p: string, n: number, warehouse = wh) => {
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: warehouse, priceIncludesVat: false, lines: [boxes(p, n, 1500)] });
    await posted(rc.id);
  };

  test('инвентаризация: фактическое в ящиках, учётное в штуках; разница и документы на основании — в единице строки', async () => {
    const wh2 = (await mk(owner, '/warehouses', { name: 'Склад инвентаризации' })).id;
    const p = await packed('Лоток');
    await stockUp(p, 3, wh2); // 300 шт
    const inv = await mk(owner, '/documents', { type: 'inventory_count', warehouseId: wh2 });
    const filled = (await owner.post(`/documents/${inv.id}/fill-count-sheet`)).body;
    const l0 = filled.lines.find((l: any) => l.productId === p);
    expect(l0).toMatchObject({ qty: '300.000', bookQty: '300.000', unitFactor: '1.000000' });
    // насчитали 2 ящика (200 шт) при учётных 300 шт — недостача 100 шт = 1 ящик
    const upd = await owner.patch(`/documents/${inv.id}`, { lines: [{ id: l0.id, productId: p, unitCode: '778', unitQty: 2, qty: 2, bookQty: '300', price: 0 }] });
    expect(upd.status).toBe(200);
    expect((await detail(inv.id)).lines[0]).toMatchObject({ unitCode: '778', unitFactor: '100.000000', qty: '200.000', unitQty: '2.000', bookQty: '300.000' });
    // повторное заполнение по остаткам сохраняет единицу и фактическое количество строки
    const refilled = (await owner.post(`/documents/${inv.id}/fill-count-sheet`)).body.lines.find((l: any) => l.productId === p);
    expect(refilled).toMatchObject({ unitCode: '778', unitFactor: '100.000000', qty: '200.000', unitQty: '2.000', bookQty: '300.000' });
    await posted(inv.id);
    expect((await balance(p))?.qty ?? '0').not.toBe('999'); // остатки инвентаризация не двигает
    const html = String((await owner.get(`/documents/${inv.id}/print/inv3`)).body);
    expect(html).not.toMatch(/>\s*(200|300)(,000)?\s*</);
    expect(html).toMatch(/>\s*3(,000)?\s*</);
    const off = (await owner.post(`/documents/${inv.id}/based-on`, { type: 'write_off' }));
    expect(off.status).toBe(201);
    expect(off.body.lines[0]).toMatchObject({ productId: p, unitCode: '778', unitFactor: '100.000000', qty: '100.000', unitQty: '1.000' });
    await posted(off.body.id);
    const bal = (await owner.get(`/stock/balances?productId=${p}&warehouseId=${wh2}`)).body.items[0];
    expect(bal.qty).toBe('200.000');
  });

  test('перемещение ящиками: обычное и «в пути» (отправка, частичная приёмка в ящиках, отмена приёмки, отмена проведения)', async () => {
    const whB = (await mk(owner, '/warehouses', { name: 'Склад получатель' })).id;
    const p = await packed('Перемещаемая розетка');
    await stockUp(p, 5); // 500 шт на wh
    const balOf = async (w: string) => ((await owner.get(`/stock/balances?productId=${p}&warehouseId=${w}`)).body.items[0]?.qty ?? '0.000') as string;
    // обычное перемещение: 2 ящика
    const tr = await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: wh, targetWarehouseId: whB, lines: [{ productId: p, unitCode: '778', unitQty: 2, qty: 2, price: 0 }] });
    expect((await detail(tr.id)).lines[0]).toMatchObject({ qty: '200.000', unitQty: '2.000', unitFactor: '100.000000' });
    await posted(tr.id);
    expect(await balOf(wh)).toBe('300.000');
    expect(await balOf(whB)).toBe('200.000');
    // «в пути»: 3 ящика отправлены, принято 2 ящика
    const tt = await mk(owner, '/documents', { type: 'stock_transfer', operation: 'in_transit', warehouseId: wh, targetWarehouseId: whB, lines: [{ productId: p, unitCode: '778', unitQty: 3, qty: 3, price: 0 }] });
    const posted1 = await act(tt.id, 'post');
    expect(posted1.status).toBe(200);
    expect(posted1.body.state).toBe('shipped');
    expect(await balOf(wh)).toBe('0.000');
    const transit = (await owner.get('/warehouses?limit=100')).body.items.find((w: any) => w.kind === 'transit');
    const inTransit = async () => ((await owner.get(`/stock/balances?productId=${p}&warehouseId=${transit.id}`)).body.items[0]?.qty ?? '0.000') as string;
    expect(await inTransit()).toBe('300.000');
    const lineId = (await detail(tt.id)).lines[0].id;
    const rec = await act(tt.id, 'state', { state: 'received', received: [{ id: lineId, unitQty: '2' }] });
    expect(rec.status).toBe(200);
    expect(rec.body.lines[0]).toMatchObject({ receivedQty: '200.000', qty: '300.000', unitQty: '3.000' });
    expect(await balOf(whB)).toBe('400.000');
    expect(await inTransit()).toBe('100.000');
    // больше отправленного (4 ящика) принять нельзя
    const back = await act(tt.id, 'state', { state: 'shipped' });
    expect(back.status).toBe(200);
    expect(await balOf(whB)).toBe('200.000');
    expect(await inTransit()).toBe('300.000');
    const over = await act(tt.id, 'state', { state: 'received', received: [{ id: lineId, unitQty: '4' }] });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('invalid_received_qty');
    // приёмка без количеств — прежнее принятое (2 ящика); отмена проведения возвращает отправителю в штуках
    expect((await act(tt.id, 'state', { state: 'received' })).status).toBe(200);
    expect(await balOf(whB)).toBe('400.000');
    expect((await act(tt.id, 'unpost')).status).toBe(200);
    expect(await balOf(wh)).toBe('300.000');
    expect(await balOf(whB)).toBe('200.000');
    // обратное перемещение ящиками: 2 ящика назад
    const rb = await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: whB, targetWarehouseId: wh, lines: [{ productId: p, unitCode: '778', unitQty: 2, qty: 2, price: 0 }] });
    await posted(rb.id);
    expect(await balOf(wh)).toBe('500.000');
    expect(await balOf(whB)).toBe('0.000');
  });

  test('выпуск: строки выпуска правятся в упаковке, остатки и приход — в штуках', async () => {
    const out = await packed('Блок питания');
    const mat = await packed('Корпус');
    const whMat = (await mk(owner, '/warehouses', { name: 'Склад материалов выпуска', kind: 'workshop' })).id;
    const whOut = (await mk(owner, '/warehouses', { name: 'Склад выпуска упаковок' })).id;
    const wc = (await mk(owner, '/work-centers', { name: 'Цех упаковок', hourlyRate: 0, warehouseId: whMat, outputWarehouseId: whOut })).id;
    const spec = (await mk(owner, '/manufactured-items', { name: 'Блок питания (спец.)', productId: out })).id;
    await mk(owner, `/manufactured-items/${spec}/lines`, { kind: 'material', productId: mat, qty: 10 });
    await stockUp(mat, 3, whMat); // 300 шт материала
    const o = await mk(owner, '/production-orders', { workCenterId: wc, items: [{ itemId: spec, qty: '20' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await posted(o.id);
    const oi = (await owner.get(`/production-orders/${o.id}`)).body.items[0];
    const rel = await mk(owner, `/production-orders/${o.id}/production`, { lines: [{ orderItemId: oi.id, qty: '20' }] });
    const roles = rel.lines.map((l: any) => [l.stockRole, l.qty]);
    expect(roles).toEqual([['in', '20.000'], ['out', '200.000']]);
    // правим черновик выпуска: продукция — упаковка (1 ящик = 100 шт, но только 20 нужно — берём 0.2 ящика), материал — 2 ящика (200 шт)
    const [inLine, outLine] = rel.lines;
    const upd = await owner.patch(`/documents/${rel.id}`, {
      lines: [
        { id: inLine.id, productId: out, unitCode: '778', unitQty: '0.2', qty: '0.2', price: 0, stockRole: 'in' },
        { id: outLine.id, productId: mat, unitCode: '778', unitQty: '2', qty: '2', price: 0, stockRole: 'out' },
      ],
    });
    expect(upd.status).toBe(200);
    const d = await detail(rel.id);
    expect(d.lines.find((l: any) => l.stockRole === 'in')).toMatchObject({ unitCode: '778', unitFactor: '100.000000', qty: '20.000', unitQty: '0.200' });
    expect(d.lines.find((l: any) => l.stockRole === 'out')).toMatchObject({ unitCode: '778', qty: '200.000', unitQty: '2.000' });
    await posted(rel.id);
    const outBal = (await owner.get(`/stock/balances?productId=${out}&warehouseId=${whOut}`)).body.items[0];
    expect(outBal.qty).toBe('20.000');
    const matBal = (await owner.get(`/stock/balances?productId=${mat}&warehouseId=${whMat}`)).body.items[0];
    expect(matBal.qty).toBe('100.000');
    expect((await act(rel.id, 'unpost')).status).toBe(200);
    expect((await owner.get(`/stock/balances?productId=${mat}&warehouseId=${whMat}`)).body.items[0].qty).toBe('300.000');
  });
});

describe('прайс поставщика с единицей и кратностью', () => {
  test('профиль с колонками единицы и кратности: упаковки заводятся, цена пишется за упаковку, справочно — за штуку', async () => {
    const vendor = (await mk(owner, '/companies', { name: 'ООО «ИЭК-опт»' })).id;
    // уже наш товар, сопоставится по артикулу: упаковки у него ещё нет
    const ours = await mk(owner, '/products', { name: 'Наконечник НШВИ', unitCode: '796', price: 2, vatRate: '20' });
    expect((await owner.put(`/companies/${vendor}/articles/${ours.id}`, { article: 'IEK-0' })).status).toBeLessThan(300);
    const roll = await mk(owner, '/products', { name: 'Изолента', unitCode: '796', price: 2, vatRate: '20' });
    expect((await owner.put(`/companies/${vendor}/articles/${roll.id}`, { article: 'IEK-R' })).status).toBeLessThan(300);
    const profile = await mk(owner, '/pricing/supplier-profiles', { companyId: vendor, name: 'ИЭК', firstRow: 2, articleCol: 1, nameCol: 2, priceGrossCol: 3, unitCol: 4, factorCol: 5 });
    expect(profile).toMatchObject({ unitCol: 4, factorCol: 5 });
    const rows = [
      ['Артикул', 'Наименование', 'Цена', 'Ед.', 'Кратность'],
      ['IEK-1', 'Автомат ВА47-29 1P 16А', 1500, 'упак', 100],
      ['IEK-2', 'Кабель ВВГ 3х2,5', 50, 'м', ''],
      ['IEK-3', 'Хомут 3х150', 300, '', '100'],
      ['IEK-0', 'Наконечник НШВИ', '450,00', 'упак', '1 000'],
      ['IEK-R', 'Изолента', 90, 'рул', ''],
    ];
    const f = new FormData();
    f.set('file', new File([buildXlsx('Прайс', rows) as unknown as ArrayBuffer], 'iek.xlsx'));
    for (const [k, v] of Object.entries({ companyId: vendor, profileId: profile.id, date: '2026-01-01' })) f.set(k, v);
    const up = await owner.form('POST', '/pricing/supplier-prices/upload', f);
    expect(up.status).toBe(201);
    const priceId = up.body.price.id;
    expect(up.body.lines.map((l: any) => [l.article, l.unitCode, l.unitFactor])).toEqual([
      ['IEK-1', '778', '100.000000'],
      ['IEK-2', '006', null],
      ['IEK-3', '778', '100.000000'],
      ['IEK-0', '778', '1000.000000'],
      ['IEK-R', '736', null],
    ]);
    expect((await owner.post(`/pricing/supplier-prices/${priceId}/create-products`, {})).body).toMatchObject({ created: 3 });
    const lines = (await owner.get(`/pricing/supplier-prices/${priceId}`)).body.lines as any[];
    const pid = (a: string) => lines.find(l => l.article === a).productId as string;
    // новый товар из упаковки: базовая — штука, упаковка — единица прайса с кратностью
    const auto = (await owner.get(`/products/${pid('IEK-1')}`)).body;
    expect(auto.unitCode).toBe('796');
    expect((await owner.get(`/products/${pid('IEK-1')}/units`)).body.items).toMatchObject([{ unitCode: '778', factor: '100.000000' }]);
    // без кратности единица прайса и есть базовая
    expect((await owner.get(`/products/${pid('IEK-2')}`)).body.unitCode).toBe('006');
    expect((await owner.get(`/products/${pid('IEK-2')}/units`)).body.items).toEqual([]);

    const pv = (await owner.get(`/pricing/supplier-prices/${priceId}/preview-apply`)).body.items as any[];
    const item = (a: string) => pv.find(i => i.article === a);
    expect(item('IEK-1')).toMatchObject({ next: '1500.00', unitCode: '778', unitFactor: '100.000000', baseUnitCode: '796', nextBase: '15.00', warning: null });
    expect(item('IEK-2')).toMatchObject({ next: '50.00', unitCode: null, nextBase: '50.00' });
    expect(item('IEK-0')).toMatchObject({ next: '450.00', unitFactor: '1000.000000', nextBase: '0.45' });
    // рулон без кратности и без упаковки у товара — коэффициент неизвестен, цена не пишется
    expect(item('IEK-R')).toMatchObject({ next: null, warning: 'unit_unknown' });

    const ap = await owner.post(`/pricing/supplier-prices/${priceId}/apply`, {});
    expect(ap.status).toBe(200);
    expect(ap.body.skipped.map((s: any) => s.article)).toEqual(['IEK-R']);
    // сопоставленный по артикулу товар получил упаковку при применении
    expect((await owner.get(`/products/${ours.id}/units`)).body.items).toMatchObject([{ unitCode: '778', factor: '1000.000000' }]);
    // карточка товара: цена за упаковку и за штуку
    const sup = (await owner.get(`/pricing/products/${pid('IEK-1')}/suppliers`)).body.items[0];
    expect(sup).toMatchObject({ price: '15.00', unitPrice: '1500.00', unitCode: '778', unitFactor: '100.000000' });
    const hist = (await owner.get(`/pricing/products/${pid('IEK-1')}/history`)).body.items[0];
    expect(hist).toMatchObject({ price: '1500.00', unitCode: '778' });
    // упаковка из прайса работает в документе: 2 упак = 200 шт
    const d = await mk(owner, '/documents', { type: 'receipt', counterpartyId: vendor, warehouseId: wh, priceIncludesVat: true, lines: [boxes(pid('IEK-1'), 2, 1500)] });
    expect((await detail(d.id)).lines[0]).toMatchObject({ qty: '200.000', unitFactor: '100.000000', total: '3000.00' });
  });
});
