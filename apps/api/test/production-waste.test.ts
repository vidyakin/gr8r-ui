/* Брак и возвратные отходы (задача 1136): строка отхода в спецификации и выпуске, стоимость «нулевая / учётная», сумма
   приходов (продукция + брак + отходы) равна затратам выпуска до копейки, waste_exceeds_cost, брак «в себестоимость» и
   «на расходы», «Списать брак» и повтор 409, исполнение заказа по годному, разборка, поэтапный выпуск, переработка,
   плановая себестоимость, переоценка и закрытие месяца, отмена проведения, закрытый период, маскирование у member.
   У теста свои товары, склады и даты: чужие тесты и документ дня на участок не мешают. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, drainJobs } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let wood: string; // материал, закупочная 80
let sawdust: string; // отход: закупочная 20, продажи 50
let chips: string; // дорогой отход: закупочная 9000
let workshop: string; // склад-цех (материалы)
let fg: string; // склад готовой продукции
let wasteWh: string; // склад отходов
let defectWh: string; // склад брака
let center: string; // участок: работа 600/ч
let supplier: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const lineOf = (itemId: string, body: Record<string, unknown>) => mk(owner, `/manufactured-items/${itemId}/lines`, body);

/** Остаток и средняя товара на складе */
async function balance(productId: string, warehouseId: string, c: Client = owner) {
  const rows = (await c.get(`/stock/balances?productId=${productId}`)).body.items.filter((b: any) => b.warehouseId === warehouseId);
  return rows[0] ?? { qty: '0.000', avgCost: '0.0000', value: '0.00', reserved: '0.000' };
}
const num = (v: string | number) => Number(v);

/** Изделие: товар каталога + спецификация «2 бруса, час работы, накладные 10 %, 1 отход на партию».
    Затраты единицы: 160 + 600 + 76 = 836, отход 20 -> 816 */
async function makeProduct(name: string, withWaste = true) {
  const productId = (await mk(owner, '/products', { name, price: 5000 })).id;
  const item = (await mk(owner, '/manufactured-items', { name, productId, overheadPct: 10 })).id;
  await lineOf(item, { kind: 'material', productId: wood, qty: 2 });
  await lineOf(item, { kind: 'work', operation: 'Сборка', workCenterId: center, hours: 1 });
  if (withWaste) await lineOf(item, { kind: 'waste', productId: sawdust, qty: 1 });
  return { productId, item };
}

/** Заказ на производство на `qty` и черновик выпуска на `releaseQty` с браком; датой выпуска разводим документы дня */
async function draftRelease(item: string, qty: string, date: string, opts: { releaseQty?: string; defectQty?: string; defectMode?: 'cost' | 'expense'; orderExtra?: Record<string, unknown> } = {}) {
  const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty }], ...(opts.orderExtra ?? {}) });
  await owner.post(`/production-orders/${o.id}/fill-from-bom`);
  await owner.post(`/documents/${o.id}/post`);
  const detail = (await owner.get(`/production-orders/${o.id}`)).body;
  const rel = await owner.post(`/production-orders/${o.id}/production`, {
    date,
    lines: [{ orderItemId: detail.items[0].id, qty: opts.releaseQty ?? qty, ...(opts.defectQty ? { defectQty: opts.defectQty, defectMode: opts.defectMode } : {}) }],
  });
  if (rel.status >= 300) throw new Error(`release failed: ${rel.status} ${JSON.stringify(rel.body)}`);
  return { orderId: o.id as string, release: rel.body as any };
}
const post = (id: string) => owner.post(`/documents/${id}/post`);
const unpost = (id: string) => owner.post(`/documents/${id}/unpost`);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Waste WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other waste WS' });

  wood = (await mk(owner, '/products', { name: 'Брус', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
  sawdust = (await mk(owner, '/products', { name: 'Опилки', unitCode: '166', price: 50, purchasePrice: 20, vatRate: 'none' })).id;
  chips = (await mk(owner, '/products', { name: 'Стружка дорогая', unitCode: '166', price: 9000, purchasePrice: 9000, vatRate: 'none' })).id;
  workshop = (await mk(owner, '/warehouses', { name: 'Склад цеха', kind: 'workshop' })).id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выпуска' })).id;
  wasteWh = (await mk(owner, '/warehouses', { name: 'Склад отходов' })).id;
  defectWh = (await mk(owner, '/warehouses', { name: 'Склад брака' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Столярный цех', hourlyRate: 600, warehouseId: workshop, outputWarehouseId: fg, wasteWarehouseId: wasteWh, defectWarehouseId: defectWh })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»' })).id;
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, lines: [{ productId: wood, qty: 1000, price: 80 }] });
  expect((await post(rc.id)).status).toBe(200);
});

