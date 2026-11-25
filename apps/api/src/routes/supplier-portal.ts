import { zValidator } from '@hono/zod-validator';
import { getOrCreateSupplierPortalLink, getSupplierPortalLink, rotateSupplierPortalLink, toggleSupplierPortalLink } from '@erp/db';
import { supplierPortalLinkToggle } from '@erp/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { ctxOf, validationHook } from '../crud';
import { hiddenFieldsOf, requireVisibleFields } from '../field-access';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const path = '/companies/:companyId/link';
const params = zValidator('param', z.object({ companyId: z.uuid() }), validationHook);

export const supplierPortalRoutes = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  })
  .use('*', requireRole('member'), async (c, next) => {
    // Тот, кому скрыли суммы документов, не должен получать их через ссылку.
    requireVisibleFields((await hiddenFieldsOf(ctxOf(c))).filter(key => key === 'document.total'));
    await next();
  })
  .get(path, params, async c => {
    const { db, workspaceId } = ctxOf(c);
    return c.json({ link: await getSupplierPortalLink(db, workspaceId, c.req.valid('param').companyId) });
  })
  .post(path, params, async c => {
    const { db, workspaceId, memberId } = ctxOf(c);
    return c.json({ link: await getOrCreateSupplierPortalLink(db, workspaceId, c.req.valid('param').companyId, memberId) });
  })
  .post(`${path}/rotate`, params, async c => {
    const { db, workspaceId, memberId } = ctxOf(c);
    return c.json({ link: await rotateSupplierPortalLink(db, workspaceId, c.req.valid('param').companyId, memberId) });
  })
  .patch(path, params, zValidator('json', supplierPortalLinkToggle, validationHook), async c => {
    const { db, workspaceId, memberId } = ctxOf(c);
    return c.json({ link: await toggleSupplierPortalLink(db, workspaceId, c.req.valid('param').companyId, c.req.valid('json').enabled, memberId) });
  });
