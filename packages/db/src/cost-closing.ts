/* Закрытие периода (этап 6 «УНФ: Производство»): косвенные затраты месяца, их распределение на выпуски по базе статьи
   и корректировки себестоимости.

   Модель:
   - `period_costs` — косвенные затраты месяца; набираются при проведении документов (строки-услуги поступления со
     статьёй и участком, списание материалов на участок, документ «Прочие затраты») и очищаются при отмене проведения;
   - закрытие — задача воркера `production.close_period`: распределяет косвенные на выпуски месяца по базе статьи и пишет
     корректировки `stock_cost_adjustments`: своя часть (own_delta) — на приход продукции, дальше удорожание идёт по цепочке
     движений (recomputeStockCosts в stock.ts): перемещения, выпуски, списавшие продукцию как материал, реализации и
     возвраты. Так проданная часть увеличивает себестоимость продаж, а полуфабрикат несёт свои косвенные в изделие;
   - `production_cost_closings` — результат закрытия месяца (статус, сводка в totals jsonb, время прогона).

   Корректировка — прибавка к цене движения, а не новое движение: движений с нулевым количеством не бывает
   (CHECK stock_moves_qty_chk). Всё, что читает себестоимость, берёт движение вместе с корректировкой.
   Повторное закрытие месяца идемпотентно: своя часть прошлого закрытия обнуляется и считается заново. */
