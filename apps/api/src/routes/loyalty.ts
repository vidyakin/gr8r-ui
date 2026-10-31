/* Скидки и лояльность (задача 1179): правила автоматических скидок, промокоды, программа и карты лояльности.
   Пересчёт скидок строк и выбор карты/промокода документа — отдельные действия на черновике; списание/начисление
   баллов происходит при проведении (packages/db/src/loyalty.ts, вызывается из documents.ts). Правила — docs/architecture/loyalty.md. */
import { zValidator } from '@hono/zod-validator';
import {
  archiveDiscountRule,
  archiveLoyaltyCard,
  archivePromoCode,
  createDiscountRule,
  createLoyaltyCard,
  createPromoCode,
  discountRuleDetail,
  documentLoyaltyOf,
  ensureLoyaltyProgram,
  listDiscountRules,
  listLoyaltyCards,
  listPromoCodes,
  loyaltyCardDetail,
  recalcDocumentDiscounts,
  restoreDiscountRule,
  saveDocumentLoyalty,
  updateDiscountRule,
  updateLoyaltyCard,
  updateLoyaltyProgram,
  updatePromoCode,
} from '@gr8r/db';
import {
  discountRecalcBody,
  discountRuleCreate,
  discountRuleUpdate,
  documentLoyaltyBody,
  idParam,
  loyaltyCardCreate,
  loyaltyCardsQuery,
  loyaltyCardUpdate,
  loyaltyProgramUpdate,
  promoCodeCreate,
  promoCodeUpdate,
  uuid,
} from '@gr8r/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });
const docIdParam = z.object({ id: uuid });

export const loyaltyRoutes = new Hono<AppEnv>()
  /* ---------- правила автоматических скидок (admin) ---------- */
  .get('/discount-rules', async c => {
    const ctx = ctxOf(c);
    const archived = c.req.query('archived') === 'true';
    return c.json({ items: await listDiscountRules(ctx.db, ctx.workspaceId, { archived }) });
  })
  .get('/discount-rules/:id', zValidator('param', idParam, validationHook), async c => c.json(await discountRuleDetail(ctxOf(c).db, c.req.valid('param').id)))
  .post('/discount-rules', admin, zValidator('json', discountRuleCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createDiscountRule(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await discountRuleDetail(ctx.db, id), 201);
  })
  .patch('/discount-rules/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', discountRuleUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updateDiscountRule(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await discountRuleDetail(ctx.db, id));
  })
  .delete('/discount-rules/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await archiveDiscountRule(ctx.db, docCtx(ctx), id);
    return c.json({ id, archived: true as const });
  })
  .post('/discount-rules/:id/restore', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await restoreDiscountRule(ctx.db, docCtx(ctx), id);
    return c.json(await discountRuleDetail(ctx.db, id));
  })
  /* ---------- промокоды (admin) ---------- */
  .get('/promo-codes', admin, async c => {
    const ctx = ctxOf(c);
    const archived = c.req.query('archived') === 'true';
    return c.json({ items: await listPromoCodes(ctx.db, ctx.workspaceId, { archived }) });
  })
  .post('/promo-codes', admin, zValidator('json', promoCodeCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createPromoCode(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json({ items: await listPromoCodes(ctx.db, ctx.workspaceId) }.items.find(p => p.id === id), 201);
  })
  .patch('/promo-codes/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', promoCodeUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updatePromoCode(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json((await listPromoCodes(ctx.db, ctx.workspaceId, { archived: true })).find(p => p.id === id));
  })
  .delete('/promo-codes/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await archivePromoCode(ctx.db, docCtx(ctx), id);
    return c.json({ id, archived: true as const });
  })
  /* ---------- программа лояльности: одна настройка на арендатора (admin) ---------- */
  .get('/program', async c => c.json(await ensureLoyaltyProgram(ctxOf(c).db, ctxOf(c).workspaceId)))
  .patch('/program', admin, zValidator('json', loyaltyProgramUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    await updateLoyaltyProgram(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await ensureLoyaltyProgram(ctx.db, ctx.workspaceId));
  })
  /* ---------- карты лояльности ---------- */
  .get('/cards', zValidator('query', loyaltyCardsQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await listLoyaltyCards(ctx.db, ctx.workspaceId, c.req.valid('query')) });
  })
  .get('/cards/:id', zValidator('param', idParam, validationHook), async c => c.json(await loyaltyCardDetail(ctxOf(c).db, c.req.valid('param').id)))
  .post('/cards', write, zValidator('json', loyaltyCardCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createLoyaltyCard(ctx.db, docCtx(ctx), c.req.valid('json'));
    return c.json(await loyaltyCardDetail(ctx.db, id), 201);
  })
  .patch('/cards/:id', write, zValidator('param', idParam, validationHook), zValidator('json', loyaltyCardUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updateLoyaltyCard(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await loyaltyCardDetail(ctx.db, id));
  })
  .delete('/cards/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await archiveLoyaltyCard(ctx.db, docCtx(ctx), id);
    return c.json({ id, archived: true as const });
  })
  /* ---------- скидки и лояльность документа (черновик продажи/заказ-наряда) ---------- */
  .post('/documents/:id/recalc-discounts', write, zValidator('param', docIdParam, validationHook), zValidator('json', discountRecalcBody, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await recalcDocumentDiscounts(ctx.db, docCtx(ctx), id, c.req.valid('json').promoCode ?? null);
    return c.json({ id, recalculated: true as const });
  })
  .get('/documents/:id/loyalty', zValidator('param', docIdParam, validationHook), async c => c.json(await documentLoyaltyOf(ctxOf(c).db, c.req.valid('param').id)))
  .put('/documents/:id/loyalty', write, zValidator('param', docIdParam, validationHook), zValidator('json', documentLoyaltyBody, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await saveDocumentLoyalty(ctx.db, ctx.workspaceId, id, c.req.valid('json'));
    return c.json(await documentLoyaltyOf(ctx.db, id));
  });