describe('returnable waste in the bill of materials', () => {
  test('a waste line has a product and a quantity, no stage; the planned cost is reduced by the waste (overhead stays on the direct cost)', async () => {
    const { item } = await makeProduct('Стол плановый');
    const tree = (await owner.get(`/manufactured-items/${item}/cost`)).body.tree;
    // материалы 160, работы 600, накладные 10 % от прямых 760 = 76, отходы -20: 836 - 20
    expect(tree.unit).toEqual({ materials: '160.0000', works: '600.0000', overhead: '76.0000', waste: '-20.0000', total: '816.0000' });
    expect(tree.lines.map((l: any) => [l.kind, l.cost])).toContainEqual(['waste', '-20.0000']);
    // строка отхода не принимает чужие поля
    const bad = await owner.post(`/manufactured-items/${item}/lines`, { kind: 'waste', productId: sawdust, qty: 1, scrapPct: 5 });
    expect(bad.status).toBe(400);
    const service = (await mk(owner, '/products', { name: 'Услуга', kind: 'service', price: 1 })).id;
    expect((await owner.post(`/manufactured-items/${item}/lines`, { kind: 'waste', productId: service, qty: 1 })).status).toBe(422);
  });

  test('the planned cost follows the waste price source of the workspace; a zero price counts as unset', async () => {
    const { item } = await makeProduct('Стол по источнику');
    expect((await member.patch('/production/settings', { wastePriceSource: 'price' })).status).toBe(403);
    expect((await owner.patch('/production/settings', { wastePriceSource: 'price' })).body.wastePriceSource).toBe('price');
    // цена продажи отхода 50: 836 - 50
    expect((await owner.get(`/manufactured-items/${item}/cost`)).body.tree.unit.total).toBe('786.0000');
    expect((await owner.patch('/production/settings', { wastePriceSource: 'purchase' })).status).toBe(200);
    expect((await owner.get(`/manufactured-items/${item}/cost`)).body.tree.unit.total).toBe('816.0000');
  });
});

