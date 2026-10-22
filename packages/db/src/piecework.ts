/* Операции, исполнители и сдельный наряд.

   Операция — вид номенклатуры (`products.kind = 'operation'`): норма времени на единицу, участок по умолчанию и история
   расценок (в наряд идёт расценка, действующая на дату наряда). Когда операции назначают исполнителя, появляется задача
   модуля production. Выполнение отмечают мастер (рабочее место «Выпуск продукции») и исполнитель (своя задача) — строки
   идут в один наряд исполнителя за день. Проведённый наряд даёт фактическую стоимость работ в себестоимости выпуска.

   Правила — docs/architecture.md, раздел «Операции, исполнители и сдельный наряд». */
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { dec, div, fmt, mul, type Dec } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { DOCUMENT_HOOKS } from './document-hooks';
import { createDocument, type DocCtx } from './documents';
import { recordEvent } from './events';
import { ensureModuleProject } from './modules';
import { recalcPieceworkReleases } from './production';
import { documentLines, documents, manufacturedItems, members, operationRates, operations, pieceworkHeaders, pieceworkLines, productionComponents, productionHeaders, productionItems, productionOperations, products, projects, tasks, workCenters } from './schema';

const today = () => new Date().toISOString().slice(0, 10);

/** Ключ работы: операция (товар каталога) или её текстовое название */
const workKey = (c: { productId: string | null; operation: string }) => c.productId ?? `text:${c.operation}`;

/* ---------------- справочник операций ---------------- */

/** Операции каталога: норма времени, участок по умолчанию и расценки */
export async function listOperations(db: Db, workspaceId: string) {
  const rows = await db
    .select({ product: products, spec: operations })
    .from(products)
    .leftJoin(operations, and(eq(operations.productId, products.id), eq(operations.workspaceId, workspaceId)))
    .where(eq(products.kind, 'operation'))
    .orderBy(asc(products.name));
  const rates = await db.select().from(operationRates).orderBy(asc(operationRates.productId), asc(operationRates.validFrom));
  const byProduct = new Map<string, typeof operationRates.$inferSelect[]>();
  for (const r of rates) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);
  return rows.map(r => ({
    productId: r.product.id,
    name: r.product.name,
    sku: r.product.sku,
    unitCode: r.product.unitCode,
    archived: !!r.product.archivedAt,
    normHours: r.spec?.normHours ?? '0',
    workCenterId: r.spec?.workCenterId ?? null,
    rates: (byProduct.get(r.product.id) ?? []).map(x => ({ id: x.id, validFrom: x.validFrom, rate: x.rate, unit: x.unit })),
  }));
}

/** Операция — товар каталога вида «операция» */
async function assertOperationProduct(db: Db, productId: string): Promise<{ id: string; name: string }> {
  const [p] = await db.select({ id: products.id, name: products.name, kind: products.kind, archivedAt: products.archivedAt }).from(products).where(eq(products.id, productId)).limit(1);
  if (!p || p.archivedAt) throw new DomainError(422, 'invalid_reference', 'The operation does not exist');
  if (p.kind !== 'operation') throw new DomainError(422, 'not_operation', 'Only a product of the "operation" kind can be an operation');
  return p;
}

/** Норма времени и участок по умолчанию операции */
export async function setOperationSpec(db: Db, ctx: DocCtx, input: { productId: string; normHours: string; workCenterId?: string | null }): Promise<void> {
  await assertOperationProduct(db, input.productId);
  if (input.workCenterId) {
    const [wc] = await db.select({ id: workCenters.id }).from(workCenters).where(eq(workCenters.id, input.workCenterId)).limit(1);
    if (!wc) throw new DomainError(422, 'invalid_reference', 'The work center does not exist');
  }
  await db
    .insert(operations)
    .values({ workspaceId: ctx.workspaceId, productId: input.productId, normHours: input.normHours, workCenterId: input.workCenterId ?? null })
    .onConflictDoUpdate({ target: [operations.workspaceId, operations.productId], set: { normHours: input.normHours, workCenterId: input.workCenterId ?? null, updatedAt: new Date() } });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'operation.updated', entity: 'operation', recordId: input.productId, actorId: ctx.memberId, payload: { productId: input.productId } });
}

/** Новая расценка операции: история с датой начала действия */
export async function addOperationRate(db: Db, ctx: DocCtx, input: { productId: string; validFrom: string; rate: string; unit: 'per_unit' | 'per_hour' }): Promise<string> {
  await assertOperationProduct(db, input.productId);
  const [row] = await db
    .insert(operationRates)
    .values({ workspaceId: ctx.workspaceId, productId: input.productId, validFrom: input.validFrom, rate: input.rate, unit: input.unit })
    .returning({ id: operationRates.id });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'operation_rate.created', entity: 'operation_rate', recordId: row!.id, actorId: ctx.memberId, payload: { productId: input.productId, rate: input.rate, validFrom: input.validFrom } });
  return row!.id;
}

/** История расценок операции */
export async function listOperationRates(db: Db, productId?: string) {
  const rows = await db.select().from(operationRates).where(productId ? eq(operationRates.productId, productId) : undefined).orderBy(asc(operationRates.productId), desc(operationRates.validFrom));
  const names = new Map((await db.select({ id: products.id, name: products.name }).from(products)).map(p => [p.id, p.name]));
  return rows.map(r => ({ ...r, name: names.get(r.productId) ?? '' }));
}

