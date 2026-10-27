/* API банков (Т-Банк, Точка, Сбер) и ЮКасса (задача 1174д): запросы и разбор ответов.
   Чистый код: сеть приходит снаружи (`Fetcher`), поэтому адаптеры проверяются на фикстурах. Операции банка приводятся к
   `BankTransaction` — тому же виду, что даёт разбор файла выписки, дальше работает общий импорт (packages/db/src/bank-import.ts).
   Форматы запросов — по документации банков; вживую без ключей не проверялись (docs/architecture/payments.md, «Интеграции»). */
import { z } from 'zod';
import type { BankParty, BankTransaction } from './bank-statement';
import { parseBankAmount } from './bank-statement';

export const BANK_PROVIDERS = ['tbank', 'tochka', 'sber'] as const;
export type BankProvider = (typeof BANK_PROVIDERS)[number];
export const CONNECTION_PROVIDERS = [...BANK_PROVIDERS, 'yookassa'] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];

/** Части секрета подключения: полное имя в хранилище — `<префикс>.<часть>`; обязательные и необязательные */
export const PROVIDER_SECRETS: Record<ConnectionProvider, { required: string[]; optional: string[] }> = {
  tbank: { required: ['token'], optional: [] },
  tochka: { required: ['token'], optional: [] },
  sber: { required: ['client_id', 'client_secret', 'refresh_token'], optional: ['tls_cert', 'tls_key'] },
  yookassa: { required: ['shop_id', 'secret_key'], optional: [] },
};

/** Хосты API: исходящие запросы адаптеров ходят только на них (защита от SSRF — адрес не берётся из настроек арендатора) */
export const PROVIDER_BASE: Record<ConnectionProvider, string> = {
  tbank: 'https://business.tbank.ru/openapi',
  tochka: 'https://enter.tochka.com/uapi/open-banking/v1.0',
  sber: 'https://fintech.sberbank.ru:9443',
  yookassa: 'https://api.yookassa.ru/v3',
};

export interface HttpCall {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** Клиентский сертификат (mTLS, Сбер) */
  tls?: { cert: string; key: string };
}
export interface HttpReply {
  status: number;
  json: unknown;
  text: string;
}
export type Fetcher = (call: HttpCall) => Promise<HttpReply>;

/** Ошибка API банка: auth — ключ не принят (не повторять), transient — сбой или «ещё не готово» (повторить), permanent — запрос отклонён */
export class BankApiError extends Error {
  constructor(
    public readonly kind: 'auth' | 'transient' | 'permanent',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'BankApiError';
  }
}

/** Приводит ответ к ошибке по статусу; тело ответа в текст ошибки не попадает целиком (там могут быть данные счёта) */
export function assertOk(r: HttpReply, what: string): void {
  if (r.status >= 200 && r.status < 300) return;
  if (r.status === 401 || r.status === 403) throw new BankApiError('auth', `${what}: access denied (HTTP ${r.status})`, r.status);
  if (r.status === 408 || r.status === 425 || r.status === 429 || r.status >= 500) throw new BankApiError('transient', `${what}: HTTP ${r.status}`, r.status);
  throw new BankApiError('permanent', `${what}: HTTP ${r.status}`, r.status);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isoDay = (v: unknown): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(str(v));
  return m ? m[1]! : null;
};
const amountOf = (...vs: unknown[]): string | null => {
  for (const v of vs) {
    const a = parseBankAmount(typeof v === 'number' ? v.toFixed(2) : str(v));
    if (a && Number(a) > 0) return a;
  }
  return null;
};
const emptyParty = (): BankParty => ({ name: '', inn: '', kpp: '', account: '', bik: '', bank: '', corrAccount: '' });

