/* «Отгрузка по дату» (срок отгрузки строки заказа, отбор в реализации) и источник привлечения в документах продаж
   (источник, кампания, utm_*: явная правка, подстановка из сделки и контрагента, цепочка «на основании», отчёт по каналам). */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let customer: string;
let wood: string;
let screw: string;
let direct: any;
let site: any;
let camp: any;
let siteCamp: any;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const line = (productId: string, qty: number, price: number, extra: Record<string, unknown> = {}) => ({ productId, qty, price, ...extra });
const dayOff = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Cutoff UTM WS' });
  customer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7707083893', kpp: '770701001' })).id;
  wood = (await mk(owner, '/products', { name: 'Брус', unitCode: '006', price: 100, vatRate: '20' })).id;
  screw = (await mk(owner, '/products', { name: 'Шуруп', price: 3, vatRate: '20' })).id;
  direct = await mk(owner, '/lead-sources', { name: 'Яндекс.Директ' });
  site = await mk(owner, '/lead-sources', { name: 'Сайт' });
  camp = await mk(owner, '/ad-campaigns', { name: 'Кухни', sourceId: direct.id, utmCampaign: 'kitchens' });
  siteCamp = await mk(owner, '/ad-campaigns', { name: 'Баннер', sourceId: site.id });
  expect((await owner.patch('/stock/settings', { allowNegativeStock: true })).status).toBe(200);
});

describe('отгрузка по дату', () => {
  test('в реализацию попадают строки со сроком не позже даты; без даты — все; срок переходит в реализацию', async () => {
    const order = await mk(owner, '/documents', {
      type: 'customer_order',
      counterpartyId: customer,
      lines: [line(wood, 2, 100, { shipBy: dayOff(1) }), line(screw, 5, 3, { shipBy: dayOff(10) }), line(wood, 1, 100)],
    });
    expect(order.lines.map((l: any) => l.shipBy)).toEqual([dayOff(1), dayOff(10), null]);

    const part = (await owner.post(`/documents/${order.id}/based-on`, { type: 'realization', shipBy: dayOff(5) })).body;
    expect(part.lines).toHaveLength(1);
    expect(part.lines[0]).toMatchObject({ productId: wood, qty: '2.000', shipBy: dayOff(1) });

    // повторная отгрузка по более поздней дате берёт остаток: первая строка уже в реализации
    const rest = (await owner.post(`/documents/${order.id}/based-on`, { type: 'realization', shipBy: dayOff(30) })).body;
    expect(rest.lines.map((l: any) => l.productId)).toEqual([screw]);

    // без даты — всё, что ещё не покрыто (строка без срока)
    const all = (await owner.post(`/documents/${order.id}/based-on`, { type: 'realization' })).body;
    expect(all.lines).toHaveLength(1);
    expect(all.lines[0]).toMatchObject({ qty: '1.000', shipBy: null });
  });

  test('ни одной подходящей строки — 422 nothing_by_ship_date; дата не ограничивает другие виды документов', async () => {
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, lines: [line(wood, 1, 100, { shipBy: dayOff(10) }), line(screw, 1, 3)] });
    const r = await owner.post(`/documents/${order.id}/based-on`, { type: 'realization', shipBy: dayOff(2) });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('nothing_by_ship_date');
    // счёт на основании заказа берёт все строки независимо от даты
    const inv = (await owner.post(`/documents/${order.id}/based-on`, { type: 'invoice', shipBy: dayOff(2) })).body;
    expect(inv.lines).toHaveLength(2);
  });

  test('срок строки правится и очищается: undefined не трогает, null очищает', async () => {
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, lines: [line(wood, 1, 100, { shipBy: dayOff(3) })] });
    const id = order.lines[0].id;
    const keep = (await owner.patch(`/documents/${order.id}`, { lines: [{ id, productId: wood, qty: 2, price: 100 }] })).body;
    expect(keep.lines[0].shipBy).toBe(dayOff(3));
    const clear = (await owner.patch(`/documents/${order.id}`, { lines: [{ id, productId: wood, qty: 2, price: 100, shipBy: null }] })).body;
    expect(clear.lines[0].shipBy).toBeNull();
  });
});

