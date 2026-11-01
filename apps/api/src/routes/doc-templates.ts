/* Шаблоны КП и договоров (docs/architecture/quotes.md): чтение — любой участник (шаблоны «только автор» видит только автор),
   создание — member и выше, правка и удаление — автор или admin+. Логика — packages/db/src/quotes.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { archiveTemplate, createDocxTemplate, createTemplate, getTemplate, listTemplates, readDocxTemplate, updateTemplate } from '@gr8r/db';
import { DOC_TEMPLATE_PURPOSES, docTemplateCreate, docTemplateUpdate, idParam, queryBool } from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { AppError } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });
const listQuery = z.object({ purpose: z.enum(DOC_TEMPLATE_PURPOSES).optional(), used: queryBool.optional(), archived: queryBool.optional() });

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
  })
  // Загрузка .docx-шаблона (задача 1195): multipart — file, purpose?, name?, onlyAuthor?.
  // Файл разбирается сразу: список параметров возвращается, ошибка разбора — 422 template_invalid
  .post('/docx', write, async c => {
    const ctx = ctxOf(c);
    let body: Record<string, string | File | (string | File)[]>;
    try {
      body = await c.req.parseBody();
    } catch {
      throw new AppError(400, 'bad_request', 'Expected multipart/form-data');
    }
    const file = body.file;
    if (!(file instanceof File)) throw new AppError(400, 'bad_request', 'Field "file" is required');
    if (!/\.docx$/i.test(file.name)) throw new AppError(422, 'not_docx', 'Only .docx files are accepted');
    const purpose = (typeof body.purpose === 'string' ? body.purpose : 'contract') as (typeof DOC_TEMPLATE_PURPOSES)[number];
    if (!DOC_TEMPLATE_PURPOSES.includes(purpose)) throw new AppError(422, 'bad_purpose', 'Unknown template purpose');
    const res = await createDocxTemplate(ctx.db, docCtx(ctx), { name: file.name, mime: file.type || null, data: new Uint8Array(await file.arrayBuffer()) }, {
      purpose,
      name: typeof body.name === 'string' ? body.name : undefined,
      onlyAuthor: body.onlyAuthor === '1' || body.onlyAuthor === 'true',
    });
    return c.json({ ...res.template, tags: res.tags }, 201);
  })
  // Скачивание исходного .docx шаблона (без заполнения реквизитами)
  .get('/:id/docx', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { name, data } = await readDocxTemplate(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return new Response(new Uint8Array(data), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}.docx"; filename*=UTF-8''${encodeURIComponent(name)}.docx`,
      },
    });
  });
