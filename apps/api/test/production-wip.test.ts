/* Задача 1137 «НЗП по участкам»: завершающий участок заказа и выпуска, НЗП на нём при этапах на разных участках,
   финальный этап на любом участке, остаток НЗП на дату, маскирование сумм и закрытие месяца
   (косвенные участка уходят в НЗП промежуточного этапа и доходят до продукции). */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, drainJobs } from './helpers';

let owner: Client;
let member: Client;
let wood: string;
let service: string;
let supplier: string;
let workshop: string;
let fg: string;
let cut: string; // участок промежуточного этапа
let finalCenter: string; // завершающий участок (хранит НЗП)
let assembly: string; // участок, где выпускают финальный этап
let power: string; // статья «Электричество» (по объёму выпуска)
let kind: { stages: { id: string }[] };

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

/** Изделие вида «Заготовка → Завершение»: заготовка тратит 2 бруса по 80 (160 на штуку), завершение — 1 час по 100 */
async function makeItem(name: string) {
  const product = (await mk(owner, '/products', { name, price: 5000, vatRate: 'none' })).id;
  const item = (await mk(owner, '/manufactured-items', { name, productId: product, productionKindId: (kind as any).id, overheadPct: 0 })).id;
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty: 2, stageId: kind.stages[0]!.id });
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'work', operation: 'Отделка', workCenterId: finalCenter, hours: 1, stageId: kind.stages[1]!.id });
  return { item, product };
}

/** Проведённый заказ на производство */
async function makeOrder(item: string, qty: string, over: Record<string, unknown> = {}) {
  const o = await mk(owner, '/production-orders', { workCenterId: cut, items: [{ itemId: item, qty }], ...over });
  await owner.post(`/production-orders/${o.id}/fill-from-bom`);
  expect((await owner.post(`/documents/${o.id}/post`)).status).toBe(200);
  const detail = (await owner.get(`/production-orders/${o.id}`)).body;
  return { id: o.id as string, orderItemId: detail.items[0].id as string, detail };
}

/** Выпуск этапа: черновик и проведение */
async function stage(order: { id: string; orderItemId: string }, idx: number, qty: string, date: string, over: Record<string, unknown> = {}) {
  const r = await owner.post(`/production-orders/${order.id}/production`, { date, lines: [{ orderItemId: order.orderItemId, stageId: kind.stages[idx]!.id, qty }], ...over });
  if (r.status >= 300) throw new Error(`stage ${idx}: ${r.status} ${JSON.stringify(r.body)}`);
  expect((await owner.post(`/documents/${r.body.id}/post`)).status).toBe(200);
  return r.body as any;
}