export interface StatementContext {
  /** Расчётный счёт организации и БИК банка */
  account: string;
  bik: string;
  from: string;
  to: string;
  /** Секреты подключения по частям (`token`, `client_id`…) */
  secrets: Record<string, string>;
  fetch: Fetcher;
  /** Базовый адрес API (по умолчанию — PROVIDER_BASE; другой задают только тесты и песочница через окружение) */
  base?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface StatementResult {
  transactions: BankTransaction[];
  /** Новые значения секретов, которые вернул банк (ротация refresh-токена): воркер сохранит их в хранилище */
  updatedSecrets?: Record<string, string>;
  /** Сколько операций банк вернул, но разобрать не удалось */
  skipped: number;
}

const need = (s: Record<string, string>, k: string): string => {
  const v = s[k];
  if (!v) throw new BankApiError('auth', `Secret part "${k}" is not set`);
  return v;
};

/* ---------------- Т-Банк ---------------- */

/** GET /api/v1/statement?accountNumber&from&to&limit&cursor, Bearer-токен. Ответ: operations[], nextCursor */
export async function tbankStatement(c: StatementContext): Promise<StatementResult> {
  const base = c.base ?? PROVIDER_BASE.tbank;
  const token = need(c.secrets, 'token');
  const out: BankTransaction[] = [];
  let skipped = 0;
  let cursor = '';
  for (let page = 0; page < 100; page++) {
    const q = new URLSearchParams({ accountNumber: c.account, from: `${c.from}T00:00:00Z`, to: `${c.to}T23:59:59Z`, limit: '1000', operationStatus: 'Transaction' });
    if (cursor) q.set('cursor', cursor);
    const r = await c.fetch({ method: 'GET', url: `${base}/api/v1/statement?${q}`, headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    assertOk(r, 'T-Bank statement');
    const body = rec(r.json);
    for (const raw of list(body.operations)) {
      const op = rec(raw);
      const credit = str(op.typeOfOperation).toLowerCase() === 'credit';
      const amount = amountOf(op.rubleAmount, op.accountAmount, op.operationAmount);
      const date = isoDay(op.operationDate) ?? isoDay(op.authorizationDate);
      if (!amount || !date) {
        skipped++;
        continue;
      }
      const side = (o: Record<string, unknown>): BankParty => ({ name: str(o.name), inn: str(o.inn), kpp: str(o.kpp), account: str(o.account), bik: str(o.bicRu ?? o.bic), bank: str(o.bankName), corrAccount: str(o.corrAccount) });
      const own: BankParty = { ...emptyParty(), account: c.account, bik: c.bik };
      const counter = side(rec(op.counterParty));
      const payer = Object.keys(rec(op.payer)).length ? side(rec(op.payer)) : credit ? counter : own;
      const receiver = Object.keys(rec(op.receiver)).length ? side(rec(op.receiver)) : credit ? own : counter;
      // в «своей» стороне ответ может не содержать счёта: подставляем наш, иначе направление не определить
      if (credit && !receiver.account) receiver.account = c.account;
      if (!credit && !payer.account) payer.account = c.account;
      out.push({
        docType: 'Платежное поручение',
        number: str(op.documentNumber) || str(op.operationId),
        date,
        debitDate: credit ? null : date,
        creditDate: credit ? date : null,
        amount,
        payer,
        receiver,
        purpose: str(op.payPurpose ?? op.paymentPurpose),
        uin: str(op.uin),
      });
    }
    cursor = str(body.nextCursor);
    if (!cursor) break;
  }
  return { transactions: out, skipped };
}

/* ---------------- Точка ---------------- */

/** POST /statements (заказ выписки) → GET /statements/{accountId}/{statementId}; accountId = «счёт/БИК». Выписка готовится асинхронно:
    пока статус не Ready, ждём несколько раз, затем ошибка transient — задача повторится */
export async function tochkaStatement(c: StatementContext): Promise<StatementResult> {
  const base = c.base ?? PROVIDER_BASE.tochka;
  const headers = { authorization: `Bearer ${need(c.secrets, 'token')}`, accept: 'application/json', 'content-type': 'application/json' };
  const accountId = `${c.account}/${c.bik}`;
  const init = await c.fetch({ method: 'POST', url: `${base}/statements`, headers, body: JSON.stringify({ Data: { Statement: { accountId, startDateTime: c.from, endDateTime: c.to } } }) });
  assertOk(init, 'Tochka statement order');
  const statementId = str(rec(rec(rec(init.json).Data).Statement).statementId);
  if (!statementId) throw new BankApiError('permanent', 'Tochka did not return a statementId');
  const sleep = c.sleep ?? ((ms: number) => new Promise<void>(res => setTimeout(res, ms)));
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await c.fetch({ method: 'GET', url: `${base}/statements/${encodeURIComponent(accountId)}/${encodeURIComponent(statementId)}`, headers });
    assertOk(r, 'Tochka statement');
    const st = rec(list(rec(rec(r.json).Data).Statement)[0]);
    if (str(st.status).toLowerCase() === 'ready' || list(st.Transaction).length) return { ...parseTochka(st, c), };
    await sleep(2000);
  }
  throw new BankApiError('transient', 'Tochka statement is not ready yet');
}

function parseTochka(st: Record<string, unknown>, c: StatementContext): StatementResult {
  const out: BankTransaction[] = [];
  let skipped = 0;
  for (const raw of list(st.Transaction)) {
    const t = rec(raw);
    const credit = str(t.creditDebitIndicator).toLowerCase() === 'credit';
    const amount = amountOf(rec(t.Amount).amountNat, rec(t.Amount).amount);
    const date = isoDay(t.documentProcessDate) ?? isoDay(t.date);
    if (!amount || !date) {
      skipped++;
      continue;
    }
    const side = (party: unknown, acc: unknown, agent: unknown): BankParty => {
      const p = rec(party);
      const a = rec(agent);
      return { name: str(p.name), inn: str(p.inn), kpp: str(p.kpp), account: str(rec(acc).identification), bik: str(a.identification), bank: str(a.name), corrAccount: str(a.accountIdentification) };
    };
    const payer = side(t.DebtorParty, t.DebtorAccount, t.DebtorAgent);
    const receiver = side(t.CreditorParty, t.CreditorAccount, t.CreditorAgent);
    if (credit && !receiver.account) receiver.account = c.account;
    if (!credit && !payer.account) payer.account = c.account;
    out.push({
      docType: 'Платежное поручение',
      number: str(t.documentNumber) || str(t.transactionId),
      date,
      debitDate: credit ? null : date,
      creditDate: credit ? date : null,
      amount,
      payer,
      receiver,
      purpose: str(t.description ?? t.transactionInformation),
      uin: '',
    });
  }
  return { transactions: out, skipped };
}

/* ---------------- Сбербанк Бизнес ---------------- */

/** OAuth2 (refresh_token → access_token), затем GET /v2/statement/transactions по дням (accountNumber, statementDate, page).
    Нужен клиентский сертификат (mTLS) — секреты tls_cert / tls_key. Новый refresh_token, если банк его прислал, возвращается в updatedSecrets */
export async function sberStatement(c: StatementContext): Promise<StatementResult> {
  const base = c.base ?? PROVIDER_BASE.sber;
  const tls = c.secrets.tls_cert && c.secrets.tls_key ? { cert: c.secrets.tls_cert, key: c.secrets.tls_key } : undefined;
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: need(c.secrets, 'refresh_token'), client_id: need(c.secrets, 'client_id'), client_secret: need(c.secrets, 'client_secret') });
  const tokenReply = await c.fetch({ method: 'POST', url: `${base}/ic/sso/api/v2/oauth/token`, headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form.toString(), ...(tls ? { tls } : {}) });
  if (tokenReply.status === 400 || tokenReply.status === 401) throw new BankApiError('auth', `Sber token request rejected (HTTP ${tokenReply.status})`, tokenReply.status);
  assertOk(tokenReply, 'Sber token');
  const tokenBody = rec(tokenReply.json);
  const access = str(tokenBody.access_token);
  if (!access) throw new BankApiError('auth', 'Sber did not return an access token');
  const updatedSecrets: Record<string, string> = {};
  const newRefresh = str(tokenBody.refresh_token);
  if (newRefresh && newRefresh !== c.secrets.refresh_token) updatedSecrets.refresh_token = newRefresh;

