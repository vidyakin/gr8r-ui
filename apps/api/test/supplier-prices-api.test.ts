/* Загрузка прайсов поставщиков через HTTP (/pricing/supplier-*): профиль → превью → загрузка → разбор → применение → цена товара. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { MemoryFileStore, setFileStore } from '@gr8r/db';
import { buildXlsx } from '../src/xlsx';
import { addMember, admin, Client } from './helpers';

let owner: Client;
let member: Client;
let ws: string;
let supplier: string;
let bolt: string;
let nut: string;
let nutDup: string;
let washer: string;
let profileId: string;

type Row = (string | number)[];
const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const xlsxFile = (rows: Row[], name = 'price.xlsx') => new File([buildXlsx('Прайс', rows) as unknown as BlobPart], name);
const grid = (...data: Row[]): Row[] => [['Прайс ООО «Ромашка»'], ['Арт.', 'Наименование', 'Цена', 'Ед.'], ...data];
const upload = (c: Client, rows: Row[], over: Record<string, string> = {}) => {
  const f = new FormData();
  f.set('file', xlsxFile(rows));
  for (const [k, v] of Object.entries({ companyId: supplier, profileId, date: '2026-01-01', pricesIncludeVat: 'true', ...over })) f.set(k, v);
  return c.form('POST', '/pricing/supplier-prices/upload', f);
};

beforeAll(async () => {
  setFileStore(new MemoryFileStore());
  owner = new Client();
  await owner.signup({ workspaceName: 'Прайсы API WS' });
  ws = owner.workspaceId!;
  member = await addMember(owner, 'member');
  supplier = (await mk(owner, '/companies', { name: 'ООО «Ромашка API»' })).id;
  bolt = (await mk(owner, '/products', { name: 'Болт М8', unitCode: '796', price: 10, vatRate: '20' })).id;
  nut = (await mk(owner, '/products', { name: 'Гайка М8', unitCode: '796', price: 5, vatRate: '20' })).id;
  nutDup = (await mk(owner, '/products', { name: 'Гайка М8 оцинк.', unitCode: '796', price: 6, vatRate: '20' })).id;
  washer = (await mk(owner, '/products', { name: 'Шайба М8', unitCode: '796', price: 1, vatRate: '20' })).id;
  for (const [p, a] of [[bolt, 'B-8'], [nut, 'N-8'], [nutDup, 'N-8']] as const) {
    const r = await owner.put(`/companies/${supplier}/articles/${p}`, { article: a });
    if (r.status >= 300) throw new Error(`article: ${r.status}`);
  }
});

describe('права', () => {
  test('участник получает 403 на все маршруты прайсов поставщиков', async () => {
    const fake = '00000000-0000-4000-8000-000000000000';
    const f = new FormData();
    f.set('file', xlsxFile(grid()));
    const calls = [
      member.get(`/pricing/supplier-profiles?companyId=${supplier}`),
      member.post('/pricing/supplier-profiles', { companyId: supplier, name: 'x', firstRow: 1, articleCol: 1, priceCol: 2 }),
      member.form('POST', '/pricing/supplier-profiles/preview', f),
      member.get(`/pricing/supplier-prices?companyId=${supplier}`),
      member.form('POST', '/pricing/supplier-prices/upload', f),
      member.get(`/pricing/supplier-prices/${fake}`),
      member.del(`/pricing/supplier-prices/${fake}`),
      member.patch(`/pricing/supplier-prices/${fake}/lines/${fake}`, { skip: true }),
      member.post(`/pricing/supplier-prices/${fake}/match-by-name`, {}),
      member.post(`/pricing/supplier-prices/${fake}/create-products`, {}),
      member.post(`/pricing/supplier-prices/${fake}/apply`, {}),
      member.get(`/pricing/products/${bolt}/suppliers`),
    ];
    for (const r of await Promise.all(calls)) expect(r.status).toBe(403);
  });
});

describe('сценарий', () => {
  let priceId: string;
  let lines: any[];

  test('профиль: создание, превью файла-образца, список', async () => {
    const f = new FormData();
    f.set('file', xlsxFile(grid(['B-8', 'Болт', 100, 'шт'])));
    const pv = await owner.form('POST', '/pricing/supplier-profiles/preview', f);
    expect(pv.status).toBe(200);
    expect(pv.body.columns).toBe(4);
    expect(pv.body.rows[1]).toEqual(['Арт.', 'Наименование', 'Цена', 'Ед.']);
    const csv = new FormData();
    csv.set('file', new File(['Арт.;Цена\nB-8;5'], 'p.csv'));
    expect((await owner.form('POST', '/pricing/supplier-profiles/preview', csv)).body.totalRows).toBe(2);

    const body = { companyId: supplier, name: 'Розница', firstRow: 3, articleCol: 1, nameCol: 2, priceCol: 3, unitCol: 4 };
    const c = await owner.post('/pricing/supplier-profiles', body);
    expect(c.status).toBe(201);
    profileId = c.body.id;
    expect((await owner.post('/pricing/supplier-profiles', { ...body, id: profileId })).status).toBe(200);
    expect((await owner.post('/pricing/supplier-profiles', { ...body, name: 'розница' })).body.error.code).toBe('supplier_profile_exists');
    const l = await owner.get(`/pricing/supplier-profiles?companyId=${supplier}`);
    expect(l.body.items.map((p: any) => p.id)).toEqual([profileId]);
  });

  test('загрузка: first_row, сопоставление по артикулу, вложение', async () => {
    const r = await upload(owner, grid(['B-8', 'Болт М8', 100, 'шт'], ['N-8', 'Гайка М8', '7,2', 'шт'], ['W-1', 'Шайба М8', 3, 'шт'], ['Z-9', 'Новинка', 12, 'шт']));
    expect(r.status).toBe(201);
    priceId = r.body.price.id;
    lines = r.body.lines;
    expect(lines.map((x: any) => x.rowNo)).toEqual([3, 4, 5, 6]);
    expect(r.body.price).toMatchObject({ status: 'draft', linesTotal: 4, linesMatched: 1, linesConflict: 1, linesUnmatched: 2, fileName: 'price.xlsx' });
    expect(lines[0]).toMatchObject({ status: 'matched', productId: bolt });
    expect(lines[1].status).toBe('conflict');
    const [att] = await admin`select entity_type from attachments where id = ${r.body.price.attachmentId}`;
    expect(att!.entity_type).toBe('supplier_price');
    const list = await owner.get(`/pricing/supplier-prices?companyId=${supplier}`);
    expect(list.body.items.map((p: any) => p.id)).toEqual([priceId]);
  });

  test('ошибки загрузки: неверная дата, пустой разбор, нет файла', async () => {
    expect((await upload(owner, grid(['B-8', '', 1, '']), { date: '01.01.2026' })).body.error.code).toBe('validation_error');
    expect((await upload(owner, grid())).body.error.code).toBe('supplier_price_empty');
    const f = new FormData();
    f.set('companyId', supplier);
    expect((await owner.form('POST', '/pricing/supplier-prices/upload', f)).status).toBe(400);
  });

  test('conflict → выбор кандидата вручную', async () => {
    const det = await owner.get(`/pricing/supplier-prices/${priceId}?status=conflict`);
    expect(det.body.lines).toHaveLength(1);
    expect(det.body.products.map((p: any) => p.id).sort()).toEqual([nut, nutDup].sort());
    const r = await owner.patch(`/pricing/supplier-prices/${priceId}/lines/${lines[1].id}`, { productId: nut });
    expect(r.status).toBe(200);
    expect(r.body.line).toMatchObject({ status: 'matched', productId: nut });
    expect(r.body.price).toMatchObject({ linesMatched: 2, linesConflict: 0 });
    expect((await owner.patch(`/pricing/supplier-prices/${priceId}/lines/${lines[1].id}`, {})).status).toBe(400);
  });

  test('unmatched → поиск по названиям → создание товара', async () => {
    const m = await owner.post(`/pricing/supplier-prices/${priceId}/match-by-name`, {});
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ matched: 1, notFound: 1 });
    const [a] = await admin`select article from product_partner_articles where workspace_id = ${ws} and company_id = ${supplier} and product_id = ${washer}`;
    expect(a!.article).toBe('W-1');
    const c = await owner.post(`/pricing/supplier-prices/${priceId}/create-products`, {});
    expect(c.body).toMatchObject({ created: 1 });
    expect(c.body.price).toMatchObject({ linesMatched: 4, linesUnmatched: 0 });
    expect(await admin`select id from products where workspace_id = ${ws} and name = 'Новинка'`).toHaveLength(1);
  });

  test('сводка, применение, цена в /pricing/products/:id/suppliers', async () => {
    const pv = await owner.get(`/pricing/supplier-prices/${priceId}/preview-apply`);
    expect(pv.status).toBe(200);
    expect(pv.body.items).toHaveLength(4);
    expect(pv.body.items.find((i: any) => i.productId === bolt)).toMatchObject({ current: null, next: '100.00' });
    const ap = await owner.post(`/pricing/supplier-prices/${priceId}/apply`, {});
    expect(ap.status).toBe(200);
    expect(ap.body).toMatchObject({ applied: 4, price: { status: 'applied' } });
    const s = await owner.get(`/pricing/products/${bolt}/suppliers`);
    expect(s.status).toBe(200);
    expect(s.body.items).toHaveLength(1);
    expect(s.body.items[0]).toMatchObject({ companyId: supplier, article: 'B-8' });
    expect(Number(s.body.items[0].price)).toBe(100);
    expect(Number((await owner.get(`/pricing/products/${nut}/suppliers`)).body.items[0].price)).toBe(7.2);
    expect((await owner.patch(`/pricing/supplier-prices/${priceId}/lines/${lines[0].id}`, { skip: true })).body.error.code).toBe('supplier_price_applied');
    expect((await owner.del(`/pricing/supplier-prices/${priceId}`)).body.error.code).toBe('supplier_price_applied');
  });

  test('удаление черновика: строки и файл', async () => {
    const r = await upload(owner, grid(['B-8', 'Болт', 1, '']));
    const id = r.body.price.id;
    const att = r.body.price.attachmentId;
    expect((await owner.del(`/pricing/supplier-prices/${id}`)).status).toBe(200);
    expect((await owner.get(`/pricing/supplier-prices/${id}`)).status).toBe(404);
    expect(await admin`select id from supplier_price_lines where price_id = ${id}`).toHaveLength(0);
    const [a] = await admin`select archived_at from attachments where id = ${att}`;
    expect(a!.archived_at).not.toBeNull();
  });

  test('архив профиля', async () => {
    expect((await owner.del(`/pricing/supplier-profiles/${profileId}`)).status).toBe(200);
    expect((await owner.get(`/pricing/supplier-profiles?companyId=${supplier}`)).body.items).toHaveLength(0);
  });
});