/** Расценка, действующая на дату: последняя с датой начала не позже указанной */
export async function rateOnDate(db: Db, productId: string, date: string): Promise<{ rate: string; unit: 'per_unit' | 'per_hour' } | null> {
  const [row] = await db
    .select({ rate: operationRates.rate, unit: operationRates.unit })
    .from(operationRates)
    .where(and(eq(operationRates.productId, productId), sql`${operationRates.validFrom} <= ${date}::date`))
    .orderBy(desc(operationRates.validFrom))
    .limit(1);
  return row ? { rate: row.rate, unit: row.unit } : null;
}

/* ---------------- назначения операций ---------------- */

/** Назначение операции исполнителю */
export interface AssignmentInput {
  /** Строка состава — работа */
  componentId: string;
  /** Исполнитель */
  memberId: string;
  /** Назначенное количество (в единицах продукции) */
  qty: string;
}

/** Назначения операций заказа: сумма по операции не больше количества позиции заказа */
export async function assignOperations(db: Db, ctx: DocCtx, orderId: string, inputs: AssignmentInput[]): Promise<void> {
  const [order] = await db.select().from(documents).where(eq(documents.id, orderId)).limit(1);
  if (!order) throw new DomainError(404, 'not_found', 'document not found');
  if (order.type !== 'production_order') throw new DomainError(422, 'invalid_type', 'This is not a production order');
  if (order.status === 'cancelled') throw new DomainError(409, 'invalid_status', 'A cancelled order cannot be changed');
  // назначение исполнителя можно и после проведения заказа: сам состав не меняется
  const components = await db.select().from(productionComponents).where(eq(productionComponents.documentId, orderId));
  const byComponent = new Map(components.map(c => [c.id, c]));
  const items = await db.select().from(productionItems).where(eq(productionItems.documentId, orderId));
  const itemQty = new Map(items.map(i => [i.id, dec(i.qty)]));
  // проверки: работа заказа, исполнитель и сумма назначений
  const sum = new Map<string, Dec>();
  for (const a of inputs) {
    const c = byComponent.get(a.componentId);
    if (!c || c.kind !== 'work') throw new DomainError(422, 'invalid_reference', 'The line is not a work operation of this order');
    if (!c.productId) throw new DomainError(422, 'operation_required', 'The work line has no operation: choose an operation for it first');
    if (dec(a.qty) <= 0n) throw new DomainError(422, 'invalid_quantity', 'The quantity must be greater than zero');
    const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, a.memberId)).limit(1);
    if (!m) throw new DomainError(422, 'invalid_reference', 'The member does not exist');
    sum.set(c.id, (sum.get(c.id) ?? 0n) + dec(a.qty));
  }
  for (const [componentId, total] of sum) {
    const c = byComponent.get(componentId)!;
    const limit = itemQty.get(c.itemId ?? '') ?? 0n;
    if (total > limit) throw new DomainError(422, 'operation_over_assigned', `The operation is assigned more than the ordered quantity: ${fmt(total, 3)} of ${fmt(limit, 3)}`);
  }
  // прежние назначения: те, которых нет в новом списке, снимаются (задача архивируется)
  const current = await db.select().from(productionOperations).where(eq(productionOperations.documentId, orderId));
  const wanted = new Set(inputs.map(a => `${a.componentId}:${a.memberId}`));
  for (const c of current) {
    if (wanted.has(`${c.componentId}:${c.memberId}`)) continue;
    if (c.taskId) await db.update(tasks).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, c.taskId));
    await db.delete(productionOperations).where(eq(productionOperations.id, c.id));
  }
  // новые и оставшиеся назначения
  const [header] = await db.select().from(productionHeaders).where(eq(productionHeaders.documentId, orderId)).limit(1);
  for (const a of inputs) {
    const c = byComponent.get(a.componentId)!;
    const item = items.find(i => i.id === c.itemId);
    const plannedHours = mul(div(dec(c.hours), itemQty.get(c.itemId!) ?? dec('1')), dec(a.qty));
    const existing = current.find(x => x.componentId === a.componentId && x.memberId === a.memberId);
    if (existing) {
      await db.update(productionOperations).set({ plannedQty: a.qty, plannedHours: fmt(plannedHours, 3) }).where(eq(productionOperations.id, existing.id));
      continue;
    }
    const [row] = await db
      .insert(productionOperations)
      .values({
        workspaceId: ctx.workspaceId,
        documentId: orderId,
        itemId: c.itemId!,
        componentId: c.id,
        operationId: c.productId,
        memberId: a.memberId,
        stageId: c.stageId,
        workCenterId: c.workCenterId,
        plannedQty: a.qty,
        plannedHours: fmt(plannedHours, 3),
      })
      .returning();
    const taskId = await createOperationTask(db, ctx, {
      orderId,
      orderNumber: order.number,
      memberId: a.memberId,
      operationName: c.operation || 'Operation',
      operationId: row!.id,
      productName: item ? await itemName(db, item.itemId) : '',
      qty: a.qty,
      hours: fmt(plannedHours, 3),
      workCenterId: c.workCenterId,
      dueDate: header?.plannedEnd ? new Date(header.plannedEnd).toISOString().slice(0, 10) : null,
    });
    await db.update(productionOperations).set({ taskId }).where(eq(productionOperations.id, row!.id));
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: orderId, actorId: ctx.memberId, payload: { changes: ['assignments'] } });
}

/** Название продукции позиции заказа */
async function itemName(db: Db, itemId: string): Promise<string> {
  const [row] = await db
    .select({ name: manufacturedItems.name })
    .from(productionItems)
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionItems.itemId))
    .where(eq(productionItems.id, itemId))
    .limit(1);
  return row?.name ?? '';
}