describe('release with waste', () => {
  test('accounting valuation: the waste is received once on the waste warehouse; goods + waste = release costs to the kopeck', async () => {
    const { productId, item } = await makeProduct('Стол учётный');
    const { release } = await draftRelease(item, '3', '2026-01-10');
    // состав: отход в «Отходах»; в строках документа его нет (приходует только проведение)
    expect(release.lines.map((l: any) => [l.stockRole, l.productId])).toEqual([['in', productId], ['out', wood]]);
    const waste = release.components.filter((c: any) => c.kind === 'waste');
    expect(waste).toHaveLength(1);
    expect(waste[0]).toMatchObject({ productId: sawdust, qty: '3.000', price: '20.0000' });
    expect(release.wasteValuation).toBe('accounting');
    expect(release.wasteWarehouseId).toBe(wasteWh);
    expect(release.defectWarehouseId).toBe(defectWh);

    expect((await post(release.id)).status).toBe(200);
    // затраты: 6 брусов 480 + работа 3 ч 1800 + накладные 10 % от 2280 = 228 -> 2508; отходы 3 × 20 = 60
    const product = await balance(productId, fg);
    const waste_ = await balance(sawdust, wasteWh);
    expect(product).toMatchObject({ qty: '3.000', avgCost: '816.0000', value: '2448.00' });
    expect(waste_).toMatchObject({ qty: '3.000', avgCost: '20.0000', value: '60.00' });
    expect(num(product.value) + num(waste_.value)).toBeCloseTo(2508, 2);
    // отходы не приходуются дважды и не попадают на склад продукции
    expect((await balance(sawdust, fg)).qty).toBe('0.000');
    const after = (await owner.get(`/documents/${release.id}`)).body;
    expect(after.items[0].stageCost).toBe('2448.0000');
    expect(after.components.find((c: any) => c.kind === 'waste')).toMatchObject({ actualQty: '3.000', actualCost: '60.0000' });

    // отмена проведения возвращает остатки
    expect((await unpost(release.id)).status).toBe(200);
    expect((await balance(productId, fg)).qty).toBe('0.000');
    expect((await balance(sawdust, wasteWh)).qty).toBe('0.000');
    expect((await balance(wood, workshop)).qty).toBe('1000.000');
  });

  test('zero valuation: the waste is received at zero and the product keeps the whole cost', async () => {
    const { productId, item } = await makeProduct('Стол нулевой');
    const { release } = await draftRelease(item, '3', '2026-01-11');
    const patched = await owner.patch(`/production-orders/${release.id}/accounting`, { wasteValuation: 'zero' });
    expect(patched.status).toBe(200);
    expect(patched.body.wasteValuation).toBe('zero');
    expect((await post(release.id)).status).toBe(200);
    expect(await balance(productId, fg)).toMatchObject({ qty: '3.000', avgCost: '836.0000' });
    expect(await balance(sawdust, wasteWh)).toMatchObject({ qty: '3.000', avgCost: '0.0000', value: '0.00' });
    await unpost(release.id);
  });

  test('the price of the waste is edited in the draft by admin/owner only; a member keeps the price and sees no money', async () => {
    const { productId, item } = await makeProduct('Стол цена');
    const { release } = await draftRelease(item, '3', '2026-01-12');
    const lineId = release.components.find((c: any) => c.kind === 'waste').id;
    // member меняет количество, но цену не задаёт
    const byMember = await member.patch(`/production-orders/${release.id}/accounting`, { waste: [{ id: lineId, productId: sawdust, qty: '4', price: '1' }] });
    expect(byMember.status).toBe(200);
    const wasteForMember = byMember.body.components.find((c: any) => c.kind === 'waste');
    expect(wasteForMember.qty).toBe('4.000');
    expect(wasteForMember.price).toBeNull();
    expect(wasteForMember.plannedCost).toBeNull();
    expect(wasteForMember.actualCost).toBeNull();
    expect((await member.get(`/documents/${release.id}`)).body.components.find((c: any) => c.kind === 'waste').price).toBeNull();
    // цену не поменял: у owner она прежняя
    expect((await owner.get(`/documents/${release.id}`)).body.components.find((c: any) => c.kind === 'waste').price).toBe('20.0000');
    // owner задаёт цену 50: 4 × 50 = 200 вычитается из затрат 2508
    const byOwner = await owner.patch(`/production-orders/${release.id}/accounting`, { waste: [{ id: lineId, productId: sawdust, qty: '4', price: '50' }] });
    expect(byOwner.body.components.find((c: any) => c.kind === 'waste').price).toBe('50.0000');
    expect((await post(release.id)).status).toBe(200);
    expect(await balance(productId, fg)).toMatchObject({ qty: '3.000', value: '2308.00' }); // 2508 - 200
    expect(await balance(sawdust, wasteWh)).toMatchObject({ qty: '4.000', avgCost: '50.0000' });
    await unpost(release.id);
  });

  test('a waste line is added and removed on the tab; the tab works on a draft only', async () => {
    const { item } = await makeProduct('Стол вкладка', false);
    const { release } = await draftRelease(item, '2', '2026-01-13');
    expect(release.components.filter((c: any) => c.kind === 'waste')).toHaveLength(0);
    const added = await owner.patch(`/production-orders/${release.id}/accounting`, { waste: [{ productId: sawdust, qty: '1.5' }] });
    expect(added.status).toBe(200);
    const row = added.body.components.find((c: any) => c.kind === 'waste');
    expect(row).toMatchObject({ productId: sawdust, qty: '1.500', price: '20.0000' }); // цена по настройке «Цена отходов»
    const cleared = await owner.patch(`/production-orders/${release.id}/accounting`, { waste: [] });
    expect(cleared.body.components.filter((c: any) => c.kind === 'waste')).toHaveLength(0);
    // только товары каталога
    const service = (await mk(owner, '/products', { name: 'Услуга 2', kind: 'service', price: 1 })).id;
    expect((await owner.patch(`/production-orders/${release.id}/accounting`, { waste: [{ productId: service, qty: '1' }] })).status).toBe(422);
    expect((await post(release.id)).status).toBe(200);
    const posted = await owner.patch(`/production-orders/${release.id}/accounting`, { wasteValuation: 'zero' });
    expect(posted.status).toBe(409);
    await unpost(release.id);
  });

  test('waste dearer than the whole release: 422 waste_exceeds_cost, nothing moves', async () => {
    const { item } = await makeProduct('Стол дорогие отходы', false);
    const { release } = await draftRelease(item, '1', '2026-01-14');
    await owner.patch(`/production-orders/${release.id}/accounting`, { waste: [{ productId: chips, qty: '1' }] }); // 9000 > 836
    const res = await post(release.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('waste_exceeds_cost');
    expect((await balance(chips, wasteWh)).qty).toBe('0.000');
  });

  test('the waste is distributed between the products by their cost, the remainder goes to the last one', async () => {
    const a = await makeProduct('Стол А');
    const b = await mk(owner, '/products', { name: 'Стол Б', price: 1 });
    const itemB = (await mk(owner, '/manufactured-items', { name: 'Стол Б', productId: b.id, overheadPct: 0 })).id;
    await lineOf(itemB, { kind: 'material', productId: wood, qty: 1 }); // 80 на единицу
    await lineOf(itemB, { kind: 'waste', productId: sawdust, qty: 1 });
    // выпуск из двух заказов в один день: затраты А 836, Б 80; отходы 20 + 20 делятся 836:80
    const date = '2026-01-15';
    await draftRelease(a.item, '1', date);
    const { release } = await draftRelease(itemB, '1', date);
    expect((await post(release.id)).status).toBe(200);
    // отходы 40: А получает 40 × 836 / 916 = 36.5066 -> 36.51, Б - остаток 3.49; сумма точно 40
    const detail = (await owner.get(`/documents/${release.id}`)).body;
    const costs = detail.items.map((i: any) => num(i.stageCost));
    expect(costs[0]).toBeCloseTo(836 - 36.51, 2);
    expect(costs[1]).toBeCloseTo(80 - 3.49, 2);
    expect(costs[0] + costs[1] + 40).toBeCloseTo(916, 2);
    await unpost(release.id);
  });

  test('waste of a customer material processing is forbidden', async () => {
    const customer = (await mk(owner, '/companies', { name: 'Давалец' })).id;
    const proc = await mk(owner, '/documents', { type: 'customer_order', operation: 'processing', counterpartyId: customer, warehouseId: workshop, lines: [{ productId: wood, qty: '1', price: 5000 }] });
    await post(proc.id);
    const { item } = await makeProduct('Стол переработка');
    const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '1' }], processingOrderId: proc.id });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const itemId = (await owner.get(`/production-orders/${o.id}`)).body.items[0].id;
    const rel = await owner.post(`/production-orders/${o.id}/production`, { date: '2026-01-16', lines: [{ orderItemId: itemId, qty: '1' }] });
    expect(rel.status).toBe(201);
    const res = await post(rel.body.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('waste_tolling_forbidden');
  });
});

