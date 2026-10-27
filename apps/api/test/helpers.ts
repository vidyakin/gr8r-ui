/* Помощники тестов API: общее приложение на тестовой БД и «браузер» с cookie-банкой. */
import { adminDatabaseUrl, createSql, databaseUrl, uuidv7 } from '@gr8r/db';
import { defaultOptions, processJobsOnce } from '../../worker/src/worker';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/types';

export const sql = createSql(databaseUrl(), { max: 8 });
/** Суперпользовательское соединение — только для подготовки/проверки данных в тестах (мимо RLS) */
export const admin = createSql(adminDatabaseUrl(), { max: 2 });
/** Подключение воркера для DDL (роль-владелец): как в проде, им пользуется только воркер, не API */
export const ddl = createSql(process.env.DATABASE_URL_DDL!, { max: 2 });
export const { app, hub } = createApp({ sql, config: { logRequests: false } });

export const uniq = () => uuidv7().slice(-12);

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
  /** Сырые байты ответа (для файлов не в UTF-8) */
  bytes: Uint8Array;
}

/** Клиент с cookie-банкой; запросы идут прямо в app.request (без сети) */
export class Client {
  cookie = '';
  workspaceId: string | null = null;
  user: { id: string; email: string; name: string } | null = null;

  constructor(
    private application: { request: typeof app.request } = app,
    private defaultHeaders: Record<string, string> = {},
  ) {}

  async req<T = any>(method: string, path: string, opts: { json?: unknown; raw?: Uint8Array; ws?: string | null; headers?: Record<string, string> } = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { ...this.defaultHeaders, ...opts.headers };
    if (this.cookie) headers.cookie = this.cookie;
    const ws = opts.ws === undefined ? this.workspaceId : opts.ws;
    if (ws) headers['x-workspace-id'] = ws;
    if (opts.json !== undefined) headers['content-type'] = 'application/json';
    if (opts.raw) headers['content-type'] = 'application/octet-stream';
    const res = await this.application.request(path, { method, headers, body: opts.raw ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined) });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [pair] = c.split(';');
      if (pair!.startsWith('gr8r_session=')) this.cookie = /Max-Age=0|=;|expires=Thu, 01 Jan 1970/i.test(c) || pair === 'gr8r_session=' ? '' : pair!;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    let body: any = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* не JSON */
    }
    return { status: res.status, body, headers: res.headers, bytes };
  }
  upload = <T = any>(path: string, raw: Uint8Array, ws?: string | null) => this.req<T>('POST', path, { raw, ws });
  get = <T = any>(path: string, ws?: string | null) => this.req<T>('GET', path, { ws });
  post = <T = any>(path: string, json?: unknown, ws?: string | null) => this.req<T>('POST', path, { json: json ?? {}, ws });
  put = <T = any>(path: string, json: unknown, ws?: string | null) => this.req<T>('PUT', path, { json, ws });
  patch = <T = any>(path: string, json: unknown, ws?: string | null) => this.req<T>('PATCH', path, { json, ws });
  del = <T = any>(path: string, ws?: string | null) => this.req<T>('DELETE', path, { ws });

  /** Регистрация + воркспейс; запоминает его как активный */
  async signup(opts: { email?: string; password?: string; name?: string; workspaceName?: string } = {}) {
    const email = opts.email ?? `user-${uniq()}@test.dev`;
    const res = await this.post('/auth/signup', { email, password: opts.password ?? 'password123', name: opts.name ?? 'Test User', workspaceName: opts.workspaceName ?? 'Test WS' });
    if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
    this.user = res.body.user;
    this.workspaceId = res.body.workspaces[0]?.id ?? null;
    return res.body as { user: { id: string; email: string; name: string }; workspaces: { id: string; role: string }[] };
  }

  /** Проект + статус по умолчанию уже есть у воркспейса; возвращает проект */
  async project(key = 'TST', name = 'Test project') {
    const res = await this.post('/projects', { key, name });
    if (res.status !== 201) throw new Error(`project failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { id: string; key: string; name: string; module: string };
  }
  async task(projectId: string, title = 'Task', extra: Record<string, unknown> = {}) {
    const res = await this.post('/tasks', { projectId, title, ...extra });
    if (res.status !== 201) throw new Error(`task failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { id: string; key: string; title: string; status: string; module: string };
  }
}

export const testConfig = (over: Partial<AppConfig>) => ({ logRequests: false, ...over });

/** Прогоняет очередь jobs воркером (с DDL-подключением), пока в ней есть готовые задачи: так в тестах появляются индексы полей */
export async function drainJobs(): Promise<number> {
  const o = defaultOptions({ log: () => {}, concurrency: 10, ddl });
  let total = 0;
  for (let i = 0; i < 100; i++) {
    const n = await processJobsOnce(sql, o);
    if (!n) break;
    total += n;
  }
  return total;
}
