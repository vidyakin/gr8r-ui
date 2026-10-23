/* Разборка (вид операции «Разборка»): спецификация разборки, заказ на производство и выпуск.
   Проверяем: запрет строк сборки в спецификации разборки и наоборот, доли стоимости (сумма 100 %),
   распределение стоимости списанного + работ + накладных между выходами (по долям, по цене, по количеству),
   резерв исходного товара, отсутствие выходов в потребностях, нехватку, отмену проведения, цепочку удорожания,
   закрытие месяца с косвенными, закрытый период, маскирование сумм и изоляцию арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin, drainJobs } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let workshop: string; // склад-цех: откуда списывается исходный товар
let fg: string; // склад готовой продукции: куда приходуются выходы
let center: string; // участок
let supplier: string;

/** Бревно — исходный товар разборки */
let log: string;
/** Выходы разборки бревна (доли 60/40) */
let plankA: string;
let plankB: string;
/** Спецификация разборки бревна */
let disSpec: string;
/** Спецификация сборки (обычная) */
let asmSpec: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const product = (name: string, extra: Record<string, unknown> = {}) => mk(owner, '/products', { name, vatRate: 'none', ...extra });
const line = (itemId: string, body: Record<string, unknown>) => owner.post(`/manufactured-items/${itemId}/lines`, body);

/** Остаток и средняя товара на складе */
async function balance(productId: string, warehouseId: string) {
  const rows = (await owner.get(`/stock/balances?productId=${productId}`)).body.items.filter((b: any) => b.warehouseId === warehouseId);
  return rows[0] ?? { qty: '0.000', avgCost: '0.0000', reserved: '0.000' };
}

/** Заказ на производство с видом операции «разборка» + заполненный снимок */
async function disOrder(qty: string, spec = disSpec, extra: Record<string, unknown> = {}) {
  const o = await mk(owner, '/production-orders', { operation: 'disassembly', workCenterId: center, warehouseId: workshop, targetWarehouseId: fg, items: [{ itemId: spec, qty }], ...extra });
  const filled = await owner.post(`/production-orders/${o.id}/fill-from-bom`);
  if (filled.status >= 300) throw new Error(`fill-from-bom: ${filled.status} ${JSON.stringify(filled.body)}`);
  return filled.body;
}

/** Выпуск по заказу: создать документ и провести */
async function disRelease(orderId: string, qty: string, date: string) {
  const detail = (await owner.get(`/production-orders/${orderId}`)).body;
  const rel = await owner.post(`/production-orders/${orderId}/production`, { date, lines: [{ orderItemId: detail.items[0].id, qty }] });
  if (rel.status >= 300) throw new Error(`release failed: ${rel.status} ${JSON.stringify(rel.body)}`);
  return rel.body as any;
}

/** Поступление исходного товара на склад цеха */
async function receive(productId: string, qty: string, price: string, date: string) {
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date, lines: [{ productId, qty, price }] });
  await owner.post(`/documents/${rc.id}/post`);
  return rc.id as string;
}

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Disassembly WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other disassembly WS' });

  supplier = (await mk(owner, '/companies', { name: 'ООО «Лес»' })).id;
  workshop = (await mk(owner, '/warehouses', { name: 'Склад раскроя', kind: 'workshop' })).id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выходов' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Участок раскроя', hourlyRate: 0, warehouseId: workshop, outputWarehouseId: fg })).id;

  log = (await product('Бревно', { purchasePrice: 100, price: 0 })).id;
  plankA = (await product('Доска А', { price: 0 })).id;
  plankB = (await product('Доска Б', { price: 0 })).id;

  // спецификация разборки: исходный товар — бревно, выходы — доски (доли 60/40), работа — распил
  disSpec = (await mk(owner, '/manufactured-items', { name: 'Разборка бревна', mode: 'disassembly', productId: log, batchQty: 10, overheadPct: 10 })).id;
  await line(disSpec, { kind: 'output', productId: plankA, qty: 2, costShare: 60 });
  await line(disSpec, { kind: 'output', productId: plankB, qty: 1, costShare: 40 });
  await line(disSpec, { kind: 'work', operation: 'Распил', workCenterId: center, hours: 1, rate: 100 });

  // обычная спецификация сборки
  asmSpec = (await mk(owner, '/manufactured-items', { name: 'Изделие сборки', productId: (await product('Стол')).id })).id;
  await line(asmSpec, { kind: 'material', productId: log, qty: 1 });
});

