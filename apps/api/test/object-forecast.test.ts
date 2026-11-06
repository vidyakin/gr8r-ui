/* Прогноз прибыли объекта (задача 1275): остаток по темпу на примере кабеля (400 м за 110 ч из 1 000 м и 200 ч —
   остаток 165 ч, итог 275 ч), остаток субподряда по принятому, категория материалов «план − факт», ручная правка
   остатка с причиной (без причины — 422), накладные процента объекта, нулевая стоимость договора → маржа null,
   без согласованной сметы прогноз не строится, смены без ставки — пробел, исполнители по подтверждённым сменам,
   member → 403, портфель объектов, unapprove сметы при фактах → 422 estimate_has_facts, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { addMember, Client, uniq } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let wh = '';
let supplier = '';
let customer = '';
let cable = ''; // товар, закупочная цена 85
let scrap = ''; // статья затрат для списания
let hourlyWorker = ''; // рабочий с почасовой ставкой 100
let noRateWorker = ''; // рабочий без ставки — пробел
let insuranceRate = 30;

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const uid = () => crypto.randomUUID();

/** Почасовая стоимость: ставка + взносы воркспейса */
const rate = (hourly: number) => Number((hourly * (1 + Number(insuranceRate) / 100)).toFixed(2));
const money = (v: number) => v.toFixed(2);

/** Объект: процент накладных и политика бюджета без контроля (прогноз не должен ловить предупреждения) */
async function object(number: string, extra: Record<string, unknown> = {}) {
  return await mk(owner, '/objects', { number: `FC-${number}-${uniq()}`, name: `Объект ${number}`, budgetPolicy: 'none', ...extra });
}

/** Смета объекта с позициями; approve — сразу согласовать */
async function estimate(objectId: string, items: Record<string, unknown>[], approve = true) {
  const est = await mk(owner, `/objects/${objectId}/estimates`, { name: 'Смета объекта' });
  const put = await owner.put(`/estimates/${est.id}/items`, {
    sections: [],
    items: items.map(i => ({ id: uid(), unitCode: '796', kind: 'work', qty: '1', price: '0', costPrice: '0', laborHours: '0', ...i })),
  });
  if (put.status >= 300) throw new Error(`items ${est.id}: ${put.status} ${JSON.stringify(put.body)}`);
  if (approve) await mk(owner, `/estimates/${est.id}/approve`);
  return { id: est.id as string, items: put.body.items as any[] };
}

/** Рабочий без входа; ставка — почасовая */
async function worker(name: string, hourlyRate?: number) {
  const w = await mk(owner, '/members/workers', { name, personnelNumber: `Т-${uniq().slice(-4)}` });
  if (hourlyRate !== undefined) await owner.put(`/payroll/employees/${w.id}`, { hourlyRate: String(hourlyRate) });
  return w.id as string;
}

/** Подтверждённая смена: часы работника по позиции сметы */
async function shift(objectId: string, workDate: string, points: { memberId: string; hours: string; estimateItemId?: string | null }[]) {
  const created = await mk(owner, `/objects/${objectId}/shifts`, { workDate });
  const saved = await owner.put(`/shifts/${created.id}`, { hours: points.map(p => ({ memberId: p.memberId, hours: p.hours, estimateItemId: p.estimateItemId ?? null })), volumes: [] });
  if (saved.status >= 300) throw new Error(`save shift ${created.id}: ${saved.status} ${JSON.stringify(saved.body)}`);
  const confirmed = await owner.post(`/shifts/${created.id}/confirm`, {});
  if (confirmed.status >= 300) throw new Error(`confirm shift ${created.id}: ${confirmed.status} ${JSON.stringify(confirmed.body)}`);
  return created.id as string;
}

/** Приход товара на основной склад (без НДС) */
async function receive(productId: string, qty: number, price: number) {
  const d = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: wh, priceIncludesVat: false, lines: [{ productId, qty, price }] });
  await mk(owner, `/documents/${d.id}/post`);
  return d.id as string;
}

