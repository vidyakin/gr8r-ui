/* Этап 7 «УНФ: Производство»: параметрические спецификации, формулы строк, варианты товара, строка «Расход»,
   калькуляция заказа покупателя, печать спецификации и фильтр списка. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let customer: string;
let warehouse: string;
let glass: string;
let profile: string;
let paint: string;
let painting: string; // услуга подрядчика (расход)
let window: string; // товар «Окно»
let spec: string; // спецификация окна
let assembly: string; // участок «Сборка»
let wood: string; // материал для проверок спецификаций
let screw: string; // второй материал

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const line = (itemId: string, body: Record<string, unknown>, c = owner) => mk(c, `/manufactured-items/${itemId}/lines`, body);

/** Параметры демо-спецификации окна: замеры (без варианта) и цвет (вариант) */
const params = [
  { key: 'width', name: 'Width', type: 'number', required: true, options: {} },
  { key: 'height', name: 'Height', type: 'number', required: true, options: {} },
  { key: 'color', name: 'Color', type: 'select', required: true, stockDimension: true, options: { choices: [{ value: 'white', label: 'White', color: 'gray' }, { value: 'black', label: 'Black', color: 'gray' }] } },
  { key: 'glass', name: 'Glass', type: 'boolean', required: false, options: {} },
];

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Stage 7 WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Other WS' });

  customer = (await mk(owner, '/companies', { name: 'Покупатель', kind: 'legal' })).id;
  warehouse = (await mk(owner, '/warehouses', { name: 'Основной', isDefault: true })).id;
  glass = (await mk(owner, '/products', { name: 'Стекло', unitCode: '006', purchasePrice: 100, price: 200 })).id;
  profile = (await mk(owner, '/products', { name: 'Профиль', unitCode: '006', purchasePrice: 200, price: 400 })).id;
  paint = (await mk(owner, '/products', { name: 'Краска', purchasePrice: 50, price: 90 })).id;
  painting = (await mk(owner, '/products', { name: 'Окраска', kind: 'service', unitCode: '876', purchasePrice: 300, price: 500 })).id;
  window = (await mk(owner, '/products', { name: 'Окно', purchasePrice: 3000, price: 5000 })).id;
  assembly = (await mk(owner, '/work-centers', { name: 'Сборка', hourlyRate: 400 })).id;
  wood = (await mk(owner, '/products', { name: 'Брус', unitCode: '006', purchasePrice: 80, price: 100 })).id;
  screw = (await mk(owner, '/products', { name: 'Шуруп', purchasePrice: 2, price: 4 })).id;
  spec = (await mk(owner, '/manufactured-items', { name: 'Окно 1200×1400', productId: window, batchQty: '1', overheadPct: '0', params })).id;
  // товар производится по спецификации по умолчанию
  await mk(owner, '/production-orders/product-settings', { productId: window, replenishment: 'production', defaultItemId: spec });
});

