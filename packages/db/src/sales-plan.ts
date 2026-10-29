/* Планирование продаж (задача 1133), раздел docs/architecture/repeat-sales.md: справочник «Сценарии планирования»,
   документ «План продаж» (тип sales_plan, свои строки; проведение пишет регистр плановых показателей)
   и «План-фактный анализ продаж» по сценарию. Факт — тот же расчёт, что в отчёте услуг «Клиенты». */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { buildPlanFact, dec, div, fmt, mul, periodEnd, periodOf, periodStarts, planDocPeriods, type BillingPeriodicity, type ForecastFigure, type PlanFactReport, type PlanFigure, type SalesPlanDimension } from '@gr8r/shared';
import type { Db } from './client';
import { DOCUMENT_HOOKS } from './document-hooks';
import { createDocument, updateDocument, type DocCtx, type DocumentPatch } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { dealStages, deals, documentLines, documents, members, productCategories, products, salesPlanDocs, salesPlanFigures, salesPlanLines, salesPlanScenarios } from './schema';
import { postedSalesDocs, workOrdersFactDocs } from './service-reports';

/* ---------------- сценарии ---------------- */

export async function loadScenario(db: Db, id: string) {
  const [s] = await db.select().from(salesPlanScenarios).where(eq(salesPlanScenarios.id, id)).limit(1);
  if (!s) throw new DomainError(404, 'not_found', 'Planning scenario not found');
  return s;
}

/** Сценарий с документами нельзя менять по периодичности и разрезу: строки планов перестанут ему соответствовать */
export async function scenarioUsed(db: Db, id: string): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(salesPlanDocs).where(eq(salesPlanDocs.scenarioId, id));
  return Number(r?.n ?? 0) > 0;
}

/* ---------------- документ «План продаж» ---------------- */

export interface SalesPlanLineInput {
  id?: string | undefined;
  periodStart: string;
  memberId?: string | null | undefined;
  categoryId?: string | null | undefined;
  productId?: string | null | undefined;
  amount: string;
  qty?: string | undefined;
}

export interface SalesPlanInput {
  id?: string | undefined;
  scenarioId: string;
  periodStart: string;
  date?: string | undefined;
  organizationId?: string | null | undefined;
  warehouseId?: string | null | undefined;
  comment?: string | undefined;
  lines?: SalesPlanLineInput[] | undefined;
}

const keyOf = (dim: SalesPlanDimension, l: { memberId?: string | null | undefined; categoryId?: string | null | undefined; productId?: string | null | undefined }): string | null =>
  (dim === 'manager' ? l.memberId : dim === 'category' ? l.categoryId : l.productId) ?? null;

/** Строки проверяются по сценарию: период из периодов плана, значение только своего разреза, ссылки существуют, пары не повторяются */
async function checkLines(db: Db, dimension: SalesPlanDimension, periods: string[], lines: SalesPlanLineInput[]): Promise<void> {
  const seen = new Set<string>();
  for (const l of lines) {
    if (!periods.includes(l.periodStart)) throw new DomainError(422, 'invalid_period', 'The period does not belong to the plan');
    const others = dimension === 'manager' ? [l.categoryId, l.productId] : dimension === 'category' ? [l.memberId, l.productId] : [l.memberId, l.categoryId];
    if (others.some(Boolean)) throw new DomainError(422, 'invalid_dimension', 'The line value does not match the scenario dimension');
    if (dimension === 'product' && !l.productId) throw new DomainError(422, 'invalid_dimension', 'Select a product in every line');
    if (dec(l.amount) < 0n || dec(l.qty ?? '0') < 0n) throw new DomainError(422, 'invalid_amount', 'The amount and quantity cannot be negative');
    if (dimension !== 'product' && dec(l.qty ?? '0') !== 0n) throw new DomainError(422, 'invalid_dimension', 'The quantity is planned for the product dimension only');
    const k = `${l.periodStart}|${keyOf(dimension, l) ?? ''}`;
    if (seen.has(k)) throw new DomainError(422, 'duplicate_line', 'The same period and value are listed twice');
    seen.add(k);
  }
  const ids = (pick: (l: SalesPlanLineInput) => string | null | undefined) => [...new Set(lines.map(pick).filter((x): x is string => !!x))];
  const exists = async (table: typeof members | typeof productCategories | typeof products, list: string[]) => {
    if (!list.length) return;
    const rows = await db.select({ id: table.id }).from(table).where(inArray(table.id, list));
    if (rows.length !== list.length) throw new DomainError(422, 'invalid_reference', 'The line refers to an unknown manager, category or product');
  };
  await exists(members, ids(l => l.memberId));
  await exists(productCategories, ids(l => l.categoryId));
  await exists(products, ids(l => l.productId));
}

