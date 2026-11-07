/* Разделы должностей на сервере: путь одного раздела (SECTION_OF_API_PATH) закрыт участнику, которому раздел скрыт
   должностями — 403 section_forbidden; admin, owner и участник без должностей проходят, общие пути не ограничиваются. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { SECTION_OF_API_PATH } from '@gr8r/shared';
import { TENANT_PATHS } from '../src/app';
import { Client } from './helpers';

let owner: Client;
let adminC: Client;
let sales: Client;
let free: Client;
let ws: string;

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
  await owner.signup({ workspaceName: 'Разделы на сервере WS' });
  ws = owner.workspaceId!;
  adminC = await join('admin');
  sales = await join('member');
  free = await join('member');
  const people = (await owner.get('/members')).body.items as any[];
  const salesId = people.find(m => m.email === sales.user!.email).id;
  const pos = await owner.post('/positions', { name: 'Менеджер продаж', sections: ['crm'] });
  expect(pos.status).toBe(201);
  expect((await owner.put(`/positions/by-member/${salesId}`, { positionIds: [pos.body.id] })).status).toBe(200);
});

describe('position sections on the server', () => {
  test('every section path is a tenant path', () => {
    for (const p of SECTION_OF_API_PATH.keys()) expect(TENANT_PATHS).toContain(p);
  });

  test('a hidden section answers 403 section_forbidden on read and write', async () => {
    const r = await sales.get('/flows');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('section_forbidden');
    expect((await sales.post('/flows', { name: 'x' })).status).toBe(403);
    expect((await sales.get('/production-plans')).status).toBe(403);
  });

  test('an open section and shared paths stay available', async () => {
    expect((await sales.get('/deal-funnel')).status).not.toBe(403);
    expect((await sales.get('/documents')).status).toBe(200);
    expect((await sales.get('/products')).status).toBe(200);
  });

  test('admin, owner and a member without positions are not limited', async () => {
    for (const c of [owner, adminC, free]) expect((await c.get('/flows')).status).toBe(200);
  });
});
