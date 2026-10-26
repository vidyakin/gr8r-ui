/* Отчёты производства (задача 1091, часть 1), раздел docs/architecture/production-reports.md.
   Выпуск продукции, заказы на производство, план-факт производства, нормативный состав изделия, загрузка участков.
   Количества видит любой участник; стоимость нормативного состава маскирует API (admin и owner) — maskBomReport. */
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  addDays,
  computeBomCost,
  dec,
  diffDays,
  div,
  explodeBom,
  fmt,
  mul,
  planPeriods,
  resolveMaterialPrice,
  BomFormulaError,
  type CostPriceSource,
  type Explosion,
  type MaterialPriceSource,
} from '@gr8r/shared';
import type { Db } from './client';
import { loadLastPurchasePrices, resolveCostPrice } from './calculations';
import { wipBalance } from './production-wip';
import { DomainError } from './errors';
import { workspaceLoad } from './planning';
import { GOOD_QTY, loadProductionGraph } from './production';
import { documents, manufacturedItems, materialAllocationRows, pieceworkHeaders, pieceworkLines, productionComponents, productionCostClosings, productionHeaders, productionItems, productionPlanLines, productionPlans, productionStages, products, stockCostAdjustments, stockMoves, workCenters } from './schema';

/** Период не длиннее года: отчёт по дням иначе слишком тяжёлый */
function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError(422, 'report_period_invalid', 'The period start is after its end');
  if (diffDays(from, to) > 366) throw new DomainError(422, 'report_period_invalid', 'The period is longer than a year');
}

const nameMap = async (db: Db, workspaceId: string) => new Map((await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(eq(workCenters.workspaceId, workspaceId))).map(c => [c.id, c.name]));

/** Приём продукции: у выпуска без этапа или финальным этапом */
const FINAL_RELEASE = sql`(${productionHeaders.stageId} is null or ${productionStages.isFinal} is true)`;

/* ---------------- выпуск продукции ---------------- */

export interface ReleaseRow {
  itemId: string;
  itemName: string;
  documentId: string;
  number: string | null;
  date: string;
  workCenterName: string | null;
  qty: string;
  defectQty: string;
  goodQty: string;
}

export interface ReleaseReport {
  from: string;
  to: string;
  rows: ReleaseRow[];
}

/** Выпуск продукции за период: проведённые выпуски, приём финальным этапом; изделие → документ */
export async function releaseReport(db: Db, workspaceId: string, q: { from: string; to: string; workCenterId?: string | undefined; itemId?: string | undefined }): Promise<ReleaseReport> {
  assertPeriod(q.from, q.to);
  const rows = await db
    .select({
      itemId: productionItems.itemId,
      itemName: manufacturedItems.name,
      documentId: documents.id,
      number: documents.number,
      date: documents.date,
      center: productionHeaders.workCenterId,
      qty: sql<string>`sum(${productionItems.qty})`,
      defect: sql<string>`sum(${productionItems.defectQty})`,
      good: sql<string>`sum(${GOOD_QTY})`,
    })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionItems.itemId))
    .leftJoin(productionHeaders, and(eq(productionHeaders.workspaceId, workspaceId), eq(productionHeaders.documentId, documents.id)))
    .leftJoin(productionStages, eq(productionStages.id, productionHeaders.stageId))
    .where(
      and(
        eq(productionItems.workspaceId, workspaceId),
        eq(documents.type, 'production'),
        eq(documents.status, 'posted'),
        gte(documents.date, q.from),
        lte(documents.date, q.to),
        FINAL_RELEASE,
        q.workCenterId ? eq(productionHeaders.workCenterId, q.workCenterId) : undefined,
        q.itemId ? eq(productionItems.itemId, q.itemId) : undefined,
      ),
    )
    .groupBy(productionItems.itemId, manufacturedItems.name, documents.id, documents.number, documents.date, productionHeaders.workCenterId);
  const centers = await nameMap(db, workspaceId);
  const out: ReleaseRow[] = rows.map(r => ({
    itemId: r.itemId,
    itemName: r.itemName,
    documentId: r.documentId,
    number: r.number,
    date: r.date,
    workCenterName: r.center ? (centers.get(r.center) ?? null) : null,
    qty: fmt(dec(r.qty), 3),
    defectQty: fmt(dec(r.defect), 3),
    goodQty: fmt(dec(r.good), 3),
  }));
  out.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.date.localeCompare(b.date) || (a.number ?? '').localeCompare(b.number ?? ''));
  return { from: q.from, to: q.to, rows: out };
}

/* ---------------- заказы на производство ---------------- */

export interface OrderReportRow {
  orderId: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  state: string | null;
  workCenterName: string | null;
  itemId: string;
  itemName: string;
  /** Остаток на начало: заказано до периода минус выпущено до периода */
  opening: string;
  /** Приход: заказано в периоде */
  ordered: string;
  /** Расход: выпущено в периоде (годное, финальный этап) */
  produced: string;
  closing: string;
  /** Просрочка в днях (0 — в срок или нечего выпускать) */
  overdueDays: number;
}

export interface OrdersReport {
  from: string;
  to: string;
  today: string;
  rows: OrderReportRow[];
}

