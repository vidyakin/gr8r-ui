/* Сборка публичного REST API v1 (/v1/*): OpenAPI без авторизации, остальные маршруты — по Bearer-токену. */
import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { v1AuthChain } from './auth';
import { v1CatalogRoutes } from './catalog';
import { v1DocumentRoutes } from './documents';
import { buildOpenApiSpec } from './openapi';

const authed = new Hono<AppEnv>()
  .use('*', ...v1AuthChain)
  .route('/', v1CatalogRoutes)
  .route('/', v1DocumentRoutes);

export const v1Routes = new Hono<AppEnv>()
  .get('/openapi.json', c => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(buildOpenApiSpec('/api'));
  })
  .route('/', authed);
