/* Внутренний вызов API из инструментов MCP: GET-запрос в то же приложение с исходным заголовком Authorization.
   Новых проверок прав не добавляет — на каждом вызове действуют requireSession (токен не отозван/не истёк), tenant()
   под app_user с RLS, модуль лицензии, разделы токена, должности, роль и maskCost обычного запроса. */
import type { Hono } from 'hono';
import type { AppEnv } from '../types';

export type CallResult = { ok: true; data: unknown } | { ok: false; code: string; message: string; status: number };

/** GET в собственное приложение под исходными заголовками токена. Относительный путь может включать query. */
export async function callApi(
  app: Hono<AppEnv>,
  path: string,
  query: Record<string, string | number | undefined>,
  authorization: string,
  workspaceId: string,
): Promise<CallResult> {
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== '');
  const url = entries.length ? `${path}?${new URLSearchParams(entries.map(([k, v]): [string, string] => [k, String(v)]))}` : path;
  let res: Response;
  try {
    res = await app.request(url, { method: 'GET', headers: { authorization, 'x-workspace-id': workspaceId } });
  } catch (e) {
    return { ok: false, code: 'internal_error', message: e instanceof Error ? e.message : 'Internal request failed', status: 500 };
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    return { ok: false, code: err?.code ?? 'http_error', message: err?.message ?? `HTTP ${res.status}`, status: res.status };
  }
  return { ok: true, data: body };
}
