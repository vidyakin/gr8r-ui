/* Заказ-наряд: журнал и карточка, материалы к списанию, назначения (исполнители), виды заказ-нарядов и их состояния.
   Чтение — любой участник; заказ-наряды и материалы — member и выше, виды и состояния — admin и выше.
   Проведение заказ-наряда делает состояние «выполнен» (см. packages/db/src/work-orders.ts), поэтому здесь нет отдельного «Post». */
import { zValidator } from '@hono/zod-validator';
import { and, count, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  canSeeCost,
  costBrief,
  createWorkOrderAssignment,
  deleteWorkOrderAssignment,
  documentDetail,
  documentStates,
  documents,
  loadWorkOrderCosts,
  saveWorkOrderBilling,
  saveWorkOrderMaterials,
  updateWorkOrderAssignment,
  workOrderCost,
  workOrderDetail,
  workOrderKinds,
  workOrderTime,
} from '@gr8r/db';
import {
  documentStateCreate,
  documentStateQuery,
  documentStateUpdate,
  idParam,
  uuid,
  workOrderAssignmentCreate,
  workOrderAssignmentUpdate,
  workOrderBillingUpdate,
  workOrderKindCreate,
  workOrderKindQuery,
  workOrderKindUpdate,
  workOrderMaterialInput,
} from '@gr8r/shared';
import { crud, ctxOf, validationHook, type Ctx } from '../crud';
import { AppError, notFound } from '../errors';
import { notify } from './helpers';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });
const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => '\\' + m);

