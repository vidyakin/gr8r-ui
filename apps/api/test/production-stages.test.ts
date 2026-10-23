/* Этап 4б: виды производства и поэтапный выпуск. Справочник «Этапы», этап в строке спецификации,
   выпуск по этапам и участкам, порядок этапов, НЗП между этапами и запрет отмены промежуточного этапа. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let wood: string; // материал этапа «Распил»
let screw: string; // материал этапа «Сборка»
let table: string; // готовое изделие (товар каталога)
let item: string; // спецификация изделия
let workshop: string; // склад-цех (материалы)
let fg: string; // склад готовой продукции
let center: string; // участок
let assembly: string; // второй участок
let kind: { id: string; stages: { id: string; name: string; isFinal: boolean }[] };

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Stages WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;

  wood = (await mk(owner, '/products', { name: 'Брус', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
  screw = (await mk(owner, '/products', { name: 'Саморез', price: 20, purchasePrice: 10, vatRate: 'none' })).id;
  table = (await mk(owner, '/products', { name: 'Стол «Этапный»', price: 5000 })).id;
  workshop = (await mk(owner, '/warehouses', { name: 'Склад цеха', kind: 'workshop' })).id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выпуска' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Распил', hourlyRate: 600, warehouseId: workshop, outputWarehouseId: fg })).id;
  assembly = (await mk(owner, '/work-centers', { name: 'Сборка', hourlyRate: 600, warehouseId: workshop, outputWarehouseId: fg })).id;

  // материалы на склад цеха: 100 брусов по 80 и 100 саморезов по 10
  const supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»' })).id;
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, lines: [{ productId: wood, qty: 100, price: 80 }, { productId: screw, qty: 100, price: 10 }] });
  expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
});

describe('production kinds', () => {
  test('a kind keeps the ordered stages, the last one is final', async () => {
    const res = await owner.post('/production/kinds', { name: 'Мебельное производство', note: 'Распил, сборка', stages: [{ name: 'Распил' }, { name: 'Сборка' }, { name: 'Завершение производства' }] });
    expect(res.status).toBe(201);
    kind = res.body;
    expect(kind.stages.map((s: any) => s.name)).toEqual(['Распил', 'Сборка', 'Завершение производства']);
    expect(kind.stages.map((s: any) => s.isFinal)).toEqual([false, false, true]);
    // список отдаёт тот же порядок
    const list = await owner.get('/production/kinds');
    expect(list.status).toBe(200);
    expect(list.body.items.find((k: any) => k.id === kind.id).stages).toHaveLength(3);
  });

  test('a member reads the kinds but cannot change them', async () => {
    expect((await member.get('/production/kinds')).status).toBe(200);
    const res = await member.post('/production/kinds', { name: 'Чужой вид', stages: [{ name: 'Этап' }] });
    expect(res.status).toBe(403);
  });

  test('a product of the kind has a stage on every line of its bill of materials', async () => {
    item = (await mk(owner, '/manufactured-items', { name: 'Стол «Этапный»', productId: table, productionKindId: kind.id, overheadPct: 10 })).id;
    // строка без этапа — нельзя
    const noStage = await owner.post(`/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty: 2 });
    expect(noStage.status).toBe(422);
    expect(noStage.body.error.code).toBe('stage_required');
    // этап чужого вида — нельзя
    const other = await mk(owner, '/production/kinds', { name: 'Другой вид', stages: [{ name: 'Этап' }] });
    const wrong = await owner.post(`/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty: 2, stageId: other.stages[0].id });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('stage_mismatch');
    // этапы своего вида — можно
    expect((await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty: 2, stageId: kind.stages[0].id })).id).toBeTruthy();
    expect((await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: screw, qty: 4, stageId: kind.stages[1].id })).id).toBeTruthy();
    expect((await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'work', operation: 'Сборка', workCenterId: center, hours: 0.5, stageId: kind.stages[2].id })).id).toBeTruthy();
  });

  test('a stage used in a bill of materials cannot be removed', async () => {
    const res = await owner.patch(`/production/kinds/${kind.id}`, { stages: [{ id: kind.stages[0].id, name: 'Распил' }, { id: kind.stages[1].id, name: 'Сборка' }, { id: kind.stages[2].id, name: 'Завершение производства' }] });
    expect(res.status).toBe(200);
    const drop = await owner.patch(`/production/kinds/${kind.id}`, { stages: [{ id: kind.stages[1].id, name: 'Сборка' }, { id: kind.stages[2].id, name: 'Завершение производства' }] });
    expect(drop.status).toBe(422);
    expect(drop.body.error.code).toBe('in_use');
  });
});

describe('production by stages', () => {
  let orderId: string;
  let orderItemId: string;

  beforeAll(async () => {
    const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '5' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    orderId = o.id;
    orderItemId = (await owner.get(`/production-orders/${orderId}`)).body.items[0].id;
  });

  test('the workbench shows the stages of the product and the remainder on each of them', async () => {
    const list = await owner.get('/production/workbench');
    const row = list.body.orders.find((o: any) => o.type === 'production_order').rows[0];
    expect(row.productionKindId).toBe(kind.id);
    expect(row.stages.map((s: any) => s.name)).toEqual(['Распил', 'Сборка', 'Завершение производства']);
    expect(row.stages.map((s: any) => s.done)).toEqual(['0.000', '0.000', '0.000']);
    expect(row.stages.map((s: any) => s.remaining)).toEqual(['5.000', '5.000', '5.000']);
    // выполнить можно только первый этап: следующие ждут предыдущий
    expect(row.stages.map((s: any) => s.available)).toEqual(['5.000', '0.000', '0.000']);
  });

  test('the final stage waits for the previous one', async () => {
    const res = await owner.post(`/production-orders/${orderId}/production`, { lines: [{ orderItemId: orderItemId, qty: '5', stageId: kind.stages[2].id }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('stage_order');
  });

  test('an intermediate stage writes off its materials and receives nothing', async () => {
    const rel = await owner.post(`/production-orders/${orderId}/production`, { date: '2026-05-01', workCenterId: center, lines: [{ orderItemId: orderItemId, qty: '5', stageId: kind.stages[0].id }] });
    expect(rel.status).toBe(201);
    expect(rel.body.type).toBe('production');
    // строки документа: только материал этапа, продукции нет
    expect(rel.body.lines.map((l: any) => [l.stockRole, l.name, l.qty])).toEqual([['out', 'Брус', '10.000']]);
    expect((await owner.post(`/documents/${rel.body.id}/post`)).status).toBe(200);
    // брус списан, продукт не пришёл
    const woodBalance = (await owner.get(`/stock/balances?productId=${wood}`)).body.items.find((b: any) => b.warehouseId === workshop);
    expect(woodBalance.qty).toBe('90.000');
    const tableBalance = (await owner.get(`/stock/balances?productId=${table}`)).body.items.find((b: any) => b.warehouseId === fg);
    expect(tableBalance?.qty ?? '0.000').toBe('0.000');
    // затраты этапа: 10 брусов по 80 = 800 + накладные 10% = 880
    const detail = await owner.get(`/production-orders/${rel.body.id}`);
    expect(detail.body.items[0].stageCost).toBe('880.0000');
  });

  test('the second stage writes off its own materials', async () => {
    const rel = await owner.post(`/production-orders/${orderId}/production`, { date: '2026-05-02', workCenterId: assembly, lines: [{ orderItemId: orderItemId, qty: '5', stageId: kind.stages[1].id }] });
    expect(rel.status).toBe(201);
    expect(rel.body.lines.map((l: any) => [l.stockRole, l.name, l.qty])).toEqual([['out', 'Саморез', '20.000']]);
    expect((await owner.post(`/documents/${rel.body.id}/post`)).status).toBe(200);
    const detail = await owner.get(`/production-orders/${rel.body.id}`);
    expect(detail.body.items[0].stageCost).toBe('220.0000');
    const tableBalance = (await owner.get(`/stock/balances?productId=${table}`)).body.items.find((b: any) => b.warehouseId === fg);
    expect(tableBalance?.qty ?? '0.000').toBe('0.000');
  });

  test('the final stage receives the product at the cost of all the stages', async () => {
    const rel = await owner.post(`/production-orders/${orderId}/production`, { date: '2026-05-03', workCenterId: assembly, lines: [{ orderItemId: orderItemId, qty: '5', stageId: kind.stages[2].id }] });
    expect(rel.status).toBe(201);
    // на финальном этапе в документе только продукция: работа — строка состава, а не строка склада
    expect(rel.body.lines.map((l: any) => l.stockRole)).toEqual(['in']);
    expect((await owner.post(`/documents/${rel.body.id}/post`)).status).toBe(200);
    // себестоимость этапа: работа 2,5 часа по 600 = 1500 + накладные 10% = 1650
    const detail = await owner.get(`/production-orders/${rel.body.id}`);
    expect(detail.body.items[0].stageCost).toBe('1650.0000');
    // приход продукции: затраты всех этапов 880 + 220 + 1650 = 2750, на единицу 550
    const tableBalance = (await owner.get(`/stock/balances?productId=${table}`)).body.items.find((b: any) => b.warehouseId === fg);
    expect(tableBalance.qty).toBe('5.000');
    expect(tableBalance.avgCost).toBe('550.0000');
    expect(Number(tableBalance.qty) * Number(tableBalance.avgCost)).toBe(2750);
  });

  test('an intermediate stage cannot be unposted when the next one is already released', async () => {
    const list = await owner.get('/production/workbench');
    expect(list.body.orders.some((o: any) => o.type === 'production_order')).toBe(false); // заказ выпущен полностью
    // выпуск второго этапа нельзя отменить: третий уже выполнен
    const docs = await owner.get('/documents?type=production&limit=50');
    const second = docs.body.items.find((d: any) => d.date === '2026-05-02');
    expect(second).toBeTruthy();
    const res = await owner.post(`/documents/${second.id}/unpost`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('stage_conflict');
  });

  test('the workbench shows the stages done', async () => {
    const list = await owner.get('/production/workbench');
    const order = list.body.orders.find((o: any) => o.type === 'production_order');
    expect(order).toBeUndefined();
  });
});

describe('the workbench releases the stages', () => {
  let orderId: string;
  let orderItemId: string;

  beforeAll(async () => {
    const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '2' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    orderId = o.id;
    orderItemId = (await owner.get(`/production-orders/${orderId}`)).body.items[0].id;
  });

  test('the marked stage is released into its own document', async () => {
    const res = await owner.post('/production/workbench/execute', {
      date: '2026-05-10',
      mode: 'simple',
      rows: [{ orderId, source: 'production_order', lineId: orderItemId, stageId: kind.stages[0].id, workCenterId: center }],
    });
    expect(res.status).toBe(201);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0].stageId).toBe(kind.stages[0].id);
    // документ этапа: только материал, продукции нет
    const doc = (await owner.get(`/documents/${res.body.documents[0].id}`)).body;
    expect(doc.status).toBe('posted');
    expect(doc.lines.map((l: any) => l.stockRole)).toEqual(['out']);
    // заказ остался в рабочем месте: этапов осталось ещё два
    const list = await owner.get('/production/workbench');
    const row = list.body.orders.find((o: any) => o.id === orderId).rows[0];
    expect(row.stages.map((s: any) => s.done)).toEqual(['2.000', '0.000', '0.000']);
    expect(row.stages.map((s: any) => s.available)).toEqual(['0.000', '2.000', '0.000']);
  });

  test('the same day but another stage makes another document', async () => {
    const res = await owner.post('/production/workbench/execute', {
      date: '2026-05-10',
      mode: 'simple',
      rows: [{ orderId, source: 'production_order', lineId: orderItemId, stageId: kind.stages[1].id, workCenterId: center }],
    });
    expect(res.status).toBe(201);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0].stageId).toBe(kind.stages[1].id);
    // второй этап: свой документ того же дня
    const docs = (await owner.get('/documents?type=production&limit=50')).body.items.filter((d: any) => d.date === '2026-05-10');
    expect(docs).toHaveLength(2);
  });

  test('the final stage of the workbench receives the product', async () => {
    const res = await owner.post('/production/workbench/execute', {
      date: '2026-05-11',
      mode: 'simple',
      rows: [{ orderId, source: 'production_order', lineId: orderItemId, stageId: kind.stages[2].id, workCenterId: center }],
    });
    expect(res.status).toBe(201);
    const tableBalance = (await owner.get(`/stock/balances?productId=${table}`)).body.items.find((b: any) => b.warehouseId === fg);
    expect(Number(tableBalance.qty)).toBeGreaterThan(0);
    // заказ выпущен полностью — из рабочего места исчез
    const list = await owner.get('/production/workbench');
    expect(list.body.orders.some((o: any) => o.id === orderId)).toBe(false);
  });
});

describe('production without stages', () => {
  test('a product without a kind is produced in one step, as before', async () => {
    const plain = (await mk(owner, '/manufactured-items', { name: 'Табурет', productId: (await mk(owner, '/products', { name: 'Табурет', price: 2000 })).id })).id;
    await mk(owner, `/manufactured-items/${plain}/lines`, { kind: 'material', productId: wood, qty: 1 });
    const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: plain, qty: '2' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const orderItem = (await owner.get(`/production-orders/${o.id}`)).body.items[0];
    // этап в рабочем месте — предопределённый «Завершение производства»
    const list = await owner.get('/production/workbench');
    const row = list.body.orders.find((o: any) => o.id === o.id)?.rows.find((r: any) => r.itemId === plain);
    expect(row?.stages).toHaveLength(1);
    expect(row?.stages[0].id).toBeNull();
    const rel = await owner.post(`/production-orders/${o.id}/production`, { date: '2026-05-04', workCenterId: center, lines: [{ orderItemId: orderItem.id, qty: '2' }] });
    expect(rel.status).toBe(201);
    expect(rel.body.lines.map((l: any) => l.stockRole).sort()).toEqual(['in', 'out']);
    expect((await owner.post(`/documents/${rel.body.id}/post`)).status).toBe(200);
  });
});

describe('the day document of a stage', () => {
  test('a stage is added to its day document even when the next stage of another position is released', async () => {
    const mkOrder = async () => {
      const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '1' }] });
      await owner.post(`/production-orders/${o.id}/fill-from-bom`);
      await owner.post(`/documents/${o.id}/post`);
      return { id: o.id as string, line: (await owner.get(`/production-orders/${o.id}`)).body.items[0].id as string };
    };
    const a = await mkOrder();
    const b = await mkOrder();
    const run = (o: { id: string; line: string }, stage: number, wc: string) =>
      owner.post('/production/workbench/execute', { date: '2026-06-01', mode: 'simple', rows: [{ orderId: o.id, source: 'production_order', lineId: o.line, stageId: kind.stages[stage].id, workCenterId: wc }] });
    expect((await run(a, 0, center)).status).toBe(201);
    expect((await run(a, 1, assembly)).status).toBe(201);
    // распил второго заказа дописывается в документ распила этого дня: следующий этап первого заказа ему не мешает
    const res = await run(b, 0, center);
    expect(res.status).toBe(201);
    const docs = (await owner.get('/documents?type=production&limit=100')).body.items.filter((d: any) => d.date === '2026-06-01');
    expect(docs).toHaveLength(2);
  });
});

describe('a production kind set after the bill of materials', () => {
  test('lines without a stage of the kind go to the final stage, nothing is lost', async () => {
    const chair = (await mk(owner, '/products', { name: 'Стул «Поздний»', price: 3000 })).id;
    const late = (await mk(owner, '/manufactured-items', { name: 'Стул «Поздний»', productId: chair })).id;
    await mk(owner, `/manufactured-items/${late}/lines`, { kind: 'material', productId: wood, qty: 1 });
    const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: late, qty: '2' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    expect((await owner.post(`/documents/${o.id}/post`)).status).toBe(200);
    const line = (await owner.get(`/production-orders/${o.id}`)).body.items[0].id;
    // вид производства назначен после спецификации и заказа
    expect((await owner.patch(`/manufactured-items/${late}`, { productionKindId: kind.id })).status).toBe(200);
    for (const [n, date] of [[0, '2026-06-05'], [1, '2026-06-06'], [2, '2026-06-07']] as const) {
      const rel = await owner.post(`/production-orders/${o.id}/production`, { date, workCenterId: assembly, lines: [{ orderItemId: line, qty: '2', stageId: kind.stages[n].id }] });
      expect(rel.status).toBe(201);
      expect((await owner.post(`/documents/${rel.body.id}/post`)).status).toBe(200);
      // брус без этапа списывается на финальном этапе
      if (n === 2) expect(rel.body.lines.filter((l: any) => l.stockRole === 'out').map((l: any) => [l.name, l.qty])).toEqual([['Брус', '2.000']]);
    }
    const bal = (await owner.get(`/stock/balances?productId=${chair}`)).body.items.find((b: any) => b.warehouseId === fg);
    expect(bal.qty).toBe('2.000');
    expect(Number(bal.avgCost)).toBeGreaterThan(0);
  });
});
