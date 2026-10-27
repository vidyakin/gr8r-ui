/* Себестоимость работ заказ-наряда (задача 1096, docs/architecture/work-orders.md): сбор исходных данных для
   computeWorkOrderCost из shared. Себестоимость «живая» — считается при каждом запросе, в документ не пишется.
   Источники: назначения и записи времени их задач, ставки участков (запасной участок — из нормы работы operations),
   движения заказ-наряда (факт материалов и товаров после выполнения), средняя себестоимость складов (до выполнения),
   проведённые строки «Прочих затрат» с этим заказ-нарядом, косвенные из итогов закрытия месяца (byWorkOrder). */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { computeWorkOrderCost, dec, div, fmt, marginPct, mul, type WorkOrderCost, type WorkOrderCostAssignment, type WorkOrderCostInput, type WorkOrderCostItem, type OverheadTarget, type Dec } from '@gr8r/shared';
import type { Db } from './client';
import { companies, documentLines, documents, members, operations, workOrderKinds, otherCostLines, productionCostClosings, products, stockBalances, stockMoves, tasks, timeLogs, workCenters, workOrderAssignments, workOrderMaterials } from './schema';
import { workspaceTimeZone } from './planning';
import { deliveredCostByWorkOrder } from './delivery';

export interface WorkOrderCostData {
  documentId: string;
  number: string | null;
  date: string;
  status: string;
  state: string | null;
  counterpartyId: string | null;
  input: WorkOrderCostInput;
  cost: WorkOrderCost;
  /** Сколько косвенных пришло из закрытий месяцев: месяцы, по которым есть доля */
  indirectMonths: string[];
  /** Тип вида: гарантийный ремонт — затраты уходят на статью «Гарантийный ремонт» (задача 1099) */
  kindType: string;
}

/** Доля косвенных заказ-нарядов из итогов закрытых месяцев: документ → сумма и месяцы */
async function loadIndirect(db: Db, workspaceId: string): Promise<Map<string, { amount: Dec; months: string[] }>> {
  const rows = await db
    .select({ period: productionCostClosings.period, totals: productionCostClosings.totals })
    .from(productionCostClosings)
    .where(and(eq(productionCostClosings.workspaceId, workspaceId), eq(productionCostClosings.status, 'done')));
  const out = new Map<string, { amount: Dec; months: string[] }>();
  for (const r of rows) {
    const list = ((r.totals as { byWorkOrder?: { documentId: string; allocated: string }[] } | null)?.byWorkOrder ?? []);
    for (const w of list) {
      const cur = out.get(w.documentId) ?? { amount: 0n, months: [] };
      cur.amount += dec(w.allocated);
      const m = r.period.slice(0, 7);
      if (!cur.months.includes(m)) cur.months.push(m);
      out.set(w.documentId, cur);
    }
  }
  return out;
}

/** Данные и расчёт себестоимости для набора заказ-нарядов одним набором запросов. withIndirect=false — без косвенных
    (при закрытии месяца база распределения не должна включать прошлую долю) */
