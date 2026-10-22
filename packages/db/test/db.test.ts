import { describe, expect, test } from 'bun:test';
import { sql as dsql } from 'drizzle-orm';
import { createSql, databaseUrl, adminDatabaseUrl, isUuid, uuidv7, withContext } from '../src';
import { seed as demoSeed, seedCrm } from '@gr8r/shared/demo';
import { DEMO_USER, OTHER_USER, runSeed } from '../src/seed';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid v7', () => {
  test('code generator: version/variant bits, monotonic order, time-sortable', () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7());
    expect(ids.every(i => V7.test(i))).toBe(true);
    expect([...ids].sort()).toEqual(ids); // монотонны даже внутри одной миллисекунды
    expect(new Set(ids).size).toBe(ids.length);
    const later = uuidv7(Date.now() + 60_000);
    expect(later > ids.at(-1)!).toBe(true);
    // первые 48 бит — время в мс
    const ts = parseInt(ids[0]!.replace(/-/g, '').slice(0, 12), 16);
    expect(Math.abs(ts - Date.now())).toBeLessThan(5000);
  });

  test('isUuid', () => {
    expect(isUuid(uuidv7())).toBe(true);
    expect(isUuid('nope')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  test('database function uuid_generate_v7(): version 7, increasing across calls', async () => {
    const admin = createSql(adminDatabaseUrl(), { max: 1 });
    const rows = await admin`select uuid_generate_v7()::text as id from generate_series(1, 200)`;
    const ids = rows.map(r => r.id as string);
    expect(ids.every(i => V7.test(i))).toBe(true);
    const a = (await admin`select uuid_generate_v7()::text as id`)[0]!.id as string;
    await new Promise(r => setTimeout(r, 5));
    const b = (await admin`select uuid_generate_v7()::text as id`)[0]!.id as string;
    expect(b > a).toBe(true);
    await admin.end();
  });
});

describe('seed', () => {
  test('creates the demo workspace with all frontend data and a second isolated tenant', async () => {
    const sql = createSql(databaseUrl(), { max: 4 });
    const admin = createSql(adminDatabaseUrl(), { max: 1 });
    const logs: string[] = [];
    await runSeed(sql, m => logs.push(m));
    await runSeed(sql, m => logs.push(m)); // идемпотентно
    expect(logs.filter(l => l.includes('already present'))).toHaveLength(1);

    const count = async (t: string, where = '') => Number((await admin.unsafe(`select count(*)::int as n from ${t} ${where}`))[0]!.n);
    const src = demoSeed();
    const crm = seedCrm();
    const [demo] = await admin`select id from workspaces where slug = 'gr8rstudio'`;
    const w = `where workspace_id = '${demo!.id}'`;
    expect(await count('members', w)).toBe(src.members.length);
    expect(await count('projects', w)).toBe(9); // 7 демо + системные проекты модулей (production, services)
    expect(await count('tasks', w)).toBe(src.tasks.length + 1); // + задача-назначение заказ-наряда
    expect(await count('statuses', w)).toBe(5);
    expect(await count('teams', w)).toBe(4);
    expect(await count('comments', w)).toBe(src.comments.length);
    expect(await count('comment_reactions', w)).toBe(4);
    expect(await count('activity', w)).toBe(src.activity.length);
    expect(await count('notifications', w)).toBe(src.notifs.length);
    expect(await count('files', w)).toBe(src.files.length);
    expect(await count('time_logs', w)).toBe(src.timeLogs.length);
    expect(await count('saved_views', w)).toBe(1);
    expect(await count('calendar_events', w)).toBe(6);
    expect(await count('companies', w)).toBe(crm.companies.length + 1); // + ИП из демо документов
    expect(await count('contacts', w)).toBe(crm.contacts.length);
    expect(await count('deals', w)).toBe(crm.deals.length);
    expect(await count('crm_activities', w)).toBe(crm.activities.length);

    // конструктор сущностей: системные сущности, пользовательские поля задач, «Suppliers» с записями и индексами по filterable-полям
    expect(await count('entities', `${w} and kind = 'system'`)).toBe(6);
    const [sup] = await admin`select id from entities where workspace_id = ${demo!.id} and key = 'suppliers'`;
    expect(await count('records', `where entity_id = '${sup!.id}'`)).toBe(8);
    expect(await count('fields', `where entity_id = '${sup!.id}'`)).toBe(6);
    expect(await count('tasks', `${w} and custom ? 'story_points'`)).toBe(src.tasks.length);
    expect(await count('tasks', `${w} and custom ? 'client'`)).toBeGreaterThan(5);
    const [acmeRow] = await admin`select id from workspaces where slug = 'acme'`;
    const acme = acmeRow;
    // индексы по filterable-полям строит воркер: сид только ставит задачи (DDL у него нет)
    expect(await count('jobs', `where workspace_id = '${demo!.id}' and type = 'index.create' and status = 'queued'`)).toBe(3);

    // каталог и производство
    expect(await count('units', w)).toBeGreaterThanOrEqual(19);
    expect(await count('product_categories', w)).toBe(5);
    expect(await count('products', `${w} and kind = 'goods'`)).toBe(21);
    expect(await count('products', `${w} and kind = 'service'`)).toBe(3);
    expect(await count('products', `${w} and kind = 'work'`)).toBe(2);
    expect(await count('work_centers', w)).toBe(2);
    expect(await count('manufactured_items', `${w} and kind = 'product'`)).toBe(3);
    expect(await count('manufactured_items', `${w} and kind = 'semi'`)).toBe(4);
    expect(await count('bom_lines', `${w} and kind = 'semi'`)).toBe(3);
    expect(await count('products', `where workspace_id = '${acme!.id}'`)).toBe(0);
    expect(await count('units', `where workspace_id = '${acme!.id}'`)).toBeGreaterThanOrEqual(19);
    expect(await count('entities', `where workspace_id = '${acme!.id}' and kind = 'system'`)).toBe(6); // второй арендатор тоже зарегистрирован

    // документы и склад: организация, склады, реквизиты, проведённые цепочки, остатки и резерв
    expect(await count('organizations', `${w} and name = 'ООО «Гр8р Студия»' and tax_system = 'osn' and default_vat_rate = '20' and is_default`)).toBe(1);
    expect(await count('warehouses', w)).toBe(4); // основной, цех, склад готовой продукции и служебный «в пути»
    expect(await count('companies', `${w} and inn <> ''`)).toBe(5);
    expect(await count('bank_accounts', `${w} and company_id is not null`)).toBe(5);
    expect(await count('documents', w)).toBe(22);
    expect(await count('documents', `${w} and status = 'posted' and number is not null`)).toBe(21);
    expect(await count('documents', `${w} and based_on_id is not null`)).toBe(7);
    expect(await count('documents', `${w} and type in ('stock_transfer','write_off','inventory_count')`)).toBe(6);
    // производство: заказ на производство и выпуск со списанием материалов
    expect(await count('documents', `${w} and type = 'production_order'`)).toBe(2);
    expect(await count('documents', `${w} and type = 'production'`)).toBe(1);
    expect(await count('production_items', w)).toBe(3);
    expect(await count('production_components', `${w} and kind = 'material'`)).toBe(12);
    // виды производства и этапы: пример с тремя этапами
    expect(await count('production_kinds', w)).toBe(1);
    expect(await count('production_stages', w)).toBe(3);
    expect(await count('production_stages', `${w} and is_final`)).toBe(1);
    // заказ-наряд: вид по умолчанию с состояниями, материалы и назначение
    expect(await count('documents', `${w} and type = 'work_order'`)).toBe(1);
    expect(await count('work_order_kinds', w)).toBe(1);
    expect(await count('document_states', w)).toBe(6);
    expect(await count('work_order_materials', w)).toBe(1);
    expect(await count('work_order_assignments', w)).toBe(1);
    expect(await count('cost_items', w)).toBe(6);
    expect(await count('stock_balances', `${w} and qty > 0`)).toBe(23);
    expect(await count('stock_reservations', w)).toBe(2);
    expect(await count('documents', `where workspace_id = '${acme!.id}'`)).toBe(0);
    expect(await count('organizations', `where workspace_id = '${acme!.id}'`)).toBe(1);
    expect(await count('warehouses', `where workspace_id = '${acme!.id}'`)).toBe(1);

    // дерево подзадач и зависимости сохранены, id участников в подзадачах — настоящие uuid
    const [wf] = await admin`select subtasks, deps, plan_hours from tasks where title = 'Create homepage wireframes'`;
    expect(wf!.subtasks).toHaveLength(4);
    expect(wf!.subtasks[3].assignee).toMatch(V7);
    const [handoff] = await admin`select deps from tasks where title = 'Prepare developer handoff'`;
    expect(handoff!.deps).toHaveLength(2);
    expect(Number(wf!.plan_hours)).toBe(24);

    // деньги — numeric
    const [{ sum }] = await admin`select sum(amount)::text as sum from deals where stage = 'won' and workspace_id = ${demo!.id}`;
    expect(sum).toBe(crm.deals.filter(d => d.stage === 'won').reduce((a, d) => a + d.amount, 0).toFixed(2));

    // демо-пользователь и второй арендатор
    const [demoUser] = await admin`select id from users where email = ${DEMO_USER.email}`;
    const [bob] = await admin`select id from users where email = ${OTHER_USER.email}`;
    expect(demoUser).toBeDefined();
    expect(bob).toBeDefined();
    const bobsWs = await withContext(sql, { userId: bob!.id }, db => db.execute(dsql`select id, name from workspaces`));
    expect(bobsWs).toHaveLength(1);
    expect(bobsWs[0]!.name).toBe('Acme Corp');
    const demoWsList = await withContext(sql, { userId: demoUser!.id }, db => db.execute(dsql`select name from workspaces`));
    expect(demoWsList.map((r: any) => r.name)).toEqual(['Gr8r Studio']);
    expect(await Bun.password.verify(DEMO_USER.password, (await admin`select password_hash from users where id = ${demoUser!.id}`)[0]!.password_hash)).toBe(true);

    await sql.end();
    await admin.end();
  });
});
