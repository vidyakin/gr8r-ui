import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';
import {
  getSupplierRating,
  listSupplierRatings,
  loadSupplierRatingSettings,
  saveSupplierRatingSettings,
  defaultSupplierRatingPeriod,
} from '@gr8r/db';
import { isoDate } from '@gr8r/shared';

const admin = requireRole('admin');

const qSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const settingsUpdate = z.object({
  weights: z.object({ onTime: z.number().min(0).optional(), completeness: z.number().min(0).optional(), quality: z.number().min(0).optional() }).optional(),
  dPolicy: z.enum(['none', 'warn', 'block']).optional(),
  supplierRatingWeights: z.object({ onTime: z.number().min(0).optional(), completeness: z.number().min(0).optional(), quality: z.number().min(0).optional() }).optional(),
  supplierRatingDPolicy: z.enum(['none', 'warn', 'block']).optional(),
  supplierRatingDpolicy: z.enum(['none', 'warn', 'block']).optional(),
});

export const supplierRatingRoutes = new Hono<AppEnv>()
  .get('/settings', async c => {
    const ctx = ctxOf(c);
    const s = await loadSupplierRatingSettings(ctx.db, ctx.workspaceId);
    return c.json({
      weights: s.weights,
      dPolicy: s.dPolicy,
      supplierRatingWeights: s.weights,
      supplierRatingDPolicy: s.dPolicy,
      supplierRatingDpolicy: s.dPolicy,
    });
  })
  .patch('/settings', admin, zValidator('json', settingsUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const weights = body.weights ?? body.supplierRatingWeights;
    const dPolicy = body.dPolicy ?? body.supplierRatingDPolicy ?? body.supplierRatingDpolicy;
    const s = await saveSupplierRatingSettings(ctx.db, ctx.workspaceId, { weights: weights as any, dPolicy });
    return c.json({
      weights: s.weights,
      dPolicy: s.dPolicy,
      supplierRatingWeights: s.weights,
      supplierRatingDPolicy: s.dPolicy,
      supplierRatingDpolicy: s.dPolicy,
    });
  })
  .get('/', zValidator('query', qSchema, validationHook), async c => {
    const ctx = ctxOf(c);
    const { from, to } = c.req.valid('query');
    const def = defaultSupplierRatingPeriod();
    const items = await listSupplierRatings(ctx.db, ctx.workspaceId, from ?? def.from, to ?? def.to);
    return c.json({ items, total: items.length });
  })
  .get('/:companyId', zValidator('param', z.object({ companyId: z.uuid() }), validationHook), zValidator('query', qSchema, validationHook), async c => {
    const ctx = ctxOf(c);
    const { companyId } = c.req.valid('param');
    const { from, to } = c.req.valid('query');
    const def = defaultSupplierRatingPeriod();
    const r = await getSupplierRating(ctx.db, ctx.workspaceId, companyId, from ?? def.from, to ?? def.to);
    return c.json(r);
  });
