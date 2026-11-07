/* Шаблоны проектов (docs/architecture/task-modules.md, «Шаблоны проектов»): список, сохранение проекта как шаблона,
   создание проекта из шаблона, переименование и флаг «отключён», удаление. Читают и создают проекты участники,
   правят и удаляют шаблоны admin и owner. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createProjectFromTemplate, deleteProjectTemplate, getProjectTemplate, listProjectTemplates, saveProjectAsTemplate, updateProjectTemplate } from '@gr8r/db';
import { idParam, projectFromTemplate, projectTemplateFromProject, projectTemplateQuery, projectTemplateUpdate } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const docCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });

export const projectTemplateRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', projectTemplateQuery, validationHook), async c => c.json({ items: await listProjectTemplates(ctxOf(c).db, { enabledOnly: c.req.valid('query').enabled === 'true' }) }))
  .get('/:id', zValidator('param', idParam, validationHook), async c => c.json(await getProjectTemplate(ctxOf(c).db, c.req.valid('param').id)))
  .post('/from-project', requireRole('member'), zValidator('json', projectTemplateFromProject, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await saveProjectAsTemplate(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .post('/:id/create-project', requireRole('member'), zValidator('param', idParam, validationHook), zValidator('json', projectFromTemplate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createProjectFromTemplate(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')), 201);
  })
  .patch('/:id', requireRole('admin'), zValidator('param', idParam, validationHook), zValidator('json', projectTemplateUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateProjectTemplate(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/:id', requireRole('admin'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteProjectTemplate(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json({ ok: true });
  });
