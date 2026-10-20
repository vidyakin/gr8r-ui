/* Клиент API: типизированный hono/client (@gr8r/api/client) на каждый воркспейс + разбор ошибок.
   Фронтенд ходит по тому же origin (`/api/*`, Vite/nginx проксируют без префикса), поэтому cookie сессии идёт без CORS. */
import { createApiClient } from '@gr8r/api/client';

export type Api = ReturnType<typeof createApiClient>;

export const API_BASE = () => `${location.origin}/api`;

export const UNAUTHORIZED_EVENT = 'gr8r:unauthorized';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const clients = new Map<string, Api>();

/** Клиент с заголовком X-Workspace-Id; без id — для маршрутов, не привязанных к воркспейсу (/auth, /workspaces) */
export function apiFor(workspaceId?: string): Api {
  const k = workspaceId ?? '';
  let c = clients.get(k);
  if (!c) clients.set(k, (c = createApiClient(API_BASE(), { workspaceId })));
  return c;
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

interface ResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

/** Ответ → JSON; не-2xx превращается в ApiError с сообщением сервера. Тип тела выводится из типизированного клиента
    (`ok(api.tasks.$get(…))`); для ручных запросов тип можно указать явно: `ok<Тип>(…)` */
export function ok<R extends ResponseLike>(res: R | Promise<R>): Promise<R extends { json(): Promise<infer J> } ? J : never>;
export function ok<T>(res: ResponseLike | Promise<ResponseLike>): Promise<T>;
export async function ok(res: ResponseLike | Promise<ResponseLike>): Promise<unknown> {
  const r = await res;
  if (r.ok) return r.status === 204 ? null : await r.json();
  let body: ErrorBody | null = null;
  try {
    body = (await r.json()) as ErrorBody;
  } catch {
    /* не JSON */
  }
  // Сессия истекла или закрыта в другой вкладке: SessionProvider вернёт пользователя на экран входа
  if (body?.error?.code === 'unauthorized') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  throw new ApiError(r.status, body?.error?.code ?? 'error', body?.error?.message ?? (r.statusText || `Request failed (${r.status})`), body?.error?.details);
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
