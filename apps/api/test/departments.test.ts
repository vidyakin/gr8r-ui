/* Подразделения (оргструктура): CRUD и права (читают все, правят admin/owner), дерево и запрет цикла (422 department_cycle),
   удаление только пустого (409 department_in_use), состав (у участника одно подразделение), руководитель подразделения
   сотрудника (head-of, подъём к родителю), изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin } from './helpers';

let owner: Client;
let adminC: Client;
let m1: Client;
let m2: Client;
let m3: Client;
let other: Client;
let ws: string;
const ids: Record<string, string> = {};

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

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Подразделения WS' });
  ws = owner.workspaceId!;
  adminC = await join('admin');
  m1 = await join('member');
  m2 = await join('member');
  m3 = await join('member');
  other = new Client();
  await other.signup({ workspaceName: 'Чужие подразделения WS' });
  const people = (await owner.get('/members')).body.items as any[];
  for (const [k, c] of Object.entries({ owner, adminC, m1, m2, m3 })) ids[k] = people.find(m => m.email === c.user!.email).id;
});

describe('departments: CRUD and permissions', () => {
  test('a member reads, only admin and owner write; names are unique per workspace ignoring case', async () => {
    expect((await m1.post('/departments', { name: 'Х' })).status).toBe(403);
    ids.root = (await mk(owner, '/departments', { name: 'Руководство', headMemberId: ids.owner, sortOrder: 1 })).id;
    ids.sales = (await mk(adminC, '/departments', { name: 'Продажи', parentId: ids.root, headMemberId: ids.m1, sortOrder: 2 })).id;
    ids.prod = (await mk(owner, '/departments', { name: 'Производство', parentId: ids.root, sortOrder: 3 })).id;
    expect((await owner.post('/departments', { name: 'продажи' })).status).toBe(409);
    expect((await owner.post('/departments', { name: 'Плохое', parentId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
    expect((await owner.post('/departments', { name: 'Плохое', headMemberId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
    const list = (await m1.get('/departments')).body.items as any[];
    expect(list.map(d => d.name)).toEqual(['Руководство', 'Продажи', 'Производство']);
    expect(list.find(d => d.id === ids.sales).parentId).toBe(ids.root);
    expect(list.find(d => d.id === ids.sales).headMemberId).toBe(ids.m1);
    // правка: имя и порядок; непришедшие поля не меняются
    const u = await owner.patch(`/departments/${ids.prod}`, { name: 'Цех', sortOrder: 4 });
    expect(u.body.name).toBe('Цех');
    expect(u.body.parentId).toBe(ids.root);
    expect((await m1.patch(`/departments/${ids.prod}`, { name: 'Взлом' })).status).toBe(403);
    expect((await m1.del(`/departments/${ids.prod}`)).status).toBe(403);
    // null очищает руководителя
    expect((await owner.patch(`/departments/${ids.sales}`, { headMemberId: null })).body.headMemberId).toBeNull();
    await owner.patch(`/departments/${ids.sales}`, { headMemberId: ids.m1 });
  });

  test('the tree forbids cycles: itself or a descendant as parent (422 department_cycle)', async () => {
    expect((await owner.patch(`/departments/${ids.root}`, { parentId: ids.root })).body.error.code).toBe('department_cycle');
    expect((await owner.patch(`/departments/${ids.root}`, { parentId: ids.sales })).body.error.code).toBe('department_cycle');
    // допустимое переподчинение: цех под продажи, затем обратно
    expect((await owner.patch(`/departments/${ids.prod}`, { parentId: ids.sales })).status).toBe(200);
    expect((await owner.patch(`/departments/${ids.sales}`, { parentId: ids.prod })).body.error.code).toBe('department_cycle');
    expect((await owner.patch(`/departments/${ids.prod}`, { parentId: ids.root })).status).toBe(200);
    // null делает подразделение корневым
    expect((await owner.patch(`/departments/${ids.prod}`, { parentId: null })).body.parentId).toBeNull();
    await owner.patch(`/departments/${ids.prod}`, { parentId: ids.root });
  });

  test('delete only an empty department: children or employees give 409 department_in_use', async () => {
    expect((await owner.del(`/departments/${ids.root}`)).body.error.code).toBe('department_in_use'); // дети
    await owner.put(`/departments/by-member/${ids.m2}`, { departmentId: ids.sales });
    expect((await owner.del(`/departments/${ids.sales}`)).body.error.code).toBe('department_in_use'); // сотрудники
    const tmp = await mk(owner, '/departments', { name: 'Временное' });
    expect((await owner.del(`/departments/${tmp.id}`)).status).toBe(200);
    expect((await owner.get('/departments')).body.items.map((d: any) => d.name)).not.toContain('Временное');
  });
});

describe('composition: one department per member', () => {
  test('assign, move and remove; invalid references are rejected', async () => {
    expect((await m1.put(`/departments/by-member/${ids.m2}`, { departmentId: ids.prod })).status).toBe(403);
    // m2 уже в продажах (предыдущий тест) — перенос в цех убирает из продаж
    expect((await owner.put(`/departments/by-member/${ids.m2}`, { departmentId: ids.prod })).body.departmentId).toBe(ids.prod);
    let list = (await owner.get('/departments')).body.items as any[];
    expect(list.find(d => d.id === ids.sales).memberIds).toEqual([]);
    expect(list.find(d => d.id === ids.prod).memberIds).toEqual([ids.m2]);
    await owner.put(`/departments/by-member/${ids.m2}`, { departmentId: ids.sales });
    await owner.put(`/departments/by-member/${ids.m3}`, { departmentId: ids.sales });
    await owner.put(`/departments/by-member/${ids.owner}`, { departmentId: ids.root });
    expect((await owner.put(`/departments/by-member/${ids.m2}`, { departmentId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
    expect((await owner.put('/departments/by-member/00000000-0000-4000-8000-000000000000', { departmentId: ids.sales })).status).toBe(404);
    // null убирает из подразделения
    expect((await owner.put(`/departments/by-member/${ids.m3}`, { departmentId: null })).body.departmentId).toBeNull();
    list = (await owner.get('/departments')).body.items as any[];
    expect(list.find(d => d.id === ids.sales).memberIds).toEqual([ids.m2]);
    await owner.put(`/departments/by-member/${ids.m3}`, { departmentId: ids.sales });
  });
});

describe('head-of: the head of the member department, walking up to the parent', () => {
  test('employee gets the head; the head gets the parent head; the top head gets null', async () => {
    // m2 в продажах, руководитель продаж — m1
    expect((await m2.get(`/departments/head-of/${ids.m2}`)).body).toEqual({ memberId: ids.m2, departmentId: ids.sales, headMemberId: ids.m1 });
    // m1 — руководитель продаж, состоит в них: вверх к руководству (руководитель — владелец)
    await owner.put(`/departments/by-member/${ids.m1}`, { departmentId: ids.sales });
    expect((await owner.get(`/departments/head-of/${ids.m1}`)).body.headMemberId).toBe(ids.owner);
    // владелец — руководитель верхнего уровня: выше никого
    expect((await owner.get(`/departments/head-of/${ids.owner}`)).body.headMemberId).toBeNull();
    // участник без подразделения
    expect((await owner.get(`/departments/head-of/${ids.adminC}`)).body).toEqual({ memberId: ids.adminC, departmentId: null, headMemberId: null });
    // подразделение без руководителя: поднимаемся к родителю
    ids.acc = (await mk(owner, '/departments', { name: 'Бухгалтерия', parentId: ids.root })).id;
    await owner.put(`/departments/by-member/${ids.m3}`, { departmentId: ids.acc });
    expect((await owner.get(`/departments/head-of/${ids.m3}`)).body.headMemberId).toBe(ids.owner);
  });
});

describe('isolation', () => {
  test('another workspace sees nothing and cannot touch departments', async () => {
    expect((await other.get('/departments')).body.items).toHaveLength(0);
    expect((await other.patch(`/departments/${ids.root}`, { name: 'Взлом' })).status).toBe(404);
    expect((await other.del(`/departments/${ids.sales}`)).status).toBe(404);
    expect((await other.put(`/departments/by-member/${ids.m1}`, { departmentId: null })).status).toBe(404);
    expect((await other.get(`/departments/head-of/${ids.m2}`)).body.headMemberId).toBeNull();
    // чужое подразделение не становится родителем и не назначается участнику
    const mine = await mk(other, '/departments', { name: 'Своё' });
    expect((await owner.post('/departments', { name: 'С чужим родителем', parentId: mine.id })).status).toBe(422);
    expect((await owner.put(`/departments/by-member/${ids.m2}`, { departmentId: mine.id })).status).toBe(422);
    const rows = await admin.unsafe(`select count(*)::int as n from departments where workspace_id = '${other.workspaceId}'`);
    expect(rows[0]!.n).toBe(1);
  });
});