import { and, asc, desc, eq, gt, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { dec, div, fmt, monthOf, monthPeriod, mul, planOverhead, type CostDistribution, type Dec, type OverheadCost, type OverheadTarget } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { DOCUMENT_HOOKS } from './document-hooks';
import { recomputeStockCosts } from './stock';
import { costItems, documents, manufacturedItems, organizations, otherCostLines, periodCosts, products, productionCostClosings, productionHeaders, productionItems, stockBalances, stockCostAdjustments, stockMoves, warehouses, workCenters, workspaces } from './schema';
import type { DocCtx, DocumentLineRow, DocumentRow } from './documents';

/* ---------------- дата запрета ---------------- */

/** Дата запрета редактирования воркспейса и настройка её переноса при закрытии */
export async function loadPeriodLock(db: Db, workspaceId: string): Promise<{ closedThrough: string | null; closeMovesLock: boolean }> {
  const [ws] = await db.select({ closedThrough: workspaces.closedThrough, closeMovesLock: workspaces.closeMovesLock }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return { closedThrough: ws?.closedThrough ?? null, closeMovesLock: ws?.closeMovesLock ?? false };
}

/** Общая проверка периода: документ с датой не позже даты запрета нельзя провести, снять с проведения или исправить */
export async function assertPeriodOpen(db: Db, workspaceId: string, date: string): Promise<void> {
  const { closedThrough } = await loadPeriodLock(db, workspaceId);
  if (closedThrough && date <= closedThrough) throw new DomainError(422, 'period_closed', `The period ending ${closedThrough} is closed: documents dated ${date} cannot be posted or changed`);
}

/* ---------------- косвенные затраты из документов ---------------- */

/** Период затрат хранится датой первого дня месяца */
const periodStart = (date: string) => `${monthOf(date)}-01`;

/** Себестоимость списания по движениям документа (расходная сторона) */
async function writeOffCost(db: Db, documentId: string): Promise<Dec> {
  const [row] = await db
    .select({ cost: sql<string>`coalesce(sum(-${stockMoves.qty} * ${stockMoves.cost}), 0)::text` })
    .from(stockMoves)
    .where(and(eq(stockMoves.documentId, documentId), sql`${stockMoves.qty} < 0`));
  return dec(row?.cost ?? '0');
}

/** Косвенные затраты проведённого документа. Записи пишутся ключом по строке документа: повторное проведение
    перезаписывает их, а отмена проведения удаляет. Источники — как в УНФ: строки-услуги поступления со статьёй,
    списание материалов на участок и документ «Прочие затраты» */
export async function syncPeriodCosts(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  await clearPeriodCosts(db, ctx.workspaceId, doc.id);
  const type = doc.type as string;
  if (type === 'receipt') {
    const rows = lines.filter(l => l.costItemId);
    if (!rows.length) return;
    // сумма строки: при УСН входной НДС входит в себестоимость (как и при приходе на склад)
    const [org] = await db.select({ taxSystem: organizations.taxSystem }).from(organizations).where(eq(organizations.id, doc.organizationId)).limit(1);
    for (const l of rows) {
      const amount = org?.taxSystem === 'usn' ? dec(l.total) : dec(l.net);
      if (amount <= 0n) continue;
      await db.insert(periodCosts).values({ workspaceId: ctx.workspaceId, period: periodStart(doc.date), costItemId: l.costItemId!, workCenterId: l.workCenterId, amount: fmt(amount, 2), source: 'receipt', documentId: doc.id, documentLineId: l.id });
    }
    return;
  }
  if (type === 'write_off' && doc.workCenterId && doc.costItemId) {
    // списание материалов на участок: себестоимость списания — косвенные затраты участка («НЗП без номенклатуры» в УНФ)
    const cost = await writeOffCost(db, doc.id);
    if (cost <= 0n) return;
    await db.insert(periodCosts).values({ workspaceId: ctx.workspaceId, period: periodStart(doc.date), costItemId: doc.costItemId, workCenterId: doc.workCenterId, amount: fmt(cost, 2), source: 'write_off', documentId: doc.id });
    return;
  }
  if (type === 'other_costs') {
    for (const r of await db.select().from(otherCostLines).where(eq(otherCostLines.documentId, doc.id))) {
      await db.insert(periodCosts).values({ workspaceId: ctx.workspaceId, period: periodStart(doc.date), costItemId: r.costItemId, workCenterId: r.workCenterId, amount: r.amount, source: 'other_costs', documentId: doc.id });
    }
  }
}

/** Записи косвенных затрат документа удаляются: отмена проведения или отмена документа */
export async function clearPeriodCosts(db: Db, workspaceId: string, documentId: string): Promise<void> {
  await db.delete(periodCosts).where(and(eq(periodCosts.workspaceId, workspaceId), eq(periodCosts.documentId, documentId)));
}

/** Статью затрат несут только строки-услуги: товар двигает склад, услуга становится косвенной затратой месяца */
export async function assertServiceCostItems(db: Db, type: string, lines: DocumentLineRow[]): Promise<void> {
  if (type !== 'receipt') return;
  const rows = lines.filter(l => l.costItemId);
  if (!rows.length) return;
  const kinds = new Map((await db.select({ id: products.id, kind: products.kind }).from(products).where(inArray(products.id, [...new Set(rows.map(l => l.productId))]))).map(p => [p.id, p.kind]));
  if (rows.some(l => kinds.get(l.productId) !== 'service')) throw new DomainError(422, 'cost_item_service_only', 'Only service lines carry a cost item: goods move the warehouse, services become indirect costs');
  const items = new Map((await db.select({ id: costItems.id, kind: costItems.kind }).from(costItems).where(inArray(costItems.id, [...new Set(rows.map(l => l.costItemId!))]))).map(i => [i.id, i]));
  if (rows.some(l => items.get(l.costItemId!)?.kind !== 'expense')) throw new DomainError(422, 'cost_item_kind_mismatch', 'An indirect cost line needs an expense cost item');
}

/* ---------------- корректировки себестоимости ---------------- */

/** Своя часть корректировок закрытия обнуляется (повторное закрытие или отмена); итог пересчитает recomputeStockCosts */
async function dropOwnDeltas(db: Db, workspaceId: string, closingId: string): Promise<void> {
  await db.update(stockCostAdjustments).set({ ownDelta: '0', closingId: null, updatedAt: new Date() }).where(and(eq(stockCostAdjustments.workspaceId, workspaceId), eq(stockCostAdjustments.closingId, closingId)));
}

/* ---------------- данные закрытия ---------------- */

/** Позиции выпуска месяца: продукция, количество, прямые затраты и нормочасы — получатели косвенных затрат */
export async function loadReleaseTargets(db: Db, workspaceId: string, month: string): Promise<OverheadTarget[]> {
  const { start, end } = monthPeriod(month);
  const rows = await db
    .select({
      itemId: productionItems.id,
      releaseId: productionItems.documentId,
      qty: productionItems.qty,
      stageCost: productionItems.stageCost,
      documentLineId: productionItems.documentLineId,
      name: manufacturedItems.name,
      workCenterId: productionHeaders.workCenterId,
      hours: sql<string>`coalesce((
        select sum(case when pc.actual_qty is not null then pc.actual_qty else pc.hours end)
        from production_components pc where pc.item_id = ${productionItems.id} and pc.kind = 'work'), 0)::text`,
    })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionItems.itemId))
    .leftJoin(productionHeaders, and(eq(productionHeaders.workspaceId, workspaceId), eq(productionHeaders.documentId, productionItems.documentId)))
    .where(and(eq(productionItems.workspaceId, workspaceId), eq(documents.type, 'production'), eq(documents.status, 'posted'), gte(documents.date, start), lte(documents.date, end)))
    .orderBy(asc(productionItems.sortOrder));
  // прямые затраты — с удорожанием по цепочке (материалы и полуфабрикаты, подорожавшие при закрытии), без своей части
  const lineIds = rows.map(r => r.documentLineId).filter((x): x is string => !!x);
  const chain = lineIds.length
    ? await db
        .select({ lineId: stockMoves.documentLineId, qty: stockMoves.qty, chain: sql<string>`(${stockCostAdjustments.deltaCost} - ${stockCostAdjustments.ownDelta})::text` })
        .from(stockCostAdjustments)
        .innerJoin(stockMoves, eq(stockMoves.id, stockCostAdjustments.moveId))
        .where(and(eq(stockCostAdjustments.workspaceId, workspaceId), inArray(stockMoves.documentLineId, lineIds), sql`${stockMoves.qty} > 0`))
    : [];
  const chainByLine = new Map(chain.map(c => [c.lineId!, mul(dec(c.chain), dec(c.qty))]));
  return rows.map(r => ({ itemId: r.itemId, releaseId: r.releaseId, name: r.name, workCenterId: r.workCenterId, documentLineId: r.documentLineId, qty: dec(r.qty), directCost: dec(r.stageCost) + (r.documentLineId ? (chainByLine.get(r.documentLineId) ?? 0n) : 0n), workHours: dec(r.hours) }));
}

