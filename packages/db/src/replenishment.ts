/* Общий расчёт потребностей в запасах (обработка УНФ «Расчёт потребностей в запасах»): три шага —
   рекомендации, планирование и заказы. Источники движения: остатки, заказы покупателей, заказы поставщикам,
   заказы на производство и утверждённые планы производства (только та часть, что ещё не передана в заказы).

   Правила и чистые расчёты — packages/shared/src/replenishment.ts, нормы запаса — packages/db/src/stock-levels.ts. */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  dec,
  explodeBom,
  fmt,
  startBeforeLead,
  salesMinMax,
  salesStatistics,
  stockForecast,
  type Dec,
  type ForecastPeriod,
  type Role,
  type StockFlow,
} from '@gr8r/shared';
import type { Db } from './client';
import { maskCost } from './cost';
import { recordEvent } from './events';
import { createDocument, postDocument, type DocCtx } from './documents';
import { supplierForProduct } from './materials';
import { createProductionOrder, loadProductionGraph } from './production';
import { calendarContext } from './planning';
import { planOrderedQty } from './production-plans';
import { lastSupplierPrice, supplierHistory } from './stock-levels';
import { companies, documentLines, documents, manufacturedItems, productManufacturing, productionComponents, productionHeaders, productionItems, productionPlanLines, productionPlans, products, stockBalances, stockLevels, stockReservations, warehouses, workCenters } from './schema';

/* ---------------- параметры расчёта ---------------- */

/** Параметры общего расчёта потребностей */
export interface NeedsQuery {
  /** Способ пополнения: закупка, производство, перемещение или все */
  replenishment: 'purchase' | 'production' | 'transfer' | 'all';
  /** Методика: по заказам с мин./макс. или по продажам */
  method: 'orders' | 'sales_minmax' | 'sales_statistics';
  /** Шаг периода: день, неделя или месяц */
  step: 'day' | 'week' | 'month';
  /** Сколько периодов в горизонте */
  periods: number;
  /** Начало горизонта */
  from: string;
  /** Учитывать потребность по складам (false — по компании в целом) */
  byWarehouse: boolean;
  warehouseId?: string;
  /** Источники: заказы (покупателей, поставщикам, на производство) и планы */
  source: 'all' | 'orders' | 'plan';
  productId?: string;
}

const today = (): string => new Date().toISOString().slice(0, 10);

const shiftDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const shiftMonths = (date: string, months: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};

/** Начала периодов горизонта: день, неделя или месяц */
export const horizonPeriods = (from: string, step: 'day' | 'week' | 'month', count: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(step === 'day' ? shiftDays(from, i) : step === 'week' ? shiftDays(from, 7 * i) : shiftMonths(from, i));
  return out;
};

/* ---------------- строка расчёта ---------------- */

/** Строка расчёта: товар и склад (или компания целиком). Строка сводной потребности этапа 3 — NeedsRow в needs.ts */
export interface NeedsCalcRow {
  productId: string;
  productName: string;
  unitCode: string;
  warehouseId: string | null;
  warehouseName: string | null;
  /** Способ пополнения — из нормы запаса */
  replenishment: 'purchase' | 'production' | 'transfer';
  /** Склад-источник (для перемещения) */
  sourceWarehouseId: string | null;
  balance: string;
  /** Резерв показывается, но в прогноз не вычитается: заказ покупателя уже стоит в потреблении */
  reserved: string;
  minQty: string;
  maxQty: string;
  /** Прогноз остатка по периодам */
  forecast: ForecastPeriod[];
  /** Рекомендуемое количество к заказу */
  recommendation: string;
  /** Просрочено: движения с прошедшей датой и добор до максимума при остатке ниже минимума */
  overdue: string;
  /** Дата потребности: начало периода, где нужен заказ */
  dueDate: string | null;
  /** Средние продажи в день (методики по продажам) */
  avgPerDay: string;
  /** Срок поставки, дней */
  leadDays: number;
  /** Поставщик по умолчанию и его последняя цена (цены видят admin и owner) */
  supplierId: string | null;
  supplierName: string | null;
  price: string | null;
  priceDate: string | null;
  /** Поставщики, у которых товар покупали: цена и дата последнего поступления */
  suppliers: { supplierId: string; name: string; price: string | null; date: string | null }[];
  /** Документы-источники */
  incoming: ProductFlow[];
  demand: ProductFlow[];
  /** Заказ покупателя, под который нужен заказ */
  customerOrderId: string | null;
  /** Что производим вместо закупки */
  itemId: string | null;
  /** Сумма заказа по цене поставщика (видна admin и owner) */
  amount: string | null;
}