/** Заказы на производство: по заказу и позиции — остаток на начало, заказано, выпущено, остаток на конец, срок и просрочка */
export async function ordersReport(db: Db, workspaceId: string, q: { from: string; to: string; workCenterId?: string | undefined; itemId?: string | undefined; today?: string | undefined }): Promise<OrdersReport> {
  assertPeriod(q.from, q.to);
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const orderItems = await db
    .select({
      id: productionItems.id,
      itemId: productionItems.itemId,
      itemName: manufacturedItems.name,
      qty: productionItems.qty,
      orderId: documents.id,
      number: documents.number,
      date: documents.date,
      dueDate: documents.dueDate,
      state: documents.state,
      center: productionHeaders.workCenterId,
      plannedEnd: productionHeaders.plannedEnd,
    })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionItems.itemId))
    .leftJoin(productionHeaders, and(eq(productionHeaders.workspaceId, workspaceId), eq(productionHeaders.documentId, documents.id)))
    .where(
      and(
        eq(productionItems.workspaceId, workspaceId),
        eq(documents.type, 'production_order'),
        eq(documents.status, 'posted'),
        lte(documents.date, q.to),
        q.workCenterId ? eq(productionHeaders.workCenterId, q.workCenterId) : undefined,
        q.itemId ? eq(productionItems.itemId, q.itemId) : undefined,
      ),
    );
  const ids = orderItems.map(o => o.id);
  // выпущено по позициям заказов: до начала периода и внутри него
  const before = new Map<string, bigint>();
  const inside = new Map<string, bigint>();
  if (ids.length) {
    const made = await db
      .select({ source: productionItems.sourceItemId, date: documents.date, qty: sql<string>`sum(${GOOD_QTY})` })
      .from(productionItems)
      .innerJoin(documents, eq(documents.id, productionItems.documentId))
      .leftJoin(productionHeaders, and(eq(productionHeaders.workspaceId, workspaceId), eq(productionHeaders.documentId, documents.id)))
      .leftJoin(productionStages, eq(productionStages.id, productionHeaders.stageId))
      .where(and(inArray(productionItems.sourceItemId, ids), eq(documents.type, 'production'), eq(documents.status, 'posted'), lte(documents.date, q.to), FINAL_RELEASE))
      .groupBy(productionItems.sourceItemId, documents.date);
    for (const m of made) {
      const bucket = m.date < q.from ? before : inside;
      bucket.set(m.source!, (bucket.get(m.source!) ?? 0n) + dec(m.qty));
    }
  }
  const centers = await nameMap(db, workspaceId);
  const rows: OrderReportRow[] = [];
  for (const o of orderItems) {
    const ordBefore = o.date < q.from ? dec(o.qty) : 0n;
    const ordIn = o.date < q.from ? 0n : dec(o.qty);
    const opening = ordBefore - (before.get(o.id) ?? 0n);
    const produced = inside.get(o.id) ?? 0n;
    const closing = opening + ordIn - produced;
    // заказ без движения и без остатка в отчёт не попадает
    if (opening === 0n && ordIn === 0n && produced === 0n) continue;
    const due = o.dueDate ?? (o.plannedEnd ? o.plannedEnd.toISOString().slice(0, 10) : null);
    rows.push({
      orderId: o.orderId,
      number: o.number,
      date: o.date,
      dueDate: due,
      state: o.state,
      workCenterName: o.center ? (centers.get(o.center) ?? null) : null,
      itemId: o.itemId,
      itemName: o.itemName,
      opening: fmt(opening, 3),
      ordered: fmt(ordIn, 3),
      produced: fmt(produced, 3),
      closing: fmt(closing, 3),
      overdueDays: due && closing > 0n && due < today ? diffDays(due, today) : 0,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.number ?? '').localeCompare(b.number ?? '') || a.itemName.localeCompare(b.itemName));
  return { from: q.from, to: q.to, today, rows };
}

/* ---------------- план-факт производства ---------------- */

export interface PlanFactRow {
  itemId: string;
  itemName: string;
  periodStart: string;
  periodEnd: string;
  plan: string;
  fact: string;
  /** Отклонение: факт минус план */
  deviation: string;
  /** Выполнение плана, % (null — план нулевой) */
  pct: string | null;
}

export interface PlanFactReport {
  from: string;
  to: string;
  rows: PlanFactRow[];
}

/** План-факт: строки планов производства периода против выпуска изделия внутри периода строки */
export async function planFactReport(db: Db, workspaceId: string, q: { from: string; to: string; itemId?: string | undefined }): Promise<PlanFactReport> {
  assertPeriod(q.from, q.to);
  const lines = await db
    .select({ itemId: productionPlanLines.itemId, itemName: manufacturedItems.name, start: productionPlanLines.periodStart, qty: productionPlanLines.qty, planFrom: productionPlans.periodFrom, planTo: productionPlans.periodTo, step: productionPlans.step })
    .from(productionPlanLines)
    .innerJoin(productionPlans, eq(productionPlans.id, productionPlanLines.planId))
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionPlanLines.itemId))
    .where(and(eq(productionPlanLines.workspaceId, workspaceId), isNull(productionPlans.archivedAt), gte(productionPlanLines.periodStart, q.from), lte(productionPlanLines.periodStart, q.to), q.itemId ? eq(productionPlanLines.itemId, q.itemId) : undefined));
  // конец периода строки — день перед началом следующего периода плана (последний — конец плана)
  const buckets = new Map<string, { itemId: string; itemName: string; start: string; end: string; plan: bigint }>();
  for (const l of lines) {
    const starts = planPeriods(l.planFrom, l.planTo, l.step);
    const next = starts[starts.indexOf(l.start) + 1];
    const end = next ? addDays(next, -1) : l.planTo;
    const key = `${l.itemId}|${l.start}|${end}`;
    const b = buckets.get(key) ?? { itemId: l.itemId, itemName: l.itemName, start: l.start, end, plan: 0n };
    b.plan += dec(l.qty);
    buckets.set(key, b);
  }
  const list = [...buckets.values()];
  const itemIds = [...new Set(list.map(b => b.itemId))];
  // выпуск изделий по дням, дальше раскладывается по периодам
  const made: { itemId: string; date: string; qty: string }[] = itemIds.length
    ? await db
        .select({ itemId: productionItems.itemId, date: documents.date, qty: sql<string>`sum(${GOOD_QTY})` })
        .from(productionItems)
        .innerJoin(documents, eq(documents.id, productionItems.documentId))
        .leftJoin(productionHeaders, and(eq(productionHeaders.workspaceId, workspaceId), eq(productionHeaders.documentId, documents.id)))
        .leftJoin(productionStages, eq(productionStages.id, productionHeaders.stageId))
        .where(and(eq(productionItems.workspaceId, workspaceId), inArray(productionItems.itemId, itemIds), eq(documents.type, 'production'), eq(documents.status, 'posted'), FINAL_RELEASE))
        .groupBy(productionItems.itemId, documents.date)
    : [];
  const rows: PlanFactRow[] = list.map(b => {
    const fact = made.filter(m => m.itemId === b.itemId && m.date >= b.start && m.date <= b.end).reduce((s, m) => s + dec(m.qty), 0n);
    return {
      itemId: b.itemId,
      itemName: b.itemName,
      periodStart: b.start,
      periodEnd: b.end,
      plan: fmt(b.plan, 3),
      fact: fmt(fact, 3),
      deviation: fmt(fact - b.plan, 3),
      pct: b.plan > 0n ? fmt(div(mul(fact, dec('100')), b.plan), 1) : null,
    };
  });
  rows.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.periodStart.localeCompare(b.periodStart));
  return { from: q.from, to: q.to, rows };
}

/* ---------------- нормативный состав изделия ---------------- */