/** Косвенные затраты месяца по статьям и участкам (способ распределения задаёт статья) */
export async function loadPeriodCosts(db: Db, workspaceId: string, month: string): Promise<OverheadCost[]> {
  const { start, end } = monthPeriod(month);
  const rows = await db
    .select({
      costItemId: periodCosts.costItemId,
      costItemName: costItems.name,
      method: costItems.distributionMethod,
      workCenterId: periodCosts.workCenterId,
      amount: sql<string>`coalesce(sum(${periodCosts.amount}), 0)::text`,
    })
    .from(periodCosts)
    .innerJoin(costItems, eq(costItems.id, periodCosts.costItemId))
    .where(and(eq(periodCosts.workspaceId, workspaceId), gte(periodCosts.period, start), lte(periodCosts.period, end)))
    .groupBy(periodCosts.costItemId, costItems.name, costItems.distributionMethod, periodCosts.workCenterId);
  const centers = await loadCenters(db);
  return rows.map(r => ({ costItemId: r.costItemId, costItemName: r.costItemName, method: r.method as CostDistribution, workCenterId: r.workCenterId, workCenterName: r.workCenterId ? (centers.get(r.workCenterId) ?? null) : null, amount: dec(r.amount) }));
}

/** Участки воркспейса: подпись участка нужна в результате закрытия и в предварительной проверке */
async function loadCenters(db: Db): Promise<Map<string, string>> {
  return new Map((await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters)).map(w => [w.id, w.name]));
}

/* ---------------- предварительная проверка ---------------- */

export interface PeriodIssue {
  kind: 'negative_stock' | 'unposted' | 'no_release';
  message: string;
  /** Ссылки на расшифровку: документ или позиция остатка */
  links: { documentId?: string; number?: string | null; date?: string; warehouseId?: string; productId?: string; name?: string; qty?: string }[];
}

export interface PeriodPreview {
  month: string;
  costs: { costItemId: string; name: string; method: CostDistribution; workCenterId: string | null; workCenterName: string | null; amount: string }[];
  targets: { itemId: string; releaseId: string; name: string; workCenterId: string | null; workCenterName: string | null; qty: string; directCost: string; workHours: string }[];
  issues: PeriodIssue[];
  /** Всего косвенных затрат месяца */
  total: string;
}

