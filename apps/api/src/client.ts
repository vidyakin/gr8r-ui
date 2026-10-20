/* Типизированный клиент для фронтенда (этап 2): `import { createApiClient } from '@gr8r/api/client'`.
   Типы маршрутов и ответов берутся из AppType — менять API и клиент по отдельности не придётся. */
import { hc } from 'hono/client';
import type { AppType } from './app';

export type { AppType };

export function createApiClient(baseUrl: string, opts: { workspaceId?: string; fetch?: typeof fetch } = {}) {
  return hc<AppType>(baseUrl, {
    fetch: opts.fetch,
    init: { credentials: 'include' },
    headers: () => (opts.workspaceId ? { 'X-Workspace-Id': opts.workspaceId } : ({} as Record<string, string>)),
  });
}
