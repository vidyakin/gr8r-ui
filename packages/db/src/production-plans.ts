/* План производства: объём выпуска по периодам (неделя или месяц) в разрезе склада готовой продукции и, необязательно,
   участка-диспетчера. Строки — «изделие × период», полуфабрикаты добавляются кнопкой и помечаются флагом.
   Отсюда же потребности плана (материалы, полуфабрикаты, часы участков против мощности, трудозатраты),
   план-факт (план / заказано / выпущено) и черновики заказов на производство по строкам плана.

   Правила — docs/architecture/replenishment.md. Чистые расчёты — packages/shared/src/replenishment.ts. */
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import {
  averageQty,
  dec,
  explodeBom,
  fmt,
  loadVsCapacity,
  mul,
  periodCapacity,
  planPeriodOf,
  planPeriods,
  semiPlan,
  startBeforeLead,
  type Dec,
  type Explosion,
} from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import type { DocCtx } from './documents';
import { createProductionOrder, loadProductionGraph } from './production';
import { calendarContext, type CalendarContext } from './planning';
import { documentLines, documents, manufacturedItems, productionItems, productionPlanLines, productionPlans, warehouses, workCenters } from './schema';

export type PlanRow = typeof productionPlans.$inferSelect;

export interface PlanLineInput {
  id?: string;
  itemId: string;
  periodStart: string;
  qty: string;
  isSemi?: boolean;
}

/** Строка плана в карточке: продукт, период, количество, дата запуска и план-факт */
export interface PlanLineView {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  productId: string | null;
  unitCode: string;
  periodStart: string;
  qty: string;
  isSemi: boolean;
  /** Дата запуска: выпуск минус дни на изготовление по рабочему календарю */
  startDate: string;
  /** Заказано по плану: позиции заказов на производство этой строки */
  ordered: string;
  /** Выпущено по этим заказам (проведённые выпуски) */
  produced: string;
}

/** Периоды плана */
export const planPeriodList = (plan: Pick<PlanRow, 'periodFrom' | 'periodTo' | 'step'>): string[] => planPeriods(plan.periodFrom, plan.periodTo, plan.step);

async function loadPlan(db: Db, id: string, lock = false): Promise<PlanRow> {
  const q = db.select().from(productionPlans).where(eq(productionPlans.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new DomainError(404, 'not_found', 'plan not found');
  return row;
}

/** Графики воркспейса: даты запуска считаются по рабочим дням */
async function calendars(db: Db, workspaceId: string): Promise<CalendarContext> {
  return calendarContext(db, workspaceId);
}

/* ---------------- строки ---------------- */

/** Строки плана с датой запуска и план-фактом */
export async function planLines(db: Db, planId: string): Promise<PlanLineView[]> {
  const plan = await loadPlan(db, planId);
  const rows = await db
    .select({ line: productionPlanLines, item: manufacturedItems })
    .from(productionPlanLines)
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionPlanLines.itemId))
    .where(eq(productionPlanLines.planId, planId))
    .orderBy(asc(productionPlanLines.sortOrder), asc(productionPlanLines.createdAt));
  const lineIds = rows.map(r => r.line.id);
  const orderItems = lineIds.length
    ? await db
        .select({ id: productionItems.id, planLineId: productionItems.planLineId, qty: productionItems.qty })
        .from(productionItems)
        .innerJoin(documents, eq(documents.id, productionItems.documentId))
        .where(and(inArray(productionItems.planLineId, lineIds), eq(documents.type, 'production_order'), sql`${documents.status} <> 'cancelled'`))
    : [];
  const sourceIds = orderItems.map(o => o.id);
  const made = sourceIds.length
    ? await db
        .select({ source: productionItems.sourceItemId, qty: sql<string>`sum(${productionItems.qty})` })
        .from(productionItems)
        .innerJoin(documents, eq(documents.id, productionItems.documentId))
        .where(and(inArray(productionItems.sourceItemId, sourceIds), eq(documents.type, 'production'), eq(documents.status, 'posted')))
        .groupBy(productionItems.sourceItemId)
    : [];
  const producedBy = new Map(made.map(m => [m.source!, dec(m.qty)]));
  const cal = await calendars(db, plan.workspaceId);
  return rows.map(r => {
    const own = orderItems.filter(o => o.planLineId === r.line.id);
    return {
      id: r.line.id,
      itemId: r.line.itemId,
      itemName: r.item.name,
      itemCode: r.item.code,
      productId: r.item.productId,
      unitCode: r.item.unitCode,
      periodStart: r.line.periodStart,
      qty: r.line.qty,
      isSemi: r.line.isSemi,
      startDate: startBeforeLead(cal.defaultCalendar, cal.holidays, cal.exceptions, r.line.periodStart, r.item.leadDays),
      ordered: fmt(own.reduce((a, o) => a + dec(o.qty), 0n), 3),
      produced: fmt(own.reduce((a, o) => a + (producedBy.get(o.id) ?? 0n), 0n), 3),
    };
  });
}