  const out: BankTransaction[] = [];
  let skipped = 0;
  const days: string[] = [];
  for (let d = new Date(`${c.from}T00:00:00Z`); d <= new Date(`${c.to}T00:00:00Z`) && days.length < 93; d = new Date(d.getTime() + 86_400_000)) days.push(d.toISOString().slice(0, 10));
  for (const day of days) {
    for (let page = 1; page <= 50; page++) {
      const q = new URLSearchParams({ accountNumber: c.account, statementDate: day, page: String(page) });
      const r = await c.fetch({ method: 'GET', url: `${base}/v2/statement/transactions?${q}`, headers: { authorization: `Bearer ${access}`, accept: 'application/json' }, ...(tls ? { tls } : {}) });
      assertOk(r, 'Sber statement');
      const rows = list(rec(r.json).transactions);
      for (const raw of rows) {
        const t = rec(raw);
        const credit = str(t.direction).toUpperCase() === 'CREDIT';
        const tr = rec(t.rurTransfer);
        const amount = amountOf(rec(t.amountRub).amount, tr.amount);
        const date = isoDay(t.operationDate) ?? day;
        if (!amount) {
          skipped++;
          continue;
        }
        const payer: BankParty = { name: str(tr.payerName), inn: str(tr.payerInn), kpp: str(tr.payerKpp), account: str(tr.payerAccount), bik: str(tr.payerBankBic), bank: str(tr.payerBankName), corrAccount: str(tr.payerBankCorrAccount) };
        const receiver: BankParty = { name: str(tr.payeeName), inn: str(tr.payeeInn), kpp: str(tr.payeeKpp), account: str(tr.payeeAccount), bik: str(tr.payeeBankBic), bank: str(tr.payeeBankName), corrAccount: str(tr.payeeBankCorrAccount) };
        if (credit && !receiver.account) receiver.account = c.account;
        if (!credit && !payer.account) payer.account = c.account;
        out.push({
          docType: 'Платежное поручение',
          number: str(t.number) || str(rec(t.documentInfo).number) || str(t.uuid),
          date: isoDay(t.documentDate) ?? date,
          debitDate: credit ? null : date,
          creditDate: credit ? date : null,
          amount,
          payer,
          receiver,
          purpose: str(t.paymentPurpose ?? tr.paymentPurpose),
          uin: str(tr.uin),
        });
      }
      if (rows.length < 50) break; // неполная страница — последняя
    }
  }
  return { transactions: out, ...(Object.keys(updatedSecrets).length ? { updatedSecrets } : {}), skipped };
}

