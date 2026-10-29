/* Конструктор сущностей: метаданные (admin+), проверка значений по типам полей, изоляция арендаторов,
   фильтры/сортировка/поиск по data, custom у системных сущностей, индексы filterable, удаление с подтверждением. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin, drainJobs, sql as appSql, stageId } from './helpers';
import { SYSTEM_ENTITIES } from '@gr8r/shared';

let owner: Client;
let member: Client;
let other: Client; // другой арендатор
let ws: string;
let companyId: string;

const indexes = async (like: string) => (await admin.unsafe(`select indexname, indexdef from pg_indexes where schemaname = 'public' and indexname like '${like}'`)) as { indexname: string; indexdef: string }[];

async function field(entity: string, body: Record<string, unknown>) {
  const r = await owner.post(`/entities/${entity}/fields`, body);
  if (r.status !== 201) throw new Error(`field ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Meta WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Other WS' });
  companyId = (await owner.post('/companies', { name: 'Acme' })).body.id;
});

describe('entities and fields: metadata', () => {
  test('system entities are registered when a workspace is created', async () => {
    const list = await owner.get('/entities');
    expect(list.status).toBe(200);
    expect(list.body.items.map((e: any) => e.key).sort()).toEqual(SYSTEM_ENTITIES.map(e => e.key).sort());
    expect(list.body.items.every((e: any) => e.kind === 'system')).toBe(true);
  });

  test('only admins change metadata; members can read it', async () => {
    expect((await member.post('/entities', { name: 'Nope' })).status).toBe(403);
    expect((await member.post('/entities/task/fields', { name: 'Nope', type: 'text' })).status).toBe(403);
    expect((await member.get('/entities')).status).toBe(200);
    expect((await member.get('/entities/task/fields')).status).toBe(200);
  });

  test('create entity: key from name, title field is created with it, duplicates and bad titles are rejected', async () => {
    const r = await owner.post('/entities', { name: 'Equipment Items', icon: 'wrench' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ key: 'equipment_items', kind: 'custom', icon: 'wrench', titleField: 'name' });
    expect(r.body.fields).toHaveLength(1);
    expect(r.body.fields[0]).toMatchObject({ key: 'name', type: 'text', required: true });
    expect((await owner.post('/entities', { name: 'Again', key: 'equipment_items' })).status).toBe(409);
    expect((await owner.post('/entities', { name: 'Tasks', key: 'task' })).status).toBe(409); // ключ системной сущности занят
    expect((await owner.post('/entities', { name: 'X', key: 'Bad Key' })).status).toBe(400);
    expect((await owner.patch('/entities/equipment_items', { titleField: 'missing' })).status).toBe(422);
    expect((await owner.patch('/entities/task', { name: 'Renamed' })).status).toBe(422); // системные не меняются
    const upd = await owner.patch('/entities/equipment_items', { name: 'Equipment', icon: 'box' });
    expect(upd.body).toMatchObject({ name: 'Equipment', icon: 'box', key: 'equipment_items' });
  });

  test('field options are validated: select needs unique options, ref needs an existing target, type and key are immutable', async () => {
    await owner.post('/entities', { name: 'Gadgets' });
    expect((await owner.post('/entities/gadgets/fields', { name: 'Kind', type: 'select' })).status).toBe(400);
    expect((await owner.post('/entities/gadgets/fields', { name: 'Kind', type: 'select', options: { choices: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] } })).status).toBe(400);
    expect((await owner.post('/entities/gadgets/fields', { name: 'Owner', type: 'ref' })).status).toBe(400);
    expect((await owner.post('/entities/gadgets/fields', { name: 'Owner', type: 'ref', options: { refEntity: 'nothing' } })).status).toBe(404);
    const kind = await field('gadgets', { name: 'Kind', type: 'select', options: { choices: [{ value: 'a', label: 'A', color: 'blue' }] } });
    expect(kind).toMatchObject({ key: 'kind', type: 'select', required: false, filterable: false });
    expect((await owner.post('/entities/gadgets/fields', { name: 'Kind', type: 'text' })).status).toBe(409); // ключ kind занят
    expect((await owner.patch(`/entities/gadgets/fields/${kind.id}`, { type: 'text' })).status).toBe(400); // тип не меняется
    const ren = await owner.patch(`/entities/gadgets/fields/${kind.id}`, { name: 'Type', options: { choices: [{ value: 'a', label: 'A2', color: 'rose' }, { value: 'b', label: 'B', color: 'teal' }] } });
    expect(ren.body).toMatchObject({ name: 'Type', key: 'kind' });
    expect(ren.body.options.choices).toHaveLength(2);
  });

  test('reorder fields', async () => {
    await owner.post('/entities', { name: 'Ordered' });
    const a = await field('ordered', { name: 'A', type: 'text' });
    const b = await field('ordered', { name: 'B', type: 'text' });
    const all = (await owner.get('/entities/ordered/fields')).body.items.map((f: any) => f.id);
    const r = await owner.post('/entities/ordered/fields/reorder', { ids: [b.id, a.id, ...all.filter((i: string) => i !== a.id && i !== b.id)] });
    expect(r.body.items.map((f: any) => f.key).slice(0, 2)).toEqual(['b', 'a']);
    expect((await owner.post('/entities/ordered/fields/reorder', { ids: ['0198a7c0-0000-7000-8000-000000000000'] })).status).toBe(422);
  });
});

describe('records: validation by field type', () => {
  let userId: string;
  beforeAll(async () => {
    userId = (await owner.get('/members')).body.items[0].id;
    await owner.post('/entities', { name: 'Everything', key: 'everything' });
    const e = 'everything';
    await field(e, { name: 'Count', type: 'number', options: { min: 0, max: 100 } });
    await field(e, { name: 'Price', type: 'money' });
    await field(e, { name: 'Share', type: 'percent' });
    await field(e, { name: 'Day', type: 'date' });
    await field(e, { name: 'Moment', type: 'datetime' });
    await field(e, { name: 'Flag', type: 'boolean' });
    await field(e, { name: 'Kind', type: 'select', options: { choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } });
    await field(e, { name: 'Tags', type: 'multi_select', options: { choices: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] } });
    await field(e, { name: 'Person', type: 'user' });
    await field(e, { name: 'Company', type: 'ref', options: { refEntity: 'company' } });
    await field(e, { name: 'Companies', type: 'refs', options: { refEntity: 'company' } });
    await field(e, { name: 'Site', type: 'url' });
    await field(e, { name: 'Mail', type: 'email' });
    await field(e, { name: 'Tel', type: 'phone' });
    await field(e, { name: 'Code', type: 'text', unique: true });
  });

  const create = (data: Record<string, unknown>) => owner.post('/data/everything', { data: { name: 'Row', ...data } });
  const badField = (res: any, key: string) => {
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.issues.some((i: any) => i.path === `data.${key}`)).toBe(true);
  };

  test('accepts a valid value of every type and normalizes it', async () => {
    const r = await create({
      count: '42', price: 10.456, share: 55, day: '2026-02-28', moment: '2026-02-28T10:00:00Z', flag: false, kind: 'a', tags: ['x', 'x', 'y'], person: userId,
      company: companyId, companies: [companyId], site: 'https://example.com/a', mail: 'a@b.co', tel: '+1 (555) 010-9999', code: 'C-1', extra_blank: undefined,
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ name: 'Row', count: 42, price: 10.46, share: 55, day: '2026-02-28', flag: false, kind: 'a', tags: ['x', 'y'], person: userId, company: companyId, mail: 'a@b.co' });
    expect(r.body.createdBy).toBeString();
  });

  test('rejects invalid values with the field path in the error', async () => {
    badField(await create({ count: 101 }), 'count');
    badField(await create({ count: 'abc' }), 'count');
    badField(await create({ share: 120 }), 'share');
    badField(await create({ day: '2026-02-30' }), 'day');
    badField(await create({ day: '28.02.2026' }), 'day');
    badField(await create({ moment: 'yesterday' }), 'moment');
    badField(await create({ flag: 'yes' }), 'flag');
    badField(await create({ kind: 'zzz' }), 'kind');
    badField(await create({ tags: ['x', 'q'] }), 'tags');
    badField(await create({ person: 'not-a-uuid' }), 'person');
    badField(await create({ site: 'ftp://x.y' }), 'site');
    badField(await create({ site: 'javascript:alert(1)' }), 'site');
    badField(await create({ mail: 'nope' }), 'mail');
    badField(await create({ tel: 'abc' }), 'tel');
    badField(await create({ unknown_field: 1 }), 'unknown_field');
  });

  test('required title, blank values are dropped, patch merges and null clears', async () => {
    badField(await owner.post('/data/everything', { data: {} }), 'name');
    badField(await owner.post('/data/everything', { data: { name: '   ' } }), 'name');
    const r = await create({ count: 5, kind: '', tags: [] });
    expect(r.body.data).toEqual({ name: 'Row', count: 5 });
    const p1 = await owner.patch(`/data/everything/${r.body.id}`, { data: { kind: 'b' } });
    expect(p1.body.data).toEqual({ name: 'Row', count: 5, kind: 'b' }); // остальное не тронуто
    const p2 = await owner.patch(`/data/everything/${r.body.id}`, { data: { count: null } });
    expect(p2.body.data).toEqual({ name: 'Row', kind: 'b' });
    badField(await owner.patch(`/data/everything/${r.body.id}`, { data: { name: null } }), 'name'); // обязательное не очищается
    badField(await owner.patch(`/data/everything/${r.body.id}`, { data: { kind: 'nope' } }), 'kind');
  });

  test('references must exist in this workspace, unique fields reject duplicates', async () => {
    const foreign = (await other.post('/companies', { name: 'Foreign Co' })).body.id;
    const r = await create({ company: foreign });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_reference');
    expect((await create({ companies: [companyId, foreign] })).status).toBe(422);
    expect((await create({ person: (await other.get('/members')).body.items[0].id })).status).toBe(422);
    expect((await create({ code: 'U-1' })).status).toBe(201);
    const dup = await create({ code: 'U-1' });
    expect(dup.status).toBe(409);
    const other2 = await create({ code: 'U-2' });
    const clash = await owner.patch(`/data/everything/${other2.body.id}`, { data: { code: 'U-1' } });
    expect(clash.status).toBe(409);
    expect((await owner.patch(`/data/everything/${other2.body.id}`, { data: { code: 'U-2', count: 1 } })).status).toBe(200); // своё значение — не конфликт
  });

  test('roles: members write records, guests only read; system entities have no /data endpoint', async () => {
    expect((await member.post('/data/everything', { data: { name: 'By member' } })).status).toBe(201);
    expect((await owner.get('/data/task')).status).toBe(422);
    expect((await owner.get('/data/does_not_exist')).status).toBe(404);
  });
});

describe('tenant isolation', () => {
  test('another workspace sees neither entities, fields, records nor search hits', async () => {
    await owner.post('/entities', { name: 'Secrets', key: 'secrets' });
    const rec = await owner.post('/data/secrets', { data: { name: 'Top secret plan' } });
    expect(rec.status).toBe(201);
    expect((await other.get('/entities')).body.items.some((e: any) => e.key === 'secrets')).toBe(false);
    expect((await other.get('/entities/secrets')).status).toBe(404);
    expect((await other.get('/data/secrets')).status).toBe(404);
    expect((await other.get(`/data/secrets/${rec.body.id}`)).status).toBe(404);
    expect((await other.patch(`/data/secrets/${rec.body.id}`, { data: { name: 'hacked' } })).status).toBe(404);
    expect((await other.get('/data-search?q=secret')).body.items).toEqual([]);
    expect((await owner.get('/data-search?q=secret')).body.items.map((i: any) => i.id)).toContain(rec.body.id);
    // той же сущности «secrets» у другого арендатора может не быть, но может быть своя — с тем же ключом, но другими данными
    await other.post('/entities', { name: 'Secrets', key: 'secrets' });
    await other.post('/data/secrets', { data: { name: 'Their own note' } });
    const mine = (await owner.get('/data/secrets')).body;
    expect(mine.items.map((r: any) => r.data.name)).toEqual(['Top secret plan']);
    // прямой запрос в БД под app_user без контекста арендатора ничего не видит (RLS fail closed)
    const rows = await appSql.begin(async tx => {
      await tx.unsafe('set local role app_user');
      return tx`select id from records`;
    });
    expect(rows.length).toBe(0);
  });

  test('a record of the other tenant cannot be referenced and a foreign entity cannot be the target of ref fields', async () => {
    const theirs = (await other.get('/data/secrets')).body.items[0].id;
    await owner.post('/entities', { name: 'Linker', key: 'linker' });
    await field('linker', { name: 'Secret', type: 'ref', options: { refEntity: 'secrets' } });
    const r = await owner.post('/data/linker', { data: { name: 'L', secret: theirs } });
    expect(r.status).toBe(422);
    const mine = (await owner.get('/data/secrets')).body.items[0].id;
    expect((await owner.post('/data/linker', { data: { name: 'L', secret: mine } })).status).toBe(201);
  });
});

describe('filters, sorting and search over data', () => {
  let rows: any[];
  beforeAll(async () => {
    await owner.post('/entities', { name: 'Suppliers X', key: 'sup' });
    await field('sup', { name: 'Category', type: 'select', filterable: true, options: { choices: [{ value: 'hw', label: 'Hardware' }, { value: 'sw', label: 'Software' }, { value: 'lg', label: 'Logistics' }] } });
    await field('sup', { name: 'Rating', type: 'number', filterable: true });
    await field('sup', { name: 'Since', type: 'date' });
    await field('sup', { name: 'Tags', type: 'multi_select', options: { choices: [{ value: 'eu', label: 'EU' }, { value: 'us', label: 'US' }] } });
    await field('sup', { name: 'Active', type: 'boolean' });
    await field('sup', { name: 'Notes', type: 'long_text' });
    const data = [
      { name: 'Alpha Parts', category: 'hw', rating: 4.5, since: '2020-01-10', tags: ['eu'], active: true, notes: 'Fast delivery' },
      { name: 'Beta Soft', category: 'sw', rating: 3, since: '2022-05-01', tags: ['us'], active: true },
      { name: 'Gamma Freight', category: 'lg', rating: 4, since: '2019-03-03', tags: ['eu', 'us'], active: false, notes: 'Customs delays' },
      { name: 'Delta Hardware', category: 'hw', rating: 2, since: '2024-07-07', active: true },
      { name: '100% Legit_Co', category: 'sw' },
    ];
    for (const d of data) expect((await owner.post('/data/sup', { data: d })).status).toBe(201);
    await drainJobs();
    rows = (await owner.get('/data/sup')).body.items;
  });

  const names = async (query: string) => (await owner.get(`/data/sup?${query}`)).body.items.map((r: any) => r.data.name) as string[];

  test('eq / ne / in on select', async () => {
    expect(await names('filter=category:eq:hw&sort=name')).toEqual(['Alpha Parts', 'Delta Hardware']);
    expect(await names('filter=category:in:hw,lg&sort=name')).toEqual(['Alpha Parts', 'Delta Hardware', 'Gamma Freight']);
    expect(await names('filter=category:ne:hw&sort=name')).toEqual(['100% Legit_Co', 'Beta Soft', 'Gamma Freight']);
  });

  test('numeric comparison is numeric (not textual) and combines with AND', async () => {
    expect(await names('filter=rating:gte:4&sort=-rating')).toEqual(['Alpha Parts', 'Gamma Freight']);
    expect(await names('filter=rating:lt:10&sort=rating')).toEqual(['Delta Hardware', 'Beta Soft', 'Gamma Freight', 'Alpha Parts']); // 10 > 4.5 как число
    expect(await names('filter=rating:gt:2&filter=category:eq:hw')).toEqual(['Alpha Parts']);
  });

  test('dates, booleans, multi-select, empty / notempty', async () => {
    expect(await names('filter=since:gte:2022-01-01&sort=since')).toEqual(['Beta Soft', 'Delta Hardware']);
    expect(await names('filter=active:eq:false')).toEqual(['Gamma Freight']);
    expect(await names('filter=tags:contains:eu&sort=name')).toEqual(['Alpha Parts', 'Gamma Freight']);
    expect(await names('filter=tags:in:us&sort=name')).toEqual(['Beta Soft', 'Gamma Freight']);
    expect(await names('filter=rating:empty')).toEqual(['100% Legit_Co']);
    expect(await names('filter=tags:empty&sort=name')).toEqual(['100% Legit_Co', 'Delta Hardware']);
    expect(await names('filter=notes:notempty&sort=name')).toEqual(['Alpha Parts', 'Gamma Freight']);
  });

  test('sorting by field: numbers numerically, nulls last, then by id; multi-key sort', async () => {
    expect(await names('sort=-rating')).toEqual(['Alpha Parts', 'Gamma Freight', 'Beta Soft', 'Delta Hardware', '100% Legit_Co']);
    expect(await names('sort=category,-name')).toEqual(['Delta Hardware', 'Alpha Parts', 'Gamma Freight', 'Beta Soft', '100% Legit_Co']);
    expect((await owner.get('/data/sup?sort=nope')).status).toBe(400);
  });

  test('search q looks into the title and text fields; LIKE wildcards in the query are literal', async () => {
    expect(await names('q=delta')).toEqual(['Delta Hardware']);
    expect(await names('q=customs')).toEqual(['Gamma Freight']); // long_text
    expect(await names('q=Hardware')).toEqual(['Delta Hardware']); // select ищется по значению, а не подписи — «hw»
    expect(await names('q=100%25')).toEqual(['100% Legit_Co']);
    expect(await names('q=%25')).toEqual(['100% Legit_Co']);
    expect(await names('q=_')).toEqual(['100% Legit_Co']);
  });

  test('pagination counts, invalid filters are 400, archived records are hidden', async () => {
    const page = (await owner.get('/data/sup?limit=2&offset=1&sort=name')).body;
    expect(page).toMatchObject({ total: 5, limit: 2, offset: 1 });
    expect(page.items).toHaveLength(2);
    for (const bad of ['filter=nope:eq:1', 'filter=rating:eq:abc', 'filter=rating:contains:1', 'filter=category:zz:1', 'filter=rating:gt', 'filter=active:eq:maybe', 'filter=since:eq:yesterday']) {
      const r = await owner.get(`/data/sup?${bad}`);
      expect(r.status, bad).toBe(400);
      expect(r.body.error.code).toBe('invalid_filter');
    }
    // значения не интерполируются в SQL
    expect((await owner.get(`/data/sup?filter=${encodeURIComponent("category:eq:x' or '1'='1")}`)).body.items).toEqual([]);
    const victim = rows.find(r => r.data.name === 'Beta Soft');
    expect((await owner.del(`/data/sup/${victim.id}`)).body).toMatchObject({ archived: true });
    expect(await names('filter=category:eq:sw')).toEqual(['100% Legit_Co']);
    expect((await owner.get('/data/sup?archived=only')).body.total).toBe(1);
    expect((await owner.post(`/data/sup/${victim.id}/restore`)).status).toBe(200);
    expect((await member.del(`/data/sup/${victim.id}?hard=true`)).status).toBe(403);
    expect((await owner.del(`/data/sup/${victim.id}?hard=true`)).body).toMatchObject({ deleted: true });
  });

  test('filterable fields get expression indexes (CREATE INDEX CONCURRENTLY) and filters match the index expression', async () => {
    const e = (await owner.get('/entities/sup')).body;
    const category = e.fields.find((f: any) => f.key === 'category');
    const rating = e.fields.find((f: any) => f.key === 'rating');
    const since = e.fields.find((f: any) => f.key === 'since');
    await drainJobs(); // индексы строит воркер из очереди
    const idx = await indexes('idx_cf_%');
    const catIdx = idx.find(i => i.indexname === `idx_cf_${category.id.replace(/-/g, '')}`);
    const ratIdx = idx.find(i => i.indexname === `idx_cf_${rating.id.replace(/-/g, '')}`);
    expect(catIdx?.indexdef).toContain("(data ->> 'category'::text)");
    expect(catIdx?.indexdef).toContain(`WHERE (entity_id = '${e.id}'::uuid)`);
    expect(ratIdx?.indexdef).toContain("(((data ->> 'rating'::text))::numeric)");
    expect(idx.some(i => i.indexname === `idx_cf_${since.id.replace(/-/g, '')}`)).toBe(false);
    // индекс валиден (не остался INVALID после неудачного CONCURRENTLY)
    const invalid = await admin.unsafe("select c.relname from pg_index i join pg_class c on c.oid = i.indexrelid where not i.indisvalid and c.relname like 'idx_cf_%'");
    expect(invalid.length).toBe(0);
    // включение и выключение флага
    expect((await owner.patch(`/entities/sup/fields/${since.id}`, { filterable: true })).status).toBe(200);
    await drainJobs();
    expect((await indexes(`idx_cf_${since.id.replace(/-/g, '')}`)).length).toBe(1);
    expect((await owner.patch(`/entities/sup/fields/${since.id}`, { filterable: false })).status).toBe(200);
    await drainJobs();
    expect((await indexes(`idx_cf_${since.id.replace(/-/g, '')}`)).length).toBe(0);
    // запрос с индексным выражением использует индекс (на малой таблице планировщик предпочёл бы seq scan — отключаем его в сессии)
    const plan = await admin.begin(async tx => {
      await tx.unsafe('set local enable_seqscan = off; set local enable_bitmapscan = off');
      return tx.unsafe(`explain select id from records where entity_id = '${e.id}' and (data->>'category') = 'hw'`);
    });
    expect(plan.map((r: any) => r['QUERY PLAN']).join('\n')).toContain(`idx_cf_${category.id.replace(/-/g, '')}`);
  });

  test('a rolled back request builds no index', async () => {
    const before = (await indexes('idx_cf_%')).length;
    const bad = await owner.post('/entities/sup/fields', { name: 'Bad', type: 'select', filterable: true }); // валидация: нет вариантов
    expect(bad.status).toBe(400);
    await drainJobs();
    expect((await indexes('idx_cf_%')).length).toBe(before);
    expect((await admin`select 1 from jobs where type like 'index.%' and status = 'queued'`).length).toBe(0); // откат запроса отменил и задачу
  });
});

describe('custom fields of system entities', () => {
  let projectId: string;
  let storyId: string;
  beforeAll(async () => {
    projectId = (await owner.project('CF', 'Custom fields')).id;
    const sp = await field('task', { name: 'Story points', type: 'number', filterable: true, options: { min: 0, max: 100 } });
    storyId = sp.id;
    await field('task', { name: 'Client', type: 'ref', options: { refEntity: 'company' } });
    await field('deal', { name: 'Source', type: 'select', options: { choices: [{ value: 'web', label: 'Web' }, { value: 'ref', label: 'Referral' }] } });
    await field('company', { name: 'Segment', type: 'text' });
    await field('contact', { name: 'Birthday', type: 'date' });
    await drainJobs();
  });

  test('task: custom is validated on create/patch, merges, null removes, other keys survive', async () => {
    const t = await owner.post('/tasks', { projectId, title: 'With custom', custom: { story_points: 5, client: companyId } });
    expect(t.status).toBe(201);
    expect(t.body.custom).toEqual({ story_points: 5, client: companyId });
    const p = await owner.patch(`/tasks/${t.body.id}`, { custom: { story_points: 8 } });
    expect(p.body.custom).toEqual({ story_points: 8, client: companyId });
    const cleared = await owner.patch(`/tasks/${t.body.id}`, { custom: { client: null } });
    expect(cleared.body.custom).toEqual({ story_points: 8 });
    const plain = await owner.patch(`/tasks/${t.body.id}`, { title: 'Renamed' }); // PATCH без custom его не трогает
    expect(plain.body.custom).toEqual({ story_points: 8 });
    expect((await owner.post('/tasks', { projectId, title: 'Bad', custom: { story_points: 1000 } })).status).toBe(400);
    expect((await owner.post('/tasks', { projectId, title: 'Bad', custom: { story_points: 1, nope: 1 } })).status).toBe(400);
    expect((await owner.patch(`/tasks/${t.body.id}`, { custom: { client: (await other.post('/companies', { name: 'X' })).body.id } })).status).toBe(422);
    const plainTask = await owner.post('/tasks', { projectId, title: 'No custom' });
    expect(plainTask.body.custom).toEqual({});
  });

  test('task custom is filterable through an index on tasks.custom', async () => {
    const idx = await indexes(`idx_cf_${storyId.replace(/-/g, '')}`);
    expect(idx).toHaveLength(1);
    expect(idx[0]!.indexdef).toContain('ON public.tasks');
    expect(idx[0]!.indexdef).toContain("(((custom ->> 'story_points'::text))::numeric)");
  });

  test('deal, company, contact: custom works the same way', async () => {
    const deal = await owner.post('/deals', { name: 'D', companyId, custom: { source: 'web' } });
    expect(deal.body.custom).toEqual({ source: 'web' });
    expect((await owner.patch(`/deals/${deal.body.id}`, { custom: { source: 'tv' } })).status).toBe(400);
    expect((await owner.patch(`/deals/${deal.body.id}`, { stageId: await stageId(owner, 'qualified') })).body.custom).toEqual({ source: 'web' });
    const co = await owner.patch(`/companies/${companyId}`, { custom: { segment: 'SMB' } });
    expect(co.body.custom).toEqual({ segment: 'SMB' });
    const ct = await owner.post('/contacts', { name: 'Bob', custom: { birthday: '1990-05-05' } });
    expect(ct.body.custom).toEqual({ birthday: '1990-05-05' });
    expect((await owner.post('/contacts', { name: 'Bob', custom: { birthday: '1990-13-45' } })).status).toBe(400);
  });

  test('a member cannot define fields; a guest-visible reads still work; foreign tenant has no such fields', async () => {
    expect((await member.post('/entities/task/fields', { name: 'Hack', type: 'text' })).status).toBe(403);
    expect((await other.get('/entities/task')).body.fields.some((f: any) => f.key === 'story_points')).toBe(false);
    expect((await other.post('/tasks', { projectId: (await other.project('OT', 'Other')).id, title: 'T', custom: { story_points: 1 } })).status).toBe(400);
  });
});

describe('deleting fields and entities', () => {
  test('field: confirmation is required, soft delete keeps the data in jsonb and can be restored, purge removes it', async () => {
    await owner.post('/entities', { name: 'Parts', key: 'parts' });
    const color = await field('parts', { name: 'Color', type: 'text', filterable: true });
    const rec = await owner.post('/data/parts', { data: { name: 'Bolt', color: 'red' } });
    await drainJobs();
    const idxName = `idx_cf_${color.id.replace(/-/g, '')}`;
    expect(await indexes(idxName)).toHaveLength(1);

    expect((await owner.del(`/entities/parts/fields/${color.id}`)).status).toBe(400); // без подтверждения
    expect((await owner.del(`/entities/parts/fields/${color.id}?confirm=wrong`)).status).toBe(400);
    expect((await member.del(`/entities/parts/fields/${color.id}?confirm=color`)).status).toBe(403);
    const soft = await owner.del(`/entities/parts/fields/${color.id}?confirm=color`);
    expect(soft.body).toMatchObject({ archived: true, purged: false, dataRetained: true });
    await drainJobs();
    expect(await indexes(idxName)).toHaveLength(0); // индекс убран сразу

    // поле скрыто и не принимает значений, а в jsonb значение всё ещё лежит
    const raw = (await admin.unsafe(`select data from records where id = '${rec.body.id}'`))[0]!.data;
    expect(raw.color).toBe('red');
    expect((await owner.post('/data/parts', { data: { name: 'Nut', color: 'blue' } })).status).toBe(400);
    expect((await owner.get('/entities/parts')).body.fields.find((f: any) => f.key === 'color').archivedAt).toBeString();
    expect((await owner.post('/entities/parts/fields', { name: 'Color', type: 'text' })).status).toBe(409); // ключ занят до очистки

    // возврат поля возвращает и значения, и индекс
    expect((await owner.post(`/entities/parts/fields/${color.id}/restore`)).body.archivedAt).toBeNull();
    await drainJobs();
    expect(await indexes(idxName)).toHaveLength(1);
    expect((await owner.post('/data/parts', { data: { name: 'Nut', color: 'blue' } })).status).toBe(201);

    const purge = await owner.del(`/entities/parts/fields/${color.id}?confirm=color&purge=true`);
    expect(purge.body).toMatchObject({ purged: true, cleared: 2 });
    await drainJobs();
    const after = (await admin.unsafe(`select data from records where entity_id = '${(await owner.get('/entities/parts')).body.id}'`)) as any[];
    expect(after.every(r => !('color' in r.data))).toBe(true);
    expect((await owner.post('/entities/parts/fields', { name: 'Color', type: 'text' })).status).toBe(201); // ключ свободен
  });

  test('title field of a custom entity cannot be deleted; purge on a system entity field clears tasks.custom', async () => {
    const r = await owner.del('/entities/parts/fields/' + (await owner.get('/entities/parts')).body.fields.find((f: any) => f.key === 'name').id + '?confirm=name');
    expect(r.status).toBe(422);
    const projectId = (await owner.project('PG', 'Purge')).id;
    const f = await field('task', { name: 'Temp', type: 'text' });
    const t = await owner.post('/tasks', { projectId, title: 'T', custom: { temp: 'x' } });
    expect((await owner.del(`/entities/task/fields/${f.id}?confirm=temp&purge=true`)).body.cleared).toBeGreaterThanOrEqual(1);
    expect((await owner.get(`/tasks/${t.body.id}`)).body.custom).toEqual({});
  });

  test('entity: archive keeps records until purge; entities referenced by other fields cannot be deleted', async () => {
    await owner.post('/entities', { name: 'Doomed', key: 'doomed' });
    await owner.post('/data/doomed', { data: { name: 'Keep me' } });
    const entityId = (await owner.get('/entities/doomed')).body.id;
    expect((await owner.del('/entities/doomed')).status).toBe(400);
    expect((await owner.del('/entities/task?confirm=task')).status).toBe(422);
    expect((await member.del('/entities/doomed?confirm=doomed')).status).toBe(403);

    // на сущность ссылается поле другой — удалить нельзя
    await owner.post('/entities', { name: 'Pointer', key: 'pointer' });
    const ptr = await field('pointer', { name: 'Doomed', type: 'ref', options: { refEntity: 'doomed' } });
    const blocked = await owner.del('/entities/doomed?confirm=doomed');
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('entity_in_use');
    await owner.del(`/entities/pointer/fields/${ptr.id}?confirm=doomed&purge=true`);

    const archived = await owner.del('/entities/doomed?confirm=doomed');
    expect(archived.body).toMatchObject({ archived: true, purged: false, dataRetained: true });
    expect((await owner.get('/entities')).body.items.some((e: any) => e.key === 'doomed')).toBe(false);
    expect((await owner.get('/entities?archived=only')).body.items.some((e: any) => e.key === 'doomed')).toBe(true);
    expect((await owner.get('/data/doomed')).status).toBe(404);
    expect(Number((await admin.unsafe(`select count(*)::int as n from records where entity_id = '${entityId}'`))[0]!.n)).toBe(1); // данные на месте

    expect((await owner.post('/entities/doomed/restore')).body.archivedAt).toBeNull();
    expect((await owner.get('/data/doomed')).body.total).toBe(1);

    const purged = await owner.del('/entities/doomed?confirm=doomed&purge=true');
    expect(purged.body).toMatchObject({ purged: true, records: 1 });
    expect(Number((await admin.unsafe(`select count(*)::int as n from records where entity_id = '${entityId}'`))[0]!.n)).toBe(0);
    expect(Number((await admin.unsafe(`select count(*)::int as n from fields where entity_id = '${entityId}'`))[0]!.n)).toBe(0);
  });
});

describe('events and search', () => {
  test('writes go to the outbox in the same transaction', async () => {
    await owner.post('/entities', { name: 'Evented', key: 'evented' });
    const rec = await owner.post('/data/evented', { data: { name: 'E1' } });
    await owner.patch(`/data/evented/${rec.body.id}`, { data: { name: 'E2' } });
    const ev = (await admin.unsafe(`select type, entity, payload from events where workspace_id = '${ws}' and (entity = 'record' or entity = 'entity') order by id desc limit 3`)) as any[];
    expect(ev.map(e => e.type)).toEqual(['record.updated', 'record.created', 'entity.created']);
    expect(ev[0].payload).toMatchObject({ entityKey: 'evented', changes: { name: 'E2' } });
  });

  test('palette search spans custom entities, ignores archived records and honours the limit', async () => {
    await owner.post('/entities', { name: 'Finder', key: 'finder', icon: 'search' });
    for (const n of ['Zebra one', 'Zebra two', 'Zebra three', 'Horse']) await owner.post('/data/finder', { data: { name: n } });
    const hit = await owner.get('/data-search?q=zebra&limit=2');
    expect(hit.body.items).toHaveLength(2);
    expect(hit.body.items[0]).toMatchObject({ entityKey: 'finder', entityName: 'Finder', icon: 'search' });
    expect(hit.body.items[0].title).toStartWith('Zebra');
    expect((await owner.get('/data-search')).status).toBe(400);
  });
});