/** Карточка плана: шапка, периоды и строки */
export async function productionPlanDetail(db: Db, id: string) {
  const plan = await loadPlan(db, id);
  const [wh] = await db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, plan.warehouseId)).limit(1);
  const [wc] = plan.workCenterId ? await db.select({ name: workCenters.name }).from(workCenters).where(eq(workCenters.id, plan.workCenterId)).limit(1) : [];
  return { ...plan, warehouseName: wh?.name ?? '', workCenterName: wc?.name ?? null, periods: planPeriodList(plan), lines: await planLines(db, id) };
}

/** Журнал планов */
export async function listProductionPlans(
  db: Db,
  params: { status?: string; from?: string; to?: string; warehouseId?: string; workCenterId?: string; q?: string; limit: number; offset: number },
) {
  const conds: (SQL | undefined)[] = [
    isNull(productionPlans.archivedAt),
    params.status ? eq(productionPlans.status, params.status as 'draft' | 'approved') : undefined,
    params.from ? sql`${productionPlans.periodTo} >= ${params.from}` : undefined,
    params.to ? sql`${productionPlans.periodFrom} <= ${params.to}` : undefined,
    params.warehouseId ? eq(productionPlans.warehouseId, params.warehouseId) : undefined,
    params.workCenterId ? eq(productionPlans.workCenterId, params.workCenterId) : undefined,
    params.q ? sql`${productionPlans.name} ilike ${'%' + params.q + '%'}` : undefined,
  ];
  const rows = await db.select().from(productionPlans).where(and(...conds)).orderBy(desc(productionPlans.periodFrom), desc(productionPlans.createdAt)).limit(params.limit).offset(params.offset);
  const count = await db.select({ n: sql<number>`count(*)` }).from(productionPlans).where(and(...conds));
  const whs = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses);
  const byWh = new Map(whs.map(w => [w.id, w.name]));
  const ids = rows.map(r => r.id);
  const lines = ids.length ? await db.select({ planId: productionPlanLines.planId, qty: productionPlanLines.qty }).from(productionPlanLines).where(inArray(productionPlanLines.planId, ids)) : [];
  return {
    items: rows.map(r => ({
      ...r,
      warehouseName: byWh.get(r.warehouseId) ?? '',
      lineCount: lines.filter(l => l.planId === r.id).length,
      totalQty: fmt(lines.filter(l => l.planId === r.id).reduce((a, l) => a + dec(l.qty), 0n), 3),
    })),
    total: Number(count[0]?.n ?? 0),
  };
}

/* ---------------- запись ---------------- */

async function assertRefs(db: Db, input: { warehouseId?: string | null; workCenterId?: string | null }): Promise<void> {
  if (input.warehouseId) {
    const [w] = await db.select({ archivedAt: warehouses.archivedAt }).from(warehouses).where(eq(warehouses.id, input.warehouseId)).limit(1);
    if (!w || w.archivedAt) throw new DomainError(422, 'invalid_reference', 'The warehouse does not exist');
  }
  if (input.workCenterId) {
    const [w] = await db.select({ id: workCenters.id }).from(workCenters).where(eq(workCenters.id, input.workCenterId)).limit(1);
    if (!w) throw new DomainError(422, 'invalid_reference', 'The work center does not exist');
  }
}