export type BomReportRowKind = 'material' | 'expense' | 'semi' | 'work' | 'overhead';

export interface BomReportRow {
  kind: BomReportRowKind;
  /** Уровень вложенности: строки состава полуфабриката — 1 и дальше; в итог не входят (nested) */
  level: number;
  nested: boolean;
  stageId: string | null;
  stageName: string | null;
  stageOrder: number;
  name: string;
  unitCode: string | null;
  qty: string;
  /** Нормативное время, ч (у операций) */
  hours: string;
  workCenterName: string | null;
  /** Цена и сумма (null — нет доступа к себестоимости) */
  price: string | null;
  amount: string | null;
}

export interface BomReport {
  itemId: string;
  itemName: string;
  qty: string;
  priceMode: 'price_kind' | 'last_purchase';
  priceKind: MaterialPriceSource;
  rows: BomReportRow[];
  hoursTotal: string;
  /** Себестоимость на qty изделий и на единицу (null — нет доступа) */
  total: string | null;
  unitTotal: string | null;
  /** Материалов без цены в выбранном виде цен */
  unpriced: number;
}

const KIND_ORDER: Record<BomReportRowKind, number> = { material: 0, expense: 1, semi: 2, work: 3, overhead: 4 };

/** Развёртка спецификации изделия на количество: материалы, полуфабрикаты, операции с нормативным временем и себестоимость */
export async function bomReport(db: Db, workspaceId: string, q: { itemId: string; qty: string; priceMode: 'price_kind' | 'last_purchase'; priceKind: MaterialPriceSource; params?: Record<string, unknown> | undefined }): Promise<BomReport> {
  const graph = await loadProductionGraph(db);
  const item = graph.items.find(i => i.id === q.itemId);
  if (!item) throw new DomainError(404, 'not_found', 'item not found');
  const prod = new Map(graph.mats.map(p => [p.id, p]));
  const rates = new Map(graph.centers.map(w => [w.id, w.hourlyRate]));
  const centerName = new Map(graph.centers.map(w => [w.id, w.name]));
  const last = q.priceMode === 'last_purchase' ? await loadLastPurchasePrices(db, graph.mats.map(p => p.id)) : new Map<string, string>();
  const lastSource: CostPriceSource = 'last_purchase';
  const priceOf = (pid: string): string | null => {
    const p = prod.get(pid);
    if (!p) return null;
    const v = q.priceMode === 'last_purchase' ? resolveCostPrice(lastSource, p, graph.avg.get(pid), last.get(pid)) : resolveMaterialPrice(q.priceKind, p, graph.avg.get(pid));
    return v !== null && dec(v) > 0n ? v : null;
  };
  const pricing = { materialPrice: priceOf, wastePrice: priceOf, workCenterRate: (wid: string) => rates.get(wid) };
  const stages = new Map((await db.select({ id: productionStages.id, name: productionStages.name, sortOrder: productionStages.sortOrder }).from(productionStages).where(eq(productionStages.workspaceId, workspaceId))).map(s => [s.id, s]));
  let explosion: Explosion;
  let unit: string;
  // значения параметров спецификации идут в корень развёртки: формулы строк считаются по ним
  const inputs = q.params && Object.keys(q.params).length ? graph.inputs.map(i => (i.id === q.itemId ? { ...i, params: q.params } : i)) : graph.inputs;
  try {
    explosion = explodeBom(inputs, q.itemId, q.qty);
    unit = computeBomCost(inputs, q.itemId, pricing).unit.total;
  } catch (e) {
    // ошибка формулы: код для перевода, без идентификатора строки в тексте
    if (e instanceof BomFormulaError) throw new DomainError(422, e.code === 'formula_param' ? 'formula_param' : 'formula_error', e.message.replace(/^Line [0-9a-f-]{36}: /, ''));
    throw new DomainError(422, 'formula_error', 'The bill of materials cannot be expanded');
  }
  const rows: BomReportRow[] = [];
  let unpriced = 0;
  const stageOf = (id: string | null | undefined) => {
    const s = id ? stages.get(id) : undefined;
    return { stageId: id ?? null, stageName: s?.name ?? null, stageOrder: s ? s.sortOrder : 9999 };
  };
  /** scale — во сколько раз количества ветки отличаются от записанных в развёртке (для состава полуфабриката) */
  const walk = (ex: Explosion, scale: bigint, level: number) => {
    const nested = level > 0;
    for (const m of ex.materials) {
      const price = priceOf(m.productId);
      if (!price && !nested) unpriced += 1;
      const qty = mul(dec(m.qty), scale);
      rows.push({ kind: m.expense ? 'expense' : 'material', level, nested, ...stageOf(m.stageId), name: prod.get(m.productId)?.name ?? '', unitCode: m.unitCode ?? prod.get(m.productId)?.unitCode ?? null, qty: fmt(qty, 3), hours: '0', workCenterName: null, price: price ?? '0', amount: fmt(mul(qty, dec(price ?? '0')), 2) });
    }
    for (const s of ex.semis) {
      const qty = mul(dec(s.qty), scale);
      const price = computeBomCost(graph.inputs, s.itemId, pricing).unit.total;
      rows.push({ kind: 'semi', level, nested, ...stageOf(s.stageId), name: s.name, unitCode: s.unitCode, qty: fmt(qty, 3), hours: '0', workCenterName: null, price, amount: fmt(mul(qty, dec(price)), 2) });
      // состав полуфабриката: справочно, в итог не входит; разложение задано на партию
      if (s.child) walk(s.child, div(qty, dec(s.batchQty)), level + 1);
    }
    for (const w of ex.works) {
      const rate = w.rate ?? (w.workCenterId ? (rates.get(w.workCenterId) ?? null) : null);
      const hours = mul(dec(w.hours), scale);
      const cost = mul(hours, dec(rate ?? '0')) + mul(dec(w.fixedCost ?? '0'), scale);
      rows.push({ kind: 'work', level, nested, ...stageOf(w.stageId), name: w.operation, unitCode: null, qty: '0', hours: fmt(hours, 3), workCenterName: w.workCenterId ? (centerName.get(w.workCenterId) ?? null) : null, price: rate ?? '0', amount: fmt(cost, 2) });
    }
  };
  walk(explosion, dec('1'), 0);
  // накладные и разница округления — отдельной строкой, чтобы сумма строк сошлась с себестоимостью
  const total = mul(dec(unit), dec(q.qty));
  const sum = rows.filter(r => !r.nested).reduce((s, r) => s + dec(r.amount), 0n);
  if (total !== sum) rows.push({ kind: 'overhead', level: 0, nested: false, stageId: null, stageName: null, stageOrder: 9999, name: '', unitCode: null, qty: '0', hours: '0', workCenterName: null, price: null, amount: fmt(total - sum, 2) });
  // состав полуфабриката идёт сразу под ним и в его группе этапа
  const blocks: BomReportRow[][] = [];
  for (const r of rows) {
    const head = blocks.at(-1)?.[0];
    if (r.nested && head) blocks.at(-1)!.push({ ...r, stageId: head.stageId, stageName: head.stageName, stageOrder: head.stageOrder });
    else blocks.push([r]);
  }
  blocks.sort(([a], [b]) => a!.stageOrder - b!.stageOrder || KIND_ORDER[a!.kind] - KIND_ORDER[b!.kind]);
  rows.splice(0, rows.length, ...blocks.flat());
  const hoursTotal = rows.filter(r => !r.nested).reduce((s, r) => s + dec(r.hours), 0n);
  return { itemId: item.id, itemName: item.name, qty: q.qty, priceMode: q.priceMode, priceKind: q.priceKind, rows, hoursTotal: fmt(hoursTotal, 3), total: fmt(total, 2), unitTotal: fmt(dec(unit), 2), unpriced };
}

