/* Задача 1174д: API банков (Т-Банк на подставном сервере-фикстуре) через общий импорт выписки, задачи bank.sync / yookassa.payment,
   ссылка на оплату и вебхук ЮКассы с перепроверкой статуса, права и изоляция арендаторов. Наружу запросов нет: `integrationRuntime.deps`. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { integrationRuntime, readSecret, withContext } from '@gr8r/db';
import type { Fetcher, HttpCall } from '@gr8r/shared';
import { defaultOptions, processJobsOnce } from '../../worker/src/worker';
import { Client, admin, app, sql } from './helpers';

const OWN = '40702810400000000077';
const OWN2 = '40702810400000000088';
const quiet = defaultOptions({ log: () => {}, ddl: null });
const ok = (json: unknown) => ({ status: 200, json, text: JSON.stringify(json) });
const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let bankId: string;
let yooBankId: string;
let customerId: string;
let service: string;
let connId: string;

/** Подставной банк: отдаёт заранее заданные ответы и запоминает запросы */
const calls: HttpCall[] = [];
let bankReply: (c: HttpCall) => { status: number; json: unknown; text: string } = () => ok({ operations: [] });
let yoo: Record<string, { status: string; amount: string }> = {};
const fake: Fetcher = async c => {
  calls.push(c);
  if (c.url.includes('/payments') && c.method === 'POST') {
    const id = `pay-${calls.length}`;
    yoo[id] = { status: 'pending', amount: JSON.parse(c.body!).amount.value };
    return ok({ id, status: 'pending', paid: false, amount: { value: yoo[id]!.amount, currency: 'RUB' }, confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.test/checkout/${id}` } });
  }
  if (c.url.includes('/payments/')) {
    const id = decodeURIComponent(c.url.split('/payments/')[1]!);
    const p = yoo[id];
    if (!p) return { status: 404, json: null, text: '' };
    return ok({ id, status: p.status, paid: p.status === 'succeeded', amount: { value: p.amount, currency: 'RUB' } });
  }
  return bankReply(c);
};

beforeAll(async () => {
  process.env.SECRETS_KEY = 'c'.repeat(64);
  integrationRuntime.deps = { fetch: fake, sleep: async () => {}, today: () => '2026-10-27' };
  owner = new Client();
  await owner.signup({ workspaceName: 'Integrations WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Other integrations WS' });
  service = (await mk(owner, '/products', { name: 'Консультация', kind: 'service', price: 0, vatRate: 'none' })).id;
  const orgId = (await owner.get('/organizations')).body.items[0].id;
  bankId = (await mk(owner, `/organizations/${orgId}/bank-accounts`, { bik: '044525225', account: OWN, bankName: 'Т-Банк' })).id;
  yooBankId = (await mk(owner, `/organizations/${orgId}/bank-accounts`, { bik: '044525225', account: OWN2, bankName: 'Банк эквайринга' })).id;
  customerId = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7728168971' })).id;
});
afterAll(() => {
  delete process.env.SECRETS_KEY;
});

const act = async (price: string) => {
  const d = await mk(owner, '/documents', { type: 'act', counterpartyId: customerId, date: '2026-10-15', lines: [{ productId: service, qty: 1, price, vatRate: 'none' }] });
  await mk(owner, `/documents/${d.id}/post`);
  return { id: d.id as string, number: (await owner.get(`/documents/${d.id}`)).body.number as string };
};
const status = async (id: string) => (await owner.get(`/payments/status?ids=${id}`)).body.items[id];
const lastDigits = (n: string) => (n.match(/\d+/g) ?? []).pop()!.replace(/^0+(?=\d)/, '');
const jobsOf = async (type: string) => (await admin`select status, last_error from jobs where type = ${type} and workspace_id = ${ws} order by created_at`) as unknown as { status: string; last_error: string | null }[];

describe('подключение банка', () => {
  test('права: настройка — admin и owner; ответ не содержит значений секретов', async () => {
    const body = { bankAccountId: bankId, provider: 'tbank', syncFrom: '2026-10-01' };
    expect((await member.put('/bank-connections', body)).status).toBe(403);
    expect((await member.get('/bank-connections')).status).toBe(403);
    const r = await owner.put('/bank-connections', body);
    expect(r.status).toBe(200);
    connId = r.body.id;
    const list = (await owner.get('/bank-connections')).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ provider: 'tbank', ready: false, secretPrefix: 'tbank', account: OWN });
    expect(list[0].secrets).toEqual([{ part: 'token', required: true, key: 'tbank.token', present: false }]);
    expect((await owner.put('/bank-connections', { ...body, provider: 'unknown' })).status).toBe(400);
    expect((await owner.put('/bank-connections', { ...body, bankAccountId: crypto.randomUUID() })).status).toBe(422);
    // изоляция
    expect((await other.get('/bank-connections')).body.items).toEqual([]);
    expect((await other.post(`/bank-connections/${connId}/sync`)).status).toBe(404);
  });

  test('без ключа загрузка записывает ошибку и не ходит в сеть', async () => {
    expect((await owner.post(`/bank-connections/${connId}/sync`)).body.queued).toBe(true);
    // вторая постановка, пока первая в очереди, не дублирует
    expect((await owner.post(`/bank-connections/${connId}/sync`)).body.queued).toBe(false);
    calls.length = 0;
    await processJobsOnce(sql, quiet);
    expect(calls).toHaveLength(0);
    const c = (await owner.get('/bank-connections')).body.items[0];
    expect(c.lastStatus).toBe('error');
    expect(c.lastError).toContain('tbank.token');
    expect((await jobsOf('bank.sync')).at(-1)!.status).toBe('done');
  });
});

describe('загрузка операций (Т-Банк)', () => {
  test('создаёт и проводит документы, оплата акта закрывает долг, повтор не дублирует', async () => {
    expect((await owner.put('/secrets/tbank.token', { value: 'bank-token-123' })).status).toBe(200);
    const a = await act('1000');
    bankReply = () =>
      ok({
        operations: [
          { operationId: 'op-1', operationDate: '2026-10-20T10:00:00Z', typeOfOperation: 'Credit', operationAmount: 1000, payPurpose: `Оплата по акту № ${lastDigits(a.number)} от 15.10.2026`, counterParty: { name: 'ООО «Покупатель»', inn: '7728168971', account: '40702810999999999991', bicRu: '044525225' } },
          { operationId: 'op-2', operationDate: '2026-10-21T10:00:00Z', typeOfOperation: 'Debit', operationAmount: 55.5, payPurpose: 'Аренда парковки', counterParty: { name: 'ИП Сидоров', inn: '500100732259', account: '40702810888888888881' } },
        ],
      });
    calls.length = 0;
    await owner.post(`/bank-connections/${connId}/sync`);
    await processJobsOnce(sql, quiet);
    expect(calls[0]!.headers!.authorization).toBe('Bearer bank-token-123');
    expect(calls[0]!.url).toContain(`accountNumber=${OWN}`);
    expect(calls[0]!.url).toContain('from=2026-10-01');
    const c = (await owner.get('/bank-connections')).body.items[0];
    expect(c).toMatchObject({ lastStatus: 'ok', syncedThrough: '2026-10-27', ready: true });
    expect(c.lastResult).toMatchObject({ fetched: 2, created: 1, posted: 1, unmatched: 1, failed: 0 });
    expect(JSON.stringify(c)).not.toContain('bank-token-123');
    expect(await status(a.id)).toMatchObject({ state: 'paid' });
    const docs = (await admin`select type, status, total from documents where workspace_id = ${ws} and type = 'bank_receipt'`) as any[];
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ status: 'posted', total: '1000.00' });

    // повторная загрузка того же окна: дубль определяется по ключу документа
    await owner.post(`/bank-connections/${connId}/sync`);
    await processJobsOnce(sql, quiet);
    const again = (await owner.get('/bank-connections')).body.items[0];
    expect(again.lastResult).toMatchObject({ created: 0, duplicates: 1 });
    expect(await admin`select 1 from documents where workspace_id = ${ws} and type = 'bank_receipt'`).toHaveLength(1);
    // окно со второго раза — с запасом в 3 дня от прошлой даты
    expect(calls.at(-1)!.url).toContain('from=2026-10-24');
  });

  test('401 банка — ошибка ключа без повторов; 503 — задача повторится', async () => {
    bankReply = () => ({ status: 401, json: null, text: '' });
    await owner.post(`/bank-connections/${connId}/sync`);
    await processJobsOnce(sql, quiet);
    let c = (await owner.get('/bank-connections')).body.items[0];
    expect(c).toMatchObject({ lastStatus: 'error' });
    expect(c.lastError).toContain('access denied');
    expect((await jobsOf('bank.sync')).at(-1)!.status).toBe('done');

    bankReply = () => ({ status: 503, json: null, text: '' });
    await owner.post(`/bank-connections/${connId}/sync`);
    await processJobsOnce(sql, quiet);
    const last = (await jobsOf('bank.sync')).at(-1)!;
    expect(last.status).toBe('queued'); // вернулась в очередь с паузой
    expect(last.last_error).toContain('HTTP 503');
    c = (await owner.get('/bank-connections')).body.items[0];
    expect(c.lastStatus).toBe('error');
    await admin`update jobs set status = 'done' where type = 'bank.sync' and workspace_id = ${ws}`;
  });

  test('значения секретов API не отдаёт, воркер читает через readSecret', async () => {
    const list = await owner.get('/secrets');
    expect(JSON.stringify(list.body)).not.toContain('bank-token-123');
    const v = await withContext(sql, { workspaceId: ws }, db => readSecret(db, ws, 'tbank.token'));
    expect(v).toBe('bank-token-123');
  });
});

describe('ЮКасса', () => {
  test('ссылка на оплату требует подключения и ключей', async () => {
    const a = await act('500');
    const body = { documentId: a.id, returnUrl: 'https://app.test/back' };
    expect((await owner.post('/payment-links', body)).body.error.code).toBe('yookassa_not_configured');
    expect((await owner.put('/bank-connections', { bankAccountId: yooBankId, provider: 'yookassa' })).status).toBe(200);
    const noKeys = await owner.post('/payment-links', body);
    expect(noKeys.status).toBe(422);
    expect(noKeys.body.error.message).toContain('yookassa.shop_id');
  });

  test('ссылка → вебхук → перепроверка статуса → поступление на счёт с распределением', async () => {
    await owner.put('/secrets/yookassa.shop_id', { value: '123456' });
    await owner.put('/secrets/yookassa.secret_key', { value: 'live_secret' });
    const a = await act('1500');
    calls.length = 0;
    const link = await owner.post('/payment-links', { documentId: a.id, returnUrl: 'https://app.test/back' });
    expect(link.status).toBe(201);
    expect(link.body).toMatchObject({ amount: '1500.00', reused: false });
    expect(link.body.url).toContain('https://yoomoney.test/checkout/');
    const create = calls[0]!;
    expect(create.headers!.authorization).toBe(`Basic ${btoa('123456:live_secret')}`);
    expect(create.headers!['idempotence-key']).toBeTruthy();
    const payId = link.body.url.split('/').pop() as string;
    // повторный запрос ссылки на тот же остаток возвращает ту же
    const again = await owner.post('/payment-links', { documentId: a.id, returnUrl: 'https://app.test/back' });
    expect(again.body).toMatchObject({ id: link.body.id, reused: true });
    expect((await owner.get(`/payment-links?documentId=${a.id}`)).body.items).toHaveLength(1);

    const hook = (event: string, id: string, w = ws) => app.request(`/hooks/yookassa/${w}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'notification', event, object: { id, status: 'succeeded' } }) });

    // вебхук врёт: говорит «успех», а API ЮКассы отвечает «ожидает» — документ не создаётся
    expect((await hook('payment.succeeded', payId)).status).toBe(200);
    await processJobsOnce(sql, quiet);
    expect(await admin`select 1 from documents where workspace_id = ${ws} and bank_import_key = ${'yookassa|' + payId}`).toHaveLength(0);
    expect((await owner.get(`/payment-links?documentId=${a.id}`)).body.items[0].status).toBe('pending');

    // оплачено: вебхук → задача → поступление на счёт эквайринга
    yoo[payId]!.status = 'succeeded';
    expect((await hook('payment.succeeded', payId)).status).toBe(200);
    await processJobsOnce(sql, quiet);
    const l = (await owner.get(`/payment-links?documentId=${a.id}`)).body.items[0];
    expect(l.status).toBe('succeeded');
    expect(await status(a.id)).toMatchObject({ state: 'paid' });
    const [rec] = (await admin`select type, status, total, bank_account_id, operation from documents where id = ${l.receiptDocumentId}`) as any[];
    expect(rec).toMatchObject({ type: 'bank_receipt', status: 'posted', total: '1500.00', bank_account_id: yooBankId, operation: 'from_customer' });

    // повторный вебхук ничего не создаёт
    await hook('payment.succeeded', payId);
    await processJobsOnce(sql, quiet);
    expect(await admin`select 1 from documents where workspace_id = ${ws} and bank_import_key = ${'yookassa|' + payId}`).toHaveLength(1);
    // оплаченный документ ссылки больше не получает
    expect((await owner.post('/payment-links', { documentId: a.id, returnUrl: 'https://app.test/back' })).body.error.code).toBe('nothing_to_pay');
  });

  test('отмена платежа, неизвестный платёж, чужой воркспейс, мусор в теле', async () => {
    const a = await act('300');
    const link = await owner.post('/payment-links', { documentId: a.id, returnUrl: 'https://app.test/back' });
    const payId = link.body.url.split('/').pop() as string;
    const post = (w: string, body: unknown) => app.request(`/hooks/yookassa/${w}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    yoo[payId]!.status = 'canceled';
    await post(ws, { type: 'notification', event: 'payment.canceled', object: { id: payId } });
    await processJobsOnce(sql, quiet);
    expect((await owner.get(`/payment-links?documentId=${a.id}`)).body.items[0].status).toBe('canceled');

    const before = (await jobsOf('yookassa.payment')).length;
    const unknown = await post(ws, { type: 'notification', event: 'payment.succeeded', object: { id: 'nope' } });
    expect(unknown.status).toBe(200); // ответ одинаков — наличие платежа не раскрывается
    // чужой воркспейс: ссылка не видна, задача не ставится
    expect((await post(other.workspaceId!, { type: 'notification', event: 'payment.succeeded', object: { id: payId } })).status).toBe(200);
    expect((await jobsOf('yookassa.payment')).length).toBe(before);
    expect((await post(ws, 'not json')).status).toBe(400);
    expect((await post('not-a-uuid', {})).status).toBe(404);
    expect((await post(ws, { type: 'notification', event: 'x' })).status).toBe(400);
  });

  test('ссылку нельзя создать по поставщику и чужому документу', async () => {
    expect((await other.post('/payment-links', { documentId: (await act('10')).id, returnUrl: 'https://app.test/back' })).status).toBe(404);
    expect((await member.post('/payment-links', { documentId: (await act('10')).id, returnUrl: 'javascript:alert(1)' })).status).toBe(400);
  });
});