/** Строки плана пишутся целиком: ссылки проверяются, период — из диапазона плана */
async function writeLines(db: Db, ctx: DocCtx, plan: PlanRow, lines: PlanLineInput[], keep: Set<string>, productChanged: boolean): Promise<void> {
  const itemIds = [...new Set(lines.map(l => l.itemId))];
  const items = itemIds.length ? await db.select({ id: manufacturedItems.id, archivedAt: manufacturedItems.archivedAt }).from(manufacturedItems).where(inArray(manufacturedItems.id, itemIds)) : [];
  const byItem = new Map(items.map(i => [i.id, i]));
  const periods = new Set(planPeriodList(plan));
  for (const l of lines) {
    const it = byItem.get(l.itemId);
    if (!it || it.archivedAt) throw new DomainError(422, 'invalid_reference', 'The product does not exist or is archived');
    if (dec(l.qty) < 0n) throw new DomainError(422, 'invalid_quantity', 'The quantity must not be negative');
    if (!periods.has(l.periodStart)) throw new DomainError(422, 'invalid_period', `${l.periodStart} is not a period of this plan`);
  }
  const old = await db.select({ id: productionPlanLines.id }).from(productionPlanLines).where(eq(productionPlanLines.planId, plan.id));
  const drop = old.filter(r => !keep.has(r.id)).map(r => r.id);
  if (drop.length) await db.delete(productionPlanLines).where(inArray(productionPlanLines.id, drop));
  const fresh = lines.filter(l => !l.id || !keep.has(l.id));
  if (fresh.length)
    await db.insert(productionPlanLines).values(
      fresh.map((l, n) => ({
        ...(l.id && keep.has(l.id) ? { id: l.id } : {}),
        workspaceId: ctx.workspaceId,
        planId: plan.id,
        itemId: l.itemId,
        periodStart: l.periodStart,
        qty: l.qty,
        isSemi: l.isSemi ?? false,
        sortOrder: n,
      })),
    );
  const hasSemi = lines.some(l => l.isSemi);
  // правилась продукция при живых строках полуфабрикатов — их надо перепланировать
  await db.update(productionPlans).set({ semiDirty: hasSemi && productChanged, updatedAt: new Date() }).where(eq(productionPlans.id, plan.id));
}

/** Создание плана */
export async function createProductionPlan(
  db: Db,
  ctx: DocCtx,
  input: { id?: string; name: string; periodFrom: string; periodTo: string; step: 'week' | 'month'; status: 'draft' | 'approved'; warehouseId: string; workCenterId?: string | null; comment?: string; lines: PlanLineInput[] },
): Promise<string> {
  if (input.periodTo < input.periodFrom) throw new DomainError(422, 'invalid_dates', 'The end of the period is earlier than its start');
  await assertRefs(db, input);
  const [plan] = await db
    .insert(productionPlans)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      name: input.name,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      step: input.step,
      status: input.status,
      warehouseId: input.warehouseId,
      workCenterId: input.workCenterId ?? null,
      comment: input.comment ?? '',
    })
    .returning();
  if (input.lines.length) await writeLines(db, ctx, plan, input.lines, new Set(), false);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'production_plan.created', entity: 'production_plan', recordId: plan.id, actorId: ctx.memberId, payload: { name: plan.name } });
  return plan.id;
}

export interface ProductionPlanPatch {
  name?: string;
  periodFrom?: string;
  periodTo?: string;
  step?: 'week' | 'month';
  status?: 'draft' | 'approved';
  warehouseId?: string | null;
  workCenterId?: string | null;
  comment?: string;
  lines?: PlanLineInput[];
}