/** Стоимость видят только роли с доступом к себестоимости; нормы времени и количества остаются */
export function maskBomReport(r: BomReport, seeCost: boolean): BomReport {
  if (seeCost) return r;
  return { ...r, total: null, unitTotal: null, rows: r.rows.filter(x => x.kind !== 'overhead').map(x => ({ ...x, price: null, amount: null })) };
}

/* ---------------- загрузка участков ---------------- */

export interface LoadReportDay {
  date: string;
  capacity: string;
  planned: string;
  fact: string;
  overloaded: boolean;
}

export interface LoadReportRow {
  workCenterId: string;
  workCenterName: string;
  /** Мощность по графику за период, ч */
  capacity: string;
  /** Запланировано планировщиком, ч */
  planned: string;
  /** Факт: нормочасы проведённых сдельных нарядов, ч */
  fact: string;
  /** Загрузка планом и фактом, % от мощности (null — мощности нет) */
  plannedPct: string | null;
  factPct: string | null;
  overloaded: boolean;
  days: LoadReportDay[];
}

export interface LoadReport {
  from: string;
  to: string;
  rows: LoadReportRow[];
}

/** Загрузка участков: мощность по графику, запланировано (тот же расчёт, что GET /production/load) и факт по нарядам */
export async function loadReport(db: Db, workspaceId: string, q: { from: string; to: string; workCenterId?: string | undefined }): Promise<LoadReport> {
  assertPeriod(q.from, q.to);
  const load = await workspaceLoad(db, workspaceId, { from: q.from, to: q.to, rowType: 'work_center' });
  const facts = await db
    .select({ center: pieceworkHeaders.workCenterId, date: documents.date, hours: sql<string>`sum(${pieceworkLines.hours})` })
    .from(pieceworkLines)
    .innerJoin(documents, eq(documents.id, pieceworkLines.documentId))
    .innerJoin(pieceworkHeaders, and(eq(pieceworkHeaders.workspaceId, workspaceId), eq(pieceworkHeaders.documentId, documents.id)))
    .where(and(eq(pieceworkLines.workspaceId, workspaceId), eq(documents.status, 'posted'), gte(documents.date, q.from), lte(documents.date, q.to)))
    .groupBy(pieceworkHeaders.workCenterId, documents.date);
  const factOf = new Map<string, bigint>();
  for (const f of facts) if (f.center) factOf.set(`${f.center}|${f.date}`, dec(f.hours));
  const pct = (a: bigint, cap: bigint) => (cap > 0n ? fmt(div(mul(a, dec('100')), cap), 1) : null);
  const rows: LoadReportRow[] = [];
  for (const r of load.result) {
    if (q.workCenterId && r.rowId !== q.workCenterId) continue;
    let capacity = 0n;
    let planned = 0n;
    let fact = 0n;
    const days: LoadReportDay[] = [];
    for (const d of r.days) {
      const f = factOf.get(`${r.rowId}|${d.date}`) ?? 0n;
      capacity += dec(d.capacity);
      planned += dec(d.hours);
      fact += f;
      if (dec(d.capacity) > 0n || dec(d.hours) > 0n || f > 0n) days.push({ date: d.date, capacity: d.capacity, planned: d.hours, fact: fmt(f, 2), overloaded: d.overloaded || f > dec(d.capacity) });
    }
    if (!days.length) continue;
    rows.push({ workCenterId: r.rowId, workCenterName: r.name, capacity: fmt(capacity, 2), planned: fmt(planned, 2), fact: fmt(fact, 2), plannedPct: pct(planned, capacity), factPct: pct(fact, capacity), overloaded: days.some(d => d.overloaded), days });
  }
  return { from: q.from, to: q.to, rows };
}

/* ---------------- себестоимость выпуска (часть 2) ---------------- */

/** Виды затрат колонками; сумма видов по выпуску равна себестоимости прихода продукции на склад.
    other — накладные % спецификации, НЗП предыдущих этапов (с их распределением и косвенными), вычет возвратных отходов, округление */
export const COST_KINDS = ['materials', 'semi', 'alloc', 'work', 'services', 'indirect', 'other'] as const;
export type CostKind = (typeof COST_KINDS)[number];

export interface CostReportRow {
  itemId: string;
  itemName: string;
  documentId: string;
  number: string | null;
  date: string;
  workCenterName: string | null;
  /** Принято на склад (годное и брак «на расходы») */
  qty: string;
  materials: string;
  semi: string;
  alloc: string;
  work: string;
  services: string;
  indirect: string;
  other: string;
  /** Себестоимость прихода: сумма видов затрат */
  total: string;
  /** Косвенные по статьям затрат */
  indirectItems: { costItemId: string | null; name: string; amount: string }[];
}

export interface CostReport {
  from: string;
  to: string;
  rows: CostReportRow[];
  /** Косвенные всего по статьям затрат */
  indirectItems: { costItemId: string | null; name: string; amount: string }[];
}

/** Себестоимость выпуска: по выпущенной продукции финальным этапом — виды затрат; изделие → документ выпуска.
    Выпуски из давальческого сырья и разборки в отчёт не входят: у них нет прихода продукции с себестоимостью на наш склад */