export interface NeedsResult {
  rows: NeedsCalcRow[];
  periods: string[];
  today: string;
  from: string;
  method: NeedsQuery['method'];
  step: NeedsQuery['step'];
  byWarehouse: boolean;
  /** Параметры страхового запаса методики «по статистике продаж» */
  safety: { leadDays: number; safetyDays: number; safetyPct: string; historyPeriods: number };
}

/** Параметры страхового запаса: по дням поставки или в процентах от плановой потребности (процент бывает отрицательным) */
export interface SafetyInput {
  /** Страховой запас по дням поставки */
  safetyDays?: number;
  /** Страховой запас в процентах от плановой потребности; имеет приоритет над днями */
  safetyPct?: string;
  /** Сколько прошлых периодов брать для средних продаж */
  historyPeriods?: number;
}

/* ---------------- расчёт ---------------- */

/** Общий расчёт потребностей: остатки, резервы, заказы, планы → рекомендации по периодам */
export async function calculateNeeds(db: Db, role: Role | undefined, query: NeedsQuery, safetyInput: SafetyInput = {}): Promise<NeedsResult> {
  const from = query.from ?? today();
  const periods = horizonPeriods(from, query.step, query.periods);
  const now = today();
  const safety: SafetyInput = { safetyDays: 0, historyPeriods: 6, ...safetyInput };
  const empty = (): NeedsResult => ({ rows: [], periods, today: now, from, method: query.method, step: query.step, byWarehouse: query.byWarehouse, safety: { leadDays: 0, safetyDays: safety.safetyDays ?? 0, safetyPct: safety.safetyPct ?? '0', historyPeriods: safety.historyPeriods ?? 0 } });

  const all = await db.select().from(stockLevels);
  // по складам действуют нормы складов, по компании — строка без склада: иначе один товар дал бы несколько рекомендаций
  const levels = all.filter(l => (query.productId ? l.productId === query.productId : true) && (query.byWarehouse ? l.warehouseId !== null : l.warehouseId === null));
  if (!levels.length) return empty();
  const productIds = [...new Set(levels.map(l => l.productId))];
  const prods = await db.select().from(products).where(inArray(products.id, productIds));
  const byProduct = new Map(prods.map(p => [p.id, p]));
  const settings = (await db.select().from(productManufacturing).where(inArray(productManufacturing.productId, productIds))).map(s => [s.productId, s] as const);
  const settingsBy = new Map(settings);
  const items = await db.select({ id: manufacturedItems.id, productId: manufacturedItems.productId, leadDays: manufacturedItems.leadDays }).from(manufacturedItems);
  const itemOfProduct = new Map(items.filter(i => i.productId).map(i => [i.productId!, i]));

  const balances = await db.select({ warehouseId: stockBalances.warehouseId, productId: stockBalances.productId, qty: stockBalances.qty }).from(stockBalances).where(inArray(stockBalances.productId, productIds));
  const reservations = await db
    .select({ warehouseId: stockReservations.warehouseId, productId: stockReservations.productId, qty: sql<string>`sum(${stockReservations.qty})` })
    .from(stockReservations)
    .where(inArray(stockReservations.productId, productIds))
    .groupBy(stockReservations.warehouseId, stockReservations.productId);
  const incoming = await incomingFlows(db, productIds, query);
  const demand = await demandFlows(db, productIds, query);
  const companyNames = new Map((await db.select({ id: companies.id, name: companies.name }).from(companies)).map(c => [c.id, c.name]));
  const whs = await db.select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault }).from(warehouses);
  const whNames = new Map(whs.map(w => [w.id, w.name]));
  // документ без склада относится к складу по умолчанию (так его и проводит склад)
  const defaultWh = whs.find(w => w.isDefault)?.id ?? null;
  const history = query.method === 'sales_statistics' ? await salesPerDay(db, productIds, from, query.step, safety.historyPeriods ?? 6, defaultWh) : new Map<string, string>();
  const inWarehouse = (f: ProductFlow, warehouseId: string | null) => !query.byWarehouse || !warehouseId || (f.warehouseId ?? defaultWh) === warehouseId;

  const rows: NeedsCalcRow[] = [];
  for (const level of levels) {
    if (query.replenishment !== 'all' && level.replenishment !== query.replenishment) continue;
    if (query.warehouseId && level.warehouseId !== query.warehouseId) continue;
    const product = byProduct.get(level.productId);
    if (!product) continue;
    const item = itemOfProduct.get(level.productId) ?? null;
    const made = settingsBy.get(level.productId)?.replenishment === 'production' ? item : null;
    const balance = (query.byWarehouse && level.warehouseId ? balances.filter(b => b.productId === level.productId && b.warehouseId === level.warehouseId) : balances.filter(b => b.productId === level.productId)).reduce((a, b) => a + dec(b.qty), 0n);
    const reserved = reservations.filter(r => r.productId === level.productId && (level.warehouseId && query.byWarehouse ? r.warehouseId === level.warehouseId : true)).reduce((a, r) => a + dec(r.qty), 0n);
    const inc = incoming.filter(f => f.productId === level.productId && inWarehouse(f, level.warehouseId));
    const dem = demand.filter(f => f.productId === level.productId && inWarehouse(f, level.warehouseId));
    const avgPerDay = history.get(query.byWarehouse && level.warehouseId ? `${level.productId}:${level.warehouseId}` : level.productId) ?? '0.000';
    const leadDays = made ? (made.leadDays ?? 0) : (product.leadDays ?? 0);
    let recommendation = '0.000';
    let overdue = '0.000';
    let forecast: ForecastPeriod[] = [];
    if (query.method === 'orders') {
      const f = stockForecast({ balance: fmt(balance, 3), periods, incoming: inc, demand: dem, minQty: level.minQty, maxQty: level.maxQty, today: now });
      recommendation = f.recommendation;
      overdue = f.overdue;
      forecast = f.periods;
    } else if (query.method === 'sales_minmax') {
      recommendation = salesMinMax(fmt(balance, 3), level.minQty, level.maxQty);
      forecast = stockForecast({ balance: fmt(balance, 3), periods, incoming: [], demand: [], minQty: level.minQty, maxQty: level.maxQty, today: now }).periods;
    } else {
      recommendation = salesStatistics({ avgPerDay, leadDays: String(leadDays), balance: fmt(balance, 3), safetyDays: String(safety.safetyDays ?? 0), safetyPct: safety.safetyPct ?? null });
    }
    const supplierId = level.replenishment === 'purchase' ? await supplierForProduct(db, level.productId) : null;
    const last = supplierId ? await lastSupplierPrice(db, level.productId, supplierId) : { price: null, date: null };
    const price = last.price ?? product.purchasePrice;
    const rec = dec(recommendation);
    rows.push({
      productId: level.productId,
      productName: product.name,
      unitCode: product.unitCode,
      warehouseId: level.warehouseId,
      warehouseName: level.warehouseId ? (whNames.get(level.warehouseId) ?? null) : null,
      replenishment: level.replenishment,
      sourceWarehouseId: level.sourceWarehouseId,
      balance: fmt(balance, 3),
      reserved: fmt(reserved, 3),
      minQty: level.minQty,
      maxQty: level.maxQty,
      forecast,
      recommendation,
      overdue,
      dueDate: dueDateOf(forecast, inc),
      avgPerDay,
      leadDays,
      supplierId,
      supplierName: supplierId ? (companyNames.get(supplierId) ?? null) : null,
      price: maskCost(price, role),
      priceDate: last.date,
      suppliers: level.replenishment === 'purchase' ? (await supplierHistory(db, level.productId)).map(s => ({ ...s, price: maskCost(s.price, role) })) : [],
      incoming: inc,
      demand: dem,
      customerOrderId: dem.find(d => d.source === 'customer_order')?.documentId ?? null,
      itemId: made?.id ?? null,
      amount: rec > 0n ? maskCost(fmt(dec(price) * rec / 1000000n, 2), role) : null,
    });
  }
  return {
    rows: rows.sort((a, b) => a.productName.localeCompare(b.productName) || (a.warehouseName ?? '').localeCompare(b.warehouseName ?? '')),
    periods,
    today: now,
    from,
    method: query.method,
    step: query.step,
    byWarehouse: query.byWarehouse,
    safety: { leadDays: 0, safetyDays: safety.safetyDays ?? 0, safetyPct: safety.safetyPct ?? '0', historyPeriods: safety.historyPeriods ?? 0 },
  };
}