/** Правка плана: шапка и строки целиком */
export async function updateProductionPlan(db: Db, ctx: DocCtx, id: string, patch: ProductionPlanPatch): Promise<void> {
  const plan = await loadPlan(db, id, true);
  await assertRefs(db, { warehouseId: patch.warehouseId, workCenterId: patch.workCenterId });
  const from = patch.periodFrom ?? plan.periodFrom;
  const to = patch.periodTo ?? plan.periodTo;
  if (to < from) throw new DomainError(422, 'invalid_dates', 'The end of the period is earlier than its start');
  await db
    .update(productionPlans)
    .set({
      name: patch.name ?? plan.name,
      periodFrom: from,
      periodTo: to,
      step: patch.step ?? plan.step,
      status: patch.status ?? plan.status,
      warehouseId: patch.warehouseId ?? plan.warehouseId,
      workCenterId: patch.workCenterId === undefined ? plan.workCenterId : patch.workCenterId,
      comment: patch.comment ?? plan.comment,
      updatedAt: new Date(),
    })
    .where(eq(productionPlans.id, id));
  if (patch.lines) {
    const keep = new Set(patch.lines.filter(l => l.id).map(l => l.id!));
    await writeLines(db, ctx, { ...plan, periodFrom: from, periodTo: to, step: patch.step ?? plan.step }, patch.lines, keep, true);
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'production_plan.updated', entity: 'production_plan', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(patch) } });
}

/** Удаление плана (мягкое): созданные по нему заказы остаются */
export async function deleteProductionPlan(db: Db, ctx: DocCtx, id: string): Promise<void> {
  await loadPlan(db, id);
  await db.update(productionPlans).set({ archivedAt: new Date() }).where(eq(productionPlans.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'production_plan.deleted', entity: 'production_plan', recordId: id, actorId: ctx.memberId, payload: {} });
}

/* ---------------- заполнение ---------------- */

const shiftDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Границы N прошлых периодов перед началом плана */
function historyRange(from: string, step: 'week' | 'month', periods: number): { from: string; to: string } {
  if (step === 'week') return { from: shiftDays(from, -7 * periods), to: shiftDays(from, -1) };
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - periods);
  return { from: d.toISOString().slice(0, 10), to: shiftDays(from, -1) };
}

/** Продукция, которая продаётся со склада: пара «товар → изделие» */
async function madeItems(db: Db): Promise<Map<string, string>> {
  const items = await db.select({ id: manufacturedItems.id, productId: manufacturedItems.productId }).from(manufacturedItems).where(isNotNull(manufacturedItems.productId));
  return new Map(items.filter(i => i.productId).map(i => [i.productId!, i.id]));
}

/** Заполнение плана по статистике выпуска, статистике продаж или заказам покупателей.
    Режим replace заменяет строки продукции, add суммирует с уже заполненными по (изделие, период). */
