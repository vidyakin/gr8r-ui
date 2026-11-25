import { zValidator } from '@hono/zod-validator';
import { listSupplierPortalOrders, readMyAccess, readSupplierInvoice, resolveSupplierPortalLink, updateSupplierOrderResponse, uploadSupplierInvoice, withContext, workspaces, type Db } from '@erp/db';
import { idParam, parseSupplierPortalToken, supplierOrderResponsePatch, SUPPLIER_INVOICE_MAX_BYTES } from '@erp/shared';
import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { validationHook } from '../crud';
import { AppError, badRequest } from '../errors';
import { allowPublicRequest } from '../public-rate-limit';
import type { AppEnv } from '../types';

const notFound = () => new AppError(404, 'not_found', 'Not found');
const maxFile = SUPPLIER_INVOICE_MAX_BYTES;
const tooLarge = () => new AppError(413, 'attachment_too_large', 'Invoice must be 15 MB or smaller', { maxBytes: maxFile });
const orderParams = zValidator('param', idParam, validationHook);
const downloadParams = zValidator('param', z.object({ id: z.uuid(), attachmentId: z.uuid() }), validationHook);

function tokenOf(c: Context<AppEnv>) {
  const token = parseSupplierPortalToken(c.req.param('token') ?? '');
  if (!token) throw notFound();
  return token;
}

async function withPortal<T>(
  c: Context<AppEnv>,
  fn: (db: Db, workspaceId: string, supplier: Awaited<ReturnType<typeof resolveSupplierPortalLink>>, canWrite: boolean) => Promise<T>,
) {
  const { workspaceId, secret } = tokenOf(c);
  return withContext(c.get('sql'), { workspaceId }, async db => {
    const supplier = await resolveSupplierPortalLink(db, workspaceId, secret, true);
    const access = await readMyAccess(db);
    if (!access.readable.has('trade')) throw notFound();
    const canWrite = access.active.has('trade');
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !canWrite) throw new AppError(403, 'forbidden', 'Supplier portal is read-only');
    return fn(db, workspaceId, supplier, canWrite);
  });
}

export const publicSupplierRoutes = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  })
  .use('/:token/*', async (c, next) => {
    const { leadHookRateLimitMax: max, leadHookRateLimitWindowMs } = c.get('config');
    const sql = c.get('sql');
    const seconds = Math.ceil(leadHookRateLimitWindowMs / 1000);
    const limited = () => new AppError(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfter: seconds });
    if (!(await allowPublicRequest(sql, `supplier:ip:${c.get('ip')}`, max, seconds))) throw limited();
    const { workspaceId, secret } = tokenOf(c);
    // До валидации тела: невалидная ссылка всегда получает 404. Повторная проверка внутри
    // транзакции операции исключает запись после ротации во время передачи файла.
    const link = await withContext(sql, { workspaceId }, db => resolveSupplierPortalLink(db, workspaceId, secret));
    if (!(await allowPublicRequest(sql, `supplier:link:${link.id}`, max * 10, seconds))) throw limited();
    await next();
  })
  .get('/:token', async c => {
    const data = await withPortal(c, async (db, workspaceId, supplier, canWrite) => {
      const [workspace] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId));
      if (!workspace) throw notFound();
      return {
        workspaceName: workspace.name, supplierName: supplier.supplierName, canWrite,
        orders: await listSupplierPortalOrders(db, workspaceId, supplier.companyId),
      };
    });
    return c.json(data);
  })
  .patch('/:token/orders/:id', orderParams,
    bodyLimit({ maxSize: 32 * 1024, onError: () => { throw new AppError(413, 'payload_too_large', 'Request body is too large'); } }),
    zValidator('json', supplierOrderResponsePatch, validationHook), async c => {
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      return c.json(await withPortal(c, (db, ws, supplier) => updateSupplierOrderResponse(db, ws, supplier.companyId, id, patch)));
    })
  .post('/:token/orders/:id/invoice', orderParams,
    bodyLimit({ maxSize: maxFile + 64 * 1024, onError: () => { throw tooLarge(); } }), async c => {
      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        throw badRequest('bad_request', 'Expected multipart/form-data');
      }
      const files = form.getAll('file');
      const file = files[0];
      if (files.length !== 1 || !(file instanceof File)) throw badRequest('bad_request', 'One file is required');
      if (file.size > maxFile) throw tooLarge();
      const input = { name: file.name, mime: file.type, data: new Uint8Array(await file.arrayBuffer()) };
      const invoice = await withPortal(c, (db, ws, supplier) => uploadSupplierInvoice(db, ws, supplier.companyId, c.req.valid('param').id, input));
      return c.json(invoice, 201);
    })
  .get('/:token/orders/:id/invoice/:attachmentId', downloadParams, async c => {
    const { id, attachmentId } = c.req.valid('param');
    const file = await withPortal(c, (db, ws, supplier) => readSupplierInvoice(db, ws, supplier.companyId, id, attachmentId));
    const name = encodeURIComponent(file.name).replace(/['()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
    c.header('Content-Type', file.mime);
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${name}`);
    return c.body(new Blob([new Uint8Array(file.data)]).stream());
  });
