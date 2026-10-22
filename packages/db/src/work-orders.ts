/* Заказ-наряд (work_order): виды и настраиваемые состояния воркспейса, материалы к списанию, назначения (исполнители — задачи
   модуля services) и главное — проведение заказ-наряда: при входе в состояние категории «done» он сам становится продажей
   (выручка, долг клиента, расход товаров и материалов), частичной отгрузки нет. Выход из «done» отменяет проведение.
   Правила — в docs/architecture.md, раздел «Заказ-наряд: работы, материалы и состояния». */
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  canChangeWorkOrderState,
  dec,
  WORK_ORDER_OPEN_CATEGORIES,
  type DocumentType,
  type WorkOrderStateCategory,
  type WorkOrderStateDef,
} from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { DOCUMENT_CREATED_HOOKS, DOCUMENT_HOOKS, STATE_HOOKS, STATE_PROVIDERS, type StatePayload } from './document-hooks';
import { recordEvent } from './events';
import { applyStockMoves, loadInventorySettings, type MoveRequest } from './stock';
import { documentLines, documents, documentStates, members, products, tasks, warehouses, workOrderAssignments, workOrderKinds, workOrderMaterials, workCenters } from './schema';
import { issueTaskKey } from './modules';
import { ensureModuleProject } from './modules';
import { applyDocumentMoves, postDocument, unpostDocument, type DocCtx, type DocumentRow } from './documents';
import { uuidv7 } from './uuid';

/* ---------------- виды и состояния ---------------- */

/** Состояния вида «Default»: по одному на категорию (миграция и сид создают такой набор) */
export const DEFAULT_WORK_ORDER_STATES: { key: string; label: string; category: WorkOrderStateCategory; color: string }[] = [
  { key: 'new', label: 'New', category: 'new', color: 'gray' },
  { key: 'scheduled', label: 'Scheduled', category: 'scheduled', color: 'blue' },
  { key: 'in_progress', label: 'In progress', category: 'in_progress', color: 'amber' },
  { key: 'done', label: 'Done', category: 'done', color: 'green' },
  { key: 'delivered', label: 'Delivered', category: 'delivered', color: 'teal' },
  { key: 'cancelled', label: 'Cancelled', category: 'cancelled', color: 'red' },
];

/** Создаёт вид заказ-нарядов по умолчанию с набором состояний (для новых воркспейсов; для существующих — миграция) */
export async function ensureWorkOrderKind(db: Db, workspaceId: string): Promise<string> {
  const [found] = await db.select({ id: workOrderKinds.id }).from(workOrderKinds).where(and(eq(workOrderKinds.workspaceId, workspaceId), eq(workOrderKinds.isDefault, true))).limit(1);
  if (found) return found.id;
  const [kind] = await db.insert(workOrderKinds).values({ workspaceId, name: 'Default', isDefault: true, sortOrder: 0 }).returning({ id: workOrderKinds.id });
  await db.insert(documentStates).values(DEFAULT_WORK_ORDER_STATES.map((s, i) => ({ workspaceId, kindId: kind!.id, key: s.key, label: s.label, color: s.color, category: s.category, sortOrder: i })));
  return kind!.id;
}

/** Состояния вида заказ-наряда (по порядку) */
export async function workOrderStates(db: Db, kindId: string): Promise<WorkOrderStateDef[]> {
  const rows = await db.select().from(documentStates).where(eq(documentStates.kindId, kindId)).orderBy(asc(documentStates.sortOrder), asc(documentStates.createdAt));
  return rows.map(r => ({ key: r.key, label: r.label, category: r.category as WorkOrderStateCategory, color: r.color }));
}

/* ---------------- материалы ---------------- */

export interface WorkOrderMaterialView {
  id: string;
  documentId: string;
  productId: string;
  name: string;
  unitCode: string;
  qty: string;
  warehouseId: string | null;
  warehouseName: string | null;
}

