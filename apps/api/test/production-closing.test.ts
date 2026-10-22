/* Этап 6 «УНФ: Производство»: косвенные затраты и закрытие периода.
   Проверяем главное — закрытие даёт себестоимость «до копейки» по ручному расчёту (пример УНФ: 100 косвенных на выпуск
   1 шт. и выпуск 2 шт. — по прямым затратам 33,33 / 66,67), порядок «свой участок → общий выпуск → нераспределено»,
   корректировку проданной части, цепочку «полуфабрикат → изделие», идемпотентность, отмену, закрытие «за период»,
   дату запрета, изоляцию арендаторов и маскирование сумм. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin, drainJobs } from './helpers';

let owner: Client;
let adminUser: Client;
let member: Client;
let other: Client;
let wood: string; // материал
let service: string; // услуга (источник косвенных затрат)
let supplier: string;
let customer: string;
let main: string; // склад материалов
let workshop: string; // склад цеха (с него списывает выпуск)
let fg: string; // склад готовой продукции
let center: string; // участок
let electricity: string; // статья «Электричество» (по объёму выпуска)
let rent: string; // статья «Аренда» (не распределять)

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

/** Прогон очереди задач: закрытие периода выполняет воркер */
const runWorker = () => drainJobs();

/* ---------------- наборы месяцев: тесты независимы по месяцам ---------------- */
const M = { feb: '2026-02', apr: '2026-04', may: '2026-05', jun: '2026-06', jul: '2026-07', aug: '2026-08', sep: '2026-09', oct: '2026-10', nov: '2026-11', dec: '2026-12' };

/* ---------------- помощники предметной области ---------------- */

/** Товар каталога под изделие: свои товары у каждого теста, чтобы средняя склада не смешивалась */
const makeProduct = (name: string) => mk(owner, '/products', { name, price: 5000, vatRate: 'none' });

/** Изделие: `qty` брусов на партию из одной единицы, без работ и накладных */
async function makeItem(name: string, qty: string, productId?: string) {
  const product = productId ?? (await makeProduct(name)).id;
  const item = (await mk(owner, '/manufactured-items', { name, productId: product, overheadPct: 0 })).id;
  await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty });
  return item;
}

/** Материалы на склад цеха: поступление по 80 и перемещение на склад участка */
async function stockWorkshop(qty: string, month: string, price = '80') {
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: main, date: `${month}-02`, lines: [{ productId: wood, qty, price }] });
  await owner.post(`/documents/${rc.id}/post`);
  const mv = await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: main, targetWarehouseId: workshop, date: `${month}-03`, lines: [{ productId: wood, qty, price: 0 }] });
  await owner.post(`/documents/${mv.id}/post`);
}

/** Поступление услуги со статьёй и участком — источник косвенных затрат месяца */
async function receiptService(amount: string, month: string, costItemId: string, workCenterId: string | null = center) {
  const doc = await mk(owner, '/documents', {
    type: 'receipt',
    counterpartyId: supplier,
    warehouseId: main,
    date: `${month}-20`,
    lines: [{ productId: service, qty: 1, price: amount, costItemId, workCenterId }],
  });
  await owner.post(`/documents/${doc.id}/post`);
  return doc;
}

/** Заказ на производство и выпуск: материалы списываются со склада цеха */
async function release(itemId: string, qty: string, month: string, centerId: string = center, day = 12) {
  await stockWorkshop('100', month);
  const order = await mk(owner, '/production-orders', { workCenterId: centerId, items: [{ itemId, qty }], date: `${month}-10` });
  await owner.post(`/production-orders/${order.id}/fill-from-bom`);
  await owner.post(`/documents/${order.id}/post`);
  const detail = (await owner.get(`/production-orders/${order.id}`)).body;
  // один документ выпуска на участок и день: два выпуска в один день слились бы в один документ
  const rel = await owner.post(`/production-orders/${order.id}/production`, { date: `${month}-${day}`, lines: [{ orderItemId: detail.items[0].id, qty }] });
  if (rel.status >= 300) throw new Error(`release failed: ${rel.status} ${JSON.stringify(rel.body)}`);
  await owner.post(`/documents/${rel.body.id}/post`);
  return rel.body as any;
}

/** Средняя себестоимость товара на складе */
async function avg(productId: string, warehouseId: string): Promise<string> {
  const rows = (await owner.get(`/stock/balances?productId=${productId}`)).body.items.filter((b: any) => b.warehouseId === warehouseId);
  return rows[0]?.avgCost ?? '0';
}

/** Себестоимость движения документа (с учётом корректировок закрытия) */
async function moveCost(documentId: string): Promise<string> {
  const rows = (await owner.get(`/stock/moves?documentId=${documentId}&limit=100`)).body.items.filter((m: any) => m.documentId === documentId);
  return rows[0]?.cost ?? '0';
}

/** Себестоимость прихода товара документом (у выпуска и перемещения есть и расходные движения) */
async function inMoveCost(documentId: string, productId: string): Promise<string> {
  const rows = (await owner.get(`/stock/moves?documentId=${documentId}&limit=100`)).body.items.filter((m: any) => m.documentId === documentId && m.productId === productId && Number(m.qty) > 0);
  return rows[rows.length - 1]?.cost ?? '0';
}

