/* Каталог: единицы ОКЕИ, дерево категорий, характеристики с наследованием, товары и услуги, проверка attrs, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { OKEI_UNITS } from '@gr8r/shared';
import { Client, admin, drainJobs } from './helpers';

let owner: Client;
let member: Client;
let guest: Client;
let other: Client;
let ws: string;

const cat = async (name: string, parentId?: string | null, c = owner) => {
  const r = await c.post('/product-categories', { name, parentId });
  if (r.status !== 201) throw new Error(`category ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { id: string; path: string; parentId: string | null; name: string };
};
const attr = async (categoryId: string, body: Record<string, unknown>, c = owner) => {
  const r = await c.post(`/product-categories/${categoryId}/attributes`, body);
  if (r.status !== 201) throw new Error(`attr ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const keys = async (categoryId: string, c = owner) => (await c.get(`/product-categories/${categoryId}/attributes`)).body.items.map((a: any) => a.key) as string[];

async function joinAs(role: 'member' | 'guest') {
  const c = new Client();
  await c.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: c.user!.email, role });
  await c.post('/invites/accept', { token: inv.body.token });
  c.workspaceId = ws;
  return c;
}

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Catalog WS' });
  ws = owner.workspaceId!;
  member = await joinAs('member');
  guest = await joinAs('guest');
  other = new Client();
  await other.signup({ workspaceName: 'Other catalog WS' });
});

describe('units (OKEI)', () => {
  test('a new workspace gets the base OKEI set; admins add their own units, base ones cannot be deleted', async () => {
    const list = await owner.get('/units?limit=100');
    expect(list.body.total).toBe(OKEI_UNITS.length);
    expect(list.body.items.find((u: any) => u.code === '796')).toMatchObject({ symbol: 'шт', isBase: true });
    expect(list.body.items.find((u: any) => u.code === '356')).toMatchObject({ symbol: 'ч' });
    const mine = await owner.post('/units', { code: '9001', name: 'Паллета', symbol: 'пал' });
    expect(mine.status).toBe(201);
    expect(mine.body.isBase).toBe(false);
    expect((await owner.post('/units', { code: '9001', name: 'Дубль', symbol: 'д' })).status).toBe(409);
    expect((await owner.post('/units', { code: 'abc', name: 'Bad', symbol: 'b' })).status).toBe(400);
    expect((await member.post('/units', { code: '9002', name: 'Нельзя', symbol: 'x' })).status).toBe(403);
    expect((await member.get('/units')).status).toBe(200);
    const base = list.body.items.find((u: any) => u.code === '796');
    expect((await owner.del(`/units/${base.id}`)).status).toBe(422);
    expect((await owner.patch(`/units/${mine.body.id}`, { symbol: 'пл' })).body.symbol).toBe('пл');
    expect((await owner.del(`/units/${mine.body.id}`)).status).toBe(200);
  });

  test('a unit used by a product cannot be removed; unknown unit codes are rejected', async () => {
    const u = (await owner.post('/units', { code: '9010', name: 'Бухта', symbol: 'бух' })).body;
    const p = await owner.post('/products', { name: 'Кабель', unitCode: '9010' });
    expect(p.status).toBe(201);
    expect((await owner.del(`/units/${u.id}`)).status).toBe(422);
    expect((await owner.post('/products', { name: 'Ghost', unitCode: '9999' })).status).toBe(422);
  });
});

describe('categories: tree and paths', () => {
  test('tree is stored with a materialized path; moving a branch rewrites paths of the whole subtree; cycles are rejected', async () => {
    const root = await cat('Мебель');
    const tables = await cat('Столы', root.id);
    const office = await cat('Офисные', tables.id);
    expect(root.path).toBe(root.id);
    expect(tables.path).toBe(`${root.id}/${tables.id}`);
    expect(office.path).toBe(`${root.id}/${tables.id}/${office.id}`);

    const other2 = await cat('Фурнитура');
    const moved = await owner.patch(`/product-categories/${tables.id}`, { parentId: other2.id });
    expect(moved.status).toBe(200);
    expect(moved.body.path).toBe(`${other2.id}/${tables.id}`);
    const list = (await owner.get('/product-categories')).body.items as any[];
    expect(list.find(c => c.id === office.id).path).toBe(`${other2.id}/${tables.id}/${office.id}`);

    expect((await owner.patch(`/product-categories/${other2.id}`, { parentId: office.id })).status).toBe(422); // в своего потомка
    expect((await owner.patch(`/product-categories/${other2.id}`, { parentId: other2.id })).status).toBe(422);
    const toRoot = await owner.patch(`/product-categories/${tables.id}`, { parentId: null });
    expect(toRoot.body.path).toBe(tables.id);
    expect((await owner.get('/product-categories')).body.items.find((c: any) => c.id === office.id).path).toBe(`${tables.id}/${office.id}`);
  });

  test('only admins edit the tree; a category with children or products cannot be deleted', async () => {
    expect((await member.post('/product-categories', { name: 'Nope' })).status).toBe(403);
    const a = await cat('Удаляемая');
    const b = await cat('Дочерняя', a.id);
    expect((await owner.del(`/product-categories/${a.id}`)).status).toBe(422);
    const p = await owner.post('/products', { name: 'Товар в категории', categoryId: b.id });
    expect((await owner.del(`/product-categories/${b.id}`)).status).toBe(422);
    expect((await owner.del(`/products/${p.body.id}?hard=true`)).status).toBe(200);
    expect((await owner.del(`/product-categories/${b.id}`)).status).toBe(200);
    expect((await owner.del(`/product-categories/${a.id}`)).status).toBe(200);
  });
});

describe('category characteristics: inheritance', () => {
  let root: Awaited<ReturnType<typeof cat>>;
  let tables: Awaited<ReturnType<typeof cat>>;
  let chairs: Awaited<ReturnType<typeof cat>>;
  let hardware: Awaited<ReturnType<typeof cat>>;

  beforeAll(async () => {
    root = await cat('Наследование');
    tables = await cat('Столы-н', root.id);
    chairs = await cat('Стулья-н', root.id);
    hardware = await cat('Крепёж-н');
    await attr(root.id, { name: 'Материал', key: 'material', type: 'select', options: { choices: [{ value: 'oak', label: 'Дуб', color: 'amber' }, { value: 'pine', label: 'Сосна', color: 'green' }] } });
    await attr(tables.id, { name: 'Ширина', key: 'width', type: 'number', unit: 'мм', required: true, options: { min: 100, max: 5000 } });
    await attr(chairs.id, { name: 'Мягкое сиденье', key: 'padded', type: 'boolean' });
  });

  test('a child sees the characteristics of all ancestors first (marked inherited), then its own; siblings do not share', async () => {
    const t = (await owner.get(`/product-categories/${tables.id}/attributes`)).body.items;
    expect(t.map((a: any) => [a.key, a.inherited, a.categoryName])).toEqual([
      ['material', true, 'Наследование'],
      ['width', false, 'Столы-н'],
    ]);
    expect(await keys(root.id)).toEqual(['material']);
    expect(await keys(chairs.id)).toEqual(['material', 'padded']);
    expect(await keys(hardware.id)).toEqual([]);
    // три уровня
    const deep = await cat('Обеденные', tables.id);
    await attr(deep.id, { name: 'Форма', key: 'shape', type: 'text' });
    expect(await keys(deep.id)).toEqual(['material', 'width', 'shape']);
  });

  test('a key cannot repeat along a branch: not in descendants, not in ancestors', async () => {
    expect((await owner.post(`/product-categories/${tables.id}/attributes`, { name: 'Материал 2', key: 'material', type: 'text' })).status).toBe(409); // у предка
    expect((await owner.post(`/product-categories/${root.id}/attributes`, { name: 'Ширина', key: 'width', type: 'number' })).status).toBe(409); // у потомка
    expect((await owner.post(`/product-categories/${chairs.id}/attributes`, { name: 'Ширина', key: 'width', type: 'number' })).status).toBe(201); // у соседа можно
    expect((await owner.post(`/product-categories/${chairs.id}/attributes`, { name: 'Bad select', type: 'select' })).status).toBe(400); // нет вариантов
    expect((await member.post(`/product-categories/${chairs.id}/attributes`, { name: 'Нельзя', type: 'text' })).status).toBe(403);
    // перенос ветки в родителя с таким же ключом отклоняется
    const guarded = await cat('Крепёж-к');
    await attr(guarded.id, { name: 'Ширина', key: 'width', type: 'number' });
    expect((await owner.patch(`/product-categories/${tables.id}`, { parentId: guarded.id })).status).toBe(409);
  });

  test('product attrs are validated against the inherited schema of its category', async () => {
    const ok = await owner.post('/products', { name: 'Стол дубовый', categoryId: tables.id, attrs: { material: 'oak', width: 1200 } });
    expect(ok.status).toBe(201);
    expect(ok.body.attrs).toEqual({ material: 'oak', width: 1200 });
    const bad = (attrs: unknown, categoryId = tables.id) => owner.post('/products', { name: 'X', categoryId, attrs });
    expect((await bad({ material: 'oak' })).status).toBe(400); // width обязательна
    expect((await bad({ material: 'steel', width: 1000 })).status).toBe(400); // нет такого варианта
    expect((await bad({ material: 'oak', width: 50 })).status).toBe(400); // меньше min
    expect((await bad({ material: 'oak', width: 'wide' })).status).toBe(400);
    const unknown = await bad({ material: 'oak', width: 1000, padded: true }); // характеристика соседней категории
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toContain('attrs.padded');
    expect((await bad({ foo: 1 }, hardware.id)).status).toBe(400);
    expect((await owner.post('/products', { name: 'Без категории', attrs: { material: 'oak' } })).status).toBe(400); // без категории характеристик нет
    expect((await owner.post('/products', { name: 'Без категории и attrs' })).status).toBe(201);
  });

  test('PATCH attrs: only changed keys are validated, null removes a key; changing the category re-validates the whole set', async () => {
    const p = (await owner.post('/products', { name: 'Стол для правки', categoryId: tables.id, attrs: { material: 'oak', width: 1500 } })).body;
    expect((await owner.patch(`/products/${p.id}`, { attrs: { width: 1800 } })).body.attrs).toEqual({ material: 'oak', width: 1800 });
    expect((await owner.patch(`/products/${p.id}`, { attrs: { width: 10 } })).status).toBe(400);
    expect((await owner.patch(`/products/${p.id}`, { attrs: { material: null } })).body.attrs).toEqual({ width: 1800 });
    expect((await owner.patch(`/products/${p.id}`, { attrs: { width: null } })).status).toBe(400); // обязательная
    // в стулья: width нет в схеме стульев? — есть (добавили выше), material унаследован; padded необязателен
    const moved = await owner.patch(`/products/${p.id}`, { categoryId: chairs.id, attrs: { material: 'pine' } });
    expect(moved.status).toBe(200);
    expect(moved.body.attrs).toEqual({ material: 'pine', width: 1800 });
    // категория без таких характеристик: старые значения нужно убрать явно
    expect((await owner.patch(`/products/${p.id}`, { categoryId: hardware.id })).status).toBe(400);
    const cleared = await owner.patch(`/products/${p.id}`, { categoryId: hardware.id, attrs: { material: null, width: null } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.attrs).toEqual({});
  });

  test('deleting a characteristic needs confirmation and clears its values from the whole branch', async () => {
    const root2 = await cat('Удаление-х');
    const sub = await cat('Подкатегория-х', root2.id);
    const a = await attr(root2.id, { name: 'Цвет', key: 'color', type: 'text' });
    const p = (await owner.post('/products', { name: 'Крашеный', categoryId: sub.id, attrs: { color: 'red' } })).body;
    expect((await owner.del(`/attribute-defs/${a.id}`)).status).toBe(400);
    expect((await member.del(`/attribute-defs/${a.id}?confirm=color`)).status).toBe(403);
    const del = await owner.del(`/attribute-defs/${a.id}?confirm=color`);
    expect(del.body).toMatchObject({ deleted: true, cleared: 1 });
    expect((await owner.get(`/products/${p.id}`)).body.attrs).toEqual({});
    expect(await keys(sub.id)).toEqual([]);
  });

  test('attribute can be edited (name, unit, options) but not its type or key', async () => {
    const c = await cat('Правка-х');
    const a = await attr(c.id, { name: 'Вес', key: 'weight', type: 'number', unit: 'кг' });
    const upd = await owner.patch(`/attribute-defs/${a.id}`, { name: 'Масса', unit: 'г', required: true });
    expect(upd.body).toMatchObject({ name: 'Масса', unit: 'г', required: true, key: 'weight', type: 'number' });
    expect((await owner.patch(`/attribute-defs/${a.id}`, { type: 'text' })).status).toBe(400);
    expect((await owner.patch(`/attribute-defs/${a.id}`, { key: 'w' })).status).toBe(400);
  });
});

describe('products and services', () => {
  let tables: string;
  let chairs: string;
  let all: string;

  beforeAll(async () => {
    all = (await cat('Фильтры')).id;
    tables = (await cat('Столы-ф', all)).id;
    chairs = (await cat('Стулья-ф', all)).id;
  });

  test('create with defaults, VAT and units; services; validation', async () => {
    const g = await owner.post('/products', { name: 'Шуруп 4x40', sku: 'SCR-440', barcode: '4600000000017', unitCode: '796', vatRate: '20', price: '3.50', purchasePrice: 1.2 });
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({ kind: 'goods', sku: 'SCR-440', price: '3.50', purchasePrice: '1.20', vatRate: '20', isActive: true, attrs: {}, custom: {} });
    const s = await owner.post('/products', { kind: 'service', name: 'Доставка', unitCode: '876', vatRate: 'none', price: 1500 });
    expect(s.body).toMatchObject({ kind: 'service', vatRate: 'none', price: '1500.00', unitCode: '876' });
    for (const rate of ['0', '5', '7', '10', '20', 'none']) expect((await owner.post('/products', { name: `НДС ${rate}`, vatRate: rate })).status).toBe(201);
    expect((await owner.post('/products', { name: 'bad vat', vatRate: '18' })).status).toBe(400);
    expect((await owner.post('/products', { name: 'neg', price: '-1' })).status).toBe(400);
    expect((await owner.post('/products', { name: 'bad barcode', barcode: '12ab' })).status).toBe(400);
    expect((await owner.post('/products', { name: '' })).status).toBe(400);
    expect((await owner.post('/products', { name: 'Дубль SKU', sku: 'scr-440' })).status).toBe(409); // без учёта регистра
    expect((await owner.post('/products', { name: 'Дубль ШК', barcode: '4600000000017' })).status).toBe(409);
    expect((await owner.post('/products', { name: 'Пустые SKU повторяются' })).status).toBe(201);
    expect((await owner.post('/products', { name: 'Пустые SKU повторяются 2' })).status).toBe(201);
  });

  test('list: filters by category subtree, kind, activity; search by name / sku / barcode; sort', async () => {
    const mk = (b: Record<string, unknown>) => owner.post('/products', b).then(r => r.body);
    await mk({ name: 'Стол А', sku: 'FT-A', categoryId: tables, price: 100 });
    await mk({ name: 'Стол Б', sku: 'FT-B', categoryId: tables, price: 300, isActive: false });
    await mk({ name: 'Стул В', sku: 'FC-V', categoryId: chairs, price: 200 });
    await mk({ name: 'Услуга сборки', kind: 'service', sku: 'FS-1', categoryId: all, price: 50, barcode: '4600000000024' });
    const names = async (q: string) => {
      const r = await owner.get(`/products?${q.includes('sort=') ? q : q + '&sort=name'}&limit=100`);
      if (r.status !== 200) throw new Error(JSON.stringify(r.body));
      return r.body.items.map((p: any) => p.name) as string[];
    };
    expect(await names(`categoryId=${tables}`)).toEqual(['Стол А', 'Стол Б']);
    expect(await names(`categoryId=${all}`)).toEqual(['Стол А', 'Стол Б', 'Стул В', 'Услуга сборки']); // с подкатегориями
    expect(await names(`categoryId=${all}&subtree=false`)).toEqual(['Услуга сборки']);
    expect(await names(`categoryId=${all}&kind=service`)).toEqual(['Услуга сборки']);
    expect(await names(`categoryId=${all}&active=false`)).toEqual(['Стол Б']);
    expect(await names(`categoryId=${all}&active=true&q=стол`)).toEqual(['Стол А']);
    expect(await names('q=FC-V')).toEqual(['Стул В']);
    expect(await names('q=4600000000024')).toEqual(['Услуга сборки']);
    expect(await names(`categoryId=${all}&sort=-price`)).toEqual(['Стол Б', 'Стул В', 'Стол А', 'Услуга сборки']);
    expect((await owner.get('/products?sort=secret')).status).toBe(400);
    expect((await owner.get('/products?categoryId=nope')).status).toBe(400);
  });

  test('update, archive, restore; roles: members write, guests only read', async () => {
    const p = (await owner.post('/products', { name: 'Права', sku: 'ROLE-1' })).body;
    expect((await guest.post('/products', { name: 'Гость' })).status).toBe(403);
    expect((await guest.patch(`/products/${p.id}`, { name: 'Гость' })).status).toBe(403);
    expect((await guest.get(`/products/${p.id}`)).status).toBe(200);
    expect((await member.patch(`/products/${p.id}`, { price: '99.90', vatRate: '10', isActive: false })).body).toMatchObject({ price: '99.90', vatRate: '10', isActive: false });
    expect((await member.del(`/products/${p.id}`)).body.archived).toBe(true);
    expect((await member.del(`/products/${p.id}?hard=true`)).status).toBe(403);
    expect((await owner.get('/products?q=ROLE-1')).body.total).toBe(0);
    expect((await owner.get('/products?q=ROLE-1&archived=only')).body.total).toBe(1);
    expect((await member.post(`/products/${p.id}/restore`)).status).toBe(200);
    expect((await owner.patch(`/products/${p.id}`, { unitCode: '9999' })).status).toBe(422);
  });

  test('custom fields of the constructor work on products (system entity "product")', async () => {
    expect((await owner.get('/entities/product')).body).toMatchObject({ kind: 'system', titleField: 'name' });
    const f = await owner.post('/entities/product/fields', { name: 'Shelf life', key: 'shelf_life', type: 'number', filterable: true, options: { min: 0 } });
    expect(f.status).toBe(201);
    const p = await owner.post('/products', { name: 'С полем', custom: { shelf_life: 12 } });
    expect(p.body.custom).toEqual({ shelf_life: 12 });
    expect((await owner.post('/products', { name: 'С плохим полем', custom: { shelf_life: -1 } })).status).toBe(400);
    expect((await owner.patch(`/products/${p.body.id}`, { custom: { shelf_life: 24 } })).body.custom).toEqual({ shelf_life: 24 });
    // индекс по custom таблицы products строит воркер
    await drainJobs();
    const idx = await admin.unsafe(`select indexdef from pg_indexes where indexname = 'idx_cf_${f.body.id.replace(/-/g, '')}'`);
    expect(idx[0]?.indexdef).toContain('ON public.products');
  });
});

describe('tenant isolation', () => {
  test('another workspace sees nothing and cannot reference units, categories or products of this one', async () => {
    const c = await cat('Секретная категория');
    await attr(c.id, { name: 'Секрет', key: 'secret', type: 'text' });
    const p = (await owner.post('/products', { name: 'Секретный товар', categoryId: c.id, attrs: { secret: 'x' } })).body;
    expect((await other.get('/products')).body.items.map((x: any) => x.name)).not.toContain('Секретный товар');
    expect((await other.get(`/products/${p.id}`)).status).toBe(404);
    expect((await other.get(`/product-categories/${c.id}`)).status).toBe(404);
    expect((await other.get(`/product-categories/${c.id}/attributes`)).status).toBe(404);
    expect((await other.patch(`/products/${p.id}`, { name: 'Взлом' })).status).toBe(404);
    expect((await other.del(`/product-categories/${c.id}`)).status).toBe(404);
    // чужая категория недоступна ни при создании, ни при переносе
    expect((await other.post('/products', { name: 'Чужая категория', categoryId: c.id })).status).toBe(404);
    expect((await other.post('/product-categories', { name: 'Под чужой', parentId: c.id })).status).toBe(404);
    // единицы своего воркспейса: пользовательская единица первого не существует во втором
    await owner.post('/units', { code: '9100', name: 'Своя', symbol: 'св' });
    expect((await other.post('/products', { name: 'Чужая единица', unitCode: '9100' })).status).toBe(422);
    expect((await other.get('/units?limit=100')).body.items.some((u: any) => u.code === '9100')).toBe(false);
    // списки второго воркспейса — только его данные
    expect((await other.get('/product-categories')).body.total).toBe(0);
    expect((await other.get('/units?limit=100')).body.total).toBe(OKEI_UNITS.length);
  });

  test('RLS holds under the application role even without request filters (direct SQL)', async () => {
    const rows = await admin`select count(*)::int as n from products where workspace_id = ${ws}`;
    expect(rows[0]!.n).toBeGreaterThan(5);
    const [{ n }] = await admin`select count(*)::int as n from products where workspace_id = ${other.workspaceId}`;
    expect(n).toBe(0);
  });
});
