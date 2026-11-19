/* Обращения клиентов (docs/architecture/cases.md): обращения, правила SLA, формы сайта. Логика с записью в БД — сервис `packages/db/src/cases.ts`.
   Приём из почты — `packages/db/src/email-sync.ts`, форма сайта — `routes/hooks.ts`. */
import { zValidator } from '@hono/zod-validator';
import { and, desc, asc, count, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  caseCounts,
  caseForms,
  cases,
  crmActivities,
  createWorkOrderFromCase,
  formToken,
  insertCase,
  listEmails,
  loadCase,
  loadSlaRules,
  newFormSecret,
  replyToCase,
  saveSlaRules,
  updateCase,
} from '@erp/db';
import { caseCreate, caseFormCreate, caseFormQuery, caseFormUpdate, caseQuery, caseReply, caseSlaRulesUpdate, caseUpdate, idParam } from '@erp/shared';
import { crud, ctxOf, validationHook, escapeLike } from '../crud';
import { AppError, notFound } from '../errors';
import { hasRole, requireRole } from '../middleware';
import { customForCreate, customForUpdate } from '../meta/service';
import type { AppEnv } from '../types';

const write = requireRole('member');
const SORTABLE = { createdAt: cases.createdAt, updatedAt: cases.updatedAt, number: cases.number, priority: cases.priority, firstResponseDueAt: cases.firstResponseDueAt, resolveDueAt: cases.resolveDueAt, status: cases.status } as const;
const caseCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });
const mailCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });

/** Открытое обращение с нарушенным сроком: ответа нет, а срок первого ответа прошёл, либо не решено после срока решения */
const overdueSql = (now: Date): SQL =>
  sql`${cases.status} in ('new','in_progress','waiting') and ((${cases.firstRespondedAt} is null and ${cases.firstResponseDueAt} < ${now.toISOString()}::timestamptz) or (${cases.resolvedAt} is null and ${cases.resolveDueAt} < ${now.toISOString()}::timestamptz))`;

export const caseRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', caseQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const conds: (SQL | undefined)[] = [
      q.status ? eq(cases.status, q.status) : undefined,
      q.open === 'true' ? inArray(cases.status, ['new', 'in_progress', 'waiting']) : q.open === 'false' ? inArray(cases.status, ['resolved', 'closed']) : undefined,
      q.priority ? eq(cases.priority, q.priority) : undefined,
      q.ownerId ? eq(cases.ownerId, q.ownerId) : undefined,
      q.channel ? eq(cases.channel, q.channel) : undefined,
      q.companyId ? eq(cases.companyId, q.companyId) : undefined,
      q.contactId ? eq(cases.contactId, q.contactId) : undefined,
      q.overdue === true ? overdueSql(new Date()) : undefined,
      q.q ? or(ilike(cases.subject, `%${escapeLike(q.q)}%`), ilike(cases.number, `%${escapeLike(q.q)}%`), ilike(cases.description, `%${escapeLike(q.q)}%`)) : undefined,
    ];
    const where = and(...conds);
    const sortParts = (q.sort ?? '-createdAt').split(',').filter(Boolean);
    const order: SQL[] = [];
    for (const p of sortParts) {
      const desc_ = p.startsWith('-');
      const col = (SORTABLE as Record<string, (typeof SORTABLE)[keyof typeof SORTABLE]>)[desc_ ? p.slice(1) : p];
      if (!col) throw new AppError(400, 'invalid_sort', `Cannot sort by "${p.replace(/^-/, '')}". Allowed: ${Object.keys(SORTABLE).join(', ')}`);
      order.push(desc_ ? desc(col) : asc(col));
    }
    order.push(desc(cases.id));
    const items = await ctx.db.select().from(cases).where(where).orderBy(...order).limit(q.limit).offset(q.offset);
    const [{ n }] = await ctx.db.select({ n: count() }).from(cases).where(where);
    return c.json({ items, total: n, limit: q.limit, offset: q.offset });
  })
  // счётчики плашек списка: новые, открытые, просрочено
  .get('/summary', async c => c.json(await caseCounts(ctxOf(c).db)))
  .post('/', write, zValidator('json', caseCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    const custom = (await customForCreate(ctx, 'case', b.custom)).custom;
    const row = await insertCase(ctx.db, caseCtx(ctx), { ...b, ...(custom ? { custom } : {}) });
    return c.json(row, 201);
  })
  // обращение с лентой: письма (по правам на ящики) и касания
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const row = await loadCase(ctx.db, id);
    const emails = await listEmails(ctx.db, mailCtx(ctx), { caseId: id }, 200, 0);
    const activities = await ctx.db.select().from(crmActivities).where(eq(crmActivities.caseId, id)).orderBy(desc(crmActivities.createdAt), desc(crmActivities.id)).limit(200);
    return c.json({ ...row, emails, activities });
  })
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', caseUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const { custom: customIn, ...rest } = c.req.valid('json');
    const existing = await loadCase(ctx.db, id);
    const custom = customIn !== undefined ? (await customForUpdate(ctx, 'case', existing.custom, customIn, id)).custom : undefined;
    return c.json(await updateCase(ctx.db, caseCtx(ctx), id, { ...rest, ...(custom ? { custom } : {}) }));
  })
  // заказ-наряд из обращения: контрагент и описание из обращения
  .post('/:id/work-order', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const r = await createWorkOrderFromCase(ctx.db, caseCtx(ctx), c.req.valid('param').id);
    return c.json(r, 201);
  })
  // ответ клиенту письмом через почту (ящик обращения, номер в теме, первый ответ по SLA)
  .post('/:id/reply', write, zValidator('param', idParam, validationHook), zValidator('json', caseReply, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await replyToCase(ctx.db, mailCtx(ctx), c.req.valid('param').id, c.req.valid('json')), 202);
  });

/* ---------------- правила SLA ---------------- */

export const caseSlaRoutes = new Hono<AppEnv>()
  .get('/', async c => c.json(await loadSlaRules(ctxOf(c).db)))
  .put('/', requireRole('admin'), zValidator('json', caseSlaRulesUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await saveSlaRules(ctx.db, ctx.workspaceId, c.req.valid('json')));
  });

/* ---------------- формы сайта ---------------- */

type FormRow = typeof caseForms.$inferSelect;
/** В ответе нет секрета: полный токен вебхука отдаётся только admin */
const publicForm = (ctx: ReturnType<typeof ctxOf>, r: FormRow) => {
  const { token, ...rest } = r;
  return { ...rest, webhookToken: hasRole(ctx.c, 'admin') ? formToken(ctx.workspaceId, token) : '' } as unknown as FormRow;
};

const formBase = crud({
  entity: 'case_form',
  table: caseForms,
  create: caseFormCreate,
  update: caseFormUpdate,
  query: caseFormQuery,
  sortable: { name: caseForms.name, createdAt: caseForms.createdAt },
  defaultSort: 'createdAt',
  search: [caseForms.name],
  writeRole: 'admin',
  prepareCreate: () => ({ token: newFormSecret() }),
  decorate: async (ctx, rows) => rows.map(r => publicForm(ctx, r) as FormRow & { webhookToken: string }),
});

export const caseFormRoutes = new Hono<AppEnv>()
  // новый секрет: старый адрес вебхука перестаёт работать
  .post('/:id/rotate', requireRole('admin'), zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const [row] = await ctx.db.update(caseForms).set({ token: newFormSecret(), updatedAt: new Date() }).where(eq(caseForms.id, c.req.valid('param').id)).returning();
    if (!row) throw notFound('case_form');
    return c.json(publicForm(ctx, row));
  })
  .route('/', formBase);
