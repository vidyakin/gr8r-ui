/* Загрузка прайсов поставщиков (сервис packages/db/src/supplier-prices.ts): профили формата, разбор по first_row,
   сопоставление по артикулам контрагента, вид цен поставщика, файл-вложение; разбор строк; применение цен. */
import { beforeAll, describe, expect, test } from 'bun:test';
import {
  archiveSupplierProfile,
  getSupplierPrice,
  listSupplierPriceLines,
  listSupplierProfiles,
  MemoryFileStore,
  saveSupplierProfile,
  setFileStore,
  uploadSupplierPrice,
  updateSupplierPriceLine,
  matchSupplierLinesByName,
  createProductsForSupplierLines,
  withContext,
  type Actor,
  type Db,
} from '@gr8r/db';
import { admin, Client, sql } from './helpers';

let owner: Client;
let ws: string;
let actor: Actor;
let supplier: string;
let supplier2: string;
let bolt: string;
let nut: string;
let nutDup: string;
let profileId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const run = <T>(fn: (db: Db) => Promise<T>): Promise<T> => withContext(sql, { workspaceId: ws, userId: owner.user!.id }, db => fn(db));
const article = (company: string, product: string, art: string) => owner.put(`/companies/${company}/articles/${product}`, { article: art });
const errCode = async (p: Promise<unknown>) => ((await p.then(() => null, e => e)) as { code?: string } | null)?.code;

/** Таблица прайса: две строки шапки, затем данные. Колонки: A артикул, B наименование, C цена, D единица */
const table = (...data: string[][]): string[][] => [['Прайс ООО'], ['Арт.', 'Наименование', 'Цена', 'Ед.'], ...data];

beforeAll(async () => {
  setFileStore(new MemoryFileStore());
  owner = new Client();
  await owner.signup({ workspaceName: 'Прайсы поставщиков WS' });
  ws = owner.workspaceId!;
  const [m] = await admin`select id from members where workspace_id = ${ws} and user_id = ${owner.user!.id}`;
  actor = { workspaceId: ws, memberId: m!.id as string, role: 'owner' };
  supplier = (await mk(owner, '/companies', { name: 'ООО «Ромашка»' })).id;
  supplier2 = (await mk(owner, '/companies', { name: 'ООО «Второй»' })).id;
  bolt = (await mk(owner, '/products', { name: 'Болт М8', unitCode: '796', price: 10, vatRate: '20' })).id;
  nut = (await mk(owner, '/products', { name: 'Гайка М8', unitCode: '796', price: 5, vatRate: '20' })).id;
  nutDup = (await mk(owner, '/products', { name: 'Гайка М8 оцинк.', unitCode: '796', price: 6, vatRate: '20' })).id;
  await article(supplier, bolt, 'B-8');
  await article(supplier, nut, 'N-8');
  await article(supplier, nutDup, 'N-8'); // тот же артикул у двух товаров — конфликт
  await article(supplier2, bolt, 'OTHER-1'); // артикул другого поставщика не должен находиться
});

describe('профили формата', () => {
  test('создание, обновление, список, уникальность названия, архив', async () => {
    const p = await run(db => saveSupplierProfile(db, actor, { companyId: supplier, name: 'Розница 2026', firstRow: 3, articleCol: 1, nameCol: 2, priceCol: 3, unitCol: 4 }));
    profileId = p.id;
    expect(p).toMatchObject({ firstRow: 3, articleCol: 1, nameCol: 2, priceCol: 3, unitCol: 4 });
    const upd = await run(db => saveSupplierProfile(db, actor, { id: p.id, companyId: supplier, name: 'Розница 2026', firstRow: 3, articleCol: 1, nameCol: 2, priceCol: 3, unitCol: null }));
    expect(upd.unitCol).toBeNull();
    await run(db => saveSupplierProfile(db, actor, { id: p.id, companyId: supplier, name: 'Розница 2026', firstRow: 3, articleCol: 1, nameCol: 2, priceCol: 3, unitCol: 4 }));
    expect(await errCode(run(db => saveSupplierProfile(db, actor, { companyId: supplier, name: ' розница 2026 ', firstRow: 1, articleCol: 1, priceCol: 2 })))).toBe('supplier_profile_exists');
    expect(await errCode(run(db => saveSupplierProfile(db, actor, { companyId: supplier, name: 'X', firstRow: 0, articleCol: 1, priceCol: 2 })))).toBe('supplier_profile_invalid');
    // то же имя у другого поставщика допустимо
    const other = await run(db => saveSupplierProfile(db, actor, { companyId: supplier2, name: 'Розница 2026', firstRow: 1, articleCol: 1, priceCol: 2 }));
    expect((await run(db => listSupplierProfiles(db, ws, supplier))).map(x => x.id)).toEqual([p.id]);
    await run(db => archiveSupplierProfile(db, actor, other.id));
    expect(await run(db => listSupplierProfiles(db, ws, supplier2))).toHaveLength(0);
    // после архива имя свободно
    await run(db => saveSupplierProfile(db, actor, { companyId: supplier2, name: 'Розница 2026', firstRow: 1, articleCol: 1, priceCol: 2 }));
  });
});