export async function fillProductionPlan(db: Db, ctx: DocCtx, id: string, input: { source: 'output' | 'sales' | 'customer_orders'; mode: 'replace' | 'add'; periods: number }): Promise<PlanLineView[]> {
  const plan = await loadPlan(db, id, true);
  const periods = planPeriodList(plan);
  const range = historyRange(plan.periodFrom, plan.step, input.periods);
  const computed = new Map<string, string>();
  const bump = (itemId: string, period: string, qty: string) => {
    const key = `${itemId}|${period}`;
    computed.set(key, fmt(dec(computed.get(key) ?? '0') + dec(qty), 3));
  };
  if (input.source === 'output') {
    const rows = await db
      .select({ itemId: productionItems.itemId, qty: productionItems.qty })
      .from(productionItems)
      .innerJoin(documents, eq(documents.id, productionItems.documentId))
      .where(and(eq(documents.type, 'production'), eq(documents.status, 'posted'), sql`${documents.date} between ${range.from} and ${range.to}`));
    const acc = new Map<string, string[]>();
    for (const r of rows) acc.set(r.itemId, [...(acc.get(r.itemId) ?? []), r.qty]);
    for (const [itemId, values] of acc) {
      const avg = averageQty(values); // средний выпуск за период
      if (dec(avg) <= 0n) continue;
      for (const p of periods) bump(itemId, p, avg);
    }
  } else if (input.source === 'sales') {
    const rows = await db
      .select({ productId: documentLines.productId, qty: documentLines.qty })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .where(and(eq(documents.type, 'realization'), eq(documents.status, 'posted'), sql`${documents.date} between ${range.from} and ${range.to}`));
    const acc = new Map<string, string[]>();
    for (const r of rows) acc.set(r.productId, [...(acc.get(r.productId) ?? []), r.qty]);
    const itemOf = await madeItems(db);
    for (const [productId, values] of acc) {
      const itemId = itemOf.get(productId);
      if (!itemId) continue;
      const avg = averageQty(values);
      if (dec(avg) <= 0n) continue;
      for (const p of periods) bump(itemId, p, avg);
    }
  } else {
    // неотгруженный и не покрытый производством остаток открытых заказов покупателей — в период по сроку отгрузки
    const rows = await db
      .select({
        productId: documentLines.productId,
        qty: documentLines.qty,
        dueDate: documents.dueDate,
        date: documents.date,
        shipped: sql<string>`coalesce((select sum(f.qty) from document_lines f join documents d2 on d2.id = f.document_id where f.origin_line_id = document_lines.id and d2.type = 'realization' and d2.status = 'posted'), 0)`,
        covered: sql<string>`coalesce((select sum(o.qty) from production_items o join documents d3 on d3.id = o.document_id where o.customer_order_line_id = document_lines.id and d3.type = 'production_order' and d3.status <> 'cancelled'), 0)`,
      })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .where(and(eq(documents.type, 'customer_order'), eq(documents.status, 'posted')));
    const itemOf = await madeItems(db);
    for (const o of rows) {
      const left = dec(o.qty) - dec(o.shipped) - dec(o.covered);
      const itemId = itemOf.get(o.productId);
      if (left <= 0n || !itemId) continue;
      const period = planPeriodOf(periods, o.dueDate ?? o.date);
      if (!period) continue;
      bump(itemId, period, fmt(left, 3));
    }
  }
  const existing = await db.select().from(productionPlanLines).where(eq(productionPlanLines.planId, id));
  const next = new Map<string, string>();
  const keep = new Set<string>();
  if (input.mode === 'add') for (const e of existing.filter(e => !e.isSemi)) next.set(`${e.itemId}|${e.periodStart}`, e.qty);
  for (const [key, qty] of computed) next.set(key, fmt(dec(next.get(key) ?? '0') + dec(qty), 3));
  for (const e of existing.filter(e => e.isSemi)) keep.add(e.id);
  const rows: PlanLineInput[] = [
    ...[...next.entries()].map(([key, qty]) => {
      const [itemId, periodStart] = key.split('|');
      return { itemId, periodStart, qty, isSemi: false };
    }),
    ...existing.filter(e => e.isSemi).map(e => ({ id: e.id, itemId: e.itemId, periodStart: e.periodStart, qty: e.qty, isSemi: true })),
  ];
  await writeLines(db, ctx, plan, rows, keep, true);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'production_plan.updated', entity: 'production_plan', recordId: id, actorId: ctx.memberId, payload: { fill: input.source } });
  return planLines(db, id);
}

/* ---------------- полуфабрикаты ---------------- */