/** Результат закрытия месяца */
const closingOf = async (month: string) => (await owner.get('/production/periods')).body.items.find((c: any) => c.month === month);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Closing WS' });
  const invite = async (role: string, name: string) => {
    const c = new Client();
    await c.signup();
    const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: c.user!.email, role });
    await c.post('/invites/accept', { token: inv.body.token });
    c.workspaceId = owner.workspaceId;
    c.user!.name = name;
    return c;
  };
  adminUser = await invite('admin', 'Admin');
  member = await invite('member', 'Member');
  other = new Client();
  await other.signup({ workspaceName: 'Other closing WS' });

  wood = (await mk(owner, '/products', { name: 'Брус', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
  service = (await mk(owner, '/products', { name: 'Электричество (услуга)', kind: 'service', price: 0, vatRate: 'none' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Энергосбыт»' })).id;
  customer = (await mk(owner, '/companies', { name: 'Покупатель' })).id;
  main = (await owner.get('/warehouses')).body.items[0].id;
  workshop = (await mk(owner, '/warehouses', { name: 'Склад цеха', kind: 'workshop' })).id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выпуска' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Столярный цех', hourlyRate: 600, warehouseId: workshop, outputWarehouseId: fg })).id;

  electricity = (await mk(owner, '/cost-items', { name: 'Электричество', kind: 'expense', distributionMethod: 'output_qty' })).id;
  rent = (await mk(owner, '/cost-items', { name: 'Аренда', kind: 'expense', distributionMethod: 'none' })).id;
  await stockWorkshop('1000', M.feb);
});

describe('indirect costs of documents', () => {
  test('a service line of a receipt with a cost item becomes an indirect cost of the month', async () => {
    expect((await owner.get(`/production/periods/${M.apr}/preview`)).body.total).toBe('0.00');
    await receiptService('300', M.apr, electricity);
    const preview = await owner.get(`/production/periods/${M.apr}/preview`);
    expect(preview.body.total).toBe('300.00');
    expect(preview.body.costs[0]).toMatchObject({ name: 'Электричество', method: 'output_qty', amount: '300.00', workCenterId: center, workCenterName: 'Столярный цех' });
    expect(preview.body.issues.map((i: any) => i.kind)).toContain('no_release');
  });

  test('unposting the receipt clears its indirect costs, posting it again restores them', async () => {
    const doc = await receiptService('50', M.apr, electricity);
    expect((await owner.get(`/production/periods/${M.apr}/preview`)).body.total).toBe('350.00');
    expect((await owner.post(`/documents/${doc.id}/unpost`)).status).toBe(200);
    expect((await owner.get(`/production/periods/${M.apr}/preview`)).body.total).toBe('300.00');
    await owner.post(`/documents/${doc.id}/post`);
    expect((await owner.get(`/production/periods/${M.apr}/preview`)).body.total).toBe('350.00');
  });

  test('a goods line cannot carry a cost item', async () => {
    const doc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: main, date: `${M.apr}-21`, lines: [{ productId: wood, qty: 1, price: 10, costItemId: electricity }] });
    const posted = await owner.post(`/documents/${doc.id}/post`);
    expect(posted.status).toBe(422);
    expect(posted.body.error.code).toBe('cost_item_service_only');
  });

  test('a write-off to a work center with a cost item becomes indirect costs of that work center', async () => {
    await stockWorkshop('20', M.apr);
    const doc = await mk(owner, '/documents', { type: 'write_off', warehouseId: workshop, costItemId: electricity, workCenterId: center, date: `${M.apr}-25`, lines: [{ productId: wood, qty: 1, price: 0 }] });
    expect((await owner.post(`/documents/${doc.id}/post`)).status).toBe(200);
    const line = (await owner.get(`/production/periods/${M.apr}/preview`)).body.costs.find((c: any) => c.name === 'Электричество');
    // 300 (услуга) + 50 (повторное проведение) + себестоимость списания 1 бруса по 80
    expect(line.amount).toBe('430.00');
  });

  test('other costs: a document with cost items, work centers, amounts and the usual numbering', async () => {
    const doc = await mk(owner, '/other-costs', {
      date: `${M.may}-05`,
      comment: 'Затраты за май',
      lines: [
        { costItemId: rent, workCenterId: center, amount: '1000', comment: 'Аренда цеха' },
        { costItemId: electricity, amount: '20', comment: 'Обслуживание' },
      ],
    });
    expect(doc.type).toBe('other_costs');
    expect(doc.status).toBe('draft');
    expect(doc.number).toBeNull();
    expect(doc.total).toBe('1020.00');
    expect(doc.lines.map((l: any) => [l.costItemName, l.workCenterName, l.amount, l.comment])).toEqual([
      ['Аренда', 'Столярный цех', '1000.00', 'Аренда цеха'],
      ['Электричество', null, '20.00', 'Обслуживание'],
    ]);
    const posted = await owner.post(`/other-costs/${doc.id}/post`);
    expect(posted.status).toBe(200);
    expect(posted.body.number).toMatch(/^ПЗ-2026-\d{5}$/);
    expect((await owner.get(`/production/periods/${M.may}/preview`)).body.total).toBe('1020.00');
    // отмена проведения убирает затраты из месяца
    expect((await owner.post(`/other-costs/${doc.id}/unpost`)).status).toBe(200);
    expect((await owner.get(`/production/periods/${M.may}/preview`)).body.total).toBe('0.00');
    await owner.post(`/other-costs/${doc.id}/post`);
  });

  test('other costs are created by their own service, not by the generic documents endpoint', async () => {
    const res = await owner.post('/documents', { type: 'other_costs', date: `${M.may}-05`, lines: [{ productId: wood, qty: 1, price: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('production_api_only');
  });

  test('other costs: lines are validated, member may create, amounts are masked for member', async () => {
    expect((await owner.post('/other-costs', { date: `${M.may}-05`, lines: [{ costItemId: rent, amount: '0' }] })).status).toBe(400);
    expect((await owner.post('/other-costs', { date: `${M.may}-05`, lines: [] })).status).toBe(400);
    const wrongKind = await owner.post('/other-costs', { date: `${M.may}-05`, lines: [{ costItemId: (await mk(owner, '/cost-items', { name: 'Излишки 2', kind: 'income' })).id, amount: '10' }] });
    expect(wrongKind.status).toBe(422);
    expect(wrongKind.body.error.code).toBe('cost_item_kind_mismatch');

    const asMember = await member.post('/other-costs', { date: `${M.may}-06`, lines: [{ costItemId: rent, amount: '10' }] });
    expect(asMember.status).toBe(201);
    const forMember = await member.get(`/other-costs/${asMember.body.id}`);
    expect(forMember.body.total).toBeNull();
    expect(forMember.body.lines[0].amount).toBeNull();
    expect((await owner.get(`/other-costs/${asMember.body.id}`)).body.total).toBe('10.00');
    expect((await member.get('/other-costs')).body.amount).toBeNull();
    await owner.del(`/other-costs/${asMember.body.id}`);
  });
});

describe('closing a period', () => {
  test('100 indirect costs on two releases of one piece each: 50/50 by output quantity', async () => {
    const item = await makeItem('Тумба', '2');
    await receiptService('100', M.jun, electricity);
    const a = await release(item, '1', M.jun);
    const b = await release(item, '1', M.jun);
    expect(await avg((await owner.get(`/manufactured-items/${item}`)).body.productId, fg)).toBe('160.0000');

    const job = await owner.post(`/production/periods/${M.jun}/close`);
    expect(job.status).toBe(202);
    expect((await closingOf(M.jun)).status).toBe('running');
    await runWorker();

    const closing = await closingOf(M.jun);
    expect(closing.status).toBe('done');
    expect(closing.totals.total).toBe('100.00');
    expect(closing.totals.undistributed).toBe('0.00');
    expect(closing.totals.byCostItem).toEqual([expect.objectContaining({ costItemName: 'Электричество', amount: '100.00', distributed: '100.00', scope: 'work_center' })]);
    expect(closing.totals.byRelease).toHaveLength(2);
    // себестоимость «до копейки» по ручному расчёту: прямые 160 + 50 косвенных
    expect(await moveCost(a.id)).toBe('210.0000');
    expect(await moveCost(b.id)).toBe('210.0000');
  });

  test('by direct costs: 33,33 / 66,67 (example of 1C:UNF)', async () => {
    const directItem = (await mk(owner, '/cost-items', { name: 'Обслуживание оборудования', distributionMethod: 'direct_costs' })).id;
    const product = await makeProduct('Шкаф');
    const item = await makeItem('Шкаф', '1', product.id);
    await receiptService('100', M.jul, directItem);
    const one = await release(item, '1', M.jul, center, 12);
    const two = await release(item, '2', M.jul, center, 13);

    await owner.post(`/production/periods/${M.jul}/close`);
    await runWorker();
    const closing = await closingOf(M.jul);
    expect(closing.totals.byRelease.map((r: any) => [r.directCost, r.allocated])).toEqual([
      ['80.00', '33.33'],
      ['160.00', '66.67'],
    ]);
    // прямые затраты 80 на единицу: 80 + 33,33 и 80 + 33,335 — сумма распределённого 100
    expect(await moveCost(one.id)).toBe('113.3333');
    expect(await moveCost(two.id)).toBe('113.3333');
  });

  test('by work hours: the share follows the hours of the release', async () => {
    const hoursItem = (await mk(owner, '/cost-items', { name: 'Электроэнергия по часам', distributionMethod: 'work_hours' })).id;
    const product = await makeProduct('Полка');
    const item = (await mk(owner, '/manufactured-items', { name: 'Полка', productId: product.id, overheadPct: 0 })).id;
    await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'material', productId: wood, qty: 1 });
    await mk(owner, `/manufactured-items/${item}/lines`, { kind: 'work', operation: 'Сборка', workCenterId: center, hours: 1, rate: 10 });
    await receiptService('30', M.aug, hoursItem);
    await release(item, '1', M.aug, center, 12);
    await release(item, '1', M.aug, center, 13);

    await owner.post(`/production/periods/${M.aug}/close`);
    await runWorker();
    const closing = await closingOf(M.aug);
    expect(closing.totals.byRelease.map((r: any) => [r.workHours, r.directCost, r.allocated])).toEqual([
      ['1.000', '90.00', '15.00'],
      ['1.000', '90.00', '15.00'],
    ]);
    expect(closing.totals.undistributed).toBe('0.00');
  });

  test('costs of a work center without releases of its own go to all releases with a warning', async () => {
    const painter = (await mk(owner, '/work-centers', { name: 'Малярный участок' })).id;
    const product = await makeProduct('Шкаф 3');
    const item = await makeItem('Шкаф 3', '1', product.id);
    await receiptService('60', M.sep, electricity, painter);
    const rel = await release(item, '1', M.sep);

    await owner.post(`/production/periods/${M.sep}/close`);
    await runWorker();
    const closing = await closingOf(M.sep);
    expect(closing.totals.byCostItem[0]).toMatchObject({ workCenterName: 'Малярный участок', distributed: '60.00', scope: 'common' });
    expect(closing.totals.warnings.join(' ')).toContain('Малярный участок');
    expect(closing.totals.undistributed).toBe('0.00');
    expect(await moveCost(rel.id)).toBe('140.0000');
  });

  test('a month without releases keeps the costs undistributed and warns', async () => {
    await receiptService('70', M.oct, electricity, null);
    await owner.post(`/production/periods/${M.oct}/close`);
    await runWorker();
    const closing = await closingOf(M.oct);
    expect(closing.status).toBe('done');
    expect(closing.totals.undistributed).toBe('70.00');
    expect(closing.totals.byCostItem[0]).toMatchObject({ amount: '70.00', distributed: '0.00' });
    expect(closing.totals.warnings.join(' ')).toContain('there are no releases this month');
    expect(closing.totals.byRelease).toEqual([]);
  });

  test('an item marked "do not allocate" stays undistributed', async () => {
    const product = await makeProduct('Скамья');
    const item = await makeItem('Скамья', '1', product.id);
    await receiptService('500', M.nov, rent);
    const rel = await release(item, '1', M.nov);

    await owner.post(`/production/periods/${M.nov}/close`);
    await runWorker();
    const closing = await closingOf(M.nov);
    expect(closing.totals.undistributed).toBe('500.00');
    expect(closing.totals.warnings.join(' ')).toContain('not allocated');
    // себестоимость выпуска не изменилась
    expect(await moveCost(rel.id)).toBe('80.0000');
    expect(await avg(product.id, fg)).toBe('80.0000');
  });

  test('repeat close is idempotent: the same allocation and the same cost', async () => {
    const product = await makeProduct('Комод');
    const item = await makeItem('Комод', '1', product.id);
    await receiptService('100', M.dec, electricity);
    const rel = await release(item, '1', M.dec);

    await owner.post(`/production/periods/${M.dec}/close`);
    await runWorker();
    const first = await closingOf(M.dec);
    const costFirst = await moveCost(rel.id);
    expect(costFirst).toBe('180.0000');

    await owner.post(`/production/periods/${M.dec}/close`);
    await runWorker();
    const second = await closingOf(M.dec);
    expect(second.id).toBe(first.id);
    const { runAt: _runAt, ...rest } = second.totals;
    const { runAt: _firstRunAt, ...firstRest } = first.totals;
    expect(rest).toEqual(firstRest);
    expect(second.totals.byRelease[0].allocated).toBe('100.00');
    expect(await moveCost(rel.id)).toBe(costFirst);
  });

  test('cancelling the close returns the previous values', async () => {
    const product = await makeProduct('Пенал');
    const item = await makeItem('Пенал', '1', product.id);
    await receiptService('100', '2027-01', electricity);
    const rel = await release(item, '1', '2027-01');
    expect(await avg(product.id, fg)).toBe('80.0000');

    await owner.post('/production/periods/2027-01/close');
    await runWorker();
    expect(await avg(product.id, fg)).toBe('180.0000');
    expect(await moveCost(rel.id)).toBe('180.0000');

    expect((await owner.post('/production/periods/2027-01/reopen')).status).toBe(202);
    await runWorker();
    expect((await closingOf('2027-01')).status).toBe('reopened');
    expect(await avg(product.id, fg)).toBe('80.0000');
    expect(await moveCost(rel.id)).toBe('80.0000');
  });

  test('the sold part of the release gets its cost of sales raised', async () => {
    const product = await makeProduct('Кресло');
    const item = await makeItem('Кресло', '2', product.id);
    const rel = await release(item, '4', '2027-02');
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: fg, date: '2027-02-05', lines: [{ productId: product.id, qty: 1, price: 5000 }] });
    await owner.post(`/documents/${order.id}/post`);
    const shipment = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, warehouseId: fg, date: '2027-02-06', basedOnId: order.id, lines: [{ productId: product.id, qty: 1, price: 5000 }] });
    expect((await owner.post(`/documents/${shipment.id}/post`)).status).toBe(200);
    expect(await moveCost(rel.id)).toBe('160.0000');
    expect(await moveCost(shipment.id)).toBe('160.0000');

    // косвенные 40 на 4 шт. — по 10 на единицу: остаток дорожает, проданная часть увеличивает себестоимость продаж
    await receiptService('40', '2027-02', electricity);
    await owner.post('/production/periods/2027-02/close');
    await runWorker();
    expect(await moveCost(rel.id)).toBe('170.0000');
    expect(await moveCost(shipment.id)).toBe('170.0000');
    expect(await avg(product.id, fg)).toBe('170.0000');
    const closing = await closingOf('2027-02');
    expect(closing.totals.byRelease[0]).toMatchObject({ allocated: '40.00', qty: '4.000' });
  });

  test('the chain semi-finished → product: the closing raises both links', async () => {
    const semiProduct = await makeProduct('Доска');
    const semi = await makeItem('Доска (полуфабрикат)', '1', semiProduct.id);
    const finalProduct = await makeProduct('Стол из доски');
    const final = (await mk(owner, '/manufactured-items', { name: 'Стол из доски', productId: finalProduct.id, overheadPct: 0 })).id;
    await mk(owner, `/manufactured-items/${final}/lines`, { kind: 'semi', childItemId: semi, qty: 1, semiMode: 'stock' });

    const semiRel = await release(semi, '1', '2027-03', center, 11);
    // полуфабрикат со склада выпуска переносим на склад цеха, чтобы изделие списало его
    const mv = await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: fg, targetWarehouseId: workshop, date: '2027-03-13', lines: [{ productId: semiProduct.id, qty: 1, price: 0 }] });
    await owner.post(`/documents/${mv.id}/post`);
    const finalRel = await release(final, '1', '2027-03');

    await receiptService('60', '2027-03', electricity);
    await owner.post('/production/periods/2027-03/close');
    await runWorker();
    const closing = await closingOf('2027-03');
    expect(closing.totals.byRelease.map((r: any) => r.allocated)).toEqual(['30.00', '30.00']);
    // полуфабрикат: 80 материала + 30 косвенных; перемещение уносит его по 110, изделие списывает 110 и получает свои 30
    expect(await inMoveCost(semiRel.id, semiProduct.id)).toBe('110.0000');
    expect(await inMoveCost(mv.id, semiProduct.id)).toBe('110.0000');
    expect(await inMoveCost(finalRel.id, finalProduct.id)).toBe('140.0000');
    // сохранение суммы: все 60 распределённых сидят в стоимости изделия (80 → 140), ничего не потерялось по дороге
    expect(await avg(finalProduct.id, fg)).toBe('140.0000');
  });

  test('closing a period covers its months in order, cancelling covers them in reverse', async () => {
    const product = await makeProduct('Тумба 2');
    const item = await makeItem('Тумба 2', '1', product.id);
    await receiptService('10', '2027-04', electricity);
    await release(item, '1', '2027-04');
    await receiptService('20', '2027-05', electricity);
    await release(item, '1', '2027-05');

    const queued = await owner.post('/production/periods/2027-04/close', { through: '2027-05' });
    expect(queued.status).toBe(202);
    expect(queued.body.months).toEqual(['2027-04', '2027-05']);
    await runWorker();
    expect((await closingOf('2027-04')).status).toBe('done');
    expect((await closingOf('2027-05')).status).toBe('done');

    const reopened = await owner.post('/production/periods/2027-04/reopen', { through: '2027-05' });
    expect(reopened.body.months).toEqual(['2027-04', '2027-05']);
    await runWorker();
    expect((await closingOf('2027-04')).status).toBe('reopened');
    expect((await closingOf('2027-05')).status).toBe('reopened');
  });

  test('closing is admin+, cancelling and moving the lock date back is owner-only', async () => {
    expect((await member.post(`/production/periods/${M.feb}/close`)).status).toBe(403);
    expect((await adminUser.post(`/production/periods/${M.feb}/close`)).status).toBe(202);
    await runWorker();
    expect((await adminUser.post(`/production/periods/${M.feb}/reopen`)).status).toBe(403);
  });

  test('two closes of the same period do not run at the same time and do not double the cost', async () => {
    const product = await makeProduct('Скамья 2');
    const item = await makeItem('Скамья 2', '1', product.id);
    await receiptService('100', '2027-06', electricity);
    const rel = await release(item, '1', '2027-06');

    await owner.post('/production/periods/2027-06/close');
    await owner.post('/production/periods/2027-06/close');
    await runWorker();
    const closing = await closingOf('2027-06');
    expect(closing.status).toBe('done');
    expect(closing.totals.byRelease[0].allocated).toBe('100.00');
    expect(await moveCost(rel.id)).toBe('180.0000');
  });

  test('closing does not touch documents of other months', async () => {
    const product = await makeProduct('Скамья 3');
    const item = await makeItem('Скамья 3', '1', product.id);
    await receiptService('100', '2027-07', electricity);
    const july = await release(item, '1', '2027-07');
    const julyCost = await moveCost(july.id);

    await receiptService('100', '2027-08', electricity);
    await owner.post('/production/periods/2027-08/close');
    await runWorker();
    const closing = await closingOf('2027-08');
    expect(closing.totals.byRelease).toEqual([]);
    expect(closing.totals.undistributed).toBe('100.00');
    expect(await moveCost(july.id)).toBe(julyCost);
    expect(julyCost).toBe('80.0000');
  });
});

