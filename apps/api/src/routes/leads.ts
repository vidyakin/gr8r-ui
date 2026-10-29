/* Лиды (задача 1175, docs/architecture/leads.md): лиды, статусы, формы сайта. Логика с записью в БД — сервис `packages/db/src/leads.ts`. */
import { zValidator } from '@hono/zod-validator';
import { and, count, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { assignLead, convertLead, findDuplicates, formToken, leadForms, leadStatuses, leads, loadLead, mergeLeads, newFormSecret, statusOfCategory } from '@gr8r/db';
import {
  idParam,
  leadAssign,
  leadConvert,
  leadCreate,
  leadDuplicatesQuery,
  leadFormCreate,
  leadFormQuery,
  leadFormUpdate,
  leadMerge,
  leadQuery,
  leadStatusCreate,
  leadStatusQuery,
  leadStatusReorder,
  leadStatusUpdate,
  leadUpdate,
  normalizeEmail,
  normalizePhone,
} from '@gr8r/shared';
import { crud, ctxOf, validationHook } from '../crud';
import { AppError } from '../errors';
import { hasRole, requireRole } from '../middleware';
import { customForCreate, customForUpdate } from '../meta/service';
import { attributionPatch } from './helpers';
import type { AppEnv } from '../types';

const writeLead = requireRole('member');

async function statusById(ctx: ReturnType<typeof ctxOf>, id: string) {
  const [s] = await ctx.db.select().from(leadStatuses).where(eq(leadStatuses.id, id)).limit(1);
  if (!s) throw new AppError(422, 'lead_status_missing', 'Lead status not found');
  return s;
}

const base = crud({
  entity: 'lead',
  table: leads,
  create: leadCreate,
  update: leadUpdate,
  query: leadQuery,
  sortable: { name: leads.name, createdAt: leads.createdAt, updatedAt: leads.updatedAt, source: leads.source },
  defaultSort: '-createdAt',
  search: [leads.name, leads.companyName, leads.phone, leads.email, leads.comment],
  filters: q => [
    q.statusId ? eq(leads.statusId, q.statusId) : undefined,
    q.ownerId ? eq(leads.ownerId, q.ownerId) : undefined,
    q.source ? eq(leads.source, q.source) : undefined,
    q.sourceId ? eq(leads.sourceId, q.sourceId) : undefined,
    q.campaignId ? eq(leads.campaignId, q.campaignId) : undefined,
  ],
  prepareCreate: async (ctx, body) => {
    const status = body.statusId ? await statusById(ctx, body.statusId) : await statusOfCategory(ctx.db, 'new');
    if (status.category === 'converted') throw new AppError(422, 'lead_use_convert', 'Use conversion to move a lead to a converted status');
    return {
      statusId: status.id,
      ownerId: body.ownerId ?? ctx.memberId,
      phoneNorm: normalizePhone(body.phone),
      emailNorm: normalizeEmail(body.email),
      source: '',
      ...(await attributionPatch(ctx, body)),
      ...(await customForCreate(ctx, 'lead', body.custom)),
    };
  },
  prepareUpdate: async (ctx, existing, body) => {
    const patch: Record<string, unknown> = { ...(await customForUpdate(ctx, 'lead', existing.custom, body.custom, existing.id)), ...(await attributionPatch(ctx, body, existing)) };
    if (body.phone !== undefined) patch.phoneNorm = normalizePhone(body.phone);
    if (body.email !== undefined) patch.emailNorm = normalizeEmail(body.email);
    if (body.statusId && body.statusId !== existing.statusId) {
      if (existing.convertedAt) throw new AppError(409, 'lead_already_converted', 'The status of a converted lead cannot be changed');
      const status = await statusById(ctx, body.statusId);
      if (status.category === 'converted') throw new AppError(422, 'lead_use_convert', 'Use conversion to move a lead to a converted status');
      if (status.category !== 'rejected' && body.rejectReason === undefined) patch.rejectReason = '';
    }
    return patch;
  },
});

/** Дополнительные маршруты идут ДО crud: иначе `/duplicates` перехватит `GET /:id` */
export const leadRoutes = new Hono<AppEnv>()
  // ---- поиск дублей (форма нового лида) ----
  .get('/duplicates', zValidator('query', leadDuplicatesQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    return c.json({ items: await findDuplicates(ctx.db, q) });
  })
  // ---- дубли существующего лида (карточка) ----
  .get('/:id/duplicates', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const lead = await loadLead(ctx.db, c.req.valid('param').id);
    return c.json({ items: await findDuplicates(ctx.db, { phone: lead.phone, email: lead.email, companyName: lead.companyName, excludeLeadId: lead.id }) });
  })
  // ---- конвертация ----
  .post('/:id/convert', writeLead, zValidator('param', idParam, validationHook), zValidator('json', leadConvert, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    return c.json(await convertLead(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, c.req.valid('param').id, { company: body.company, contact: body.contact, deal: body.deal ?? null }));
  })
  // ---- объединение: этот лид вливается в intoId ----
  .post('/:id/merge', writeLead, zValidator('param', idParam, validationHook), zValidator('json', leadMerge, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await mergeLeads(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, c.req.valid('param').id, c.req.valid('json').intoId));
  })
  // ---- назначение ответственного ----
  .post('/:id/assign', writeLead, zValidator('param', idParam, validationHook), zValidator('json', leadAssign, validationHook), async c => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    return c.json(await assignLead(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, c.req.valid('param').id, b.mode, b.memberId));
  })
  .route('/', base);