/** Материалы заказ-наряда (расход со склада при выполнении) */
export async function listWorkOrderMaterials(db: Db, documentId: string): Promise<WorkOrderMaterialView[]> {
  const rows = await db
    .select({ m: workOrderMaterials, name: products.name, unitCode: products.unitCode, warehouseName: warehouses.name })
    .from(workOrderMaterials)
    .innerJoin(products, eq(products.id, workOrderMaterials.productId))
    .leftJoin(warehouses, eq(warehouses.id, workOrderMaterials.warehouseId))
    .where(eq(workOrderMaterials.documentId, documentId))
    .orderBy(asc(workOrderMaterials.createdAt));
  return rows.map(r => ({ ...r.m, name: r.name, unitCode: r.unitCode, warehouseName: r.warehouseName }));
}

/** Материалы заказ-наряда заменяются списком: существующие по id обновляются, новые добавляются, отсутствующие удаляются */
export async function saveWorkOrderMaterials(db: Db, ctx: DocCtx, documentId: string, inputs: { id?: string; productId: string; qty: string; warehouseId?: string | null }[]): Promise<void> {
  const doc = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc.length) throw new DomainError(404, 'not_found', 'document not found');
  const ids = [...new Set(inputs.map(i => i.productId))];
  const prods = ids.length ? await db.select().from(products).where(inArray(products.id, ids)) : [];
  const byId = new Map(prods.map(p => [p.id, p]));
  const existing = await db.select({ id: workOrderMaterials.id }).from(workOrderMaterials).where(eq(workOrderMaterials.documentId, documentId));
  const existingIds = new Set(existing.map(e => e.id));
  const keep = new Set(inputs.map(i => i.id).filter((x): x is string => !!x));
  const drop = [...existingIds].filter(id => !keep.has(id));
  if (drop.length) await db.delete(workOrderMaterials).where(inArray(workOrderMaterials.id, drop));
  for (const i of inputs) {
    const p = byId.get(i.productId);
    if (!p) throw new DomainError(422, 'invalid_reference', 'A material refers to a product that does not exist');
    if (p.archivedAt) throw new DomainError(422, 'invalid_reference', `Product "${p.name}" is archived`);
    if (p.kind !== 'goods') throw new DomainError(422, 'invalid_material', 'Only goods can be used as materials');
    if (dec(i.qty) <= 0n) throw new DomainError(422, 'invalid_qty', `"${p.name}": the quantity must be greater than zero`);
    const id = i.id ?? uuidv7();
    const values = { productId: p.id, qty: i.qty, unitCode: p.unitCode, warehouseId: i.warehouseId ?? null };
    if (existingIds.has(id)) await db.update(workOrderMaterials).set(values).where(eq(workOrderMaterials.id, id));
    else await db.insert(workOrderMaterials).values({ ...values, id, workspaceId: ctx.workspaceId, documentId });
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: documentId, actorId: ctx.memberId, payload: { changes: { materials: { from: null, to: inputs.length } } } });
}

/* ---------------- назначения (исполнители) ---------------- */

export interface WorkOrderAssignmentView {
  id: string;
  documentId: string;
  taskId: string;
  taskKey: string;
  title: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  lineId: string | null;
  workCenterId: string | null;
  workCenterName: string | null;
  plannedHours: string | null;
  startDate: string | null;
  dueDate: string | null;
}

