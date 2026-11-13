/* Объём прайса поставщика: 20 000 строк — загрузка, «найти по названиям», «создать товары», применение укладываются в разумное время
   (операции пакетные, а не по запросу на строку). Порог мягкий: ловит возврат к построчной обработке. */
import { beforeAll, expect, test } from 'bun:test';
import { applySupplierPrice, createProductsForSupplierLines, matchSupplierLinesByName, MemoryFileStore, saveSupplierProfile, setFileStore, uploadSupplierPrice, withContext, type Actor, type Db } from '@gr8r/db';
import { admin, Client, sql } from './helpers';

const N = 20_000;
const PART = N / 4;
let owner: Client;
let ws: string;
let actor: Actor;
let supplier: string;

const run = <T>(fn: (db: Db) => Promise<T>): Promise<T> => withContext(sql, { workspaceId: ws, userId: owner.user!.id }, db => fn(db));

beforeAll(async () => {
  setFileStore(new MemoryFileStore());
  owner = new Client();
  await owner.signup({ workspaceName: 'Прайс большой WS' });
  ws = owner.workspaceId!;
  const [m] = await admin`select id from members where workspace_id = ${ws} and user_id = ${owner.user!.id}`;
  actor = { workspaceId: ws, memberId: m!.id as string, role: 'owner' };
  const r = await owner.post('/companies', { name: 'ООО «Большой прайс»' });
  supplier = r.body.id;
  // PART товаров с артикулом поставщика и PART товаров только с названием — напрямую, мимо API (подготовка данных)
  await admin`insert into products (workspace_id, kind, name, unit_code, price, vat_rate)
    select ${ws}, 'goods', 'Товар ' || g, '796', 0, '20' from generate_series(1, ${PART * 2}) g`;
  await admin`insert into product_partner_articles (workspace_id, company_id, product_id, article)
    select ${ws}, ${supplier}, p.id, 'A-' || substr(p.name, 7) from products p where p.workspace_id = ${ws} and substr(p.name, 7)::int <= ${PART}`;
});

test(`прайс на ${N} строк: загрузка + найти по названиям + создать товары + применить`, async () => {
  const profile = await run(db => saveSupplierProfile(db, actor, { companyId: supplier, name: 'Большой', firstRow: 2, articleCol: 1, nameCol: 2, priceGrossCol: 3 }));
  const rows: string[][] = [['Арт.', 'Наименование', 'Цена']];
  for (let i = 1; i <= N; i++) {
    const part = Math.ceil(i / PART);
    if (part === 1) rows.push([`A-${i}`, `Что-то ${i}`, `${i}.5`]); // по артикулу
    else if (part === 2) rows.push([`S-${i}`, `товар ${i}`, `${i},25`]); // по названию (товары PART+1…2·PART без артикула)
    else if (part === 3) rows.push([`C-${i}`, `Новый товар ${i}`, `${i}`]); // создать
    else rows.push([`X-${i}`, '', 'по запросу']); // нечисловая цена — skipped
  }
  const timings: Record<string, number> = {};
  const time = async <T>(k: string, f: () => Promise<T>): Promise<T> => {
    const t = performance.now();
    const v = await f();
    timings[k] = Math.round(performance.now() - t);
    return v;
  };
  const up = await time('upload', () => run(db => uploadSupplierPrice(db, actor, { companyId: supplier, profileId: profile.id, date: '2026-11-01', rows })));
  expect(up.price).toMatchObject({ linesTotal: N, linesMatched: PART, linesUnmatched: PART * 2 });
  const byName = await time('matchByName', () => run(db => matchSupplierLinesByName(db, actor, up.price.id)));
  expect(byName).toMatchObject({ matched: PART, ambiguous: 0 });
  const created = await time('createProducts', () => run(db => createProductsForSupplierLines(db, actor, up.price.id)));
  expect(created.created).toBe(PART);
  const applied = await time('apply', () => run(db => applySupplierPrice(db, actor, up.price.id)));
  expect(applied.applied).toBe(PART * 3);
  console.log('supplier-price bulk timings, ms:', JSON.stringify(timings));
  const total = Object.values(timings).reduce((a, b) => a + b, 0);
  expect(total).toBeLessThan(60_000);
  // записи цен: по одной на товар, цены верны
  const [c] = await admin`select count(*)::int as n from product_prices where workspace_id = ${ws} and price_kind_id = ${up.price.kindId} and date = '2026-11-01'`;
  expect(c!.n).toBe(PART * 3);
  const [p] = await admin`select pp.price::text as price from product_prices pp join products p on p.id = pp.product_id where p.workspace_id = ${ws} and p.name = 'Товар 1' and pp.price_kind_id = ${up.price.kindId}`;
  expect(p!.price).toBe('1.50');
}, 300_000);
