/* Интеграции оплат (задача 1174д): подключение счетов к API банков, загрузка операций через общий импорт выписки,
   ссылки на онлайн-оплату и проверка платежей ЮКассы. Правила — docs/architecture/payments.md, «Интеграции».
   Сеть — только через `Fetcher` (по умолчанию `guardedFetcher`: фиксированные хосты провайдеров, проверка адресов DNS). */
import { lookup } from 'node:dns/promises';
import { and, desc, eq, inArray, sql as dsql } from 'drizzle-orm';
import {
  BANK_ADAPTERS,
  BankApiError,
  CONNECTION_PROVIDERS,
  isPrivateAddress,
  PROVIDER_BASE,
  PROVIDER_SECRETS,
  yooCreatePayment,
  yooGetPayment,
  type BankProvider,
  type BankStatement,
  type ConnectionProvider,
  type Fetcher,
  type HttpCall,
  type HttpReply,
} from '@gr8r/shared';
import type { Db, Sql } from './client';
import { withContext } from './context';
import { commitBankImport, previewBankImport, type BankImportCommitRow } from './bank-import';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { createPayment } from './payments';
import { postDocument, type DocCtx } from './documents';
import { encryptSecret, listSecrets, readSecret } from './secrets';
import { payableOf } from './settlements';
import { bankAccounts, bankConnections, documents, jobs, organizations, paymentLinks, workspaceSecrets } from './schema';


export const BANK_SYNC_JOB = 'bank.sync';
export const YOOKASSA_PAYMENT_JOB = 'yookassa.payment';
const SYSTEM: Pick<DocCtx, 'memberId' | 'role'> = { memberId: null, role: 'owner' };
const isoToday = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/* ---------------- сеть ---------------- */

/** Базовый адрес API; другой задают только окружение сервера (тесты, песочница банка) — не настройки арендатора */
export function providerBase(p: ConnectionProvider, env: Record<string, string | undefined> = process.env): string {
  return env[`BANK_API_BASE_${p.toUpperCase()}`]?.replace(/\/+$/, '') || PROVIDER_BASE[p];
}

/** Исходящие запросы интеграций с защитой от SSRF: разрешены только хосты провайдеров (из констант/окружения сервера),
    https (http — лишь при INTEGRATIONS_ALLOW_PRIVATE=1, для тестов), все адреса DNS не должны быть частными, редиректы запрещены */
