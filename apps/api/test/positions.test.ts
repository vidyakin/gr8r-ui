/* Задача 1172: должности сотрудников и виды номенклатуры — CRUD и права, фильтры списков по функциям (и «нет должностей с функцией — все»),
   видимые разделы меню (объединение, admin всё, без должностей всё), перенос курьеров миграцией 0039, вид номенклатуры у товара
   (несовпадение типа 422, фильтр каталога), услуги специалиста по видам, изоляция арендаторов. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { createSql, ensureDatabase, runMigrations, wipeDatabase } from '@gr8r/db';
import { membersWithFunction, POSITION_SECTIONS, productFitsSpecialist, specialistProductKindIds, visibleSections } from '@gr8r/shared';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { Client, admin } from './helpers';

let owner: Client;
let adminC: Client;
let m1: Client;
let m2: Client;
let m3: Client;
let other: Client;
let ws: string;
let ids: Record<string, string> = {};

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const join = async (role: string) => {
  const c = new Client();
  await c.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: c.user!.email, role });
  await c.post('/invites/accept', { token: inv.body.token });
  c.workspaceId = ws;
  return c;
};
const WEEK = { '1': [540, 570, 600, 630] };
const MON = '2026-11-02';

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Должности WS' });
  ws = owner.workspaceId!;
  adminC = await join('admin');
  m1 = await join('member');
  m2 = await join('member');
  m3 = await join('member');
  other = new Client();
  await other.signup({ workspaceName: 'Чужие должности WS' });
  const people = (await owner.get('/members')).body.items as any[];
  for (const [k, c] of Object.entries({ owner, adminC, m1, m2, m3 })) ids[k] = people.find(m => m.email === c.user!.email).id;
});

describe('product kinds and positions: CRUD and permissions', () => {
  test('a member reads, only admin and owner write; names are unique per workspace', async () => {
    expect((await m1.post('/product-kinds', { name: 'Х', type: 'goods' })).status).toBe(403);
    expect((await m1.post('/positions', { name: 'Х' })).status).toBe(403);
    ids.kGoods = (await mk(adminC, '/product-kinds', { name: 'Мебель', type: 'goods' })).id;
    ids.kSvc = (await mk(owner, '/product-kinds', { name: 'Массаж', type: 'service' })).id;
    ids.kSvc2 = (await mk(owner, '/product-kinds', { name: 'Косметология', type: 'service' })).id;
    ids.kWork = (await mk(owner, '/product-kinds', { name: 'Монтаж', type: 'work' })).id;
    expect((await owner.post('/product-kinds', { name: 'Мебель', type: 'goods' })).status).toBe(409);
    expect((await owner.post('/product-kinds', { name: 'Бред', type: 'operation' })).status).toBe(400);
    expect((await m1.get('/product-kinds')).body.items).toHaveLength(4);
    expect((await m1.get('/positions')).body.items).toHaveLength(0);
    expect((await owner.patch(`/product-kinds/${ids.kWork}`, { name: 'Монтаж и наладка' })).body.name).toBe('Монтаж и наладка');
  });

  test('a position keeps functions, sections and provided kinds; invalid values are rejected', async () => {
    expect((await owner.post('/positions', { name: 'Плохая', functions: ['pilot'] })).status).toBe(400);
    expect((await owner.post('/positions', { name: 'Плохая', sections: ['moon'] })).status).toBe(400);
    expect((await owner.post('/positions', { name: 'Плохая', productKindIds: ['00000000-0000-4000-8000-000000000000'] })).status).toBe(422);
    const p = await mk(adminC, '/positions', { name: 'Массажист', functions: ['appointments_specialist'], sections: ['crm'], productKindIds: [ids.kSvc] });
    ids.pMasseur = p.id;
    expect(p.functions).toEqual(['appointments_specialist']);
    expect(p.productKindIds).toEqual([ids.kSvc]);
    expect((await owner.post('/positions', { name: 'Массажист' })).status).toBe(409);
    const u = await owner.patch(`/positions/${p.id}`, { sections: ['crm', 'trade'], productKindIds: [ids.kSvc, ids.kSvc2] });
    expect(u.body.sections).toEqual(['crm', 'trade']);
    expect(u.body.productKindIds.sort()).toEqual([ids.kSvc, ids.kSvc2].sort());
    expect((await m1.patch(`/positions/${p.id}`, { name: 'Z' })).status).toBe(403);
    expect((await m1.del(`/positions/${p.id}`)).status).toBe(403);
  });

  test('member positions are set by admin; deleting a position or a kind unlinks it', async () => {
    expect((await m1.put(`/positions/by-member/${ids.m1}`, { positionIds: [ids.pMasseur] })).status).toBe(403);
    expect((await owner.put(`/positions/by-member/${ids.m1}`, { positionIds: [ids.pMasseur] })).body.positionIds).toEqual([ids.pMasseur]);
    expect((await owner.put(`/positions/by-member/${ids.m1}`, { positionIds: ['00000000-0000-4000-8000-000000000000'] })).status).toBe(422);
    const tmp = await mk(owner, '/positions', { name: 'Временная', productKindIds: [ids.kWork] });
    await owner.put(`/positions/by-member/${ids.m3}`, { positionIds: [tmp.id] });
    expect((await owner.del(`/positions/${tmp.id}`)).status).toBe(200);
    const list = (await owner.get('/positions')).body.items as any[];
    expect(list.map(x => x.name)).toEqual(['Массажист']);
    expect(list[0].memberIds).toEqual([ids.m1]);
    // вид, использованный товаром, не удаляется; свободный — удаляется вместе со ссылками должностей
    await mk(owner, '/products', { name: 'Монтаж стойки', kind: 'work', unitCode: '356', price: 100, vatRate: 'none', productKindId: ids.kWork });
    expect((await owner.del(`/product-kinds/${ids.kWork}`)).body.error.code).toBe('product_kind_in_use');
    const free = await mk(owner, '/product-kinds', { name: 'Пустой', type: 'goods' });
    expect((await owner.del(`/product-kinds/${free.id}`)).status).toBe(200);
  });
});

describe('product kind of a product', () => {
  test('the type of the kind must match the product type (422), the kind is optional', async () => {
    const mismatch = await owner.post('/products', { name: 'Не тот тип', kind: 'goods', unitCode: '796', price: 1, vatRate: 'none', productKindId: ids.kSvc });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('product_kind_mismatch');
    ids.chair = (await mk(owner, '/products', { name: 'Стул', kind: 'goods', unitCode: '796', price: 5, vatRate: 'none', productKindId: ids.kGoods })).id;
    ids.plain = (await mk(owner, '/products', { name: 'Без вида', kind: 'goods', unitCode: '796', price: 5, vatRate: 'none' })).id;
    ids.massage = (await mk(owner, '/products', { name: 'Массаж 30', kind: 'service', unitCode: '876', price: 1500, vatRate: 'none', appointmentMinutes: 30, productKindId: ids.kSvc })).id;
    ids.cosmo = (await mk(owner, '/products', { name: 'Пилинг 30', kind: 'service', unitCode: '876', price: 2500, vatRate: 'none', appointmentMinutes: 30, productKindId: ids.kSvc2 })).id;
    ids.nokind = (await mk(owner, '/products', { name: 'Услуга без вида', kind: 'service', unitCode: '876', price: 500, vatRate: 'none', appointmentMinutes: 30 })).id;
    // смена типа товара при заданном виде и несуществующий вид
    expect((await owner.patch(`/products/${ids.chair}`, { kind: 'service' })).body.error.code).toBe('product_kind_mismatch');
    expect((await owner.patch(`/products/${ids.chair}`, { kind: 'service', productKindId: null })).status).toBe(200);
    expect((await owner.patch(`/products/${ids.chair}`, { kind: 'goods', productKindId: ids.kGoods })).status).toBe(200);
    expect((await owner.patch(`/products/${ids.plain}`, { productKindId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
    // тип вида нельзя поменять под товарами другого типа
    expect((await owner.patch(`/product-kinds/${ids.kGoods}`, { type: 'service' })).body.error.code).toBe('product_kind_in_use');
  });

  test('the catalog filters by kind', async () => {
    const r = (await owner.get(`/products?productKindId=${ids.kGoods}`)).body.items as any[];
    expect(r.map(p => p.name)).toEqual(['Стул']);
    expect(r[0].productKindId).toBe(ids.kGoods);
  });
});

describe('lists filtered by functions', () => {
  test('specialists: everyone with a schedule while no position has the function, then only the marked', async () => {
    const body = { slotMinutes: 30, dayStartMin: 540, dayEndMin: 720, week: WEEK };
    for (const k of ['m1', 'm2']) expect((await owner.put(`/appointments/schedules/${ids[k]}`, body)).status).toBe(200);
    // m1 уже массажист (функция есть у должности), m2 без должности
    let list = (await owner.get('/appointments/specialists')).body.items as any[];
    expect(list.map(s => s.memberId)).toEqual([ids.m1]);
    expect(list[0].productKindIds.sort()).toEqual([ids.kSvc, ids.kSvc2].sort());
    // убираем функцию у единственной должности: фильтра нет, видны оба специалиста с графиком
    await owner.patch(`/positions/${ids.pMasseur}`, { functions: [] });
    list = (await owner.get('/appointments/specialists')).body.items as any[];
    expect(list.map(s => s.memberId).sort()).toEqual([ids.m1, ids.m2].sort());
    await owner.patch(`/positions/${ids.pMasseur}`, { functions: ['appointments_specialist'] });
  });

  test('couriers follow the courier function; the courier sees only own deliveries', async () => {
    // нет должностей с функцией курьер: все активные участники
    const all = (await owner.get('/deliveries/couriers')).body.items as any[];
    expect(all.length).toBe(5);
    const courier = await mk(owner, '/positions', { name: 'Курьер', functions: ['courier'] });
    await owner.put(`/positions/by-member/${ids.m2}`, { positionIds: [courier.id] });
    const only = (await owner.get('/deliveries/couriers')).body.items as any[];
    expect(only.map(c => c.id)).toEqual([ids.m2]);
    expect((await owner.put(`/deliveries/couriers/${ids.m2}`, { isCourier: true })).status).toBe(404); // флаг заменён должностью
    ids.pCourier = courier.id;
  });
});

describe('visible sections (/positions/me)', () => {
  test('no positions: everything; admin and owner: everything even with a position', async () => {
    expect((await m3.get('/positions/me')).body.sections).toEqual([...POSITION_SECTIONS]);
    await owner.put(`/positions/by-member/${ids.adminC}`, { positionIds: [ids.pCourier] });
    const me = (await adminC.get('/positions/me')).body;
    expect(me.sections).toEqual([...POSITION_SECTIONS]);
    expect(me.functions).toEqual(['courier']);
    await owner.put(`/positions/by-member/${ids.adminC}`, { positionIds: [] });
    expect((await owner.get('/positions/me')).body.sections).toEqual([...POSITION_SECTIONS]);
  });

  test('the union of sections of several positions; a position without sections opens everything', async () => {
    const a = await mk(owner, '/positions', { name: 'Склад', sections: ['stock'] });
    const b = await mk(owner, '/positions', { name: 'Производство', sections: ['production', 'stock'] });
    const open = await mk(owner, '/positions', { name: 'Универсал' });
    await owner.put(`/positions/by-member/${ids.m3}`, { positionIds: [a.id, b.id] });
    expect((await m3.get('/positions/me')).body.sections).toEqual(['stock', 'production']);
    await owner.put(`/positions/by-member/${ids.m3}`, { positionIds: [a.id] });
    expect((await m3.get('/positions/me')).body.sections).toEqual(['stock']);
    await owner.put(`/positions/by-member/${ids.m3}`, { positionIds: [a.id, open.id] });
    expect((await m3.get('/positions/me')).body.sections).toEqual([...POSITION_SECTIONS]);
    await owner.put(`/positions/by-member/${ids.m3}`, { positionIds: [] });
  });

  test('the API permissions stay as they were (sections only hide the interface)', async () => {
    await owner.put(`/positions/by-member/${ids.m1}`, { positionIds: [ids.pMasseur] });
    // m1 видит только раздел CRM, но запрос каталога по API разрешён
    expect((await m1.get('/products')).status).toBe(200);
  });
});

describe('services of a specialist by kind', () => {
  test('booking: only services of the kinds of the position; no kinds on the position means every service', async () => {
    const book = (productId: string, specialistId = ids.m1, startMin = 540) => owner.post('/appointments', { specialistId, productId, date: MON, startMin, contactId: undefined, companyId: companyId });
    const companyId = (await mk(owner, '/companies', { name: 'ООО «Клиент»' })).id;
    // m1: виды «Массаж» и «Косметология»
    expect((await book(ids.massage, ids.m1, 540)).status).toBe(201);
    expect((await book(ids.cosmo, ids.m1, 600)).status).toBe(201);
    const denied = await book(ids.nokind, ids.m1, 570);
    expect(denied.status).toBe(422);
    expect(denied.body.error.code).toBe('service_not_provided');
    // оставляем только «Массаж»
    await owner.patch(`/positions/${ids.pMasseur}`, { productKindIds: [ids.kSvc] });
    expect((await owner.get('/appointments/specialists')).body.items[0].productKindIds).toEqual([ids.kSvc]);
    expect((await book(ids.cosmo, ids.m1, 630)).body.error.code).toBe('service_not_provided');
    expect((await owner.get(`/appointments/free?productId=${ids.cosmo}&specialistId=${ids.m1}&from=${MON}`)).body.slot ?? null).toBeNull();
    // виды не заданы — любая услуга
    await owner.patch(`/positions/${ids.pMasseur}`, { productKindIds: [] });
    expect((await owner.get('/appointments/specialists')).body.items[0].productKindIds).toBeNull();
    expect((await book(ids.nokind, ids.m1, 630)).status).toBe(201);
  });
});

describe('isolation', () => {
  test('another workspace sees nothing and cannot touch positions', async () => {
    expect((await other.get('/positions')).body.items).toHaveLength(0);
    expect((await other.get('/product-kinds')).body.items).toHaveLength(0);
    expect((await other.patch(`/positions/${ids.pMasseur}`, { name: 'Взлом' })).status).toBe(404);
    expect((await other.del(`/product-kinds/${ids.kSvc}`)).status).toBe(404);
    expect((await other.put(`/positions/by-member/${ids.m1}`, { positionIds: [] })).status).toBe(404);
    // чужой вид в товаре и чужая должность участнику не привязываются
    const mine = await mk(other, '/positions', { name: 'Своя' });
    expect((await owner.put(`/positions/by-member/${ids.m1}`, { positionIds: [mine.id] })).status).toBe(422);
    expect((await other.post('/products', { name: 'Чужой вид', kind: 'service', unitCode: '876', price: 1, vatRate: 'none', productKindId: ids.kSvc })).status).toBe(422);
    const rows = await admin.unsafe(`select count(*)::int as n from positions where workspace_id = '${other.workspaceId}'`);
    expect(rows[0]!.n).toBe(1);
  });
});

describe('pure functions', () => {
  const members = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const positions = [
    { id: 'p1', functions: ['courier'], sections: ['deliveries'], productKindIds: ['k1'] },
    { id: 'p2', functions: ['appointments_specialist'], sections: [], productKindIds: ['k2', 'k3'] },
    { id: 'p3', functions: ['appointments_specialist'], sections: ['crm'], productKindIds: ['k3', 'k4'] },
  ];
  const links = [
    { memberId: 'a', positionId: 'p1' },
    { memberId: 'b', positionId: 'p2' },
    { memberId: 'b', positionId: 'p3' },
  ];
  test('membersWithFunction: filter, or everyone when no position has the function', () => {
    expect(membersWithFunction(members, positions, links, 'courier').map(m => m.id)).toEqual(['a']);
    expect(membersWithFunction(members, positions, links, 'appointments_specialist').map(m => m.id)).toEqual(['b']);
    expect(membersWithFunction(members, positions, links, 'sales_manager').map(m => m.id)).toEqual(['a', 'b', 'c']);
    expect(membersWithFunction(members, [], [], 'courier')).toHaveLength(3);
  });
  test('visibleSections', () => {
    const all = [...POSITION_SECTIONS];
    expect(visibleSections('member', [])).toEqual(all);
    expect(visibleSections('admin', [positions[0]!])).toEqual(all);
    expect(visibleSections('owner', [positions[0]!])).toEqual(all);
    expect(visibleSections('member', [positions[0]!])).toEqual(['deliveries']);
    expect(visibleSections('member', [positions[0]!, positions[2]!])).toEqual(['crm', 'deliveries']);
    expect(visibleSections('guest', [positions[0]!, positions[1]!])).toEqual(all);
  });
  test('specialistProductKindIds and productFitsSpecialist', () => {
    expect(specialistProductKindIds('b', positions, links)!.sort()).toEqual(['k2', 'k3', 'k4']);
    expect(specialistProductKindIds('a', positions, links)).toBeNull(); // курьер: не специалист
    expect(specialistProductKindIds('c', positions, links)).toBeNull();
    expect(productFitsSpecialist('k2', ['k2'])).toBe(true);
    expect(productFitsSpecialist(null, ['k2'])).toBe(false);
    expect(productFitsSpecialist(null, null)).toBe(true);
  });
});

describe('migration 0039 moves the courier flag into the "Курьер" position', () => {
  const adminUrl = process.env.ADMIN_DATABASE_URL!;
  const u = new URL(adminUrl);
  const name = `${u.pathname.slice(1).replace(/_test$/, '')}_mig_test`;
  u.pathname = `/${name}`;
  const url = u.toString();
  const tmp = pathJoin(tmpdir(), `gr8r-mig-${Date.now()}`);
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  test('couriers get the position with the courier function; the flag column is dropped', async () => {
    // миграции до 0038 включительно — во временной папке
    const src = new URL('../../../packages/db/drizzle', import.meta.url).pathname;
    cpSync(src, tmp, { recursive: true });
    rmSync(pathJoin(tmp, '0039_positions.sql'));
    rmSync(pathJoin(tmp, 'meta', '0039_snapshot.json'));
    const journal = JSON.parse(readFileSync(pathJoin(tmp, 'meta', '_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { tag: string }) => !e.tag.startsWith('0039'));
    writeFileSync(pathJoin(tmp, 'meta', '_journal.json'), JSON.stringify(journal));

    await ensureDatabase(url);
    await wipeDatabase(url);
    const sql = createSql(url, { max: 1 });
    try {
      await migrate(drizzle(sql), { migrationsFolder: tmp });
      const [w1] = await sql`insert into workspaces (name, slug) values ('A', 'mig-a') returning id`;
      const [w2] = await sql`insert into workspaces (name, slug) values ('B', 'mig-b') returning id`;
      const add = async (w: string, email: string, courier: boolean) => (await sql`insert into members (workspace_id, email, name, is_courier) values (${w}, ${email}, ${email}, ${courier}) returning id`)[0]!.id as string;
      const c1 = await add(w1!.id, 'c1@x.dev', true);
      const c2 = await add(w1!.id, 'c2@x.dev', true);
      const n1 = await add(w1!.id, 'n1@x.dev', false);
      const n2 = await add(w2!.id, 'n2@x.dev', false); // во втором воркспейсе курьеров нет
      await runMigrations(url); // применяется только 0039
      const pos = await sql`select workspace_id, name, functions, sections from positions`;
      expect(pos).toHaveLength(1);
      expect(pos[0]!.workspace_id).toBe(w1!.id);
      expect(pos[0]!.name).toBe('Курьер');
      expect(pos[0]!.functions).toEqual(['courier']);
      expect(pos[0]!.sections).toEqual([]); // все разделы, как было у курьера
      const links = await sql`select member_id from member_positions order by member_id`;
      expect(links.map(l => l.member_id).sort()).toEqual([c1, c2].sort());
      expect(links.map(l => l.member_id)).not.toContain(n1);
      expect(links.map(l => l.member_id)).not.toContain(n2);
      const [col] = await sql`select count(*)::int as n from information_schema.columns where table_name = 'members' and column_name = 'is_courier'`;
      expect(col!.n).toBe(0);
      // RLS включён на новых таблицах
      const rls = await sql`select relname, relrowsecurity from pg_class where relname in ('positions','member_positions','position_product_kinds','product_kinds') order by relname`;
      expect(rls.every(r => r.relrowsecurity)).toBe(true);
    } finally {
      await sql.end();
    }
  }, 60_000);
});