const wip = async (c: Client, date: string, workCenterId?: string) => (await c.get(`/production/wip?date=${date}${workCenterId ? `&workCenterId=${workCenterId}` : ''}`)).body as any;
/** Строка остатка НЗП по изделию (или undefined) */
const wipItem = async (date: string, name: string) => (await wip(owner, date)).centers.flatMap((c: any) => c.orders.flatMap((o: any) => o.items)).find((i: any) => i.itemName === name);
const avg = async (productId: string) => (await owner.get(`/stock/balances?productId=${productId}`)).body.items.find((b: any) => b.warehouseId === fg)?.avgCost ?? '0';
const closingOf = async (month: string) => (await owner.get('/production/periods')).body.items.find((c: any) => c.month === month);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'WIP WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;

  wood = (await mk(owner, '/products', { name: 'Брус', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
  service = (await mk(owner, '/products', { name: 'Электричество (услуга)', kind: 'service', price: 0, vatRate: 'none' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»' })).id;
  workshop = (await mk(owner, '/warehouses', { name: 'Склад цеха', kind: 'workshop' })).id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выпуска' })).id;
  const wc = (name: string) => mk(owner, '/work-centers', { name, hourlyRate: 100, warehouseId: workshop, outputWarehouseId: fg }).then(r => r.id as string);
  cut = await wc('Заготовительный');
  finalCenter = await wc('Завершающий');
  assembly = await wc('Сборочный');
  power = (await mk(owner, '/cost-items', { name: 'Электричество', kind: 'expense', distributionMethod: 'output_qty' })).id;
  kind = await mk(owner, '/production/kinds', { name: 'Заготовка и завершение', stages: [{ name: 'Заготовка' }, { name: 'Завершение производства' }] });
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2028-01-02', lines: [{ productId: wood, qty: 1000, price: 80 }] });
  expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
});

describe('final work center in the headers', () => {
  test('by default it is the work center of the order; a release takes it from the order; a draft can change it', async () => {
    const { item } = await makeItem('Шкаф по умолчанию');
    const plain = await makeOrder(item, '4');
    expect(plain.detail.finalWorkCenter?.id).toBe(cut);
    const explicit = await makeOrder(item, '4', { finalWorkCenterId: finalCenter });
    expect(explicit.detail.workCenter.id).toBe(cut);
    expect(explicit.detail.finalWorkCenter.id).toBe(finalCenter);
    const draft = await owner.post(`/production-orders/${explicit.id}/production`, { date: '2028-02-01', lines: [{ orderItemId: explicit.orderItemId, stageId: kind.stages[0]!.id, qty: '1' }] });
    expect(draft.body.finalWorkCenter.id).toBe(finalCenter);
    const changed = await owner.patch(`/production-orders/${draft.body.id}/accounting`, { finalWorkCenterId: assembly });
    expect(changed.status).toBe(200);
    expect(changed.body.finalWorkCenter.id).toBe(assembly);
  });

  test('releases with different final work centers are not merged into one day document', async () => {
    const { item } = await makeItem('Шкаф документы дня');
    const a = await makeOrder(item, '2', { finalWorkCenterId: finalCenter });
    const b = await makeOrder(item, '2', { finalWorkCenterId: assembly });
    const c = await makeOrder(item, '2', { finalWorkCenterId: finalCenter });
    const ra = await owner.post(`/production-orders/${a.id}/production`, { date: '2028-02-05', lines: [{ orderItemId: a.orderItemId, stageId: kind.stages[0]!.id, qty: '2' }] });
    const rb = await owner.post(`/production-orders/${b.id}/production`, { date: '2028-02-05', lines: [{ orderItemId: b.orderItemId, stageId: kind.stages[0]!.id, qty: '2' }] });
    const rc = await owner.post(`/production-orders/${c.id}/production`, { date: '2028-02-05', lines: [{ orderItemId: c.orderItemId, stageId: kind.stages[0]!.id, qty: '2' }] });
    expect(rb.body.id).not.toBe(ra.body.id);
    // тот же завершающий участок — тот же документ дня
    expect(rc.body.id).toBe(ra.body.id);
  });
});

describe('work in progress on the final work center', () => {
  test('stages at one work center, WIP on the final one; the final stage at a third center takes it', async () => {
    const { item, product } = await makeItem('Шкаф НЗП');
    const order = await makeOrder(item, '5', { finalWorkCenterId: finalCenter });
    await stage(order, 0, '5', '2028-03-01');
    // до выпуска этапа остатка нет
    expect((await wip(owner, '2028-02-28')).centers).toEqual([]);
    const before = await wip(owner, '2028-03-01');
    expect(before.centers).toHaveLength(1);
    expect(before.centers[0]).toMatchObject({ workCenterId: finalCenter, workCenterName: 'Завершающий', amount: '800.00' });
    expect(before.centers[0].orders[0].items[0]).toMatchObject({ itemName: 'Шкаф НЗП', qty: '5.000', amount: '800.00' });
    expect(before.centers[0].orders[0].items[0].stages).toEqual([expect.objectContaining({ name: 'Заготовка', done: '5.000' })]);
    expect(before.total).toBe('800.00');
    // фильтр по участку: на заготовительном участке НЗП не числится
    expect((await wip(owner, '2028-03-01', cut)).centers).toEqual([]);
    expect((await wip(owner, '2028-03-01', finalCenter)).centers).toHaveLength(1);

    // финальный этап на другом участке без ошибок: затраты 100 + НЗП 160 на штуку
    await stage(order, 1, '2', '2028-03-05', { workCenterId: assembly });
    expect(await avg(product)).toBe('260.0000');
    // остаток на дату: до финального этапа — 5 шт. и 800, после (частичный выпуск) — 3 шт. и 480
    expect((await wip(owner, '2028-03-04')).centers[0].orders[0].items[0]).toMatchObject({ qty: '5.000', amount: '800.00' });
    expect((await wip(owner, '2028-03-05')).centers[0].orders[0].items[0]).toMatchObject({ qty: '3.000', amount: '480.00' });
    await stage(order, 1, '3', '2028-03-06', { workCenterId: assembly });
    expect((await wip(owner, '2028-03-06')).centers).toEqual([]);
    expect((await wip(owner, '2028-03-05')).total).toBe('480.00');
  });

  test('amounts are masked for a role without access to the cost', async () => {
    const { item } = await makeItem('Шкаф маска');
    const order = await makeOrder(item, '2', { finalWorkCenterId: finalCenter });
    await stage(order, 0, '2', '2028-04-01');
    const res = await wip(member, '2028-04-01');
    const row = res.centers[0].orders[0].items[0];
    expect(row.qty).toBe('2.000');
    expect(row.amount).toBeNull();
    expect(res.centers[0].amount).toBeNull();
    expect(res.total).toBeNull();
    expect((await wip(owner, '2028-04-01')).total).toBe('320.00');
  });
});

describe('month closing and work in progress', () => {
  test('indirect costs of the work center go to the intermediate stage and reach the product (final stage after the closing)', async () => {
    const { item, product } = await makeItem('Шкаф закрытие до');
    const order = await makeOrder(item, '5', { finalWorkCenterId: finalCenter });
    await stage(order, 0, '5', '2028-05-05');
    const doc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2028-05-20', lines: [{ productId: service, qty: 1, price: 100, costItemId: power, workCenterId: cut }] });
    await owner.post(`/documents/${doc.id}/post`);
    await owner.post('/production/periods/2028-05/close');
    await drainJobs();
    const closing = await closingOf('2028-05');
    expect(closing.status).toBe('done');
    expect(closing.totals.undistributed).toBe('0.00');
    expect(closing.totals.wip).toBe('100.00');
    expect(closing.totals.byRelease).toEqual([expect.objectContaining({ allocated: '100.00', interim: true })]);
    // косвенные входят в НЗП: 800 + 100
    expect(await wipItem('2028-05-31', 'Шкаф закрытие до')).toMatchObject({ qty: '5.000', amount: '900.00' });
    // финальный этап после закрытия: 100 работ + 180 НЗП на штуку
    await stage(order, 1, '5', '2028-05-25', { workCenterId: assembly });
    expect(await avg(product)).toBe('280.0000');
    expect(await wipItem('2028-05-31', 'Шкаф закрытие до')).toBeUndefined();
    // повторное закрытие идемпотентно
    await owner.post('/production/periods/2028-05/close');
    await drainJobs();
    expect(await avg(product)).toBe('280.0000');
    expect((await closingOf('2028-05')).totals.wip).toBe('100.00');
  });

  test('indirect costs reach the product by a correction when the final stage was released before the closing', async () => {
    const { item, product } = await makeItem('Шкаф закрытие после');
    const order = await makeOrder(item, '2', { finalWorkCenterId: finalCenter });
    await stage(order, 0, '2', '2028-06-05');
    await stage(order, 1, '2', '2028-06-10', { workCenterId: assembly });
    expect(await avg(product)).toBe('260.0000');
    const doc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2028-06-20', lines: [{ productId: service, qty: 1, price: 100, costItemId: power, workCenterId: cut }] });
    await owner.post(`/documents/${doc.id}/post`);
    await owner.post('/production/periods/2028-06/close');
    await drainJobs();
    expect((await closingOf('2028-06')).totals.wip).toBe('100.00');
    // 100 косвенных на 2 штуки: +50 к цене единицы
    expect(await avg(product)).toBe('310.0000');
    // отмена закрытия возвращает прежнюю стоимость
    await owner.post('/production/periods/2028-06/reopen');
    await drainJobs();
    expect(await avg(product)).toBe('260.0000');
  });
});

describe('final work center changed between stages', () => {
  test('each stage keeps its WIP on its own final center; the final stage takes it from every stage', async () => {
    const k3 = await mk(owner, '/production/kinds', { name: 'Раскрой, склейка, завершение', stages: [{ name: 'Раскрой' }, { name: 'Склейка' }, { name: 'Завершение производства' }] });
    const product = (await mk(owner, '/products', { name: 'Стол сменил участок', price: 5000, vatRate: 'none' })).id;
    const item = (await mk(owner, '/manufactured-items', { name: 'Стол сменил участок', productId: product, productionKindId: k3.id, overheadPct: 0 })).id;
    await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty: 1, stageId: k3.stages[0].id });
    await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty: 1, stageId: k3.stages[1].id });
    const o = await mk(owner, '/production-orders', { workCenterId: cut, finalWorkCenterId: finalCenter, items: [{ itemId: item, qty: '2' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    expect((await owner.post(`/documents/${o.id}/post`)).status).toBe(200);
    const oi = (await owner.get(`/production-orders/${o.id}`)).body.items[0].id;
    const rel = async (idx: number, date: string, fwc?: string) => {
      const r = await owner.post(`/production-orders/${o.id}/production`, { date, lines: [{ orderItemId: oi, stageId: k3.stages[idx].id, qty: '2' }] });
      if (r.status >= 300) throw new Error(JSON.stringify(r.body));
      if (fwc) expect((await owner.patch(`/production-orders/${r.body.id}/accounting`, { finalWorkCenterId: fwc })).status).toBe(200);
      expect((await owner.post(`/documents/${r.body.id}/post`)).status).toBe(200);
    };
    await rel(0, '2028-08-01');
    await rel(1, '2028-08-02', assembly);
    // раскрой числится на завершающем участке заказа, склейка — на сменённом: по 2 шт. и по 160 (2 бруса по 80)
    const mid = (await wip(owner, '2028-08-02')).centers.filter((c: any) => c.orders.some((o: any) => o.items.some((i: any) => i.itemName === 'Стол сменил участок')));
    expect(mid.map((c: any) => [c.workCenterId, c.orders.flatMap((o: any) => o.items.filter((i: any) => i.itemName === 'Стол сменил участок').map((i: any) => [i.qty, i.amount]))])).toEqual([
      [finalCenter, [['2.000', '160.00']]],
      [assembly, [['2.000', '160.00']]],
    ]);
    await rel(2, '2028-08-03');
    // финальный этап принял все 2 шт.: НЗП не остаётся ни на одном участке
    expect(await wipItem('2028-08-03', 'Стол сменил участок')).toBeUndefined();
  });
});