describe('загрузка прайса', () => {
  test('first_row, пустые строки, цена с запятой и пробелами, нечисловая — skipped', async () => {
    const rows = table(['B-8', 'Болт М8 (файл)', '1 234,50', 'шт'], ['', '', '', ''], ['N-8', 'Гайка', '7,2', ''], ['X-1', 'Шайба', 'по запросу', 'кг'], ['Z-9', 'Заглушка', '3', 'шт']);
    const { price, lines } = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-01', pricesIncludeVat: true, rows }));
    // шапка (строки 1–2) пропущена, пустая строка не записана
    expect(lines.map(l => l.rowNo)).toEqual([3, 5, 6, 7]);
    const byArt = Object.fromEntries(lines.map(l => [l.article, l]));
    expect(byArt['B-8']).toMatchObject({ price: '1234.50', status: 'matched', productId: bolt, unitCode: '796' });
    expect(byArt['N-8']).toMatchObject({ price: '7.20', status: 'conflict', productId: null, unitCode: null });
    expect([...byArt['N-8']!.candidates].sort()).toEqual([nut, nutDup].sort());
    expect(byArt['X-1']).toMatchObject({ status: 'skipped', note: 'price_invalid', price: null });
    expect(byArt['Z-9']).toMatchObject({ status: 'unmatched', productId: null });
    expect(price).toMatchObject({ status: 'draft', linesTotal: 4, linesMatched: 1, linesConflict: 1, linesUnmatched: 1, date: '2026-11-01' });
  });

  test('единица текстом: по названию и символу без регистра, неизвестная — штука', async () => {
    const [u] = await admin`select code, name, symbol from units where workspace_id = ${ws} and code <> '796' and symbol <> '' limit 1`;
    expect(u).toBeTruthy();
    const rows = table(['U-1', 'a', '1', String(u!.name).toUpperCase()], ['U-2', 'b', '1', String(u!.symbol)], ['U-3', 'c', '1', 'бочка-неведомая']);
    const { lines } = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-02', pricesIncludeVat: true, rows }));
    expect(lines.map(l => l.unitCode)).toEqual([u!.code as string, u!.code as string, '796']);
  });

  test('автосоздание вида цен поставщика один раз; файл — вложение supplier_price', async () => {
    const kinds = await admin`select id, name, method, supplier_id from price_kinds where workspace_id = ${ws} and supplier_id = ${supplier} and archived_at is null`;
    expect(kinds).toHaveLength(1);
    expect(kinds[0]).toMatchObject({ name: 'Цены ООО «Ромашка»', method: 'manual' });
    const data = new TextEncoder().encode('Арт.;Цена\nB-8;100');
    const { price } = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-03', pricesIncludeVat: false, rows: table(['B-8', 'x', '100', '']), file: { name: 'price.csv', mime: 'text/csv', data } }));
    expect(price).toMatchObject({ kindId: kinds[0]!.id, fileName: 'price.csv', fileSize: data.length, pricesIncludeVat: false });
    expect(price.attachmentId).toBeTruthy();
    const [att] = await admin`select entity_type, entity_id from attachments where id = ${price.attachmentId!}`;
    expect(att).toMatchObject({ entity_type: 'supplier_price', entity_id: price.id });
    expect(await admin`select id from price_kinds where workspace_id = ${ws} and supplier_id = ${supplier} and archived_at is null`).toHaveLength(1);
  });

  test('имя вида цен занято — «(2)»', async () => {
    const s3 = (await mk(owner, '/companies', { name: 'Занятый' })).id;
    await mk(owner, '/price-kinds', { name: 'Цены Занятый', method: 'manual' }).catch(() => admin`insert into price_kinds (workspace_id, name, method) values (${ws}, 'Цены Занятый', 'manual')`);
    const p = await run(db => saveSupplierProfile(db, actor, { companyId: s3, name: 'p', firstRow: 1, articleCol: 1, priceCol: 2 }));
    const { price } = await run(db => uploadSupplierPrice(db, actor, { companyId: s3, profileId: p.id, date: '2026-11-01', pricesIncludeVat: true, rows: [['A', '1']] }));
    const [k] = await admin`select name from price_kinds where id = ${price.kindId}`;
    expect(k!.name).toBe('Цены Занятый (2)');
  });

  test('пустой файл и чужой профиль', async () => {
    expect(await errCode(run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-01', pricesIncludeVat: true, rows: table() })))).toBe('supplier_price_empty');
    const p2 = (await run(db => listSupplierProfiles(db, ws, supplier2)))[0]!;
    expect(await errCode(run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId: p2.id, date: '2026-11-01', pricesIncludeVat: true, rows: table(['A', '', '1', '']) })))).toBe('not_found');
  });

  test('повторная загрузка находит по сохранённому артикулу; артикул другого поставщика не совпадает', async () => {
    const { lines } = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-04', pricesIncludeVat: true, rows: table(['b-8', '', '9', ''], ['OTHER-1', '', '9', '']) }));
    expect(lines.map(l => [l.status, l.productId])).toEqual([['matched', bolt], ['unmatched', null]]);
    expect((await run(db => listSupplierPriceLines(db, ws, lines[0]!.priceId))).length).toBe(2);
    expect((await run(db => getSupplierPrice(db, ws, lines[0]!.priceId))).linesMatched).toBe(1);
  });
});