/** Назначения заказ-наряда: задача модуля services + её исполнитель и сроки */
export async function listWorkOrderAssignments(db: Db, documentId: string): Promise<WorkOrderAssignmentView[]> {
  const rows = await db
    .select({ a: workOrderAssignments, key: tasks.key, title: tasks.title, status: tasks.status, assigneeId: tasks.assigneeId, startDate: tasks.startDate, dueDate: tasks.dueDate, memberName: members.name, centerName: workCenters.name })
    .from(workOrderAssignments)
    .innerJoin(tasks, eq(tasks.id, workOrderAssignments.taskId))
    .leftJoin(members, eq(members.id, tasks.assigneeId))
    .leftJoin(workCenters, eq(workCenters.id, workOrderAssignments.workCenterId))
    .where(eq(workOrderAssignments.documentId, documentId))
    .orderBy(asc(workOrderAssignments.createdAt));
  return rows.map(r => ({
    id: r.a.id,
    documentId: r.a.documentId,
    taskId: r.a.taskId,
    taskKey: r.key,
    title: r.title,
    status: r.status,
    assigneeId: r.assigneeId,
    assigneeName: r.memberName,
    lineId: r.a.lineId,
    workCenterId: r.a.workCenterId,
    workCenterName: r.centerName,
    plannedHours: r.a.plannedHours,
    startDate: r.startDate,
    dueDate: r.dueDate,
  }));
}

export interface AssignmentInput {
  lineId?: string | null;
  assigneeId?: string | null;
  title?: string;
  startDate?: string | null;
  dueDate?: string | null;
  plannedHours?: string | null;
  workCenterId?: string | null;
}

/** Назначение — задача в системном проекте модуля services плюс строка назначения заказ-наряда */
export async function createWorkOrderAssignment(db: Db, ctx: DocCtx, documentId: string, input: AssignmentInput): Promise<{ assignmentId: string; taskId: string; projectId: string }> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  let title = input.title?.trim();
  if (input.lineId) {
    // строка работы должна принадлежать этому заказ-наряду
    const [line] = await db
      .select({ name: documentLines.name, documentId: documentLines.documentId })
      .from(documentLines)
      .where(eq(documentLines.id, input.lineId))
      .limit(1);
    if (!line || line.documentId !== documentId) throw new DomainError(422, 'invalid_reference', 'The line of the work order does not exist');
    if (!title) title = line.name;
  }
  if (!title) throw new DomainError(422, 'invalid_reference', 'Enter the name of the assignment');
  // исполнитель должен быть участником этого воркспейса: чужих участников составной внешний ключ не примет
  if (input.assigneeId) {
    const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, input.assigneeId)).limit(1);
    if (!m) throw new DomainError(422, 'invalid_reference', 'The member does not exist in this workspace');
  }
  if (input.workCenterId) {
    const [w] = await db.select({ id: workCenters.id }).from(workCenters).where(eq(workCenters.id, input.workCenterId)).limit(1);
    if (!w) throw new DomainError(422, 'invalid_reference', 'The work center does not exist');
  }
  const projectId = await ensureModuleProject(db, ctx.workspaceId, 'services');
  const key = await issueTaskKey(db, projectId);
  const [task] = await db
    .insert(tasks)
    .values({
      workspaceId: ctx.workspaceId,
      key,
      projectId,
      module: 'services',
      title,
      status: 'todo',
      assigneeId: input.assigneeId ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      planHours: input.plannedHours ?? null,
      description: `Work order ${doc.number ?? '(draft)'}`,
      createdBy: ctx.memberId,
    })
    .returning({ id: tasks.id });
  const [assignment] = await db
    .insert(workOrderAssignments)
    .values({
      workspaceId: ctx.workspaceId,
      documentId,
      taskId: task!.id,
      lineId: input.lineId ?? null,
      workCenterId: input.workCenterId ?? null,
      plannedHours: input.plannedHours ?? null,
    })
    .returning({ id: workOrderAssignments.id });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'task.created', entity: 'task', recordId: task!.id, actorId: ctx.memberId, payload: { documentId } });
  return { assignmentId: assignment!.id, taskId: task!.id, projectId };
}

