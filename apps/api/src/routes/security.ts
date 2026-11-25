import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { listLoginEvents, updateWorkspaceSecurity, workspaceSecurity } from '@erp/db';
import { workspaceSecurityBody } from '@erp/shared';
import { ctxOf, validationHook } from '../crud';
import { assertNotDemo } from '../auth';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

export const securityRoutes = new Hono<AppEnv>()
  .use('*', requireRole('admin'))
  .get('/settings', async c => {
    const { db, workspaceId } = ctxOf(c);
    return c.json({ ...await workspaceSecurity(db, workspaceId), currentIp: c.get('ip') });
  })
  .patch('/settings', zValidator('json', workspaceSecurityBody, validationHook), async c => {
    assertNotDemo(c);
    const ctx = ctxOf(c);
    const settings = await updateWorkspaceSecurity(ctx.db, ctx, c.get('ip'), c.req.valid('json'));
    return c.json({ ...settings, currentIp: c.get('ip') });
  })
  .get('/login-log', zValidator('query', z.object({ offset: z.coerce.number().int().min(0).max(1_000_000).default(0) }), validationHook), async c => {
    const { db, workspaceId } = ctxOf(c);
    const { offset } = c.req.valid('query');
    const items = await listLoginEvents(db, workspaceId, offset);
    return c.json({ items: items.slice(0, 50), hasMore: items.length > 50 });
  });
