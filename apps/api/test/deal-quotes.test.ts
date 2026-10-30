/* КП из сделки (задача 1252): документ связан со сделкой, контрагент берётся из сделки, список КП сделки, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let other: Client;
let company: string;
let deal: any;
let otherDeal: any;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Deal quotes WS' });
  other = new Client();
  await other.signup({ workspaceName: 'Other deal quotes WS' });
  company = (await owner.post('/companies', { name: 'ООО «Покупатель»' })).body.id;
  deal = (await owner.post('/deals', { name: 'Сделка', companyId: company })).body;
  otherDeal = (await other.post('/deals', { name: 'Чужая сделка', companyId: (await other.post('/companies', { name: 'Чужой' })).body.id })).body;
});

describe('КП из сделки', () => {
  test('КП получает контрагента сделки и связь со сделкой', async () => {
    const r = await owner.post('/documents', { type: 'quote', dealId: deal.id });
    expect(r.status).toBe(201);
    expect(r.body.dealId).toBe(deal.id);
    expect(r.body.counterpartyId).toBe(company);
  });

  test('список документов фильтруется по сделке', async () => {
    await owner.post('/documents', { type: 'quote', counterpartyId: company });
    const r = await owner.get(`/documents?type=quote&dealId=${deal.id}`);
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBe(1);
    expect(r.body.items[0].dealId).toBe(deal.id);
  });

  test('другой контрагент, сделка без контрагента и чужая сделка отклоняются', async () => {
    const stranger = (await owner.post('/companies', { name: 'Другой' })).body.id;
    expect((await owner.post('/documents', { type: 'quote', dealId: deal.id, counterpartyId: stranger })).body.error.code).toBe('deal_counterparty_mismatch');
    const bare = (await owner.post('/deals', { name: 'Без компании' })).body;
    expect((await owner.post('/documents', { type: 'quote', dealId: bare.id })).body.error.code).toBe('deal_company_required');
    expect((await owner.post('/documents', { type: 'quote', dealId: otherDeal.id })).status).toBe(422);
  });

  test('чужой воркспейс не видит КП сделки', async () => {
    const r = await other.get(`/documents?dealId=${deal.id}`);
    expect(r.body.items).toEqual([]);
  });

  test('документ на основании КП остаётся в сделке', async () => {
    const product = (await owner.post('/products', { name: 'Товар', sku: 'DQ-1', kind: 'goods', price: 100, vatRate: 'none' })).body.id;
    const q = (await owner.post('/documents', { type: 'quote', dealId: deal.id, lines: [{ productId: product, qty: '1', price: '100', vatRate: 'none' }] })).body;
    expect((await owner.post(`/documents/${q.id}/post`)).status).toBe(200);
    const r = await owner.post(`/documents/${q.id}/based-on`, { type: 'customer_order' });
    expect(r.status).toBeLessThan(300);
    expect(r.body.dealId).toBe(deal.id);
  });
});
