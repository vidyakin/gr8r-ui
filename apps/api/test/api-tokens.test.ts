/* Токены доступа агентов (задача 1285, docs/architecture/agent-tokens.md): выпуск и показ один раз, чтение по Bearer,
   read_only, разделы токена, запрет /api-tokens и /auth/* по токену, отзыв и срок, права участников, служебные сотрудники,
   полнота маппингов и изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { TOKEN_OPEN_PATHS, TOKEN_PATH_SECTIONS } from '@gr8r/shared';
import { TENANT_PATHS } from '../src/app';
import { addMember, admin, Client } from './helpers';

let owner: Client;
let member: Client;
let sales: Client;
let other: Client;
let ws: string;

/** Запрос с токеном агента (без cookie): свежий клиент, явный воркспейс */
const tok = (method: string, path: string, token: string, workspaceId: string | null, json?: unknown) =>
  new Client().req(method, path, { headers: { authorization: `Bearer ${token}` }, ws: workspaceId, json });

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Tokens WS' });
  ws = owner.workspaceId!;
  member = await addMember(owner, 'member');
  sales = await addMember(owner, 'member');
  other = new Client();
  await other.signup({ workspaceName: 'Other WS' });
});

describe('api tokens', () => {
  test('issue shows the token once; list has no token or hash', async () => {
    const res = await owner.post('/api-tokens', { name: 'Read token' });
    expect(res.status).toBe(201);
    const { token, item } = res.body;
    expect(token.startsWith('gr8r_')).toBe(true);
    expect(token.length).toBeGreaterThan(12);
    expect(item.prefix).toBe(token.slice(0, 12));
    expect(item.token).toBeUndefined();
    expect(item.tokenHash).toBeUndefined();
    const list = await owner.get('/api-tokens');
    expect(list.status).toBe(200);
    expect(list.body.items.some((i: any) => i.id === item.id && (i.token || i.tokenHash))).toBe(false);
  });

  test('bearer reads tenant data; GET /auth/me works', async () => {
    const { token } = (await owner.post('/api-tokens', { name: 'Reader' })).body;
    expect((await tok('GET', '/projects', token, ws)).status).toBe(200);
    expect((await tok('GET', '/auth/me', token, null)).status).toBe(200);
  });

  test('read-only token cannot write', async () => {
    const { token } = (await owner.post('/api-tokens', { name: 'Read only', readOnly: true })).body;
    const r = await tok('POST', '/projects', token, ws, { key: 'X', name: 'X' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('token_read_only');
  });

  test('a foreign workspace id in the header is rejected', async () => {
    const { token } = (await owner.post('/api-tokens', { name: 'Reader' })).body;
    const r = await tok('GET', '/projects', token, other.workspaceId);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('token_forbidden');
  });

  test('token sections close /documents and /deals', async () => {
    const { token } = (await owner.post('/api-tokens', { name: 'Projects only', sections: ['projects'], readOnly: true })).body;
    expect((await tok('GET', '/projects', token, ws)).status).toBe(200);
    const docs = await tok('GET', '/documents', token, ws);
    expect(docs.status).toBe(403);
    expect(docs.body.error.code).toBe('token_section_forbidden');
    const deals = await tok('GET', '/deals', token, ws);
    expect(deals.status).toBe(403);
    expect(deals.body.error.code).toBe('token_section_forbidden');
  });

  test('a token cannot call /api-tokens or /auth/*', async () => {
    const { token } = (await owner.post('/api-tokens', { name: 'Reader' })).body;
    expect((await tok('GET', '/api-tokens', token, ws)).status).toBe(403);
    expect((await tok('GET', '/auth/sessions', token, ws)).status).toBe(403);
    expect((await tok('POST', '/auth/signout', token, ws)).status).toBe(403);
  });

  test('revoked and expired tokens answer 401 token_invalid', async () => {
    const a = (await owner.post('/api-tokens', { name: 'Revoke me' })).body;
    expect((await owner.del(`/api-tokens/${a.item.id}`)).status).toBe(200);
    const r1 = await tok('GET', '/projects', a.token, ws);
    expect(r1.status).toBe(401);
    expect(r1.body.error.code).toBe('token_invalid');
    // повторный отзыв идемпотентен
    expect((await owner.del(`/api-tokens/${a.item.id}`)).status).toBe(200);

    const b = (await owner.post('/api-tokens', { name: 'Expired' })).body;
    await admin`update api_tokens set expires_at = now() - interval '1 hour' where id = ${b.item.id}`;
    const r2 = await tok('GET', '/projects', b.token, ws);
    expect(r2.status).toBe(401);
    expect(r2.body.error.code).toBe('token_invalid');
  });

  test('expiry in the past is rejected at creation', async () => {
    const r = await owner.post('/api-tokens', { name: 'Past', expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('token_expires_past');
  });

  test('a member cannot issue a token for another member', async () => {
    const people = (await owner.get('/members')).body.items as any[];
    const ownerMemberId = people.find(m => m.email === owner.user!.email).id;
    const r = await member.post('/api-tokens', { name: 'For other', memberId: ownerMemberId });
    expect(r.status).toBe(403);
  });

  test('sections beyond the member positions answer 422', async () => {
    const pos = (await owner.post('/positions', { name: 'Sales only', sections: ['crm'] })).body;
    const people = (await owner.get('/members')).body.items as any[];
    const salesId = people.find(m => m.email === sales.user!.email).id;
    expect((await owner.put(`/positions/by-member/${salesId}`, { positionIds: [pos.id] })).status).toBe(200);
    const r = await sales.post('/api-tokens', { name: 'Too many', sections: ['projects'], readOnly: true });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('token_sections_exceed');
  });

  test('a guest can only create read-only tokens', async () => {
    const guest = await addMember(owner, 'guest');
    const r = await guest.post('/api-tokens', { name: 'Writer', readOnly: false });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('token_guest_write');
    expect((await guest.post('/api-tokens', { name: 'Reader' })).status).toBe(201);
  });

  test('an event written by a token carries api_token_id', async () => {
    const { token, item } = (await owner.post('/api-tokens', { name: 'Writer', readOnly: false })).body;
    const project = await owner.project('TK', 'Token project');
    const t = await tok('POST', '/tasks', token, ws, { projectId: project.id, title: 'by token' });
    expect(t.status).toBe(201);
    const [ev] = await admin`select api_token_id from events where record_id = ${t.body.id} and type = 'task.created' order by created_at desc limit 1`;
    expect(ev!.api_token_id).toBe(item.id);
  });

  test('a service member cannot sign in with a password', async () => {
    const sm = (await owner.post('/api-tokens/service-members', { name: 'Agent', role: 'member' })).body;
    const rows = await admin`select email from members where id = ${sm.memberId}`;
    const login = await new Client().post('/auth/signin', { email: rows[0]!.email, password: 'whatever123' });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('invalid_credentials');
  });

  test('service member works through a token issued to them', async () => {
    const sm = (await owner.post('/api-tokens/service-members', { name: 'Agent 2', role: 'member' })).body;
    const { token } = (await owner.post('/api-tokens', { name: 'Agent 2 token', memberId: sm.memberId })).body;
    expect((await tok('GET', '/projects', token, ws)).status).toBe(200);
  });

  test('TOKEN_PATH_SECTIONS ∪ TOKEN_OPEN_PATHS exactly covers TENANT_PATHS', () => {
    const union = new Set([...TOKEN_PATH_SECTIONS.keys(), ...TOKEN_OPEN_PATHS]);
    expect(union.size).toBe(TENANT_PATHS.length);
    for (const p of TENANT_PATHS) expect(union.has(p), `missing ${p}`).toBe(true);
    for (const p of TOKEN_PATH_SECTIONS.keys()) expect(TOKEN_OPEN_PATHS.has(p), `duplicated ${p}`).toBe(false);
  });

  test('another tenant does not see or revoke foreign tokens (RLS)', async () => {
    const a = (await owner.post('/api-tokens', { name: 'Mine' })).body;
    const list = await other.get('/api-tokens');
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: any) => i.id)).not.toContain(a.item.id);
    expect((await other.del(`/api-tokens/${a.item.id}`)).status).toBe(404);
    // токен владельца по-прежнему работает
    expect((await tok('GET', '/projects', a.token, ws)).status).toBe(200);
  });
});