/** Задача исполнителя: операция в модуле production */
async function createOperationTask(
  db: Db,
  ctx: DocCtx,
  input: { orderId: string; orderNumber: string | null; memberId: string; operationName: string; operationId: string; productName: string; qty: string; hours: string; workCenterId: string | null; dueDate: string | null },
): Promise<string> {
  const projectId = await ensureModuleProject(db, ctx.workspaceId, 'production');
  const [p] = await db
    .update(projects)
    .set({ taskCounter: sql`${projects.taskCounter} + 1` })
    .where(eq(projects.id, projectId))
    .returning({ key: projects.key, n: projects.taskCounter });
  const [center] = input.workCenterId ? await db.select({ name: workCenters.name }).from(workCenters).where(eq(workCenters.id, input.workCenterId)).limit(1) : [];
  const title = input.productName ? `${input.operationName} — ${input.productName}` : input.operationName;
  const description = [
    `Production order: ${input.orderNumber ?? input.orderId}`,
    `Operation: ${input.operationName}`,
    `Quantity: ${input.qty}`,
    `Hours: ${input.hours}`,
    center ? `Work center: ${center.name}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const [task] = await db
    .insert(tasks)
    .values({
      workspaceId: ctx.workspaceId,
      key: `${p!.key}-${p!.n}`,
      projectId,
      module: 'production',
      title,
      status: 'todo',
      assigneeId: input.memberId,
      dueDate: input.dueDate,
      description,
      custom: { productionOperationId: input.operationId },
      createdBy: ctx.memberId,
    })
    .returning({ id: tasks.id });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'task.created', entity: 'task', recordId: task!.id, actorId: ctx.memberId, payload: { title } });
  return task!.id;
}

/** Назначения операций заказа: кто и сколько выполняет операцию */
export async function listOrderOperations(db: Db, orderId: string) {
  const rows = await db.select().from(productionOperations).where(eq(productionOperations.documentId, orderId)).orderBy(asc(productionOperations.sortOrder), asc(productionOperations.createdAt));
  return describeAssignments(db, rows);
}

/** Одно назначение операции */
export async function getOperationAssignment(db: Db, id: string) {
  const [row] = await db.select().from(productionOperations).where(eq(productionOperations.id, id)).limit(1);
  if (!row) return null;
  const [one] = await describeAssignments(db, [row]);
  return one ?? null;
}

/** Назначения в читаемом виде: исполнитель, операция, задача и остаток работы */
async function describeAssignments(db: Db, rows: (typeof productionOperations.$inferSelect)[]) {
  if (!rows.length) return [];
  const memberIds = [...new Set(rows.map(r => r.memberId))];
  const names = new Map((await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, memberIds))).map(m => [m.id, m.name]));
  const operationIds = [...new Set(rows.map(r => r.operationId).filter((x): x is string => !!x))];
  const operations_ = new Map((await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, operationIds))).map(p => [p.id, p.name]));
  const components = new Map((await db.select().from(productionComponents).where(inArray(productionComponents.id, rows.map(r => r.componentId)))).map(c => [c.id, c]));
  const taskIds = rows.map(r => r.taskId).filter((x): x is string => !!x);
  const taskRows = taskIds.length ? await db.select({ id: tasks.id, status: tasks.status, key: tasks.key }).from(tasks).where(inArray(tasks.id, taskIds)) : [];
  const taskById = new Map(taskRows.map(t => [t.id, t]));
  // сколько ещё в черновиках нарядов (не проведено)
  const drafts = await db
    .select({ assignmentId: pieceworkLines.assignmentId, qty: sql<string>`sum(${pieceworkLines.qty})` })
    .from(pieceworkLines)
    .innerJoin(documents, eq(documents.id, pieceworkLines.documentId))
    .where(and(inArray(pieceworkLines.assignmentId, rows.map(r => r.id)), eq(documents.status, 'draft')))
    .groupBy(pieceworkLines.assignmentId);
  const draftBy = new Map(drafts.map(d => [d.assignmentId!, dec(d.qty)]));
  return rows.map(r => {
    const c = components.get(r.componentId);
    const draft = draftBy.get(r.id) ?? 0n;
    const left = dec(r.plannedQty) - dec(r.doneQty) - draft;
    return {
      id: r.id,
      componentId: r.componentId,
      itemId: r.itemId,
      operationId: r.operationId,
      operationName: r.operationId ? (operations_.get(r.operationId) ?? '') : (c?.operation ?? ''),
      memberId: r.memberId,
      memberName: names.get(r.memberId) ?? '',
      taskId: r.taskId,
      taskKey: r.taskId ? (taskById.get(r.taskId)?.key ?? null) : null,
      taskStatus: r.taskId ? (taskById.get(r.taskId)?.status ?? null) : null,
      stageId: r.stageId,
      workCenterId: r.workCenterId,
      plannedQty: fmt(dec(r.plannedQty), 3),
      plannedHours: fmt(dec(r.plannedHours), 3),
      doneQty: fmt(dec(r.doneQty), 3),
      draftQty: fmt(draft, 3),
      leftQty: fmt(left > 0n ? left : 0n, 3),
    };
  });
}

/** Назначения операций по документу-основанию: заказ на производство, выпуск или заказ покупателя.
    По ним создаются наряды исполнителям (ввод на основании, как в 1С). */
export async function assignmentsOfDocument(db: Db, documentId: string): Promise<(typeof productionOperations.$inferSelect)[]> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  if (doc.type === 'production_order') return db.select().from(productionOperations).where(eq(productionOperations.documentId, documentId));
  if (doc.type === 'production') {
    // выпуск: назначения его позиций заказа
    const items = await db.select().from(productionItems).where(eq(productionItems.documentId, documentId));
    const sourceIds = items.map(i => i.sourceItemId).filter((x): x is string => !!x);
    if (!sourceIds.length) return [];
    return db.select().from(productionOperations).where(inArray(productionOperations.itemId, sourceIds));
  }
  if (doc.type === 'customer_order') {
    // заказ покупателя: назначения закрывающих его заказов на производство
    const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, documentId));
    const lineIds = lines.map(l => l.id);
    if (!lineIds.length) return [];
    const items = await db.select().from(productionItems).where(inArray(productionItems.customerOrderLineId, lineIds));
    const orderIds = [...new Set(items.map(i => i.documentId))];
    if (!orderIds.length) return [];
    return db.select().from(productionOperations).where(inArray(productionOperations.documentId, orderIds));
  }
  throw new DomainError(422, 'invalid_type', 'A piecework order can be created from a production order, a release or a customer order');
}

/** Наряд на основании документа: остаток работы каждого исполнителя попадает в наряд за день */
export async function createPieceworkFromDocument(db: Db, ctx: DocCtx, input: { documentId: string; date?: string }): Promise<string[]> {
  const assignments = await assignmentsOfDocument(db, input.documentId);
  if (!assignments.length) throw new DomainError(422, 'no_operations', 'The document has no operations with executors');
  const date = input.date ?? today();
  const docs: string[] = [];
  for (const a of assignments) {
    const left = await assignmentLeft(db, a.id);
    if (left <= 0n) continue;
    const res = await markOperationDone(db, ctx, { assignmentId: a.id, qty: fmt(left, 3), date });
    docs.push(res.documentId);
  }
  if (!docs.length) throw new DomainError(422, 'nothing_to_create', 'All the operations of this document are already done');
  return [...new Set(docs)];
}

/* ---------------- сдельный наряд ---------------- */
/** Наряд исполнителя за дату: один документ на (исполнитель, дата) */
async function findDayDocument(db: Db, memberId: string, date: string): Promise<string | null> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(pieceworkHeaders, eq(pieceworkHeaders.documentId, documents.id))
    .where(and(eq(documents.type, 'piecework_order'), eq(pieceworkHeaders.memberId, memberId), eq(documents.date, date), sql`${documents.status} <> 'cancelled'`))
    .orderBy(asc(documents.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Строка наряда: операция, расценка на дату и сумма */
export interface PieceworkLineInput {
  /** Id строки (при правке наряда сохраняется) */
  id?: string;
  operationId: string;
  productId?: string | null;
  orderDocumentId?: string | null;
  releaseDocumentId?: string | null;
  assignmentId?: string | null;
  /** Строка состава выпуска (работа) */
  componentId?: string | null;
  planQty?: string;
  qty: string;
  hours?: string;
  rate?: string;
}

/** Создание наряда: шапка и строки */
export async function createPieceworkOrder(db: Db, ctx: DocCtx, input: { date?: string; memberId: string; workCenterId?: string | null; comment?: string; lines: PieceworkLineInput[] }): Promise<string> {
  if (!input.lines.length) throw new DomainError(422, 'no_lines', 'Add at least one line to the piecework order');
  const date = input.date ?? today();
  const docId = await createDayDocument(db, ctx, { date, memberId: input.memberId, workCenterId: input.workCenterId, comment: input.comment });
  await writeLines(db, ctx, docId, date, input.lines);
  return docId;
}

/** Наряд исполнителя за дату: шапка документа (без строк) */
async function createDayDocument(db: Db, ctx: DocCtx, input: { date: string; memberId: string; workCenterId?: string | null; comment?: string }): Promise<string> {
  const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, input.memberId)).limit(1);
  if (!m) throw new DomainError(422, 'invalid_reference', 'The member does not exist');
  const docId = await createDocument(db, ctx, {
    type: 'piecework_order',
    organizationId: null,
    date: input.date,
    comment: input.comment ?? '',
    responsibleId: input.memberId,
    lines: [],
  });
  await db.insert(pieceworkHeaders).values({ workspaceId: ctx.workspaceId, documentId: docId, memberId: input.memberId, workCenterId: input.workCenterId ?? null });
  return docId;
}

/** Строки наряда: расценка на дату и сумма считаются сервером */
async function writeLines(db: Db, ctx: DocCtx, docId: string, date: string, lines: PieceworkLineInput[]): Promise<void> {
  await db.delete(pieceworkLines).where(eq(pieceworkLines.documentId, docId));
  const rows: (typeof pieceworkLines.$inferInsert)[] = [];
  for (const [i, l] of lines.entries()) {
    const op = await assertOperationProduct(db, l.operationId);
    // расценка на дату наряда; заданную вручную сумму берём с тем же способом расчёта
    const current = (await rateOnDate(db, l.operationId, date)) ?? { rate: '0', unit: 'per_unit' as const };
    const rate = { rate: l.rate !== undefined ? l.rate : current.rate, unit: current.unit };
    const hours = l.hours ?? '0';
    const amount = rate.unit === 'per_hour' ? mul(dec(hours), dec(rate.rate)) : mul(dec(l.qty), dec(rate.rate));
    rows.push({
      ...(l.id ? { id: l.id } : {}),
      workspaceId: ctx.workspaceId,
      documentId: docId,
      operationId: op.id,
      productId: l.productId ?? null,
      orderDocumentId: l.orderDocumentId ?? null,
      releaseDocumentId: l.releaseDocumentId ?? null,
      assignmentId: l.assignmentId ?? null,
      componentId: l.componentId ?? null,
      planQty: l.planQty ?? '0',
      qty: l.qty,
      hours,
      rate: rate.rate,
      unit: rate.unit,
      amount: fmt(amount, 2),
      sortOrder: i,
    });
  }
  if (rows.length) await db.insert(pieceworkLines).values(rows);
  await updateTotal(db, docId);
}

/** Итог наряда — сумма строк */
async function updateTotal(db: Db, docId: string): Promise<void> {
  const [row] = await db.select({ amount: sql<string>`coalesce(sum(${pieceworkLines.amount}), 0)` }).from(pieceworkLines).where(eq(pieceworkLines.documentId, docId));
  const total = fmt(dec(row?.amount ?? '0'), 2);
  await db.update(documents).set({ total, amountNet: total, vatTotal: '0.00', updatedAt: new Date() }).where(eq(documents.id, docId));
}

/** Правка наряда до проведения: строки и сумма */
export async function updatePieceworkOrder(db: Db, ctx: DocCtx, id: string, patch: { date?: string; comment?: string; lines?: (PieceworkLineInput & { id?: string })[] }): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1).for('update');
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  if (doc.type !== 'piecework_order') throw new DomainError(422, 'invalid_type', 'This is not a piecework order');
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  if (patch.comment !== undefined) await db.update(documents).set({ comment: patch.comment, updatedAt: new Date() }).where(eq(documents.id, id));
  if (patch.lines) {
    const date = patch.date ?? doc.date;
    if (patch.date) await db.update(documents).set({ date, updatedAt: new Date() }).where(eq(documents.id, id));
    await writeLines(db, ctx, id, date, patch.lines);
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(patch) } });
}

/** Карточка наряда: шапка, строки и исполнитель */
export async function pieceworkDetail(db: Db, id: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  if (doc.type !== 'piecework_order') throw new DomainError(422, 'invalid_type', 'This is not a piecework order');
  const [header] = await db.select().from(pieceworkHeaders).where(eq(pieceworkHeaders.documentId, id)).limit(1);
  const lines = await db.select().from(pieceworkLines).where(eq(pieceworkLines.documentId, id)).orderBy(asc(pieceworkLines.sortOrder), asc(pieceworkLines.createdAt));
  const operationIds = [...new Set(lines.map(l => l.operationId))];
  const names = new Map((await db.select({ id: products.id, name: products.name, sku: products.sku }).from(products).where(inArray(products.id, operationIds))).map(p => [p.id, p]));
  const [member] = header?.memberId ? await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.id, header.memberId)).limit(1) : [];
  const [center] = header?.workCenterId ? await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(eq(workCenters.id, header.workCenterId)).limit(1) : [];
  const releaseIds = [...new Set(lines.map(l => l.releaseDocumentId).filter((x): x is string => !!x))];
  const orderIds = [...new Set(lines.map(l => l.orderDocumentId).filter((x): x is string => !!x))];
  const numbers = new Map(
    (
      await db
        .select({ id: documents.id, number: documents.number })
        .from(documents)
        .where(inArray(documents.id, [...releaseIds, ...orderIds]))
    ).map(d => [d.id, d.number]),
  );
  return {
    ...doc,
    memberId: header?.memberId ?? null,
    member: member ?? null,
    workCenter: center ?? null,
    lines: lines.map(l => ({
      ...l,
      operationName: names.get(l.operationId)?.name ?? '',
      operationSku: names.get(l.operationId)?.sku ?? '',
      orderNumber: l.orderDocumentId ? (numbers.get(l.orderDocumentId) ?? null) : null,
      releaseNumber: l.releaseDocumentId ? (numbers.get(l.releaseDocumentId) ?? null) : null,
    })),
  };
}

/** Журнал нарядов */
export async function listPieceworkOrders(db: Db, filters: { memberId?: string; from?: string; to?: string; status?: string; limit: number; offset: number }) {
  const rows = await db
    .select({ doc: documents, header: pieceworkHeaders })
    .from(documents)
    .innerJoin(pieceworkHeaders, eq(pieceworkHeaders.documentId, documents.id))
    .where(
      and(
        eq(documents.type, 'piecework_order'),
        filters.memberId ? eq(pieceworkHeaders.memberId, filters.memberId) : undefined,
        filters.from ? sql`${documents.date} >= ${filters.from}::date` : undefined,
        filters.to ? sql`${documents.date} <= ${filters.to}::date` : undefined,
        filters.status ? eq(documents.status, filters.status as 'draft' | 'posted' | 'cancelled') : undefined,
      ),
    )
    .orderBy(desc(documents.date), desc(documents.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);
  const ids = rows.map(r => r.doc.id);
  const memberIds = [...new Set(rows.map(r => r.header.memberId))];
  const names = new Map((await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, memberIds))).map(m => [m.id, m.name]));
  const totals = ids.length
    ? await db.select({ documentId: pieceworkLines.documentId, amount: sql<string>`coalesce(sum(${pieceworkLines.amount}), 0)`, qty: sql<string>`coalesce(sum(${pieceworkLines.qty}), 0)` }).from(pieceworkLines).where(inArray(pieceworkLines.documentId, ids)).groupBy(pieceworkLines.documentId)
    : [];
  const byDoc = new Map(totals.map(t => [t.documentId, t]));
  const counts = ids.length
    ? await db.select({ documentId: pieceworkLines.documentId, n: sql<number>`count(*)` }).from(pieceworkLines).where(inArray(pieceworkLines.documentId, ids)).groupBy(pieceworkLines.documentId)
    : [];
  const countByDoc = new Map(counts.map(t => [t.documentId, Number(t.n)]));
  const count = await db
    .select({ n: sql<number>`count(*)` })
    .from(documents)
    .innerJoin(pieceworkHeaders, eq(pieceworkHeaders.documentId, documents.id))
    .where(
      and(
        eq(documents.type, 'piecework_order'),
        filters.memberId ? eq(pieceworkHeaders.memberId, filters.memberId) : undefined,
        filters.from ? sql`${documents.date} >= ${filters.from}::date` : undefined,
        filters.to ? sql`${documents.date} <= ${filters.to}::date` : undefined,
        filters.status ? eq(documents.status, filters.status as 'draft' | 'posted' | 'cancelled') : undefined,
      ),
    );
  return {
    items: rows.map(r => ({
      ...r.doc,
      memberId: r.header.memberId,
      memberName: names.get(r.header.memberId) ?? '',
      amount: fmt(dec(byDoc.get(r.doc.id)?.amount ?? '0'), 2),
      qty: fmt(dec(byDoc.get(r.doc.id)?.qty ?? '0'), 3),
      lineCount: countByDoc.get(r.doc.id) ?? 0,
    })),
    total: Number(count[0]?.n ?? 0),
  };
}

/* ---------------- отметка выполнения ---------------- */

/** Отметка выполнения операции: мастер (рабочее место) или исполнитель (своя задача).
    Строка дописывается в наряд исполнителя за день. */
export async function markOperationDone(
  db: Db,
  ctx: DocCtx,
  input: { assignmentId: string; qty: string; date?: string; releaseDocumentId?: string | null },
): Promise<{ documentId: string; lineId: string }> {
  const [assignment] = await db.select().from(productionOperations).where(eq(productionOperations.id, input.assignmentId)).limit(1);
  if (!assignment) throw new DomainError(404, 'not_found', 'The operation assignment does not exist');
  const date = input.date ?? today();
  const qty = dec(input.qty);
  if (qty <= 0n) throw new DomainError(422, 'invalid_quantity', 'The quantity must be greater than zero');
  // отметить может исполнитель или мастер
  const isAssignee = ctx.memberId === assignment.memberId;
  const isMaster = ctx.role === 'admin' || ctx.role === 'owner';
  if (!isAssignee && !isMaster) throw new DomainError(422, 'not_executor', 'Only the executor or a manager can mark the operation as done');
  // сколько уже выполнено: проведённые наряды и черновики
  const [posted] = await db
    .select({ qty: sql<string>`coalesce(sum(${pieceworkLines.qty}), 0)` })
    .from(pieceworkLines)
    .innerJoin(documents, eq(documents.id, pieceworkLines.documentId))
    .where(and(eq(pieceworkLines.assignmentId, assignment.id), eq(documents.status, 'posted')));
  const [draft] = await db
    .select({ qty: sql<string>`coalesce(sum(${pieceworkLines.qty}), 0)` })
    .from(pieceworkLines)
    .innerJoin(documents, eq(documents.id, pieceworkLines.documentId))
    .where(and(eq(pieceworkLines.assignmentId, assignment.id), eq(documents.status, 'draft')));
  const left = dec(assignment.plannedQty) - dec(posted?.qty ?? '0') - dec(draft?.qty ?? '0');
  if (qty > left) throw new DomainError(422, 'operation_over_executed', `Only ${fmt(left > 0n ? left : 0n, 3)} of ${fmt(dec(assignment.plannedQty), 3)} is left to do`);
  // строка состава заказа: норма времени на единицу
  const [component] = await db.select().from(productionComponents).where(eq(productionComponents.id, assignment.componentId)).limit(1);
  const [item] = await db.select().from(productionItems).where(eq(productionItems.id, assignment.itemId)).limit(1);
  const hoursPerUnit = component && item ? div(dec(component.hours), dec(item.qty)) : 0n;
  const hours = fmt(mul(hoursPerUnit, qty), 3);
  // выпуск, к которому относится работа: строка состава выпуска
  let componentId: string | null = null;
  if (input.releaseDocumentId) componentId = await resolveReleaseComponent(db, input.releaseDocumentId, assignment);
  // наряд исполнителя за день
  let docId = await findDayDocument(db, assignment.memberId, date);
  if (!docId) docId = await createDayDocument(db, ctx, { date, memberId: assignment.memberId, workCenterId: assignment.workCenterId });
  const [doc] = await db.select().from(documents).where(eq(documents.id, docId)).limit(1);
  if (doc?.status !== 'draft') throw new DomainError(409, 'not_draft', 'The piecework order of that day is already posted');
  // дописывание: та же операция в том же наряде — строка увеличивается
  const [same] = await db
    .select()
    .from(pieceworkLines)
    .where(and(eq(pieceworkLines.documentId, docId), eq(pieceworkLines.assignmentId, assignment.id)))
    .limit(1);
  const rate = (await rateOnDate(db, assignment.operationId ?? '', date)) ?? { rate: '0', unit: 'per_unit' as const };
  const unit = rate.unit;
  const lineRate = rate.rate;
  if (same) {
    const newQty = dec(same.qty) + qty;
    const newHours = dec(same.hours) + dec(hours);
    const amount = unit === 'per_hour' ? mul(newHours, dec(lineRate)) : mul(newQty, dec(lineRate));
    await db
      .update(pieceworkLines)
      .set({ qty: fmt(newQty, 3), hours: fmt(newHours, 3), amount: fmt(amount, 2), releaseDocumentId: input.releaseDocumentId ?? same.releaseDocumentId, componentId: componentId ?? same.componentId })
      .where(eq(pieceworkLines.id, same.id));
    await updateTotal(db, docId);
    return { documentId: docId, lineId: same.id };
  }
  const [row] = await db
    .insert(pieceworkLines)
    .values({
      workspaceId: ctx.workspaceId,
      documentId: docId,
      operationId: assignment.operationId!,
      orderDocumentId: assignment.documentId,
      releaseDocumentId: input.releaseDocumentId ?? null,
      assignmentId: assignment.id,
      componentId,
      planQty: assignment.plannedQty,
      qty: fmt(qty, 3),
      hours,
      rate: lineRate,
      unit,
      amount: fmt(unit === 'per_hour' ? mul(dec(hours), dec(lineRate)) : mul(qty, dec(lineRate)), 2),
    })
    .returning({ id: pieceworkLines.id });
  await updateTotal(db, docId);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: docId, actorId: ctx.memberId, payload: { changes: ['lines'] } });
  return { documentId: docId, lineId: row!.id };
}

/** Строка состава выпуска, соответствующая назначению операции */
async function resolveReleaseComponent(db: Db, releaseId: string, assignment: typeof productionOperations.$inferSelect): Promise<string | null> {
  const [release] = await db.select().from(documents).where(eq(documents.id, releaseId)).limit(1);
  if (!release || release.type !== 'production') return null;
  const items = await db.select().from(productionItems).where(eq(productionItems.documentId, releaseId));
  const item = items.find(i => i.sourceItemId === assignment.itemId);
  if (!item) return null;
  const components = await db.select().from(productionComponents).where(and(eq(productionComponents.documentId, releaseId), eq(productionComponents.itemId, item.id), eq(productionComponents.kind, 'work')));
  const [orderComponent] = await db.select().from(productionComponents).where(eq(productionComponents.id, assignment.componentId)).limit(1);
  const key = orderComponent ? workKey(orderComponent) : null;
  const found = components.find(c => workKey(c) === key && (c.stageId ?? null) === (assignment.stageId ?? null)) ?? components.find(c => workKey(c) === key);
  return found?.id ?? null;
}

/* ---------------- отчёт выработки ---------------- */

/** Выработка исполнителей за период: операция, количество и сумма */
export async function pieceworkReport(db: Db, filters: { from?: string; to?: string; memberId?: string }) {
  const rows = await db
    .select({
      memberId: pieceworkHeaders.memberId,
      operationId: pieceworkLines.operationId,
      qty: sql<string>`sum(${pieceworkLines.qty})`,
      hours: sql<string>`sum(${pieceworkLines.hours})`,
      amount: sql<string>`sum(${pieceworkLines.amount})`,
    })
    .from(pieceworkLines)
    .innerJoin(documents, eq(documents.id, pieceworkLines.documentId))
    .innerJoin(pieceworkHeaders, eq(pieceworkHeaders.documentId, documents.id))
    .where(
      and(
        eq(documents.type, 'piecework_order'),
        eq(documents.status, 'posted'),
        filters.from ? sql`${documents.date} >= ${filters.from}::date` : undefined,
        filters.to ? sql`${documents.date} <= ${filters.to}::date` : undefined,
        filters.memberId ? eq(pieceworkHeaders.memberId, filters.memberId) : undefined,
      ),
    )
    .groupBy(pieceworkHeaders.memberId, pieceworkLines.operationId);
  const memberIds = [...new Set(rows.map(r => r.memberId))];
  const operationIds = [...new Set(rows.map(r => r.operationId))];
  const memberNames = new Map((await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, memberIds))).map(m => [m.id, m.name]));
  const operationNames = new Map((await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, operationIds))).map(p => [p.id, p.name]));
  return rows
    .map(r => ({
      memberId: r.memberId,
      memberName: memberNames.get(r.memberId) ?? '',
      operationId: r.operationId,
      operationName: operationNames.get(r.operationId) ?? '',
      qty: fmt(dec(r.qty), 3),
      hours: fmt(dec(r.hours), 3),
      amount: fmt(dec(r.amount), 2),
    }))
    .sort((a, b) => (a.memberName < b.memberName ? -1 : a.memberName > b.memberName ? 1 : a.operationName < b.operationName ? -1 : 1));
}

/* ---------------- проведение наряда ---------------- */

/** Проведение наряда: выполненное количество закрепляется за назначением, задачи закрываются */
DOCUMENT_HOOKS.piecework_order = {
  check: async (db, _ctx, doc) => {
    const lines = await db.select().from(pieceworkLines).where(eq(pieceworkLines.documentId, doc.id));
    if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one line to the piecework order');
    const [header] = await db.select().from(pieceworkHeaders).where(eq(pieceworkHeaders.documentId, doc.id)).limit(1);
    if (!header) throw new DomainError(422, 'executor_required', 'The piecework order has no executor');
    // строка по назначению: назначение этого исполнителя, и вместе с проведёнными нарядами не больше назначенного
    const byAssignment = new Map<string, Dec>();
    for (const l of lines) if (l.assignmentId) byAssignment.set(l.assignmentId, (byAssignment.get(l.assignmentId) ?? 0n) + dec(l.qty));
    for (const [assignmentId, qty] of byAssignment) {
      const [a] = await db.select().from(productionOperations).where(eq(productionOperations.id, assignmentId)).limit(1);
      if (!a) throw new DomainError(422, 'invalid_reference', 'The assignment of the line does not exist');
      if (a.memberId !== header.memberId) throw new DomainError(422, 'assignment_of_another_executor', 'The line refers to an assignment of another executor');
      if (dec(a.doneQty) + qty > dec(a.plannedQty)) throw new DomainError(422, 'operation_over_executed', `Only ${fmt(dec(a.plannedQty) - dec(a.doneQty), 3)} of ${fmt(dec(a.plannedQty), 3)} is left to do on this assignment`);
    }
  },
  post: async (db, _ctx, doc) => {
    const lines = await db.select().from(pieceworkLines).where(eq(pieceworkLines.documentId, doc.id)).orderBy(asc(pieceworkLines.sortOrder));
    for (const l of lines) {
      if (!l.assignmentId) continue;
      const [a] = await db.select().from(productionOperations).where(eq(productionOperations.id, l.assignmentId)).limit(1);
      if (!a) continue;
      const done = dec(a.doneQty) + dec(l.qty);
      await db.update(productionOperations).set({ doneQty: fmt(done, 3) }).where(eq(productionOperations.id, a.id));
      // задача исполнителя закрывается, когда выполнено всё назначенное
      if (a.taskId && done >= dec(a.plannedQty)) {
        await db.update(tasks).set({ status: 'done', prevStatus: 'todo', completedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, a.taskId));
      }
    }
    await updateTotal(db, doc.id);
  },
  /** После проведения: себестоимость выпуска пересчитывается по фактическим работам */
  afterPost: async (db, ctx, doc) => {
    await recalcPieceworkReleases(db, ctx, doc.id);
  },
  /** После отмены проведения: выполненное снимается, задачи открываются заново */
  afterUnpost: async (db, ctx, doc) => {
    const lines = await db.select().from(pieceworkLines).where(eq(pieceworkLines.documentId, doc.id));
    for (const l of lines) {
      if (!l.assignmentId) continue;
      const [a] = await db.select().from(productionOperations).where(eq(productionOperations.id, l.assignmentId)).limit(1);
      if (!a) continue;
      const done = dec(a.doneQty) - dec(l.qty);
      await db.update(productionOperations).set({ doneQty: fmt(done > 0n ? done : 0n, 3) }).where(eq(productionOperations.id, a.id));
      if (a.taskId) await db.update(tasks).set({ status: 'todo', prevStatus: 'done', completedAt: null, updatedAt: new Date() }).where(eq(tasks.id, a.taskId));
    }
    await updateTotal(db, doc.id);
    // себестоимость выпуска возвращается к оценке по норме (или к сумме оставшихся проведённых нарядов)
    await recalcPieceworkReleases(db, ctx, doc.id);
  },
};

/** Наряды исполнителя: свои и чужие (для мастера) */
export async function listAssignments(db: Db, memberId: string): Promise<unknown[]> {
  const rows = await db.select().from(productionOperations).where(eq(productionOperations.memberId, memberId)).orderBy(asc(productionOperations.createdAt));
  const ids = rows.map(r => r.id);
  if (!ids.length) return [];
  const [order] = rows[0] ? await db.select().from(documents).where(eq(documents.id, rows[0].documentId)).limit(1) : [];
  const components = new Map((await db.select().from(productionComponents).where(inArray(productionComponents.id, rows.map(r => r.componentId)))).map(c => [c.id, c]));
  const operationIds = [...new Set(rows.map(r => r.operationId).filter((x): x is string => !!x))];
  const operations_ = new Map((await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, operationIds))).map(p => [p.id, p.name]));
  return rows.map(r => ({
    id: r.id,
    orderId: r.documentId,
    orderNumber: order?.number ?? null,
    operationId: r.operationId,
    operationName: r.operationId ? (operations_.get(r.operationId) ?? '') : (components.get(r.componentId)?.operation ?? ''),
    plannedQty: fmt(dec(r.plannedQty), 3),
    doneQty: fmt(dec(r.doneQty), 3),
    taskId: r.taskId,
  }));
}

/** Наряды по выпуску: сумма работ по каждому наряду (для отчёта по заказу) */
export async function releasePieceworkTotals(db: Db, releaseIds: string[]): Promise<Map<string, string>> {
  if (!releaseIds.length) return new Map();
  const rows = await db
    .select({ releaseId: pieceworkLines.releaseDocumentId, amount: sql<string>`sum(${pieceworkLines.amount})` })
    .from(pieceworkLines)
    .innerJoin(documents, eq(documents.id, pieceworkLines.documentId))
    .where(and(inArray(pieceworkLines.releaseDocumentId, releaseIds), eq(documents.status, 'posted'), isNotNull(pieceworkLines.releaseDocumentId)))
    .groupBy(pieceworkLines.releaseDocumentId);
  return new Map(rows.map(r => [r.releaseId!, fmt(dec(r.amount), 2)]));
}

/** Ненулевые строки наряда по назначению: сколько ещё можно отметить */
export async function assignmentLeft(db: Db, assignmentId: string): Promise<Dec> {
  const [a] = await db.select().from(productionOperations).where(eq(productionOperations.id, assignmentId)).limit(1);
  if (!a) return 0n;
  const rows = await db
    .select({ qty: sql<string>`sum(${pieceworkLines.qty})`, status: documents.status })
    .from(pieceworkLines)
    .innerJoin(documents, eq(documents.id, pieceworkLines.documentId))
    .where(eq(pieceworkLines.assignmentId, assignmentId))
    .groupBy(documents.status);
  const done = rows.filter(r => r.status === 'posted').reduce((s, r) => s + dec(r.qty), 0n);
  const draft = rows.filter(r => r.status === 'draft').reduce((s, r) => s + dec(r.qty), 0n);
  const left = dec(a.plannedQty) - done - draft;
  return left > 0n ? left : 0n;
}