describe('defects', () => {
  test('into the cost: the defect is not received, all the costs lie on the good products', async () => {
    const { productId, item } = await makeProduct('Стол брак в себестоимость');
    const { release } = await draftRelease(item, '4', '2026-02-02', { defectQty: '1', defectMode: 'cost' });
    expect(release.items[0]).toMatchObject({ qty: '4.000', defectQty: '1.000', defectMode: 'cost' });
    expect((await post(release.id)).status).toBe(200);
    // затраты 4 × 836 = 3344, отходы 4 × 20 = 80 -> 3264 на 3 годных = 1088
    expect(await balance(productId, fg)).toMatchObject({ qty: '3.000', avgCost: '1088.0000', value: '3264.00' });
    expect((await balance(productId, defectWh)).qty).toBe('0.000');
    expect(await balance(sawdust, wasteWh)).toMatchObject({ qty: '4.000', value: '80.00' });
    const detail = (await owner.get(`/documents/${release.id}`)).body;
    expect(detail.items[0].defectUnitCost).toBe('1088.0000');
    await unpost(release.id);
  });

  test('on expenses: the defect goes to the defect warehouse at the unit cost of the good products', async () => {
    const { productId, item } = await makeProduct('Стол брак на расходы');
    const { release } = await draftRelease(item, '4', '2026-02-03', { defectQty: '1', defectMode: 'expense' });
    expect((await post(release.id)).status).toBe(200);
    const good = await balance(productId, fg);
    const bad = await balance(productId, defectWh);
    const waste = await balance(sawdust, wasteWh);
    // 3264 на 4 выпущенных = 816 на единицу и годному, и браку
    expect(good).toMatchObject({ qty: '3.000', avgCost: '816.0000' });
    expect(bad).toMatchObject({ qty: '1.000', avgCost: '816.0000' });
    // сумма приходов (продукция, брак, отходы) = затраты выпуска 3344
    expect(num(good.value) + num(bad.value) + num(waste.value)).toBeCloseTo(3344, 2);
    await unpost(release.id);
    expect((await balance(productId, defectWh)).qty).toBe('0.000');
    expect((await balance(productId, fg)).qty).toBe('0.000');
  });

  test('"Write off the defect": a draft write-off on the defect warehouse, a second call is 409, only a posted release with expense defects', async () => {
    const { productId, item } = await makeProduct('Стол списание брака');
    const { release } = await draftRelease(item, '4', '2026-02-04', { defectQty: '2', defectMode: 'expense' });
    // черновик выпуска списать нельзя
    expect((await member.post(`/production/${release.id}/write-off-defects`)).status).toBe(422);
    expect((await post(release.id)).status).toBe(200);
    const res = await member.post(`/production/${release.id}/write-off-defects`);
    expect(res.status).toBe(201);
    const draft = (await owner.get(`/documents/${res.body.id}`)).body;
    expect(draft).toMatchObject({ type: 'write_off', status: 'draft', basedOnId: release.id, warehouseId: defectWh });
    expect(draft.lines.map((l: any) => [l.productId, l.qty])).toEqual([[productId, '2.000']]);
    // повтор: 409 со ссылкой на созданный документ
    const again = await owner.post(`/production/${release.id}/write-off-defects`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('defects_written_off');
    expect(again.body.error.details.documentId).toBe(res.body.id);
    // списание проводится как обычный акт: остаток брака уходит
    const costItem = (await mk(owner, '/cost-items', { name: 'Потери от брака', kind: 'expense' })).id;
    await owner.patch(`/documents/${res.body.id}`, { costItemId: costItem });
    expect((await post(res.body.id)).status).toBe(200);
    expect((await balance(productId, defectWh)).qty).toBe('0.000');
    // выпуск без брака «на расходы» списывать нечего
    const clean = await draftRelease((await makeProduct('Стол без брака')).item, '1', '2026-02-05');
    await post(clean.release.id);
    const none = await owner.post(`/production/${clean.release.id}/write-off-defects`);
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('no_defects');
    // отменённое списание можно сделать заново
    await owner.post(`/documents/${res.body.id}/unpost`);
    await owner.post(`/documents/${res.body.id}/cancel`);
    expect((await owner.post(`/production/${release.id}/write-off-defects`)).status).toBe(201);
  });

  test('the defect is validated: not above the output, a mode is required, "into the cost" needs a good product', async () => {
    const { item } = await makeProduct('Стол проверка брака');
    const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '3' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const orderItemId = (await owner.get(`/production-orders/${o.id}`)).body.items[0].id;
    const tryRelease = async (line: Record<string, unknown>, date: string) => owner.post(`/production-orders/${o.id}/production`, { date, lines: [{ orderItemId, qty: '3', ...line }] });
    expect((await tryRelease({ defectQty: '4', defectMode: 'expense' }, '2026-02-06')).body.error.code).toBe('defect_exceeds_qty');
    expect((await tryRelease({ defectQty: '1' }, '2026-02-07')).body.error.code).toBe('defect_mode_required');
    expect((await tryRelease({ defectQty: '3', defectMode: 'cost' }, '2026-02-08')).body.error.code).toBe('defect_exceeds_qty');
    // заказ брака не хранит
    const draftOrder = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '1' }] });
    const bad = await owner.patch(`/production-orders/${draftOrder.id}/accounting`, { defects: [{ itemId: draftOrder.items[0].id, defectQty: '1', defectMode: 'cost' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('defect_order_forbidden');
  });

  test('the order is fulfilled by the good products: the defect does not close it', async () => {
    const { productId, item } = await makeProduct('Стол исполнение');
    const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '3' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const orderItemId = (await owner.get(`/production-orders/${o.id}`)).body.items[0].id;
    // выпущено 4, из них брак 1 -> годных 3: заказ исполнен полностью
    const rel = await owner.post(`/production-orders/${o.id}/production`, { date: '2026-02-09', lines: [{ orderItemId, qty: '4', defectQty: '1', defectMode: 'expense' }] });
    expect(rel.status).toBe(201);
    expect((await post(rel.body.id)).status).toBe(200);
    expect((await owner.get(`/production-orders/${o.id}`)).body.items[0].produced).toBe('3.000');
    // один брак из трёх: ещё нужна замена
    const o2 = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '3' }] });
    await owner.post(`/production-orders/${o2.id}/fill-from-bom`);
    await owner.post(`/documents/${o2.id}/post`);
    const itemId2 = (await owner.get(`/production-orders/${o2.id}`)).body.items[0].id;
    const r1 = await owner.post(`/production-orders/${o2.id}/production`, { date: '2026-02-10', lines: [{ orderItemId: itemId2, qty: '3', defectQty: '1', defectMode: 'expense' }] });
    expect((await post(r1.body.id)).status).toBe(200);
    expect((await owner.get(`/production-orders/${o2.id}`)).body.items[0].produced).toBe('2.000');
    const r2 = await owner.post(`/production-orders/${o2.id}/production`, { date: '2026-02-11', lines: [{ orderItemId: itemId2, qty: '1' }] }); // остаток 1
    expect(r2.status).toBe(201);
    expect((await post(r2.body.id)).status).toBe(200);
    const more = await owner.post(`/production-orders/${o2.id}/production`, { date: '2026-02-12', lines: [{ orderItemId: itemId2, qty: '1' }] });
    expect(more.status).toBe(422);
    expect(more.body.error.code).toBe('over_fulfilment');
    expect(num((await balance(productId, fg)).qty)).toBeGreaterThan(0);
  });

  test('the reserve for the customer order counts the good products only', async () => {
    const { productId, item } = await makeProduct('Стол под заказ');
    await owner.post('/production-orders/product-settings', { productId, replenishment: 'production', defaultItemId: item });
    const customer = (await mk(owner, '/companies', { name: 'Покупатель' })).id;
    const co = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: fg, lines: [{ productId, qty: 3, price: 5000 }] });
    await post(co.id);
    const lineId = (await owner.get(`/documents/${co.id}`)).body.lines[0].id;
    const rel = await owner.post('/production-orders/production', { customerOrderId: co.id, date: '2026-02-13', workCenterId: center, lines: [{ customerOrderLineId: lineId, qty: '4', defectQty: '1', defectMode: 'expense' }] });
    expect(rel.status).toBe(201);
    expect((await post(rel.body.id)).status).toBe(200);
    const stock = await balance(productId, fg);
    expect(stock.qty).toBe('3.000');
    expect(stock.reserved).toBe('3.000'); // резерв по годному
  });
});