export async function releaseCostReport(db: Db, workspaceId: string, q: { from: string; to: string; workCenterId?: string | undefined; itemId?: string | undefined }): Promise<CostReport> {
  assertPeriod(q.from, q.to);
  const items = await db
    .select({
      id: productionItems.id,
      itemId: productionItems.itemId,
      itemName: manufacturedItems.name,
      documentId: documents.id,
      number: documents.number,
      date: documents.date,
      center: productionHeaders.workCenterId,
      lineId: productionItems.documentLineId,
      allocCost: productionItems.allocCost,
      source: productionItems.sourceItemId,
      customer: productionItems.customerOrderLineId,
      itemQty: productionItems.qty,
    })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionItems.itemId))
    .leftJoin(productionHeaders, and(eq(productionHeaders.workspaceId, workspaceId), eq(productionHeaders.documentId, documents.id)))
    .leftJoin(productionStages, eq(productionStages.id, productionHeaders.stageId))
    .where(
      and(
        eq(productionItems.workspaceId, workspaceId),
        eq(documents.type, 'production'),
        eq(documents.status, 'posted'),
        gte(documents.date, q.from),
        lte(documents.date, q.to),
        FINAL_RELEASE,
        sql`${productionItems.documentLineId} is not null`,
        sql`${productionHeaders.processingOrderId} is null`,
        sql`${documents.operation} is distinct from 'disassembly'`,
        q.workCenterId ? eq(productionHeaders.workCenterId, q.workCenterId) : undefined,
        q.itemId ? eq(productionItems.itemId, q.itemId) : undefined,
      ),
    );
  if (!items.length) return { from: q.from, to: q.to, rows: [], indirectItems: [] };
  const lineIds = items.map(i => i.lineId!);
  const itemIds = items.map(i => i.id);
  const docIds = [...new Set(items.map(i => i.documentId))];

  // приход продукции: количество × (записанная цена + корректировка), своя часть закрытия — отдельно
  const moves = await db
    .select({
      lineId: stockMoves.documentLineId,
      qty: sql<string>`sum(${stockMoves.qty})`,
      base: sql<string>`sum(${stockMoves.qty} * ${stockMoves.cost})`,
      delta: sql<string>`coalesce(sum(${stockMoves.qty} * ${stockCostAdjustments.deltaCost}), 0)`,
      own: sql<string>`coalesce(sum(${stockMoves.qty} * ${stockCostAdjustments.ownDelta}), 0)`,
    })
    .from(stockMoves)
    .leftJoin(stockCostAdjustments, and(eq(stockCostAdjustments.workspaceId, stockMoves.workspaceId), eq(stockCostAdjustments.moveId, stockMoves.id)))
    .where(and(eq(stockMoves.workspaceId, workspaceId), inArray(stockMoves.documentLineId, lineIds), sql`${stockMoves.qty} > 0`))
    .groupBy(stockMoves.documentLineId);
  const moveOf = new Map(moves.map(m => [m.lineId!, m]));

  // промежуточные этапы тех же заказов: их затраты финальный выпуск принимает через НЗП (как в production-wip.ts)
  const sources = [...new Set(items.map(i => i.source).filter((x): x is string => !!x))];
  const customers = [...new Set(items.map(i => i.customer).filter((x): x is string => !!x))];
  const interim =
    sources.length || customers.length
      ? await db
          .select({
            id: productionItems.id,
            documentId: documents.id,
            date: documents.date,
            source: productionItems.sourceItemId,
            customer: productionItems.customerOrderLineId,
            stageId: productionHeaders.stageId,
            qty: productionItems.qty,
            defectQty: productionItems.defectQty,
            stageCost: productionItems.stageCost,
            allocCost: productionItems.allocCost,
            closingCost: productionItems.closingCost,
          })
          .from(productionItems)
          .innerJoin(documents, eq(documents.id, productionItems.documentId))
          .innerJoin(productionHeaders, and(eq(productionHeaders.workspaceId, workspaceId), eq(productionHeaders.documentId, documents.id)))
          .innerJoin(productionStages, eq(productionStages.id, productionHeaders.stageId))
          .where(
            and(
              eq(productionItems.workspaceId, workspaceId),
              eq(documents.type, 'production'),
              eq(documents.status, 'posted'),
              eq(productionStages.isFinal, false),
              lte(documents.date, q.to),
              or(sources.length ? inArray(productionItems.sourceItemId, sources) : undefined, customers.length ? inArray(productionItems.customerOrderLineId, customers) : undefined),
            ),
          )
      : [];
  const allIds = [...itemIds, ...interim.map(i => i.id)];
  const allDocs = [...new Set([...docIds, ...interim.map(i => i.documentId)])];
  const comps = await db
    .select({ id: productionComponents.id, itemId: productionComponents.itemId, kind: productionComponents.kind, ownerKind: productionComponents.ownerKind, actualCost: productionComponents.actualCost, plannedCost: productionComponents.plannedCost, hours: productionComponents.hours, rate: productionComponents.rate, fixedCost: productionComponents.fixedCost })
    .from(productionComponents)
    .where(and(eq(productionComponents.workspaceId, workspaceId), inArray(productionComponents.itemId, allIds), inArray(productionComponents.kind, ['material', 'semi', 'work', 'expense'])));
  // сдельные наряды: фактическая стоимость работ по строке состава
  const pw = await db
    .select({ componentId: pieceworkLines.componentId, amount: sql<string>`coalesce(sum(${pieceworkLines.amount}), 0)` })
    .from(pieceworkLines)
    .innerJoin(documents, eq(documents.id, pieceworkLines.documentId))
    .where(and(inArray(pieceworkLines.releaseDocumentId, allDocs), eq(documents.status, 'posted'), sql`${pieceworkLines.componentId} is not null`))
    .groupBy(pieceworkLines.componentId);
  const workFact = new Map(pw.map(r => [r.componentId!, dec(r.amount)]));
  const compsOf = new Map<string, typeof comps>();
  for (const c of comps) compsOf.set(c.itemId!, [...(compsOf.get(c.itemId!) ?? []), c]);
  /** Виды затрат позиции по строкам состава: материалы, полуфабрикаты, работы, услуги */
  const direct = (id: string) => {
    const out = { materials: 0n, semi: 0n, work: 0n, services: 0n };
    for (const c of compsOf.get(id) ?? []) {
      if (c.kind === 'work') out.work += workFact.get(c.id) ?? mul(dec(c.hours), dec(c.rate ?? '0')) + dec(c.fixedCost ?? '0');
      else if (c.kind === 'expense') out.services += dec(c.actualCost ?? c.plannedCost);
      else if (c.ownerKind === 'customer') continue;
      else if (c.kind === 'semi') out.semi += dec(c.actualCost ?? '0');
      else out.materials += dec(c.actualCost ?? '0');
    }
    return out;
  };

  // расшифровка косвенных: результат закрытия месяца (byRelease[].byCostItem по позиции выпуска, в том числе промежуточного этапа)
  const months = [...new Set([...items.map(i => i.date), ...interim.map(i => i.date)].map(d => `${d.slice(0, 7)}-01`))];
  const closings = await db.select({ period: productionCostClosings.period, totals: productionCostClosings.totals }).from(productionCostClosings).where(and(eq(productionCostClosings.workspaceId, workspaceId), eq(productionCostClosings.status, 'done'), inArray(productionCostClosings.period, months)));
  const split = new Map<string, { costItemId: string; name: string; amount: string }[]>();
  for (const c of closings) {
    for (const r of ((c.totals as { byRelease?: { itemId: string; byCostItem?: { costItemId: string; name: string; amount: string }[] }[] }).byRelease ?? [])) if (r.byCostItem?.length) split.set(r.itemId, r.byCostItem);
  }
  /** Сумма indirect, разложенная по статьям пропорционально долям закрытия (остаток округления — на последнюю) */
  const byParts = (id: string, amount: bigint): { costItemId: string | null; name: string; amount: bigint }[] => {
    if (amount === 0n) return [];
    const parts = split.get(id) ?? [];
    const shareSum = parts.reduce((s, p) => s + dec(p.amount), 0n);
    if (!parts.length || shareSum <= 0n) return [{ costItemId: null, name: '', amount }];
    let left = amount;
    return parts.map((p, i) => {
      const part = i === parts.length - 1 ? left : div(mul(amount, dec(p.amount)), shareSum);
      left -= part;
      return { costItemId: p.costItemId, name: p.name, amount: part };
    });
  };

  const centers = await nameMap(db, workspaceId);
  const rows: CostReportRow[] = [];
  const byItem = new Map<string, { costItemId: string | null; name: string; amount: bigint }>();
  for (const it of items) {
    const m = moveOf.get(it.lineId!);
    if (!m) continue;
    const total = dec(m.base) + dec(m.delta);
    let { materials, semi, work, services } = direct(it.id);
    let alloc = dec(it.allocCost);
    let indirect = dec(m.own);
    const parts = byParts(it.id, indirect);
    // затраты промежуточных этапов, принятые этим выпуском: доля этапа = принято / выполнено этапом (как финальный этап забирает НЗП)
    const mine = interim.filter(x => x.date <= it.date && ((it.source && x.source === it.source) || (it.customer && x.customer === it.customer)));
    const stageIds = [...new Set(mine.map(x => x.stageId))];
    for (const st of stageIds) {
      const list = mine.filter(x => x.stageId === st);
      const done = list.reduce((s, x) => s + dec(x.qty) - dec(x.defectQty), 0n);
      if (done <= 0n) continue;
      const taken = dec(it.itemQty) < done ? dec(it.itemQty) : done;
      const share = (v: bigint) => div(mul(v, taken), done);
      for (const x of list) {
        const d = direct(x.id);
        materials += share(d.materials);
        semi += share(d.semi);
        work += share(d.work);
        services += share(d.services);
        alloc += share(dec(x.allocCost));
        const ic = share(dec(x.closingCost));
        indirect += ic;
        parts.push(...byParts(x.id, ic));
      }
    }
    const other = total - materials - semi - alloc - work - services - indirect;
    // косвенные по статьям: свои и принятые от этапов, одинаковые статьи складываются
    const merged = new Map<string, { costItemId: string | null; name: string; amount: bigint }>();
    for (const p of parts) {
      const g = merged.get(p.costItemId ?? '') ?? { costItemId: p.costItemId, name: p.name, amount: 0n };
      g.amount += p.amount;
      merged.set(p.costItemId ?? '', g);
    }
    const itemsOut: CostReportRow['indirectItems'] = [...merged.values()].map(p => ({ costItemId: p.costItemId, name: p.name, amount: fmt(p.amount, 4) }));
    for (const p of itemsOut) {
      const k = p.costItemId ?? '';
      const g = byItem.get(k) ?? { costItemId: p.costItemId, name: p.name, amount: 0n };
      g.amount += dec(p.amount);
      byItem.set(k, g);
    }
    rows.push({
      itemId: it.itemId,
      itemName: it.itemName,
      documentId: it.documentId,
      number: it.number,
      date: it.date,
      workCenterName: it.center ? (centers.get(it.center) ?? null) : null,
      qty: fmt(dec(m.qty), 3),
      materials: fmt(materials, 4),
      semi: fmt(semi, 4),
      alloc: fmt(alloc, 4),
      work: fmt(work, 4),
      services: fmt(services, 4),
      indirect: fmt(indirect, 4),
      other: fmt(other, 4),
      total: fmt(total, 4),
      indirectItems: itemsOut,
    });
  }
  rows.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.date.localeCompare(b.date) || (a.number ?? '').localeCompare(b.number ?? ''));
  const indirectItems = [...byItem.values()].sort((a, b) => a.name.localeCompare(b.name)).map(g => ({ costItemId: g.costItemId, name: g.name, amount: fmt(g.amount, 4) }));
  return { from: q.from, to: q.to, rows, indirectItems };
}