async function totalOf(db: Db, documentId: string): Promise<string> {
  const [r] = await db.select({ t: sql<string>`coalesce(sum(${salesPlanLines.amount}), 0)::text` }).from(salesPlanLines).where(eq(salesPlanLines.documentId, documentId));
  return fmt(dec(r?.t ?? '0'), 2);
}

async function writeTotals(db: Db, documentId: string): Promise<void> {
  const total = await totalOf(db, documentId);
  await db.update(documents).set({ amountNet: total, vatTotal: '0.00', total, updatedAt: new Date() }).where(eq(documents.id, documentId));
}

async function saveLines(db: Db, ctx: DocCtx, documentId: string, lines: SalesPlanLineInput[]): Promise<void> {
  await db.delete(salesPlanLines).where(eq(salesPlanLines.documentId, documentId));
  if (!lines.length) return;
  await db.insert(salesPlanLines).values(
    lines.map(l => ({ ...(l.id ? { id: l.id } : {}), workspaceId: ctx.workspaceId, documentId, periodStart: l.periodStart, memberId: l.memberId ?? null, categoryId: l.categoryId ?? null, productId: l.productId ?? null, amount: fmt(dec(l.amount), 2), qty: fmt(dec(l.qty ?? '0'), 3) })),
  );
}

async function headerOf(db: Db, id: string) {
  const [h] = await db.select().from(salesPlanDocs).where(eq(salesPlanDocs.documentId, id)).limit(1);
  if (!h) throw new DomainError(404, 'not_found', 'Sales plan not found');
  return h;
}

export async function createSalesPlan(db: Db, ctx: DocCtx, input: SalesPlanInput): Promise<string> {
  const scenario = await loadScenario(db, input.scenarioId);
  if (scenario.archivedAt) throw new DomainError(422, 'invalid_reference', 'The planning scenario is archived');
  const { first, periods } = planDocPeriods(scenario.periodicity, input.periodStart);
  await checkLines(db, scenario.dimension, periods, input.lines ?? []);
  const id = await createDocument(db, ctx, { ...(input.id ? { id: input.id } : {}), type: 'sales_plan', organizationId: input.organizationId ?? null, warehouseId: input.warehouseId ?? null, ...(input.date ? { date: input.date } : {}), comment: input.comment ?? '' });
  await db.insert(salesPlanDocs).values({ documentId: id, workspaceId: ctx.workspaceId, scenarioId: scenario.id, periodStart: first });
  await saveLines(db, ctx, id, input.lines ?? []);
  await writeTotals(db, id);
  return id;
}