/** Правка назначения: строка, участок и плановые часы; остальное — обычными роутами задач */
export async function updateWorkOrderAssignment(db: Db, ctx: DocCtx, taskId: string, patch: AssignmentInput): Promise<void> {
  const [row] = await db.select().from(workOrderAssignments).where(eq(workOrderAssignments.taskId, taskId)).limit(1);
  if (!row) throw new DomainError(404, 'not_found', 'assignment not found');
  if (patch.assigneeId) {
    const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, patch.assigneeId)).limit(1);
    if (!m) throw new DomainError(422, 'invalid_reference', 'The member does not exist in this workspace');
  }
  if (patch.workCenterId) {
    const [w] = await db.select({ id: workCenters.id }).from(workCenters).where(eq(workCenters.id, patch.workCenterId)).limit(1);
    if (!w) throw new DomainError(422, 'invalid_reference', 'The work center does not exist');
  }
  const set: Partial<typeof workOrderAssignments.$inferInsert> = { updatedAt: new Date() };
  if (patch.lineId !== undefined) set.lineId = patch.lineId;
  if (patch.workCenterId !== undefined) set.workCenterId = patch.workCenterId;
  if (patch.plannedHours !== undefined) set.plannedHours = patch.plannedHours;
  await db.update(workOrderAssignments).set(set).where(eq(workOrderAssignments.id, row.id));
  const taskSet: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  if (patch.assigneeId !== undefined) taskSet.assigneeId = patch.assigneeId;
  if (patch.startDate !== undefined) taskSet.startDate = patch.startDate;
  if (patch.dueDate !== undefined) taskSet.dueDate = patch.dueDate;
  if (patch.plannedHours !== undefined) taskSet.planHours = patch.plannedHours;
  await db.update(tasks).set(taskSet).where(eq(tasks.id, taskId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: row.documentId, actorId: ctx.memberId, payload: { changes: { assignment: { from: null, to: taskId } } } });
}

/** Назначение удаляется вместе с задачей-назначением */
export async function deleteWorkOrderAssignment(db: Db, ctx: DocCtx, taskId: string): Promise<void> {
  const [row] = await db.select().from(workOrderAssignments).where(eq(workOrderAssignments.taskId, taskId)).limit(1);
  if (!row) throw new DomainError(404, 'not_found', 'assignment not found');
  await db.delete(tasks).where(eq(tasks.id, taskId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: row.documentId, actorId: ctx.memberId, payload: { changes: { assignment: { from: taskId, to: null } } } });
}

/* ---------------- карточка ---------------- */

export interface WorkOrderDetail {
  kindId: string | null;
  kindName: string | null;
  states: WorkOrderStateDef[];
  materials: WorkOrderMaterialView[];
  assignments: WorkOrderAssignmentView[];
}

/** Данные заказ-наряда поверх карточки документа: вид, состояния, материалы и назначения */
export async function workOrderDetail(db: Db, id: string): Promise<WorkOrderDetail> {
  const [doc] = await db.select({ kindId: documents.workOrderKindId }).from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  const kind = doc.kindId ? (await db.select({ name: workOrderKinds.name }).from(workOrderKinds).where(eq(workOrderKinds.id, doc.kindId)).limit(1))[0] : undefined;
  const states = doc.kindId ? await workOrderStates(db, doc.kindId) : [];
  return {
    kindId: doc.kindId ?? null,
    kindName: kind?.name ?? null,
    states,
    materials: await listWorkOrderMaterials(db, id),
    assignments: await listWorkOrderAssignments(db, id),
  };
}

/* ---------------- проведение заказ-наряда ---------------- */