/** Себестоимость целиком — стоимостной отчёт: роли без доступа к себестоимости получают 403 в маршруте */

/* ---------------- план-факт себестоимости ---------------- */

export interface CostPlanFactRow {
  itemId: string;
  itemName: string;
  productId: string;
  materialName: string;
  unitCode: string | null;
  documentId: string;
  number: string | null;
  date: string;
  /** По снимку норм выпуска */
  planQty: string;
  /** Фактическое списание (у режима смены — по распределению материалов) */
  factQty: string;
  /** Факт минус план: плюс — перерасход, минус — экономия */
  deviationQty: string;
  /** Суммы (null — нет доступа к себестоимости): план по фактической средней цене списания */
  planAmount: string | null;
  factAmount: string | null;
  deviationAmount: string | null;
}

export interface CostPlanFactReport {
  from: string;
  to: string;
  rows: CostPlanFactRow[];
}

/** План-факт себестоимости по материалам выпусков: план — количество снимка норм × фактическая средняя цена списания, факт — списанное.
    Брак входит в количество выпуска (нормы на него уже умножены), возвратные отходы материалов не меняют. Выпуск в режиме смены
    без проведённого распределения в отчёт не попадает: факта списания у него ещё нет */
export async function costPlanFactReport(db: Db, workspaceId: string, q: { from: string; to: string; workCenterId?: string | undefined; itemId?: string | undefined }): Promise<CostPlanFactReport> {
  assertPeriod(q.from, q.to);
  const items = await db
    .select({ id: productionItems.id, itemId: productionItems.itemId, itemName: manufacturedItems.name, documentId: documents.id, number: documents.number, date: documents.date, mode: productionHeaders.materialMode })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionItems.itemId))
    .leftJoin(productionHeaders, and(eq(productionHeaders.workspaceId, workspaceId), eq(productionHeaders.documentId, documents.id)))
    .where(
      and(
        eq(productionItems.workspaceId, workspaceId),
        eq(documents.type, 'production'),
        eq(documents.status, 'posted'),
        gte(documents.date, q.from),
        lte(documents.date, q.to),
        q.workCenterId ? eq(productionHeaders.workCenterId, q.workCenterId) : undefined,
        q.itemId ? eq(productionItems.itemId, q.itemId) : undefined,
      ),
    );
  if (!items.length) return { from: q.from, to: q.to, rows: [] };
  const ids = items.map(i => i.id);
  const comps = await db
    .select({ itemId: productionComponents.itemId, productId: productionComponents.productId, qty: productionComponents.qty, actualQty: productionComponents.actualQty, actualCost: productionComponents.actualCost })
    .from(productionComponents)
    .where(and(eq(productionComponents.workspaceId, workspaceId), inArray(productionComponents.itemId, ids), eq(productionComponents.kind, 'material'), eq(productionComponents.ownerKind, 'own'), sql`${productionComponents.productId} is not null`));
  // режим смены: факт — строки проведённых распределений материалов
  const alloc = await db
    .select({ itemId: materialAllocationRows.releaseItemId, productId: materialAllocationRows.productId, qty: sql<string>`sum(${materialAllocationRows.qty})`, cost: sql<string>`sum(${materialAllocationRows.cost})` })
    .from(materialAllocationRows)
    .innerJoin(documents, eq(documents.id, materialAllocationRows.documentId))
    .where(and(eq(materialAllocationRows.workspaceId, workspaceId), inArray(materialAllocationRows.releaseItemId, ids), eq(documents.status, 'posted')))
    .groupBy(materialAllocationRows.releaseItemId, materialAllocationRows.productId);
  interface Acc { plan: bigint; qty: bigint; cost: bigint }
  const acc = new Map<string, Acc>();
  const get = (itemId: string, productId: string) => {
    const k = `${itemId}|${productId}`;
    const a = acc.get(k) ?? { plan: 0n, qty: 0n, cost: 0n };
    acc.set(k, a);
    return a;
  };
  const shift = new Set(items.filter(i => i.mode === 'shift').map(i => i.id));
  const allocated = new Set(alloc.map(a => a.itemId));
  for (const c of comps) {
    const a = get(c.itemId!, c.productId!);
    a.plan += dec(c.qty);
    if (!shift.has(c.itemId!)) {
      a.qty += dec(c.actualQty ?? '0');
      a.cost += dec(c.actualCost ?? '0');
    }
  }
  for (const r of alloc) {
    if (!shift.has(r.itemId)) continue;
    const a = get(r.itemId, r.productId);
    a.qty += dec(r.qty);
    a.cost += dec(r.cost);
  }
  const prodIds = [...new Set([...acc.keys()].map(k => k.split('|')[1]!))];
  const prod = new Map((prodIds.length ? await db.select({ id: products.id, name: products.name, unitCode: products.unitCode }).from(products).where(inArray(products.id, prodIds)) : []).map(p => [p.id, p]));
  // средняя цена списания материала по всему отчёту — для строк, где списано ноль
  const tot = new Map<string, { qty: bigint; cost: bigint }>();
  for (const [k, a] of acc) {
    const p = k.split('|')[1]!;
    const t = tot.get(p) ?? { qty: 0n, cost: 0n };
    t.qty += a.qty;
    t.cost += a.cost;
    tot.set(p, t);
  }
  const rows: CostPlanFactRow[] = [];
  for (const it of items) {
    if (shift.has(it.id) && !allocated.has(it.id)) continue;
    for (const [k, a] of acc) {
      const [iid, pid] = k.split('|') as [string, string];
      if (iid !== it.id) continue;
      if (a.plan === 0n && a.qty === 0n) continue;
      const t = tot.get(pid)!;
      const price = a.qty > 0n ? div(a.cost, a.qty) : t.qty > 0n ? div(t.cost, t.qty) : 0n;
      const planAmount = mul(a.plan, price);
      rows.push({
        itemId: it.itemId,
        itemName: it.itemName,
        productId: pid,
        materialName: prod.get(pid)?.name ?? '',
        unitCode: prod.get(pid)?.unitCode ?? null,
        documentId: it.documentId,
        number: it.number,
        date: it.date,
        planQty: fmt(a.plan, 3),
        factQty: fmt(a.qty, 3),
        deviationQty: fmt(a.qty - a.plan, 3),
        planAmount: fmt(planAmount, 4),
        factAmount: fmt(a.cost, 4),
        deviationAmount: fmt(a.cost - planAmount, 4),
      });
    }
  }
  rows.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.materialName.localeCompare(b.materialName) || a.date.localeCompare(b.date) || (a.number ?? '').localeCompare(b.number ?? ''));
  return { from: q.from, to: q.to, rows };
}