/** Предварительный анализ перед закрытием: отрицательные остатки и непроведённые документы месяца — со ссылками */
export async function previewPeriod(db: Db, workspaceId: string, month: string): Promise<PeriodPreview> {
  const { start, end } = monthPeriod(month);
  const issues: PeriodIssue[] = [];
  const negative = await db
    .select({ warehouseId: stockBalances.warehouseId, warehouseName: warehouses.name, productId: stockBalances.productId, name: products.name, qty: stockBalances.qty })
    .from(stockBalances)
    .innerJoin(products, eq(products.id, stockBalances.productId))
    .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
    .where(and(eq(stockBalances.workspaceId, workspaceId), sql`${stockBalances.qty} < 0`));
  if (negative.length) issues.push({ kind: 'negative_stock', message: `Negative stock in ${negative.length} position(s) — fix the documents before closing`, links: negative.map(n => ({ warehouseId: n.warehouseId, productId: n.productId, name: `${n.name} · ${n.warehouseName}`, qty: n.qty })) });
  const drafts = await db
    .select({ id: documents.id, number: documents.number, date: documents.date, status: documents.status })
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), ne(documents.status, 'cancelled'), gte(documents.date, start), lte(documents.date, end)))
    .orderBy(asc(documents.date));
  const unposted = drafts.filter(d => d.status === 'draft');
  if (unposted.length) issues.push({ kind: 'unposted', message: `${unposted.length} document(s) of the month are not posted — post them or move their date out of the period`, links: unposted.map(d => ({ documentId: d.id, number: d.number, date: d.date })) });
  const targets = await loadReleaseTargets(db, workspaceId, month);
  if (!targets.length) issues.push({ kind: 'no_release', message: 'There are no releases this month: indirect costs will stay undistributed', links: [] });
  const costs = await loadPeriodCosts(db, workspaceId, month);
  const centers = await loadCenters(db);
  return {
    month,
    costs: costs.map(c => ({ costItemId: c.costItemId, name: c.costItemName, method: c.method, workCenterId: c.workCenterId, workCenterName: c.workCenterName, amount: fmt(c.amount, 2) })),
    targets: targets.map(t => ({ itemId: t.itemId, releaseId: t.releaseId, name: t.name, workCenterId: t.workCenterId, workCenterName: t.workCenterId ? (centers.get(t.workCenterId) ?? null) : null, qty: fmt(t.qty, 3), directCost: fmt(t.directCost, 2), workHours: fmt(t.workHours, 3) })),
    issues,
    total: fmt(costs.reduce((s, c) => s + c.amount, 0n), 2),
  };
}

/* ---------------- закрытие периода ---------------- */

export interface ClosingTotals {
  month: string;
  /** Распределено по статьям и участкам */
  byCostItem: { costItemId: string; costItemName: string; workCenterId: string | null; workCenterName: string | null; method: CostDistribution; amount: string; distributed: string; scope: string }[];
  /** Что получили выпуски месяца */
  byRelease: { itemId: string; releaseId: string; name: string; workCenterId: string | null; workCenterName: string | null; qty: string; directCost: string; workHours: string; allocated: string }[];
  /** Нераспределённые затраты */
  undistributed: string;
  /** Предупреждения закрытия */
  warnings: string[];
  /** Всего косвенных затрат месяца */
  total: string;
  /** Сколько движений переоценено */
  adjustedMoves: number;
  /** Кто закрывал */
  closedBy: string | null;
  runAt: string;
}

/** Закрытие месяца: косвенные затраты распределяются на выпуски, себестоимость цепочки пересчитывается.
    Идемпотентно: корректировки прошлого закрытия этого месяца снимаются, расчёт повторяется с нуля */
