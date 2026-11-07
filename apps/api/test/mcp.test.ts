/* MCP-сервер /mcp (задача 1286, docs/architecture/mcp.md): вход только по токену, инструменты поверх API с правами токена,
   обрезка длинных ответов, пути видов в TENANT_PATHS. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { TENANT_PATHS } from '../src/app';
import { ENTITY_KINDS, REPORTS } from '../src/mcp/kinds';
import { toText } from '../src/mcp/tools';
import { Client } from './helpers';

let owner: Client;
let companyId: string;
let fullToken: string;
let crmToken: string;

const ACCEPT = 'application/json, text/event-stream';
let rpcId = 0;
/** JSON-RPC в /mcp: с токеном (без cookie) или от клиента с cookie */
const rpc = (method: string, params: unknown, token: string | null, from = new Client()) =>
  from.req('POST', '/mcp', {
    ws: null,
    headers: { accept: ACCEPT, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    json: { jsonrpc: '2.0', id: ++rpcId, method, params },
  });
const callTool = async (token: string, name: string, args: Record<string, unknown> = {}) => {
  const r = await rpc('tools/call', { name, arguments: args }, token);
  expect(r.status).toBe(200);
  const result = r.body.result;
  return { isError: !!result.isError, text: result.content[0].text as string };
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'MCP WS' });
  const co = await owner.post('/companies', { name: 'Ромашка МСП' });
  expect(co.status).toBe(201);
  companyId = co.body.id;
  fullToken = (await owner.post('/api-tokens', { name: 'MCP full' })).body.token;
  crmToken = (await owner.post('/api-tokens', { name: 'MCP crm', sections: ['crm'] })).body.token;
});

describe('mcp', () => {
  test('initialize and tools/list by token', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, fullToken);
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('gr8r');
    const list = await rpc('tools/list', {}, fullToken);
    expect(list.status).toBe(200);
    const names = list.body.result.tools.map((t: { name: string }) => t.name);
    for (const n of ['whoami', 'search', 'get_entity', 'list_entities', 'list_documents', 'get_document', 'stock_balances', 'list_tasks', 'run_report']) expect(names).toContain(n);
  });

  test('no token and cookie session are rejected', async () => {
    const none = await rpc('tools/list', {}, null);
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('token_required');
    const cookie = await rpc('tools/list', {}, null, owner);
    expect(cookie.status).toBe(401);
  });

  test('foreign workspace header is rejected', async () => {
    const other = new Client();
    await other.signup({ workspaceName: 'Other MCP' });
    const r = await new Client().req('POST', '/mcp', { ws: other.workspaceId, headers: { accept: ACCEPT, authorization: `Bearer ${fullToken}` }, json: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } });
    expect(r.status).toBe(403);
  });

  test('GET /mcp is 405', async () => {
    const r = await new Client().req('GET', '/mcp', { ws: null, headers: { authorization: `Bearer ${fullToken}` } });
    expect(r.status).toBe(405);
  });

  test('whoami shows token restrictions', async () => {
    const r = await callTool(crmToken, 'whoami');
    expect(r.isError).toBe(false);
    const body = JSON.parse(r.text);
    expect(body.token.sections).toEqual(['crm']);
    expect(body.token.readOnly).toBe(true);
  });

  test('search by crm token finds the company and no documents', async () => {
    await owner.post('/documents', { type: 'invoice', counterpartyId: companyId, comment: 'Ромашка' });
    const r = await callTool(crmToken, 'search', { query: 'Ромашка' });
    expect(r.isError).toBe(false);
    const { groups } = JSON.parse(r.text);
    const company = groups.find((g: { kind: string }) => g.kind === 'company');
    expect(company.items.some((i: { id: string }) => i.id === companyId)).toBe(true);
    expect(groups.some((g: { kind: string }) => g.kind === 'document')).toBe(false);
  });

  test('list_documents by crm token is an error with token_section_forbidden', async () => {
    const r = await callTool(crmToken, 'list_documents');
    expect(r.isError).toBe(true);
    expect(r.text).toContain('token_section_forbidden');
  });

  test('get_entity: own record works, unknown id is an error', async () => {
    const own = await callTool(fullToken, 'get_entity', { kind: 'company', id: companyId });
    expect(own.isError).toBe(false);
    expect(JSON.parse(own.text).name).toBe('Ромашка МСП');
    const missing = await callTool(fullToken, 'get_entity', { kind: 'company', id: '00000000-0000-4000-8000-000000000000' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('not_found');
  });

  test('list tools work with the full token', async () => {
    expect((await callTool(fullToken, 'list_entities', { kind: 'company', limit: 5 })).isError).toBe(false);
    expect((await callTool(fullToken, 'list_documents', { limit: 5 })).isError).toBe(false);
    expect((await callTool(fullToken, 'list_tasks', {})).isError).toBe(false);
    expect((await callTool(fullToken, 'stock_balances', { nonZero: true })).isError).toBe(false);
  });

  test('a revoked token stops working', async () => {
    const { token, item } = (await owner.post('/api-tokens', { name: 'MCP revoke' })).body;
    expect((await rpc('tools/list', {}, token)).status).toBe(200);
    await owner.del(`/api-tokens/${item.id}`);
    expect((await rpc('tools/list', {}, token)).status).toBe(401);
  });

  test('long responses are truncated', () => {
    const data = { items: Array.from({ length: 2000 }, (_, i) => ({ id: i, name: 'x'.repeat(100) })), total: 2000 };
    const text = toText(data, 10_000);
    expect(text.length).toBeLessThanOrEqual(10_000);
    const parsed = JSON.parse(text);
    expect(parsed.truncated).toBe(true);
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.total).toBe(2000);
  });

  test('entity kinds and reports point to tenant paths', () => {
    const root = (p: string) => '/' + p.split('/')[1];
    for (const k of Object.values(ENTITY_KINDS)) expect(TENANT_PATHS).toContain(k.path);
    for (const p of Object.values(REPORTS)) expect(TENANT_PATHS).toContain(root(p));
  });
});