/** Суммы план-факта видят admin и owner; количества — любой участник */
export function maskCostPlanFact(r: CostPlanFactReport, seeCost: boolean): CostPlanFactReport {
  if (seeCost) return r;
  return { ...r, rows: r.rows.map(x => ({ ...x, planAmount: null, factAmount: null, deviationAmount: null })) };
}

/* ---------------- НЗП с движением ---------------- */

export interface WipMovementRow {
  workCenterId: string | null;
  workCenterName: string | null;
  orderId: string | null;
  number: string | null;
  date: string | null;
  itemKey: string;
  itemName: string;
  openingQty: string;
  inQty: string;
  outQty: string;
  closingQty: string;
  /** Суммы (null — нет доступа к себестоимости) */
  openingAmount: string | null;
  inAmount: string | null;
  outAmount: string | null;
  closingAmount: string | null;
}

export interface WipMovementReport {
  from: string;
  to: string;
  rows: WipMovementRow[];
  /** Остаток на конец периода — тот же, что GET /production/wip на дату конца */
  closingTotal: string | null;
}

/** НЗП с движением: остаток на начало и на конец — `wipBalance` на день до начала и на конец периода; приход — затраты промежуточных
    этапов периода (stage_cost и косвенные закрытия), расход — списание в продукцию финальным этапом: начало + приход − конец */