export async function updateSalesPlan(db: Db, ctx: DocCtx, id: string, input: Partial<SalesPlanInput>): Promise<void> {
  const [doc] = await db.select({ type: documents.type, status: documents.status }).from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc || doc.type !== 'sales_plan') throw new DomainError(404, 'not_found', 'Sales plan not found');
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted plan cannot be edited: unpost it first');
  const head = await headerOf(db, id);
  const scenario = await loadScenario(db, input.scenarioId ?? head.scenarioId);
  const { first, periods } = planDocPeriods(scenario.periodicity, input.periodStart ?? head.periodStart);
  const changedScenario = scenario.id !== head.scenarioId || first !== head.periodStart;
  // сценарий или начало плана сменились — строки прежнего плана не подходят, их нужно прислать заново
  if (changedScenario && !input.lines) {
    const old = await db.select().from(salesPlanLines).where(eq(salesPlanLines.documentId, id));
    if (old.length) throw new DomainError(422, 'lines_required', 'Send the lines again: the scenario or the plan start has changed');
  }
  const lines = input.lines ?? (await db.select().from(salesPlanLines).where(eq(salesPlanLines.documentId, id))).map(l => ({ periodStart: l.periodStart, memberId: l.memberId, categoryId: l.categoryId, productId: l.productId, amount: l.amount, qty: l.qty }));
  await checkLines(db, scenario.dimension, periods, lines);
  const patch: DocumentPatch = {};
  if (input.organizationId !== undefined) patch.organizationId = input.organizationId;
  if (input.warehouseId !== undefined) patch.warehouseId = input.warehouseId;
  if (input.date !== undefined) patch.date = input.date;
  if (input.comment !== undefined) patch.comment = input.comment;
  if (Object.keys(patch).length) await updateDocument(db, ctx, id, patch);
  if (changedScenario) await db.update(salesPlanDocs).set({ scenarioId: scenario.id, periodStart: first }).where(eq(salesPlanDocs.documentId, id));
  if (input.lines || changedScenario) {
    await saveLines(db, ctx, id, lines);
    await writeTotals(db, id);
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'sales_plan' } });
}

/** Карточка плана: шапка, сценарий, периоды и строки с названиями значений разреза */
export async function salesPlanDetail(db: Db, id: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc || doc.type !== 'sales_plan') throw new DomainError(404, 'not_found', 'Sales plan not found');
  const head = await headerOf(db, id);
  const scenario = await loadScenario(db, head.scenarioId);
  const lines = await db.select().from(salesPlanLines).where(eq(salesPlanLines.documentId, id)).orderBy(asc(salesPlanLines.periodStart), asc(salesPlanLines.id));
  const names = await dimensionNames(db, scenario.dimension, lines.map(l => keyOf(scenario.dimension, l)).filter((x): x is string => !!x));
  return {
    ...doc,
    scenario: { id: scenario.id, name: scenario.name, periodicity: scenario.periodicity, dimension: scenario.dimension },
    periodStart: head.periodStart,
    periods: planDocPeriods(scenario.periodicity, head.periodStart).periods,
    lines: lines.map(l => ({ ...l, keyName: keyOf(scenario.dimension, l) ? names.get(keyOf(scenario.dimension, l)!) ?? null : null })),
    total: await totalOf(db, id),
  };
}

export async function listSalesPlans(db: Db, workspaceId: string, p: { scenarioId?: string | undefined; from?: string | undefined; to?: string | undefined; q?: string | undefined; limit: number; offset: number }) {
  const conds = [
    eq(documents.workspaceId, workspaceId),
    eq(documents.type, 'sales_plan'),
    p.scenarioId ? eq(salesPlanDocs.scenarioId, p.scenarioId) : undefined,
    p.from ? gte(salesPlanDocs.periodStart, p.from) : undefined,
    p.to ? lte(salesPlanDocs.periodStart, p.to) : undefined,
    p.q ? sql`(${documents.comment} ilike ${'%' + p.q.replace(/[\\%_]/g, m => '\\' + m) + '%'} or ${documents.number} ilike ${'%' + p.q.replace(/[\\%_]/g, m => '\\' + m) + '%'})` : undefined,
  ];
  const base = db.select({ doc: documents, periodStart: salesPlanDocs.periodStart, scenarioId: salesPlanDocs.scenarioId, scenarioName: salesPlanScenarios.name, periodicity: salesPlanScenarios.periodicity, dimension: salesPlanScenarios.dimension }).from(documents).innerJoin(salesPlanDocs, eq(salesPlanDocs.documentId, documents.id)).innerJoin(salesPlanScenarios, eq(salesPlanScenarios.id, salesPlanDocs.scenarioId)).where(and(...conds));
  const rows = await base.orderBy(desc(salesPlanDocs.periodStart), desc(documents.createdAt)).limit(p.limit).offset(p.offset);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).innerJoin(salesPlanDocs, eq(salesPlanDocs.documentId, documents.id)).where(and(...conds));
  return { items: rows.map(r => ({ ...r.doc, periodStart: r.periodStart, scenarioId: r.scenarioId, scenarioName: r.scenarioName, periodicity: r.periodicity, dimension: r.dimension })), total: Number(count?.n ?? 0), limit: p.limit, offset: p.offset };
}