/** Пропорционально продукции, одинаковые суммируются, период сдвигается на срок изготовления (рабочие дни) */
export async function planSemiFinished(db: Db, ctx: DocCtx, id: string, itemIds: string[] = []): Promise<PlanLineView[]> {
  const plan = await loadPlan(db, id, true);
  const graph = await loadProductionGraph(db);
  const cal = await calendars(db, ctx.workspaceId);
  const leadOf = new Map(graph.items.map(i => [i.id, i.leadDays]));
  const periods = planPeriodList(plan);
  const rows = await db.select().from(productionPlanLines).where(eq(productionPlanLines.planId, id));
  const products = rows.filter(r => !r.isSemi && (!itemIds.length || itemIds.includes(r.itemId)));
  const acc = new Map<string, Dec>();
  for (const r of products) {
    let explosion: Explosion;
    try {
      explosion = explodeBom(graph.inputs, r.itemId, r.qty);
    } catch {
      continue; // цикл в спецификации — строка пропускается, план не падает
    }
    // количества полуфабриката уже развёрнуты на количество строки — норма на единицу не применяется второй раз
    // сдвинутая на срок изготовления дата попадает в тот период плана, куда она попала
    for (const s of explosion.semis) {
      const out = semiPlan(
        [{ periodStart: r.periodStart, qty: '1' }],
        [{ itemId: s.itemId, qty: s.qty }],
        period => planPeriodOf(periods, startBeforeLead(cal.defaultCalendar, cal.holidays, cal.exceptions, period, leadOf.get(s.itemId) ?? 0)) ?? plan.periodFrom,
        () => 0,
      );
      for (const o of out) {
        const key = `${o.itemId}|${o.periodStart}`;
        acc.set(key, (acc.get(key) ?? 0n) + dec(o.qty));
      }
    }
  }
  // сдвинутый на срок изготовления период может выйти за пределы плана — в него такая строка не пишется
  const semis: PlanLineInput[] = [...acc.entries()]
    .map(([key, qty]) => {
      const [itemId, periodStart] = key.split('|');
      return { itemId, periodStart, qty: fmt(qty, 3), isSemi: true };
    })
    .filter(s => s.periodStart >= plan.periodFrom && s.periodStart <= plan.periodTo);
  const keep = new Set(rows.map(r => r.id));
  await writeLines(
    db,
    ctx,
    plan,
    [...products.map(r => ({ id: r.id, itemId: r.itemId, periodStart: r.periodStart, qty: r.qty, isSemi: false })), ...semis],
    keep,
    false,
  );
  await db.update(productionPlans).set({ semiDirty: false, updatedAt: new Date() }).where(eq(productionPlans.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'production_plan.updated', entity: 'production_plan', recordId: id, actorId: ctx.memberId, payload: { semi: semis.length } });
  return planLines(db, id);
}

/** Удалить только строки полуфабрикатов */
export async function removePlanSemi(db: Db, ctx: DocCtx, id: string): Promise<PlanLineView[]> {
  await loadPlan(db, id, true);
  await db.delete(productionPlanLines).where(and(eq(productionPlanLines.planId, id), eq(productionPlanLines.isSemi, true)));
  await db.update(productionPlans).set({ semiDirty: false, updatedAt: new Date() }).where(eq(productionPlans.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'production_plan.updated', entity: 'production_plan', recordId: id, actorId: ctx.memberId, payload: { semiRemoved: true } });
  return planLines(db, id);
}

/* ---------------- потребности ---------------- */