/** Списание товара со склада с аналитикой объекта — факт материалов */
async function writeOff(objectId: string, productId: string, qty: number) {
  const d = await mk(owner, '/documents', { type: 'write_off', warehouseId: wh, costItemId: scrap, objectId, priceIncludesVat: false, lines: [{ productId, qty, price: 0 }] });
  const posted = await owner.post(`/documents/${d.id}/post`, {});
  if (posted.status >= 300) throw new Error(`post write_off: ${posted.status} ${JSON.stringify(posted.body)}`);
  return d.id as string;
}

/** Принятый акт субподрядчика по позиции сметы */
async function subAct(objectId: string, itemId: string, qty: string) {
  const act = await mk(owner, `/objects/${objectId}/sub-acts`, {
    counterpartyId: supplier,
    docNumber: `СА-${uniq()}`,
    docDate: '2026-10-20',
    lines: [{ estimateItemId: itemId, qty, acceptedQty: qty }],
  });
  const accepted = await owner.post(`/sub-acts/${act.id}/accept`, {});
  if (accepted.status >= 300) throw new Error(`accept sub act: ${accepted.status} ${JSON.stringify(accepted.body)}`);
  return act.id as string;
}

const forecastOf = (objectId: string, c: Client = owner) => c.get(`/objects/${objectId}/forecast`);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Object forecast WS' });
  member = await addMember(owner, 'member');
  other = new Client();
  await other.signup({ workspaceName: 'Other forecast WS' });
  wh = (await owner.get('/warehouses')).body.items[0].id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Подрядчик»' })).id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Заказчик»' })).id;
  cable = (await mk(owner, '/products', { name: 'Кабель ВВГнг 3×2,5', unitCode: '006', price: 120, purchasePrice: 85 })).id;
  scrap = (await owner.get('/cost-items')).body.items[0].id;
  insuranceRate = (await owner.get('/payroll/settings')).body.insuranceRate;
  hourlyWorker = await worker('Почасовой Рабочий', 100);
  noRateWorker = await worker('Без Ставки');
  await receive(cable, 100, 85);
});

