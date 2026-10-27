/* Адаптеры API банков и ЮКассы на фикстурах: сеть подменена, запросов наружу нет. */
import { describe, expect, test } from 'bun:test';
import { BankApiError, bankDirection, sberStatement, tbankStatement, tochkaStatement, yooCreatePayment, yooGetPayment, yooWebhookBody, type Fetcher, type HttpCall, type StatementContext } from '../src';

const OWN = '40702810400000000001';
const ok = (json: unknown) => ({ status: 200, json, text: JSON.stringify(json) });
const ctx = (fetch: Fetcher, secrets: Record<string, string>): StatementContext => ({ account: OWN, bik: '044525974', from: '2026-10-01', to: '2026-10-02', secrets, fetch, base: 'http://bank.test', sleep: async () => {} });

describe('Т-Банк', () => {
  test('страницы по курсору, приход и расход, направление определяется по нашему счёту', async () => {
    const calls: HttpCall[] = [];
    const pages = [
      { operations: [{ operationId: 'op1', operationDate: '2026-10-01T10:00:00Z', typeOfOperation: 'Credit', operationAmount: 1000.5, payPurpose: 'Оплата по счёту № 45', counterParty: { name: 'ООО Покупатель', inn: '7728168971', account: '40702810999999999991', bicRu: '044525225' } }], nextCursor: 'c2' },
      { operations: [{ operationId: 'op2', operationDate: '2026-10-02T09:00:00Z', typeOfOperation: 'Debit', operationAmount: '250.00', payPurpose: 'Аренда', counterParty: { name: 'ИП Сидоров', inn: '500100732259', account: '40702810888888888881' } }, { operationId: 'bad', operationDate: '2026-10-02', typeOfOperation: 'Debit' }] },
    ];
    const r = await tbankStatement(ctx(async c => (calls.push(c), ok(pages[calls.length - 1])), { token: 'tkn' }));
    expect(calls[0]!.headers!.authorization).toBe('Bearer tkn');
    expect(calls[1]!.url).toContain('cursor=c2');
    expect(r.transactions).toHaveLength(2);
    expect(r.skipped).toBe(1);
    const [a, b] = r.transactions;
    expect(a!.amount).toBe('1000.50');
    expect(bankDirection(a!, [OWN])).toBe('in');
    expect(a!.payer.inn).toBe('7728168971');
    expect(bankDirection(b!, [OWN])).toBe('out');
    expect(b!.receiver.inn).toBe('500100732259');
  });
  test('401 — ошибка авторизации, 503 — временная', async () => {
    await expect(tbankStatement(ctx(async () => ({ status: 401, json: null, text: '' }), { token: 'x' }))).rejects.toMatchObject({ kind: 'auth' });
    await expect(tbankStatement(ctx(async () => ({ status: 503, json: null, text: '' }), { token: 'x' }))).rejects.toMatchObject({ kind: 'transient' });
    await expect(tbankStatement(ctx(async () => ok({}), {}))).rejects.toBeInstanceOf(BankApiError);
  });
});

describe('Точка', () => {
  const tx = [{ transactionId: 't1', documentProcessDate: '2026-10-01', creditDebitIndicator: 'Credit', Amount: { amount: 700 }, DebtorParty: { name: 'ООО Покупатель', inn: '7728168971' }, DebtorAccount: { identification: '40702810999999999991' }, DebtorAgent: { identification: '044525225', name: 'Банк' }, description: 'Оплата', documentNumber: '77' }];
  test('заказ выписки, ожидание готовности, разбор', async () => {
    let polls = 0;
    const calls: HttpCall[] = [];
    const r = await tochkaStatement(
      ctx(async c => {
        calls.push(c);
        if (c.method === 'POST') return ok({ Data: { Statement: { statementId: 'st1', status: 'Created' } } });
        return ok({ Data: { Statement: [++polls < 2 ? { status: 'Processing' } : { status: 'Ready', Transaction: tx }] } });
      }, { token: 'jwt' }),
    );
    expect(JSON.parse(calls[0]!.body!).Data.Statement.accountId).toBe(`${OWN}/044525974`);
    expect(polls).toBe(2);
    expect(r.transactions[0]!.number).toBe('77');
    expect(bankDirection(r.transactions[0]!, [OWN])).toBe('in');
  });
  test('не готова — transient', async () => {
    const f: Fetcher = async c => (c.method === 'POST' ? ok({ Data: { Statement: { statementId: 's' } } }) : ok({ Data: { Statement: [{ status: 'Processing' }] } }));
    await expect(tochkaStatement(ctx(f, { token: 'j' }))).rejects.toMatchObject({ kind: 'transient' });
  });
});