/** Проведение пишет плановые показатели (регистр) с организацией и складом плана; отмена проведения стирает их */
DOCUMENT_HOOKS.sales_plan = {
  check: async (db, _ctx, doc) => {
    const lines = await db.select({ id: salesPlanLines.id }).from(salesPlanLines).where(eq(salesPlanLines.documentId, doc.id)).limit(1);
    if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one plan line before posting');
    const head = await headerOf(db, doc.id);
    if ((await loadScenario(db, head.scenarioId)).archivedAt) throw new DomainError(422, 'invalid_reference', 'The planning scenario is archived');
  },
  post: async (db, ctx, doc) => {
    const head = await headerOf(db, doc.id);
    const lines = await db.select().from(salesPlanLines).where(eq(salesPlanLines.documentId, doc.id));
    await db.delete(salesPlanFigures).where(eq(salesPlanFigures.documentId, doc.id));
    await db.insert(salesPlanFigures).values(
      lines.map(l => ({ workspaceId: ctx.workspaceId, documentId: doc.id, scenarioId: head.scenarioId, warehouseId: doc.warehouseId, organizationId: doc.organizationId, periodStart: l.periodStart, memberId: l.memberId, categoryId: l.categoryId, productId: l.productId, amount: l.amount, qty: l.qty })),
    );
    await writeTotals(db, doc.id);
  },
  afterUnpost: async (db, _ctx, doc) => {
    await db.delete(salesPlanFigures).where(eq(salesPlanFigures.documentId, doc.id));
  },
};

/* ---------------- план-фактный анализ ---------------- */

async function dimensionNames(db: Db, dimension: SalesPlanDimension, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const list = [...new Set(ids)];
  const rows =
    dimension === 'manager'
      ? await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, list))
      : dimension === 'category'
        ? await db.select({ id: productCategories.id, name: productCategories.name }).from(productCategories).where(inArray(productCategories.id, list))
        : await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, list));
  return new Map(rows.map(r => [r.id, r.name]));
}

export interface SalesPlanAnalysisQuery {
  scenarioId: string;
  from: string;
  to: string;
  warehouseId?: string | undefined;
  organizationId?: string | undefined;
}

/** План-фактный анализ продаж по сценарию. План — регистр проведённых планов; факт — выручка без НДС (и количество) проведённых реализаций,
    актов и выполненных заказ-нарядов минус возвраты покупателей; прогноз (только разрез «менеджер») — выигранные и открытые сделки с датой закрытия в периоде.
    Период отчёта выравнивается по периодам сценария */