describe('источник привлечения документа', () => {
  test('кампания задаёт источник, чужой источник — 422, utm сохраняются, у закупки источника нет', async () => {
    const d = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, campaignId: camp.id, utmSource: ' yandex ', utmMedium: 'cpc', utmContent: 'banner1', lines: [line(wood, 1, 100)] });
    expect(d).toMatchObject({ sourceId: direct.id, campaignId: camp.id, utmSource: 'yandex', utmMedium: 'cpc', utmCampaign: '', utmContent: 'banner1' });
    const bad = await owner.post('/documents', { type: 'quote', counterpartyId: customer, sourceId: site.id, campaignId: camp.id, lines: [line(wood, 1, 100)] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('campaign_source_mismatch');
    const sup = await mk(owner, '/documents', { type: 'supplier_order', counterpartyId: customer, sourceId: site.id, lines: [line(wood, 1, 100)] });
    expect(sup.sourceId).toBeNull();
  });

  test('правка черновика: смена источника сбрасывает кампанию другого источника, null очищает', async () => {
    const d = await mk(owner, '/documents', { type: 'quote', counterpartyId: customer, campaignId: camp.id, lines: [line(wood, 1, 100)] });
    const toSite = (await owner.patch(`/documents/${d.id}`, { sourceId: site.id })).body;
    expect(toSite).toMatchObject({ sourceId: site.id, campaignId: null });
    const viaCamp = (await owner.patch(`/documents/${d.id}`, { campaignId: siteCamp.id, utmCampaign: 'banner' })).body;
    expect(viaCamp).toMatchObject({ sourceId: site.id, campaignId: siteCamp.id, utmCampaign: 'banner' });
    const cleared = (await owner.patch(`/documents/${d.id}`, { sourceId: null, campaignId: null })).body;
    expect(cleared).toMatchObject({ sourceId: null, campaignId: null, utmCampaign: 'banner' });
  });

  test('подставляется из сделки, затем из контрагента; явное значение выигрывает', async () => {
    const buyer = await mk(owner, '/companies', { name: 'ООО «С рекламы»', sourceId: direct.id, campaignId: camp.id });
    const noAttr = await mk(owner, '/documents', { type: 'quote', counterpartyId: buyer.id, lines: [line(wood, 1, 100)] });
    expect(noAttr).toMatchObject({ sourceId: direct.id, campaignId: camp.id });
    const deal = await mk(owner, '/deals', { name: 'С сайта', companyId: buyer.id, sourceId: site.id, campaignId: siteCamp.id });
    const fromDeal = await mk(owner, '/documents', { type: 'quote', dealId: deal.id, lines: [line(wood, 1, 100)] });
    expect(fromDeal).toMatchObject({ sourceId: site.id, campaignId: siteCamp.id });
    const explicit = await mk(owner, '/documents', { type: 'quote', counterpartyId: buyer.id, sourceId: null, lines: [line(wood, 1, 100)] });
    expect(explicit).toMatchObject({ sourceId: null, campaignId: null });
  });

  test('идёт по цепочке КП → заказ → реализация, у основания без источника — из контрагента', async () => {
    const quote = await mk(owner, '/documents', { type: 'quote', counterpartyId: customer, campaignId: camp.id, utmSource: 'yandex', utmCampaign: 'kitchens', lines: [line(wood, 1, 100)] });
    const order = (await owner.post(`/documents/${quote.id}/based-on`, { type: 'customer_order' })).body;
    expect(order).toMatchObject({ sourceId: direct.id, campaignId: camp.id, utmSource: 'yandex', utmCampaign: 'kitchens' });
    const real = (await owner.post(`/documents/${order.id}/based-on`, { type: 'realization' })).body;
    expect(real).toMatchObject({ sourceId: direct.id, campaignId: camp.id, utmSource: 'yandex', utmCampaign: 'kitchens' });

    // заказ без источника, контрагент с источником: реализация получит источник контрагента
    const plain = await mk(owner, '/companies', { name: 'ООО «Позже привели»' });
    const o2 = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: plain.id, lines: [line(wood, 1, 100)] });
    expect(o2.sourceId).toBeNull();
    await owner.patch(`/companies/${plain.id}`, { sourceId: site.id });
    const r2 = (await owner.post(`/documents/${o2.id}/based-on`, { type: 'realization' })).body;
    expect(r2.sourceId).toBe(site.id);
  });
});

describe('отчёт по каналам: выручка по реализациям', () => {
  test('проведённые реализации с кампанией попадают в разрезы источника и кампании, черновики и отменённые — нет', async () => {
    const mkReal = (extra: Record<string, unknown>) => mk(owner, '/documents', { type: 'realization', counterpartyId: customer, lines: [line(wood, 1, 1000, { vatRate: 'none' })], ...extra });
    const a = await mkReal({ campaignId: siteCamp.id });
    const b = await mkReal({ campaignId: siteCamp.id });
    await mkReal({ campaignId: siteCamp.id }); // черновик
    await mkReal({}); // без источника
    for (const id of [a.id, b.id]) expect((await owner.post(`/documents/${id}/post`)).status).toBe(200);
    const period = `from=${dayOff(-1)}&to=${dayOff(1)}`;

    const bySource = (await owner.get(`/ad-report?${period}&groupBy=source`)).body;
    const siteRow = bySource.rows.find((r: any) => r.key === site.id);
    expect(siteRow).toMatchObject({ salesRevenue: '2000.00', shipments: 2 });
    expect(Number(bySource.total.salesRevenue)).toBeGreaterThanOrEqual(2000);

    const byCamp = (await owner.get(`/ad-report?${period}&groupBy=campaign`)).body;
    expect(byCamp.rows.find((r: any) => r.key === siteCamp.id)).toMatchObject({ salesRevenue: '2000.00', shipments: 2 });
    // вне периода — пусто
    const old = (await owner.get(`/ad-report?from=2020-01-01&to=2020-01-31&groupBy=source`)).body;
    expect(old.rows.find((r: any) => r.key === site.id)).toBeUndefined();
  });
});