/** Дата потребности: начало первого периода с заказом, иначе ближайшее ожидаемое поступление */
const dueDateOf = (forecast: ForecastPeriod[], incoming: StockFlow[]): string | null =>
  forecast.find(f => dec(f.order) > 0n)?.period ?? [...incoming].sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? null;

/** Средние продажи в день за N прошлых периодов (проведённые реализации) */
async function salesPerDay(db: Db, productIds: string[], from: string, step: 'day' | 'week' | 'month', periods: number, defaultWh: string | null): Promise<Map<string, string>> {
  const count = Math.max(1, periods);
  const since = step === 'day' ? shiftDays(from, -count) : step === 'week' ? shiftDays(from, -7 * count) : shiftMonths(from, -count);
  const rows = await db
    .select({ productId: documentLines.productId, warehouseId: documents.warehouseId, qty: documentLines.qty })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(eq(documents.type, 'realization'), eq(documents.status, 'posted'), sql`${documents.date} >= ${since}`, sql`${documents.date} < ${from}`, inArray(documentLines.productId, productIds)));
  const acc = new Map<string, Dec>();
  // ключ — товар (по компании) и товар со складом реализации (по складам; без склада — склад по умолчанию)
  for (const r of rows) {
    acc.set(r.productId, (acc.get(r.productId) ?? 0n) + dec(r.qty));
    const wk = `${r.productId}:${r.warehouseId ?? defaultWh ?? ''}`;
    acc.set(wk, (acc.get(wk) ?? 0n) + dec(r.qty));
  }
  // дни истории — по календарю шага (месяцы разной длины), а не «периоды × 7»
  const days = BigInt(Math.max(1, Math.round((Date.parse(`${from}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 864e5)));
  const out = new Map<string, string>();
  for (const [key, total] of acc) out.set(key, fmt(total / days, 3));
  return out;
}

/** Ожидаемые поступления: заказы поставщикам, заказы на производство и утверждённые планы (незаказанная часть) */
async function incomingFlows(db: Db, productIds: string[], query: NeedsQuery): Promise<ProductFlow[]> {
  const out: ProductFlow[] = [];
  if (query.source !== 'plan') {
    const orders = await db
      .select({
        productId: documentLines.productId,
        qty: documentLines.qty,
        date: documents.date,
        docId: documents.id,
        number: documents.number,
        warehouseId: documents.warehouseId,
        received: sql<string>`coalesce((select sum(f.qty) from document_lines f join documents d2 on d2.id = f.document_id where f.origin_line_id = document_lines.id and d2.type = 'receipt' and d2.status = 'posted'), 0)`,
      })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .where(and(eq(documents.type, 'supplier_order'), sql`${documents.status} <> 'cancelled'`, inArray(documentLines.productId, productIds)));
    for (const o of orders) {
      const left = dec(o.qty) - dec(o.received);
      if (left > 0n) out.push({ productId: o.productId, warehouseId: o.warehouseId, date: o.date, qty: fmt(left, 3), source: 'supplier_order', documentId: o.docId, label: o.number });
    }
  }
  const orders = await db
    .select({ id: productionItems.id, itemId: productionItems.itemId, productId: manufacturedItems.productId, qty: productionItems.qty, docId: productionItems.documentId, number: documents.number, date: documents.date, end: productionHeaders.plannedEnd, warehouseId: documents.targetWarehouseId })
    .from(productionItems)
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionItems.itemId))
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .leftJoin(productionHeaders, eq(productionHeaders.documentId, documents.id))
    .where(and(eq(documents.type, 'production_order'), sql`${documents.status} <> 'cancelled'`, sql`${documents.state} is distinct from 'closed'`));
  const produced = await db
    .select({ source: productionItems.sourceItemId, qty: sql<string>`sum(${productionItems.qty})` })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .where(and(eq(documents.type, 'production'), eq(documents.status, 'posted')))
    .groupBy(productionItems.sourceItemId);
  const doneBy = new Map(produced.map(p => [p.source!, dec(p.qty)]));
  for (const p of orders) {
    if (!p.productId || !productIds.includes(p.productId)) continue;
    const left = dec(p.qty) - (doneBy.get(p.id) ?? 0n);
    if (left <= 0n) continue;
    out.push({ productId: p.productId, warehouseId: p.warehouseId, date: p.end ? new Date(p.end).toISOString().slice(0, 10) : p.date, qty: fmt(left, 3), source: 'production_order', documentId: p.docId, label: p.number });
  }
  if (query.source !== 'orders') {
    for (const l of await planLines(db)) {
      if (!l.item.productId || !productIds.includes(l.item.productId)) continue;
      const left = dec(l.line.qty) - (l.ordered ?? 0n);
      if (left <= 0n) continue;
      out.push({ productId: l.item.productId, warehouseId: l.warehouseId, date: l.line.periodStart, qty: fmt(left, 3), source: 'plan', documentId: null, label: l.name });
    }
  }
  return out;
}

/** Строки утверждённых планов с остатком «план − заказано» */
async function planLines(db: Db) {
  const rows = await db
    .select({ line: productionPlanLines, item: manufacturedItems, name: productionPlans.name, warehouseId: productionPlans.warehouseId, materialsWarehouseId: workCenters.warehouseId })
    .from(productionPlanLines)
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionPlanLines.itemId))
    .innerJoin(productionPlans, eq(productionPlans.id, productionPlanLines.planId))
    .leftJoin(workCenters, eq(workCenters.id, productionPlans.workCenterId))
    .where(and(eq(productionPlans.status, 'approved'), isNull(productionPlans.archivedAt)));
  const ordered = await planOrderedQty(db, rows.map(r => r.line.id));
  return rows.map(r => ({ ...r, ordered: ordered.get(r.line.id) ?? 0n }));
}

/** Потребление: заказы покупателей (остаток к отгрузке), материалы заказов на производство и утверждённых планов */
async function demandFlows(db: Db, productIds: string[], query: NeedsQuery): Promise<ProductFlow[]> {
  const out: ProductFlow[] = [];
  const customerOrders = await db
    .select({
      productId: documentLines.productId,
      qty: documentLines.qty,
      date: documents.date,
      dueDate: documents.dueDate,
      docId: documents.id,
      number: documents.number,
      warehouseId: documents.warehouseId,
      shipped: sql<string>`coalesce((select sum(f.qty) from document_lines f join documents d2 on d2.id = f.document_id where f.origin_line_id = document_lines.id and d2.type = 'realization' and d2.status = 'posted'), 0)`,
    })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(eq(documents.type, 'customer_order'), eq(documents.status, 'posted'), inArray(documentLines.productId, productIds)));
  for (const o of customerOrders) {
    const left = dec(o.qty) - dec(o.shipped);
    if (left > 0n) out.push({ productId: o.productId, warehouseId: o.warehouseId, date: o.dueDate ?? o.date, qty: fmt(left, 3), source: 'customer_order', documentId: o.docId, label: o.number });
  }
  if (query.source === 'plan') return out;
  const orders = await db
    .select({ docId: documents.id, number: documents.number, date: documents.date, start: productionHeaders.plannedStart, warehouseId: documents.warehouseId })
    .from(documents)
    .leftJoin(productionHeaders, eq(productionHeaders.documentId, documents.id))
    .where(and(eq(documents.type, 'production_order'), sql`${documents.status} <> 'cancelled'`, sql`${documents.state} is distinct from 'closed'`));
  const orderBy = new Map(orders.map(o => [o.docId, o]));
  const ids = orders.map(o => o.docId);
  if (ids.length) {
    const comps = await db
      .select({
        documentId: productionComponents.documentId,
        productId: productionComponents.productId,
        qty: productionComponents.qty,
        written: sql<string>`coalesce((select sum(c.actual_qty) from production_components c join documents d2 on d2.id = c.document_id where c.source_component_id = production_components.id and d2.type = 'production' and d2.status = 'posted'), 0)`,
      })
      .from(productionComponents)
      .where(and(inArray(productionComponents.kind, ['material', 'semi']), inArray(productionComponents.documentId, ids)));
    for (const c of comps) {
      if (!c.productId || !productIds.includes(c.productId)) continue;
      const left = dec(c.qty) - dec(c.written);
      if (left <= 0n) continue;
      const o = orderBy.get(c.documentId);
      out.push({ productId: c.productId, warehouseId: o?.warehouseId ?? null, date: o?.start ? new Date(o.start).toISOString().slice(0, 10) : (o?.date ?? today()), qty: fmt(left, 3), source: 'production_order', documentId: c.documentId, label: o?.number ?? null });
    }
  }
  if (query.source !== 'orders') {
    const rest = (await planLines(db)).filter(l => dec(l.line.qty) - l.ordered > 0n);
    if (rest.length) {
      const graph = await loadProductionGraph(db);
      for (const l of rest) {
        const left = fmt(dec(l.line.qty) - l.ordered, 3);
        let explosion;
        try {
          explosion = explodeBom(graph.inputs, l.line.itemId, left);
        } catch {
          continue; // цикл в спецификации — план в расчёт потребностей не попадает
        }
        // материалы плана списывает склад участка-диспетчера (без участка — склад по умолчанию)
        for (const m of explosion.materials) if (productIds.includes(m.productId)) out.push({ productId: m.productId, warehouseId: l.materialsWarehouseId, date: l.line.periodStart, qty: m.qty, source: 'plan', documentId: null, label: l.name });
        for (const s of explosion.semis) if (s.productId && productIds.includes(s.productId)) out.push({ productId: s.productId, warehouseId: l.materialsWarehouseId, date: l.line.periodStart, qty: s.qty, source: 'plan', documentId: null, label: l.name });
      }
    }
  }
  return out;
}

/* ---------------- черновики заказов ---------------- */

/** Событие движения по товару: дата, количество и документ-источник */
export interface ProductFlow extends StockFlow {
  productId: string;
  /** Склад движения: пусто — склад по умолчанию */
  warehouseId?: string | null;
}

/** Строка черновика: что и откуда заказываем */
export interface NeedsDraftLine {
  productId: string;
  /** Склад-получатель */
  warehouseId?: string | null;
  /** Склад-источник (для перемещения) */
  sourceWarehouseId?: string | null;
  /** Участок-производитель */
  workCenterId?: string | null;
  qty: string;
  /** Дата потребности */
  date?: string | null;
  /** Заказ покупателя (для группировки «отдельно под каждый заказ») */
  customerOrderId?: string | null;
  /** Цена: пусто — последняя цена поставщика */
  price?: string | null;
  /** Поставщик строки (выбран на шаге «Планирование»): пусто — поставщик товара по умолчанию */
  supplierId?: string | null;
}

export interface NeedsDraftsResult {
  orders: { id: string; type: string; number: string | null; supplierId: string | null; date: string; lines: { productId: string; productName: string; qty: string }[] }[];
  skipped: { productId: string; productName: string; qty: string; reason: 'no_supplier' | 'no_specification' | 'no_source_warehouse' }[];
}

/** Черновики по рассчитанной потребности: закупка → заказ поставщику, производство → заказ на производство,
    перемещение → черновик перемещения между складами. Группировка: способ, контрагент (участок или склад-источник) и дата. */
export async function createNeedsDrafts(
  db: Db,
  ctx: DocCtx,
  input: {
    replenishment: 'purchase' | 'production' | 'transfer';
    supplierId?: string | null;
    workCenterId?: string | null;
    date?: string | null;
    /** Поставка одной датой, а не на каждый период дефицита */
    singleDate?: boolean;
    /** Отдельный заказ под каждый заказ покупателя */
    perCustomerOrder?: boolean;
    comment?: string;
    lines: NeedsDraftLine[];
  },
): Promise<NeedsDraftsResult> {
  const prods = await db.select({ id: products.id, name: products.name }).from(products);
  const nameOf = new Map(prods.map(p => [p.id, p.name]));
  const itemOf = new Map(
    (await db.select().from(productManufacturing).where(sql`${productManufacturing.defaultItemId} is not null`))
      .filter(s => s.defaultItemId)
      .map(s => [s.productId, s.defaultItemId!] as const),
  );
  const cal = await calendarContext(db, ctx.workspaceId);
  // дата поступления — дата дефицита, но не раньше «сегодня + срок» (поставки или изготовления): прошлую дату заказ не исполнит
  const leadOf = new Map<string, number>();
  for (const p of await db.select({ id: products.id, leadDays: products.leadDays }).from(products).where(inArray(products.id, [...new Set(input.lines.map(l => l.productId))])))
    leadOf.set(p.id, p.leadDays);
  if (input.replenishment === 'production')
    for (const [productId, itemId] of itemOf) {
      const [it] = await db.select({ leadDays: manufacturedItems.leadDays }).from(manufacturedItems).where(eq(manufacturedItems.id, itemId)).limit(1);
      if (it) leadOf.set(productId, it.leadDays);
    }
  const earliest = (l: NeedsDraftLine): string => (input.replenishment === 'transfer' ? today() : shiftDays(today(), leadOf.get(l.productId) ?? 0));
  const lineDate = (l: NeedsDraftLine): string => {
    const want = l.date || input.date || today();
    const min = earliest(l);
    return want < min ? min : want;
  };
  const dateOf = (lines: NeedsDraftLine[]): string => {
    if (input.singleDate) {
      const base = input.date || today();
      const min = lines.map(earliest).sort().at(-1) ?? base;
      return base < min ? min : base;
    }
    return lines.map(lineDate).sort()[0] ?? (input.date || today());
  };
  const groups = new Map<string, NeedsDraftLine[]>();
  /** Поставщик строки закупки: выбранный на строке, общий из запроса, иначе поставщик товара по умолчанию */
  const supplierOf = new Map<NeedsDraftLine, string | null>();
  for (const line of input.lines) {
    if (input.replenishment === 'purchase') supplierOf.set(line, line.supplierId ?? input.supplierId ?? (await supplierForProduct(db, line.productId)));
    const source = input.replenishment === 'purchase' ? (supplierOf.get(line) ?? '—') : input.replenishment === 'transfer' ? (line.sourceWarehouseId ?? '—') : (input.workCenterId ?? line.workCenterId ?? '—');
    // склад-получатель — тоже часть ключа: один документ приходует на один склад.
    // «отдельно под каждый заказ покупателя» добавляет заказ покупателя в ключ группировки
    const key = `${input.replenishment}|${source}|${line.warehouseId ?? ''}${input.perCustomerOrder && line.customerOrderId ? `|${line.customerOrderId}` : ''}|${dateOf([line])}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const orders: NeedsDraftsResult['orders'] = [];
  const skipped: NeedsDraftsResult['skipped'] = [];
  for (const lines of groups.values()) {
    const date = dateOf(lines);
    if (input.replenishment === 'purchase') {
      const supplierId = supplierOf.get(lines[0]!) ?? null;
      if (!supplierId) {
        for (const l of lines) skipped.push({ productId: l.productId, productName: nameOf.get(l.productId) ?? l.productId, qty: l.qty, reason: 'no_supplier' });
        continue;
      }
      const rows: { productId: string; qty: string; price: string }[] = [];
      for (const l of lines) {
        const [p] = await db.select({ purchasePrice: products.purchasePrice }).from(products).where(eq(products.id, l.productId)).limit(1);
        const last = await lastSupplierPrice(db, l.productId, supplierId);
        rows.push({ productId: l.productId, qty: l.qty, price: l.price ?? last.price ?? p?.purchasePrice ?? '0' });
      }
      const id = await createDocument(db, ctx, {
        type: 'supplier_order',
        counterpartyId: supplierId,
        warehouseId: lines[0]!.warehouseId ?? undefined,
        date,
        comment: input.comment ?? '',
        lines: rows.map(r => ({ productId: r.productId, qty: r.qty, price: r.price, discountPct: '0' })),
      });
      const [doc] = await db.select({ number: documents.number }).from(documents).where(eq(documents.id, id)).limit(1);
      orders.push({ id, type: 'supplier_order', number: doc?.number ?? null, supplierId, date, lines: rows.map(r => ({ productId: r.productId, productName: nameOf.get(r.productId) ?? r.productId, qty: r.qty })) });
    } else if (input.replenishment === 'production') {
      const items: { itemId: string; qty: string }[] = [];
      for (const l of lines) {
        const itemId = itemOf.get(l.productId);
        if (!itemId) {
          skipped.push({ productId: l.productId, productName: nameOf.get(l.productId) ?? l.productId, qty: l.qty, reason: 'no_specification' });
          continue;
        }
        items.push({ itemId, qty: l.qty });
      }
      if (!items.length) continue;
      const leads = await db.select({ leadDays: manufacturedItems.leadDays }).from(manufacturedItems).where(inArray(manufacturedItems.id, items.map(i => i.itemId)));
      const lead = Math.max(0, ...leads.map(l => l.leadDays));
      const id = await createProductionOrder(db, ctx, {
        workCenterId: input.workCenterId ?? lines[0]!.workCenterId ?? null,
        targetWarehouseId: lines[0]!.warehouseId ?? null,
        date,
        plannedStart: `${startBeforeLead(cal.defaultCalendar, cal.holidays, cal.exceptions, date, lead)}T00:00:00.000Z`,
        plannedEnd: `${date}T00:00:00.000Z`,
        comment: input.comment ?? '',
        items,
      });
      const [doc] = await db.select({ number: documents.number }).from(documents).where(eq(documents.id, id)).limit(1);
      orders.push({ id, type: 'production_order', number: doc?.number ?? null, supplierId: null, date, lines: items.map(i => ({ productId: i.itemId, productName: nameOf.get(i.itemId) ?? i.itemId, qty: i.qty })) });
    } else {
      const source = lines[0]!.sourceWarehouseId;
      if (!source) {
        for (const l of lines) skipped.push({ productId: l.productId, productName: nameOf.get(l.productId) ?? l.productId, qty: l.qty, reason: 'no_source_warehouse' });
        continue;
      }
      const id = await createDocument(db, ctx, {
        type: 'stock_transfer',
        warehouseId: source,
        targetWarehouseId: lines[0]!.warehouseId ?? null,
        date,
        comment: input.comment ?? '',
        lines: lines.map(l => ({ productId: l.productId, qty: l.qty, price: '0', discountPct: '0' })),
      });
      const [doc] = await db.select({ number: documents.number }).from(documents).where(eq(documents.id, id)).limit(1);
      orders.push({ id, type: 'stock_transfer', number: doc?.number ?? null, supplierId: null, date, lines: lines.map(l => ({ productId: l.productId, productName: nameOf.get(l.productId) ?? l.productId, qty: l.qty })) });
    }
  }
  return { orders, skipped };
}

/** Массовое проведение созданных черновиков */
export async function postNeedsDrafts(db: Db, ctx: DocCtx, documentIds: string[]): Promise<{ posted: string[]; failed: { id: string; error: string }[] }> {
  const posted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of documentIds) {
    try {
      await postDocument(db, ctx, id);
      posted.push(id);
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : 'The document cannot be posted' });
    }
  }
  for (const id of posted) await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.posted', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { fromNeeds: true } });
  return { posted, failed };
}