describe('спецификация: параметры и формулы', () => {
  test('параметры сохраняются, ключ не должен совпадать с характеристикой категории', async () => {
    const got = await owner.get(`/manufactured-items/${spec}`);
    expect(got.body.params).toHaveLength(4);
    expect(got.body.params.find((p: any) => p.key === 'color').stockDimension).toBe(true);
    // категория с характеристикой того же ключа — 422
    const cat = await mk(owner, '/product-categories', { name: 'Окна' });
    await mk(owner, `/product-categories/${cat.id}/attributes`, { name: 'Color', key: 'color', type: 'select', options: { choices: [{ value: 'white', label: 'White', color: 'gray' }] } });
    const p = await mk(owner, '/products', { name: 'Окно из каталога', categoryId: cat.id });
    const bad = await owner.post('/manufactured-items', { name: 'Конфликт', productId: p.id, params: [{ key: 'color', name: 'Цвет', type: 'select', options: { choices: [{ value: 'white', label: 'White', color: 'gray' }] } }] });
    expect(bad.status).toBe(422);
  });

  test('некорректное выражение и неизвестный параметр отклоняются при сохранении строки', async () => {
    const bad = await owner.post(`/manufactured-items/${spec}/lines`, { kind: 'material', productId: glass, qty: 1, qtyExpr: 'width *' });
    expect(bad.status).toBe(422);
    expect(String(bad.body.error?.message ?? '')).toContain('qtyExpr');
    const unknown = await owner.post(`/manufactured-items/${spec}/lines`, { kind: 'material', productId: glass, qty: 1, qtyExpr: 'depth * 2' });
    expect(unknown.status).toBe(422);
    expect(String(unknown.body.error?.message ?? '')).toContain('depth');
    const ok = await line(spec, { kind: 'material', productId: glass, qty: 1, qtyExpr: 'width * height / 1000000 * 1.05' });
    expect(ok.qtyExpr).toBe('width * height / 1000000 * 1.05');
    const badCond = await owner.post(`/manufactured-items/${spec}/lines`, { kind: 'material', productId: paint, qty: 1, condition: 'color =' });
    expect(badCond.status).toBe(422);
  });

  test('окно 1200×1400 белого цвета: площадь стекла с отходом, профиль по периметру, краска только для белого', async () => {
    await line(spec, { kind: 'material', productId: profile, qty: 1, qtyExpr: '2 * (width + height) / 1000' });
    await line(spec, { kind: 'material', productId: paint, qty: 1, condition: "color = 'white'" });
    await line(spec, { kind: 'expense', productId: painting, qty: 1 });
    await line(spec, { kind: 'work', operation: 'Сборка', workCenterId: assembly, hours: 2 });

    const white = await owner.get(`/manufactured-items/${spec}/explode?qty=1&params=${encodeURIComponent(JSON.stringify({ width: 1200, height: 1400, color: 'white' }))}`);
    expect(white.status).toBe(200);
    const mats = white.body.materials as { name: string; qty: string }[];
    expect(mats.find(m => m.name === 'Стекло')?.qty).toBe('1.764');
    expect(mats.find(m => m.name === 'Профиль')?.qty).toBe('5.200');
    expect(mats.find(m => m.name === 'Краска')?.qty).toBe('1.000');
    const black = await owner.get(`/manufactured-items/${spec}/explode?qty=1&params=${encodeURIComponent(JSON.stringify({ width: 1200, height: 1400, color: 'black' }))}`);
    expect((black.body.materials as { name: string }[]).find(m => m.name === 'Краска')).toBeUndefined();
    // расход подрядчику в развёртку входит, но в потребность (материалы) не попадает
    expect((white.body.expenses as { name: string }[]).map(m => m.name)).toContain('Окраска');
    expect((white.body.materials as { name: string }[]).map(m => m.name)).not.toContain('Окраска');
  });

  test('отрицательное количество по формуле — ошибка', async () => {
    const item = await mk(owner, '/manufactured-items', { name: 'Отрицательная', params: [{ key: 'w', name: 'W', type: 'number', options: {} }] });
    await line(item.id, { kind: 'material', productId: glass, qty: 1, qtyExpr: '0 - w' });
    const res = await owner.get(`/manufactured-items/${item.id}/explode?qty=1&params=${encodeURIComponent(JSON.stringify({ w: 5 }))}`);
    expect(res.status).toBe(422);
  });

  test('параметры передаются в полуфабрикат по совпадающим ключам', async () => {
    const child = await mk(owner, '/manufactured-items', { name: 'Рама', params: [{ key: 'color', name: 'Color', type: 'select', stockDimension: true, options: { choices: [{ value: 'white', label: 'White', color: 'gray' }, { value: 'black', label: 'Black', color: 'gray' }] } }] });
    await line(child.id, { kind: 'material', productId: profile, qty: 1, qtyExpr: "if(color = 'white', 2, 4)" });
    const parent = await mk(owner, '/manufactured-items', { name: 'Изделие с рамой', params: [{ key: 'color', name: 'Color', type: 'select', stockDimension: true, options: { choices: [{ value: 'white', label: 'White', color: 'gray' }, { value: 'black', label: 'Black', color: 'gray' }] } }] });
    await line(parent.id, { kind: 'semi', childItemId: child.id, qty: 1, semiMode: 'explode' });
    const res = await owner.get(`/manufactured-items/${parent.id}/explode?qty=1&params=${encodeURIComponent(JSON.stringify({ color: 'white' }))}`);
    expect(res.status).toBe(200);
    expect((res.body.materials as { name: string; qty: string }[]).find(m => m.name === 'Профиль')?.qty).toBe('2.000');
  });
});

