/* Производство: участки, продукция, спецификации, запрет циклов, расчёт себестоимости (тот же, что в интерфейсе), настройки, изоляция. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { computeBomCost, resolveMaterialPrice } from '@gr8r/shared';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let wood: string; // закупочная 80, продажная 100
let screw: string; // закупочная 1.5, продажная 3
let noPrice: string;
let delivery: string; // услуга
let carpentry: string; // 600 / ч
let assembly: string; // 400 / ч

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const item = (name: string, extra: Record<string, unknown> = {}, c = owner) => mk(c, '/manufactured-items', { name, ...extra });
const line = (itemId: string, body: Record<string, unknown>, c = owner) => mk(c, `/manufactured-items/${itemId}/lines`, body);
const cost = async (itemId: string, c = owner) => (await c.get(`/manufactured-items/${itemId}/cost`)).body;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Production WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Other production WS' });
  wood = (await mk(owner, '/products', { name: 'Брус', unitCode: '006', price: 100, purchasePrice: 80 })).id;
  screw = (await mk(owner, '/products', { name: 'Шуруп', price: 3, purchasePrice: 1.5 })).id;
  noPrice = (await mk(owner, '/products', { name: 'Без цены' })).id;
  delivery = (await mk(owner, '/products', { name: 'Доставка', kind: 'service', unitCode: '876', price: 500 })).id;
  carpentry = (await mk(owner, '/work-centers', { name: 'Столярный цех', code: 'CARP', hourlyRate: 600 })).id;
  assembly = (await mk(owner, '/work-centers', { name: 'Сборка', hourlyRate: '400' })).id;
});

describe('work centers', () => {
  test('admins manage work centers, members read', async () => {
    expect((await member.post('/work-centers', { name: 'Нельзя', hourlyRate: 1 })).status).toBe(403);
    expect((await member.get('/work-centers')).body.items.map((w: any) => w.name)).toEqual(['Сборка', 'Столярный цех']);
    expect((await owner.patch(`/work-centers/${assembly}`, { hourlyRate: '450' })).body.hourlyRate).toBe('450.00');
    expect((await owner.patch(`/work-centers/${assembly}`, { hourlyRate: '400' })).status).toBe(200);
    expect((await owner.post('/work-centers', { name: 'Минус', hourlyRate: -5 })).status).toBe(400);
  });
});

describe('items and bill of materials', () => {
  test('item defaults and validation; units come from the workspace dictionary', async () => {
    const i = await item('Табурет', { code: 'STOOL' });
    expect(i).toMatchObject({ kind: 'product', unitCode: '796', batchQty: '1.000', overheadPct: '0.00' });
    expect((await owner.post('/manufactured-items', { name: 'Дубль', code: 'stool' })).status).toBe(409);
    expect((await owner.post('/manufactured-items', { name: 'Плохая партия', batchQty: 0 })).status).toBe(400);
    expect((await owner.post('/manufactured-items', { name: 'Плохие накладные', overheadPct: -1 })).status).toBe(400);
    expect((await owner.post('/manufactured-items', { name: 'Нет единицы', unitCode: '9999' })).status).toBe(422);
    expect((await owner.post('/manufactured-items', { name: 'Нет товара', productId: crypto.randomUUID() })).status).toBe(422);
    const sale = await mk(owner, '/products', { name: 'Табурет на продажу' });
    expect((await owner.patch(`/manufactured-items/${i.id}`, { productId: sale.id, batchQty: '2' })).body).toMatchObject({ productId: sale.id, batchQty: '2.000' });
  });

  test('line kinds: material takes the product unit, services cannot be materials, work needs hours or a fixed cost', async () => {
    const i = await item('Строки');
    const m = await line(i.id, { kind: 'material', productId: wood, qty: 2, scrapPct: 10 });
    expect(m).toMatchObject({ kind: 'material', productId: wood, qty: '2.000', unitCode: '006', scrapPct: '10.00', sortOrder: 0 });
    expect((await owner.post(`/manufactured-items/${i.id}/lines`, { kind: 'material', productId: delivery, qty: 1 })).status).toBe(422); // услуга
    expect((await owner.post(`/manufactured-items/${i.id}/lines`, { kind: 'material', productId: wood })).status).toBe(400); // нет qty
    expect((await owner.post(`/manufactured-items/${i.id}/lines`, { kind: 'material', qty: 1 })).status).toBe(400); // нет товара
    expect((await owner.post(`/manufactured-items/${i.id}/lines`, { kind: 'material', productId: crypto.randomUUID(), qty: 1 })).status).toBe(422);
    const w = await line(i.id, { kind: 'work', operation: 'Распил', workCenterId: carpentry, hours: 0.5 });
    expect(w).toMatchObject({ kind: 'work', operation: 'Распил', workCenterId: carpentry, hours: '0.500', rate: null, fixedCost: null, sortOrder: 1 });
    expect((await owner.post(`/manufactured-items/${i.id}/lines`, { kind: 'work', operation: 'Пусто' })).status).toBe(400);
    expect((await owner.post(`/manufactured-items/${i.id}/lines`, { kind: 'work', hours: 1 })).status).toBe(400); // нет названия
    expect(await line(i.id, { kind: 'work', operation: 'Фикс', fixedCost: 250 })).toMatchObject({ fixedCost: '250.00', hours: '0.000' });
    const lines = (await owner.get(`/manufactured-items/${i.id}/lines`)).body.items;
    expect(lines.map((l: any) => l.kind)).toEqual(['material', 'work', 'work']);
    // PATCH: пересчёт единицы при смене товара, чужие для типа поля отклоняются
    expect((await owner.patch(`/bom-lines/${m.id}`, { qty: '3', productId: screw })).body).toMatchObject({ qty: '3.000', productId: screw, unitCode: '796' });
    expect((await owner.patch(`/bom-lines/${m.id}`, { hours: 1 })).status).toBe(400);
    expect((await owner.patch(`/bom-lines/${w.id}`, { qty: 5 })).status).toBe(400);
    expect((await owner.patch(`/bom-lines/${w.id}`, { hours: 0 })).status).toBe(400); // ни часов, ни фикса
    expect((await owner.patch(`/bom-lines/${w.id}`, { hours: 2, rate: 1000 })).body).toMatchObject({ hours: '2.000', rate: '1000.00' });
    expect((await owner.patch(`/bom-lines/${w.id}`, { rate: null })).body.rate).toBeNull();
    expect((await owner.del(`/bom-lines/${m.id}`)).body.deleted).toBe(true);
    expect((await owner.get(`/manufactured-items/${i.id}/lines`)).body.total).toBe(2);
  });

  test('reorder lines', async () => {
    const i = await item('Порядок');
    const a = await line(i.id, { kind: 'material', productId: wood, qty: 1 });
    const b = await line(i.id, { kind: 'material', productId: screw, qty: 1 });
    const c = await line(i.id, { kind: 'work', operation: 'Op', fixedCost: 1 });
    const r = await owner.post(`/manufactured-items/${i.id}/lines/reorder`, { ids: [c.id, a.id, b.id] });
    expect(r.body.items.map((l: any) => l.id)).toEqual([c.id, a.id, b.id]);
    expect((await owner.post(`/manufactured-items/${i.id}/lines/reorder`, { ids: [crypto.randomUUID()] })).status).toBe(422);
  });

  test('cycles are forbidden: self, direct and indirect', async () => {
    const a = await item('Цикл А');
    const b = await item('Цикл Б');
    const c = await item('Цикл В');
    expect((await owner.post(`/manufactured-items/${a.id}/lines`, { kind: 'semi', childItemId: a.id, qty: 1 })).status).toBe(422);
    await line(a.id, { kind: 'semi', childItemId: b.id, qty: 1 });
    const back = await owner.post(`/manufactured-items/${b.id}/lines`, { kind: 'semi', childItemId: a.id, qty: 1 });
    expect(back.status).toBe(422);
    expect(back.body.error.code).toBe('bom_cycle');
    await line(b.id, { kind: 'semi', childItemId: c.id, qty: 1 });
    expect((await owner.post(`/manufactured-items/${c.id}/lines`, { kind: 'semi', childItemId: a.id, qty: 1 })).status).toBe(422);
    // повторное включение одного полуфабриката в разные ветки — не цикл
    const d = await item('Ромб');
    await line(d.id, { kind: 'semi', childItemId: b.id, qty: 1 });
    await line(d.id, { kind: 'semi', childItemId: c.id, qty: 1 });
    // смена потомка у существующей строки тоже проверяется
    const x = await line(c.id, { kind: 'material', productId: wood, qty: 1 });
    expect(x.kind).toBe('material');
    const semiLine = await line(d.id, { kind: 'semi', childItemId: c.id, qty: 2 });
    expect((await owner.patch(`/bom-lines/${semiLine.id}`, { childItemId: d.id })).status).toBe(422);
  });

  test('an item that is part of another bill of materials cannot be archived or deleted; materials in use cannot be hard-deleted', async () => {
    const leaf = await item('Деталь');
    const top = await item('Узел');
    await line(top.id, { kind: 'semi', childItemId: leaf.id, qty: 2 });
    const used = await owner.del(`/manufactured-items/${leaf.id}`);
    expect(used.status).toBe(422);
    expect(used.body.error.code).toBe('in_use');
    expect((await owner.del(`/manufactured-items/${leaf.id}?hard=true`)).status).toBe(422);
    expect((await owner.del(`/manufactured-items/${top.id}?hard=true`)).body.deleted).toBe(true); // строки уходят каскадом
    expect((await owner.del(`/manufactured-items/${leaf.id}`)).body.archived).toBe(true);
    const m = await item('Материальный');
    await line(m.id, { kind: 'material', productId: noPrice, qty: 1 });
    expect((await owner.del(`/products/${noPrice}?hard=true`)).status).toBe(422);
  });
});

describe('cost of a unit', () => {
  let table: string;
  let top: string;
  let board: string;

  beforeAll(async () => {
    // Доска (полуфабрикат): партия 4 шт: брус 2 м с отходом 10% + шуруп 8; работа 1 ч столярного (600); накладные 20%
    board = (await item('Доска', { kind: 'semi', batchQty: 4, overheadPct: 20 })).id;
    await line(board, { kind: 'material', productId: wood, qty: 2, scrapPct: 10 });
    await line(board, { kind: 'material', productId: screw, qty: 8 });
    await line(board, { kind: 'work', operation: 'Строгание', workCenterId: carpentry, hours: 1 });
    // Столешница (полуфабрикат): 2 доски + работа с фикс. ценой 100
    top = (await item('Столешница', { kind: 'semi' })).id;
    await line(top, { kind: 'semi', childItemId: board, qty: 2 });
    await line(top, { kind: 'work', operation: 'Лак', fixedCost: 100 });
    // Стол: столешница + 4 шурупа + сборка 2 ч своей ставкой 500; накладные 10%; материал без цены
    table = (await item('Стол', { overheadPct: 10 })).id;
    await line(table, { kind: 'semi', childItemId: top, qty: 1 });
    await line(table, { kind: 'material', productId: screw, qty: 4 });
    await line(table, { kind: 'work', operation: 'Сборка', workCenterId: assembly, hours: 2, rate: 500 });
    await line(table, { kind: 'material', productId: noPrice, qty: 1 });
  });

  test('purchase prices (default): three-level tree with scrap, batch and overhead', async () => {
    const r = await cost(table);
    expect(r.source).toBe('purchase');
    // Доска, партия 4: материалы 2*80*1.1 = 176 + 8*1.5 = 12 -> 188; работы 600; накладные 20% от 788 = 157.6; всего 945.6 -> 236.4 за штуку
    const boardNode = r.tree.lines[0].child.lines[0].child;
    expect(boardNode.batch).toEqual({ materials: '188.0000', works: '600.0000', overhead: '157.6000', total: '945.6000' });
    expect(boardNode.unit).toEqual({ materials: '47.0000', works: '150.0000', overhead: '39.4000', total: '236.4000' });
    // Столешница: 2 доски (472.8) + лак 100 = 572.8
    const topNode = r.tree.lines[0].child;
    expect(topNode.unit).toEqual({ materials: '94.0000', works: '400.0000', overhead: '78.8000', total: '572.8000' });
    // Стол: прямые = 4*1.5 + 0 (нет цены) + 2*500 = 1006 -> накладные 100.6; + столешница 572.8
    expect(r.tree.unit).toEqual({ materials: '100.0000', works: '1400.0000', overhead: '179.4000', total: '1679.4000' });
    expect(r.tree.lines.map((l: any) => [l.kind, l.cost, l.missingPrice ?? false])).toEqual([
      ['semi', '572.8000', false],
      ['material', '6.0000', false],
      ['work', '1000.0000', false],
      ['material', '0.0000', true],
    ]);
  });

  test('the server result equals the shared pure function used by the UI', async () => {
    const snap = (await owner.get('/production/snapshot')).body;
    const prod = new Map(snap.materials.map((m: any) => [m.id, m]));
    const rates = new Map(snap.workCenters.map((w: any) => [w.id, w.hourlyRate]));
    const local = computeBomCost(snap.items, table, {
      materialPrice: id => (prod.has(id) ? resolveMaterialPrice(snap.settings.materialPriceSource, prod.get(id) as any) : null),
      workCenterRate: id => rates.get(id) as string | undefined,
    });
    expect(local).toEqual((await cost(table)).tree);
  });

  test('material price source is a workspace setting (admin only); avg_cost falls back to the purchase price until stock exists', async () => {
    expect((await member.patch('/production/settings', { materialPriceSource: 'price' })).status).toBe(403);
    expect((await owner.patch('/production/settings', { materialPriceSource: 'bogus' })).status).toBe(400);
    expect((await owner.get('/production/settings')).body).toEqual({ materialPriceSource: 'purchase' });
    expect((await owner.patch('/production/settings', { materialPriceSource: 'price' })).body).toEqual({ materialPriceSource: 'price' });
    const r = await cost(table);
    expect(r.source).toBe('price');
    // доска: материалы 2*100*1.1 = 220 + 8*3 = 24 -> 244
    expect(r.tree.lines[0].child.lines[0].child.batch.materials).toBe('244.0000');
    expect((await member.get('/production/settings')).body.materialPriceSource).toBe('price');
    expect((await owner.patch('/production/settings', { materialPriceSource: 'avg_cost' })).status).toBe(200);
    expect((await cost(table)).tree.lines[0].child.lines[0].child.batch.materials).toBe('188.0000');
    await owner.patch('/production/settings', { materialPriceSource: 'purchase' });
    expect((await cost(table)).tree.unit.total).toBe('1679.4000');
  });

  test('editing a line or a price changes the cost; a changed product price flows into the next calculation', async () => {
    const i = await item('Мгновенный');
    const l = await line(i.id, { kind: 'material', productId: screw, qty: 10 });
    expect((await cost(i.id)).tree.unit.total).toBe('15.0000');
    await owner.patch(`/bom-lines/${l.id}`, { qty: 20 });
    expect((await cost(i.id)).tree.unit.total).toBe('30.0000');
    await owner.patch(`/products/${screw}`, { purchasePrice: '2' });
    expect((await cost(i.id)).tree.unit.total).toBe('40.0000');
    await owner.patch(`/products/${screw}`, { purchasePrice: '1.5' });
    await owner.patch(`/manufactured-items/${i.id}`, { batchQty: 8, overheadPct: 50 });
    expect((await cost(i.id)).tree.unit.total).toBe('5.6250'); // 30 * 1.5 / 8
  });

  test('snapshot has everything needed for client-side recalculation', async () => {
    const snap = (await member.get('/production/snapshot')).body;
    expect(snap.settings.materialPriceSource).toBe('purchase');
    const t = snap.items.find((i: any) => i.id === table);
    expect(t.lines).toHaveLength(4);
    expect(snap.materials.map((m: any) => m.id)).toEqual(expect.arrayContaining([wood, screw, noPrice]));
    expect(snap.workCenters.map((w: any) => w.id)).toEqual(expect.arrayContaining([carpentry, assembly]));
  });
});

describe('tenant isolation', () => {
  test('another workspace cannot read, edit or reference production data of this one', async () => {
    const i = await item('Секретное изделие');
    const l = await line(i.id, { kind: 'material', productId: wood, qty: 1 });
    expect((await other.get(`/manufactured-items/${i.id}`)).status).toBe(404);
    expect((await other.get(`/manufactured-items/${i.id}/lines`)).status).toBe(404);
    expect((await other.get(`/manufactured-items/${i.id}/cost`)).status).toBe(404);
    expect((await other.patch(`/bom-lines/${l.id}`, { qty: 5 })).status).toBe(404);
    expect((await other.del(`/bom-lines/${l.id}`)).status).toBe(404);
    expect((await other.post(`/manufactured-items/${i.id}/lines`, { kind: 'work', operation: 'Взлом', fixedCost: 1 })).status).toBe(404);
    expect((await other.get('/manufactured-items')).body.total).toBe(0);
    expect((await other.get('/work-centers')).body.total).toBe(0);
    const snap = (await other.get('/production/snapshot')).body;
    expect(snap.items).toEqual([]);
    expect(snap.materials).toEqual([]);
    // свои изделия нельзя собрать из чужих материалов, полуфабрикатов и участков
    const mine = await item('Моё', {}, other);
    expect((await other.post(`/manufactured-items/${mine.id}/lines`, { kind: 'material', productId: wood, qty: 1 })).status).toBe(422);
    expect((await other.post(`/manufactured-items/${mine.id}/lines`, { kind: 'semi', childItemId: i.id, qty: 1 })).status).toBe(422);
    expect((await other.post(`/manufactured-items/${mine.id}/lines`, { kind: 'work', operation: 'Op', workCenterId: carpentry, hours: 1 })).status).toBe(422);
    // настройки воркспейса независимы
    await owner.patch('/production/settings', { materialPriceSource: 'price' });
    expect((await other.get('/production/settings')).body.materialPriceSource).toBe('purchase');
    await owner.patch('/production/settings', { materialPriceSource: 'purchase' });
  });
});
