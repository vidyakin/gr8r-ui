import { describe, expect, test } from 'bun:test';
import type { Sql } from '@erp/db';
import { createApp } from '../src/app';

const workspaceId = '018f1a2b-3c4d-7890-8abc-0123456789ab';
const supplierId = '018f1a2b-3c4d-7890-8abc-0123456789ac';
const linkId = '018f1a2b-3c4d-7890-8abc-0123456789ad';
const orderId = '018f1a2b-3c4d-7890-8abc-0123456789ae';
const token = `${workspaceId}.${'a'.repeat(43)}`;

// No database or object storage: exercise the mounted routes, rate-limit and authorization middleware.
function appFor({ active = false, linkHits = 1 } = {}) {
  const rateKeys: string[] = [];
  const tx = {
    unsafe(query: string, params: string[] = []) {
      let rows: unknown[] = [];
      if (query.startsWith('insert into "rate_limits"')) {
        rateKeys.push(params[0]!);
        rows = [[params[0]?.includes(':link:') ? linkHits : 1]];
      } else if (query.includes('from "supplier_portal_links"')) {
        rows = active ? [[linkId, supplierId]] : [];
      } else if (query.includes('from "companies"')) {
        rows = [['Supplier']];
      } else if (!query.startsWith('set local') && !query.startsWith('select set_config')) {
        throw new Error(`Unexpected SQL: ${query}`);
      }
      return { values: async () => rows };
    },
  };
  const sql = { begin: async (run: (client: typeof tx) => unknown) => run(tx) } as unknown as Sql;
  const { app } = createApp({ sql, numberingSql: sql, config: { logRequests: false, leadHookRateLimitMax: 2, leadHookRateLimitWindowMs: 60_000 } });
  return { app, rateKeys };
}

describe('supplier portal routes', () => {
  test('rejects unknown or disabled links before validating request bodies', async () => {
    const { app, rateKeys } = appFor();
    for (const [method, suffix] of [
      ['GET', ''],
      ['PATCH', `/orders/${orderId}`],
      ['POST', `/orders/${orderId}/invoice`],
    ] as const) {
      const response = await app.request(`/public/supplier/${token}${suffix}`, {
        method,
        ...(method !== 'GET' ? { headers: { 'Content-Type': 'application/json' }, body: '{' } : {}),
      });
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).not.toContain(token);
    }
    expect(rateKeys).toEqual(Array(3).fill('supplier:ip:unknown'));
  });

  test('limits a valid link across IPs without using the secret as the counter key', async () => {
    const { app, rateKeys } = appFor({ active: true, linkHits: 21 });
    const response = await app.request(`/public/supplier/${token}`);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(rateKeys).toEqual(['supplier:ip:unknown', `supplier:link:${linkId}`]);
  });

  test('requires a session on company link management routes', async () => {
    const { app } = appFor();
    const path = `/supplier-portal/companies/${supplierId}/link`;
    for (const [method, url] of [['GET', path], ['POST', path], ['PATCH', path], ['POST', `${path}/rotate`]]) {
      expect((await app.request(url!, { method })).status).toBe(401);
    }
  });
});
