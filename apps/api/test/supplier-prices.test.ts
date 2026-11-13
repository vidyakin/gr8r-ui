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
  applySupplierPrice,
  previewSupplierPriceApply,
  recordPriceKindPrice,
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
    const p = await run(db => saveSupplierProfile(db, actor, { companyId: supplier, name: 'Розница 2026', firstRow: 3, articleCol: 1, nameCol: 2, priceGrossCol: 3, unitCol: 4 }));
    profileId = p.id;
    expect(p).toMatchObject({ firstRow: 3, articleCol: 1, nameCol: 2, priceGrossCol: 3, priceNetCol: null, unitCol: 4 });
    const upd = await run(db => saveSupplierProfile(db, actor, { id: p.id, companyId: supplier, name: 'Розница 2026', firstRow: 3, articleCol: 1, nameCol: 2, priceGrossCol: 3, unitCol: null }));
    expect(upd.unitCol).toBeNull();
    await run(db => saveSupplierProfile(db, actor, { id: p.id, companyId: supplier, name: 'Розница 2026', firstRow: 3, articleCol: 1, nameCol: 2, priceGrossCol: 3, unitCol: 4 }));
    expect(await errCode(run(db => saveSupplierProfile(db, actor, { companyId: supplier, name: ' розница 2026 ', firstRow: 1, articleCol: 1, priceGrossCol: 2 })))).toBe('supplier_profile_exists');
    expect(await errCode(run(db => saveSupplierProfile(db, actor, { companyId: supplier, name: 'X', firstRow: 0, articleCol: 1, priceGrossCol: 2 })))).toBe('supplier_profile_invalid');
    // нужна хотя бы одна колонка цены
    expect(await errCode(run(db => saveSupplierProfile(db, actor, { companyId: supplier, name: 'Y', firstRow: 1, articleCol: 1 })))).toBe('supplier_profile_invalid');
    // то же имя у другого поставщика допустимо
    const other = await run(db => saveSupplierProfile(db, actor, { companyId: supplier2, name: 'Розница 2026', firstRow: 1, articleCol: 1, priceGrossCol: 2 }));
    expect((await run(db => listSupplierProfiles(db, ws, supplier))).map(x => x.id)).toEqual([p.id]);
    await run(db => archiveSupplierProfile(db, actor, other.id));
    expect(await run(db => listSupplierProfiles(db, ws, supplier2))).toHaveLength(0);
    // после архива имя свободно
    await run(db => saveSupplierProfile(db, actor, { companyId: supplier2, name: 'Розница 2026', firstRow: 1, articleCol: 1, priceGrossCol: 2 }));
  });
});

