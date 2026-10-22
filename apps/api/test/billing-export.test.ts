/* Выгрузка счетов периода одним ZIP-архивом: POST /billing/export ставит задачу воркера, статус и скачивание архива —
   GET /billing/export/:id. Права — admin+, чужие счета и не-счета отклоняются, повторный запуск создаёт новый архив. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { pdfRuntime } from '../../worker/src/handlers';
import { readZip } from '../../worker/test/zip-reader';
import { Client, app, drainJobs } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let customer: string;
let service: string;
let invoiceA: string;
let invoiceB: string;
let act: string;
let numbers: string[] = [];

/** Стабильный «PDF» без Chromium: содержимое зависит от печатной формы, поэтому счета различаются */
const fakePdf = (html: string) => {
  let h = 0;
  for (const ch of html) h = (h * 31 + ch.charCodeAt(0)) % 2 ** 31;
  return Buffer.from(`%PDF-1.4 ${h}`);
};

const originalRender = pdfRuntime.render;

beforeAll(async () => {
  pdfRuntime.render = async html => fakePdf(html); // Chromium в тестах не нужен
  owner = new Client();
  await owner.signup({ workspaceName: 'Выгрузка WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужой WS' });
  customer = (await owner.post('/companies', { name: 'ООО «Покупатель»', inn: '7707083893' })).body.id;
  service = (await owner.post('/products', { name: 'Консультация', kind: 'service', unitCode: '356', price: 1000, vatRate: 'none' })).body.id;
  const mkDoc = async (type: string) => {
    const d = (await owner.post('/documents', { type, counterpartyId: customer, lines: [{ productId: service, qty: 1, price: 1000 }] })).body;
    const posted = await owner.post(`/documents/${d.id}/post`);
    if (posted.status !== 200) throw new Error(`post ${type}: ${posted.status} ${JSON.stringify(posted.body)}`);
    return posted.body;
  };
  invoiceA = (await mkDoc('invoice')).id;
  invoiceB = (await mkDoc('invoice')).id;
  act = (await mkDoc('act')).id;
  numbers = [(await owner.get(`/documents/${invoiceA}`)).body.number, (await owner.get(`/documents/${invoiceB}`)).body.number];
});

afterAll(async () => {
  pdfRuntime.render = originalRender;
});

describe('billing export (ZIP)', () => {
  test('an archive holds one PDF per invoice and unpacks without errors', async () => {
    const res = await owner.post('/billing/export', { documentIds: [invoiceA, invoiceB] });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'pending', count: 2 });
    const id = res.body.id as string;

    const pending = await owner.get(`/billing/export/${id}`);
    expect(pending.status).toBe(200);
    expect(pending.body).toMatchObject({ id, status: 'pending', count: 2 });

    await drainJobs();

    const st = await owner.get(`/billing/export/${id}`);
    expect(st.body).toMatchObject({ status: 'ready', count: 2 });
    expect(st.body.size).toBeGreaterThan(0);

    const file = await app.request(`/billing/export/${id}?download=1`, { headers: { cookie: owner.cookie, 'x-workspace-id': owner.workspaceId! } });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/zip');
    expect(file.headers.get('content-disposition')).toContain('.zip');

    const entries = readZip(new Uint8Array(await file.arrayBuffer()));
    expect(entries.map(e => e.name)).toEqual(numbers.map(n => `${n}.pdf`));
    // содержимое каждого файла — свой PDF (печатная форма своего счёта)
    expect(new Set(entries.map(e => new TextDecoder().decode(e.data))).size).toBe(2);
    for (const e of entries) expect(new TextDecoder().decode(e.data).startsWith('%PDF-')).toBe(true);
  });

  test('a second export makes a new archive', async () => {
    const first = await owner.post('/billing/export', { documentIds: [invoiceA] });
    const second = await owner.post('/billing/export', { documentIds: [invoiceA] });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body.id).not.toBe(first.body.id);
    await drainJobs();
    expect((await owner.get(`/billing/export/${first.body.id}`)).body.status).toBe('ready');
    expect((await owner.get(`/billing/export/${second.body.id}`)).body.status).toBe('ready');
  });

  test('a document of another workspace is rejected', async () => {
    const foreignCompany = (await other.post('/companies', { name: 'ООО «Чужой клиент»', inn: '7707083893' })).body.id;
    const foreignService = (await other.post('/products', { name: 'Чужая услуга', kind: 'service', unitCode: '356', price: 1000, vatRate: 'none' })).body.id;
    const foreign = (await other.post('/documents', { type: 'invoice', counterpartyId: foreignCompany, lines: [{ productId: foreignService, qty: 1, price: 1000 }] })).body;
    const res = await owner.post('/billing/export', { documentIds: [foreign.id] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('document_not_found');
  });

  test('a document that is not an invoice is rejected', async () => {
    const res = await owner.post('/billing/export', { documentIds: [act] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('not_an_invoice');
  });

  test('an empty list is rejected', async () => {
    const res = await owner.post('/billing/export', { documentIds: [] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('no_documents');
  });

  test('a member without the admin role cannot export', async () => {
    const res = await member.post('/billing/export', { documentIds: [invoiceA] });
    expect(res.status).toBe(403);
    expect((await member.get('/billing/export/00000000-0000-4000-8000-000000000000')).status).toBe(403);
  });

  test('an archive of another workspace is not visible', async () => {
    const res = await owner.post('/billing/export', { documentIds: [invoiceA] });
    await drainJobs();
    const foreign = await other.get(`/billing/export/${res.body.id}`);
    expect(foreign.status).toBe(404);
  });
});