export const BANK_ADAPTERS: Record<BankProvider, (c: StatementContext) => Promise<StatementResult>> = { tbank: tbankStatement, tochka: tochkaStatement, sber: sberStatement };

/* ---------------- ЮКасса ---------------- */

export interface YooCreds {
  shopId: string;
  secretKey: string;
}
const yooHeaders = (cr: YooCreds, extra: Record<string, string> = {}): Record<string, string> => ({
  authorization: `Basic ${btoa(`${cr.shopId}:${cr.secretKey}`)}`,
  accept: 'application/json',
  'content-type': 'application/json',
  ...extra,
});

export interface YooPayment {
  id: string;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  paid: boolean;
  amount: string;
  currency: string;
  confirmationUrl: string | null;
  metadata: Record<string, string>;
}

function parseYooPayment(json: unknown): YooPayment {
  const p = rec(json);
  const id = str(p.id);
  const status = str(p.status);
  const amount = amountOf(rec(p.amount).value);
  if (!id || !['pending', 'waiting_for_capture', 'succeeded', 'canceled'].includes(status) || !amount) throw new BankApiError('permanent', 'Unexpected YooKassa payment object');
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(p.metadata))) meta[k] = str(v);
  return { id, status: status as YooPayment['status'], paid: p.paid === true, amount, currency: str(rec(p.amount).currency) || 'RUB', confirmationUrl: str(rec(p.confirmation).confirmation_url) || null, metadata: meta };
}

/** POST /payments: платёж с переходом на страницу оплаты (redirect), автоматическое списание (capture). Idempotence-Key обязателен */
export async function yooCreatePayment(
  fetch: Fetcher,
  cr: YooCreds,
  input: { amount: string; description: string; returnUrl: string; metadata: Record<string, string>; idempotenceKey: string },
  base: string = PROVIDER_BASE.yookassa,
): Promise<YooPayment> {
  const r = await fetch({
    method: 'POST',
    url: `${base}/payments`,
    headers: yooHeaders(cr, { 'idempotence-key': input.idempotenceKey }),
    body: JSON.stringify({ amount: { value: input.amount, currency: 'RUB' }, capture: true, confirmation: { type: 'redirect', return_url: input.returnUrl }, description: input.description.slice(0, 128), metadata: input.metadata }),
  });
  assertOk(r, 'YooKassa create payment');
  const p = parseYooPayment(r.json);
  if (!p.confirmationUrl) throw new BankApiError('permanent', 'YooKassa did not return a confirmation URL');
  return p;
}

/** GET /payments/{id}: актуальное состояние платежа. Вебхуку верить нельзя — статус всегда перепроверяется этим запросом */
export async function yooGetPayment(fetch: Fetcher, cr: YooCreds, paymentId: string, base: string = PROVIDER_BASE.yookassa): Promise<YooPayment> {
  const r = await fetch({ method: 'GET', url: `${base}/payments/${encodeURIComponent(paymentId)}`, headers: yooHeaders(cr) });
  if (r.status === 404) throw new BankApiError('permanent', 'YooKassa payment not found', 404);
  assertOk(r, 'YooKassa get payment');
  return parseYooPayment(r.json);
}

/** Уведомление ЮКассы: берём только id платежа и событие, остальное из тела не используется */
export const yooWebhookBody = z.object({
  type: z.literal('notification'),
  event: z.string().max(64),
  object: z.object({ id: z.string().min(1).max(64) }).passthrough(),
});
