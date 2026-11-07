/* Токены доступа агентов (задача 1285, docs/architecture/agent-tokens.md): выпуск, список, отзыв и служебные сотрудники.
   Только по cookie-сессии: токен агента сам пускается на TENANT_PATHS, но /api-tokens ему закрыт (requireSession → 403). */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createApiToken, createServiceMember, listApiTokens, revokeApiToken } from '@gr8r/db';
import { apiTokenCreate, idParam, serviceMemberCreate } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

// guest тоже может выпускать и отзывать свои токены (только read-only) — ограничения в сервисе
const member = requireRole('guest');

export const apiTokenRoutes = new Hono<AppEnv>()
  .get('/', async c => c.json({ items: await listApiTokens(c.get('db'), ctxOf(c)) }))
  .post('/', member, zValidator('json', apiTokenCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createApiToken(ctx.db, ctx, c.req.valid('json')), 201);
  })
  .delete('/:id', member, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await revokeApiToken(ctx.db, ctx, c.req.valid('param').id));
  })
  .post('/service-members', requireRole('admin'), zValidator('json', serviceMemberCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createServiceMember(ctx.db, ctx, c.req.valid('json')), 201);
  });
