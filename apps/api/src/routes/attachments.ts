/* Вложения к любым объектам (docs/architecture/attachments.md): загрузка и выдача потоком через API, версии, архив.
   Права — как у объекта (packages/db/src/attachments.ts), лимит файла и квота воркспейса — там же. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { addVersion, archiveAttachment, createAttachment, getAttachment, listAttachments, readContent, readThumb, restoreAttachment, renameAttachment, setStorageQuota, storageSettings, storageUsage, type ThumbSize } from '@gr8r/db';
import { attachmentQuery, attachmentQuotaBody, attachmentUpdate, idParam } from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { AppError, badRequest } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const actorOf = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

/** Запрос с файлом: сначала Content-Length (до чтения тела), затем фактический размер */
async function readUpload(c: import('hono').Context<AppEnv>): Promise<{ file: File; fields: Record<string, string> }> {
  const max = storageSettings().maxFileBytes;
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > max + 64 * 1024) throw new AppError(413, 'attachment_too_large', `File is larger than ${max} bytes`, { maxBytes: max });
  let body: Record<string, string | File | (string | File)[]>;
  try {
    body = await c.req.parseBody();
  } catch {
    throw badRequest('bad_request', 'Expected multipart/form-data');
  }
  const file = body.file;
  if (!(file instanceof File)) throw badRequest('bad_request', 'Field "file" is required');
  if (file.size > max) throw new AppError(413, 'attachment_too_large', `File is larger than ${max} bytes`, { maxBytes: max });
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === 'string') fields[k] = v;
  return { file, fields };
}

const bytesOf = async (f: File) => new Uint8Array(await f.arrayBuffer());
const disposition = (name: string, inline: boolean) => `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
const versionParam = z.object({ version: z.coerce.number().int().positive().optional(), thumb: z.enum(['128', '256', '512']).optional() });

const view = (a: { id: string }, extra: object) => ({ ...a, ...extra });

export const attachmentRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', attachmentQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const items = await listAttachments(ctx.db, actorOf(ctx), {
      entityType: q.entityType,
      entityTypes: q.entityTypes?.split(',').map(s => s.trim()).filter(Boolean),
      entityId: q.entityId,
      q: q.q,
      archived: q.archived === '1',
    });
    // стандартный постраничный ответ списков (клиентский движок читает страницы до total)
    const limit = Math.min(Math.max(Number(c.req.query('limit')) || 200, 1), 1000);
    const offset = Math.max(Number(c.req.query('offset')) || 0, 0);
    return c.json({ items: items.slice(offset, offset + limit), total: items.length, limit, offset });
  })
  // занято / квота / предел файла
  .get('/storage', async c => {
    const ctx = ctxOf(c);
    return c.json(await storageUsage(ctx.db, ctx.workspaceId));
  })
  .patch('/storage', requireRole('owner'), zValidator('json', attachmentQuotaBody, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await setStorageQuota(ctx.db, ctx.workspaceId, c.req.valid('json').storageQuotaBytes));
  })
  // загрузка: multipart — entityType, entityId, file
  .post('/', write, async c => {
    const ctx = ctxOf(c);
    const { file, fields } = await readUpload(c);
    if (!fields.entityType || !fields.entityId) throw badRequest('bad_request', 'entityType and entityId are required');
    if (!z.string().uuid().safeParse(fields.entityId).success) throw badRequest('bad_request', 'entityId must be a uuid');
    const res = await createAttachment(ctx.db, actorOf(ctx), fields.entityType, fields.entityId, { name: file.name || 'file', mime: file.type || null, data: await bytesOf(file), comment: fields.comment });
    return c.json(view(res.attachment, { sizeBytes: res.version.sizeBytes, mime: res.version.mime, versionCount: 1 }), 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { attachment, versions } = await getAttachment(ctx.db, actorOf(ctx), c.req.valid('param').id);
    return c.json({ ...attachment, versions: versions.map(v => ({ id: v.id, version: v.version, sizeBytes: v.sizeBytes, mime: v.mime, sha256: v.sha256, comment: v.comment, createdBy: v.createdBy, createdAt: v.createdAt, hasContent: !!v.storageKey })) });
  })
  // новая версия: multipart — file, comment?, rename? ("1" — переименовать вложение по имени файла)
  .post('/:id/versions', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { file, fields } = await readUpload(c);
    const res = await addVersion(ctx.db, actorOf(ctx), c.req.valid('param').id, { name: file.name || 'file', mime: file.type || null, data: await bytesOf(file), comment: fields.comment, rename: fields.rename === '1' });
    return c.json({ attachment: res.attachment, version: res.version }, 201);
  })
  .get('/:id/content', zValidator('param', idParam, validationHook), zValidator('query', versionParam, validationHook), async c => {
    const ctx = ctxOf(c);
    // "128"|"256"|"512" из query → число; 0/NaN → undefined (без миниатюры)
    const thumbRaw = c.req.valid('query').thumb;
    const thumb = thumbRaw ? (Number(thumbRaw) as ThumbSize) : undefined;
    // миниатюра — без номера версии (текущая) и без параметров сохранения: маленькая и редко меняется
    const f = thumb ? await readThumb(ctx.db, actorOf(ctx), c.req.valid('param').id, thumb) : await readContent(ctx.db, actorOf(ctx), c.req.valid('param').id, c.req.valid('query').version);
    const inline = c.req.query('inline') === '1' && /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(f.mime);
    return new Response(new Blob([new Uint8Array(f.data)]), { headers: { 'content-type': f.mime, 'content-length': String(f.data.length), 'content-disposition': disposition(f.name, inline), 'x-content-type-options': 'nosniff', 'cache-control': thumb ? 'private, max-age=3600' : 'private, no-store' } });
  })
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', attachmentUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await renameAttachment(ctx.db, actorOf(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await archiveAttachment(ctx.db, actorOf(ctx), id);
    return c.json({ id, deleted: false as const, archived: true as const });
  })
  .post('/:id/restore', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await restoreAttachment(ctx.db, actorOf(ctx), c.req.valid('param').id));
  });