describe('загрузка прайса', () => {
  test('first_row, пустые строки, цена с запятой и пробелами, нечисловая — skipped', async () => {
    const rows = table(['B-8', 'Болт М8 (файл)', '1 234,50', 'шт'], ['', '', '', ''], ['N-8', 'Гайка', '7,2', ''], ['X-1', 'Шайба', 'по запросу', 'кг'], ['Z-9', 'Заглушка', '3', 'шт']);
    const { price, lines } = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-01', rows }));
    // шапка (строки 1–2) пропущена, пустая строка не записана
    expect(lines.map(l => l.rowNo)).toEqual([3, 5, 6, 7]);
    const byArt = Object.fromEntries(lines.map(l => [l.article, l]));
    expect(byArt['B-8']).toMatchObject({ priceGross: '1234.50', status: 'matched', productId: bolt, unitCode: '796' });
    expect(byArt['N-8']).toMatchObject({ priceGross: '7.20', status: 'conflict', productId: null, unitCode: null });
    expect([...byArt['N-8']!.candidates].sort()).toEqual([nut, nutDup].sort());
    expect(byArt['X-1']).toMatchObject({ status: 'skipped', note: 'price_invalid', priceGross: null, priceNet: null });
    expect(byArt['Z-9']).toMatchObject({ status: 'unmatched', productId: null });
    expect(price).toMatchObject({ status: 'draft', linesTotal: 4, linesMatched: 1, linesConflict: 1, linesUnmatched: 1, date: '2026-11-01' });
  });

  test('единица текстом: по названию и символу без регистра, неизвестная — штука', async () => {
    const [u] = await admin`select code, name, symbol from units where workspace_id = ${ws} and code <> '796' and symbol <> '' limit 1`;
    expect(u).toBeTruthy();
    const rows = table(['U-1', 'a', '1', String(u!.name).toUpperCase()], ['U-2', 'b', '1', String(u!.symbol)], ['U-3', 'c', '1', 'бочка-неведомая']);
    const { lines } = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-02', rows }));
    expect(lines.map(l => l.unitCode)).toEqual([u!.code as string, u!.code as string, '796']);
  });

  test('автосоздание вида цен поставщика один раз; файл — вложение supplier_price', async () => {
    const kinds = await admin`select id, name, method, supplier_id from price_kinds where workspace_id = ${ws} and supplier_id = ${supplier} and archived_at is null`;
    expect(kinds).toHaveLength(1);
    expect(kinds[0]).toMatchObject({ name: 'Цены ООО «Ромашка»', method: 'manual' });
    const data = new TextEncoder().encode('Арт.;Цена\nB-8;100');
    const { price } = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-03', rows: table(['B-8', 'x', '100', '']), file: { name: 'price.csv', mime: 'text/csv', data } }));
    expect(price).toMatchObject({ kindId: kinds[0]!.id, fileName: 'price.csv', fileSize: data.length });
    expect(price.attachmentId).toBeTruthy();
    const [att] = await admin`select entity_type, entity_id from attachments where id = ${price.attachmentId!}`;
    expect(att).toMatchObject({ entity_type: 'supplier_price', entity_id: price.id });
    expect(await admin`select id from price_kinds where workspace_id = ${ws} and supplier_id = ${supplier} and archived_at is null`).toHaveLength(1);
  });

  test('имя вида цен занято — «(2)»', async () => {
    const s3 = (await mk(owner, '/companies', { name: 'Занятый' })).id;
    await mk(owner, '/price-kinds', { name: 'Цены Занятый', method: 'manual' }).catch(() => admin`insert into price_kinds (workspace_id, name, method) values (${ws}, 'Цены Занятый', 'manual')`);
    const p = await run(db => saveSupplierProfile(db, actor, { companyId: s3, name: 'p', firstRow: 1, articleCol: 1, priceGrossCol: 2 }));
    const { price } = await run(db => uploadSupplierPrice(db, actor, { companyId: s3, profileId: p.id, date: '2026-11-01', rows: [['A', '1']] }));
    const [k] = await admin`select name from price_kinds where id = ${price.kindId}`;
    expect(k!.name).toBe('Цены Занятый (2)');
  });

  test('пустой файл и чужой профиль', async () => {
    expect(await errCode(run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-01', rows: table() })))).toBe('supplier_price_empty');
    const p2 = (await run(db => listSupplierProfiles(db, ws, supplier2)))[0]!;
    expect(await errCode(run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId: p2.id, date: '2026-11-01', rows: table(['A', '', '1', '']) })))).toBe('not_found');
  });

  test('повторная загрузка находит по сохранённому артикулу; артикул другого поставщика не совпадает', async () => {
    const { lines } = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-04', rows: table(['b-8', '', '9', ''], ['OTHER-1', '', '9', '']) }));
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
    const { price, lines } = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-05', rows }));
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
    const again = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-06', rows: table(['W-1', '', '2', ''], ['D-1', '', '3', ''], ['NEW-1', '', '4', ''], ['NEW-2', '', '5', '']) }));
    expect(again.lines.map(l => l.status)).toEqual(['matched', 'matched', 'matched', 'matched']);
  });

  test('строка с неверной ценой не привязывается; чужая строка — 404', async () => {
    const { price, lines } = await run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId, date: '2026-11-07', rows: table(['Q-1', 'q', 'abc', '']) }));
    expect(await errCode(run(db => updateSupplierPriceLine(db, actor, price.id, lines[0]!.id, { productId: bolt })))).toBe('supplier_line_price_invalid');
    expect(await errCode(run(db => updateSupplierPriceLine(db, actor, price.id, price.id, { skip: true })))).toBe('not_found');
  });
});