describe('closed periods', () => {
  beforeAll(async () => {
    await owner.patch('/production/periods/settings', { closedThrough: `${M.sep}-30`, closeMovesLock: false });
  });

  test('posting documents of a closed period is forbidden', async () => {
    const doc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: main, date: `${M.sep}-15`, lines: [{ productId: wood, qty: 1, price: 10 }] });
    const posted = await owner.post(`/documents/${doc.id}/post`);
    expect(posted.status).toBe(422);
    expect(posted.body.error.code).toBe('period_closed');
    // складской документ закрытого периода — тоже
    const transfer = await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: main, targetWarehouseId: workshop, date: `${M.sep}-16`, lines: [{ productId: wood, qty: 1, price: 0 }] });
    expect((await owner.post(`/documents/${transfer.id}/post`)).body.error.code).toBe('period_closed');
  });

  test('a document posted before the lock cannot be unposted or its date moved into the closed period', async () => {
    const doc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: main, date: '2027-10-05', lines: [{ productId: wood, qty: 1, price: 10 }] });
    await owner.post(`/documents/${doc.id}/post`);
    expect((await owner.patch('/production/periods/settings', { closedThrough: '2027-10-31' })).status).toBe(200);
    const unposted = await owner.post(`/documents/${doc.id}/unpost`);
    expect(unposted.status).toBe(422);
    expect(unposted.body.error.code).toBe('period_closed');
    await owner.patch('/production/periods/settings', { closedThrough: '2027-09-30' });
  });

  test('a release of a closed period is refused as any other document', async () => {
    const product = await makeProduct('Скамья 4');
    const item = await makeItem('Скамья 4', '1', product.id);
    // заказ на производство закрытого месяца не проводится — значит не проведётся и выпуск по нему
    const order = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty: '1' }], date: `${M.sep}-10` });
    await owner.post(`/production-orders/${order.id}/fill-from-bom`);
    const posted = await owner.post(`/documents/${order.id}/post`);
    expect(posted.status).toBe(422);
    expect(posted.body.error.code).toBe('period_closed');
  });

  test('the closed-through date moves forward for admin and only the owner may move it back', async () => {
    expect((await adminUser.patch('/production/periods/settings', { closedThrough: '2027-12-31' })).status).toBe(200);
    expect((await adminUser.get('/production/periods')).body.closedThrough).toBe('2027-12-31');
    const back = await adminUser.patch('/production/periods/settings', { closedThrough: '2027-10-31' });
    expect(back.status).toBe(403);
    expect(back.body.error.code).toBe('owner_required');
    const forward = await owner.patch('/production/periods/settings', { closedThrough: '2028-01-31' });
    expect(forward.status).toBe(200);
    const ownerBack = await owner.patch('/production/periods/settings', { closedThrough: '2027-10-31' });
    expect(ownerBack.status).toBe(200);
    expect(ownerBack.body.closedThrough).toBe('2027-10-31');
    // участнику настройка недоступна вовсе
    expect((await member.patch('/production/periods/settings', { closedThrough: '2028-01-31' })).status).toBe(403);
  });

  test('the setting "move the closed-through date on close" shifts it to the end of the closed month', async () => {
    await owner.patch('/production/periods/settings', { closedThrough: null, closeMovesLock: true });
    const product = await makeProduct('Скамья 5');
    const item = await makeItem('Скамья 5', '1', product.id);
    await receiptService('10', '2028-02', electricity);
    await release(item, '1', '2028-02');

    await owner.post('/production/periods/2028-02/close');
    await runWorker();
    const lock = await owner.get('/production/periods');
    expect(lock.body.closeMovesLock).toBe(true);
    expect(lock.body.closedThrough).toBe('2028-02-29');
    // закрытый месяц больше не редактируется
    const late = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: main, date: '2028-02-10', lines: [{ productId: wood, qty: 1, price: 10 }] });
    expect((await owner.post(`/documents/${late.id}/post`)).body.error.code).toBe('period_closed');

    // открытие месяца сбрасывает закрытие; дату запрета двигает назад только owner
    await owner.post('/production/periods/2028-02/reopen');
    await runWorker();
    expect((await closingOf('2028-02')).status).toBe('reopened');
    expect((await owner.patch('/production/periods/settings', { closedThrough: '2027-12-31' })).status).toBe(200);
    await owner.patch('/production/periods/settings', { closeMovesLock: false });
  });
});

