/* Внутренний вызов API из инструментов MCP: запрос в то же приложение с исходным заголовком Authorization.
   Новых проверок прав не добавляет — на каждом вызове действуют requireSession (токен не отозван/не истёк), tenant()
   под app_user с RLS, модуль лицензии, разделы токена, должности, роль, read_only/can_post и maskCost обычного запроса.
   Запись идёт методами POST/PATCH с JSON-телом (docs/architecture/mcp.md, «Запись»). */
import type { Hono } from 'hono';
import { INTERNAL_HEADER, INTERNAL_SECRET } from '../token-rate';
import type { AppEnv } from '../types';

export type CallResult = { ok: true; data: unknown } | { ok: false; code: string; message: string; status: number };

/** Метод записи инструментов MCP (удаления в инструментах нет — они разрушительные) */
export type WriteMethod = 'POST' | 'PATCH';

export type Query = Record<string, string | number | undefined>;

export interface CallOptions {
  method?: 'GET' | WriteMethod;
  query?: Query;
  /** JSON-тело запроса (только для POST/PATCH) */
  body?: unknown;
  authorization: string;
  workspaceId: string;
}

const withQuery = (path: string, query: Query = {}): string => {
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? `${path}?${new URLSearchParams(entries.map(([k, v]): [string, string] => [k, String(v)]))}` : path;
};

/** Вызов в собственное приложение под исходными заголовками токена. Относительный путь может включать query. */
export async function callApi(app: Hono<AppEnv>, path: string, options: CallOptions): Promise<CallResult> {
  const { method = 'GET', query, body, authorization, workspaceId } = options;
  const headers: Record<string, string> = { authorization, 'x-workspace-id': workspaceId, [INTERNAL_HEADER]: INTERNAL_SECRET };
  if (method !== 'GET') headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await app.request(withQuery(path, query), {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  } catch (e) {
    return { ok: false, code: 'internal_error', message: e instanceof Error ? e.message : 'Internal request failed', status: 500 };
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const err = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
    return { ok: false, code: err?.code ?? 'http_error', message: err?.message ?? `HTTP ${res.status}`, status: res.status };
  }
  return { ok: true, data: parsed };
}
