/* Публичная read-only страница отслеживания доставки (/public/delivery/:token, задача 1217).
   Без авторизации, безопасный обход RLS только для поиска workspace по токену, затем строгий контекст арендатора и allowlist полей. */
import { Hono } from 'hono';
import { getPublicDeliveryTracking, readMyAccess, resolveDeliveryTrackingToken, withContext } from '@erp/db';
import { AppError } from '../errors';
import { allowPublicRequest } from '../public-rate-limit';
import type { AppEnv } from '../types';

const notFound = () => new AppError(404, 'not_found', 'Not found');

export const publicDeliveryRoutes = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  })
  .get('/:token', async c => {
    const { leadHookRateLimitMax: max, leadHookRateLimitWindowMs } = c.get('config');
    const sql = c.get('sql');
    const seconds = Math.ceil(leadHookRateLimitWindowMs / 1000);
    const limited = () => new AppError(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfter: seconds });

    if (!(await allowPublicRequest(sql, `delivery:ip:${c.get('ip')}`, max, seconds))) throw limited();
    const resolved = await resolveDeliveryTrackingToken(sql, c.req.param('token') ?? '');
    if (!resolved) throw notFound();
    if (!(await allowPublicRequest(sql, `delivery:id:${resolved.deliveryId}`, max * 10, seconds))) throw limited();

    const data = await withContext(sql, { workspaceId: resolved.workspaceId }, async db => {
      const access = await readMyAccess(db);
      if (!access.readable.has('services')) throw notFound();
      return getPublicDeliveryTracking(db, resolved.workspaceId, resolved.deliveryId);
    });
    if (!data) throw notFound();
    return c.json(data);
  });