export async function salesPlanAnalysis(db: Db, workspaceId: string, q: SalesPlanAnalysisQuery): Promise<PlanFactReport> {
  if (q.from > q.to) throw new DomainError(422, 'report_period_invalid', 'The period start is after its end');
  const scenario = await loadScenario(db, q.scenarioId);
  const periodicity: BillingPeriodicity = scenario.periodicity;
  const dimension = scenario.dimension;
  const periods = periodStarts(periodicity, q.from, q.to);
  if (periods.length > 120) throw new DomainError(422, 'report_period_invalid', 'The period is too long');
  const from = periods[0]!;
  const to = periodEnd(periodicity, periods.at(-1)!);
  const periodOfDate = (d: string) => periodOf(periodicity, d).start;

  // план
  const figConds = [eq(salesPlanFigures.workspaceId, workspaceId), eq(salesPlanFigures.scenarioId, scenario.id), inArray(salesPlanFigures.periodStart, periods), q.warehouseId ? or(isNull(salesPlanFigures.warehouseId), eq(salesPlanFigures.warehouseId, q.warehouseId)) : undefined, q.organizationId ? or(isNull(salesPlanFigures.organizationId), eq(salesPlanFigures.organizationId, q.organizationId)) : undefined];
  const figures = await db.select().from(salesPlanFigures).where(and(...figConds));
  const plan: PlanFigure[] = figures.map(f => ({ period: f.periodStart, key: keyOf(dimension, f), amount: f.amount, qty: f.qty }));

  // факт
  let docs = [...(await postedSalesDocs(db, workspaceId, from, to)), ...(await workOrdersFactDocs(db, workspaceId, from, to))];
  if (q.warehouseId) docs = docs.filter(d => d.warehouseId === q.warehouseId);
  if (q.organizationId) docs = docs.filter(d => d.organizationId === q.organizationId);
  const sign = (type: string) => (type === 'customer_return' ? -1n : 1n);
  const fact: PlanFigure[] = [];
  if (dimension === 'manager') {
    for (const d of docs) fact.push({ period: periodOfDate(d.date), key: d.responsibleId ?? d.companyOwnerId ?? null, amount: fmt(sign(d.type) * dec(d.net), 2), qty: '0' });
  } else if (docs.length) {
    const byDoc = new Map(docs.map(d => [d.id, d]));
    const rows = await db
      .select({ documentId: documentLines.documentId, productId: documentLines.productId, categoryId: products.categoryId, net: documentLines.net, qty: documentLines.qty })
      .from(documentLines)
      .innerJoin(products, eq(products.id, documentLines.productId))
      .where(inArray(documentLines.documentId, docs.map(d => d.id)));
    for (const r of rows) {
      const d = byDoc.get(r.documentId)!;
      const s = sign(d.type);
      fact.push({ period: periodOfDate(d.date), key: dimension === 'product' ? r.productId : r.categoryId, amount: fmt(s * dec(r.net), 2), qty: fmt(s * dec(r.qty), 3) });
    }
  }

  // прогноз по сделкам: только разрез «менеджер»
  const forecast: ForecastFigure[] = [];
  if (dimension === 'manager') {
    const rows = await db
      .select({ closeDate: deals.closeDate, ownerId: deals.ownerId, category: dealStages.category, probability: dealStages.probability, amount: deals.amount })
      .from(deals)
      .innerJoin(dealStages, and(eq(dealStages.workspaceId, deals.workspaceId), eq(dealStages.id, deals.stageId)))
      .where(and(eq(deals.workspaceId, workspaceId), isNull(deals.archivedAt), ne(dealStages.category, 'lost'), gte(deals.closeDate, from), lte(deals.closeDate, to)));
    for (const d of rows) {
      const won = d.category === 'won';
      // вероятность — у этапа воронки (задача 1176), в процентах
      forecast.push({ period: periodOfDate(d.closeDate!), key: d.ownerId, won: won ? d.amount : '0', open: won ? '0' : d.amount, weighted: won ? '0' : fmt(div(mul(dec(d.amount), dec(d.probability)), dec(100)), 2) });
    }
  }

  const keys = [...new Set([...plan, ...fact, ...forecast].map(x => x.key).filter((k): k is string => !!k))];
  const built = buildPlanFact({ periods, names: await dimensionNames(db, dimension, keys), plan, fact, forecast });
  return { scenario: { id: scenario.id, name: scenario.name, periodicity, dimension }, from, to, periods, ...built };
}