/** Материалы заказ-наряда списываются со склада при выполнении (движениями самого заказ-наряда) */
async function applyMaterialMoves(db: Db, ctx: DocCtx, doc: DocumentRow): Promise<void> {
  const rows = await db.select().from(workOrderMaterials).where(eq(workOrderMaterials.documentId, doc.id));
  if (!rows.length) return;
  const reqs: MoveRequest[] = [];
  for (const m of rows) {
    const warehouseId = m.warehouseId ?? doc.warehouseId;
    if (!warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse before posting the work order');
    reqs.push({ warehouseId, productId: m.productId, lineId: null, qty: dec(m.qty), direction: 'out' });
  }
  await applyStockMoves(db, ctx.workspaceId, { id: doc.id, date: doc.date }, reqs, await loadInventorySettings(db, ctx.workspaceId));
}

/** Проведение заказ-наряда: товары по строкам уходят со склада, материалы списываются */
DOCUMENT_HOOKS.work_order = {
  post: async (db, ctx, doc, lines) => {
    await applyDocumentMoves(db, ctx, doc, lines);
    await applyMaterialMoves(db, ctx, doc);
  },
};

/** Состояния заказ-наряда задаёт воркспейс: провайдер отдаёт их и проверяет переход */
STATE_PROVIDERS.work_order = {
  states: async (db, _ctx, doc) => {
    if (!doc.workOrderKindId) throw new DomainError(422, 'work_order_kind_required', 'The work order has no kind');
    return workOrderStates(db, doc.workOrderKindId);
  },
  canTransition: (from, to, ctx) => {
    const isAdmin = ctx.role === 'owner' || ctx.role === 'admin';
    if (!to.category) return { ok: false, message: `The state "${to.key}" has no category` };
    if (!canChangeWorkOrderState(from as WorkOrderStateDef | null, to as WorkOrderStateDef, isAdmin)) return { ok: false, message: `Cannot change the state from "${from?.label ?? 'none'}" to "${to.label}"` };
    return { ok: true };
  },
};

/** Смена состояния заказ-наряда: вход в «выполнен» — продажа, выход из него — отмена проведения */
STATE_HOOKS.work_order = async (db, ctx, doc, from, to, payload?: StatePayload) => {
  const states = await workOrderStates(db, doc.workOrderKindId!);
  const fromState = from ? states.find(s => s.key === from) ?? null : null;
  const toState = states.find(s => s.key === to);
  if (!toState) throw new DomainError(422, 'invalid_state', `Unknown state "${to}"`);
  // отмена: причина обязательна (как закладка «Завершение заказа» в 1С)
  if (toState.category === 'cancelled' && !payload?.cancelReason?.trim()) throw new DomainError(422, 'cancel_reason_required', 'Enter the reason for cancelling the work order');
  // причина хранится, пока заказ-наряд отменён; возврат в работу её снимает
  if (toState.category === 'cancelled') await db.update(documents).set({ cancelReason: payload!.cancelReason!.trim() }).where(eq(documents.id, doc.id));
  else if (fromState?.category === 'cancelled') await db.update(documents).set({ cancelReason: null }).where(eq(documents.id, doc.id));
  if (toState.category === 'done') {
    // заказ-наряд сам проводится как продажа: выручка, долг клиента, расход товаров и материалов
    if (doc.status === 'draft') await postDocument(db, ctx, doc.id);
    return;
  }
  // отмена выполненного заказа и возврат назад в работу — проведение снимается
  // (из «выполнен» и из «закрыт» — admin возвращает закрытый заказ-наряд в работу)
  if (doc.status === 'posted' && (toState.category === 'cancelled' || WORK_ORDER_OPEN_CATEGORIES.includes(toState.category))) {
    await unpostDocument(db, ctx, doc.id);
  }
};

/** Создание заказ-наряда: вид по умолчанию и первое состояние категории «new» */

export async function initWorkOrder(db: Db, ctx: DocCtx, doc: DocumentRow): Promise<void> {
  const kindId = doc.workOrderKindId ?? (await ensureWorkOrderKind(db, ctx.workspaceId));
  const states = await workOrderStates(db, kindId);
  const first = states.find(s => s.category === 'new') ?? states[0];
  await db.update(documents).set({ workOrderKindId: kindId, state: doc.state ?? first?.key ?? null, updatedAt: new Date() }).where(eq(documents.id, doc.id));
}

DOCUMENT_CREATED_HOOKS.work_order = initWorkOrder;

/** Заказ-наряд не проводят вручную: его проводит состояние «выполнен» */
export function assertWorkOrderPostingByState(type: DocumentType): void {
  if (type === 'work_order') throw new DomainError(422, 'work_order_state_only', 'A work order is posted when it moves to the Done state');
}