/* ---------------- статусы ---------------- */

const statusBase = crud({
  entity: 'lead_status',
  table: leadStatuses,
  create: leadStatusCreate,
  update: leadStatusUpdate,
  query: leadStatusQuery,
  sortable: { sortOrder: leadStatuses.sortOrder, name: leadStatuses.name },
  defaultSort: 'sortOrder',
  search: [leadStatuses.name],
  writeRole: 'admin',
  prepareCreate: async (ctx, body) => {
    if (body.sortOrder !== undefined) return {};
    const [r] = await ctx.db.select({ n: count() }).from(leadStatuses);
    return { sortOrder: r?.n ?? 0 };
  },
  prepareUpdate: async (ctx, existing, body) => {
    // в воркспейсе остаются статусы категорий «новый» и «сконвертирован»: на них опираются создание и конвертация
    if (body.category && body.category !== existing.category && ['new', 'converted'].includes(existing.category)) await assertNotLast(ctx, existing.id, existing.category);
    return {};
  },
  beforeDelete: async (ctx, row) => {
    const [used] = await ctx.db.select({ n: count() }).from(leads).where(eq(leads.statusId, row.id));
    if ((used?.n ?? 0) > 0) throw new AppError(409, 'lead_status_in_use', 'The status is used by leads');
    if (['new', 'converted'].includes(row.category)) await assertNotLast(ctx, row.id, row.category);
  },
});

async function assertNotLast(ctx: ReturnType<typeof ctxOf>, id: string, category: string) {
  const [other] = await ctx.db.select({ n: count() }).from(leadStatuses).where(and(eq(leadStatuses.category, category as 'new'), ne(leadStatuses.id, id)));
  if ((other?.n ?? 0) === 0) throw new AppError(422, 'lead_status_last_of_category', `At least one status of the "${category}" category is required`);
}

export const leadStatusRoutes = new Hono<AppEnv>()
  .post('/reorder', requireRole('admin'), zValidator('json', leadStatusReorder, validationHook), async c => {
    const ctx = ctxOf(c);
    const { ids } = c.req.valid('json');
    for (const [i, id] of ids.entries()) await ctx.db.update(leadStatuses).set({ sortOrder: i, updatedAt: new Date() }).where(eq(leadStatuses.id, id));
    return c.json({ ok: true as const });
  })
  .route('/', statusBase);

/* ---------------- формы сайта ---------------- */

type FormRow = typeof leadForms.$inferSelect;
/** В ответе нет секрета: полный токен вебхука отдаётся только admin, остальные видят формы без него */
const publicForm = (ctx: ReturnType<typeof ctxOf>, r: FormRow) => {
  const { token, ...rest } = r;
  return { ...rest, webhookToken: hasRole(ctx.c, 'admin') ? formToken(ctx.workspaceId, token) : '' } as unknown as FormRow;
};

const formBase = crud({
  entity: 'lead_form',
  table: leadForms,
  create: leadFormCreate,
  update: leadFormUpdate,
  query: leadFormQuery,
  sortable: { name: leadForms.name, createdAt: leadForms.createdAt },
  defaultSort: 'createdAt',
  search: [leadForms.name],
  writeRole: 'admin',
  prepareCreate: async (ctx, body) => ({ token: newFormSecret(), source: '', ...(await attributionPatch(ctx, body)) }),
  prepareUpdate: (ctx, existing, body) => attributionPatch(ctx, body, existing),
  decorate: async (ctx, rows) => rows.map(r => publicForm(ctx, r) as FormRow & { webhookToken: string }),
});

export const leadFormRoutes = new Hono<AppEnv>()
  // новый секрет: старый адрес вебхука перестаёт работать
  .post('/:id/rotate', requireRole('admin'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const [row] = await ctx.db.update(leadForms).set({ token: newFormSecret(), updatedAt: new Date() }).where(eq(leadForms.id, c.req.valid('param').id)).returning();
    if (!row) throw new AppError(404, 'not_found', 'Lead form not found');
    return c.json(publicForm(ctx, row));
  })
  .route('/', formBase);