export async function loadWorkOrderCosts(db: Db, workspaceId: string, documentIds: string[], opts: { withIndirect?: boolean } = {}): Promise<Map<string, WorkOrderCostData>> {
  const out = new Map<string, WorkOrderCostData>();
  if (!documentIds.length) return out;
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.type, 'work_order'), inArray(documents.id, documentIds)));
  if (!docs.length) return out;
  const ids = docs.map(d => d.id);
  const kindIds = [...new Set(docs.map(d => d.workOrderKindId).filter((x): x is string => !!x))];
  const kindTypes = new Map((kindIds.length ? await db.select({ id: workOrderKinds.id, t: workOrderKinds.kindType }).from(workOrderKinds).where(inArray(workOrderKinds.id, kindIds)) : []).map(k => [k.id, k.t]));

  // назначения: участок назначения, иначе участок нормы работы строки
  const asg = await db
    .select({
      id: workOrderAssignments.id,
      documentId: workOrderAssignments.documentId,
      taskId: workOrderAssignments.taskId,
      centerId: workOrderAssignments.workCenterId,
      normCenterId: operations.workCenterId,
      plannedHours: workOrderAssignments.plannedHours,
      assigneeId: tasks.assigneeId,
      assigneeName: members.name,
    })
    .from(workOrderAssignments)
    .innerJoin(tasks, eq(tasks.id, workOrderAssignments.taskId))
    .leftJoin(members, eq(members.id, tasks.assigneeId))
    .leftJoin(documentLines, eq(documentLines.id, workOrderAssignments.lineId))
    .leftJoin(operations, and(eq(operations.workspaceId, workOrderAssignments.workspaceId), eq(operations.productId, documentLines.productId)))
    .where(inArray(workOrderAssignments.documentId, ids))
    .orderBy(asc(workOrderAssignments.createdAt));
  const taskIds = asg.map(a => a.taskId);
  const hoursByTask = new Map<string, Dec>();
  if (taskIds.length) {
    const logs = await db
      .select({ taskId: timeLogs.taskId, hours: sql<string>`coalesce(sum(${timeLogs.hours}), 0)::text` })
      .from(timeLogs)
      .where(inArray(timeLogs.taskId, taskIds))
      .groupBy(timeLogs.taskId);
    for (const l of logs) hoursByTask.set(l.taskId, dec(l.hours));
  }
  const centers = new Map((await db.select({ id: workCenters.id, name: workCenters.name, rate: workCenters.hourlyRate }).from(workCenters).where(eq(workCenters.workspaceId, workspaceId))).map(w => [w.id, w]));

  // материалы и товары
  const mats = await db
    .select({ m: workOrderMaterials, name: products.name })
    .from(workOrderMaterials)
    .innerJoin(products, eq(products.id, workOrderMaterials.productId))
    .where(inArray(workOrderMaterials.documentId, ids))
    .orderBy(asc(workOrderMaterials.createdAt));
  const goodsRows = await db
    .select({ documentId: documentLines.documentId, productId: documentLines.productId, qty: documentLines.qty, unitCode: documentLines.unitCode, name: documentLines.name })
    .from(documentLines)
    .innerJoin(products, eq(products.id, documentLines.productId))
    .where(and(inArray(documentLines.documentId, ids), eq(products.kind, 'goods')))
    .orderBy(asc(documentLines.sortOrder));

  // факт: себестоимость списания по движениям проведённого заказ-наряда (строка товара — товары, без строки — материалы)
  const postedIds = docs.filter(d => d.status === 'posted').map(d => d.id);
  const factMat = new Map<string, Dec>();
  const factGoods = new Map<string, Dec>();
  if (postedIds.length) {
    const moves = await db
      .select({
        documentId: stockMoves.documentId,
        productId: stockMoves.productId,
        isLine: sql<boolean>`${stockMoves.documentLineId} is not null`,
        cost: sql<string>`coalesce(sum(-${stockMoves.qty} * ${stockMoves.cost}), 0)::text`,
      })
      .from(stockMoves)
      .where(and(inArray(stockMoves.documentId, postedIds), sql`${stockMoves.qty} < 0`))
      .groupBy(stockMoves.documentId, stockMoves.productId, sql`${stockMoves.documentLineId} is not null`);
    for (const m of moves) (m.isLine ? factGoods : factMat).set(`${m.documentId}:${m.productId}`, dec(m.cost));
  }

  // средняя себестоимость склада: свой склад, иначе средняя по складам с остатком
  const prodIds = [...new Set([...mats.map(m => m.m.productId), ...goodsRows.map(g => g.productId)])];
  const balances = prodIds.length ? await db.select({ warehouseId: stockBalances.warehouseId, productId: stockBalances.productId, qty: stockBalances.qty, avg: stockBalances.avgCost }).from(stockBalances).where(and(eq(stockBalances.workspaceId, workspaceId), inArray(stockBalances.productId, prodIds))) : [];
  const unitCost = (productId: string, warehouseId: string | null): string => {
    const own = warehouseId ? balances.find(b => b.productId === productId && b.warehouseId === warehouseId) : undefined;
    if (own && dec(own.avg) > 0n) return own.avg;
    let qty = 0n;
    let sum = 0n;
    for (const b of balances.filter(x => x.productId === productId && dec(x.qty) > 0n)) {
      qty += dec(b.qty);
      sum += mul(dec(b.qty), dec(b.avg));
    }
    return qty > 0n ? fmt(div(sum, qty), 4) : '0';
  };

  // прочие затраты: проведённые строки на основании заказ-наряда
  const others = await db
    .select({ workOrderId: otherCostLines.workOrderId, amount: sql<string>`coalesce(sum(${otherCostLines.amount}), 0)::text` })
    .from(otherCostLines)
    .innerJoin(documents, eq(documents.id, otherCostLines.documentId))
    .where(and(eq(otherCostLines.workspaceId, workspaceId), inArray(otherCostLines.workOrderId, ids), eq(documents.status, 'posted')))
    .groupBy(otherCostLines.workOrderId);
  const otherBy = new Map(others.map(o => [o.workOrderId!, o.amount]));
  // доставленные доставки заказ-наряда (задача 1100) — тоже прочие затраты
  for (const [id, cost] of await deliveredCostByWorkOrder(db, workspaceId, ids)) otherBy.set(id, fmt(dec(otherBy.get(id) ?? '0') + dec(cost), 2));
  const indirect = opts.withIndirect === false ? new Map<string, { amount: Dec; months: string[] }>() : await loadIndirect(db, workspaceId);

  for (const d of docs) {
    const assignments: WorkOrderCostAssignment[] = asg
      .filter(a => a.documentId === d.id)
      .map(a => {
        const centerId = a.centerId ?? a.normCenterId ?? null;
        const center = centerId ? centers.get(centerId) : undefined;
        return { id: a.id, assigneeId: a.assigneeId, assigneeName: a.assigneeName, workCenterId: center ? centerId : null, workCenterName: center?.name ?? null, plannedHours: a.plannedHours ?? '0', actualHours: fmt(hoursByTask.get(a.taskId) ?? 0n, 3), rate: center ? center.rate : null };
      });
    // материалы и товары — по товару (одна строка на товар)
    const matMap = new Map<string, WorkOrderCostItem>();
    for (const m of mats.filter(x => x.m.documentId === d.id)) {
      const cur = matMap.get(m.m.productId);
      if (cur) cur.qty = fmt(dec(cur.qty) + dec(m.m.qty), 3);
      else matMap.set(m.m.productId, { key: m.m.productId, productId: m.m.productId, name: m.name, unitCode: m.m.unitCode, qty: m.m.qty, unitCost: unitCost(m.m.productId, m.m.warehouseId ?? d.warehouseId), factCost: d.status === 'posted' ? fmt(factMat.get(`${d.id}:${m.m.productId}`) ?? 0n, 4) : null });
    }
    const goodsMap = new Map<string, WorkOrderCostItem>();
    for (const g of goodsRows.filter(x => x.documentId === d.id)) {
      const cur = goodsMap.get(g.productId);
      if (cur) cur.qty = fmt(dec(cur.qty) + dec(g.qty), 3);
      else goodsMap.set(g.productId, { key: g.productId, productId: g.productId, name: g.name, unitCode: g.unitCode, qty: g.qty, unitCost: unitCost(g.productId, d.warehouseId), factCost: d.status === 'posted' ? fmt(factGoods.get(`${d.id}:${g.productId}`) ?? 0n, 4) : null });
    }
    const ind = indirect.get(d.id);
    const input: WorkOrderCostInput = {
      revenueNet: d.amountNet,
      assignments,
      materials: [...matMap.values()],
      goods: [...goodsMap.values()],
      other: otherBy.get(d.id) ?? '0',
      indirect: ind ? fmt(ind.amount, 2) : '0',
    };
    out.set(d.id, { documentId: d.id, number: d.number, date: d.date, status: d.status, state: d.state, counterpartyId: d.counterpartyId, input, cost: computeWorkOrderCost(input), indirectMonths: ind?.months.sort() ?? [], kindType: (d.workOrderKindId && kindTypes.get(d.workOrderKindId)) || 'regular' });
  }
  return out;
}