describe('прогноз по темпу и итоги', () => {
  test('400 м за 110 ч из 1 000 м и 200 ч: остаток 165 ч, итог 275 ч; прибыль и маржа', async () => {
    const obj = await object('TEMPO', { customerId: customer, overheadPct: '0' });
    const est = await estimate(obj.id, [{ kind: 'work', name: 'Прокладка кабеля', unitCode: '006', qty: '1000', price: '300', costPrice: '13.75', laborHours: '0.2' }]);
    const itemId = est.items[0].id;
    await owner.patch(`/estimates/${est.id}/done-qty`, { items: [{ id: itemId, doneQty: '400' }] });
    // 110 ч = 5 смен по 22 ч
    for (const day of ['01', '02', '03', '04', '05']) await shift(obj.id, `2026-10-${day}`, [{ memberId: hourlyWorker, hours: '22', estimateItemId: itemId }]);

    const res = await forecastOf(obj.id);
    expect(res.status).toBe(200);
    const f = res.body;
    expect(f.hasEstimate).toBe(true);
    expect(f.source).toEqual({ estimate: true, shifts: 5, subActs: 0 });
    const labor = f.categories.find((c: any) => c.category === 'labor');
    const row = labor.items[0];
    expect(row.donePct).toBe('40.0');
    expect(row.planHours).toBe('200.000');
    expect(row.factHours).toBe('110.000');
    expect(row.remainingHours).toBe('165.000');
    expect(row.forecastHours).toBe('275.000');
    // стоимость труда: 110 ч × 100 ₽ × (1 + взносы)
    expect(row.factCost).toBe(money(rate(100) * 110));
    // остаток по темпу: 14 300 / 400 × 600
    expect(row.remaining).toBe(money((rate(100) * 110 * 600) / 400));
    expect(row.forecast).toBe(money(rate(100) * 110 + (rate(100) * 110 * 600) / 400));
    expect(row.basis).toBe('tempo');
    // итоги: стоимость договора 1 000 × 300, прогноз = факт + остаток
    expect(f.totals.contractValue).toBe('300000.00');
    expect(f.totals.planCost).toBe('13750.00');
    expect(f.totals.factCost).toBe(money(rate(100) * 110));
    expect(f.totals.forecastCost).toBe(money(rate(100) * 110 * (1 + 600 / 400)));
    expect(f.totals.profit).toBe(money(300000 - rate(100) * 110 * 2.5));
    expect(Number(f.totals.marginPct)).toBeCloseTo(Number(f.totals.profit) / 3000, 1);
    // справка выручки рядом: выполнено по смете, принято/выставлено/оплачено — нули
    expect(f.revenue.done).toBe('120000.00');
    expect(f.revenue.accepted).toBe('0.00');
    expect(f.gaps).toEqual([]);
    expect(typeof f.computedAt).toBe('string');
  });

  test('накладные — процент объекта от прямых затрат', async () => {
    const obj = await object('OH', { overheadPct: '10' });
    await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '10', price: '100', costPrice: '10', laborHours: '0' }]);
    const f = (await forecastOf(obj.id)).body;
    expect(f.totals.planCost).toBe('100.00');
    expect(f.totals.remaining).toBe('100.00');
    expect(f.totals.overhead).toBe('10.00');
    expect(f.totals.forecastCost).toBe('110.00');
    expect(f.totals.contractValue).toBe('1000.00');
    expect(f.totals.profit).toBe('890.00');
    expect(f.totals.marginPct).toBe('89.0');
  });

  test('нулевая стоимость договора — маржа не считается', async () => {
    const obj = await object('ZERO');
    await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '1', price: '0', costPrice: '50' }]);
    const f = (await forecastOf(obj.id)).body;
    expect(f.totals.contractValue).toBe('0.00');
    expect(f.totals.marginPct).toBeNull();
    expect(f.totals.profit).toBe('-50.00');
  });

  test('без согласованной сметы прогноз не строится: null и причина no_estimate', async () => {
    const obj = await object('NOEST');
    const res = await forecastOf(obj.id);
    expect(res.status).toBe(200);
    expect(res.body.hasEstimate).toBe(false);
    expect(res.body.totals.forecastCost).toBeNull();
    expect(res.body.totals.profit).toBeNull();
    expect(res.body.totals.marginPct).toBeNull();
    expect(res.body.gaps).toEqual([{ code: 'no_estimate' }]);
  });

  test('смены без ставки — пробел, а не ноль', async () => {
    const obj = await object('NORATE');
    const est = await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '10', costPrice: '100' }]);
    await shift(obj.id, '2026-10-06', [{ memberId: noRateWorker, hours: '8', estimateItemId: est.items[0].id }]);
    const f = (await forecastOf(obj.id)).body;
    const row = f.categories.find((c: any) => c.category === 'labor').items[0];
    expect(row.factCost).toBeNull();
    expect(f.gaps.map((g: any) => g.code)).toContain('no_rate_hours');
    expect(f.gaps.find((g: any) => g.code === 'no_rate_hours').hours).toBe('8.00');
  });
});

describe('остаток субподряда и материалы', () => {
  test('субподряд: остаток = (объём − принятое) × плановая себестоимость', async () => {
    const obj = await object('SUB');
    const est = await estimate(obj.id, [{ kind: 'subcontract', name: 'Монтаж видеонаблюдения', qty: '10', price: '1200', costPrice: '1000' }]);
    await subAct(obj.id, est.items[0].id, '4');
    const f = (await forecastOf(obj.id)).body;
    const row = f.categories.find((c: any) => c.category === 'subcontract').items[0];
    expect(row.basis).toBe('accepted');
    expect(row.factCost).toBe('4000.00');
    expect(row.remaining).toBe('6000.00');
    expect(row.forecast).toBe('10000.00');
    expect(row.deviation).toBe('0.00');
    expect(f.source.subActs).toBe(1);
  });

  test('материалы: остаток = max(план категории − факт категории, 0)', async () => {
    const obj = await object('MAT');
    await estimate(obj.id, [{ kind: 'material', name: 'Кабель', productId: cable, qty: '100', costPrice: '85' }]);
    await writeOff(obj.id, cable, 30);
    const f = (await forecastOf(obj.id)).body;
    const cat = f.categories.find((c: any) => c.category === 'material');
    expect(cat.planCost).toBe('8500.00');
    expect(cat.factCost).toBe('2550.00');
    expect(cat.remaining).toBe('5950.00');
    // по позиции факт и остаток не распределяются
    expect(cat.items[0].remaining).toBeNull();
    expect(cat.items[0].factCost).toBeNull();
  });
});

