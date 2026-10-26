/* Распределение материалов по итогам смены (задача 1135): выпуск в режиме смены не списывает материалы, документ
   «Распределение материалов» списывает факт и делит его по нормам, стоимость доходит до продукции (в том числе уже
   отгруженной и следующего этапа), отмена возвращает всё, выпуск в распределении не снять (409), режим смены для
   разборки (422), предупреждение закрытия месяца. У теста свои товары, склады, участки и даты. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, drainJobs } from './helpers';

let owner: Client;
let wood: string; // материал: закупочная 80
let glue: string; // материал без норм
let workshop: string; // склад-цех
let fg: string; // склад продукции
let center: string; // участок в режиме смены
let plainCenter: string; // обычный участок (при выпуске)
let customer: string;
let supplier: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const num = (v: string | number) => Number(v);
const post = (id: string) => owner.post(`/documents/${id}/post`);

async function balance(productId: string, warehouseId: string) {
  const rows = (await owner.get(`/stock/balances?productId=${productId}`)).body.items.filter((b: any) => b.warehouseId === warehouseId);
  return rows[0] ?? { qty: '0.000', avgCost: '0.0000', value: '0.00' };
}
async function moveCost(documentId: string, productId?: string): Promise<string> {
  const rows = (await owner.get(`/stock/moves?documentId=${documentId}&limit=100`)).body.items.filter((m: any) => m.documentId === documentId && (!productId || m.productId === productId));
  return rows[0]?.cost ?? '0';
}

/** Продукция: «2 бруса на штуку», накладные `overhead` % */
async function makeProduct(name: string, overhead = 0, kindId?: string, stageId?: string) {
  const productId = (await mk(owner, '/products', { name, price: 5000 })).id;
  const item = (await mk(owner, '/manufactured-items', { name, productId, overheadPct: overhead, ...(kindId ? { productionKindId: kindId } : {}) })).id;
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty: 2, ...(stageId ? { stageId } : {}) });
  return { productId, item };
}

/** Заказ на производство и черновик выпуска на участке; документ дня сливает выпуски одного дня и этапа */
async function draftRelease(item: string, qty: string, date: string, opts: { centerId?: string; stageId?: string } = {}) {
  const o = await mk(owner, '/production-orders', { workCenterId: opts.centerId ?? center, items: [{ itemId: item, qty }] });
  await owner.post(`/production-orders/${o.id}/fill-from-bom`);
  await owner.post(`/documents/${o.id}/post`);
  const detail = (await owner.get(`/production-orders/${o.id}`)).body;
  const rel = await owner.post(`/production-orders/${o.id}/production`, { date, lines: [{ orderItemId: detail.items[0].id, qty, ...(opts.stageId ? { stageId: opts.stageId } : {}) }] });
  if (rel.status >= 300) throw new Error(`release failed: ${rel.status} ${JSON.stringify(rel.body)}`);
  return { orderId: o.id as string, release: rel.body as any };
}
async function postedRelease(item: string, qty: string, date: string, opts: { centerId?: string; stageId?: string } = {}) {
  const r = await draftRelease(item, qty, date, opts);
  // выпуск в документ дня, уже проведённый, дописывается и проводится заново сам
  if (r.release.status === 'draft') expect((await post(r.release.id)).status).toBe(200);
  return r;
}

/** Распределение на день: «Заполнить по выпуску», материалы — по нормам или вручную (факт); распределение — ещё не считалось */
async function allocation(date: string, lines?: { productId: string; qty: number }[], opts: { periodFrom?: string } = {}) {
  const a = await mk(owner, '/material-allocations', { workCenterId: center, date, ...(opts.periodFrom ? { periodFrom: opts.periodFrom } : {}) });
  const filled = await owner.post(`/material-allocations/${a.id}/fill-items`);
  if (filled.status >= 300) throw new Error(`fill-items: ${filled.status} ${JSON.stringify(filled.body)}`);
  if (lines) return (await owner.patch(`/material-allocations/${a.id}`, { lines })).body;
  return (await owner.post(`/material-allocations/${a.id}/fill-by-norms`)).body;
}
const distribute = async (id: string, method: 'norms' | 'qty') => (await owner.post(`/material-allocations/${id}/distribute`, { method })).body;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Allocation WS' });
  wood = (await mk(owner, '/products', { name: 'Брус', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
  glue = (await mk(owner, '/products', { name: 'Клей', price: 10, purchasePrice: 10, vatRate: 'none' })).id;
  workshop = (await mk(owner, '/warehouses', { name: 'Склад цеха смены', kind: 'workshop' })).id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выпуска смены' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Цех по итогам смены', hourlyRate: 100, warehouseId: workshop, outputWarehouseId: fg, materialMode: 'shift' })).id;
  plainCenter = (await mk(owner, '/work-centers', { name: 'Цех при выпуске', hourlyRate: 100, warehouseId: workshop, outputWarehouseId: fg })).id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»' })).id;
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2027-01-02', lines: [{ productId: wood, qty: 1000, price: 80 }, { productId: glue, qty: 100, price: 10 }] });
  expect((await post(rc.id)).status).toBe(200);
});