export function guardedFetcher(env: Record<string, string | undefined> = process.env): Fetcher {
  const allowPrivate = env.INTEGRATIONS_ALLOW_PRIVATE === '1';
  const hosts = new Set(CONNECTION_PROVIDERS.map(p => new URL(providerBase(p, env)).host));
  const timeoutMs = Number(env.INTEGRATIONS_HTTP_TIMEOUT_MS ?? 20_000);
  return async (call: HttpCall): Promise<HttpReply> => {
    let url: URL;
    try {
      url = new URL(call.url);
    } catch {
      throw new BankApiError('permanent', 'Invalid URL');
    }
    if (!hosts.has(url.host)) throw new BankApiError('permanent', 'The host is not allowed for integrations');
    if (url.username || url.password) throw new BankApiError('permanent', 'Credentials in the URL are not allowed');
    if (!allowPrivate) {
      if (url.protocol !== 'https:') throw new BankApiError('permanent', 'Only https is allowed');
      let addrs: string[];
      try {
        addrs = (await lookup(url.hostname, { all: true })).map(a => a.address);
      } catch {
        throw new BankApiError('transient', `DNS lookup failed for ${url.hostname}`);
      }
      if (!addrs.length || addrs.some(isPrivateAddress)) throw new BankApiError('permanent', 'Requests to private or local addresses are blocked');
    }
    let res: Response;
    try {
      res = await fetch(url, { method: call.method, headers: call.headers, body: call.body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), ...(call.tls ? { tls: call.tls } : {}) } as RequestInit);
    } catch (e) {
      const name = (e as Error).name;
      throw new BankApiError('transient', name === 'TimeoutError' || name === 'AbortError' ? 'Request timed out' : `Network error: ${(e as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      throw new BankApiError('permanent', 'Redirects are not followed');
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 20 * 1024 * 1024) throw new BankApiError('permanent', 'The response is too large');
    const text = new TextDecoder().decode(buf);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* не JSON */
    }
    return { status: res.status, json, text };
  };
}

export interface IntegrationDeps {
  fetch: Fetcher;
  env?: Record<string, string | undefined>;
  sleep?: (ms: number) => Promise<void>;
  today?: () => string;
}
export const defaultIntegrationDeps = (): IntegrationDeps => ({ fetch: guardedFetcher() });
/** Сеть интеграций процесса (API и воркер); тесты подменяют `deps` фикстурами — наружу запросов нет */
export const integrationRuntime: { deps: IntegrationDeps } = { deps: defaultIntegrationDeps() };

/* ---------------- секреты подключения ---------------- */

export const CONNECTION_PREFIX_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const secretName = (prefix: string, part: string) => `${prefix}.${part}`;

/** Читает секреты подключения по частям; нет обязательной части — ошибка авторизации (повторять бессмысленно) */
async function loadSecretParts(db: Db, workspaceId: string, provider: ConnectionProvider, prefix: string, env?: Record<string, string | undefined>): Promise<Record<string, string>> {
  const spec = PROVIDER_SECRETS[provider];
  const out: Record<string, string> = {};
  for (const part of [...spec.required, ...spec.optional]) {
    const v = await readSecret(db, workspaceId, secretName(prefix, part), env);
    if (v) out[part] = v;
    else if (spec.required.includes(part)) throw new BankApiError('auth', `Secret "${secretName(prefix, part)}" is not set (Settings → Integrations)`);
  }
  return out;
}

/** Записывает секрет от имени системы (ротация refresh-токена): без события с автором */
async function writeSecretSystem(db: Db, workspaceId: string, key: string, value: string, env?: Record<string, string | undefined>): Promise<void> {
  const ciphertext = encryptSecret(workspaceId, key, value, env);
  await db.update(workspaceSecrets).set({ ciphertext, updatedAt: new Date() }).where(and(eq(workspaceSecrets.workspaceId, workspaceId), eq(workspaceSecrets.key, key)));
}

/* ---------------- подключения ---------------- */

export interface ConnectionInput {
  bankAccountId: string;
  provider: ConnectionProvider;
  enabled?: boolean;
  secretPrefix?: string;
  syncFrom?: string | null;
  autoPost?: boolean;
}

export async function listConnections(db: Db) {
  const rows = await db
    .select({
      id: bankConnections.id,
      bankAccountId: bankConnections.bankAccountId,
      provider: bankConnections.provider,
      enabled: bankConnections.enabled,
      secretPrefix: bankConnections.secretPrefix,
      syncFrom: bankConnections.syncFrom,
      autoPost: bankConnections.autoPost,
      syncedThrough: bankConnections.syncedThrough,
      lastSyncAt: bankConnections.lastSyncAt,
      lastStatus: bankConnections.lastStatus,
      lastError: bankConnections.lastError,
      lastResult: bankConnections.lastResult,
      account: bankAccounts.account,
      bankName: bankAccounts.bankName,
      organization: organizations.name,
    })
    .from(bankConnections)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankConnections.bankAccountId))
    .leftJoin(organizations, eq(organizations.id, bankAccounts.organizationId))
    .orderBy(desc(bankConnections.createdAt));
  const have = new Set((await listSecrets(db)).map(s => s.key));
  return rows.map(r => {
    const spec = PROVIDER_SECRETS[r.provider];
    const secrets = [...spec.required.map(p => ({ part: p, required: true })), ...spec.optional.map(p => ({ part: p, required: false }))].map(s => ({ ...s, key: secretName(r.secretPrefix, s.part), present: have.has(secretName(r.secretPrefix, s.part)) }));
    return { ...r, secrets, ready: secrets.every(s => !s.required || s.present) };
  });
}

export async function upsertConnection(db: Db, ctx: DocCtx, input: ConnectionInput): Promise<string> {
  if (!(CONNECTION_PROVIDERS as readonly string[]).includes(input.provider)) throw new DomainError(422, 'invalid_provider', 'Unknown integration provider');
  const prefix = input.secretPrefix ?? input.provider;
  if (!CONNECTION_PREFIX_RE.test(prefix)) throw new DomainError(400, 'invalid_secret_key', 'Secret prefix must be lowercase latin, digits, _ - (up to 32 chars)');
  const [acc] = await db.select({ id: bankAccounts.id, organizationId: bankAccounts.organizationId }).from(bankAccounts).where(eq(bankAccounts.id, input.bankAccountId)).limit(1);
  if (!acc || !acc.organizationId) throw new DomainError(422, 'invalid_reference', 'Select a bank account of your organization');
  const values = { enabled: input.enabled ?? true, provider: input.provider, secretPrefix: prefix, autoPost: input.autoPost ?? true, updatedAt: new Date(), ...(input.syncFrom !== undefined ? { syncFrom: input.syncFrom } : {}) };
  const [row] = await db
    .insert(bankConnections)
    .values({ workspaceId: ctx.workspaceId, bankAccountId: input.bankAccountId, ...values })
    .onConflictDoUpdate({ target: [bankConnections.workspaceId, bankConnections.bankAccountId], set: values })
    .returning({ id: bankConnections.id });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'bank_connection.updated', entity: 'bank_connection', recordId: row!.id, actorId: ctx.memberId, payload: { provider: input.provider } });
  return row!.id;
}

export async function deleteConnection(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const rows = await db.delete(bankConnections).where(eq(bankConnections.id, id)).returning({ id: bankConnections.id });
  if (!rows.length) throw new DomainError(404, 'not_found', 'Connection not found');
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'bank_connection.deleted', entity: 'bank_connection', recordId: id, actorId: ctx.memberId, payload: {} });
}

/** Ставит загрузку операций в очередь (ручной запуск); уже стоящая в очереди не дублируется */
export async function enqueueBankSync(db: Db, workspaceId: string, connectionId: string): Promise<boolean> {
  const [c] = await db.select({ id: bankConnections.id, provider: bankConnections.provider, enabled: bankConnections.enabled }).from(bankConnections).where(eq(bankConnections.id, connectionId)).limit(1);
  if (!c) throw new DomainError(404, 'not_found', 'Connection not found');
  if (c.provider === 'yookassa') throw new DomainError(422, 'not_a_bank', 'YooKassa does not have a statement to load');
  const [busy] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, BANK_SYNC_JOB), inArray(jobs.status, ['queued', 'running']), dsql`${jobs.payload}->>'connectionId' = ${connectionId}`))
    .limit(1);
  if (busy) return false;
  await db.insert(jobs).values({ workspaceId, type: BANK_SYNC_JOB, payload: { connectionId } });
  return true;
}

/* ---------------- загрузка операций банка ---------------- */

export interface SyncResult {
  fetched: number;
  created: number;
  posted: number;
  duplicates: number;
  /** Строки без контрагента (прочие доходы/расходы), перемещения и чужие счета: создаются вручную через файл выписки */
  unmatched: number;
  failed: number;
  bankSkipped: number;
  from: string;
  to: string;
}

/** Окно загрузки: от даты последней загрузки с запасом в 3 дня (банк проводит операции задним числом) до сегодня, не более 90 дней за раз */
export function syncWindow(c: { syncFrom: string | null; syncedThrough: string | null }, now: string): { from: string; to: string } {
  const from = c.syncedThrough ? addDays(c.syncedThrough, -3) : (c.syncFrom ?? addDays(now, -30));
  const start = c.syncFrom && from < c.syncFrom ? c.syncFrom : from;
  const limit = addDays(start, 89);
  return { from: start, to: limit < now ? limit : now };
}

async function recordSyncOutcome(sql: Sql, workspaceId: string, id: string, patch: Partial<typeof bankConnections.$inferInsert>): Promise<void> {
  await withContext(sql, { workspaceId }, async db => {
    await db.update(bankConnections).set({ ...patch, lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(bankConnections.id, id));
    await recordEvent(db, { workspaceId, type: 'bank_connection.synced', entity: 'bank_connection', recordId: id, payload: { status: patch.lastStatus ?? null } });
  });
}

/** Загрузка операций одного подключения. Сеть — вне транзакции. Ошибка ключа или запроса записывается в подключение и не
    повторяется; временный сбой записывается и пробрасывается, чтобы задача повторилась с паузой */
export async function syncConnection(sql: Sql, workspaceId: string, connectionId: string, deps: IntegrationDeps = integrationRuntime.deps): Promise<SyncResult | null> {
  const prep = await withContext(sql, { workspaceId }, async db => {
    const [c] = await db
      .select({ conn: bankConnections, account: bankAccounts.account, bik: bankAccounts.bik })
      .from(bankConnections)
      .innerJoin(bankAccounts, eq(bankAccounts.id, bankConnections.bankAccountId))
      .where(eq(bankConnections.id, connectionId))
      .limit(1);
    if (!c || !c.conn.enabled || c.conn.provider === 'yookassa') return null;
    try {
      return { ...c, secrets: await loadSecretParts(db, workspaceId, c.conn.provider, c.conn.secretPrefix, deps.env) };
    } catch (e) {
      if (e instanceof BankApiError || e instanceof DomainError) return { ...c, error: e.message };
      throw e;
    }
  });
  if (!prep) return null;
  if ('error' in prep) {
    await recordSyncOutcome(sql, workspaceId, connectionId, { lastStatus: 'error', lastError: prep.error });
    return null;
  }
  const { conn } = prep;
  const now = deps.today?.() ?? isoToday();
  const { from, to } = syncWindow(conn, now);
  let fetched;
  try {
    fetched = await BANK_ADAPTERS[conn.provider as BankProvider]({
      account: prep.account,
      bik: prep.bik,
      from,
      to,
      secrets: prep.secrets,
      fetch: deps.fetch,
      base: providerBase(conn.provider, deps.env),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    });
  } catch (e) {
    if (!(e instanceof BankApiError)) throw e;
    await recordSyncOutcome(sql, workspaceId, connectionId, { lastStatus: 'error', lastError: e.message.slice(0, 500) });
    if (e.kind === 'transient') throw e;
    return null;
  }

  const result = await withContext(sql, { workspaceId }, async db => {
    for (const [part, value] of Object.entries(fetched.updatedSecrets ?? {})) await writeSecretSystem(db, workspaceId, secretName(conn.secretPrefix, part), value, deps.env);
    const result = await importTransactions(db, { workspaceId, ...SYSTEM }, { bankAccountId: conn.bankAccountId, account: prep.account, provider: conn.provider, from, to, transactions: fetched.transactions, post: conn.autoPost });
    const full: SyncResult = { ...result, bankSkipped: fetched.skipped, from, to };
    await db.update(bankConnections).set({ syncedThrough: to, lastSyncAt: new Date(), lastStatus: 'ok', lastError: null, lastResult: { ...full }, updatedAt: new Date() }).where(eq(bankConnections.id, connectionId));
    await recordEvent(db, { workspaceId, type: 'bank_connection.synced', entity: 'bank_connection', recordId: connectionId, payload: { status: 'ok', created: full.created } });
    return full;
  });
  return result;
}

/** Операции банка → общий предпросмотр и создание документов (те же правила, что у файла выписки) */
export async function importTransactions(
  db: Db,
  ctx: DocCtx,
  input: { bankAccountId: string; account: string; provider: string; from: string; to: string; transactions: BankStatement['transactions']; post: boolean },
): Promise<Omit<SyncResult, 'bankSkipped' | 'from' | 'to'>> {
  const statement: BankStatement = {
    version: 'api',
    declaredEncoding: '',
    sender: input.provider,
    receiver: '',
    createdAt: null,
    dateFrom: input.from,
    dateTo: input.to,
    accounts: [input.account.replace(/\D+/g, '')],
    balances: [],
    transactions: input.transactions,
    warnings: [],
  };
  const preview = await previewBankImport(db, statement, { bankAccountId: input.bankAccountId });
  const out = { fetched: input.transactions.length, created: 0, posted: 0, duplicates: 0, unmatched: 0, failed: 0 };
  const rows: BankImportCommitRow[] = [];
  for (const r of preview.rows) {
    if (r.issues.includes('duplicate')) out.duplicates++;
    else if (r.skip || !r.direction || !r.operation) out.unmatched++;
    // прочие доходы и расходы требуют статью ДДС, которую выбирает человек: через API их не создаём
    else if (r.operation === 'other_income' || r.operation === 'other_expense') out.unmatched++;
    else rows.push({ direction: r.direction, number: r.number, docDate: r.docDate, bookedDate: r.bookedDate, amount: r.amount, purpose: r.purpose, operation: r.operation, counterpartyId: r.counterpartyId, settlementDocumentId: r.settlementDocumentId });
  }
  if (rows.length) {
    const res = await commitBankImport(db, ctx, { bankAccountId: input.bankAccountId, post: input.post, rows });
    out.created = res.created.length;
    out.posted = res.created.filter(c => c.posted).length;
    out.duplicates += res.skipped.filter(s => s.reason === 'duplicate').length;
    out.failed = res.failed.length;
  }
  return out;
}

/** Планировщик воркера: ставит bank.sync по включённым подключениям, у которых прошёл интервал (под ролью app_worker, все арендаторы) */
export async function scheduleBankSyncs(sql: Sql, intervalMin = Number(process.env.BANK_SYNC_INTERVAL_MIN ?? 60)): Promise<number> {
  return withContext(
    sql,
    {},
    async db => {
      const due = await db
        .select({ id: bankConnections.id, workspaceId: bankConnections.workspaceId })
        .from(bankConnections)
        .where(and(eq(bankConnections.enabled, true), dsql`${bankConnections.provider} <> 'yookassa'`, dsql`(${bankConnections.lastSyncAt} is null or ${bankConnections.lastSyncAt} < now() - make_interval(mins => ${intervalMin}))`));
      let n = 0;
      for (const c of due) {
        const [busy] = await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.type, BANK_SYNC_JOB), inArray(jobs.status, ['queued', 'running']), dsql`${jobs.payload}->>'connectionId' = ${c.id}`))
          .limit(1);
        if (busy) continue;
        await db.insert(jobs).values({ workspaceId: c.workspaceId, type: BANK_SYNC_JOB, payload: { connectionId: c.id } });
        n++;
      }
      return n;
    },
    'app_worker',
  );
}

/* ---------------- ЮКасса ---------------- */

async function yooCreds(db: Db, workspaceId: string, prefix: string, env?: Record<string, string | undefined>) {
  const s = await loadSecretParts(db, workspaceId, 'yookassa', prefix, env);
  return { shopId: s.shop_id!, secretKey: s.secret_key! };
}

/** Ссылка на оплату счёта или заказа: сумма — остаток к оплате по цепочке расчётов. Живая неоплаченная ссылка на ту же сумму переиспользуется */
export async function createPaymentLink(
  db: Db,
  ctx: DocCtx,
  input: { documentId: string; returnUrl: string },
  deps: IntegrationDeps = integrationRuntime.deps,
): Promise<{ id: string; url: string; amount: string; reused: boolean }> {
  const [doc] = await db.select({ id: documents.id, type: documents.type, status: documents.status, number: documents.number }).from(documents).where(eq(documents.id, input.documentId)).limit(1);
  if (!doc || doc.status === 'cancelled') throw new DomainError(404, 'not_found', 'Document not found');
  const info = await payableOf(db, input.documentId);
  if (!info || info.status.side !== 'customer') throw new DomainError(422, 'not_payable', 'An online payment link can be created for customer documents only');
  const amount = info.status.remaining;
  if (Number(amount) <= 0) throw new DomainError(422, 'nothing_to_pay', 'Nothing left to pay for this document');
  const [conn] = await db.select().from(bankConnections).where(and(eq(bankConnections.provider, 'yookassa'), eq(bankConnections.enabled, true))).limit(1);
  if (!conn) throw new DomainError(422, 'yookassa_not_configured', 'YooKassa is not connected: add the connection to a bank account and the keys in Settings → Integrations');
  const [live] = await db
    .select()
    .from(paymentLinks)
    .where(and(eq(paymentLinks.documentId, info.status.rootId), eq(paymentLinks.status, 'pending'), eq(paymentLinks.amount, amount)))
    .orderBy(desc(paymentLinks.createdAt))
    .limit(1);
  if (live) return { id: live.id, url: live.confirmationUrl, amount, reused: true };
  let creds;
  try {
    creds = await yooCreds(db, ctx.workspaceId, conn.secretPrefix, deps.env);
  } catch (e) {
    if (e instanceof BankApiError) throw new DomainError(422, 'yookassa_auth', e.message);
    throw e;
  }
  let p;
  try {
    p = await yooCreatePayment(
      deps.fetch,
      creds,
      { amount, description: `Оплата ${doc.number ? `по документу № ${doc.number}` : 'заказа'}`, returnUrl: input.returnUrl, metadata: { workspace_id: ctx.workspaceId, document_id: info.status.rootId }, idempotenceKey: crypto.randomUUID() },
      providerBase('yookassa', deps.env),
    );
  } catch (e) {
    if (e instanceof BankApiError) throw new DomainError(422, e.kind === 'auth' ? 'yookassa_auth' : 'yookassa_error', e.message);
    throw e;
  }
  const [row] = await db
    .insert(paymentLinks)
    .values({ workspaceId: ctx.workspaceId, documentId: info.status.rootId, connectionId: conn.id, amount, providerPaymentId: p.id, confirmationUrl: p.confirmationUrl!, createdBy: ctx.memberId })
    .returning({ id: paymentLinks.id });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'payment_link.created', entity: 'payment_link', recordId: row!.id, actorId: ctx.memberId, payload: { documentId: info.status.rootId } });
  return { id: row!.id, url: p.confirmationUrl!, amount, reused: false };
}

export async function listPaymentLinks(db: Db, documentId: string) {
  return db
    .select({ id: paymentLinks.id, amount: paymentLinks.amount, status: paymentLinks.status, url: paymentLinks.confirmationUrl, paidAt: paymentLinks.paidAt, receiptDocumentId: paymentLinks.receiptDocumentId, createdAt: paymentLinks.createdAt })
    .from(paymentLinks)
    .where(eq(paymentLinks.documentId, documentId))
    .orderBy(desc(paymentLinks.createdAt));
}

/** Вебхук: если платёж известен — ставит задачу проверки; иначе молча ничего (ответ вебхука не раскрывает, что есть в системе) */
export async function enqueueYooPayment(db: Db, workspaceId: string, paymentId: string): Promise<boolean> {
  const [l] = await db.select({ id: paymentLinks.id, status: paymentLinks.status }).from(paymentLinks).where(eq(paymentLinks.providerPaymentId, paymentId)).limit(1);
  if (!l || l.status !== 'pending') return false;
  await db.insert(jobs).values({ workspaceId, type: YOOKASSA_PAYMENT_JOB, payload: { paymentId } });
  return true;
}

export type YooProcessResult = 'unknown' | 'already_done' | 'pending' | 'canceled' | 'succeeded' | 'amount_mismatch';

/** Проверка платежа ЮКассы: статус всегда берётся повторным запросом к API (тело вебхука не доверенное). Успех → «Поступление на счёт»
    с распределением на документ расчётов. Идемпотентно: повтор не создаёт второй документ (ключ `yookassa|<id>` и блокировка ссылки) */
export async function processYooPayment(sql: Sql, workspaceId: string, paymentId: string, deps: IntegrationDeps = integrationRuntime.deps): Promise<YooProcessResult> {
  const prep = await withContext(sql, { workspaceId }, async db => {
    const [l] = await db.select().from(paymentLinks).where(eq(paymentLinks.providerPaymentId, paymentId)).limit(1);
    if (!l) return null;
    if (l.status !== 'pending') return { link: l, creds: null };
    const [conn] = await db.select().from(bankConnections).where(eq(bankConnections.id, l.connectionId)).limit(1);
    if (!conn) return null;
    return { link: l, creds: await yooCreds(db, workspaceId, conn.secretPrefix, deps.env) };
  });
  if (!prep) return 'unknown';
  if (!prep.creds) return 'already_done';
  let p;
  try {
    p = await yooGetPayment(deps.fetch, prep.creds, paymentId, providerBase('yookassa', deps.env));
  } catch (e) {
    if (e instanceof BankApiError && e.kind === 'permanent') return 'unknown';
    throw e;
  }
  if (p.status === 'pending' || p.status === 'waiting_for_capture') return 'pending';
  return withContext(sql, { workspaceId }, async db => {
    const [l] = await db.select().from(paymentLinks).where(eq(paymentLinks.providerPaymentId, paymentId)).for('update').limit(1);
    if (!l || l.status !== 'pending') return 'already_done';
    if (p.status === 'canceled') {
      await db.update(paymentLinks).set({ status: 'canceled', updatedAt: new Date() }).where(eq(paymentLinks.id, l.id));
      return 'canceled';
    }
    if (p.amount !== l.amount || p.currency !== 'RUB') return 'amount_mismatch';
    const [conn] = await db.select({ accountId: bankConnections.bankAccountId }).from(bankConnections).where(eq(bankConnections.id, l.connectionId)).limit(1);
    const [acc] = conn ? await db.select({ organizationId: bankAccounts.organizationId }).from(bankAccounts).where(eq(bankAccounts.id, conn.accountId)).limit(1) : [];
    const info = await payableOf(db, l.documentId);
    if (!conn || !acc?.organizationId || !info) throw new DomainError(422, 'invalid_reference', 'The bank account or the document of the payment is gone');
    const ctx: DocCtx = { workspaceId, ...SYSTEM };
    const receiptId = await createPayment(db, ctx, {
      type: 'bank_receipt',
      operation: 'from_customer',
      organizationId: acc.organizationId,
      bankAccountId: conn.accountId,
      date: deps.today?.() ?? isoToday(),
      counterpartyId: info.counterpartyId,
      bankImportKey: `yookassa|${paymentId}`,
      comment: `ЮКасса, платёж ${paymentId}`,
      lines: [{ id: crypto.randomUUID(), settlementDocumentId: l.documentId, contractId: info.contractId ?? undefined, amount: l.amount, comment: '' } as never],
    });
    await postDocument(db, ctx, receiptId);
    await db.update(paymentLinks).set({ status: 'succeeded', paidAt: new Date(), receiptDocumentId: receiptId, updatedAt: new Date() }).where(eq(paymentLinks.id, l.id));
    await recordEvent(db, { workspaceId, type: 'payment_link.paid', entity: 'payment_link', recordId: l.id, payload: { documentId: l.documentId, receiptDocumentId: receiptId } });
    return 'succeeded';
  });
}