/** Материалы, потребление и выпуск полуфабрикатов, часы участков против мощности и трудозатраты — развёрткой по периодам */
export async function productionPlanNeeds(db: Db, id: string) {
  const plan = await loadPlan(db, id);
  const lines = await db.select().from(productionPlanLines).where(eq(productionPlanLines.planId, id));
  const graph = await loadProductionGraph(db);
  const cal = await calendars(db, plan.workspaceId);
  const periods = planPeriodList(plan);
  const matNames = new Map(graph.mats.map(p => [p.id, p.name]));
  const mats = new Map<string, Dec>();
  const consumed = new Map<string, Dec>();
  const produced = new Map<string, Dec>();
  const hoursByPeriod = new Map<string, Map<string, Dec>>();
  const totalHours = new Map<string, Dec>();
  for (const l of lines) {
    if (dec(l.qty) <= 0n) continue;
    let explosion: Explosion;
    try {
      explosion = explodeBom(graph.inputs, l.itemId, l.qty);
    } catch {
      continue;
    }
    if (l.isSemi) produced.set(l.itemId, (produced.get(l.itemId) ?? 0n) + dec(l.qty));
    // расход подрядчику — услуга: со склада не списывается, в потребность материалов не входит
    for (const m of explosion.materials) if (!m.expense) mats.set(m.productId, (mats.get(m.productId) ?? 0n) + dec(m.qty));
    for (const s of explosion.semis) consumed.set(s.itemId, (consumed.get(s.itemId) ?? 0n) + dec(s.qty));
    const byCenter = hoursByPeriod.get(l.periodStart) ?? new Map<string, Dec>();
    for (const w of explosion.works) {
      byCenter.set(w.workCenterId ?? '', (byCenter.get(w.workCenterId ?? '') ?? 0n) + dec(w.hours));
      totalHours.set(w.workCenterId ?? '', (totalHours.get(w.workCenterId ?? '') ?? 0n) + dec(w.hours));
    }
    hoursByPeriod.set(l.periodStart, byCenter);
  }
  const centers = new Map(graph.centers.map(c => [c.id, c]));
  const rateOf = new Map(graph.centers.map(c => [c.id, c.hourlyRate]));
  // мощность участка за период — сумма по рабочим дням его графика
  const capacityOfPeriod = (centerId: string, period: string, next: string | null): string => {
    const c = centers.get(centerId);
    if (!c) return '0.000';
    const calendar = (c.calendarId ? cal.calendars.get(c.calendarId) : null) ?? cal.defaultCalendar;
    const exc = cal.exceptionsByScope[`work_center:${c.id}`] ?? [];
    return periodCapacity(calendar, c.capacityHoursPerDay, cal.holidays, exc, period, next ?? shiftDays(period, 6));
  };
  const load: { period: string; workCenterId: string | null; workCenterName: string; hours: string; capacity: string; shortage: string }[] = [];
  for (const [period, byCenter] of hoursByPeriod) {
    const next = periods[periods.indexOf(period) + 1] ?? null;
    for (const [centerId, hours] of byCenter) {
      const cmp = loadVsCapacity(fmt(hours, 3), centerId ? capacityOfPeriod(centerId, period, next) : '0.000');
      load.push({
        period,
        workCenterId: centerId || null,
        workCenterName: centerId ? (centers.get(centerId)?.name ?? '') : 'Без участка',
        hours: fmt(hours, 3),
        capacity: cmp.capacity,
        shortage: cmp.shortage,
      });
    }
  }
  const labor = [...totalHours.entries()].map(([centerId, hours]) => ({
    workCenterId: centerId || null,
    workCenterName: centerId ? (centers.get(centerId)?.name ?? '') : 'Без участка',
    hours: fmt(hours, 3),
    amount: fmt(mul(dec(fmt(hours, 6)), dec(rateOf.get(centerId) ?? '0')), 2),
  }));
  return {
    periods,
    materials: [...mats.entries()]
      .map(([productId, qty]) => ({ productId, name: matNames.get(productId) ?? productId, qty: fmt(qty, 3) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    semis: [...new Set([...consumed.keys(), ...produced.keys()])]
      .map(itemId => {
        const used = consumed.get(itemId) ?? 0n;
        const made = produced.get(itemId) ?? 0n;
        const balance = made - used;
        return {
          itemId,
          name: graph.items.find(i => i.id === itemId)?.name ?? itemId,
          consumed: fmt(used, 3),
          produced: fmt(made, 3),
          balance: fmt(balance, 3),
          status: balance >= 0n ? ('surplus' as const) : ('deficit' as const),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    load,
    labor,
  };
}

/* ---------------- заказы по плану ---------------- */

/** Рабочее место «Заказы по плану»: утверждённые планы и строки с остатком «план − заказано» */
export async function planOrdersWorkbench(db: Db, params: { periodStart?: string; workCenterId?: string; limit: number }) {
  const rows = await db
    .select()
    .from(productionPlans)
    .where(and(isNull(productionPlans.archivedAt), eq(productionPlans.status, 'approved'), params.workCenterId ? eq(productionPlans.workCenterId, params.workCenterId) : undefined))
    .orderBy(asc(productionPlans.periodFrom))
    .limit(params.limit);
  const whs = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses);
  const byWh = new Map(whs.map(w => [w.id, w.name]));
  const out: { plan: PlanRow & { warehouseName: string }; periods: string[]; lines: (PlanLineView & { remainder: string })[] }[] = [];
  for (const plan of rows) {
    const periods = planPeriodList(plan);
    if (params.periodStart && !periods.includes(params.periodStart)) continue;
    const lines = (await planLines(db, plan.id))
      .filter(l => !l.isSemi && (!params.periodStart || l.periodStart === params.periodStart))
      .map(l => ({ ...l, remainder: fmt(dec(l.qty) - dec(l.ordered), 3) }));
    out.push({ plan: { ...plan, warehouseName: byWh.get(plan.warehouseId) ?? '' }, periods, lines });
  }
  return out;
}

/** Черновики заказов на производство по строкам плана: финиш = дата выпуска, старт = дата запуска.
    Повторный запуск не дублирует — заказывается только остаток «план − уже заказано по строке». */
export async function createOrdersByPlan(
  db: Db,
  ctx: DocCtx,
  id: string,
  input: { periodStart?: string | null; lineIds: string[]; date?: string; comment?: string },
): Promise<{ created: { id: string; periodStart: string; qty: string; itemNames: string[] }[]; skipped: { itemName: string; qty: string }[] }> {
  const plan = await loadPlan(db, id, true);
  if (plan.status !== 'approved') throw new DomainError(422, 'plan_not_approved', 'Approve the plan first: orders are created from approved plans only');
  const chosen = (await planLines(db, id)).filter(l => !l.isSemi && (!input.lineIds.length || input.lineIds.includes(l.id)) && (!input.periodStart || l.periodStart === input.periodStart));
  const byPeriod = new Map<string, PlanLineView[]>();
  const skipped: { itemName: string; qty: string }[] = [];
  for (const l of chosen) {
    const left = dec(l.qty) - dec(l.ordered);
    if (left <= 0n) {
      skipped.push({ itemName: l.itemName, qty: '0.000' });
      continue;
    }
    byPeriod.set(l.periodStart, [...(byPeriod.get(l.periodStart) ?? []), l]);
  }
  const created: { id: string; periodStart: string; qty: string; itemNames: string[] }[] = [];
  for (const [period, lines] of byPeriod) {
    const orderId = await createProductionOrder(db, ctx, {
      workCenterId: plan.workCenterId,
      targetWarehouseId: plan.warehouseId,
      date: input.date,
      plannedStart: `${lines[0]!.startDate}T00:00:00.000Z`,
      plannedEnd: `${period}T00:00:00.000Z`,
      comment: input.comment?.trim() || `Production plan ${plan.name}`,
      items: lines.map(l => ({ itemId: l.itemId, qty: fmt(dec(l.qty) - dec(l.ordered), 3), planLineId: l.id })),
    });
    created.push({ id: orderId, periodStart: period, qty: fmt(lines.reduce((a, l) => a + (dec(l.qty) - dec(l.ordered)), 0n), 3), itemNames: lines.map(l => l.itemName) });
  }
  return { created, skipped };
}

/** Сколько по строкам плана уже заказано (для расчёта потребностей: план учитывается только в незаказанной части) */
export async function planOrderedQty(db: Db, planIds: string[]): Promise<Map<string, Dec>> {
  if (!planIds.length) return new Map();
  const rows = await db
    .select({ planLineId: productionItems.planLineId, qty: sql<string>`sum(${productionItems.qty})` })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .where(and(inArray(productionItems.planLineId, planIds), eq(documents.type, 'production_order'), sql`${documents.status} <> 'cancelled'`))
    .groupBy(productionItems.planLineId);
  return new Map(rows.map(r => [r.planLineId!, dec(r.qty)]));
}