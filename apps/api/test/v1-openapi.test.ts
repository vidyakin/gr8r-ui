import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { MODULE_OF_PATH, TOKEN_OPEN_PATHS, TOKEN_PATH_SECTIONS, isTokenPostingRequest, webhookCreate, webhookMatchesEvent, webhookUpdate } from '@erp/shared';
import { TENANT_PATHS } from '../src/app';
import { onError } from '../src/errors';
import { v1DocumentQuery, v1ProductQuery, v1StockQuery } from '../src/routes/v1/auth';
import { v1Routes } from '../src/routes/v1';
import { buildOpenApiSpec } from '../src/routes/v1/openapi';
import type { AppEnv } from '../src/types';

describe('Public REST API v1 & OpenAPI', () => {
  test('buildOpenApiSpec returns valid OpenAPI 3.0.3 with Bearer auth and all v1 paths', () => {
    const spec = buildOpenApiSpec('/api');
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.components.securitySchemes.bearerAuth.type).toBe('http');
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    const paths = Object.keys(spec.paths);
    for (const p of [
      '/v1/products',
      '/v1/products/{id}',
      '/v1/stock',
      '/v1/prices',
      '/v1/companies',
      '/v1/companies/{id}',
      '/v1/warehouses',
      '/v1/documents',
      '/v1/documents/{id}',
      '/v1/documents/{id}/post',
    ]) {
      expect(paths).toContain(p);
    }
    expect(spec.paths['/v1/documents'].post).toBeDefined();
    expect(spec.paths['/v1/documents/{id}'].patch).toBeDefined();
    expect(spec.paths['/v1/documents/{id}/post'].post).toBeDefined();
  });

  test('GET /openapi.json is unauthenticated and returns OpenAPI JSON', async () => {
    const res = await v1Routes.request('/openapi.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(body.openapi).toBe('3.0.3');
    expect(body.paths['/v1/products']).toBeDefined();
  });

  test('GET /products without Bearer token is rejected with 401 token_required', async () => {
    const app = new Hono<AppEnv>().route('/v1', v1Routes).onError(onError);
    const res = await app.request('/v1/products');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('token_required');
  });

  test('v1 query schemas validate filters and paging', () => {
    const pq = v1ProductQuery.parse({ limit: '25', offset: '50', sku: 'SKU-1', active: 'true', updatedSince: '2026-01-01' });
    expect(pq.limit).toBe(25);
    expect(pq.offset).toBe(50);
    expect(pq.active).toBe(true);
    expect(pq.sku).toBe('SKU-1');

    const dq = v1DocumentQuery.parse({ dateFrom: '2026-01-01', dateTo: '2026-01-31', status: 'posted' });
    expect(dq.dateFrom).toBe('2026-01-01');
    expect(dq.status).toBe('posted');

    const sq = v1StockQuery.parse({ nonZero: 'true' });
    expect(sq.nonZero).toBe(true);
    expect(v1ProductQuery.safeParse({ limit: '999' }).success).toBe(false);
  });

  test('isTokenPostingRequest enforces can_post on /v1/documents/:id/post', () => {
    expect(isTokenPostingRequest('POST', '/v1/documents/01900000-0000-7000-8000-000000000001/post')).toBe(true);
    expect(isTokenPostingRequest('POST', '/v1/documents')).toBe(false);
    expect(isTokenPostingRequest('PATCH', '/v1/documents/01900000-0000-7000-8000-000000000001')).toBe(false);
  });

  test('webhook schemas and event matching work as expected', () => {
    expect(webhookCreate.safeParse({ url: 'https://example.com/hook', events: ['document.posted'] }).success).toBe(true);
    expect(webhookCreate.safeParse({ url: 'ftp://example.com/hook', events: ['document.posted'] }).success).toBe(false);
    expect(webhookCreate.safeParse({ url: 'https://example.com/hook', events: [] }).success).toBe(false);
    expect(webhookUpdate.safeParse({ rotateSecret: true }).success).toBe(true);

    expect(webhookMatchesEvent(['document.posted'], 'document.posted')).toBe(true);
    expect(webhookMatchesEvent(['document.posted'], 'product.created')).toBe(false);
    expect(webhookMatchesEvent(['document.*'], 'document.unposted')).toBe(true);
    expect(webhookMatchesEvent(['*'], 'anything.here')).toBe(true);
  });

  test('/webhooks is registered in TENANT_PATHS, MODULE_OF_PATH, and TOKEN_PATH_SECTIONS', () => {
    expect(TENANT_PATHS).toContain('/webhooks');
    expect(MODULE_OF_PATH.get('/webhooks')).toBe('core');
    expect(TOKEN_PATH_SECTIONS.has('/webhooks')).toBe(true);
    expect(TOKEN_OPEN_PATHS.has('/webhooks')).toBe(false);
  });
});