describe('preview and visibility', () => {
  test('the preview lists unposted documents of the month and negative stock with links', async () => {
    await owner.patch('/production/periods/settings', { closedThrough: null });
    // отрицательный остаток воркспейса (в обычной работе его не допускает проведение расхода)
    const [saved] = await admin`select qty from stock_balances where workspace_id = ${owner.workspaceId} and warehouse_id = ${workshop} and product_id = ${wood}`;
    await admin`update stock_balances set qty = -3 where workspace_id = ${owner.workspaceId} and warehouse_id = ${workshop} and product_id = ${wood}`;
    const draft = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: main, date: `${M.may}-28`, lines: [{ productId: wood, qty: 1, price: 10 }] });
    const preview = await owner.get(`/production/periods/${M.may}/preview`);
    const unposted = preview.body.issues.find((i: any) => i.kind === 'unposted');
    expect(unposted.links.map((l: any) => l.documentId)).toContain(draft.id);
    expect(unposted.links[0]).toHaveProperty('date');
    const negative = preview.body.issues.find((i: any) => i.kind === 'negative_stock');
    expect(negative).toBeDefined();
    expect(negative.links[0]).toHaveProperty('productId');
    expect(negative.links[0].name).toContain('Брус');
    // остаток возвращаем прежним (по движениям), чтобы не ломать среднюю последующих тестов
    await admin`update stock_balances set qty = ${saved!.qty} where workspace_id = ${owner.workspaceId} and warehouse_id = ${workshop} and product_id = ${wood}`;
  });

  test('a member sees the structure of the closing but not its amounts', async () => {
    const closing = (await member.get('/production/periods')).body.items.find((c: any) => c.month === M.jun);
    expect(closing.totals.byCostItem[0].costItemName).toBe('Электричество');
    expect(closing.totals.byCostItem[0].amount).toBeNull();
    expect(closing.totals.byRelease[0].allocated).toBeNull();
    expect(closing.totals.total).toBeNull();
    expect(closing.totals.undistributed).toBeNull();
    const preview = await member.get(`/production/periods/${M.jun}/preview`);
    expect(preview.body.costs[0].name).toBe('Электричество');
    expect(preview.body.costs[0].amount).toBeNull();
    expect(preview.body.total).toBeNull();
  });

  test('another workspace closes only its own period and sees no documents of this one', async () => {
    const otherWood = (await mk(other, '/products', { name: 'Брус', purchasePrice: 80, vatRate: 'none' })).id;
    const otherTable = (await mk(other, '/products', { name: 'Стол', vatRate: 'none' })).id;
    const otherSupplier = (await mk(other, '/companies', { name: 'Поставщик' })).id;
    const otherWh = (await other.get('/warehouses')).body.items[0].id;
    const otherWorkshop = (await mk(other, '/warehouses', { name: 'Цех', kind: 'workshop' })).id;
    const otherFg = (await mk(other, '/warehouses', { name: 'Готовая' })).id;
    const otherCenter = (await mk(other, '/work-centers', { name: 'Цех', hourlyRate: 600, warehouseId: otherWorkshop, outputWarehouseId: otherFg })).id;
    const otherItem = (await mk(other, '/manufactured-items', { name: 'Стол', productId: otherTable, overheadPct: 0 })).id;
    await mk(other, `/manufactured-items/${otherItem}/lines`, { kind: 'material', productId: otherWood, qty: 2 });
    const rc = await mk(other, '/documents', { type: 'receipt', counterpartyId: otherSupplier, warehouseId: otherWh, date: '2029-01-02', lines: [{ productId: otherWood, qty: 10, price: 80 }] });
    await other.post(`/documents/${rc.id}/post`);
    const mv = await mk(other, '/documents', { type: 'stock_transfer', warehouseId: otherWh, targetWarehouseId: otherWorkshop, date: '2029-01-03', lines: [{ productId: otherWood, qty: 10, price: 0 }] });
    await other.post(`/documents/${mv.id}/post`);
    const order = await mk(other, '/production-orders', { workCenterId: otherCenter, items: [{ itemId: otherItem, qty: '1' }], date: '2029-01-10' });
    await other.post(`/production-orders/${order.id}/fill-from-bom`);
    await other.post(`/documents/${order.id}/post`);
    const detail = (await other.get(`/production-orders/${order.id}`)).body;
    const rel = await other.post(`/production-orders/${order.id}/production`, { date: '2029-01-12', lines: [{ orderItemId: detail.items[0].id, qty: '1' }] });
    await other.post(`/documents/${rel.body.id}/post`);

    expect((await other.post('/production/periods/2029-01/close')).status).toBe(202);
    await runWorker();
    const closing = (await other.get('/production/periods')).body.items.find((c: any) => c.month === '2029-01');
    expect(closing.status).toBe('done');
    expect(closing.totals.total).toBe('0.00'); // косвенных затрат у чужого воркспейса нет
    // закрытие этого воркспейса не появилось у нас, а наш месяц — у него
    expect((await owner.get('/production/periods')).body.items.some((c: any) => c.month === '2029-01')).toBe(false);
    expect((await other.get('/other-costs')).body.items).toEqual([]);
  });
});