describe('применение прайса', () => {
  let sup: string;
  let prof: string;
  let kindId: string;
  let p20: string;
  let p10: string;
  let pNone: string;
  let pUntouched: string;
  let profNet: string;
  let profBoth: string;
  /** gross — цена с НДС в колонке C, net — без НДС в C, both — без НДС в C и с НДС в D */
  const upload = (date: string, mode: 'gross' | 'net' | 'both', ...data: string[][]) =>
    run(db => uploadSupplierPrice(db, actor, { companyId: sup, profileId: mode === 'gross' ? prof : mode === 'net' ? profNet : profBoth, date, rows: data }));
  const history = async (productId: string): Promise<{ date: string; price: string; document_id: string | null }[]> => [...(await admin`select date::text as date, price::text as price, document_id from product_prices where price_kind_id = ${kindId} and product_id = ${productId} order by date, id`)] as any;
  const setKindVat = (v: boolean) => admin`update price_kinds set includes_vat = ${v} where id = ${kindId}`;

  beforeAll(async () => {
    sup = (await mk(owner, '/companies', { name: 'ООО «Применение»' })).id;
    prof = (await run(db => saveSupplierProfile(db, actor, { companyId: sup, name: 'Простой', firstRow: 1, articleCol: 1, nameCol: 2, priceGrossCol: 3 }))).id;
    profNet = (await run(db => saveSupplierProfile(db, actor, { companyId: sup, name: 'Без НДС', firstRow: 1, articleCol: 1, nameCol: 2, priceNetCol: 3 }))).id;
    profBoth = (await run(db => saveSupplierProfile(db, actor, { companyId: sup, name: 'Обе цены', firstRow: 1, articleCol: 1, nameCol: 2, priceNetCol: 3, priceGrossCol: 4 }))).id;
    p20 = (await mk(owner, '/products', { name: 'Товар НДС 20', unitCode: '796', price: 1, vatRate: '20' })).id;
    p10 = (await mk(owner, '/products', { name: 'Товар НДС 10', unitCode: '796', price: 1, vatRate: '10' })).id;
    pNone = (await mk(owner, '/products', { name: 'Товар без НДС', unitCode: '796', price: 1, vatRate: 'none' })).id;
    pUntouched = (await mk(owner, '/products', { name: 'Вне прайса', unitCode: '796', price: 1, vatRate: '20' })).id;
    await article(sup, p20, 'A-20');
    await article(sup, p10, 'A-10');
    await article(sup, pNone, 'A-N');
    await article(sup, pUntouched, 'A-U');
  });

  test('базы совпадают: цена как есть на дату, document_id пуст; unmatched/skipped не пишутся, товары вне прайса не меняются', async () => {
    const up = await upload('2026-11-10', 'gross', ['A-20', 'a', '120', ''], ['A-10', 'b', '110', ''], ['A-N', 'c', '50', ''], ['NOPE', 'd', '9', ''], ['A-U', 'e', 'abc', '']);
    kindId = up.price.kindId;
    // сводка «было → стало»: цен вида ещё нет
    const prev = await run(db => previewSupplierPriceApply(db, ws, up.price.id));
    expect(prev.items.map(i => [i.article, i.current, i.next, i.warning])).toEqual([['A-20', null, '120.00', null], ['A-10', null, '110.00', null], ['A-N', null, '50.00', null]]);
    const res = await run(db => applySupplierPrice(db, actor, up.price.id));
    expect(res).toMatchObject({ applied: 3, skipped: [] });
    expect(res.price).toMatchObject({ status: 'applied' });
    expect(res.price.appliedAt).toBeTruthy();
    expect(await history(p20)).toEqual([{ date: '2026-11-10', price: '120.00', document_id: null }]);
    expect((await history(p10))[0]!.price).toBe('110.00');
    expect((await history(pNone))[0]!.price).toBe('50.00');
    expect(await history(pUntouched)).toEqual([]);
    expect(await admin`select id from product_prices where product_id = ${pUntouched} and price_kind_id = ${kindId}`).toHaveLength(0);
    // кэш розничной цены товара не трогаем
    expect((await admin`select price::text as price from products where id = ${p20}`)[0]!.price).toBe('1.00');
  });

  test('применённый прайс не редактируется и не применяется повторно', async () => {
    const [applied] = await admin`select id from supplier_prices where company_id = ${sup} and status = 'applied'`;
    const lines = await run(db => listSupplierPriceLines(db, ws, applied!.id as string));
    expect(await errCode(run(db => updateSupplierPriceLine(db, actor, applied!.id as string, lines[0]!.id, { skip: true })))).toBe('supplier_price_applied');
    expect(await errCode(run(db => applySupplierPrice(db, actor, applied!.id as string)))).toBe('supplier_price_applied');
    expect(await errCode(run(db => matchSupplierLinesByName(db, actor, applied!.id as string)))).toBe('supplier_price_applied');
  });

  test('цены в файле с НДС, вид без НДС: приведение; ставка none — строка пропущена; повтор той же даты заменяет запись', async () => {
    await setKindVat(false);
    const up = await upload('2026-11-10', 'gross', ['A-20', 'a', '240', ''], ['A-10', 'b', '220', ''], ['A-N', 'c', '60', '']);
    const prev = await run(db => previewSupplierPriceApply(db, ws, up.price.id));
    expect(prev.items.map(i => [i.article, i.current, i.next, i.warning])).toEqual([['A-20', '120.00', '200.00', null], ['A-10', '110.00', '200.00', null], ['A-N', '50.00', null, 'vat_rate_none']]);
    const res = await run(db => applySupplierPrice(db, actor, up.price.id));
    expect(res.applied).toBe(2);
    expect(res.skipped.map(s => s.article)).toEqual(['A-N']);
    // запись той же даты заменена, а не продублирована
    expect(await history(p20)).toEqual([{ date: '2026-11-10', price: '200.00', document_id: null }]);
    // пропущенный товар сохранил прежнюю цену, строка помечена
    expect((await history(pNone)).map(h => h.price)).toEqual(['50.00']);
    const lines = await run(db => listSupplierPriceLines(db, ws, up.price.id));
    expect(lines.find(l => l.article === 'A-N')).toMatchObject({ status: 'skipped', note: 'vat_rate_none' });
    expect(res.price).toMatchObject({ linesMatched: 2 });
  });

  test('вид без НДС и цены без НДС — как есть; новая дата — новая запись истории; дата при применении', async () => {
    const up = await upload('2026-11-11', 'net', ['A-10', 'b', '77,5', '']);
    const res = await run(db => applySupplierPrice(db, actor, up.price.id, { date: '2026-11-12' }));
    expect(res.price.date).toBe('2026-11-12');
    expect(await history(p10)).toEqual([
      { date: '2026-11-10', price: '200.00', document_id: null },
      { date: '2026-11-12', price: '77.50', document_id: null },
    ]);
  });

  test('цены в файле без НДС, вид с НДС: добавляется НДС по ставке товара', async () => {
    await setKindVat(true);
    const up = await upload('2026-11-13', 'net', ['A-20', 'a', '100', ''], ['A-10', 'b', '100', ''], ['A-N', 'c', '100', '']);
    const res = await run(db => applySupplierPrice(db, actor, up.price.id));
    expect(res.applied).toBe(2);
    expect(res.skipped).toHaveLength(1);
    expect((await history(p20)).at(-1)).toMatchObject({ date: '2026-11-13', price: '120.00' });
    expect((await history(p10)).at(-1)).toMatchObject({ date: '2026-11-13', price: '110.00' });
  });

  test('прежняя ручная запись той же даты (document_id NULL) заменяется, запись документа остаётся', async () => {
    await run(db => recordPriceKindPrice(db, ws, kindId, pUntouched, '5.00', '2026-11-14'));
    const up = await upload('2026-11-14', 'gross', ['A-U', 'u', '9,99', '']);
    await run(db => applySupplierPrice(db, actor, up.price.id));
    expect(await history(pUntouched)).toEqual([{ date: '2026-11-14', price: '9.99', document_id: null }]);
  });

  test('обе колонки: берётся цена в базе вида без пересчёта (даже если пересчёт дал бы другое), строка хранит обе цены', async () => {
    // вид с НДС: берём «с НДС» как есть (121 вместо 100 × 1,2)
    await setKindVat(true);
    const up = await upload('2026-11-15', 'both', ['A-20', 'a', '100', '121'], ['A-10', 'b', '100', '111'], ['A-N', 'c', '100', '130']);
    const l = (await run(db => listSupplierPriceLines(db, ws, up.price.id))).find(x => x.article === 'A-20')!;
    expect(l).toMatchObject({ priceNet: '100.00', priceGross: '121.00', status: 'matched' });
    const prev = await run(db => previewSupplierPriceApply(db, ws, up.price.id));
    expect(prev.items.map(i => [i.article, i.next, i.warning])).toEqual([['A-20', '121.00', null], ['A-10', '111.00', null], ['A-N', '130.00', null]]);
    // вид без НДС: берём «без НДС», ставка none не мешает
    await setKindVat(false);
    const prev2 = await run(db => previewSupplierPriceApply(db, ws, up.price.id));
    expect(prev2.items.map(i => [i.article, i.next, i.warning])).toEqual([['A-20', '100.00', null], ['A-10', '100.00', null], ['A-N', '100.00', null]]);
    await run(db => applySupplierPrice(db, actor, up.price.id));
    expect((await history(p20)).at(-1)).toMatchObject({ date: '2026-11-15', price: '100.00' });
  });

  test('обе колонки: пустая одна из двух — берётся другая (с пересчётом при другой базе); нечисловая — строка skipped', async () => {
    await setKindVat(true);
    const up = await upload('2026-11-16', 'both', ['A-20', 'a', '100', ''], ['A-10', 'b', '', '66'], ['A-N', 'c', 'abc', '50'], ['A-U', 'u', '', '']);
    const lines = await run(db => listSupplierPriceLines(db, ws, up.price.id));
    const by = Object.fromEntries(lines.map(x => [x.article, x]));
    expect(by['A-20']).toMatchObject({ priceNet: '100.00', priceGross: null, status: 'matched' });
    expect(by['A-10']).toMatchObject({ priceNet: null, priceGross: '66.00', status: 'matched' });
    expect(by['A-N']).toMatchObject({ priceNet: null, priceGross: null, status: 'skipped', note: 'price_invalid' });
    expect(by['A-U']).toMatchObject({ status: 'skipped', note: 'price_invalid' });
    const prev = await run(db => previewSupplierPriceApply(db, ws, up.price.id));
    expect(prev.items.map(i => [i.article, i.next, i.warning])).toEqual([['A-20', '120.00', null], ['A-10', '66.00', null]]);
    await setKindVat(false);
    expect((await run(db => previewSupplierPriceApply(db, ws, up.price.id))).items.map(i => i.next)).toEqual(['100.00', '60.00']);
  });

  test('только «без НДС» в профиле: колонка с НДС в файле не читается', async () => {
    const up = await upload('2026-11-17', 'net', ['A-20', 'a', '50', '999']);
    expect((await run(db => listSupplierPriceLines(db, ws, up.price.id)))[0]).toMatchObject({ priceNet: '50.00', priceGross: null });
  });
});