describe('disassembly with waste', () => {
  test('the accounting cost of the waste is subtracted before the cost is split between the outputs', async () => {
    const log = (await mk(owner, '/products', { name: 'Бревно', purchasePrice: 100, price: 0, vatRate: 'none' })).id;
    const plankA = (await mk(owner, '/products', { name: 'Доска А', price: 0, vatRate: 'none' })).id;
    const plankB = (await mk(owner, '/products', { name: 'Доска Б', price: 0, vatRate: 'none' })).id;
    const shavings = (await mk(owner, '/products', { name: 'Опил разборки', unitCode: '166', price: 0, purchasePrice: 20, vatRate: 'none' })).id;
    const spec = (await mk(owner, '/manufactured-items', { name: 'Разборка бревна с отходом', mode: 'disassembly', productId: log, batchQty: 1, overheadPct: 0 })).id;
    await lineOf(spec, { kind: 'output', productId: plankA, qty: 2, costShare: 50 });
    await lineOf(spec, { kind: 'output', productId: plankB, qty: 2, costShare: 50 });
    await lineOf(spec, { kind: 'waste', productId: shavings, qty: 3 });
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2026-03-01', lines: [{ productId: log, qty: 10, price: 100 }] });
    await post(rc.id);
    const o = await mk(owner, '/production-orders', { operation: 'disassembly', workCenterId: center, warehouseId: workshop, targetWarehouseId: fg, items: [{ itemId: spec, qty: '2' }] });
    const filled = (await owner.post(`/production-orders/${o.id}/fill-from-bom`)).body;
    expect(filled.components.filter((c: any) => c.kind === 'waste')).toHaveLength(1);
    await owner.post(`/documents/${o.id}/post`);
    const orderItemId = (await owner.get(`/production-orders/${o.id}`)).body.items[0].id;
    const rel = await owner.post(`/production-orders/${o.id}/production`, { date: '2026-03-02', lines: [{ orderItemId, qty: '2' }] });
    expect(rel.status).toBe(201);
    expect((await post(rel.body.id)).status).toBe(200);
    // списано 2 бревна = 200, отходы 6 × 20 = 120 -> на выходы 80 поровну: по 40 на доску А и Б
    expect(await balance(shavings, wasteWh)).toMatchObject({ qty: '6.000' });
    const a = await balance(plankA, fg);
    const b = await balance(plankB, fg);
    expect(num(a.value) + num(b.value)).toBeCloseTo(80, 2);
    expect(num(a.value)).toBeCloseTo(40, 2);
    const waste = await balance(shavings, wasteWh);
    expect(num(waste.value) + num(a.value) + num(b.value)).toBeCloseTo(200, 2);
    // отходы дороже стоимости разборки
    const spec2 = (await mk(owner, '/manufactured-items', { name: 'Разборка дорогие отходы', mode: 'disassembly', productId: log, batchQty: 1, overheadPct: 0 })).id;
    await lineOf(spec2, { kind: 'output', productId: plankA, qty: 1, costShare: 100 });
    await lineOf(spec2, { kind: 'waste', productId: chips, qty: 1 });
    const o2 = await mk(owner, '/production-orders', { operation: 'disassembly', workCenterId: center, warehouseId: workshop, targetWarehouseId: fg, items: [{ itemId: spec2, qty: '1' }] });
    await owner.post(`/production-orders/${o2.id}/fill-from-bom`);
    await owner.post(`/documents/${o2.id}/post`);
    const itemId2 = (await owner.get(`/production-orders/${o2.id}`)).body.items[0].id;
    const rel2 = await owner.post(`/production-orders/${o2.id}/production`, { date: '2026-03-03', lines: [{ orderItemId: itemId2, qty: '1' }] });
    const res = await post(rel2.body.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('waste_exceeds_cost');
  });
});


describe('release by stages', () => {
  test('only the final stage receives the waste; the defect is recorded by the final stage only', async () => {
    const kind = await mk(owner, '/production/kinds', { name: 'Поэтапное с отходом', stages: [{ name: 'Распил' }, { name: 'Завершение производства' }] });
    const [cut, done] = kind.stages;
    const productId = (await mk(owner, '/products', { name: 'Стол этапный', price: 5000 })).id;
    const item = (await mk(owner, '/manufactured-items', { name: 'Стол этапный', productId, productionKindId: kind.id, overheadPct: 0 })).id;
    await lineOf(item, { kind: 'material', productId: wood, qty: 2, stageId: cut.id }); // 160 на этапе «Распил»
    await lineOf(item, { kind: 'work', operation: 'Сборка', workCenterId: center, hours: 1, stageId: done.id }); // 600 на финальном
    // у отхода этапа нет: ни обязательного, ни допустимого
    expect((await owner.post(`/manufactured-items/${item}/lines`, { kind: 'waste', productId: sawdust, qty: 1, stageId: done.id })).status).toBe(422);
    await lineOf(item, { kind: 'waste', productId: sawdust, qty: 1 });

    const wasteBefore = num((await balance(sawdust, wasteWh)).qty);
    const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '2' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const orderItemId = (await owner.get(`/production-orders/${o.id}`)).body.items[0].id;
    // промежуточный этап: брака нет, отход не приходуется
    const bad = await owner.post(`/production-orders/${o.id}/production`, { date: '2026-05-04', lines: [{ orderItemId, stageId: cut.id, qty: '2', defectQty: '1', defectMode: 'cost' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('defect_final_stage_only');
    const first = await owner.post(`/production-orders/${o.id}/production`, { date: '2026-05-05', lines: [{ orderItemId, stageId: cut.id, qty: '2' }] });
    expect(first.status).toBe(201);
    expect(first.body.components.some((c: any) => c.kind === 'waste')).toBe(false);
    expect((await post(first.body.id)).status).toBe(200);
    expect(num((await balance(sawdust, wasteWh)).qty)).toBe(wasteBefore);
    // финальный этап: затраты 600 × 2 = 1200 + НЗП 160 × 2 = 320 - отходы 2 × 20 = 40
    const last = await owner.post(`/production-orders/${o.id}/production`, { date: '2026-05-06', lines: [{ orderItemId, stageId: done.id, qty: '2' }] });
    expect(last.status).toBe(201);
    expect(last.body.components.filter((c: any) => c.kind === 'waste')).toHaveLength(1);
    expect((await post(last.body.id)).status).toBe(200);
    expect(await balance(productId, fg)).toMatchObject({ qty: '2.000', avgCost: '740.0000', value: '1480.00' });
    expect(num((await balance(sawdust, wasteWh)).qty)).toBe(wasteBefore + 2);
    // отмена финального этапа возвращает продукцию и отходы, промежуточный этап остаётся
    await unpost(last.body.id);
    expect(num((await balance(sawdust, wasteWh)).qty)).toBe(wasteBefore);
    expect((await balance(productId, fg)).qty).toBe('0.000');
  });
});

describe('revaluation and closing of the month', () => {
  let service: string;
  let electricity: string;
  const closeMonth = async (month: string) => {
    expect((await owner.post(`/production/periods/${month}/close`)).status).toBe(202);
    await drainJobs();
    return (await owner.get('/production/periods')).body.items.find((c: any) => c.month === month);
  };

  test('a dearer material flows into the good products and the defect, not into the waste', async () => {
    service = (await mk(owner, '/products', { name: 'Электричество (услуга)', kind: 'service', price: 0, vatRate: 'none' })).id;
    electricity = (await mk(owner, '/cost-items', { name: 'Электричество', kind: 'expense', distributionMethod: 'output_qty' })).id;
    const boardCenter = (await mk(owner, '/work-centers', { name: 'Участок досок', warehouseId: workshop, outputWarehouseId: workshop })).id;
    const boardProduct = (await mk(owner, '/products', { name: 'Доска', price: 900 })).id;
    const board = (await mk(owner, '/manufactured-items', { name: 'Доска', kind: 'semi', productId: boardProduct, overheadPct: 0 })).id;
    await lineOf(board, { kind: 'material', productId: wood, qty: 1 });
    const tableProduct = (await mk(owner, '/products', { name: 'Стол из досок', price: 5000 })).id;
    const table = (await mk(owner, '/manufactured-items', { name: 'Стол из досок', productId: tableProduct, overheadPct: 0 })).id;
    await lineOf(table, { kind: 'semi', childItemId: board, qty: 1 });
    await lineOf(table, { kind: 'waste', productId: sawdust, qty: 1 });

    // доски: 2 шт. по 80 на участке досок
    const bo = await mk(owner, '/production-orders', { workCenterId: boardCenter, items: [{ itemId: board, qty: '2' }] });
    await owner.post(`/production-orders/${bo.id}/fill-from-bom`);
    await owner.post(`/documents/${bo.id}/post`);
    const boardLine = (await owner.get(`/production-orders/${bo.id}`)).body.items[0].id;
    const br = await owner.post(`/production-orders/${bo.id}/production`, { date: '2026-04-10', lines: [{ orderItemId: boardLine, qty: '2' }] });
    expect((await post(br.body.id)).status).toBe(200);
    // столы: 2 шт., брак 1 «на расходы»; затраты 2 × 80 = 160, отходы 2 × 20 = 40 -> по 60 на годный и бракованный
    const { release } = await draftRelease(table, '2', '2026-04-12', { defectQty: '1', defectMode: 'expense' });
    expect((await post(release.id)).status).toBe(200);
    expect(await balance(tableProduct, fg)).toMatchObject({ qty: '1.000', avgCost: '60.0000' });
    expect(await balance(tableProduct, defectWh)).toMatchObject({ qty: '1.000', avgCost: '60.0000' });

    // косвенные 100 на участок досок: каждая доска дорожает на 50
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2026-04-20', lines: [{ productId: service, qty: 1, price: '100', costItemId: electricity, workCenterId: boardCenter }] });
    expect((await post(rc.id)).status).toBe(200);
    const closing = await closeMonth('2026-04');
    expect(closing.status).toBe('done');
    // удорожание досок (2 × 50 = 100) делится на 2 выпущенных стола: и годный, и брак -> 110; отходы по-прежнему по 20
    expect(await balance(tableProduct, fg)).toMatchObject({ qty: '1.000', avgCost: '110.0000' });
    expect(await balance(tableProduct, defectWh)).toMatchObject({ qty: '1.000', avgCost: '110.0000' });
    expect(await balance(sawdust, wasteWh)).toMatchObject({ avgCost: '20.0000' });
    // сумма приходов выпуска = стоимость двух досок по 130
    const moves = (await owner.get(`/stock/moves?documentId=${release.id}&limit=100`)).body.items.filter((m: any) => num(m.qty) > 0);
    const received = moves.reduce((sum: number, m: any) => sum + num(m.qty) * num(m.cost), 0);
    expect(received).toBeCloseTo(260, 2);
    expect(moves.filter((m: any) => m.productId === sawdust).every((m: any) => m.cost === '20.0000')).toBe(true);
    // повторное закрытие даёт то же
    await closeMonth('2026-04');
    expect(await balance(tableProduct, fg)).toMatchObject({ avgCost: '110.0000' });
  });

  test('indirect costs are distributed on the good products and the defect by quantity, never on the waste', async () => {
    const { productId, item } = await makeProduct('Стол косвенные');
    const own = (await mk(owner, '/work-centers', { name: 'Участок косвенных', hourlyRate: 600, warehouseId: workshop, outputWarehouseId: fg, wasteWarehouseId: wasteWh, defectWarehouseId: defectWh })).id;
    const o = await mk(owner, '/production-orders', { workCenterId: own, items: [{ itemId: item, qty: '2' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const orderItemId = (await owner.get(`/production-orders/${o.id}`)).body.items[0].id;
    const rel = await owner.post(`/production-orders/${o.id}/production`, { date: '2026-06-10', lines: [{ orderItemId, qty: '2', defectQty: '1', defectMode: 'expense' }] });
    expect((await post(rel.body.id)).status).toBe(200);
    // затраты 2 × 836 = 1672, отходы 40 -> по 816
    expect(await balance(productId, fg)).toMatchObject({ avgCost: '816.0000' });
    const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, date: '2026-06-20', lines: [{ productId: service, qty: 1, price: '90', costItemId: electricity, workCenterId: own }] });
    await post(rc.id);
    const closing = await closeMonth('2026-06');
    expect(closing.totals.byRelease[0]).toMatchObject({ allocated: '90.00', directCost: '1632.00' });
    // 90 на два выпущенных = 45 на единицу и годному, и браку; отходы - только своя цена
    expect(await balance(productId, fg)).toMatchObject({ qty: '1.000', avgCost: '861.0000' });
    expect(await balance(productId, defectWh)).toMatchObject({ avgCost: '861.0000' });
    const waste = (await owner.get(`/stock/moves?documentId=${rel.body.id}&limit=100`)).body.items.find((m: any) => m.productId === sawdust);
    expect(waste.cost).toBe('20.0000');
    expect(num((await balance(productId, fg)).value) + num((await balance(productId, defectWh)).value) + 40).toBeCloseTo(1672 + 90, 2);
  });
});

describe('piecework', () => {
  test('the actual cost of the work recalculates the release but keeps the waste deduction', async () => {
    const operation = (await mk(owner, '/products', { name: 'Сборка (операция)', kind: 'operation', vatRate: 'none' })).id;
    expect((await owner.put(`/production/operations/${operation}`, { productId: operation, normHours: '1', workCenterId: center })).status).toBe(200);
    await mk(owner, '/production/operation-rates', { productId: operation, validFrom: '2026-01-01', rate: '100', unit: 'per_unit' });
    const productId = (await mk(owner, '/products', { name: 'Стол сдельный', price: 5000 })).id;
    const item = (await mk(owner, '/manufactured-items', { name: 'Стол сдельный', productId, overheadPct: 0 })).id;
    await lineOf(item, { kind: 'material', productId: wood, qty: 2 });
    await lineOf(item, { kind: 'work', operation: 'Сборка', productId: operation, workCenterId: center, hours: 1 });
    await lineOf(item, { kind: 'waste', productId: sawdust, qty: 1 });
    const members = (await owner.get('/members')).body.items;
    const memberId = members.find((m: any) => m.userId === member.user!.id).id;

    const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '4' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const detail = (await owner.get(`/production-orders/${o.id}`)).body;
    const componentId = detail.components.find((c: any) => c.kind === 'work').id;
    await owner.post(`/production-orders/${o.id}/operations`, { assignments: [{ componentId, memberId, qty: '4' }] });
    const assignment = (await owner.get(`/production-orders/${o.id}/operations`)).body.items[0];
    const res = await owner.post('/production/workbench/execute', {
      date: '2026-07-10',
      mode: 'simple',
      rows: [{ orderId: o.id, source: 'production_order', lineId: detail.items[0].id, assignments: [{ assignmentId: assignment.id, qty: '4' }] }],
    });
    expect(res.status).toBe(201);
    const releaseId = res.body.documents[0].id;
    // по норме: материалы 640 + работа 4 × 600 = 2400 - отходы 80
    expect((await owner.get(`/production-orders/${releaseId}`)).body.items[0].stageCost).toBe('2960.0000');
    expect(await balance(productId, fg)).toMatchObject({ qty: '4.000', avgCost: '740.0000' });
    // проведение наряда: работа по факту 4 × 100 -> 640 + 400 - 80 = 960
    const journal = (await owner.get('/production/piecework?from=2026-07-10&to=2026-07-10')).body;
    const doc = journal.items.find((i: any) => i.memberId === memberId);
    expect((await owner.post(`/documents/${doc.id}/post`)).status).toBe(200);
    expect((await owner.get(`/production-orders/${releaseId}`)).body.items[0].stageCost).toBe('960.0000');
    expect(await balance(productId, fg)).toMatchObject({ qty: '4.000', avgCost: '240.0000' });
    // отходы остаются по своей цене: стоимость прихода фиксирована
    expect(await balance(sawdust, wasteWh)).toMatchObject({ avgCost: '20.0000' });
  });
});

describe('access and isolation', () => {
  test('a member sees quantities but no price or amount of the waste and the defect', async () => {
    const { item } = await makeProduct('Стол маскирование');
    const { release } = await draftRelease(item, '2', '2026-08-03', { defectQty: '1', defectMode: 'expense' });
    expect((await post(release.id)).status).toBe(200);
    const view = (await member.get(`/documents/${release.id}`)).body;
    const waste = view.components.find((c: any) => c.kind === 'waste');
    expect(waste.qty).toBe('2.000');
    expect([waste.price, waste.plannedCost, waste.actualCost]).toEqual([null, null, null]);
    expect(view.items[0]).toMatchObject({ defectQty: '1.000', defectUnitCost: null, stageCost: null });
    const viaOrders = (await member.get(`/production-orders/${release.id}`)).body;
    expect(viaOrders.components.find((c: any) => c.kind === 'waste').price).toBeNull();
    // owner видит всё
    expect((await owner.get(`/documents/${release.id}`)).body.components.find((c: any) => c.kind === 'waste').price).toBe('20.0000');
  });

  test('another tenant sees neither the release nor can it change it', async () => {
    const { item } = await makeProduct('Стол чужой');
    const { release } = await draftRelease(item, '1', '2026-08-04');
    expect((await other.get(`/production-orders/${release.id}`)).status).toBe(404);
    expect((await other.patch(`/production-orders/${release.id}/accounting`, { wasteValuation: 'zero' })).status).toBe(404);
    expect((await other.post(`/production/${release.id}/write-off-defects`)).status).toBe(404);
  });

  test('a closed period blocks posting and unposting a release with waste', async () => {
    const { item } = await makeProduct('Стол закрытый период');
    const { release } = await draftRelease(item, '1', '2026-08-05');
    expect((await post(release.id)).status).toBe(200);
    expect((await owner.patch('/production/periods/settings', { closedThrough: '2026-08-31', closeMovesLock: false })).status).toBe(200);
    const late = await draftRelease((await makeProduct('Стол в закрытом периоде')).item, '1', '2026-08-06');
    const blocked = await post(late.release.id);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('period_closed');
    const unposted = await unpost(release.id);
    expect(unposted.status).toBe(422);
    expect(unposted.body.error.code).toBe('period_closed');
    expect((await owner.patch('/production/periods/settings', { closedThrough: null })).status).toBe(200);
    expect((await unpost(release.id)).status).toBe(200);
  });
});
