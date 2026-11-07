/* MCP-запись (задача 1287, docs/architecture/mcp.md, «Запись»): инструменты записи только у токена не read-only,
   post_document — по can_post, can_post проверяется и в HTTP-маршрутах (403 token_cannot_post), пометка «через агента»
   в ленте активности и лимит частоты запросов токена (429 token_rate_limited с Retry-After).
   Внутренние вызовы инструментов в лимит не входят — считается только сам запрос к /mcp. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resetTokenRate } from '../src/token-rate';
import { Client } from './helpers';

let owner: Client;
let ws: string;
let projectId: string;
let companyId: string;
let productId: string;
/** Токен на запись без права проводить */
let writeToken: string;
/** Токен на запись с правом проводить, оплачивать, удалять */
let postToken: string;
/** Токен только для чтения */
let readToken: string;

const ACCEPT = 'application/json, text/event-stream';
let rpcId = 0;
/** JSON-RPC в /mcp от имени токена (без cookie) */
const rpc = (method: string, params: unknown, token: string) =>
  new Client().req('POST', '/mcp', {
    ws: null,
    headers: { accept: ACCEPT, authorization: `Bearer ${token}` },
    json: { jsonrpc: '2.0', id: ++rpcId, method, params },
  });
const toolNames = async (token: string): Promise<string[]> => {
  const r = await rpc('tools/list', {}, token);
  expect(r.status).toBe(200);
  return r.body.result.tools.map((t: { name: string }) => t.name);
};
const callTool = async (token: string, name: string, args: Record<string, unknown> = {}) => {
  const r = await rpc('tools/call', { name, arguments: args }, token);
  expect(r.status).toBe(200);
  const result = r.body.result;
  return { isError: !!result.isError, text: result.content[0].text as string };
};
/** Успешный инструмент записи: результат — JSON записи */
const mutate = async (token: string, name: string, args: Record<string, unknown>) => {
  const r = await callTool(token, name, args);
  expect({ name, ...r }).toMatchObject({ isError: false });
  return JSON.parse(r.text) as Record<string, any>;
};
/** HTTP-запрос токеном (без cookie) */
const tok = (method: string, path: string, token: string, json?: unknown) =>
  new Client().req(method, path, { ws, headers: { authorization: `Bearer ${token}` }, json });
const mk = async (path: string, body: Record<string, unknown>) => {
  const r = await owner.post(path, body);
  if (r.status !== 201) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'MCP write WS' });
  ws = owner.workspaceId!;
  projectId = await mk('/projects', { key: 'MCPW', name: 'Запись через MCP' });
  companyId = await mk('/companies', { name: 'ООО «Контрагент MCP»' });
  productId = await mk('/products', { name: 'Товар MCP', unitCode: '006', price: 100, vatRate: '20' });
  writeToken = (await owner.post('/api-tokens', { name: 'MCP write', readOnly: false })).body.token;
  postToken = (await owner.post('/api-tokens', { name: 'MCP write post', readOnly: false, canPost: true })).body.token;
  readToken = (await owner.post('/api-tokens', { name: 'MCP read' })).body.token;
});

afterAll(() => resetTokenRate());

