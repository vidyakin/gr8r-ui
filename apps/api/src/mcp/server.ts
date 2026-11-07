/* MCP-сервер /mcp (docs/architecture/mcp.md): Streamable HTTP без сессий, JSON-ответы, вход только по токену агента.
   На каждый HTTP-запрос — новый сервер и транспорт; инструменты ходят во внутренний API с исходным Authorization. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { AppError } from '../errors';
import { requireSession } from '../middleware';
import type { AppEnv } from '../types';
import { callApi, type Query, type WriteMethod } from './call';
import { registerTools } from './tools';

const hasBearer = (h: string | undefined) => !!h && /^bearer\s+\S/i.test(h);

/** Маршрут /mcp. getApp — всё приложение: инструменты вызывают его маршруты через app.request */
export function mcpRoutes(getApp: () => Hono<AppEnv>) {
  return new Hono<AppEnv>()
    .use('*', async (c, next) => {
      // MCP — только для токенов: cookie сессии сюда не пускаем
      if (!hasBearer(c.req.header('authorization'))) throw new AppError(401, 'token_required', 'MCP requires an access token (Authorization: Bearer)');
      await next();
    })
    .use('*', requireSession)
    .post('/', async c => {
      const token = c.get('apiToken');
      if (!token) throw new AppError(401, 'token_required', 'MCP requires an access token (Authorization: Bearer)');
      const wsHeader = c.req.header('x-workspace-id');
      if (wsHeader && wsHeader.toLowerCase() !== token.workspaceId) throw new AppError(403, 'token_forbidden', 'The token does not belong to this workspace');
      const authorization = c.req.header('authorization')!;

      const server = new McpServer({ name: 'gr8r', version: '1.0.0' }, { capabilities: { tools: {} } });
      const base = { authorization, workspaceId: token.workspaceId };
      registerTools(server, {
        call: (path: string, query: Query = {}) => callApi(getApp(), path, { ...base, query }),
        send: (method: WriteMethod, path: string, body: unknown) => callApi(getApp(), path, { ...base, method, body }),
        token: { ...token, sections: token.sections ?? null },
      });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      try {
        return await transport.handleRequest(c.req.raw);
      } finally {
        await server.close();
      }
    })
    .on(['GET', 'DELETE'], '/', c => c.json({ error: { code: 'method_not_allowed', message: 'Use POST for MCP requests' } }, 405));
}