/** Журнал заказ-нарядов: фильтры по состоянию, статусу, заказчику и датам */
const listQuery = z.object({
  state: z.string().trim().max(64).optional(),
  status: z.string().trim().max(64).optional(),
  counterpartyId: uuid.optional(),
  kindId: uuid.optional(),
  from: z.string().trim().max(10).optional(),
  to: z.string().trim().max(10).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Материалы заказ-наряда меняются, пока он не выполнен */
async function assertEditable(ctx: Ctx, documentId: string): Promise<void> {
  const [doc] = await ctx.db.select({ status: documents.status, state: documents.state, type: documents.type }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw notFound('work_order');
  if (doc.type !== 'work_order') throw new AppError(422, 'not_work_order', 'This document is not a work order');
  if (doc.status !== 'draft') throw new AppError(409, 'not_draft', 'A posted work order cannot be edited: move it out of the Done state first');
}

export const workOrderRoutes = new Hono<AppEnv>()
  // журнал: заказ-наряды с состоянием, видом и итогами
  .get('/', zValidator('query', listQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const conds: (SQL | undefined)[] = [
      eq(documents.type, 'work_order'),
      q.state ? eq(documents.state, q.state) : undefined,
      q.status ? eq(documents.status, q.status as 'draft' | 'posted' | 'cancelled') : undefined,
      q.counterpartyId ? eq(documents.counterpartyId, q.counterpartyId) : undefined,
      q.kindId ? eq(documents.workOrderKindId, q.kindId) : undefined,
      q.from ? sql`${documents.date} >= ${q.from}` : undefined,
      q.to ? sql`${documents.date} <= ${q.to}` : undefined,
      q.q ? or(ilike(documents.number, `%${escapeLike(q.q)}%`), ilike(documents.comment, `%${escapeLike(q.q)}%`)) : undefined,
    ];
    const where = and(...conds);
    const [{ n }] = await ctx.db.select({ n: count() }).from(documents).where(where);
    const rows = await ctx.db
      .select({ doc: documents, kindName: workOrderKinds.name, stateLabel: documentStates.label, stateColor: documentStates.color, category: documentStates.category })
      .from(documents)
      .leftJoin(workOrderKinds, eq(workOrderKinds.id, documents.workOrderKindId))
      .leftJoin(documentStates, and(eq(documentStates.kindId, documents.workOrderKindId), eq(documentStates.key, documents.state)))
      .where(where)
      .orderBy(desc(documents.date), desc(documents.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    // себестоимость и маржа — только admin и owner (у остальных поля null)
    const costs = canSeeCost(ctx.role) ? await loadWorkOrderCosts(ctx.db, ctx.workspaceId, rows.map(r => r.doc.id)) : null;
    const items = rows.map(({ doc: { custom: _custom, ...doc }, ...r }) => {
      const d = costs?.get(doc.id);
      const brief = d ? costBrief(d) : null;
      return { ...doc, ...r, cost: brief?.cost ?? null, margin: brief?.margin ?? null, marginPct: brief?.marginPct ?? null, costBasis: brief?.basis ?? null };
    });
    const [sum] = await ctx.db
      .select({ net: sql<string>`coalesce(sum(${documents.amountNet}), 0)::text`, vat: sql<string>`coalesce(sum(${documents.vatTotal}), 0)::text`, total: sql<string>`coalesce(sum(${documents.total}), 0)::text` })
      .from(documents)
      .where(and(where, ne(documents.status, 'cancelled')));
    return c.json({ items, total: n, limit: q.limit, offset: q.offset, sum: { net: sum!.net, vat: sum!.vat, total: sum!.total } });
  })
  // карточка: документ + вид, состояния, материалы и назначения
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const detail = await documentDetail(ctx.db, id);
    if (detail.type !== 'work_order') throw notFound('work_order');
    const wo = await workOrderDetail(ctx.db, id);
    return c.json({ ...detail, ...wo });
  })
  // материалы к списанию: список заменяется целиком
  .post('/:id/materials', write, zValidator('param', idParam, validationHook), zValidator('json', z.object({ materials: z.array(workOrderMaterialInput).max(500) }), validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await assertEditable(ctx, id);
    await saveWorkOrderMaterials(ctx.db, docCtx(ctx), id, c.req.valid('json').materials);
    return c.json(await workOrderDetail(ctx.db, id));
  })
  // время по назначениям: план (planned_hours) и факт (time_logs), сводка по исполнителям
  .get('/:id/time', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const [doc] = await ctx.db.select({ type: documents.type }).from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc || doc.type !== 'work_order') throw notFound('work_order');
    return c.json(await workOrderTime(ctx.db, id));
  })
  // себестоимость работ: план и факт по видам, выручка и маржа — только admin и owner
  .get('/:id/cost', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    if (!canSeeCost(ctx.role)) throw new AppError(403, 'cost_access_required', 'The cost is available to the workspace owner and administrators only');
    const id = c.req.valid('param').id;
    const data = await workOrderCost(ctx.db, ctx.workspaceId, id);
    if (!data) throw notFound('work_order');
    return c.json({ documentId: id, status: data.status, state: data.state, indirectMonths: data.indirectMonths, ...data.cost });
  })
  // способ выставления строк работ: по норме или по фактическим часам
  .post('/:id/billing', write, zValidator('param', idParam, validationHook), zValidator('json', workOrderBillingUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await assertEditable(ctx, id);
    await saveWorkOrderBilling(ctx.db, docCtx(ctx), id, c.req.valid('json').lines);
    return c.json(await workOrderTime(ctx.db, id));
  })
  // назначение: задача модуля services на строку работы
  .post('/:id/assignments', write, zValidator('param', idParam, validationHook), zValidator('json', workOrderAssignmentCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await assertEditable(ctx, id);
    const body = c.req.valid('json');
    const { assignmentId, taskId, projectId } = await createWorkOrderAssignment(ctx.db, docCtx(ctx), id, body);
    // исполнитель получает уведомление о назначении (как при обычном назначении задачи)
    await notify(ctx, { to: body.assigneeId ?? null, type: 'assign', text: 'assigned you', snippet: body.title ?? 'Work order assignment', taskId, projectId });
    return c.json(await workOrderDetail(ctx.db, id).then(d => ({ ...d, assignmentId, taskId })), 201);
  });

/** Назначения заказ-наряда: правка и удаление (строка, участок, плановые часы) */
/** Параметр назначения: идентификатор задачи-назначения */
const taskParam = z.object({ taskId: uuid });

export const workOrderAssignmentRoutes = new Hono<AppEnv>()
  .patch('/:taskId', write, zValidator('param', taskParam, validationHook), zValidator('json', workOrderAssignmentUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const taskId = c.req.valid('param').taskId;
    // перегрузка и работа вне смены — предупреждение: план сохраняется
    const { warnings } = await updateWorkOrderAssignment(ctx.db, docCtx(ctx), taskId, c.req.valid('json'));
    return c.json({ id: taskId, updated: true as const, warnings });
  })
  .delete('/:taskId', write, zValidator('param', taskParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const taskId = c.req.valid('param').taskId;
    await deleteWorkOrderAssignment(ctx.db, docCtx(ctx), taskId);
    return c.json({ id: taskId, deleted: true as const });
  });