export async function closePeriodMonth(db: Db, ctx: DocCtx, month: string): Promise<ClosingTotals> {
  const { start, end } = monthPeriod(month);
  // два закрытия одного воркспейса не идут одновременно: вторая транзакция ждёт и затем видит готовый результат
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`closing:${ctx.workspaceId}`}))`);
  const [prev] = await db.select({ id: productionCostClosings.id }).from(productionCostClosings).where(and(eq(productionCostClosings.workspaceId, ctx.workspaceId), eq(productionCostClosings.period, start))).limit(1);
  if (prev) await dropOwnDeltas(db, ctx.workspaceId, prev.id);
  const [closing] = await db
    .insert(productionCostClosings)
    .values({ workspaceId: ctx.workspaceId, period: start, status: 'running', totals: {}, runAt: new Date() })
    .onConflictDoUpdate({ target: [productionCostClosings.workspaceId, productionCostClosings.period], set: { status: 'running', error: null, totals: {}, runAt: new Date(), updatedAt: new Date() } })
    .returning();

  // 1. цепочка без распределения этого месяца: прямые затраты выпусков — с удорожанием материалов прошлых закрытий
  await recomputeStockCosts(db, ctx.workspaceId);
  const costs = await loadPeriodCosts(db, ctx.workspaceId, month);
  const targets = await loadReleaseTargets(db, ctx.workspaceId, month);
  const centers = await loadCenters(db);
  const plan = planOverhead(costs, targets);

  // 2. распределённое — своя часть корректировки прихода продукции выпуска
  for (const t of targets) {
    const allocated = plan.byTarget.get(t.itemId) ?? 0n;
    if (allocated <= 0n || !t.documentLineId) continue;
    const [move] = await db.select({ id: stockMoves.id, qty: stockMoves.qty }).from(stockMoves).where(and(eq(stockMoves.workspaceId, ctx.workspaceId), eq(stockMoves.documentLineId, t.documentLineId), sql`${stockMoves.qty} > 0`)).orderBy(asc(stockMoves.seq)).limit(1);
    if (!move) continue;
    const own = fmt(div(allocated, dec(move.qty)), 4);
    await db
      .insert(stockCostAdjustments)
      .values({ workspaceId: ctx.workspaceId, moveId: move.id, deltaCost: own, ownDelta: own, closingId: closing!.id, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [stockCostAdjustments.workspaceId, stockCostAdjustments.moveId], set: { ownDelta: own, closingId: closing!.id, updatedAt: new Date() } });
  }

  // 3. пересчёт цепочки: средняя складов и себестоимость всех последующих движений (перемещения, выпуски, реализации)
  const adjusted = await recomputeStockCosts(db, ctx.workspaceId);

  const totals: ClosingTotals = {
    month,
    byCostItem: plan.byCostItem.map(g => ({ costItemId: g.costItemId, costItemName: g.costItemName, workCenterId: g.workCenterId, workCenterName: g.workCenterName, method: g.method, amount: fmt(g.amount, 2), distributed: fmt(g.distributed, 2), scope: g.scope })),
    byRelease: targets.filter(t => t.documentLineId).map(t => ({ itemId: t.itemId, releaseId: t.releaseId, name: t.name, workCenterId: t.workCenterId, workCenterName: t.workCenterId ? (centers.get(t.workCenterId) ?? null) : null, qty: fmt(t.qty, 3), directCost: fmt(t.directCost, 2), workHours: fmt(t.workHours, 3), allocated: fmt(plan.byTarget.get(t.itemId) ?? 0n, 2) })),
    undistributed: fmt(plan.undistributed, 2),
    warnings: plan.warnings,
    total: fmt(costs.reduce((s, c) => s + c.amount, 0n), 2),
    adjustedMoves: adjusted,
    closedBy: ctx.memberId,
    runAt: new Date().toISOString(),
  };
  await db.update(productionCostClosings).set({ status: 'done', totals: totals as unknown as Record<string, unknown>, runAt: new Date(), updatedAt: new Date() }).where(eq(productionCostClosings.id, closing!.id));
  // настройка «переносить дату запрета»: успешное закрытие сдвигает дату на конец закрытого месяца
  const { closeMovesLock } = await loadPeriodLock(db, ctx.workspaceId);
  if (closeMovesLock) await advanceClosedThrough(db, ctx.workspaceId, end);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'production.period_closed', entity: 'production_closing', recordId: closing!.id, actorId: ctx.memberId, payload: { month, undistributed: totals.undistributed } });
  return totals;
}

/** Отмена закрытия месяца: корректировки снимаются, цепочка пересчитывается обратно */
export async function reopenPeriodMonth(db: Db, ctx: DocCtx, month: string): Promise<boolean> {
  const { start } = monthPeriod(month);
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`closing:${ctx.workspaceId}`}))`);
  const [closing] = await db.select().from(productionCostClosings).where(and(eq(productionCostClosings.workspaceId, ctx.workspaceId), eq(productionCostClosings.period, start))).limit(1);
  if (!closing || closing.status === 'reopened') return false;
  // отмена идёт от последнего закрытого месяца: иначе его себестоимость считалась бы от уже отменённого распределения
  const [later] = await db.select({ period: productionCostClosings.period }).from(productionCostClosings).where(and(eq(productionCostClosings.workspaceId, ctx.workspaceId), gt(productionCostClosings.period, start), eq(productionCostClosings.status, 'done'))).limit(1);
  if (later) throw new DomainError(422, 'later_month_closed', `Reopen ${monthOf(later.period)} first: a later month is closed`);
  await dropOwnDeltas(db, ctx.workspaceId, closing.id);
  // после снятия своей части цепочка пересчитывается обратно — средняя склада возвращается прежней
  await recomputeStockCosts(db, ctx.workspaceId);
  await db.update(productionCostClosings).set({ status: 'reopened', updatedAt: new Date() }).where(eq(productionCostClosings.id, closing.id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'production.period_reopened', entity: 'production_closing', recordId: closing.id, actorId: ctx.memberId, payload: { month } });
  return true;
}