describe('review fixes (stage 6)', () => {
  test('a sale posted and unposted after the close keeps the allocated cost in the average', async () => {
    const product = await makeProduct('Буфет');
    const item = await makeItem('Буфет', '2', product.id);
    await release(item, '4', '2028-03');
    // средняя материала зависит от предыдущих тестов: сверяем прибавку, а не абсолютную цену
    const before = Number(await avg(product.id, fg));
    await receiptService('40', '2028-03', electricity);
    await owner.post('/production/periods/2028-03/close');
    await runWorker();
    const closed = await avg(product.id, fg);
    expect(Number(closed) - before).toBeCloseTo(10, 4); // 40 косвенных на 4 шт.

    const sale = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, warehouseId: fg, date: '2028-04-05', lines: [{ productId: product.id, qty: 1, price: 5000 }] });
    expect((await owner.post(`/documents/${sale.id}/post`)).status).toBe(200);
    expect(await moveCost(sale.id)).toBe(closed);
    expect((await owner.post(`/documents/${sale.id}/unpost`)).status).toBe(200);
    expect(await avg(product.id, fg)).toBe(closed);
  });

  test('a sale from another warehouse after a transfer carries the allocated cost', async () => {
    const shop = (await mk(owner, '/warehouses', { name: 'Магазин' })).id;
    const product = await makeProduct('Полка');
    const item = await makeItem('Полка', '1', product.id);
    await release(item, '2', '2028-05');
    const mv = await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: fg, targetWarehouseId: shop, date: '2028-05-14', lines: [{ productId: product.id, qty: 2, price: 0 }] });
    await owner.post(`/documents/${mv.id}/post`);
    const sale = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, warehouseId: shop, date: '2028-05-15', lines: [{ productId: product.id, qty: 1, price: 5000 }] });
    await owner.post(`/documents/${sale.id}/post`);
    const before = Number(await moveCost(sale.id));
    await receiptService('20', '2028-05', electricity);
    await owner.post('/production/periods/2028-05/close');
    await runWorker();
    // 20 косвенных на 2 шт.: по 10 на единицу доходят и до магазина, и до проданной там единицы
    const unit = (before + 10).toFixed(4);
    expect(await inMoveCost(mv.id, product.id)).toBe(unit);
    expect(await moveCost(sale.id)).toBe(unit);
    expect(await avg(product.id, shop)).toBe(unit);
  });

  test('a month cannot be reopened while a later month stays closed', async () => {
    const product = await makeProduct('Табурет 3');
    const item = await makeItem('Табурет 3', '1', product.id);
    await release(item, '1', '2028-06');
    await release(item, '1', '2028-07');
    await owner.post('/production/periods/2028-06/close', { through: '2028-07' });
    await runWorker();
    const r = await owner.post('/production/periods/2028-06/reopen');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('later_month_closed');
  });

  test('closing an earlier month re-closes the later closed months after it', async () => {
    const product = await makeProduct('Табурет 4');
    const item = await makeItem('Табурет 4', '1', product.id);
    await release(item, '1', '2028-09');
    await release(item, '1', '2028-10');
    await owner.post('/production/periods/2028-10/close');
    await runWorker();
    const r = await owner.post('/production/periods/2028-09/close');
    expect(r.status).toBe(202);
    expect(r.body.months[0]).toBe('2028-09');
    expect(r.body.months).toContain('2028-10');
  });

  test('after a close, parallel posting and unposting on other pairs keep balances equal to the moves', async () => {
    const a = (await mk(owner, '/products', { name: 'Параллель А', price: 100, purchasePrice: 50, vatRate: 'none' })).id;
    const b = (await mk(owner, '/products', { name: 'Параллель Б', price: 100, purchasePrice: 50, vatRate: 'none' })).id;
    for (let i = 0; i < 4; i++) {
      const ra = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: main, date: '2029-02-02', lines: [{ productId: a, qty: 5, price: 50 + i }] });
      const rb = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: main, date: '2029-02-02', lines: [{ productId: b, qty: 5, price: 60 + i }] });
      await owner.post(`/documents/${rb.id}/post`);
      const [p1, p2] = await Promise.all([owner.post(`/documents/${ra.id}/post`), owner.post(`/documents/${rb.id}/unpost`)]);
      expect(p1.status).toBe(200);
      expect(p2.status).toBe(200);
    }
    const rows = await admin`
      select b.warehouse_id, b.product_id, b.qty, coalesce((select sum(m.qty) from stock_moves m where m.warehouse_id = b.warehouse_id and m.product_id = b.product_id), 0) as moved
      from stock_balances b where b.workspace_id = ${owner.workspaceId}`;
    for (const r of rows) expect(Number(r.qty)).toBe(Number(r.moved));
  });

  test('moving the closed-through date back reopens the closings of the months after it, latest first', async () => {
    const product = await makeProduct('Табурет 5');
    const item = await makeItem('Табурет 5', '1', product.id);
    for (const m of ['2029-02', '2029-03', '2029-04']) await release(item, '1', m);
    await owner.post('/production/periods/2029-02/close', { through: '2029-04' });
    await runWorker();
    await owner.patch('/production/periods/settings', { closedThrough: '2029-04-30' });
    // дата посреди марта: март снова открыт частично — его закрытие тоже снимается, февраль остаётся закрытым
    const back = await owner.patch('/production/periods/settings', { closedThrough: '2029-03-15' });
    expect(back.status).toBe(200);
    expect(back.body.reopened).toEqual(['2029-03', '2029-04']);
    await runWorker();
    expect((await closingOf('2029-02')).status).toBe('done');
    expect((await closingOf('2029-03')).status).toBe('reopened');
    expect((await closingOf('2029-04')).status).toBe('reopened');
    // снятие даты целиком открывает и февраль
    const cleared = await owner.patch('/production/periods/settings', { closedThrough: null });
    // (в общем воркспейсе снимаются и закрытия предыдущих тестов; март и апрель уже открыты)
    expect(cleared.body.reopened).toContain('2029-02');
    expect(cleared.body.reopened).not.toContain('2029-03');
    await runWorker();
    expect((await closingOf('2029-02')).status).toBe('reopened');
  });

  test('clearing the closed-through date is moving it back: owner only, and it really clears', async () => {
    await owner.patch('/production/periods/settings', { closedThrough: '2026-01-31' });
    expect((await adminUser.patch('/production/periods/settings', { closedThrough: null })).status).toBe(403);
    const cleared = await owner.patch('/production/periods/settings', { closedThrough: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.closedThrough).toBeNull();
  });

  test('a work center of another workspace is refused when the document is saved', async () => {
    const otherWorkshop = (await mk(other, '/warehouses', { name: 'Чужой цех', kind: 'workshop' })).id;
    const foreignCenter = (await mk(other, '/work-centers', { name: 'Чужой участок', hourlyRate: 1, warehouseId: otherWorkshop })).id;
    const line = await owner.post('/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: main, date: '2028-08-20', lines: [{ productId: service, qty: 1, price: 10, costItemId: electricity, workCenterId: foreignCenter }] });
    expect(line.status).toBe(422);
    const head = await owner.post('/documents', { type: 'write_off', warehouseId: main, date: '2028-08-21', workCenterId: foreignCenter, costItemId: electricity, lines: [{ productId: wood, qty: 1, price: 0 }] });
    expect(head.status).toBe(422);
  });
});