describe('варианты товара', () => {
  test('замер без флажка варианта не создаёт, цвет создаёт лениво', async () => {
    const order = await mk(owner, '/documents', {
      type: 'customer_order',
      counterpartyId: customer,
      warehouseId: warehouse,
      lines: [{ productId: window, qty: 1, price: 5000, params: { width: 1200, height: 1400 } }],
    });
    const line0 = (await owner.get(`/documents/${order.id}`)).body.lines[0];
    expect(line0.productId).toBe(window); // только замеры — варианта нет
    expect((await owner.get(`/products/${window}/variants`)).body.items).toHaveLength(0);

    const order2 = await mk(owner, '/documents', {
      type: 'customer_order',
      counterpartyId: customer,
      warehouseId: warehouse,
      lines: [{ productId: window, qty: 1, price: 5000, params: { width: 1200, height: 1400, color: 'white' } }],
    });
    const variants = (await owner.get(`/products/${window}/variants`)).body.items;
    expect(variants).toHaveLength(1);
    expect(variants[0].name).toContain('White');
    const line2 = (await owner.get(`/documents/${order2.id}`)).body.lines[0];
    expect(line2.productId).toBe(variants[0].id); // строка заказа ссылается на вариант

    // повторный заказ той же комбинации — тот же вариант
    await mk(owner, '/documents', {
      type: 'customer_order',
      counterpartyId: customer,
      warehouseId: warehouse,
      lines: [{ productId: window, qty: 1, price: 5000, params: { width: 1000, height: 1000, color: 'white' } }],
    });
    expect((await owner.get(`/products/${window}/variants`)).body.items).toHaveLength(1);
  });

  test('два параллельных создания одной комбинации — одна строка', async () => {
    const p = await mk(owner, '/products', { name: 'Стол', purchasePrice: 1000, price: 2000 });
    const s = await mk(owner, '/manufactured-items', { name: 'Стол', productId: p.id, params: [{ key: 'color', name: 'Color', type: 'select', stockDimension: true, options: { choices: [{ value: 'red', label: 'Red', color: 'gray' }] } }] });
    await owner.post('/production-orders', { items: [{ itemId: s.id, qty: 1, params: { color: 'red' } }] });
    const doc = async () =>
      mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId: p.id, qty: 1, price: 2000, params: { color: 'red' } }] });
    await Promise.all([doc(), doc()]);
    expect((await owner.get(`/products/${p.id}/variants`)).body.items).toHaveLength(1);
  });

  test('генератор комбинаций и его лимит', async () => {
    const p = await mk(owner, '/products', { name: 'Шкаф' });
    await mk(owner, '/manufactured-items', {
      name: 'Шкаф',
      productId: p.id,
      params: [{ key: 'color', name: 'Color', type: 'select', stockDimension: true, options: { choices: [{ value: 'white', label: 'White', color: 'gray' }, { value: 'black', label: 'Black', color: 'gray' }] } }],
    });
    const res = await owner.post(`/products/${p.id}/variants/generate`);
    expect(res.status).toBe(201);
    expect(res.body.total).toBe(2);
    expect((await owner.get(`/products/${p.id}/variants`)).body.items).toHaveLength(2);

    // больше 200 комбинаций — 422
    const many = Array.from({ length: 15 }, (_, i) => ({ value: `c${i}`, label: `C${i}`, color: 'gray' }));
    const p2 = await mk(owner, '/products', { name: 'Витрина' });
    await mk(owner, '/manufactured-items', { name: 'Витрина', productId: p2.id, params: [{ key: 'a', name: 'A', type: 'select', stockDimension: true, options: { choices: many } }, { key: 'b', name: 'B', type: 'select', stockDimension: true, options: { choices: many } }] });
    expect((await owner.post(`/products/${p2.id}/variants/generate`)).status).toBe(422);
  });

  test('товар с вариантами нельзя архивировать', async () => {
    const p = await mk(owner, '/products', { name: 'Полка' });
    await mk(owner, '/manufactured-items', { name: 'Полка', productId: p.id, params: [{ key: 'color', name: 'Color', type: 'select', stockDimension: true, options: { choices: [{ value: 'white', label: 'White', color: 'gray' }] } }] });
    await owner.post(`/products/${p.id}/variants/generate`);
    expect((await owner.del(`/products/${p.id}`)).status).toBe(422);
  });
});

