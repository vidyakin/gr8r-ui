/* Дополнительные расходы в себестоимость (задача 1385): распределение по строкам оснований, пересчёт средней
   себестоимости склада и себестоимости уже отгружённого, откат при отмене проведения, запреты и права. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { addMember, Client } from './helpers';

let owner: Client;
let member: Client;
let wh: string;
let supplier: string;
let buyer: string;
let bolt: string;
let cable: string;
let paint: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const post = async (id: string) => {
  const r = await owner.post(`/documents/${id}/post`);
  expect(r.status).toBe(200);
};
const receipt = (body: Record<string, unknown>) => mk(owner, '/documents', { type: 'receipt', date: '2026-08-10', priceIncludesVat: false, warehouseId: wh, counterpartyId: supplier, ...body });
/** Средняя себестоимость и стоимость остатка (видят admin и owner) */
const avgCost = async (productId: string) => ((await owner.get(`/stock/balances?productId=${productId}&warehouseId=${wh}`)).body.items[0]?.avgCost ?? null) as string | null;
const balanceQty = async (productId: string) => ((await owner.get(`/stock/balances?productId=${productId}&warehouseId=${wh}`)).body.items[0]?.qty ?? '0.000') as string;
/** Фактические движения проведённого документа: цена единицы с учётом корректировок */
const moveCost = async (documentId: string) => {
  const r = (await owner.get(`/documents/${documentId}/stock-moves`)).body as any;
  return (r.moves?.[0]?.cost ?? null) as string | null;
};
const linesOf = async (documentId: string) => ((await owner.get(`/landed-costs/bases/lines?documentId=${documentId}`)).body as any).lines as any[];

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Доп. расходы WS' });
  member = await addMember(owner, 'member');
  wh = (await owner.get('/warehouses')).body.items[0].id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Перевозчик»', inn: '7728168971' })).id;
  buyer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7707083893' })).id;
  bolt = (await mk(owner, '/products', { name: 'Болт', kind: 'goods', unitCode: '796', price: 200, vatRate: 'none', weightKg: 2 })).id;
  cable = (await mk(owner, '/products', { name: 'Кабель', kind: 'goods', unitCode: '796', price: 400, vatRate: 'none' })).id;
  paint = (await mk(owner, '/products', { name: 'Краска', kind: 'goods', unitCode: '796', price: 300, vatRate: 'none', weightKg: 5 })).id;
});