describe('Сбер', () => {
  test('refresh-токен, ротация, выписка по дням', async () => {
    const days: string[] = [];
    const f: Fetcher = async c => {
      if (c.url.includes('/oauth/token')) {
        expect(c.body).toContain('grant_type=refresh_token');
        return ok({ access_token: 'acc', refresh_token: 'new-refresh' });
      }
      expect(c.headers!.authorization).toBe('Bearer acc');
      const day = new URL(c.url).searchParams.get('statementDate')!;
      days.push(day);
      return ok({ transactions: day === '2026-10-01' ? [{ uuid: 'u1', number: '5', direction: 'DEBIT', operationDate: '2026-10-01', amountRub: { amount: '99.90' }, paymentPurpose: 'Оплата', rurTransfer: { payeeName: 'ООО Поставщик', payeeInn: '7707083893', payeeAccount: '40702810111111111111' } }] : [] });
    };
    const r = await sberStatement(ctx(f, { client_id: 'i', client_secret: 's', refresh_token: 'old' }));
    expect(days).toEqual(['2026-10-01', '2026-10-02']);
    expect(r.updatedSecrets).toEqual({ refresh_token: 'new-refresh' });
    expect(bankDirection(r.transactions[0]!, [OWN])).toBe('out');
    expect(r.transactions[0]!.amount).toBe('99.90');
  });
  test('отказ в токене — auth', async () => {
    await expect(sberStatement(ctx(async () => ({ status: 400, json: null, text: '' }), { client_id: 'i', client_secret: 's', refresh_token: 'r' }))).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('ЮКасса', () => {
  const payment = (status: string) => ({ id: 'pay-1', status, paid: status === 'succeeded', amount: { value: '1500.00', currency: 'RUB' }, confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/pay-1' }, metadata: { document_id: 'd1' } });
  test('создание платежа: Basic-авторизация, ключ идемпотентности, redirect', async () => {
    let call!: HttpCall;
    const p = await yooCreatePayment(async c => ((call = c), ok(payment('pending'))), { shopId: '123', secretKey: 'key' }, { amount: '1500.00', description: 'Счёт 45', returnUrl: 'https://app.test/back', metadata: { document_id: 'd1' }, idempotenceKey: 'idem-1' }, 'http://yoo.test');
    expect(call.headers!.authorization).toBe(`Basic ${btoa('123:key')}`);
    expect(call.headers!['idempotence-key']).toBe('idem-1');
    expect(JSON.parse(call.body!)).toMatchObject({ capture: true, confirmation: { type: 'redirect', return_url: 'https://app.test/back' }, amount: { value: '1500.00', currency: 'RUB' } });
    expect(p.confirmationUrl).toContain('yoomoney');
  });
  test('получение платежа и разбор вебхука', async () => {
    const p = await yooGetPayment(async () => ok(payment('succeeded')), { shopId: '1', secretKey: 'k' }, 'pay-1', 'http://yoo.test');
    expect(p).toMatchObject({ status: 'succeeded', paid: true, amount: '1500.00' });
    await expect(yooGetPayment(async () => ({ status: 404, json: null, text: '' }), { shopId: '1', secretKey: 'k' }, 'x')).rejects.toMatchObject({ kind: 'permanent' });
    expect(yooWebhookBody.safeParse({ type: 'notification', event: 'payment.succeeded', object: { id: 'pay-1' } }).success).toBe(true);
    expect(yooWebhookBody.safeParse({ event: 'x' }).success).toBe(false);
  });
});
