/* Лицензия текущего арендатора: включённые модули, их сроки и заявки на подключение (docs/architecture/licensing.md). Читают все участники. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createModuleRequest, listMyModuleRequests, readMyLicense } from '@gr8r/db';
import { licenseView, moduleRequestBody } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

export const licenseRoutes = new Hono<AppEnv>()
  .get('/', async c => c.json(licenseView(await readMyLicense(c.get('db')))))
  // «Нужно больше?»: заявки арендатора на модули. Создаёт владелец или админ; оператор видит их на своём экране (/admin/requests)
  .get('/requests', async c => c.json({ items: await listMyModuleRequests(c.get('db')) }))
  .post('/requests', requireRole('admin'), zValidator('json', moduleRequestBody, validationHook), async c => {
    const { db, workspaceId, memberId } = ctxOf(c);
    return c.json(await createModuleRequest(db, { workspaceId, memberId }, c.req.valid('json')), 201);
  });