export async function wipMovementReport(db: Db, workspaceId: string, q: { from: string; to: string; workCenterId?: string | undefined }): Promise<WipMovementReport> {
  assertPeriod(q.from, q.to);
  const filter = q.workCenterId ? { workCenterId: q.workCenterId } : {};
  const [open, close] = await Promise.all([wipBalance(db, workspaceId, { ...filter, date: addDays(q.from, -1), includeEmpty: true }), wipBalance(db, workspaceId, { ...filter, date: q.to, includeEmpty: true })]);
  interface Acc { workCenterId: string | null; workCenterName: string | null; orderId: string | null; number: string | null; date: string | null; itemKey: string; itemName: string; oq: bigint; oa: bigint; iq: bigint; ia: bigint; cq: bigint; ca: bigint }
  const acc = new Map<string, Acc>();
  const keyOf = (c: string | null, k: string) => `${c ?? ''}|${k}`;
  const touch = (c: { workCenterId: string | null; workCenterName: string | null }, o: { orderId: string | null; number: string | null; date: string | null }, i: { key: string; itemName: string }) => {
    const k = keyOf(c.workCenterId, i.key);
    const a = acc.get(k) ?? { workCenterId: c.workCenterId, workCenterName: c.workCenterName, orderId: o.orderId, number: o.number, date: o.date, itemKey: i.key, itemName: i.itemName, oq: 0n, oa: 0n, iq: 0n, ia: 0n, cq: 0n, ca: 0n };
    acc.set(k, a);
    return a;
  };
  for (const c of open.centers) for (const o of c.orders) for (const i of o.items) {
    const a = touch(c, o, i);
    a.oq = dec(i.qty);
    a.oa = dec(i.amount ?? '0');
  }
  for (const c of close.centers) for (const o of c.orders) for (const i of o.items) {
    const a = touch(c, o, i);
    a.cq = dec(i.qty);
    a.ca = dec(i.amount ?? '0');
  }
  // приход периода: выпуски промежуточных этапов; количество — по самому «широкому» этапу, как остаток
  const moves = await db
    .select({
      source: productionItems.sourceItemId,
      customer: productionItems.customerOrderLineId,
      stageId: productionHeaders.stageId,
      center: sql<string | null>`coalesce(${productionHeaders.finalWorkCenterId}, ${productionHeaders.workCenterId})`,
      qty: sql<string>`sum(${productionItems.qty} - ${productionItems.defectQty})`,
      cost: sql<string>`sum(coalesce(${productionItems.stageCost}, 0) + ${productionItems.closingCost})::text`,
    })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .innerJoin(productionHeaders, and(eq(productionHeaders.workspaceId, workspaceId), eq(productionHeaders.documentId, documents.id)))
    .innerJoin(productionStages, eq(productionStages.id, productionHeaders.stageId))
    .where(and(eq(productionItems.workspaceId, workspaceId), eq(documents.type, 'production'), eq(documents.status, 'posted'), gte(documents.date, q.from), lte(documents.date, q.to), eq(productionStages.isFinal, false), sql`(${productionItems.sourceItemId} is not null or ${productionItems.customerOrderLineId} is not null)`))
    .groupBy(productionItems.sourceItemId, productionItems.customerOrderLineId, productionHeaders.stageId, sql`coalesce(${productionHeaders.finalWorkCenterId}, ${productionHeaders.workCenterId})`);
  const inQty = new Map<string, bigint>();
  const inAmt = new Map<string, bigint>();
  for (const m of moves) {
    if (q.workCenterId && m.center !== q.workCenterId) continue;
    const k = keyOf(m.center, m.source ? `s:${m.source}` : `c:${m.customer}`);
    inAmt.set(k, (inAmt.get(k) ?? 0n) + dec(m.cost));
    if (dec(m.qty) > (inQty.get(k) ?? 0n)) inQty.set(k, dec(m.qty));
  }
  for (const [k, a] of acc) {
    a.iq = inQty.get(k) ?? 0n;
    a.ia = dec(fmt(inAmt.get(k) ?? 0n, 2)); // округляем до копеек, чтобы расход (начало + приход − конец) сходился на экране
  }
  const rows: WipMovementRow[] = [];
  for (const a of acc.values()) {
    const outQty = a.oq + a.iq - a.cq;
    const outAmount = a.oa + a.ia - a.ca;
    if (a.oq === 0n && a.iq === 0n && a.cq === 0n && a.oa === 0n && a.ia === 0n && a.ca === 0n && outQty === 0n) continue;
    rows.push({
      workCenterId: a.workCenterId,
      workCenterName: a.workCenterName,
      orderId: a.orderId,
      number: a.number,
      date: a.date,
      itemKey: a.itemKey,
      itemName: a.itemName,
      openingQty: fmt(a.oq, 3),
      inQty: fmt(a.iq, 3),
      outQty: fmt(outQty, 3),
      closingQty: fmt(a.cq, 3),
      openingAmount: fmt(a.oa, 2),
      inAmount: fmt(a.ia, 2),
      outAmount: fmt(outAmount, 2),
      closingAmount: fmt(a.ca, 2),
    });
  }
  rows.sort((a, b) => (a.workCenterName ?? '￿').localeCompare(b.workCenterName ?? '￿') || (a.date ?? '').localeCompare(b.date ?? '') || (a.number ?? '').localeCompare(b.number ?? '') || a.itemName.localeCompare(b.itemName));
  return { from: q.from, to: q.to, rows, closingTotal: close.total };
}

/** Суммы НЗП маскируются как у остатка (`maskWipBalance`): видят admin и owner */
export function maskWipMovement(r: WipMovementReport, seeCost: boolean): WipMovementReport {
  if (seeCost) return r;
  return { ...r, closingTotal: null, rows: r.rows.map(x => ({ ...x, openingAmount: null, inAmount: null, outAmount: null, closingAmount: null })) };
}
