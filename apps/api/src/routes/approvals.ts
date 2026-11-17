/* Согласование по маршрутам (задача 1199, docs/architecture/approvals.md). Всё под модулем docflow.
   Маршруты: чтение — все, правка — admin и выше. Отправка, решение и отзыв — member и выше (решает только исполнитель задачи,
   отзывает автор или admin). Проверку «без согласования нельзя» делают POST /documents/:id/post и PATCH /contracts/:id. */
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  approvalDetail,
  approvalsOfObject,
  archiveRoute,
  cancelApproval,
  createRoute,
  decide,
  getRoute,
  listApprovals,
  listRoutes,
  startApproval,
  updateRoute,
  workspaces,
} from '@erp/db';
import { approvalByObjectQuery, approvalCancel, approvalDecide, approvalQuery, approvalRouteCreate, approvalRouteQuery, approvalRouteUpdate, approvalStart, idParam, renderApprovalSheet, type ApprovalSheetData } from '@erp/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { forbidden } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const admin = requireRole('admin');
const docCtx = (c: Ctx) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });
const isAdmin = (c: Ctx) => c.role === 'admin' || c.role === 'owner';

export const approvalRouteRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', approvalRouteQuery, validationHook), async c => c.json({ items: await listRoutes(ctxOf(c).db, { archived: c.req.valid('query').archived === 'true' }) }))
  .get('/:id', zValidator('param', idParam, validationHook), async c => c.json(await getRoute(ctxOf(c).db, c.req.valid('param').id)))
  .post('/', admin, zValidator('json', approvalRouteCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await createRoute(ctx.db, docCtx(ctx), c.req.valid('json') as never), 201);
  })
  .patch('/:id', admin, zValidator('param', idParam, validationHook), zValidator('json', approvalRouteUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await updateRoute(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json') as never));
  })
  // маршрут не удаляется: архивация скрывает его из подбора, процессы и листы хранят снимок
  .delete('/:id', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await archiveRoute(ctx.db, docCtx(ctx), id, true);
    return c.json({ id, deleted: false as const, archived: true as const });
  })
  .post('/:id/restore', admin, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await archiveRoute(ctx.db, docCtx(ctx), id, false);
    return c.json(await getRoute(ctx.db, id));
  });

/** Данные листа согласования для печати */
async function sheetOf(ctx: Ctx, id: string): Promise<{ data: ApprovalSheetData; timezone: string }> {
  const a = await approvalDetail(ctx.db, id);
  const [ws] = await ctx.db.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId)).limit(1);
  const iso = (v: Date | null) => (v ? v.toISOString() : null);
  return {
    timezone: ws?.timezone ?? 'Europe/Moscow',
    data: {
      objectLabel: a.objectLabel,
      routeName: a.routeName,
      round: a.round,
      state: a.state,
      authorName: a.authorName,
      startedAt: a.startedAt.toISOString(),
      finishedAt: iso(a.finishedAt),
      cancelReason: a.cancelReason,
      steps: a.snapshot.steps.map((s, i) => ({
        name: s.name,
        mode: s.mode,
        tasks: a.tasks.filter(t => t.stepIndex === i).map(t => ({ memberName: t.memberName, positionName: t.positionName, state: t.state, decision: t.decision, comment: t.comment, notes: t.notes, decidedAt: iso(t.decidedAt), dueAt: iso(t.dueAt) })),
      })),
    },
  };
}

export const approvalRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', approvalQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    if (q.box === 'all' && !isAdmin(ctx)) throw forbidden('The full list of approvals is for admins');
    const r = await listApprovals(ctx.db, docCtx(ctx), q);
    return c.json({ ...r, limit: q.limit, offset: q.offset });
  })
  // всё о согласовании документа или договора: ворота, идущий процесс, история кругов
  .get('/by-object', zValidator('query', approvalByObjectQuery, validationHook), async c => {
    const q = c.req.valid('query');
    return c.json(await approvalsOfObject(ctxOf(c).db, q.targetKind === 'document' ? { kind: 'document', id: q.documentId! } : { kind: 'contract', id: q.contractId! }));
  })
  .post('/', write, zValidator('json', approvalStart, validationHook), async c => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    const id = await startApproval(ctx.db, docCtx(ctx), b.targetKind === 'document' ? { kind: 'document', id: b.documentId! } : { kind: 'contract', id: b.contractId! });
    return c.json(await approvalDetail(ctx.db, id), 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => c.json(await approvalDetail(ctxOf(c).db, c.req.valid('param').id)))
  .get('/:id/print', zValidator('param', idParam, validationHook), async c => {
    const { data, timezone } = await sheetOf(ctxOf(c), c.req.valid('param').id);
    return c.html(renderApprovalSheet(data, timezone));
  })
  .post('/:id/cancel', write, zValidator('param', idParam, validationHook), zValidator('json', approvalCancel, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await cancelApproval(ctx.db, docCtx(ctx), id, { reason: c.req.valid('json').reason });
    return c.json(await approvalDetail(ctx.db, id));
  });

export const approvalTaskRoutes = new Hono<AppEnv>().post('/:id/decide', write, zValidator('param', idParam, validationHook), zValidator('json', approvalDecide, validationHook), async c => {
  const ctx = ctxOf(c);
  const ap = await decide(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json'));
  return c.json(await approvalDetail(ctx.db, ap.id));
});
