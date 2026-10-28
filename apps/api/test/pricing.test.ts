/* Виды цен и прайс-листы (задача 1178): справочник и права, история цен и установка цен с отменой, расчётные виды
   (от другого вида и от себестоимости), приоритет подстановки, цены поставщика из поступления, варианты, прайс-лист
   (JSON, печать, XLSX, загрузка), публичная ссылка и изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { admin, Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let retail: string;
let purchase: string;
let wholesale: string;
let dealer: string;
let phone: string;
let cable: string;
let company: string;
let supplier: string;
let supplierKind: string;
let warehouse: string;

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

const resolve = async (c: Client, body: Record<string, unknown>) => {
  const r = await c.post('/pricing/resolve', body);
  expect(r.status).toBe(200);
  return r.body as { priceKindId: string; priceKindName: string; source: string; prices: Record<string, string | null> };
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Pricing WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Other pricing WS' });
  const kinds = (await owner.get('/pricing/kinds')).body.items as any[];
  retail = kinds.find(k => k.systemKey === 'retail').id;
  purchase = kinds.find(k => k.systemKey === 'purchase').id;
  phone = (await mk(owner, '/products', { name: 'Смартфон', sku: 'PH-1', kind: 'goods', price: 1000, vatRate: 'none' })).id;
  cable = (await mk(owner, '/products', { name: 'Кабель', sku: 'CB-1', kind: 'goods', price: 99.5, purchasePrice: 40, vatRate: 'none' })).id;
  company = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7728168971' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»', inn: '7707083893' })).id;
  warehouse = (await owner.get('/warehouses')).body.items[0].id;
});

describe('виды цен: справочник и права', () => {
  test('системные виды есть, ручные и расчётные создаёт admin', async () => {
    const kinds = (await owner.get('/pricing/kinds')).body.items as any[];
    expect(kinds.map(k => k.systemKey).sort()).toEqual(['purchase', 'retail']);
    wholesale = (await mk(owner, '/pricing/kinds', { name: 'Оптовая', method: 'derived', baseKindId: retail, markupPct: -15, roundingStep: '1' })).id;
    dealer = (await mk(owner, '/pricing/kinds', { name: 'Дилерская', method: 'cost_based', costBasis: 'avg_cost', markupPct: 25, roundingStep: '1', roundingMode: 'up' })).id;
    supplierKind = (await mk(owner, '/pricing/kinds', { name: 'Прайс поставщика', method: 'manual', supplierId: supplier, updateFromReceipts: true })).id;
    expect((await owner.post('/pricing/kinds', { name: 'Оптовая' })).status).toBe(409);
  });

  test('участник не правит виды и не видит закупочные, расчётные от себестоимости и цены поставщиков', async () => {
    expect((await member.post('/pricing/kinds', { name: 'Моя' })).status).toBe(403);
    const names = ((await member.get('/pricing/kinds')).body.items as any[]).map(k => k.name).sort();
    expect(names).toEqual(['Оптовая', 'Розничная']);
    expect((await member.post('/pricing/settings', {})).status).toBe(403);
  });

  test('проверки: цикл, «до 9» только при крупном шаге, системный вид не архивируется', async () => {
    const a = (await mk(owner, '/pricing/kinds', { name: 'Цикл А', method: 'derived', baseKindId: retail, markupPct: 1 })).id;
    const b = (await mk(owner, '/pricing/kinds', { name: 'Цикл Б', method: 'derived', baseKindId: a, markupPct: 1 })).id;
    const cyc = await owner.patch(`/pricing/kinds/${a}`, { baseKindId: b });
    expect(cyc.status).toBe(422);
    expect(cyc.body.error.code).toBe('price_kind_cycle');
    expect((await owner.post('/pricing/kinds', { name: 'Девятка', roundToNine: true, roundingStep: '1' })).body.error.code).toBe('price_nine_step');
    expect((await owner.del(`/pricing/kinds/${retail}`)).body.error.code).toBe('price_kind_system');
    expect((await owner.del(`/pricing/kinds/${a}`)).body.error.code).toBe('price_kind_in_use');
    expect((await owner.del(`/pricing/kinds/${b}`)).status).toBe(200);
    expect((await owner.del(`/pricing/kinds/${a}`)).status).toBe(200);
  });
});

describe('подстановка и история', () => {
  test('цена из карточки попадает в историю «Розничной»; расчётный вид — от розничной с округлением', async () => {
    const r = await resolve(owner, { productIds: [phone, cable], party: 'customer' });
    expect(r.priceKindId).toBe(retail);
    expect(r.prices[phone]).toBe('1000.00');
    expect(r.prices[cable]).toBe('99.50');
    const w = await resolve(owner, { productIds: [phone, cable], priceKindId: wholesale });
    expect(w.source).toBe('header');
    expect(w.prices[phone]).toBe('850.00');
    expect(w.prices[cable]).toBe('85.00'); // 84.575 → 85
    const hist = (await owner.get(`/pricing/products/${phone}/history`)).body.items;
    expect(hist.length).toBe(1);
  });

  test('правка цены в карточке — новая запись истории, подстановка видит её', async () => {
    await owner.patch(`/products/${cable}`, { price: 120 });
    expect((await resolve(owner, { productIds: [cable] })).prices[cable]).toBe('120.00');
    await owner.patch(`/products/${cable}`, { price: 99.5 });
    expect((await resolve(owner, { productIds: [cable] })).prices[cable]).toBe('99.50');
  });

  test('установка цен на дату: цена на дату, старая цена, отмена возвращает предыдущую, кэш карточки', async () => {
    const past = iso(-10);
    const future = iso(10);
    const s1 = await mk(owner, '/pricing/settings', { date: past, lines: [{ productId: phone, priceKindId: retail, price: 1100 }] });
    const s2 = await mk(owner, '/pricing/settings', { date: future, lines: [{ productId: phone, priceKindId: retail, price: 1300 }] });
    // черновик цену не меняет
    expect((await resolve(owner, { productIds: [phone] })).prices[phone]).toBe('1000.00');
    expect((await owner.post(`/documents/${s1.id}/post`)).status).toBe(200);
    expect((await owner.post(`/documents/${s2.id}/post`)).status).toBe(200);
    expect((await resolve(owner, { productIds: [phone], date: iso(0) })).prices[phone]).toBe('1000.00'); // запись дня: сегодняшняя правка карточки новее
    expect((await resolve(owner, { productIds: [phone], date: iso(-5) })).prices[phone]).toBe('1100.00');
    expect((await resolve(owner, { productIds: [phone], date: iso(11) })).prices[phone]).toBe('1300.00');
    const detail = (await owner.get(`/pricing/settings/${s1.id}`)).body;
    expect(detail.lines[0].oldPrice).toBe('1000.00');
    // отмена возвращает предыдущие цены на даты после установки
    expect((await owner.post(`/documents/${s2.id}/unpost`)).status).toBe(200);
    expect((await resolve(owner, { productIds: [phone], date: iso(11) })).prices[phone]).toBe('1000.00');
    expect((await owner.post(`/documents/${s1.id}/unpost`)).status).toBe(200);
    expect((await resolve(owner, { productIds: [phone], date: iso(-5) })).prices[phone]).toBe('1000.00');
  });

  test('установка цен: дубли строк, заполнение по всем и массовое изменение +10 % с округлением', async () => {
    const dup = await owner.post('/pricing/settings', { lines: [{ productId: phone, priceKindId: retail, price: 1 }, { productId: phone, priceKindId: retail, price: 2 }] });
    expect(dup.status).toBe(422);
    expect(dup.body.error.code).toBe('duplicate_price_line');
    const s = await mk(owner, '/pricing/settings', {});
    const filled = (await owner.post(`/pricing/settings/${s.id}/fill`, { mode: 'all', priceKindIds: [retail] })).body;
    expect(filled.lines.length).toBe(2);
    const mass = (await owner.post(`/pricing/settings/${s.id}/mass`, { action: 'percent', percent: 10, roundingStep: '10', roundingMode: 'up' })).body;
    expect(mass.changed).toBe(2);
    const byProduct = Object.fromEntries(mass.lines.map((l: any) => [l.productId, l.price]));
    expect(byProduct[phone]).toBe('1100.00');
    expect(byProduct[cable]).toBe('110.00'); // 99.5 × 1.1 = 109.45 → вверх до 10
    const empty = await mk(owner, '/pricing/settings', {});
    expect((await owner.post(`/documents/${empty.id}/post`)).status).toBe(422);
    // обычные маршруты документов не правят установку цен, участник её не видит
    expect((await owner.patch(`/documents/${s.id}`, { comment: 'x' })).body.error.code).toBe('pricing_api_only');
    expect((await member.get(`/documents/${s.id}`)).status).toBe(403);
  });
});

describe('приоритет вида цен', () => {
  test('шапка ← договор ← контрагент ← вид заказ-наряда ← розничная', async () => {
    expect((await resolve(owner, { productIds: [phone], counterpartyId: company })).priceKindName).toBe('Розничная');
    const wo = (await mk(owner, '/work-order-kinds', { name: 'Монтаж', priceKindId: wholesale })).id;
    expect((await resolve(owner, { productIds: [phone], workOrderKindId: wo })).source).toBe('work_order_kind');
    await owner.patch(`/companies/${company}`, { priceKindId: retail });
    const byCompany = await resolve(owner, { productIds: [phone], counterpartyId: company, workOrderKindId: wo });
    expect(byCompany.source).toBe('company');
    expect(byCompany.priceKindId).toBe(retail);
    const contract = (await mk(owner, '/contracts', { companyId: company, number: 'Д-1', date: '2026-01-01', kind: 'customer', validFrom: '2026-01-01', priceKindId: wholesale })).id;
    const byContract = await resolve(owner, { productIds: [phone], counterpartyId: company, contractId: contract });
    expect(byContract.source).toBe('contract');
    expect(byContract.prices[phone]).toBe('850.00');
    const byHeader = await resolve(owner, { productIds: [phone], counterpartyId: company, contractId: contract, priceKindId: retail });
    expect(byHeader.source).toBe('header');
    expect(byHeader.prices[phone]).toBe('1000.00');
    // шапка документа хранится в документе
    const doc = await mk(owner, '/documents', { type: 'invoice', counterpartyId: company, priceKindId: wholesale, lines: [{ productId: phone, qty: 1, price: 850 }] });
    expect(doc.priceKindId).toBe(wholesale);
  });

  test('запись на приём берёт цену по виду цен клиента (договор — не нужен, достаточно контрагента)', async () => {
    const r = await resolve(owner, { productIds: [phone], counterpartyId: company, party: 'customer' });
    expect(r.priceKindId).toBe(retail);
  });
});

describe('расчёт от себестоимости, варианты, поступления', () => {
  test('«Дилерская» = средняя себестоимость + 25 % с округлением вверх до 1', async () => {
    // нет остатка — нет цены
    expect((await resolve(owner, { productIds: [phone], priceKindId: dealer })).prices[phone]).toBeNull();
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: warehouse, date: iso(-3), priceIncludesVat: false, lines: [{ productId: phone, qty: 10, price: 333 }] });
    expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
    expect((await resolve(owner, { productIds: [phone], priceKindId: dealer })).prices[phone]).toBe('417.00'); // 333 × 1.25 = 416.25 → 417
    // поступление обновило цены поставщика и только их (кэш закупочной не тронут)
    const sup = await resolve(owner, { productIds: [phone], party: 'supplier', counterpartyId: supplier });
    expect(sup.priceKindId).toBe(supplierKind);
    expect(sup.prices[phone]).toBe('333.00');
    const other2 = await resolve(owner, { productIds: [phone], party: 'supplier' });
    expect(other2.priceKindId).toBe(purchase);
    expect(other2.prices[phone]).toBeNull();
    // отмена проведения убирает цены, взятые из поступления
    expect((await owner.post(`/documents/${rc.id}/unpost`)).status).toBe(200);
    expect((await resolve(owner, { productIds: [phone], party: 'supplier', counterpartyId: supplier })).prices[phone]).toBeNull();
  });

  test('вариант без своей цены берёт цену родителя', async () => {
    const variant = (await mk(owner, '/products', { name: 'Смартфон чёрный', kind: 'goods', parentProductId: phone, variantValues: { color: 'black' }, vatRate: 'none' })).id;
    const r = await resolve(owner, { productIds: [variant] });
    expect(r.prices[variant]).toBe('1000.00');
    const w = await resolve(owner, { productIds: [variant], priceKindId: wholesale });
    expect(w.prices[variant]).toBe('850.00');
  });
});

describe('прайс-лист, выгрузка и загрузка', () => {
  test('JSON, печать и права на виды', async () => {
    const r = (await owner.get(`/pricing/price-list?kindIds=${retail},${wholesale}`)).body;
    expect(r.kinds.map((k: any) => k.name)).toEqual(['Розничная', 'Оптовая']);
    const row = r.items.find((x: any) => x.sku === 'PH-1');
    expect(row.prices[retail]).toBe('1000.00');
    expect(row.prices[wholesale]).toBe('850.00');
    // участник просит закупочную — она отсеивается
    const m = (await member.get(`/pricing/price-list?kindIds=${retail},${purchase}`)).body;
    expect(m.kinds.map((k: any) => k.name)).toEqual(['Розничная']);
    const print = await owner.get(`/pricing/price-list/print?kindIds=${retail}`);
    expect(print.status).toBe(200);
    expect(String(print.body)).toContain('Прайс-лист');
    expect(String(print.body)).toContain('Смартфон');
  });

  test('выгрузка XLSX читается и загружается обратно: сопоставление по артикулу, черновик установки цен', async () => {
    const ex = await owner.get(`/pricing/price-list/export?kindIds=${retail},${wholesale}&format=xlsx`);
    expect(ex.status).toBe(200);
    expect(ex.bytes[0]).toBe(0x50);
    expect(ex.bytes[1]).toBe(0x4b);
    const b64 = Buffer.from(ex.bytes).toString('base64');
    const prev = await owner.post('/pricing/import/preview', { fileName: 'price.xlsx', data: b64 });
    expect(prev.status).toBe(200);
    expect(prev.body.columns.priceColumns.length).toBe(2);
    expect(prev.body.summary.matched).toBeGreaterThanOrEqual(2);
    // CSV с правкой цены: «Розничная» смартфона 1250,50 (запятая), неизвестный артикул пропускается
    const csv = 'Артикул;Наименование;Розничная\r\nPH-1;Смартфон;"1 250,50"\r\nZZ-9;Неизвестный;10\r\n';
    const applied = await owner.post('/pricing/import/apply', { fileName: 'new.csv', data: Buffer.from(csv).toString('base64'), date: iso(0) });
    expect(applied.status).toBe(201);
    expect(applied.body.lines).toBe(1);
    expect(applied.body.skipped).toBe(1);
    const draft = (await owner.get(`/pricing/settings/${applied.body.id}`)).body;
    expect(draft.status).toBe('draft');
    expect(draft.lines[0].price).toBe('1250.50');
    const bad = await owner.post('/pricing/import/preview', { fileName: 'x.csv', data: Buffer.from('a;b\r\n1;2\r\n').toString('base64') });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('import_no_price_columns');
    expect((await member.post('/pricing/import/preview', { fileName: 'new.csv', data: Buffer.from(csv).toString('base64') })).status).toBe(403);
  });
});

describe('публичная ссылка', () => {
  let token: string;
  let linkId: string;

  test('закупочные, расчётные от себестоимости и цены поставщиков не публикуются', async () => {
    for (const bad of [purchase, dealer, supplierKind]) {
      const r = await owner.post('/pricing/links', { name: 'Плохая', priceKindIds: [bad] });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('price_kind_not_public');
    }
    expect((await member.post('/pricing/links', { name: 'Моя', priceKindIds: [retail] })).status).toBe(403);
  });

  test('страница открывается без входа и не отдаёт лишнего', async () => {
    const created = await mk(owner, '/pricing/links', { name: 'Для партнёров', priceKindIds: [retail, wholesale] });
    token = created.token;
    linkId = created.id;
    expect(token.startsWith(`${ws}.`)).toBe(true);
    const anon = new Client();
    const r = await anon.get(`/hooks/prices/${token}`);
    expect(r.status).toBe(200);
    expect(r.body.kinds.map((k: any) => k.name)).toEqual(expect.arrayContaining(['Розничная', 'Оптовая']));
    const item = r.body.items.find((x: any) => x.sku === 'PH-1');
    expect(item.name).toBe('Смартфон');
    expect(Object.keys(item).sort()).toEqual(['category', 'inStock', 'name', 'prices', 'sku', 'unit']);
    expect(JSON.stringify(r.body)).not.toContain('stockQty');
    expect(JSON.stringify(r.body)).not.toContain(supplier);
    // в списке ссылок токена нет — только хэш в базе
    const list = (await owner.get('/pricing/links')).body.items;
    expect(JSON.stringify(list)).not.toContain(token.split('.')[1]!);
    expect(list[0].viewCount).toBeGreaterThanOrEqual(1);
    const [row] = await admin`select token_hash from price_list_links where id = ${linkId}`;
    expect(row!.token_hash).not.toContain(token.split('.')[1]!);
  });

  test('чужой, битый и отозванный токен — один и тот же 404; вид, ставший закупочным, из ссылки пропадает', async () => {
    const anon = new Client();
    const secret = token.split('.')[1];
    expect((await anon.get(`/hooks/prices/${other.workspaceId}.${secret}`)).status).toBe(404);
    expect((await anon.get('/hooks/prices/not-a-token')).status).toBe(404);
    expect((await anon.get(`/hooks/prices/${ws}.${'x'.repeat(32)}`)).status).toBe(404);
    // срок действия
    const old = await mk(owner, '/pricing/links', { name: 'Просрочена', priceKindIds: [retail], expiresAt: '2020-01-01' });
    expect((await anon.get(`/hooks/prices/${old.token}`)).status).toBe(404);
    // вид превратили в «от себестоимости» после создания ссылки — вид не публикуется
    const tmp = (await mk(owner, '/pricing/kinds', { name: 'Временная', method: 'manual' })).id;
    const link = await mk(owner, '/pricing/links', { name: 'Временная', priceKindIds: [retail, tmp] });
    await admin`update price_kinds set method = 'cost_based', cost_basis = 'avg_cost' where id = ${tmp}`;
    const res = await anon.get(`/hooks/prices/${link.token}`);
    expect(res.body.kinds.map((k: any) => k.name)).toEqual(['Розничная']);
    expect((await owner.del(`/pricing/links/${linkId}`)).status).toBe(200);
    expect((await anon.get(`/hooks/prices/${token}`)).status).toBe(404);
  });
});

describe('изоляция арендаторов', () => {
  test('чужой воркспейс не видит и не меняет виды и цены', async () => {
    const theirs = (await other.get('/pricing/kinds')).body.items as any[];
    expect(theirs.map(k => k.name).sort()).toEqual(['Закупочная', 'Розничная']);
    expect((await other.patch(`/pricing/kinds/${wholesale}`, { name: 'Взлом' })).status).toBe(404);
    expect((await other.get(`/pricing/products/${phone}/history`)).body.items).toEqual([]);
    const r = await other.post('/pricing/resolve', { productIds: [phone], priceKindId: wholesale });
    expect(r.status).toBe(404);
    const rows = await admin`select count(*)::int as n from product_prices where workspace_id = ${other.workspaceId}`;
    expect(rows[0]!.n).toBe(0);
  });
});