describe('release in the shift mode', () => {
  test('the mode is taken from the work center and the release does not write off materials', async () => {
    expect((await owner.get(`/work-centers/${center}`)).body.materialMode).toBe('shift');
    const { productId, item } = await makeProduct('Полка режим смены');
    const woodBefore = await balance(wood, workshop);
    const { release } = await draftRelease(item, '3', '2027-02-01');
    expect(release.materialMode).toBe('shift');
    expect((await post(release.id)).status).toBe(200);
    // материалы на месте, продукция оприходована без стоимости материалов
    expect(await balance(wood, workshop)).toMatchObject({ qty: woodBefore.qty });
    expect(await balance(productId, fg)).toMatchObject({ qty: '3.000', avgCost: '0.0000' });
    // строки состава остаются нормами: факта списания у них нет
    const detail = (await owner.get(`/documents/${release.id}`)).body;
    expect(detail.components.filter((c: any) => c.kind === 'material').every((c: any) => c.actualQty === null)).toBe(true);
    // обычный участок списывает при выпуске
    const plain = await makeProduct('Полка при выпуске');
    const rel = await postedRelease(plain.item, '1', '2027-02-02', { centerId: plainCenter });
    expect(rel.release.materialMode).toBe('on_release');
    expect((await balance(wood, workshop)).qty).toBe(fmt3(num(woodBefore.qty) - 2));
  });

  test('the mode of a draft release can be changed; a disassembly and the customer materials are always at release', async () => {
    const { item } = await makeProduct('Полка меняет режим');
    const { release } = await draftRelease(item, '1', '2027-02-03', { centerId: plainCenter });
    expect(release.materialMode).toBe('on_release');
    const res = await owner.patch(`/production-orders/${release.id}/accounting`, { materialMode: 'shift' });
    expect(res.status).toBe(200);
    expect(res.body.materialMode).toBe('shift');

    // разборка на участке в режиме смены остаётся «при выпуске»; перевести её в режим смены нельзя
    const log = (await mk(owner, '/products', { name: 'Бревно смены', purchasePrice: 100, price: 0, vatRate: 'none' })).id;
    const plank = (await mk(owner, '/products', { name: 'Доска смены', price: 0, vatRate: 'none' })).id;
    const spec = (await mk(owner, '/manufactured-items', { name: 'Разборка смены', mode: 'disassembly', productId: log, batchQty: 1, overheadPct: 0 })).id;
    await mk(owner, `/manufactured-items/${spec}/lines`, { kind: 'output', productId: plank, qty: 2, costShare: 100 });
    const o = await mk(owner, '/production-orders', { operation: 'disassembly', workCenterId: center, warehouseId: workshop, targetWarehouseId: fg, items: [{ itemId: spec, qty: '1' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const orderItemId = (await owner.get(`/production-orders/${o.id}`)).body.items[0].id;
    const dis = await owner.post(`/production-orders/${o.id}/production`, { date: '2027-02-04', lines: [{ orderItemId, qty: '1' }] });
    expect(dis.status).toBe(201);
    expect(dis.body.materialMode).toBe('on_release');
    const bad = await owner.patch(`/production-orders/${dis.body.id}/accounting`, { materialMode: 'shift' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('shift_mode_unsupported');
  });
});

describe('material allocation', () => {
  test('the fact is split by the norms, the product gets dearer, the whole fact is written off', async () => {
    const a = await makeProduct('Стул А');
    const b = await makeProduct('Стул Б');
    const relA = await postedRelease(a.item, '1', '2027-03-01'); // норма 2
    const relB = await postedRelease(b.item, '2', '2027-03-01'); // норма 4
    const woodBefore = num((await balance(wood, workshop)).qty);

    const draft = await allocation('2027-03-01');
    // по нормам: 2 + 4 = 6 брусьев; факт смены — 9
    expect(draft.lines).toMatchObject([{ productId: wood, qty: '6.000' }]);
    expect(draft.items).toHaveLength(2);
    await owner.patch(`/material-allocations/${draft.id}`, { lines: [{ productId: wood, qty: 9 }] });
    // «Распределить по нормативам»: 3 и 6; в черновике стоимости ещё нет
    const split = await distribute(draft.id, 'norms');
    expect(split.rows.map((r: any) => num(r.qty))).toEqual([3, 6]);
    expect(split.rows.every((r: any) => r.cost === null)).toBe(true);

    const posted = await owner.post(`/material-allocations/${draft.id}/post`);
    expect(posted.status).toBe(200);
    expect(posted.body.status).toBe('posted');
    expect(num((await balance(wood, workshop)).qty)).toBe(woodBefore - 9);
    // 9 × 80 = 720: 240 на стул А, 480 на два стула Б
    expect(posted.body.rows.map((r: any) => [num(r.qty), r.cost])).toEqual([[3, '240.0000'], [6, '480.0000']]);
    expect(await balance(a.productId, fg)).toMatchObject({ qty: '1.000', avgCost: '240.0000' });
    expect(await balance(b.productId, fg)).toMatchObject({ qty: '2.000', avgCost: '240.0000' });
    // сумма распределённого равна фактическому списанию
    expect(posted.body.rows.reduce((s: number, r: any) => s + num(r.cost), 0)).toBe(720);
    // себестоимость позиций выросла (в прямые затраты)
    const detailA = (await owner.get(`/documents/${relA.release.id}`)).body;
    expect(detailA.items[0].stageCost).toBe('240.0000');
    expect(relB.release.id).toBe(relA.release.id); // один документ дня на участок
  });

  test('the material outside the norms goes by the planned cost, then by the quantity; the overhead of the specification is added', async () => {
    const a = await makeProduct('Тумба А', 10);
    const b = await makeProduct('Тумба Б', 0);
    await postedRelease(a.item, '1', '2027-03-02');
    await postedRelease(b.item, '1', '2027-03-02');
    const draft = await allocation('2027-03-02', [{ productId: glue, qty: 10 }]);
    // клея нет в нормах: по плановой стоимости материалов позиции (равна) — поровну
    expect((await distribute(draft.id, 'norms')).rows.map((r: any) => num(r.qty))).toEqual([5, 5]);
    const posted = (await owner.post(`/material-allocations/${draft.id}/post`)).body;
    expect(posted.rows.map((r: any) => r.cost)).toEqual(['50.0000', '50.0000']);
    // накладные 10 % у тумбы А: 50 + 5
    expect(await balance(a.productId, fg)).toMatchObject({ avgCost: '55.0000' });
    expect(await balance(b.productId, fg)).toMatchObject({ avgCost: '50.0000' });
  });

  test('already shipped products: the cost of sales is corrected along the chain', async () => {
    const p = await makeProduct('Комод отгруженный');
    await postedRelease(p.item, '2', '2027-03-03');
    // продали одну штуку по нулевой себестоимости (материалы ещё не распределены)
    const sale = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, warehouseId: fg, date: '2027-03-04', lines: [{ productId: p.productId, qty: 1, price: 5000 }] });
    expect((await post(sale.id)).status).toBe(200);
    expect(await moveCost(sale.id, p.productId)).toBe('0.0000');
    const draft = await allocation('2027-03-03', [{ productId: wood, qty: 5 }]);
    expect((await owner.post(`/material-allocations/${draft.id}/post`)).status).toBe(200);
    // 5 × 80 = 400 на две штуки: 200 за штуку — и остаток, и проданная часть
    expect(await balance(p.productId, fg)).toMatchObject({ qty: '1.000', avgCost: '200.0000' });
    expect(await moveCost(sale.id, p.productId)).toBe('200.0000');
    // отмена возвращает прежнюю себестоимость продаж
    const un = await owner.post(`/material-allocations/${draft.id}/unpost`);
    expect(un.status).toBe(200);
    expect(await moveCost(sale.id, p.productId)).toBe('0.0000');
    expect(await balance(p.productId, fg)).toMatchObject({ avgCost: '0.0000' });
  });

  test('unposting the allocation returns materials, costs and the result', async () => {
    const p = await makeProduct('Кресло отмена');
    const rel = await postedRelease(p.item, '1', '2027-03-05');
    const woodBefore = await balance(wood, workshop);
    const draft = await allocation('2027-03-05');
    await owner.post(`/material-allocations/${draft.id}/post`);
    expect(await balance(p.productId, fg)).toMatchObject({ avgCost: '160.0000' });
    // выпуск вошёл в проведённое распределение: его не снять
    const blocked = await owner.post(`/documents/${rel.release.id}/unpost`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('has_posted_children');
    const un = await owner.post(`/material-allocations/${draft.id}/unpost`);
    expect(un.status).toBe(200);
    expect(un.body.status).toBe('draft');
    // строки распределения остаются в черновике, стоимость уходит
    expect(un.body.rows.length).toBeGreaterThan(0);
    expect(un.body.rows.every((r: any) => r.cost === null)).toBe(true);
    expect(await balance(wood, workshop)).toMatchObject({ qty: woodBefore.qty, avgCost: woodBefore.avgCost });
    expect(await balance(p.productId, fg)).toMatchObject({ qty: '1.000', avgCost: '0.0000' });
    expect((await owner.get(`/documents/${rel.release.id}`)).body.items[0].stageCost).toBe('0.0000');
    // выпуск снова можно снять, а выпуски, вошедшие в распределение, второй документ не берёт
    expect((await owner.post(`/documents/${rel.release.id}/unpost`)).status).toBe(200);
  });

  test('a release is allocated once: the next allocation of the period does not see it', async () => {
    const p = await makeProduct('Табурет однократно');
    await postedRelease(p.item, '1', '2027-03-06');
    const first = await allocation('2027-03-06');
    expect((await owner.post(`/material-allocations/${first.id}/post`)).status).toBe(200);
    const second = await mk(owner, '/material-allocations', { workCenterId: center, date: '2027-03-06', lines: [{ productId: wood, qty: 1 }] });
    const fill = await owner.post(`/material-allocations/${second.id}/fill-items`);
    expect(fill.status).toBe(422);
    expect(fill.body.error.code).toBe('no_releases');
    const res = await owner.post(`/material-allocations/${second.id}/post`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('no_releases');
  });

  test('an intermediate stage: the cost goes to the work in progress and on to the released final stage', async () => {
    const kind = await mk(owner, '/production/kinds', { name: 'Смена с этапами', stages: [{ name: 'Заготовка смены' }, { name: 'Завершение производства' }] });
    const [cut, done] = kind.stages;
    const p = await makeProduct('Шкаф этапный', 0, kind.id, cut.id);
    await mk(owner, `/manufactured-items/${p.item}/lines`, { kind: 'work', operation: 'Сборка', workCenterId: center, hours: 1, stageId: done.id }); // 100 на финальном
    const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: p.item, qty: '2' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const orderItemId = (await owner.get(`/production-orders/${o.id}`)).body.items[0].id;
    const stage1 = await owner.post(`/production-orders/${o.id}/production`, { date: '2027-04-01', lines: [{ orderItemId, stageId: cut.id, qty: '2' }] });
    expect(stage1.status).toBe(201);
    expect((await post(stage1.body.id)).status).toBe(200);
    // распределение до выпуска финального этапа: затраты копятся в НЗП этапа
    const a1 = await allocation('2027-04-01', [{ productId: wood, qty: 5 }]);
    expect((await owner.post(`/material-allocations/${a1.id}/post`)).status).toBe(200);
    expect((await owner.get(`/documents/${stage1.body.id}`)).body.items[0].stageCost).toBe('400.0000');
    // финальный этап: работы 2 × 100 = 200 и НЗП 400 — 600 на две штуки
    const last = await owner.post(`/production-orders/${o.id}/production`, { date: '2027-04-02', lines: [{ orderItemId, stageId: done.id, qty: '2' }] });
    expect(last.status).toBe(201);
    expect((await post(last.body.id)).status).toBe(200);
    expect(await balance(p.productId, fg)).toMatchObject({ qty: '2.000', avgCost: '300.0000' });

    // второй источник: финальный этап выпущен раньше распределения — корректировка прихода продукции
    const q = await makeProduct('Шкаф этапный 2', 0, kind.id, cut.id);
    await mk(owner, `/manufactured-items/${q.item}/lines`, { kind: 'work', operation: 'Сборка', workCenterId: center, hours: 1, stageId: done.id });
    const o2 = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: q.item, qty: '1' }] });
    await owner.post(`/production-orders/${o2.id}/fill-from-bom`);
    await owner.post(`/documents/${o2.id}/post`);
    const item2 = (await owner.get(`/production-orders/${o2.id}`)).body.items[0].id;
    const s1 = await owner.post(`/production-orders/${o2.id}/production`, { date: '2027-04-03', lines: [{ orderItemId: item2, stageId: cut.id, qty: '1' }] });
    expect((await post(s1.body.id)).status).toBe(200);
    const s2 = await owner.post(`/production-orders/${o2.id}/production`, { date: '2027-04-04', lines: [{ orderItemId: item2, stageId: done.id, qty: '1' }] });
    expect((await post(s2.body.id)).status).toBe(200);
    expect(await balance(q.productId, fg)).toMatchObject({ avgCost: '100.0000' });
    const a2 = await allocation('2027-04-03', [{ productId: wood, qty: 2 }]);
    expect((await owner.post(`/material-allocations/${a2.id}/post`)).status).toBe(200);
    expect(await balance(q.productId, fg)).toMatchObject({ qty: '1.000', avgCost: '260.0000' });
    // отмена возвращает прежнее
    expect((await owner.post(`/material-allocations/${a2.id}/unpost`)).status).toBe(200);
    expect(await balance(q.productId, fg)).toMatchObject({ avgCost: '100.0000' });
  });
});

describe('allocation document as in 1C', () => {
  test('the period ends on the document date, its start defaults to the date; a release before the start is not taken', async () => {
    const p = await makeProduct('Скамья период');
    await postedRelease(p.item, '1', '2027-05-03');
    await postedRelease(p.item, '1', '2027-05-05');
    // по умолчанию — один день
    const one = await mk(owner, '/material-allocations', { workCenterId: center, date: '2027-05-05' });
    expect(one).toMatchObject({ periodFrom: '2027-05-05', periodTo: '2027-05-05' });
    const filled = (await owner.post(`/material-allocations/${one.id}/fill-items`)).body;
    expect(filled.items.map((i: any) => i.date)).toEqual(['2027-05-05']);
    // дата документа двигает окончание периода
    const moved = (await owner.patch(`/material-allocations/${one.id}`, { date: '2027-05-06' })).body;
    expect(moved).toMatchObject({ periodFrom: '2027-05-05', periodTo: '2027-05-06' });
    // начало позже даты — ошибка
    const bad = await owner.patch(`/material-allocations/${one.id}`, { periodFrom: '2027-05-07' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('invalid_period');
    // начало раньше захватывает и более ранний выпуск
    const wide = await mk(owner, '/material-allocations', { workCenterId: center, date: '2027-05-05', periodFrom: '2027-05-03' });
    expect((await owner.post(`/material-allocations/${wide.id}/fill-items`)).body.items).toHaveLength(2);
  });

  test('a row of the “Products” tab can be deleted: the release stays free for another document', async () => {
    const a = await makeProduct('Банкетка А');
    const b = await makeProduct('Банкетка Б');
    await postedRelease(a.item, '1', '2027-05-10');
    await postedRelease(b.item, '1', '2027-05-10');
    const first = await allocation('2027-05-10');
    expect(first.items).toHaveLength(2);
    // оставляем только первую позицию
    const kept = (await owner.patch(`/material-allocations/${first.id}`, { items: [{ releaseItemId: first.items[0].itemId }] })).body;
    expect(kept.items).toHaveLength(1);
    const split = await distribute(first.id, 'norms');
    expect(split.rows).toHaveLength(1);
    expect(num(split.rows[0].qty)).toBe(4); // весь факт (4 по нормам обеих позиций) уходит на оставшуюся
    expect((await owner.post(`/material-allocations/${first.id}/post`)).status).toBe(200);
    // вторая позиция свободна для другого распределения, первая — нет
    const second = await mk(owner, '/material-allocations', { workCenterId: center, date: '2027-05-10' });
    const filled = (await owner.post(`/material-allocations/${second.id}/fill-items`)).body;
    expect(filled.items.map((i: any) => i.itemId)).toEqual([first.items[1].itemId]);
  });

  test('the distribution can be edited by hand; the sum must equal the fact (422 allocation_mismatch)', async () => {
    const a = await makeProduct('Диван А');
    const b = await makeProduct('Диван Б');
    await postedRelease(a.item, '1', '2027-05-11');
    await postedRelease(b.item, '1', '2027-05-11');
    const draft = await allocation('2027-05-11', [{ productId: wood, qty: 10 }]);
    const [ia, ib] = draft.items.map((i: any) => i.itemId);
    // вручную: 7 + 2 = 9 из 10 — не сходится
    await owner.patch(`/material-allocations/${draft.id}`, { rows: [{ releaseItemId: ia, productId: wood, qty: 7 }, { releaseItemId: ib, productId: wood, qty: 2 }] });
    const bad = await owner.post(`/material-allocations/${draft.id}/post`);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('allocation_mismatch');
    expect(bad.body.error.details.products[0]).toMatchObject({ productId: wood, fact: '10.000000' });
    // строка чужой позиции не принимается
    const foreign = await owner.patch(`/material-allocations/${draft.id}`, { rows: [{ releaseItemId: crypto.randomUUID(), productId: wood, qty: 10 }] });
    expect(foreign.status).toBe(422);
    // 7 + 3 = 10: проводится, стоимость — пропорционально количеству (800 на 10 брусьев)
    await owner.patch(`/material-allocations/${draft.id}`, { rows: [{ releaseItemId: ia, productId: wood, qty: 7 }, { releaseItemId: ib, productId: wood, qty: 3 }] });
    const ok = await owner.post(`/material-allocations/${draft.id}/post`);
    expect(ok.status).toBe(200);
    expect(ok.body.rows.map((r: any) => r.cost)).toEqual(['560.0000', '240.0000']);
    expect(await balance(a.productId, fg)).toMatchObject({ avgCost: '560.0000' });
    expect(await balance(b.productId, fg)).toMatchObject({ avgCost: '240.0000' });
  });

  test('“by quantity” splits by the released quantity, not by the norms; an empty distribution is filled by the norms on posting', async () => {
    const a = await makeProduct('Пуф А');
    const b = await makeProduct('Пуф Б');
    await postedRelease(a.item, '1', '2027-05-12');
    await postedRelease(b.item, '3', '2027-05-12');
    const draft = await allocation('2027-05-12', [{ productId: wood, qty: 8 }]);
    expect((await distribute(draft.id, 'qty')).rows.map((r: any) => num(r.qty))).toEqual([2, 6]);
    // нормы 2 и 6 дают то же 2 : 6 — различим на материале вне норм с другой пропорцией
    const c = await makeProduct('Пуф В');
    const d = await makeProduct('Пуф Г');
    await postedRelease(c.item, '1', '2027-05-13');
    await postedRelease(d.item, '1', '2027-05-13');
    const second = await allocation('2027-05-13', [{ productId: wood, qty: 4 }]);
    // пустое распределение при проведении заполняется по нормативам
    expect(second.rows).toHaveLength(0);
    const posted = await owner.post(`/material-allocations/${second.id}/post`);
    expect(posted.status).toBe(200);
    expect(posted.body.rows.map((r: any) => num(r.qty))).toEqual([2, 2]);
  });

  test('every position must be a posted shift-mode release of the same work center in the period', async () => {
    const p = await makeProduct('Ларь чужой участок');
    const rel = await postedRelease(p.item, '1', '2027-05-14', { centerId: plainCenter });
    const draft = await mk(owner, '/material-allocations', { workCenterId: center, date: '2027-05-14', lines: [{ productId: wood, qty: 2 }] });
    const itemId = (await owner.get(`/documents/${rel.release.id}`)).body.items[0].id;
    await owner.patch(`/material-allocations/${draft.id}`, { items: [{ releaseItemId: itemId }] });
    const res = await owner.post(`/material-allocations/${draft.id}/post`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('release_not_allocatable');
  });
});

describe('month closing', () => {
  test('releases of the shift mode without allocation give a warning, the closing goes on', async () => {
    const p = await makeProduct('Лавка без распределения');
    await postedRelease(p.item, '1', '2027-09-10');
    expect((await owner.post('/production/periods/2027-09/close')).status).toBe(202);
    await drainJobs();
    const closing = (await owner.get('/production/periods')).body.items.find((c: any) => c.month === '2027-09');
    expect(closing.status).toBe('done');
    expect(closing.totals.warnings.some((w: string) => w.includes('without material allocation'))).toBe(true);
  });
});

const fmt3 = (n: number) => n.toFixed(3);