describe('landed cost voucher', () => {
  test('by amount: average cost of the receipt grows and shipped goods are revalued', async () => {
    // поступление: болт 10 × 100 = 1000 (вес 20 кг), кабель 5 × 200 = 1000
    const r = await receipt({ lines: [{ productId: bolt, qty: 10, price: 100 }, { productId: cable, qty: 5, price: 200 }] });
    await post(r.id);
    expect(await avgCost(bolt)).toBe('100.0000');
    expect(await avgCost(cable)).toBe('200.0000');
    // отгрузка до доп. расходов: 4 болта по 100
    const sale = await mk(owner, '/documents', { type: 'realization', date: '2026-08-12', warehouseId: wh, counterpartyId: buyer, lines: [{ productId: bolt, qty: 4, price: 200 }] });
    await post(sale.id);
    expect(await moveCost(sale.id)).toBe('100.0000');
    // доп. расходы 300 по сумме строк: поровну (1000 и 1000) → 150 на строку → 15 и 30 на единицу
    const lc = await mk(owner, '/landed-costs', {
      date: '2026-08-15',
      method: 'by_amount',
      amount: '300.00',
      supplierId: supplier,
      lines: (await linesOf(r.id)).map(l => ({ id: crypto.randomUUID(), baseDocumentId: r.id, baseDocumentLineId: l.lineId })),
    });
    expect(lc.total).toBe('300.00');
    expect(lc.lines.map((l: any) => l.amount)).toEqual(['150.00', '150.00']);
    const posted = await owner.post(`/landed-costs/${lc.id}/post`);
    expect(posted.status).toBe(200);
    // средняя выросла, отгружённое подорожало на те же 15 на единицу
    expect(await avgCost(bolt)).toBe('115.0000');
    expect(await avgCost(cable)).toBe('230.0000');
    expect(await moveCost(sale.id)).toBe('115.0000');
    // отмена проведения возвращает прежнюю себестоимость
    const unposted = await owner.post(`/landed-costs/${lc.id}/unpost`);
    expect(unposted.status).toBe(200);
    expect(await avgCost(bolt)).toBe('100.0000');
    expect(await avgCost(cable)).toBe('200.0000');
    expect(await moveCost(sale.id)).toBe('100.0000');
  });

  test('by qty and by weight (with fallback) distribute exactly', async () => {
    const r = await receipt({ lines: [{ productId: bolt, qty: 10, price: 100 }, { productId: paint, qty: 2, price: 300 }] });
    await post(r.id);
    const baseLines = await linesOf(r.id);
    // 10 болтов (вес 20) и 2 краски (вес 10)
    const byQty = await mk(owner, '/landed-costs', {
      date: '2026-09-01',
      method: 'by_qty',
      amount: '120.00',
      lines: baseLines.map(l => ({ id: crypto.randomUUID(), baseDocumentId: r.id, baseDocumentLineId: l.lineId })),
    });
    expect(byQty.lines.map((l: any) => l.amount)).toEqual(['100.00', '20.00']);
    const byWeight = await mk(owner, '/landed-costs', {
      date: '2026-09-02',
      method: 'by_weight',
      amount: '90.00',
      lines: baseLines.map(l => ({ id: crypto.randomUUID(), baseDocumentId: r.id, baseDocumentLineId: l.lineId })),
    });
    expect(byWeight.lines.map((l: any) => l.amount)).toEqual(['60.00', '30.00']);
    // веса нет ни у одного товара — распределение по количеству
    const light = await receipt({ lines: [{ productId: cable, qty: 1, price: 100 }, { productId: cable, qty: 3, price: 100 }] });
    await post(light.id);
    const lines = await linesOf(light.id);
    const noWeight = await mk(owner, '/landed-costs', {
      date: '2026-09-03',
      method: 'by_weight',
      amount: '40.00',
      lines: lines.map(l => ({ id: crypto.randomUUID(), baseDocumentId: light.id, baseDocumentLineId: l.lineId })),
    });
    expect(noWeight.lines.map((l: any) => l.amount)).toEqual(['10.00', '30.00']);
  });

  test('manual amounts are stored as entered and their sum is the document total', async () => {
    const r = await receipt({ lines: [{ productId: bolt, qty: 4, price: 100 }, { productId: cable, qty: 4, price: 100 }] });
    await post(r.id);
    const lines = await linesOf(r.id);
    const lc = await mk(owner, '/landed-costs', {
      date: '2026-09-05',
      method: 'manual',
      lines: [
        { id: crypto.randomUUID(), baseDocumentId: r.id, baseDocumentLineId: lines[0].lineId, amount: '10.10' },
        { id: crypto.randomUUID(), baseDocumentId: r.id, baseDocumentLineId: lines[1].lineId, amount: '0.05' },
      ],
    });
    expect(lc.total).toBe('10.15');
    expect(lc.lines.map((l: any) => l.amount)).toEqual(['10.10', '0.05']);
    // доли в процентах складываются в 100
    expect(lc.lines.reduce((s: number, l: any) => s + Number(l.sharePct), 0)).toBeCloseTo(100, 6);
  });

  test('a draft can be edited: method and amount reallocate the lines, a comment alone does not touch them', async () => {
    const r = await receipt({ lines: [{ productId: bolt, qty: 2, price: 100 }, { productId: cable, qty: 3, price: 100 }] });
    await post(r.id);
    const lines = await linesOf(r.id);
    const lc = await mk(owner, '/landed-costs', { date: '2026-09-06', method: 'by_qty', amount: '100.00', lines: lines.map(l => ({ id: crypto.randomUUID(), baseDocumentId: r.id, baseDocumentLineId: l.lineId })) });
    expect(lc.lines.map((l: any) => l.amount)).toEqual(['40.00', '60.00']);
    // смена способа и суммы: доли пересчитываются, строки те же
    const changed = await owner.patch(`/landed-costs/${lc.id}`, { method: 'by_amount', amount: '200.00' });
    expect(changed.status).toBe(200);
    expect((changed.body as any).total).toBe('200.00');
    // стоимости строк 200 и 300: 200.00 делится 80 и 120
    expect((changed.body as any).lines.map((l: any) => l.amount)).toEqual(['80.00', '120.00']);
    // правка только комментария не трогает распределение
    const commented = await owner.patch(`/landed-costs/${lc.id}`, { comment: 'Доставка за сентябрь' });
    expect((commented.body as any).comment).toBe('Доставка за сентябрь');
    expect((commented.body as any).total).toBe('200.00');
    expect((commented.body as any).lines.map((l: any) => l.amount)).toEqual(['80.00', '120.00']);
    // правка проведённого документа запрещена
    await owner.post(`/landed-costs/${lc.id}/post`);
    const locked = await owner.patch(`/landed-costs/${lc.id}`, { comment: 'после проведения' });
    expect(locked.status).toBe(409);
  });

  test('a posted voucher blocks unposting of its base document and is unpostable itself', async () => {
    const r = await receipt({ lines: [{ productId: paint, qty: 3, price: 100 }] });
    await post(r.id);
    const lines = await linesOf(r.id);
    const lc = await mk(owner, '/landed-costs', { date: '2026-09-10', method: 'by_qty', amount: '30.00', lines: [{ id: crypto.randomUUID(), baseDocumentId: r.id, baseDocumentLineId: lines[0].lineId }] });
    await owner.post(`/landed-costs/${lc.id}/post`);
    const blocked = await owner.post(`/documents/${r.id}/unpost`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('has_posted_landed_costs');
    // после отмены проведения доп. расходов приход снимается
    expect((await owner.post(`/landed-costs/${lc.id}/unpost`)).status).toBe(200);
    expect((await owner.post(`/documents/${r.id}/unpost`)).status).toBe(200);
  });

  test('validation: base must be posted, wrong type, duplicates and empty manual shares are rejected', async () => {
    const order = await mk(owner, '/documents', { type: 'supplier_order', date: '2026-09-11', counterpartyId: supplier, lines: [{ productId: bolt, qty: 1, price: 100 }] });
    await post(order.id);
    const draft = await receipt({ lines: [{ productId: bolt, qty: 1, price: 100 }] });
    // заказ поставщику прихода на склад не даёт: проверка типа срабатывает раньше проверки строки
    const wrongType = await owner.post('/landed-costs', { date: '2026-09-12', method: 'by_qty', amount: '10.00', lines: [{ baseDocumentId: order.id, baseDocumentLineId: crypto.randomUUID() }] });
    expect(wrongType.status).toBe(422);
    expect(wrongType.body.error.code).toBe('invalid_base_type');
    // черновик поступления ещё не приход
    const notPosted = await owner.post('/landed-costs', { date: '2026-09-12', method: 'by_qty', amount: '10.00', lines: [{ baseDocumentId: draft.id, baseDocumentLineId: crypto.randomUUID() }] });
    expect(notPosted.status).toBe(422);
    expect(notPosted.body.error.code).toBe('base_not_posted');
    // дубли строки основания
    const base = await receipt({ lines: [{ productId: bolt, qty: 2, price: 100 }] });
    await post(base.id);
    const baseLines = await linesOf(base.id);
    const dup = await owner.post('/landed-costs', {
      date: '2026-09-13',
      method: 'by_qty',
      amount: '10.00',
      lines: [
        { baseDocumentId: base.id, baseDocumentLineId: baseLines[0].lineId },
        { baseDocumentId: base.id, baseDocumentLineId: baseLines[0].lineId },
      ],
    });
    expect(dup.status).toBe(422);
    expect(dup.body.error.code).toBe('duplicate_base_line');
    // ручное распределение без сумм
    const zero = await owner.post('/landed-costs', { date: '2026-09-13', method: 'manual', lines: [{ baseDocumentId: base.id, baseDocumentLineId: baseLines[0].lineId, amount: '0' }] });
    expect(zero.status).toBe(422);
    expect(zero.body.error.code).toBe('invalid_amount');
  });

  test('member sees the structure without amounts', async () => {
    const r = await receipt({ lines: [{ productId: cable, qty: 1, price: 100 }] });
    await post(r.id);
    const lines = await linesOf(r.id);
    const lc = await mk(owner, '/landed-costs', { date: '2026-09-15', method: 'by_qty', amount: '50.00', lines: [{ id: crypto.randomUUID(), baseDocumentId: r.id, baseDocumentLineId: lines[0].lineId }] });
    member.workspaceId = owner.workspaceId;
    const asMember = (await member.get(`/landed-costs/${lc.id}`)).body as any;
    expect(asMember.total).toBeNull();
    expect(asMember.lines[0].amount).toBeNull();
    expect(asMember.lines[0].qty).toBe('1.000');
    expect(asMember.method).toBe('by_qty');
    // журнал и отчёт тоже без сумм
    expect((await member.get('/landed-costs')).body.items.every((i: any) => i.total === null)).toBe(true);
    expect((await member.get('/landed-costs/report?from=2026-09-01&to=2026-09-30')).body.total).toBeNull();
    // у владельца суммы на месте
    expect((await owner.get(`/landed-costs/${lc.id}`)).body.total).toBe('50.00');
  });

  test('report groups by cost item, base document and product', async () => {
    const item = await mk(owner, '/cost-items', { name: 'Доставка в доп. расходы', kind: 'expense' });
    // свой товар: остаток и средняя не зависят от поступлений соседних тестов
    const nut = (await mk(owner, '/products', { name: 'Гайка', kind: 'goods', unitCode: '796', price: 200, vatRate: 'none' })).id;
    const r = await receipt({ date: '2026-10-01', lines: [{ productId: nut, qty: 2, price: 100 }] });
    await post(r.id);
    const lines = await linesOf(r.id);
    const lc = await mk(owner, '/landed-costs', { date: '2026-10-02', method: 'by_qty', amount: '70.00', costItemId: item.id, lines: [{ id: crypto.randomUUID(), baseDocumentId: r.id, baseDocumentLineId: lines[0].lineId }] });
    await owner.post(`/landed-costs/${lc.id}/post`);
    const report = (await owner.get('/landed-costs/report?from=2026-10-01&to=2026-10-31')).body as any;
    expect(report.documents).toHaveLength(1);
    expect(report.documents[0].total).toBe('70.00');
    expect(report.byCostItem).toHaveLength(1);
    expect(report.byCostItem[0]).toMatchObject({ name: 'Доставка в доп. расходы', amount: '70.00' });
    expect(report.byBase[0]).toMatchObject({ baseDocumentId: r.id, amount: '70.00' });
    expect(report.byProduct[0]).toMatchObject({ productId: nut, qty: '2.000', amount: '70.00' });
    expect(report.total).toBe('70.00');
    // черновик в суммы не попадает
    const draft = await mk(owner, '/landed-costs', { date: '2026-10-03', method: 'by_qty', amount: '10.00', lines: [{ id: crypto.randomUUID(), baseDocumentId: r.id, baseDocumentLineId: lines[0].lineId }] });
    const after = (await owner.get('/landed-costs/report?from=2026-10-01&to=2026-10-31')).body as any;
    expect(after.documents).toHaveLength(2);
    expect(after.total).toBe('80.00');
    expect(after.postedTotal).toBe('70.00');
    expect(draft.status).toBe('draft');
    // остаток гайки подорожал на 35 за единицу: 100 → 135
    expect(await avgCost(nut)).toBe('135.0000');
    expect(await balanceQty(nut)).toBe('2.000');
  });
});
