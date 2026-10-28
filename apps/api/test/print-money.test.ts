/* Печать денег (1174ж): ПКО/РКО, поступление на счёт, платёжное поручение 0401060, АО-1, ввод остатков и акт сверки —
   страница в браузере и PDF в воркере (Chromium подменён), блок оплаты ЮКассы с QR в счёте и заказе покупателя. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { pdfRuntime } from '../../worker/src/handlers';
import { Client, admin, app, drainJobs } from './helpers';

let owner: Client;
let other: Client;
let ws: string;
let orgId: string;
let bankId: string;
let cashId: string;
let supplier: string;
let customer: string;
let service: string;
let costItem: string;
let memberId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const raw = (c: Client, path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { cookie: c.cookie, 'x-workspace-id': c.workspaceId!, ...(init.headers as Record<string, string> | undefined) } });
const originalRender = pdfRuntime.render;
let rendered: string[] = [];

beforeAll(async () => {
  pdfRuntime.render = async html => {
    rendered.push(html);
    return Buffer.from(`%PDF-1.4 ${html.length}`);
  };
  owner = new Client();
  await owner.signup({ workspaceName: 'Print money WS' });
  ws = owner.workspaceId!;
  other = new Client();
  await other.signup({ workspaceName: 'Other print WS' });
  orgId = (await owner.get('/organizations')).body.items[0].id;
  bankId = (await mk(owner, `/organizations/${orgId}/bank-accounts`, { bik: '044525225', account: '40702810400000000001', corrAccount: '30101810400000000225', bankName: 'Тест-банк' })).id;
  cashId = (await mk(owner, '/cash-registers', { name: 'Основная касса' })).id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7707083893' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»', inn: '7728168971' })).id;
  await mk(owner, `/companies/${supplier}/bank-accounts`, { bik: '044030653', account: '40702810900000000009', corrAccount: '30101810600000000653', bankName: 'Банк поставщика' });
  service = (await mk(owner, '/products', { name: 'Консультация', kind: 'service', unitCode: '356', price: 0, vatRate: 'none' })).id;
  costItem = (await mk(owner, '/cost-items', { name: 'Канцелярия', kind: 'expense' })).id;
  memberId = (await owner.get('/members')).body.items.find((m: any) => m.email === owner.user!.email).id;
});

afterAll(() => {
  pdfRuntime.render = originalRender;
});

const html = async (c: Client, id: string, form: string) => {
  const res = await raw(c, `/documents/${id}/print/${form}`);
  return { status: res.status, text: await res.text(), csp: res.headers.get('content-security-policy') };
};

describe('печатные формы денег', () => {
  test('платёжное поручение 0401060: оба банка, сумма прописью, назначение; поступление на счёт — плательщик и основание', async () => {
    const out = await mk(owner, '/payments', { type: 'bank_payment', bankAccountId: bankId, operation: 'to_supplier', counterpartyId: supplier, comment: 'Оплата <услуг>', lines: [{ amount: 1500 }] });
    await mk(owner, `/documents/${out.id}/post`);
    const po = await html(owner, out.id, 'payment_order');
    expect(po.status).toBe(200);
    expect(po.csp).toContain("default-src 'none'");
    for (const s of ['Платёжное поручение', '0401060', 'Банк поставщика', '044030653', '40702810900000000009', '40702810400000000001', 'Одна тысяча пятьсот рублей 00 копеек', 'Оплата &lt;услуг&gt;']) expect(po.text).toContain(s);
    expect(po.text).not.toContain('ЧЕРНОВИК');
    // чужая для типа форма
    expect((await html(owner, out.id, 'bank_receipt')).status).toBe(422);

    const inc = await mk(owner, '/payments', { type: 'bank_receipt', bankAccountId: bankId, operation: 'from_customer', counterpartyId: customer, lines: [{ amount: 700 }] });
    const draft = await html(owner, inc.id, 'bank_receipt');
    expect(draft.text).toContain('Поступление на расчётный счёт');
    expect(draft.text).toContain('ООО «Покупатель»');
    expect(draft.text).toContain('ЧЕРНОВИК');
  });

  test('АО-1, ввод остатков, ПКО по общему маршруту документов', async () => {
    const issue = await mk(owner, '/payments', { type: 'cash_payment', cashRegisterId: cashId, operation: 'to_accountable', accountableMemberId: memberId, lines: [{ amount: 1000 }] });
    await mk(owner, `/documents/${issue.id}/post`);
    const flow = (await owner.get('/cash-flow-items?kind=expense')).body.items[0].id;
    const rep = await mk(owner, '/payments', { type: 'advance_report', accountableMemberId: memberId, lines: [{ amount: 300, costItemId: costItem, cashFlowItemId: flow, comment: 'Бумага' }] });
    const ao = await html(owner, rep.id, 'advance_report');
    expect(ao.text).toContain('АО-1');
    expect(ao.text).toContain('Бумага');
    expect(ao.text).toContain('Канцелярия');

    const open = await mk(owner, '/opening-balances', { date: '2026-01-01', lines: [{ kind: 'cash', cashRegisterId: cashId, amount: '10000.00' }, { kind: 'bank', bankAccountId: bankId, amount: '250000.50' }] });
    const ob = await html(owner, open.id, 'opening_balance');
    expect(ob.text).toContain('Остатки в кассах');
    expect(ob.text).toContain('Остатки на расчётных счетах');
    expect(ob.text).not.toContain('Задолженность покупателей');

    const ko = await mk(owner, '/payments', { type: 'cash_receipt', cashRegisterId: cashId, operation: 'other_income', lines: [{ amount: 50, cashFlowItemId: (await owner.get('/cash-flow-items?kind=income')).body.items[0].id }] });
    expect((await html(owner, ko.id, 'ko1')).text).toContain('КО-1');
    // чужой арендатор документ не видит
    expect((await html(other, ko.id, 'ko1')).status).toBe(404);
  });

  test('PDF денежной формы: задача воркеру, та же страница, что в предпросмотре', async () => {
    const out = await mk(owner, '/payments', { type: 'bank_payment', bankAccountId: bankId, operation: 'to_supplier', counterpartyId: supplier, lines: [{ amount: 90 }] });
    expect((await owner.post(`/documents/${out.id}/pdf`, { form: 'ko2' })).status).toBe(422);
    const r = await owner.post(`/documents/${out.id}/pdf`, { form: 'payment_order' });
    expect(r.status).toBe(202);
    rendered = [];
    await drainJobs();
    expect((await owner.get(`/documents/${out.id}/pdf/${r.body.id}`)).body.status).toBe('ready');
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toBe((await html(owner, out.id, 'payment_order')).text);
    const dl = await raw(owner, `/documents/${out.id}/pdf/${r.body.id}?download=1`);
    expect(dl.headers.get('content-type')).toBe('application/pdf');
  });

  test('акт сверки в PDF: файл в document_exports, скачивание, изоляция', async () => {
    const r = await owner.post(`/payments/settlements/${customer}/act/pdf?side=customer&from=2026-01-01&to=2026-12-31`);
    expect(r.status).toBe(202);
    rendered = [];
    await drainJobs();
    const st = await owner.get(`/payments/act-files/${r.body.id}`);
    expect(st.body).toMatchObject({ status: 'ready' });
    expect(rendered[0]).toContain('Акт сверки взаиморасчётов');
    const dl = await raw(owner, `/payments/act-files/${r.body.id}?download=1`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    expect((await other.get(`/payments/act-files/${r.body.id}`)).status).toBe(404);
    expect((await owner.post(`/payments/settlements/${crypto.randomUUID()}/act/pdf`)).status).toBe(404);
  });
});

describe('ссылка на оплату ЮКассы в счёте и заказе', () => {
  test('без ссылки блока нет; с живой ссылкой — URL и QR в счёте и в заказе; оплаченная и отменённая не печатаются', async () => {
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, lines: [{ productId: service, qty: 1, price: '2500.00', vatRate: 'none' }] });
    await mk(owner, `/documents/${order.id}/post`);
    const inv = await mk(owner, `/documents/${order.id}/based-on`, { type: 'invoice' });
    expect((await html(owner, inv.id, 'invoice')).text).not.toContain('Оплатить онлайн');

    const ybank = (await mk(owner, `/organizations/${orgId}/bank-accounts`, { bik: '044525225', account: '40702810400000000077', bankName: 'ЮКасса' })).id;
    await owner.put('/bank-connections', { bankAccountId: ybank, provider: 'yookassa' });
    const [conn] = await admin`select id from bank_connections where workspace_id = ${ws} and provider = 'yookassa'`;
    const url = 'https://yoomoney.test/checkout/pay-1';
    await admin`insert into payment_links (workspace_id, document_id, connection_id, amount, status, provider_payment_id, confirmation_url) values (${ws}, ${order.id}, ${conn!.id}, 2500, 'pending', 'pay-1', ${url})`;
    // ссылка привязана к корню цепочки (заказу), поэтому видна и в счёте на основании заказа
    for (const [id, form] of [[inv.id, 'invoice'], [order.id, 'invoice']] as const) {
      const p = await html(owner, id, form);
      expect(p.text).toContain('Оплатить онлайн');
      expect(p.text).toContain(url);
      expect(p.text).toContain('<svg');
    }
    await admin`update payment_links set status = 'canceled' where workspace_id = ${ws}`;
    expect((await html(owner, inv.id, 'invoice')).text).not.toContain('Оплатить онлайн');
  });
});