/** Себестоимость одного заказ-наряда */
export async function workOrderCost(db: Db, workspaceId: string, documentId: string): Promise<WorkOrderCostData | null> {
  return (await loadWorkOrderCosts(db, workspaceId, [documentId])).get(documentId) ?? null;
}

/** Строка журнала: себестоимость факт у выполненного (проведённого), иначе плановая; маржа и процент */
export interface WorkOrderCostBrief {
  cost: string;
  margin: string;
  marginPct: string | null;
  basis: 'plan' | 'fact';
}

export function costBrief(d: WorkOrderCostData): WorkOrderCostBrief {
  const basis = d.status === 'posted' ? 'fact' : 'plan';
  return { cost: d.cost.cost[basis], margin: d.cost.margin[basis], marginPct: d.cost.marginPct[basis], basis };
}

/** Заказ-наряды, выполненные за период: проведённые, вход в «выполнен» (posted_at) по часовому поясу воркспейса */
export async function workOrdersDoneBetween(db: Db, workspaceId: string, from: string, to: string): Promise<string[]> {
  const tz = await workspaceTimeZone(db, workspaceId);
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.type, 'work_order'), eq(documents.status, 'posted'), sql`(${documents.postedAt} at time zone ${tz})::date >= ${from}::date`, sql`(${documents.postedAt} at time zone ${tz})::date <= ${to}::date`))
    .orderBy(asc(documents.postedAt));
  return rows.map(r => r.id);
}

/** Получатели косвенных затрат закрытия месяца: заказ-наряды, выполненные в месяце, по участкам труда.
    База: часы — фактические часы участка (они же заменяют «количество выпуска» у способа «по объёму выпуска»),
    прямые затраты — труд участка плюс материалы, товары и прочие затраты пропорционально часам участка. Без часов получателя нет */
