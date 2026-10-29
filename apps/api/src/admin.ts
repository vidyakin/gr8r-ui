/* Арендаторы для оператора установки (users.is_operator): список, создание пустого или демо, запрос удаления, выгрузка.
   Удаление выполняет воркер (нужен DDL индексов полей), загрузка архива — только CLI. Раздел docs/architecture/deploy.md. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createTenant, deletePlan, exportTenant, getTenantLicense, isOperator, listPlans, listTenantsForOperator, requestTenantDelete, savePlan, setTenantLicense } from '@gr8r/db';
import { licensePlanBody, tenantCreateBody, tenantLicenseBody, workspaceParam } from '@gr8r/shared';
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
  // Тарифы и лицензии арендаторов (задача 1205, docs/architecture/licensing.md): запись — функции БД app_operator_*
  .get('/plans', async c => c.json({ items: await listPlans(c.get('sql'), c.get('user').id) }))
  .post('/plans', zValidator('json', licensePlanBody, validationHook), async c => c.json(await savePlan(c.get('sql'), c.get('user').id, null, c.req.valid('json')), 201))
  .put('/plans/:id', zValidator('param', workspaceParam, validationHook), zValidator('json', licensePlanBody, validationHook), async c =>
    c.json(await savePlan(c.get('sql'), c.get('user').id, c.req.valid('param').id, c.req.valid('json'))),
  )
  .delete('/plans/:id', zValidator('param', workspaceParam, validationHook), async c => {
    await deletePlan(c.get('sql'), c.get('user').id, c.req.valid('param').id);
    return c.json({ ok: true });
  })
  .get('/tenants/:id/license', zValidator('param', workspaceParam, validationHook), async c => c.json(await getTenantLicense(c.get('sql'), c.get('user').id, c.req.valid('param').id)))
  .put('/tenants/:id/license', zValidator('param', workspaceParam, validationHook), zValidator('json', tenantLicenseBody, validationHook), async c =>
    c.json(await setTenantLicense(c.get('sql'), c.get('user').id, c.req.valid('param').id, c.req.valid('json'))),
  )
  .get('/tenants/:id/export', zValidator('param', workspaceParam, validationHook), async c => {
    const id = c.req.valid('param').id;
    const archive = await exportTenant(c.get('sql'), id);
    return c.body(archive, 200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': `attachment; filename="tenant-${id}.gr8r.jsonl"`,
    });
  });