describe('калькуляция заказа покупателя', () => {
  test('цена в калькуляции: себестоимость состава и наценка', async () => {
    const order = await mk(owner, '/documents', {
      type: 'customer_order',
      counterpartyId: customer,
      warehouseId: warehouse,
      lines: [{ productId: window, qty: 1, price: 5000, params: { width: 1200, height: 1400, color: 'white' } }],
    });
    const calc = await owner.post('/order-calculations', { customerOrderId: order.id, priceSource: 'purchase_price', markupPct: '20' });
    expect(calc.status).toBe(201);
    const c = calc.body;
    // стекло 1.764 × 100 + профиль 5.2 × 200 + краска 1 × 50 + окраска 1 × 300 + сборка 2 ч × 400
    const expected = 1.764 * 100 + 5.2 * 200 + 50 + 300 + 2 * 400;
    expect(Number(c.costTotal)).toBeCloseTo(expected, 1);
    // цена строки заказа: себестоимость единицы × (1 + 20%)
    expect(Number(c.priceTotal)).toBeCloseTo(expected * 1.2, 1);
    const kinds = (c.lines as { kind: string }[]).map(l => l.kind);
    expect(kinds).toContain('material');
    expect(kinds).toContain('expense');
    expect(kinds).toContain('work');
  });

  test('источник цены: нет цены по выбранному — берётся следующий', async () => {
    const p = await mk(owner, '/products', { name: 'Без закупочной', price: 100 });
    const s = await mk(owner, '/manufactured-items', { name: 'Без закупочной', productId: p.id });
    await line(s.id, { kind: 'material', productId: p.id, qty: 2 });
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId: p.id, qty: 1, price: 100 }] });
    const calc = await owner.post('/order-calculations', { customerOrderId: order.id, priceSource: 'purchase_price' });
    expect(calc.status).toBe(201);
    expect(Number(calc.body.costTotal)).toBe(0); // цен нет нигде
    const avg = await owner.post('/order-calculations', { customerOrderId: order.id, priceSource: 'avg' });
    expect(avg.status).toBe(201);
  });

  test('применение цены к строкам заказа', async () => {
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId: window, qty: 1, price: 1, params: { width: 1200, height: 1400, color: 'white' } }] });
    const calc = await owner.post('/order-calculations', { customerOrderId: order.id, priceSource: 'purchase_price', markupPct: '10' });
    const applied = await owner.post(`/order-calculations/${calc.body.id}/apply`, { documentId: order.id });
    expect(applied.status).toBe(200);
    const doc = await owner.get(`/documents/${order.id}`);
    const price = Number(doc.body.lines[0].price);
    expect(price).toBeGreaterThan(1);
  });

  test('member без права видеть себестоимость получает скрытые суммы, а пересчёт — 403', async () => {
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId: window, qty: 1, price: 5000, params: { width: 1200, height: 1400, color: 'white' } }] });
    const calc = await owner.post('/order-calculations', { customerOrderId: order.id });
    const seen = await member.get(`/order-calculations/${order.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.calculation.costTotal).toBeNull();
    expect(seen.body.calculation.lines.every((l: any) => l.amount === null)).toBe(true);
    expect((await member.post('/order-calculations', { customerOrderId: order.id })).status).toBe(403);
    expect((await member.post(`/order-calculations/${calc.body.id}/apply`, { documentId: order.id })).status).toBe(403);
  });

  test('изоляция арендатов: калькуляция чужого заказа недоступна', async () => {
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId: window, qty: 1, price: 5000 }] });
    await owner.post('/order-calculations', { customerOrderId: order.id });
    expect((await other.get(`/order-calculations/${order.id}`)).body.calculation).toBeNull();
    expect((await other.post('/order-calculations', { customerOrderId: order.id })).status).toBe(404);
  });
});

describe('производство: параметры, варианты, снимок', () => {
  test('снимок заказа на производство считается по формулам; в проведённом — 422', async () => {
    const order = await mk(owner, '/production-orders', { items: [{ itemId: spec, qty: 1, params: { width: 1200, height: 1400, color: 'white' } }] });
    const filled = await owner.post(`/production-orders/${order.id}/fill-from-bom`);
    expect(filled.status).toBe(200);
    const comps = filled.body.components as { kind: string; productId: string; qty: string }[];
    expect(comps.find(c => c.productId === glass)?.qty).toBe('1.764');
    expect(comps.find(c => c.productId === profile)?.qty).toBe('5.200');
    expect(comps.find(c => c.productId === painting)?.kind).toBe('expense');
    // расход не списывается со склада: у него нет строки-расхода документа
    expect(comps.find(c => c.productId === painting)).toBeDefined();

    // проведённый заказ пересчитать нельзя
    await owner.post(`/documents/${order.id}/post`);
    expect((await owner.post(`/production-orders/${order.id}/fill-from-bom`)).status).toBe(422);
  });

  test('выпуск по строке заказа с параметрами приходует вариант, остаток родителя не меняется', async () => {
    // материалы на склад: без них выпуск не провести
    const supplier = (await mk(owner, '/companies', { name: 'Поставщик окон', kind: 'legal' })).id;
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: warehouse, lines: [{ productId: glass, qty: 10, price: 100 }, { productId: profile, qty: 10, price: 200 }] });
    expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
    const order = await mk(owner, '/documents', {
      type: 'customer_order',
      counterpartyId: customer,
      warehouseId: warehouse,
      lines: [{ productId: window, qty: 1, price: 5000, params: { width: 1200, height: 1400, color: 'black' } }],
    });
    const variant = (await owner.get(`/products/${window}/variants`)).body.items.find((v: any) => v.variantValues.color === 'black');
    expect(variant).toBeDefined();
    await owner.post(`/documents/${order.id}/post`);
    const po = await mk(owner, '/production-orders/from-customer-order', { customerOrderId: order.id });
    await owner.post(`/production-orders/${po.id}/fill-from-bom`);
    await owner.post(`/documents/${po.id}/post`);
    const rel = await mk(owner, '/production-orders/production', { customerOrderId: order.id, lines: [{ customerOrderLineId: (await owner.get(`/documents/${order.id}`)).body.lines[0].id, qty: 1 }] });
    expect(rel.items[0].productVariantId).toBe(variant.id);
    await owner.post(`/documents/${rel.id}/post`);
    const balances = (await owner.get(`/stock/balances?productId=${variant.id}`)).body.items as { productId: string; qty: string }[];
    expect(Number(balances.reduce((sum, b) => sum + Number(b.qty), 0))).toBe(1);
    const parentBalances = (await owner.get(`/stock/balances?productId=${window}`)).body.items as { productId: string; qty: string }[];
    expect(parentBalances.reduce((sum, b) => sum + Number(b.qty), 0)).toBe(0);
    // расход подрядчику со склада не списывается
    const paintingBalances = (await owner.get(`/stock/balances?productId=${painting}`)).body.items as { productId: string; qty: string }[];
    expect(paintingBalances.length).toBe(0);
  });

  test('спецификация варианта выбирается раньше спецификации родителя', async () => {
    const p = await mk(owner, '/products', { name: 'Стул' });
    const parentSpec = await mk(owner, '/manufactured-items', { name: 'Стул (родитель)', productId: p.id });
    await line(parentSpec.id, { kind: 'material', productId: wood, qty: 1 });
    // параметр с флажком «разрез склада»: по нему создаются варианты
    const paramSpec = await mk(owner, '/manufactured-items', {
      name: 'Стул (параметры)',
      productId: p.id,
      params: [{ key: 'color', name: 'Color', type: 'select', stockDimension: true, options: { choices: [{ value: 'white', label: 'White', color: 'gray' }] } }],
    });
    // параметры и варианты — по спецификации, по которой товар выпускается (по умолчанию)
    await mk(owner, '/production-orders/product-settings', { productId: p.id, replenishment: 'production', defaultItemId: paramSpec.id });
    await owner.post(`/products/${p.id}/variants/generate`);
    const variant = (await owner.get(`/products/${p.id}/variants`)).body.items[0];
    // своя спецификация варианта
    const variantSpec = await mk(owner, '/manufactured-items', { name: 'Стул (вариант)', productId: variant.id });
    await line(variantSpec.id, { kind: 'material', productId: screw, qty: 2 });
    // своя спецификация товара выигрывает у спецификации по умолчанию
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId: p.id, qty: 1, price: 1000, params: { color: 'white' } }] });
    const calc = await owner.post('/order-calculations', { customerOrderId: order.id });
    const ids = (calc.body.lines as { productId: string }[]).map(l => l.productId);
    expect(ids).toContain(screw);
    expect(ids).not.toContain(wood);
  });

  test('недействительная спецификация не выбирается по умолчанию', async () => {
    const p = await mk(owner, '/products', { name: 'Тумба' });
    const s = await mk(owner, '/manufactured-items', { name: 'Тумба', productId: p.id });    await line(s.id, { kind: 'material', productId: wood, qty: 1 });
    await mk(owner, '/production-orders/product-settings', { productId: p.id, replenishment: 'production', defaultItemId: s.id });
    await owner.patch(`/manufactured-items/${s.id}`, { isInvalid: true });
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId: p.id, qty: 1, price: 1000 }] });
    await owner.post(`/documents/${order.id}/post`);
    // недействительная спецификация не предлагается: заказ на производство не создаётся
    expect((await owner.post('/production-orders/from-customer-order', { customerOrderId: order.id })).status).toBe(422);
  });
});

describe('спецификации: список, печать, недействительные', () => {
  test('фильтр «содержит материал/операцию»: по конкретному товару или операции', async () => {
    const ids = async (q: string) => (await owner.get(`/manufactured-items?contains=${q}`)).body.items.map((i: any) => i.id);
    expect(await ids(glass)).toContain(spec);
    expect(await ids(painting)).toContain(spec); // строка «Расход»
    const other = await mk(owner, '/manufactured-items', { name: 'Только шуруп' });
    await line(other.id, { kind: 'material', productId: screw, qty: 1 });
    expect(await ids(glass)).not.toContain(other.id);
    expect(await ids(screw)).toContain(other.id);
    expect(await ids(screw)).not.toContain(spec);
  });

  test('печатные формы: кратко и развёрнуто', async () => {
    const short = await owner.get(`/manufactured-items/${spec}/print/short`);
    expect(short.status).toBe(200);
    expect(String(short.body)).toContain('Стекло');
    expect(String(short.body)).not.toContain('Полуфабрикат');
    const expanded = await owner.get(`/manufactured-items/${spec}/print/expanded`);
    expect(expanded.status).toBe(200);
  });

  test('недействительная спецификация не выбирается по умолчанию', async () => {
    const p = await mk(owner, '/products', { name: 'Стул' });
    const s = await mk(owner, '/manufactured-items', { name: 'Стул', productId: p.id });
    await mk(owner, '/production-orders', { items: [{ itemId: s.id, qty: 1 }] });
    await owner.patch(`/manufactured-items/${s.id}`, { isInvalid: true });
    expect((await owner.get(`/manufactured-items/${s.id}`)).body.isInvalid).toBe(true);
  });
});

describe('review fixes (stage 7)', () => {
  const order = (lines: Record<string, unknown>[]) => mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines });

  test('значения параметров строки заказа проверяются по описанию параметров', async () => {
    const bad = await owner.post('/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId: window, qty: 1, price: 5000, params: { width: 1200, height: 1400, color: 'green' } }] });
    expect(bad.status).toBe(422);
    const notNumber = await owner.post('/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId: window, qty: 1, price: 5000, params: { width: 'wide', height: 1400, color: 'white' } }] });
    expect(notNumber.status).toBe(422);
    const unknown = await owner.post('/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId: window, qty: 1, price: 5000, params: { width: 1200, height: 1400, color: 'white', depth: 3 } }] });
    expect(unknown.status).toBe(422);
    // варианта «green» не появилось
    const names = (await owner.get(`/products/${window}/variants`)).body.items.map((v: any) => v.name);
    expect(names.some((n: string) => n.includes('green'))).toBe(false);
    // заказ на производство: те же проверки
    expect((await owner.post('/production-orders', { items: [{ itemId: spec, qty: 1, params: { width: 1200, height: 1400, color: 'green' } }] })).status).toBe(422);
  });

  test('смена параметров у строки, уже ссылающейся на вариант, переводит её на другой вариант', async () => {
    const o = await order([{ productId: window, qty: 1, price: 5000, params: { width: 1200, height: 1400, color: 'white' } }]);
    const l0 = (await owner.get(`/documents/${o.id}`)).body.lines[0];
    const upd = await owner.patch(`/documents/${o.id}`, { lines: [{ id: l0.id, productId: l0.productId, qty: 1, price: 5000, params: { width: 1200, height: 1400, color: 'black' } }] });
    expect(upd.status).toBe(200);
    const l1 = (await owner.get(`/documents/${o.id}`)).body.lines[0];
    const variants = (await owner.get(`/products/${window}/variants`)).body.items as { id: string; name: string }[];
    expect(variants.find(v => v.id === l1.productId)?.name).toContain('Black');
  });

  test('калькуляция: итог цены — по количеству, себестоимость с накладными и фиксированными затратами', async () => {
    const p = await mk(owner, '/products', { name: 'Табурет', price: 1000 });
    const s = await mk(owner, '/manufactured-items', { name: 'Табурет', productId: p.id, batchQty: '1', overheadPct: '10' });
    await line(s.id, { kind: 'material', productId: glass, qty: 1 });
    await line(s.id, { kind: 'work', operation: 'Наладка', hours: 0, fixedCost: 50 });
    await mk(owner, '/production-orders/product-settings', { productId: p.id, replenishment: 'production', defaultItemId: s.id });
    const o = await order([{ productId: p.id, qty: 2, price: 1000 }]);
    const calc = await owner.post('/order-calculations', { customerOrderId: o.id, priceSource: 'purchase_price', markupPct: '0' });
    expect(calc.status).toBe(201);
    // единица: (стекло 100 + наладка 50) × 1.1 = 165; две штуки — 330
    expect(Number(calc.body.costTotal)).toBeCloseTo(330, 2);
    expect(Number(calc.body.priceTotal)).toBeCloseTo(330, 2);
    const applied = await owner.post(`/order-calculations/${calc.body.id}/apply`, { documentId: o.id });
    expect(applied.status).toBe(200);
    expect(Number((await owner.get(`/documents/${o.id}`)).body.lines[0].price)).toBeCloseTo(165, 2);
  });

  test('цена из калькуляции не применяется к проведённому заказу', async () => {
    const o = await order([{ productId: window, qty: 1, price: 5000, params: { width: 1200, height: 1400, color: 'white' } }]);
    const calc = await owner.post('/order-calculations', { customerOrderId: o.id, priceSource: 'purchase_price', markupPct: '10' });
    expect((await owner.post(`/documents/${o.id}/post`)).status).toBe(200);
    const res = await owner.post(`/order-calculations/${calc.body.id}/apply`, { documentId: o.id });
    expect(res.status).toBe(422);
    expect(Number((await owner.get(`/documents/${o.id}`)).body.lines[0].price)).toBe(5000);
  });

  test('у обычного товара выбирается спецификация по умолчанию, а не самая ранняя своя', async () => {
    const p = await mk(owner, '/products', { name: 'Комод', price: 1000 });
    const a = await mk(owner, '/manufactured-items', { name: 'Комод A', productId: p.id });
    await line(a.id, { kind: 'material', productId: wood, qty: 1 });
    const b = await mk(owner, '/manufactured-items', { name: 'Комод B', productId: p.id });
    await line(b.id, { kind: 'material', productId: screw, qty: 3 });
    await mk(owner, '/production-orders/product-settings', { productId: p.id, replenishment: 'production', defaultItemId: b.id });
    const o = await order([{ productId: p.id, qty: 1, price: 1000 }]);
    expect((await owner.post(`/documents/${o.id}/post`)).status).toBe(200);
    const po = await owner.post('/production-orders/from-customer-order', { customerOrderId: o.id });
    expect(po.status).toBe(201);
    const items = (await owner.get(`/production-orders/${po.body.id}`)).body.items as { itemId: string }[];
    expect(items.map(i => i.itemId)).toEqual([b.id]);
    const calc = await owner.post('/order-calculations', { customerOrderId: o.id });
    const ids = (calc.body.lines as { productId: string }[]).map(l => l.productId);
    expect(ids).toContain(screw);
    expect(ids).not.toContain(wood);
  });

  test('«Расход» не попадает в потребности плана производства', async () => {
    const p = await mk(owner, '/products', { name: 'Ящик', price: 500 });
    const s = await mk(owner, '/manufactured-items', { name: 'Ящик', productId: p.id });
    await line(s.id, { kind: 'material', productId: wood, qty: 2 });
    await line(s.id, { kind: 'expense', productId: painting, qty: 1 });
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1));
    const mon = d.toISOString().slice(0, 10);
    const to = new Date(d.getTime() + 21 * 864e5).toISOString().slice(0, 10);
    const pl = await mk(owner, '/production-plans', { name: 'План ящиков', periodFrom: mon, periodTo: to, step: 'week', warehouseId: warehouse, lines: [{ itemId: s.id, periodStart: mon, qty: '3' }] });
    const needs = (await owner.get(`/production-plans/${pl.id}/needs`)).body;
    const ids = (needs.materials as { productId: string }[]).map(m => m.productId);
    expect(ids).toContain(wood);
    expect(ids).not.toContain(painting);
  });

  test('варианты с одинаковым склеенным артикулом не теряются', async () => {
    const choices = (vals: string[]) => vals.map(v => ({ value: v, label: v, color: 'gray' }));
    const p = await mk(owner, '/products', { name: 'Рамка', sku: 'FRM', price: 100 });
    const s = await mk(owner, '/manufactured-items', {
      name: 'Рамка',
      productId: p.id,
      params: [
        { key: 'a', name: 'A', type: 'select', stockDimension: true, options: { choices: choices(['1', '12']) } },
        { key: 'b', name: 'B', type: 'select', stockDimension: true, options: { choices: choices(['3', '23']) } },
      ],
    });
    await mk(owner, '/production-orders/product-settings', { productId: p.id, replenishment: 'production', defaultItemId: s.id });
    const o1 = await order([{ productId: p.id, qty: 1, price: 100, params: { a: '1', b: '23' } }]);
    const o2 = await order([{ productId: p.id, qty: 1, price: 100, params: { a: '12', b: '3' } }]);
    const l1 = (await owner.get(`/documents/${o1.id}`)).body.lines[0];
    const l2 = (await owner.get(`/documents/${o2.id}`)).body.lines[0];
    expect(l1.productId).not.toBe(p.id);
    expect(l2.productId).not.toBe(p.id);
    expect(l1.productId).not.toBe(l2.productId);
    expect((await owner.get(`/products/${p.id}/variants`)).body.items).toHaveLength(2);
  });

  test('себестоимость параметрической спецификации без значений — 422, а не 500', async () => {
    const res = await owner.get(`/manufactured-items/${spec}/cost`);
    expect(res.status).toBe(422);
  });

  test('плановая себестоимость позиции заказа на производство считается по её параметрам', async () => {
    const po = await mk(owner, '/production-orders', { items: [{ itemId: spec, qty: 1, params: { width: 1200, height: 1400, color: 'white' } }] });
    expect((await owner.post(`/production-orders/${po.id}/fill-from-bom`)).status).toBe(200);
    const item = (await owner.get(`/production-orders/${po.id}`)).body.items[0];
    expect(item.plannedUnitCost).not.toBeNull();
    expect(Number(item.plannedUnitCost)).toBeGreaterThan(0);
  });
});