export async function loadWorkOrderTargets(db: Db, workspaceId: string, from: string, to: string): Promise<OverheadTarget[]> {
  const ids = await workOrdersDoneBetween(db, workspaceId, from, to);
  const data = await loadWorkOrderCosts(db, workspaceId, ids, { withIndirect: false });
  const targets: OverheadTarget[] = [];
  for (const id of ids) {
    const d = data.get(id);
    if (!d) continue;
    const hoursTotal = d.cost.labor.byCenter.filter(c => c.workCenterId && dec(c.actualHours) > 0n).reduce((s, c) => s + dec(c.actualHours), 0n);
    if (hoursTotal <= 0n) continue;
    const nonLabor = dec(d.cost.materials.fact) + dec(d.cost.goods.fact) + dec(d.cost.other.fact);
    for (const c of d.cost.labor.byCenter) {
      const hours = dec(c.actualHours);
      if (!c.workCenterId || hours <= 0n) continue;
      const share = (nonLabor * hours) / hoursTotal;
      targets.push({ itemId: `${id}:${c.workCenterId}`, releaseId: id, name: d.number ?? '', workCenterId: c.workCenterId, documentLineId: null, workOrder: true, qty: hours, directCost: dec(c.factAmount) + share, workHours: hours });
    }
  }
  return targets;
}

/* ---------------- отчёт ---------------- */

export interface WorkOrderCostReportRow {
  documentId: string;
  number: string | null;
  date: string;
  /** День выполнения (вход в «выполнен») */
  doneDate: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  revenue: string;
  labor: string;
  materials: string;
  goods: string;
  other: string;
  indirect: string;
  cost: string;
  margin: string;
  marginPct: string | null;
  /** Материалы или товары оценены по средней */
  estimated: boolean;
  /** Гарантийный ремонт: себестоимость относится на статью «Гарантийный ремонт» */
  warranty: boolean;
}

export interface WorkOrderCostReport {
  from: string;
  to: string;
  rows: WorkOrderCostReportRow[];
  totals: { revenue: string; labor: string; materials: string; goods: string; other: string; indirect: string; cost: string; margin: string; marginPct: string | null };
  /** Затраты гарантийного ремонта за период — на статью «Гарантийный ремонт» */
  warrantyCost: string;
}

/** Отчёт «Себестоимость заказ-нарядов»: выполненные за период, факт по видам затрат, выручка и маржа */
export async function workOrderCostReport(db: Db, workspaceId: string, q: { from: string; to: string; counterpartyId?: string }): Promise<WorkOrderCostReport> {
  const ids = await workOrdersDoneBetween(db, workspaceId, q.from, q.to);
  const data = await loadWorkOrderCosts(db, workspaceId, ids);
  const tz = await workspaceTimeZone(db, workspaceId);
  const meta = ids.length
    ? await db
        .select({ id: documents.id, done: sql<string>`((${documents.postedAt} at time zone ${tz})::date)::text`, counterpartyId: documents.counterpartyId, name: companies.name })
        .from(documents)
        .leftJoin(companies, eq(companies.id, documents.counterpartyId))
        .where(inArray(documents.id, ids))
    : [];
  const by = new Map(meta.map(m => [m.id, m]));
  const rows: WorkOrderCostReportRow[] = [];
  for (const id of ids) {
    const d = data.get(id);
    const m = by.get(id);
    if (!d || !m) continue;
    if (q.counterpartyId && d.counterpartyId !== q.counterpartyId) continue;
    const c = d.cost;
    rows.push({ documentId: id, number: d.number, date: d.date, doneDate: m.done, counterpartyId: d.counterpartyId, counterpartyName: m.name ?? null, revenue: c.revenue, labor: c.labor.fact, materials: c.materials.fact, goods: c.goods.fact, other: c.other.fact, indirect: c.indirect.fact, cost: c.cost.fact, margin: c.margin.fact, marginPct: c.marginPct.fact, estimated: c.estimated, warranty: d.kindType === 'warranty' });
  }
  const sum = (f: (r: WorkOrderCostReportRow) => string) => rows.reduce((s, r) => s + dec(f(r)), 0n);
  const revenue = sum(r => r.revenue);
  const margin = sum(r => r.margin);
  return {
    from: q.from,
    to: q.to,
    rows,
    totals: { revenue: fmt(revenue, 2), labor: fmt(sum(r => r.labor), 2), materials: fmt(sum(r => r.materials), 2), goods: fmt(sum(r => r.goods), 2), other: fmt(sum(r => r.other), 2), indirect: fmt(sum(r => r.indirect), 2), cost: fmt(sum(r => r.cost), 2), margin: fmt(margin, 2), marginPct: marginPct(margin, revenue) },
    warrantyCost: fmt(rows.filter(r => r.warranty).reduce((s, r) => s + dec(r.cost), 0n), 2),
  };
}