describe('разбор строк', () => {
  test('привязка, поиск по названиям, создание товара, пропуск; повторная загрузка находит по артикулу', async () => {
    const washer = (await mk(owner, '/products', { name: 'Шайба 8', unitCode: '796', price: 1, vatRate: '20' })).id;
    const dup1 = (await mk(owner, '/products', { name: 'Дубль', unitCode: '796', price: 1, vatRate: '20' })).id;
    const dup2 = (await mk(owner, '/products', { name: 'дубль', unitCode: '796', price: 1, vatRate: '20' })).id;
    const rows = table(['W-1', '  шайба 8 ', '2', 'шт'], ['D-1', 'Дубль', '3', ''], ['NEW-1', 'Новинка товар', '4,5', 'шт'], ['NEW-2', 'Лишнее', '5', ''], ['', 'Без артикула', '6', '']);
    const { price, lines } = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-05', pricesIncludeVat: true, rows }));
    const at = (art: string) => lines.find(l => l.article === art)!;
    expect(price.linesUnmatched).toBe(5);

    // поиск по названиям: один товар — подставлен, два — кандидаты, нет — остаётся
    const m = await run(db => matchSupplierLinesByName(db, actor, price.id));
    expect(m).toEqual({ matched: 1, ambiguous: 1, notFound: 3 });
    const after = await run(db => listSupplierPriceLines(db, ws, price.id));
    const get = (art: string) => after.find(l => l.article === art)!;
    expect(get('W-1')).toMatchObject({ status: 'matched', productId: washer });
    expect(get('D-1')).toMatchObject({ status: 'unmatched', productId: null });
    expect([...get('D-1').candidates].sort()).toEqual([dup1, dup2].sort());
    expect((await owner.get(`/products/${washer}/articles`)).body.items[0]).toMatchObject({ article: 'W-1' });

    // ручной выбор из кандидатов записывает артикул
    const bound = await run(db => updateSupplierPriceLine(db, actor, price.id, at('D-1').id, { productId: dup2 }));
    expect(bound).toMatchObject({ status: 'matched', productId: dup2, candidates: [] });
    expect((await owner.get(`/products/${dup2}/articles`)).body.items[0]).toMatchObject({ article: 'D-1' });

    // пропуск и снятие пропуска
    const sk = await run(db => updateSupplierPriceLine(db, actor, price.id, at('NEW-2').id, { skip: true }));
    expect(sk).toMatchObject({ status: 'skipped', note: 'manual' });
    expect((await run(db => getSupplierPrice(db, ws, price.id))).linesUnmatched).toBe(2);
    expect(await run(db => updateSupplierPriceLine(db, actor, price.id, at('NEW-2').id, { skip: false }))).toMatchObject({ status: 'unmatched', note: '' });

    // создание товаров для выбранной строки, затем для всех оставшихся
    const c1 = await run(db => createProductsForSupplierLines(db, actor, price.id, [at('NEW-1').id]));
    expect(c1).toEqual({ created: 1, skipped: 0 });
    const created = (await run(db => listSupplierPriceLines(db, ws, price.id))).find(l => l.article === 'NEW-1')!;
    expect(created.status).toBe('matched');
    const [np] = await admin`select name, unit_code, price, vat_rate, kind from products where id = ${created.productId!}`;
    expect(np).toMatchObject({ name: 'Новинка товар', unit_code: '796', price: '0.00', vat_rate: '20', kind: 'goods' });
    expect((await owner.get(`/products/${created.productId}/articles`)).body.items[0]).toMatchObject({ article: 'NEW-1' });
    const c2 = await run(db => createProductsForSupplierLines(db, actor, price.id));
    expect(c2.created).toBe(2); // NEW-2 и строка без артикула (по названию)
    const final = await run(db => getSupplierPrice(db, ws, price.id));
    expect(final).toMatchObject({ linesMatched: 5, linesUnmatched: 0, linesTotal: 5 });

    // повторная загрузка: все находятся по артикулу
    const again = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-06', pricesIncludeVat: true, rows: table(['W-1', '', '2', ''], ['D-1', '', '3', ''], ['NEW-1', '', '4', ''], ['NEW-2', '', '5', '']) }));
    expect(again.lines.map(l => l.status)).toEqual(['matched', 'matched', 'matched', 'matched']);
  });

  test('строка с неверной ценой не привязывается; чужая строка — 404', async () => {
    const { price, lines } = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-07', pricesIncludeVat: true, rows: table(['Q-1', 'q', 'abc', '']) }));
    expect(await errCode(run(db => updateSupplierPriceLine(db, actor, price.id, lines[0]!.id, { productId: bolt })))).toBe('supplier_line_price_invalid');
    expect(await errCode(run(db => updateSupplierPriceLine(db, actor, price.id, price.id, { skip: true })))).toBe('not_found');
  });
});