/** Дата запрета после закрытия месяца сдвигается на конец закрытого месяца (если включена настройка) */
export async function advanceClosedThrough(db: Db, workspaceId: string, toDate: string): Promise<void> {
  await db.execute(sql`update workspaces set closed_through = greatest(coalesce(closed_through, ${toDate}::date), ${toDate}::date), updated_at = now() where id = ${workspaceId}`);
}

/** Журнал закрытых месяцев (по убыванию периода) */
export async function listClosings(db: Db, workspaceId: string) {
  return db.select().from(productionCostClosings).where(eq(productionCostClosings.workspaceId, workspaceId)).orderBy(desc(productionCostClosings.period));
}

/* ---------------- документ «Прочие затраты» ---------------- */

/** Сумма строк документа «Прочие затраты» */
export async function otherCostsTotal(db: Db, documentId: string): Promise<string> {
  const [row] = await db.select({ total: sql<string>`coalesce(sum(${otherCostLines.amount}), 0)::text` }).from(otherCostLines).where(eq(otherCostLines.documentId, documentId));
  return fmt(dec(row?.total ?? '0'), 2);
}

DOCUMENT_HOOKS.other_costs = {
  /** Проведение: строки — статьи и суммы, товара у них нет; итоги документа и косвенные затраты месяца */
  check: async (db, _ctx, doc) => {
    const lines = await db.select().from(otherCostLines).where(eq(otherCostLines.documentId, doc.id));
    if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one cost line before posting');
    const items = new Map((await db.select({ id: costItems.id, kind: costItems.kind, archivedAt: costItems.archivedAt }).from(costItems).where(inArray(costItems.id, [...new Set(lines.map(l => l.costItemId))]))).map(i => [i.id, i]));
    for (const l of lines) {
      const item = items.get(l.costItemId);
      if (!item || item.archivedAt) throw new DomainError(422, 'invalid_reference', 'The cost item does not exist or is archived');
      if (item.kind !== 'expense') throw new DomainError(422, 'cost_item_kind_mismatch', 'A cost line needs an expense cost item');
    }
  },
  post: async (db, ctx, doc) => {
    const total = await otherCostsTotal(db, doc.id);
    await db.update(documents).set({ amountNet: total, vatTotal: '0.00', total, updatedAt: new Date() }).where(eq(documents.id, doc.id));
    await syncPeriodCosts(db, ctx, { ...doc, type: 'other_costs' }, []);
  },
  /** После отмены проведения косвенные затраты месяца уходят вместе с документом */
  afterUnpost: async (db, ctx, doc) => {
    await clearPeriodCosts(db, ctx.workspaceId, doc.id);
  },
};

