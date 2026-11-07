/* Коды и номенклатура контрагентов: наш код у контрагента по организациям, артикулы товаров у контрагента,
   подбор товара по артикулу, артикул в карточке документа и печать заказа поставщику, изоляция арендаторов и права. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let guest: Client;
let other: Client;
let ws: string;
let orgId: string;
let supplier: string;
let supplier2: string;
let wood: string;
let screw: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Partner codes WS' });
  ws = owner.workspaceId!;
  guest = new Client();
  await guest.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: guest.user!.email, role: 'guest' });
  await guest.post('/invites/accept', { token: inv.body.token });
  guest.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Partner codes other WS' });
  orgId = (await owner.get('/organizations')).body.items[0].id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»', inn: '7728168971' })).id;
  supplier2 = (await mk(owner, '/companies', { name: 'ООО «Второй»' })).id;
  wood = (await mk(owner, '/products', { name: 'Брус', unitCode: '006', price: 100, purchasePrice: 80, vatRate: '20' })).id;
  screw = (await mk(owner, '/products', { name: 'Шуруп', price: 3, purchasePrice: 1.5, vatRate: '20' })).id;
});

describe('наш код у контрагента', () => {
  test('по каждой организации: задать, прочитать, очистить', async () => {
    let list = (await owner.get(`/companies/${supplier}/codes`)).body.items as any[];
    expect(list.find(x => x.organizationId === orgId)?.code).toBeNull();
    expect((await owner.put(`/companies/${supplier}/codes/${orgId}`, { code: ' K-1001 ' })).body.code).toBe('K-1001');
    list = (await owner.get(`/companies/${supplier}/codes`)).body.items;
    expect(list.find(x => x.organizationId === orgId)?.code).toBe('K-1001');
    // повторная запись обновляет, а не дублирует
    await owner.put(`/companies/${supplier}/codes/${orgId}`, { code: 'K-2002' });
    expect(((await owner.get(`/companies/${supplier}/codes`)).body.items as any[]).find(x => x.organizationId === orgId)?.code).toBe('K-2002');
    // пустой код удаляет
    expect((await owner.put(`/companies/${supplier}/codes/${orgId}`, { code: '' })).body.code).toBeNull();
    expect(((await owner.get(`/companies/${supplier}/codes`)).body.items as any[]).find(x => x.organizationId === orgId)?.code).toBeNull();
  });

  test('гость читает, но не пишет; чужой арендатор не видит', async () => {
    expect((await guest.put(`/companies/${supplier}/codes/${orgId}`, { code: 'X' })).status).toBe(403);
    expect((await guest.get(`/companies/${supplier}/codes`)).status).toBe(200);
    expect((await other.get(`/companies/${supplier}/codes`)).status).toBe(404);
    expect((await other.put(`/companies/${supplier}/codes/${orgId}`, { code: 'X' })).status).toBe(404);
  });
});

describe('номенклатура контрагента', () => {
  test('артикулы: задать, читать со стороны контрагента и товара, удалить', async () => {
    const put = await owner.put(`/companies/${supplier}/articles/${wood}`, { article: ' BR-50 ', name: 'Брус 50x50' });
    expect(put.status).toBe(200);
    expect(put.body.article).toBe('BR-50');
    await owner.put(`/companies/${supplier2}/articles/${wood}`, { article: 'W-7' });
    const byCompany = (await owner.get(`/companies/${supplier}/articles`)).body.items as any[];
    expect(byCompany).toHaveLength(1);
    expect(byCompany[0]).toMatchObject({ productId: wood, article: 'BR-50', name: 'Брус 50x50', productName: 'Брус' });
    const byProduct = (await owner.get(`/products/${wood}/articles`)).body.items as any[];
    expect(byProduct.map(x => x.article).sort()).toEqual(['BR-50', 'W-7']);
    // повторная запись обновляет
    await owner.put(`/companies/${supplier}/articles/${wood}`, { article: 'BR-51', name: '' });
    expect(((await owner.get(`/companies/${supplier}/articles`)).body.items as any[])[0]).toMatchObject({ article: 'BR-51', name: '' });
    // пустая пара удаляет
    expect((await owner.put(`/companies/${supplier2}/articles/${wood}`, { article: '', name: '' })).body.deleted).toBe(true);
    expect((await owner.get(`/products/${wood}/articles`)).body.items).toHaveLength(1);
    expect((await owner.del(`/companies/${supplier}/articles/${wood}`)).status).toBe(200);
    expect((await owner.del(`/companies/${supplier}/articles/${wood}`)).status).toBe(404);
  });

  test('права и изоляция', async () => {
    expect((await guest.put(`/companies/${supplier}/articles/${wood}`, { article: 'X' })).status).toBe(403);
    expect((await other.put(`/companies/${supplier}/articles/${wood}`, { article: 'X' })).status).toBe(404);
    expect((await other.get(`/products/${wood}/articles`)).status).toBe(404);
  });

  test('подбор товара: ?counterpartyId= ищет и по артикулу контрагента', async () => {
    await owner.put(`/companies/${supplier}/articles/${screw}`, { article: 'SCR-9', name: 'Саморез кровельный' });
    const find = async (q: string, cp?: string) => ((await owner.get(`/products?q=${encodeURIComponent(q)}${cp ? `&counterpartyId=${cp}` : ''}`)).body.items as any[]).map(p => p.id);
    expect(await find('SCR-9')).toEqual([]);
    expect(await find('SCR-9', supplier)).toEqual([screw]);
    expect(await find('кровельный', supplier)).toEqual([screw]);
    // артикул другого контрагента не находит
    expect(await find('SCR-9', supplier2)).toEqual([]);
    // обычный поиск по названию работает и с контрагентом
    expect(await find('Брус', supplier)).toEqual([wood]);
  });

  test('карточка документа и печать заказа поставщику с артикулом и нашим кодом', async () => {
    await owner.put(`/companies/${supplier}/articles/${wood}`, { article: 'BR-50', name: 'Брус 50x50' });
    await owner.put(`/companies/${supplier}/codes/${orgId}`, { code: 'CL-777' });
    const d = await mk(owner, '/documents', { type: 'supplier_order', counterpartyId: supplier, lines: [{ productId: wood, qty: 2, price: 80 }, { productId: screw, qty: 10, price: 2 }] });
    const detail = (await owner.get(`/documents/${d.id}`)).body;
    const byProduct = Object.fromEntries(detail.lines.map((l: any) => [l.productId, l]));
    expect(byProduct[wood]).toMatchObject({ partnerArticle: 'BR-50', partnerName: 'Брус 50x50' });
    expect(byProduct[screw]).toMatchObject({ partnerArticle: 'SCR-9' });
    const html = (await owner.get(`/documents/${d.id}/print/supplier_order`)).body as string;
    expect(html).toContain('Заказ поставщику');
    expect(html).toContain('BR-50');
    expect(html).toContain('SCR-9');
    expect(html).toContain('CL-777');
    // у документа с другим контрагентом артикулов нет
    const d2 = await mk(owner, '/documents', { type: 'supplier_order', counterpartyId: supplier2, lines: [{ productId: wood, qty: 1, price: 80 }] });
    const detail2 = (await owner.get(`/documents/${d2.id}`)).body;
    expect(detail2.lines[0].partnerArticle).toBe('');
    expect(((await owner.get(`/documents/${d2.id}/print/supplier_order`)).body as string)).not.toContain('CL-777');
  });
});
