/* Комплекты товаров (#1183): состав, защита от циклов, вложенные комплекты,
   списание составляющих без остатка самого комплекта, распределение цены, COGS и отмена проведения. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let whId: string;
let customer: string;
let supplier: string;
let table: string;
let chair: string;
let lamp: string;
let serviceProd: string;
let serialProd: string;
let kitDining: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const doc = (c: Client, type: string, lines: any[], extra: Record<string, unknown> = {}) =>
  mk(c, '/documents', { type, counterpartyId: type === 'receipt' ? supplier : customer, lines, ...extra });
const post = async (id: string, c = owner) => {
  const r = await c.post(`/documents/${id}/post`);
  if (r.status !== 200) throw new Error(`post ${id} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const balance = async (productId: string) => {
  const r = await owner.get(`/stock/balances?productId=${productId}&warehouseId=${whId}`);
  return r.body.items[0] as { qty: string; avgCost: string; value: string } | undefined;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Kits WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Other Kits WS' });

  whId = (await owner.get('/warehouses')).body.items[0].id;
  customer = (await mk(owner, '/companies', { name: 'ООО Покупатель', inn: '7707083893' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО Поставщик', inn: '7728168971' })).id;

  table = (await mk(owner, '/products', { name: 'Стол', price: 300, purchasePrice: 150, vatRate: '20' })).id;
  chair = (await mk(owner, '/products', { name: 'Стул', price: 100, purchasePrice: 40, vatRate: '20' })).id;
  lamp = (await mk(owner, '/products', { name: 'Лампа', price: 0, purchasePrice: 25, vatRate: '20' })).id;
  serviceProd = (await mk(owner, '/products', { name: 'Сборка', kind: 'service', price: 50 })).id;
  serialProd = (await mk(owner, '/products', { name: 'Модуль SN', trackSerials: true, price: 200 })).id;
  kitDining = (await mk(owner, '/products', { name: 'Обеденная группа', isKit: true, price: 500, vatRate: '20' })).id;
});

describe('kit definition and cycle protection', () => {
  test('validates kind, tracking, duplicates, cycles and tenant isolation', async () => {
    expect((await owner.post('/products', { name: 'Услуга-набор', kind: 'service', isKit: true })).status).toBe(422);
    expect((await owner.post('/products', { name: 'С серийниками', trackSerials: true, isKit: true })).status).toBe(422);
    expect((await owner.patch(`/products/${serviceProd}`, { isKit: true })).status).toBe(422);
    expect((await owner.patch(`/products/${serialProd}`, { isKit: true })).status).toBe(422);

    // Самоссылка и дубль
    expect((await owner.put(`/products/${kitDining}/kit-items`, { items: [{ componentProductId: kitDining, qty: 1 }] })).body.error.code).toBe('kit_cycle');
    expect((await owner.put(`/products/${kitDining}/kit-items`, {
      items: [{ componentProductId: table, qty: 1 }, { componentProductId: table, qty: 2 }],
    })).body.error.code).toBe('kit_duplicate_component');
    expect((await owner.put(`/products/${kitDining}/kit-items`, { items: [{ componentProductId: serviceProd, qty: 1 }] })).body.error.code).toBe('kit_component_goods_only');

    // Многошаговый цикл: A -> B -> A
    const kitA = (await mk(owner, '/products', { name: 'Набор A', isKit: true })).id;
    const kitB = (await mk(owner, '/products', { name: 'Набор B', isKit: true })).id;
    expect((await owner.put(`/products/${kitA}/kit-items`, { items: [{ componentProductId: kitB, qty: 1 }] })).status).toBe(200);
    expect((await owner.put(`/products/${kitB}/kit-items`, { items: [{ componentProductId: kitA, qty: 1 }] })).body.error.code).toBe('kit_cycle');

    // Сохранение состава и изоляция арендатора
    const saved = await owner.put(`/products/${kitDining}/kit-items`, {
      items: [
        { componentProductId: table, qty: '1', priceShare: '60' },
        { componentProductId: chair, qty: '4', priceShare: '40' },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.items).toHaveLength(2);
    expect((await owner.get(`/products/${kitDining}/kit-items`)).body).toMatchObject({ isKit: true });
    expect((await other.get(`/products/${kitDining}/kit-items`)).status).toBe(404);
  });
});

describe('kit posting, distribution, COGS, returns and unposting', () => {
  test('realization deducts components without kit stock, distributes revenue penny-exactly, computes COGS and unposts cleanly', async () => {
    // Приходуем только составляющие, самого комплекта на складе 0
    const rc = await doc(owner, 'receipt', [
      { productId: table, qty: 5, price: 150 },
      { productId: chair, qty: 20, price: 40 },
      { productId: lamp, qty: 10, price: 25 },
    ], { warehouseId: whId });
    await post(rc.id);

    // Набор нельзя оприходовать или переместить как штучный складской товар
    const badRc = await doc(owner, 'receipt', [{ productId: kitDining, qty: 1, price: 500 }], { warehouseId: whId });
    expect((await owner.post(`/documents/${badRc.id}/post`)).body.error.code).toBe('kit_not_stockable');

    // Продаём 2 комплекта по 500.01 (VAT 20% сверху -> net 1000.02, vat 200.00, total 1200.02)
    const sale = await doc(owner, 'realization', [
      { productId: kitDining, qty: 2, price: '500.01', vatRate: '20' },
    ], { warehouseId: whId, priceIncludesVat: false });
    await post(sale.id);

    expect((await balance(kitDining))).toBeUndefined();
    expect((await balance(table))?.qty).toBe('3.000'); // 5 - 2*1
    expect((await balance(chair))?.qty).toBe('12.000'); // 20 - 2*4

    const detail = (await owner.get(`/documents/${sale.id}`)).body;
    const line = detail.lines[0];
    expect(line.isKit).toBe(true);
    expect(line.kitItems).toHaveLength(2);
    // Доли 60% и 40% от net=1000.02, vat=200.00, total=1200.02
    expect(line.kitItems[0]).toMatchObject({ componentProductId: table, qty: '2.000', net: '600.01', vatAmount: '120.00', total: '720.01', unitCost: '150.0000', cogs: '300.00' });
    expect(line.kitItems[1]).toMatchObject({ componentProductId: chair, qty: '8.000', net: '400.01', vatAmount: '80.00', total: '480.01', unitCost: '40.0000', cogs: '320.00' });

    // Не-администратор не видит себестоимость и наценку по компонентам комплекта
    const memberDetail = (await member.get(`/documents/${sale.id}`)).body;
    expect(memberDetail.lines[0].kitItems[0].unitCost).toBeNull();
    expect(memberDetail.lines[0].kitItems[0].cogs).toBeNull();

    // Отчёт по валовой прибыли учитывает списание составляющих
    const profit = (await owner.get('/documents/reports/sales-profit')).body;
    expect(profit.totals.cogs).toBe('620.00');

    // Возврат от покупателя на основании реализации возвращает компоненты по исходной себестоимости
    const ret = await mk(owner, `/documents/${sale.id}/based-on`, { type: 'customer_return' });
    await post(ret.id);
    expect((await balance(table))?.qty).toBe('5.000');
    expect((await balance(chair))?.qty).toBe('20.000');

    await owner.post(`/documents/${ret.id}/unpost`);
    expect((await balance(table))?.qty).toBe('3.000');
    expect((await balance(chair))?.qty).toBe('12.000');

    await owner.post(`/documents/${sale.id}/unpost`);
    expect((await balance(table))?.qty).toBe('5.000');
    expect((await balance(chair))?.qty).toBe('20.000');
  });

  test('supports nested kits, catalog-price split, qty fallback and blocks insufficient component stock', async () => {
    // Вложенный комплект: большой набор = 1 × Обеденная группа + 2 × Лампа
    const nested = (await mk(owner, '/products', { name: 'Большая группа', isKit: true, price: 600, vatRate: '20' })).id;
    await owner.put(`/products/${nested}/kit-items`, {
      items: [
        { componentProductId: kitDining, qty: 1, priceShare: 80 },
        { componentProductId: lamp, qty: 2, priceShare: 20 },
      ],
    });
    const nestedSale = await doc(owner, 'realization', [{ productId: nested, qty: 1, price: '600', vatRate: '20' }], { warehouseId: whId });
    await post(nestedSale.id);
    expect((await balance(table))?.qty).toBe('4.000');
    expect((await balance(chair))?.qty).toBe('16.000');
    expect((await balance(lamp))?.qty).toBe('8.000');
    await owner.post(`/documents/${nestedSale.id}/unpost`);
    expect((await balance(table))?.qty).toBe('5.000');

    // Распределение по каталожным ценам (без явного priceShare): Стол=300 (1шт), Стул=100 (1шт) -> 75% / 25%
    const kCatalog = (await mk(owner, '/products', { name: 'По каталогу', isKit: true, price: 200, vatRate: 'none' })).id;
    await owner.put(`/products/${kCatalog}/kit-items`, {
      items: [{ componentProductId: table, qty: 1 }, { componentProductId: chair, qty: 1 }],
    });
    const sc = await doc(owner, 'realization', [{ productId: kCatalog, qty: 1, price: '200', vatRate: 'none' }], { warehouseId: whId });
    await post(sc.id);
    const catItems = (await owner.get(`/documents/${sc.id}`)).body.lines[0].kitItems;
    expect(catItems[0].total).toBe('150.00');
    expect(catItems[1].total).toBe('50.00');
    await owner.post(`/documents/${sc.id}/unpost`);

    // Fallback по количеству при нулевых ценах каталога и долях: 100.00 / (1 + 2) => 33.33 и 66.67
    const zeroA = (await mk(owner, '/products', { name: 'БезЦены А', price: 0 })).id;
    const zeroB = (await mk(owner, '/products', { name: 'БезЦены Б', price: 0 })).id;
    await post((await doc(owner, 'receipt', [{ productId: zeroA, qty: 5, price: 10 }, { productId: zeroB, qty: 5, price: 20 }], { warehouseId: whId })).id);

    const kZero = (await mk(owner, '/products', { name: 'Равный набор', isKit: true, price: 100, vatRate: 'none' })).id;
    await owner.put(`/products/${kZero}/kit-items`, {
      items: [{ componentProductId: zeroA, qty: 1 }, { componentProductId: zeroB, qty: 2 }],
    });

    const s = await doc(owner, 'realization', [{ productId: kZero, qty: 1, price: '100', vatRate: 'none' }], { warehouseId: whId });
    await post(s.id);
    const items = (await owner.get(`/documents/${s.id}`)).body.lines[0].kitItems;
    expect(items[0].total).toBe('33.33');
    expect(items[1].total).toBe('66.67');

    // Нехватка хотя бы одного компонента блокирует проведение комплекта
    const tooMuch = await doc(owner, 'realization', [{ productId: kZero, qty: 10, price: '100' }], { warehouseId: whId });
    expect((await owner.post(`/documents/${tooMuch.id}/post`)).body.error.code).toBe('insufficient_stock');
  });
});