describe('mcp write: набор инструментов по правам токена', () => {
  const WRITE_TOOLS = ['create_task', 'update_task', 'add_comment', 'create_deal', 'update_deal', 'create_lead', 'create_document'];

  test('read-only token sees no write tools', async () => {
    const names = await toolNames(readToken);
    for (const n of [...WRITE_TOOLS, 'post_document']) expect(names).not.toContain(n);
    expect(names).toContain('list_tasks');
  });

  test('write token sees write tools except post_document', async () => {
    const names = await toolNames(writeToken);
    for (const n of WRITE_TOOLS) expect(names).toContain(n);
    expect(names).not.toContain('post_document');
  });

  test('can_post token sees post_document too', async () => {
    expect(await toolNames(postToken)).toContain('post_document');
  });

  test('write tools are not read-only and posting is destructive', async () => {
    const r = await rpc('tools/list', {}, postToken);
    const byName = new Map<string, { annotations?: Record<string, unknown> }>(r.body.result.tools.map((t: { name: string }) => [t.name, t]));
    expect(byName.get('create_task')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.get('post_document')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe('mcp write: инструменты создают записи', () => {
  test('create_task, add_comment and update_task work; activity is marked with the token name', async () => {
    const task = await mutate(writeToken, 'create_task', { projectId, title: 'Задача из MCP', priority: 3, dueDate: '2026-03-01' });
    expect(task).toMatchObject({ title: 'Задача из MCP', projectId, priority: 3, status: 'todo' });
    expect(task.key).toMatch(/^MCPW-\d+$/);

    const comment = await mutate(writeToken, 'add_comment', { taskId: task.id, body: 'Комментарий агента' });
    expect(comment).toMatchObject({ taskId: task.id, body: 'Комментарий агента' });

    const updated = await mutate(writeToken, 'update_task', { id: task.id, status: 'progress', priority: 5 });
    expect(updated).toMatchObject({ id: task.id, status: 'progress', priority: 5 });

    // лента активности: строки задачи несут название токена — «через агента: MCP write»
    const feed = await owner.get(`/activity?taskId=${task.id}`);
    expect(feed.status).toBe(200);
    expect(feed.body.items.length).toBeGreaterThan(0);
    for (const row of feed.body.items) expect(row.apiTokenName).toBe('MCP write');

    // журнал событий помечает записи так же
    const events = await owner.get(`/events?recordId=${task.id}`);
    expect(events.body.items.length).toBeGreaterThan(0);
    expect(events.body.items.every((e: { apiTokenName: string | null }) => e.apiTokenName === 'MCP write')).toBe(true);
  });

  test('create_deal and update_deal work', async () => {
    const deal = await mutate(writeToken, 'create_deal', { name: 'Сделка MCP', companyId, amount: '1500.50', closeDate: '2026-04-01' });
    expect(deal).toMatchObject({ name: 'Сделка MCP', companyId, closeDate: '2026-04-01' });
    expect(Number(deal.amount)).toBe(1500.5);
    const stages = await owner.get(`/deal-stages?pipelineId=${deal.pipelineId}`);
    const stage = stages.body.items.find((s: { id: string }) => s.id !== deal.stageId);
    const updated = await mutate(writeToken, 'update_deal', { id: deal.id, name: 'Сделка MCP 2', amount: '2000' });
    expect(updated).toMatchObject({ id: deal.id, name: 'Сделка MCP 2' });
    expect(Number(updated.amount)).toBe(2000);
    if (stage) expect((await mutate(writeToken, 'update_deal', { id: deal.id, stageId: stage.id })).stageId).toBe(stage.id);
  });

  test('create_lead works', async () => {
    const lead = await mutate(writeToken, 'create_lead', { name: 'Лид MCP', companyName: 'Ромашка', phone: '+7 900 000-00-00', source: 'Сайт MCP' });
    expect(lead).toMatchObject({ name: 'Лид MCP', companyName: 'Ромашка', phone: '+7 900 000-00-00' });
  });

  test('create_document makes a draft; a failed tool call is an error, not a crash', async () => {
    const draft = await mutate(writeToken, 'create_document', {
      type: 'invoice',
      counterpartyId: companyId,
      date: '2026-02-01',
      comment: 'Черновик счёта из MCP',
      lines: [{ productId, qty: '2', price: '100' }],
    });
    expect(draft).toMatchObject({ type: 'invoice', status: 'draft', counterpartyId: companyId, comment: 'Черновик счёта из MCP' });
    expect(draft.lines).toHaveLength(1);
    // отказ маршрута API (нет такого проекта) приходит агенту как ошибка инструмента
    const bad = await callTool(writeToken, 'create_task', { projectId: '00000000-0000-4000-8000-000000000000', title: 'Некуда' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('invalid_reference');
  });
});

describe('mcp write: кабина can_post', () => {
  const draftInvoice = async () =>
    mutate(writeToken, 'create_document', { type: 'invoice', counterpartyId: companyId, lines: [{ productId, qty: '1', price: '100' }] });

  test('a token without can_post cannot post or delete over HTTP', async () => {
    const draft = await draftInvoice();
    const posted = await tok('POST', `/documents/${draft.id}/post`, writeToken);
    expect(posted.status).toBe(403);
    expect(posted.body.error.code).toBe('token_cannot_post');
    const removed = await tok('DELETE', `/documents/${draft.id}`, writeToken);
    expect(removed.status).toBe(403);
    expect(removed.body.error.code).toBe('token_cannot_post');
    expect((await owner.get(`/documents/${draft.id}`)).body.status).toBe('draft');
  });

  test('a token with can_post posts a document through the tool', async () => {
    const draft = await draftInvoice();
    const posted = await mutate(postToken, 'post_document', { id: draft.id });
    expect(posted).toMatchObject({ id: draft.id, status: 'posted' });
    expect(posted.number).toBeTruthy();
  });
});

describe('mcp write: лимит частоты', () => {
  const withLimit = async (limit: string, run: () => Promise<void>) => {
    const before = process.env.API_TOKEN_RATE_LIMIT;
    process.env.API_TOKEN_RATE_LIMIT = limit;
    resetTokenRate();
    try {
      await run();
    } finally {
      process.env.API_TOKEN_RATE_LIMIT = before;
      resetTokenRate();
    }
  };

  test('the 6th request over a limit of 5 is 429 with Retry-After', async () => {
    await withLimit('5', async () => {
      for (let i = 0; i < 5; i++) expect((await rpc('tools/list', {}, readToken)).status).toBe(200);
      const over = await rpc('tools/list', {}, readToken);
      expect(over.status).toBe(429);
      expect(over.body.error.code).toBe('token_rate_limited');
      expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
      // другой токен лимитом не задет
      expect((await rpc('tools/list', {}, writeToken)).status).toBe(200);
    });
  });

  test('internal calls of one tool are not counted: one tools/call costs one request', async () => {
    await withLimit('2', async () => {
      // search делает несколько внутренних GET — считается только сам /mcp
      const found = await callTool(readToken, 'search', { query: 'Товар MCP' });
      expect(found.isError).toBe(false);
      expect((await rpc('tools/list', {}, readToken)).status).toBe(200);
      expect((await rpc('tools/list', {}, readToken)).status).toBe(429);
    });
  });
});