describe('ручные правки остатка', () => {
  test('правка позиции и категории видна в отчёте с причиной; без причины — 422', async () => {
    const obj = await object('OVR');
    const est = await estimate(obj.id, [
      { kind: 'work', name: 'Работа', qty: '10', price: '100', costPrice: '10' },
      { kind: 'material', name: 'Кабель', productId: cable, qty: '10', costPrice: '85' },
    ]);
    const itemId = est.items[0].id;
    const put = await owner.put(`/objects/${obj.id}/forecast/overrides`, { estimateItemId: itemId, remaining: '9999', reason: 'Сложный участок' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ estimateItemId: itemId, remaining: '9999.00', reason: 'Сложный участок' });
    expect(put.body.authorName).toEqual(expect.any(String));

    const byCat = await owner.put(`/objects/${obj.id}/forecast/overrides`, { category: 'material', remaining: '500', reason: 'Дозаказ кабеля' });
    expect(byCat.status).toBe(200);

    const f = (await forecastOf(obj.id)).body;
    const labor = f.categories.find((c: any) => c.category === 'labor');
    expect(labor.items[0].overridden).toBe(true);
    expect(labor.items[0].overrideReason).toBe('Сложный участок');
    expect(labor.items[0].basis).toBe('override');
    expect(labor.remaining).toBe('9999.00');
    const material = f.categories.find((c: any) => c.category === 'material');
    expect(material.overridden).toBe(true);
    expect(material.overrideReason).toBe('Дозаказ кабеля');
    expect(material.remaining).toBe('500.00');
    expect(f.overrides).toHaveLength(2);

    // повторная правка той же цели — обновляет значение, а не создаёт вторую
    const again = await owner.put(`/objects/${obj.id}/forecast/overrides`, { estimateItemId: itemId, remaining: '1', reason: 'Уточнили' });
    expect(again.status).toBe(200);
    expect((await forecastOf(obj.id)).body.overrides).toHaveLength(2);

    // причина обязательна — 422
    const noReason = await owner.put(`/objects/${obj.id}/forecast/overrides`, { estimateItemId: itemId, remaining: '10', reason: '  ' });
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.code).toBe('forecast_reason_required');

    // снятие правки категории возвращает расчётный остаток
    const del = await owner.del(`/objects/${obj.id}/forecast/overrides?category=material`);
    expect(del.status).toBe(200);
    const after = (await forecastOf(obj.id)).body;
    expect(after.overrides).toHaveLength(1);
    expect(after.categories.find((c: any) => c.category === 'material').overridden).toBe(false);
  });

  test('member не может править прогноз — 403', async () => {
    const obj = await object('OVR-RIGHTS');
    const est = await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '1', costPrice: '10' }]);
    const put = await member.put(`/objects/${obj.id}/forecast/overrides`, { estimateItemId: est.items[0].id, remaining: '5', reason: 'Правка' });
    expect(put.status).toBe(403);
    expect(put.body.error.code).toBe('forbidden');
  });
});

