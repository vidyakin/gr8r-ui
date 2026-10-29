/* Арендаторы для оператора установки (users.is_operator): список, создание пустого или демо, запрос удаления, выгрузка.
   Удаление выполняет воркер (нужен DDL индексов полей), загрузка архива — только CLI. Раздел docs/architecture/deploy.md. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createTenant, exportTenant, isOperator, listTenantsForOperator, requestTenantDelete } from '@gr8r/db';
import { tenantCreateBody, workspaceParam } from '@gr8r/shared';
import { validationHook } from './crud';
import { forbidden } from './errors';
import { requireSession } from './middleware';
import type { AppEnv } from './types';

// Флаг перечитывается из БД: снятый CLI доступ действует сразу, без новой сессии
const requireOperator = createMiddleware<AppEnv>(async (c, next) => {
  if (!(await isOperator(c.get('sql'), c.get('user').id))) throw forbidden('Operator access required');
  await next();
});

export const adminRoutes = new Hono<AppEnv>()
  .use('*', requireSession, requireOperator)
  .get('/tenants', async c => c.json({ items: await listTenantsForOperator(c.get('sql'), c.get('user').id) }))
  .post('/tenants', zValidator('json', tenantCreateBody, validationHook), async c => {
    const b = c.req.valid('json');
    const t = await createTenant(c.get('sql'), { name: b.name, slug: b.slug, owner: { email: b.ownerEmail, name: b.ownerName }, demo: b.demo, ttlDays: b.ttlDays });
    return c.json(t, 201);
  })
  .delete('/tenants/:id', zValidator('param', workspaceParam, validationHook), async c => {
    await requestTenantDelete(c.get('sql'), c.req.valid('param').id);
    return c.json({ ok: true }, 202);
  })
  .get('/tenants/:id/export', zValidator('param', workspaceParam, validationHook), async c => {
    const id = c.req.valid('param').id;
    const archive = await exportTenant(c.get('sql'), id);
    return c.body(archive, 200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': `attachment; filename="tenant-${id}.gr8r.jsonl"`,
    });
  });
