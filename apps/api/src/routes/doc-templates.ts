/* Шаблоны КП и договоров (docs/architecture/quotes.md): чтение — любой участник (шаблоны «только автор» видит только автор),
   создание — member и выше, правка и удаление — автор или admin+. Логика — packages/db/src/quotes.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { archiveTemplate, createTemplate, getTemplate, listTemplates, updateTemplate } from '@gr8r/db';
import { docTemplateCreate, docTemplateUpdate, idParam, queryBool } from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });
const listQuery = z.object({ purpose: z.enum(['quote']).optional(), used: queryBool.optional(), archived: queryBool.optional() });

export const docTemplateRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', listQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json({ items: await listTemplates(ctx.db, docCtx(ctx), { purpose: q.purpose, usedOnly: q.used, archived: q.archived }) });
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await getTemplate(ctx.db, docCtx(ctx), c.req.valid('param').id));
  })
  .post('/', write, zValidator('json', docTemplateCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createTemplate(ctx.db, docCtx(ctx), c.req.valid('json')), 201);
  })
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', docTemplateUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateTemplate(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await archiveTemplate(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json({ ok: true });
  });