describe('исполнители', () => {
  test('исполнители объекта: работник, часы, стоимость труда и позиции; итог', async () => {
    const obj = await object('EXEC');
    const est = await estimate(obj.id, [{ kind: 'work', name: 'Прокладка кабеля', qty: '100', costPrice: '10' }]);
    await shift(obj.id, '2026-10-10', [{ memberId: hourlyWorker, hours: '8', estimateItemId: est.items[0].id }]);
    await shift(obj.id, '2026-10-11', [{ memberId: hourlyWorker, hours: '6', estimateItemId: est.items[0].id }]);
    const res = await owner.get(`/objects/${obj.id}/forecast/executors`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const row = res.body.items[0];
    expect(row.memberId).toBe(hourlyWorker);
    expect(row.hours).toBe('14.00');
    expect(row.costAmount).toBe(money(rate(100) * 14));
    expect(row.positions).toHaveLength(1);
    expect(row.positions[0]).toMatchObject({ estimateItemId: est.items[0].id, name: 'Прокладка кабеля', hours: '14.00' });
    expect(res.body.totals).toEqual({ hours: '14.00', costAmount: money(rate(100) * 14), hoursWithoutCost: '0.00' });

    // период не входит в смены — пусто
    const empty = await owner.get(`/objects/${obj.id}/forecast/executors?from=2026-11-01&to=2026-11-30`);
    expect(empty.body.items).toEqual([]);
  });

  test('member и чужая аренда не видят прогноз — 403 и 404', async () => {
    const obj = await object('RIGHTS');
    await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '1', costPrice: '10' }]);
    const res = await forecastOf(obj.id, member);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    const exec = await member.get(`/objects/${obj.id}/forecast/executors`);
    expect(exec.status).toBe(403);
    // чужой арендатор объекта не видит
    const foreign = await forecastOf(obj.id, other);
    expect(foreign.status).toBe(404);
  });
});

describe('портфель и факты по смете', () => {
  test('портфель: прогноз по всем активным объектам, суммы по owner', async () => {
    const obj = await object('PORT', { status: 'active' });
    await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '10', price: '100', costPrice: '10' }]);
    const res = await owner.get('/objects-forecast');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    const row = res.body.items.find((r: any) => r.objectId === obj.id);
    expect(row).toMatchObject({ number: obj.number, status: 'active', contractValue: '1000.00', planCost: '100.00', remaining: '100.00', forecastCost: '100.00', profit: '900.00' });
    expect(res.body.totals.objects).toBe(res.body.items.length);
    expect(res.body.totals.contractValue).toEqual(expect.any(String));

    const denied = await member.get('/objects-forecast');
    expect(denied.status).toBe(403);
  });

  test('смету нельзя вернуть в черновик, если по объекту есть факт — 422 estimate_has_facts', async () => {
    const obj = await object('FACTS');
    const est = await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '10', costPrice: '10' }]);
    // пока факта нет — возврат в черновик разрешён
    const ok = await owner.post(`/estimates/${est.id}/unapprove`, {});
    expect(ok.status).toBe(200);
    await mk(owner, `/estimates/${est.id}/approve`);
    // подтверждённая смена — факт труда по объекту
    await shift(obj.id, '2026-10-12', [{ memberId: hourlyWorker, hours: '8', estimateItemId: est.items[0].id }]);
    const denied = await owner.post(`/estimates/${est.id}/unapprove`, {});
    expect(denied.status).toBe(422);
    expect(denied.body.error.code).toBe('estimate_has_facts');
  });

  test('принятый акт субподряда тоже запрещает возврат сметы в черновик', async () => {
    const obj = await object('FACTS-SUB');
    const est = await estimate(obj.id, [{ kind: 'subcontract', name: 'Монтаж', qty: '10', price: '1200', costPrice: '1000' }]);
    await subAct(obj.id, est.items[0].id, '2');
    const denied = await owner.post(`/estimates/${est.id}/unapprove`, {});
    expect(denied.status).toBe(422);
    expect(denied.body.error.code).toBe('estimate_has_facts');
  });

  test('чужой арендатор не видит объект в портфеле', async () => {
    const obj = await object('PORT-ISO');
    await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '1', costPrice: '10' }]);
    const mine = (await other.get('/objects-forecast')).body;
    expect(mine.items.some((r: any) => r.objectId === obj.id)).toBe(false);
  });
});