describe('disassembly specification', () => {
  test('the specification has a kind: assembly or disassembly', async () => {
    const item = (await owner.get(`/manufactured-items/${disSpec}`)).body;
    expect(item.mode).toBe('disassembly');
    expect((await owner.get(`/manufactured-items/${asmSpec}`)).body.mode).toBe('assembly');
    // по умолчанию — сборка
    const def = await mk(owner, '/manufactured-items', { name: 'Без вида' });
    expect(def.mode).toBe('assembly');
  });

  test('a disassembly specification has outputs and work only', async () => {
    const res = await line(disSpec, { kind: 'material', productId: log, qty: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('spec_kind_forbidden');
    const semi = await line(disSpec, { kind: 'semi', childItemId: asmSpec, qty: 1 });
    expect(semi.status).toBe(422);
    expect(semi.body.error.code).toBe('spec_kind_forbidden');
  });

  test('an output belongs to a disassembly specification only', async () => {
    const res = await line(asmSpec, { kind: 'output', productId: plankA, qty: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('spec_kind_forbidden');
  });

  test('the cost shares add up to 100%: a wrong sum and an incomplete set are rejected', async () => {
    const spec = (await mk(owner, '/manufactured-items', { name: 'Разборка с долями', mode: 'disassembly', productId: log, batchQty: 1 })).id;
    const a = await line(spec, { kind: 'output', productId: plankA, qty: 1, costShare: 60 });
    expect(a.status).toBe(201);
    const b = await line(spec, { kind: 'output', productId: plankB, qty: 1 });
    expect(b.status).toBe(201);
    // набор неполный: одна доля задана, другая нет
    let res = await owner.patch(`/manufactured-items/${spec}`, { name: 'Разборка с долями' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('share_incomplete');
    // сумма не 100
    expect((await owner.patch(`/bom-lines/${b.body.id}`, { costShare: 30 })).status).toBe(200);
    res = await owner.patch(`/manufactured-items/${spec}`, { name: 'Разборка с долями' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('share_sum');
    // 60 + 40 — правильно
    expect((await owner.patch(`/bom-lines/${b.body.id}`, { costShare: 40 })).status).toBe(200);
    expect((await owner.patch(`/manufactured-items/${spec}`, { name: 'Разборка с долями' })).status).toBe(200);
  });

  test('the order kind must match the specification', async () => {
    const res = await owner.post('/production-orders', { operation: 'assembly', items: [{ itemId: disSpec, qty: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('operation_mismatch');
    const other2 = await owner.post('/production-orders', { operation: 'disassembly', items: [{ itemId: asmSpec, qty: 1 }] });
    expect(other2.status).toBe(422);
    expect(other2.body.error.code).toBe('operation_mismatch');
  });
});

describe('disassembly order', () => {
  test('the snapshot holds the goods to disassemble, the outputs and the work', async () => {
    const o = await disOrder('10');
    expect(o.operation).toBe('disassembly');
    const rows = o.components.map((c: any) => [c.kind, c.qty, c.costShare]);
    expect(rows).toEqual([
      ['material', '10.000', null],
      ['output', '2.000', '60.00'],
      ['output', '1.000', '40.00'],
      ['work', '0.000', null],
    ]);
    // «Продукция» — исходный товар, который разбирают
    expect(o.items[0].productId).toBe(log);
  });

  test('the goods to disassemble are reserved, the outputs are not a shortage', async () => {
    const o = await disOrder('10');
    await owner.post(`/documents/${o.id}/post`);
    const materials = (await owner.get(`/production-orders/${o.id}/materials`)).body.items;
    expect(materials.map((m: any) => m.productId)).toEqual([log]);
    // выходы в потребности не попадают: они не расходуются
    const needs = (await owner.get('/production/needs')).body.items;
    expect(needs.some((n: any) => n.productId === plankA || n.productId === plankB)).toBe(false);
    expect(needs.some((n: any) => n.productId === log)).toBe(true);
  });
});

describe('disassembly release', () => {
  let orderId: string;

  beforeAll(async () => {
    await receive(log, '20', '100', '2026-01-05');
    const o = await disOrder('10');
    await owner.post(`/documents/${o.id}/post`);
    orderId = o.id;
  });

  test('the release writes off the goods and receives the outputs at the split cost', async () => {
    const rel = await disRelease(orderId, '10', '2026-01-10');
    // строки: исходный товар — расход, выходы — приход
    const roles = rel.lines.map((l: any) => [l.stockRole, l.name, l.qty]);
    expect(roles).toEqual([
      ['out', 'Бревно', '10.000'],
      ['in', 'Доска А', '2.000'],
      ['in', 'Доска Б', '1.000'],
    ]);
    const posted = await owner.post(`/documents/${rel.id}/post`);
    expect(posted.status).toBe(200);

    // стоимость: 10 брёвен по 100 = 1000 + работа 1 час по 100 = 100 + накладные 10% = 110 → 1210
    // доли 60/40: 726 и 484; на единицу: 363 и 484
    expect(await balance(plankA, fg)).toMatchObject({ qty: '2.000', avgCost: '363.0000' });
    expect(await balance(plankB, fg)).toMatchObject({ qty: '1.000', avgCost: '484.0000' });
    // сумма приходов равна распределяемой стоимости до копейки
    const moves = (await owner.get(`/stock/moves?documentId=${rel.id}&limit=100`)).body.items;
    const sum = moves.filter((m: any) => Number(m.qty) > 0).reduce((s: number, m: any) => s + Number(m.qty) * Number(m.cost), 0);
    expect(sum.toFixed(2)).toBe('1210.00');
    // исходный товар списан
    expect(await balance(log, workshop)).toMatchObject({ qty: '10.000' });
  });

  test('without shares the cost is split by the sale price, and without prices by the quantity', async () => {
    // по цене продажи: мясо 100, кожа 300 → четверть и три четверти
    const meat = (await product('Мясо', { price: 100 })).id;
    const hide = (await product('Кожа', { price: 300 })).id;
    const carcass = (await product('Тушка', { purchasePrice: 200, price: 0 })).id;
    const spec = (await mk(owner, '/manufactured-items', { name: 'Разборка туши', mode: 'disassembly', productId: carcass, batchQty: 1 })).id;
    await line(spec, { kind: 'output', productId: meat, qty: 1 });
    await line(spec, { kind: 'output', productId: hide, qty: 1 });
    await receive(carcass, '5', '200', '2026-02-05');
    const o = await disOrder('1', spec);
    await owner.post(`/documents/${o.id}/post`);
    const rel = await disRelease(o.id, '1', '2026-02-10');
    await owner.post(`/documents/${rel.id}/post`);
    expect(await balance(meat, fg)).toMatchObject({ qty: '1.000', avgCost: '50.0000' });
    expect(await balance(hide, fg)).toMatchObject({ qty: '1.000', avgCost: '150.0000' });

    // без цен — по количеству: 3 и 1 → 75 и 25
    const p1 = (await product('Часть 1')).id;
    const p2 = (await product('Часть 2')).id;
    const billet = (await product('Брусок', { purchasePrice: 100 })).id;
    const spec2 = (await mk(owner, '/manufactured-items', { name: 'Разборка бруска', mode: 'disassembly', productId: billet, batchQty: 1 })).id;
    await line(spec2, { kind: 'output', productId: p1, qty: 3 });
    await line(spec2, { kind: 'output', productId: p2, qty: 1 });
    await receive(billet, '5', '100', '2026-03-05');
    const o2 = await disOrder('1', spec2);
    await owner.post(`/documents/${o2.id}/post`);
    const rel2 = await disRelease(o2.id, '1', '2026-03-10');
    await owner.post(`/documents/${rel2.id}/post`);
    expect(await balance(p1, fg)).toMatchObject({ qty: '3.000', avgCost: '25.0000' });
    expect(await balance(p2, fg)).toMatchObject({ qty: '1.000', avgCost: '25.0000' });
  });

  test('the remainder of the rounding goes to the last line', async () => {
    const p1 = (await product('Доля 1')).id;
    const p2 = (await product('Доля 2')).id;
    const p3 = (await product('Доля 3')).id;
    const piece = (await product('Кусок', { purchasePrice: 100 })).id;
    const spec = (await mk(owner, '/manufactured-items', { name: 'Разборка на три доли', mode: 'disassembly', productId: piece, batchQty: 1 })).id;
    await line(spec, { kind: 'output', productId: p1, qty: 1, costShare: 33.33 });
    await line(spec, { kind: 'output', productId: p2, qty: 1, costShare: 33.33 });
    await line(spec, { kind: 'output', productId: p3, qty: 1, costShare: 33.34 });
    await receive(piece, '5', '100', '2026-04-05');
    const o = await disOrder('1', spec);
    await owner.post(`/documents/${o.id}/post`);
    const rel = await disRelease(o.id, '1', '2026-04-10');
    await owner.post(`/documents/${rel.id}/post`);
    expect((await balance(p1, fg)).avgCost).toBe('33.3300');
    expect((await balance(p2, fg)).avgCost).toBe('33.3300');
    expect((await balance(p3, fg)).avgCost).toBe('33.3400');
  });

  test('not enough goods to disassemble: nothing moves', async () => {
    const o = await disOrder('50');
    await owner.post(`/documents/${o.id}/post`);
    const rel = await disRelease(o.id, '50', '2026-05-10');
    const before = await balance(plankA, fg);
    const res = await owner.post(`/documents/${rel.id}/post`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('insufficient_stock');
    expect(await balance(plankA, fg)).toMatchObject({ qty: before.qty });
  });

  test('unposting the release returns the balances and the costs', async () => {
    const o = await disOrder('1');
    await owner.post(`/documents/${o.id}/post`);
    const rel = await disRelease(o.id, '1', '2026-06-10');
    await owner.post(`/documents/${rel.id}/post`);
    const withGoods = await balance(log, workshop);
    expect(Number(withGoods.qty)).toBeLessThan(10);
    await owner.post(`/documents/${rel.id}/unpost`);
    // остатки вернулись: брёвен столько же, сколько было, выходов нет
    expect(Number((await balance(log, workshop)).qty)).toBe(Number(withGoods.qty) + 1);
    const moves = (await owner.get(`/stock/moves?documentId=${rel.id}&limit=100`)).body.items;
    expect(moves).toHaveLength(0);
  });
});

describe('disassembly in the chain and in the period closing', () => {
  test('the rise of the goods price is carried to the outputs proportionally', async () => {
    // свой товар, чтобы средняя не смешивалась с другими тестами
    const src = (await product('Сырьё цепочки', { purchasePrice: 100 })).id;
    const out1 = (await product('Выход цепочки 1')).id;
    const out2 = (await product('Выход цепочки 2')).id;
    const spec = (await mk(owner, '/manufactured-items', { name: 'Разборка цепочки', mode: 'disassembly', productId: src, batchQty: 1 })).id;
    await line(spec, { kind: 'output', productId: out1, qty: 1, costShare: 60 });
    await line(spec, { kind: 'output', productId: out2, qty: 1, costShare: 40 });
    const receipt = await receive(src, '10', '100', '2026-07-05');
    const o = await disOrder('10', spec);
    await owner.post(`/documents/${o.id}/post`);
    const rel = await disRelease(o.id, '10', '2026-07-10');
    await owner.post(`/documents/${rel.id}/post`);
    expect((await balance(out1, fg)).avgCost).toBe('60.0000');
    expect((await balance(out2, fg)).avgCost).toBe('40.0000');

    // косвенные затраты месяца: 20 на два выхода (по объёму) — они создают корректировки закрытия
    const costItem = (await mk(owner, '/cost-items', { name: 'Электричество разборки', distributionMethod: 'output_qty' })).id;
    const service = (await product('Услуга разборки', { kind: 'service' })).id;
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2026-07-20', lines: [{ productId: service, qty: 1, price: 20, costItemId: costItem, workCenterId: center }] });
    expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
    await owner.post('/production/periods/2026-07/close');
    await drainJobs();
    // косвенные 20 делятся между выходами по объёму (10 и 10): по 10 на выход, то есть по 1 на единицу
    expect((await balance(out1, fg)).avgCost).toBe('61.0000');
    expect((await balance(out2, fg)).avgCost).toBe('41.0000');

    // поступление переоценено: 100 → 120. Пересчёт цепочки (recomputeStockCosts) переносит удорожание
    // списанного сырья на выходные продукты — по тем же долям 60/40
    await admin`update stock_moves set cost = 120 where document_id = ${receipt} and qty > 0`;
    await owner.post('/production/periods/2026-07/close');
    await drainJobs();
    // удорожание 20 на единицу сырья: 200 на разборку → 120 на первый выход и 80 на второй (по 10 единиц)
    expect((await balance(out1, fg)).avgCost).toBe('73.0000');
    expect((await balance(out2, fg)).avgCost).toBe('49.0000');
  });

  test('the closing distributes the indirect costs of the work center to the outputs', async () => {
    const src = (await product('Сырьё закрытия', { purchasePrice: 100 })).id;
    const out = (await product('Выход закрытия')).id;
    const spec = (await mk(owner, '/manufactured-items', { name: 'Разборка закрытия', mode: 'disassembly', productId: src, batchQty: 1 })).id;
    await line(spec, { kind: 'output', productId: out, qty: 1 });
    await receive(src, '10', '100', '2026-08-05');
    const o = await disOrder('5', spec);
    await owner.post(`/documents/${o.id}/post`);
    const rel = await disRelease(o.id, '5', '2026-08-10');
    await owner.post(`/documents/${rel.id}/post`);

    // косвенные затраты участка: услуга со статьёй «по объёму выпуска»
    const costItem = (await mk(owner, '/cost-items', { name: 'Электричество участка', distributionMethod: 'output_qty' })).id;
    const service = (await product('Услуга участка', { kind: 'service' })).id;
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2026-08-20', lines: [{ productId: service, qty: 1, price: 50, costItemId: costItem, workCenterId: center }] });
    expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
    await owner.post('/production/periods/2026-08/close');
    await drainJobs();
    const closing = (await owner.get('/production/periods')).body.items.find((c: any) => c.month === '2026-08');
    expect(closing.status).toBe('done');
    expect(closing.totals.byRelease.some((r: any) => r.releaseId === rel.id)).toBe(true);
    // 50 затрат на 5 выходов: 10 на единицу
    expect((await balance(out, fg)).avgCost).toBe('110.0000');
  });

  test('a closed period forbids posting the release', async () => {
    await owner.patch('/production/periods/settings', { closedThrough: '2026-09-30' });
    const src = (await product('Сырьё закрытого периода', { purchasePrice: 100 })).id;
    const out = (await product('Выход закрытого периода')).id;
    const spec = (await mk(owner, '/manufactured-items', { name: 'Разборка закрытого периода', mode: 'disassembly', productId: src, batchQty: 1 })).id;
    await line(spec, { kind: 'output', productId: out, qty: 1 });
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2026-09-05', lines: [{ productId: src, qty: 10, price: 100 }] });
    await owner.post(`/documents/${rc.id}/post`);
    const o = await disOrder('1', spec);
    await owner.post(`/documents/${o.id}/post`);
    const rel = await disRelease(o.id, '1', '2026-09-10');
    const res = await owner.post(`/documents/${rel.id}/post`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('period_closed');
  });
});

describe('disassembly access rights', () => {
  test('a member sees the order but the costs are hidden', async () => {
    const o = await disOrder('1');
    await owner.post(`/documents/${o.id}/post`);
    const seen = await member.get(`/production-orders/${o.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.components.every((c: any) => c.plannedCost === null && c.actualCost === null)).toBe(true);
    const own = await owner.get(`/production-orders/${o.id}`);
    expect(own.body.components.some((c: any) => c.plannedCost !== null)).toBe(true);
  });

  test('the documents of another tenant are not visible', async () => {
    const o = await disOrder('1');
    expect((await other.get(`/production-orders/${o.id}`)).status).toBe(404);
  });
});

describe('review fixes (disassembly)', () => {
  test('the chain splits the rise by the split made at posting, not by the current sale prices', async () => {
    const src = (await product('Сырьё базы', { purchasePrice: 100 })).id;
    const cheap = (await product('Выход дешёвый', { price: 100 })).id;
    const dear = (await product('Выход дорогой', { price: 300 })).id;
    const spec = (await mk(owner, '/manufactured-items', { name: 'Разборка по цене', mode: 'disassembly', productId: src, batchQty: 1 })).id;
    await line(spec, { kind: 'output', productId: cheap, qty: 1 });
    await line(spec, { kind: 'output', productId: dear, qty: 1 });
    const receipt = await receive(src, '10', '100', '2026-10-05');
    const o = await disOrder('10', spec);
    await owner.post(`/documents/${o.id}/post`);
    const rel = await disRelease(o.id, '10', '2026-10-10');
    expect((await owner.post(`/documents/${rel.id}/post`)).status).toBe(200);
    // 1000 по ценам 100 : 300 → 250 и 750
    expect((await balance(cheap, fg)).avgCost).toBe('25.0000');
    expect((await balance(dear, fg)).avgCost).toBe('75.0000');
    // цена продажи поменялась после проведения — на прошлое распределение это влиять не должно
    expect((await owner.patch(`/products/${cheap}`, { price: 300 })).status).toBe(200);
    await admin`update stock_moves set cost = 120 where document_id = ${receipt} and qty > 0`;
    await owner.post('/production/periods/2026-10/close');
    await drainJobs();
    // удорожание 200 делится как при проведении (1 : 3): 50 и 150 на 10 единиц
    expect((await balance(cheap, fg)).avgCost).toBe('30.0000');
    expect((await balance(dear, fg)).avgCost).toBe('90.0000');
  });

  test('the closing by work hours counts the hours of a disassembly once, not per output', async () => {
    const c2 = (await mk(owner, '/work-centers', { name: 'Участок часов', hourlyRate: 0, warehouseId: workshop, outputWarehouseId: fg })).id;
    const src = (await product('Сырьё часов', { purchasePrice: 100 })).id;
    const o1 = (await product('Выход часов 1')).id;
    const o2 = (await product('Выход часов 2')).id;
    const dis = (await mk(owner, '/manufactured-items', { name: 'Разборка часов', mode: 'disassembly', productId: src, batchQty: 1 })).id;
    await line(dis, { kind: 'output', productId: o1, qty: 1, costShare: 50 });
    await line(dis, { kind: 'output', productId: o2, qty: 1, costShare: 50 });
    await line(dis, { kind: 'work', operation: 'Распил часов', workCenterId: c2, hours: 1, rate: 0 });
    const goods = (await product('Изделие часов')).id;
    const asm = (await mk(owner, '/manufactured-items', { name: 'Сборка часов', productId: goods, batchQty: 1 })).id;
    await line(asm, { kind: 'material', productId: src, qty: 1 });
    await line(asm, { kind: 'work', operation: 'Сборка часов', workCenterId: c2, hours: 1, rate: 0 });
    await receive(src, '2', '100', '2026-11-03');
    const od = await disOrder('1', dis, { workCenterId: c2 });
    await owner.post(`/documents/${od.id}/post`);
    const rd = await disRelease(od.id, '1', '2026-11-10');
    expect((await owner.post(`/documents/${rd.id}/post`)).status).toBe(200);
    const oa = await mk(owner, '/production-orders', { workCenterId: c2, warehouseId: workshop, targetWarehouseId: fg, items: [{ itemId: asm, qty: '1' }] });
    await owner.post(`/production-orders/${oa.id}/fill-from-bom`);
    await owner.post(`/documents/${oa.id}/post`);
    const da = (await owner.get(`/production-orders/${oa.id}`)).body;
    const ra = await owner.post(`/production-orders/${oa.id}/production`, { date: '2026-11-11', lines: [{ orderItemId: da.items[0].id, qty: '1' }] });
    expect((await owner.post(`/documents/${ra.body.id}/post`)).status).toBe(200);
    // косвенные 300 по часам работ: по 1 часу у разборки и у сборки → по 150
    const costItem = (await mk(owner, '/cost-items', { name: 'Аренда по часам', distributionMethod: 'work_hours' })).id;
    const service = (await product('Аренда участка часов', { kind: 'service' })).id;
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2026-11-20', lines: [{ productId: service, qty: 1, price: 300, costItemId: costItem, workCenterId: c2 }] });
    expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
    await owner.post('/production/periods/2026-11/close');
    await drainJobs();
    // сборка: 100 сырья + 150 косвенных
    expect((await balance(goods, fg)).avgCost).toBe('250.0000');
    // разборка: (100 + 150) пополам
    expect((await balance(o1, fg)).avgCost).toBe('125.0000');
    expect((await balance(o2, fg)).avgCost).toBe('125.0000');
  });

  test('a disassembly specification cannot be the default specification of a product', async () => {
    const res = await owner.post('/production-orders/product-settings', { productId: log, replenishment: 'production', defaultItemId: disSpec });
    expect(res.status).toBe(422);
    // спецификация сборки другого товара — тоже нет
    expect((await owner.post('/production-orders/product-settings', { productId: log, replenishment: 'production', defaultItemId: asmSpec })).status).toBe(422);
  });

  test('a disassembly specification is done in one stage: a production kind is rejected', async () => {
    const kind = await mk(owner, '/production/kinds', { name: 'Раскрой в два этапа', stages: [{ name: 'Распил' }, { name: 'Завершение производства' }] });
    const src = (await product('Сырьё этапов')).id;
    const bad = await owner.post('/manufactured-items', { name: 'Разборка с этапами', mode: 'disassembly', productId: src, productionKindId: kind.id });
    expect(bad.status).toBe(422);
    const spec = await mk(owner, '/manufactured-items', { name: 'Разборка без этапов', mode: 'disassembly', productId: src });
    expect((await owner.patch(`/manufactured-items/${spec.id}`, { productionKindId: kind.id })).status).toBe(422);
    // сборку с видом производства перевести в разборку тоже нельзя
    const asm = await mk(owner, '/manufactured-items', { name: 'Сборка с этапами', productId: src, productionKindId: kind.id });
    expect((await owner.patch(`/manufactured-items/${asm.id}`, { mode: 'disassembly' })).status).toBe(422);
  });
});