/* ---------------- виды заказ-нарядов ---------------- */

export const workOrderKindRoutes = crud({
  entity: 'work_order_kind',
  table: workOrderKinds,
  create: workOrderKindCreate,
  update: workOrderKindUpdate,
  query: workOrderKindQuery,
  sortable: { name: workOrderKinds.name, sortOrder: workOrderKinds.sortOrder, createdAt: workOrderKinds.createdAt },
  defaultSort: 'sortOrder',
  search: [workOrderKinds.name],
  writeRole: 'admin',
  prepareCreate: async (ctx, body) => {
    // вид по умолчанию — один на воркспейс: прежний снимается с этого
    if (body.isDefault) await ctx.db.update(workOrderKinds).set({ isDefault: false }).where(eq(workOrderKinds.workspaceId, ctx.workspaceId));
    return { sortOrder: body.sortOrder ?? 0 };
  },
  prepareUpdate: async (ctx, existing, body) => {
    if (body.isDefault === true) await ctx.db.update(workOrderKinds).set({ isDefault: false }).where(and(eq(workOrderKinds.workspaceId, ctx.workspaceId), ne(workOrderKinds.id, existing.id)));
    return {};
  },
  beforeDelete: async (ctx, row) => {
    const [used] = await ctx.db.select({ id: documents.id }).from(documents).where(eq(documents.workOrderKindId, row.id)).limit(1);
    if (used) throw new AppError(409, 'kind_in_use', 'Work orders of this kind exist: delete them first');
    const [states] = await ctx.db.select({ id: documentStates.id }).from(documentStates).where(eq(documentStates.kindId, row.id)).limit(1);
    if (states) throw new AppError(409, 'kind_in_use', 'Delete the states of this kind first');
  },
});

/* ---------------- состояния заказ-наряда ---------------- */

export const documentStateRoutes = crud({
  entity: 'document_state',
  table: documentStates,
  create: documentStateCreate,
  update: documentStateUpdate,
  query: documentStateQuery,
  sortable: { label: documentStates.label, category: documentStates.category, sortOrder: documentStates.sortOrder, createdAt: documentStates.createdAt },
  defaultSort: 'sortOrder',
  search: [documentStates.label, documentStates.key],
  writeRole: 'admin',
  filters: q => [q.kindId ? eq(documentStates.kindId, q.kindId) : undefined],
  prepareCreate: async (ctx, body) => {
    const [kind] = await ctx.db.select({ id: workOrderKinds.id }).from(workOrderKinds).where(eq(workOrderKinds.id, body.kindId)).limit(1);
    if (!kind) throw new AppError(422, 'invalid_reference', 'The kind of the work order does not exist');
    const [same] = await ctx.db.select({ id: documentStates.id }).from(documentStates).where(and(eq(documentStates.kindId, body.kindId), eq(documentStates.key, body.key))).limit(1);
    if (same) throw new AppError(409, 'conflict', 'A state with this key already exists in this kind');
    return { sortOrder: body.sortOrder ?? 0 };
  },
  prepareUpdate: async (ctx, existing, body) => {
    if (body.key && body.key !== existing.key) {
      const [same] = await ctx.db.select({ id: documentStates.id }).from(documentStates).where(and(eq(documentStates.kindId, existing.kindId), eq(documentStates.key, body.key))).limit(1);
      if (same) throw new AppError(409, 'conflict', 'A state with this key already exists in this kind');
    }
    return {};
  },
  beforeDelete: async (ctx, row) => {
    // состояние, на котором есть заказ-наряды, удалить нельзя — документы останутся без состояния
    const [used] = await ctx.db.select({ id: documents.id }).from(documents).where(and(eq(documents.type, 'work_order'), eq(documents.state, row.key), eq(documents.workOrderKindId, row.kindId))).limit(1);
    if (used) throw new AppError(409, 'state_in_use', 'Work orders are in this state: move them to another state first');
    // последнее состояние категории удалять нельзя: категория без состояний ломает логику
    const [same] = await ctx.db
      .select({ id: documentStates.id })
      .from(documentStates)
      .where(and(eq(documentStates.kindId, row.kindId), eq(documentStates.category, row.category), ne(documentStates.id, row.id)))
      .limit(1);
    if (!same) throw new AppError(409, 'last_state_in_category', 'This is the last state of its category: add another one first');
  },
});
