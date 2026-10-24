/* Инвестпроекты и окупаемость: проект, план денежного потока (период × статья), факт из проведённых документов
   и показатели (NPV, IRR, PI, окупаемость — чистые функции в @gr8r/shared/investments).

   Факт — проведённые документы, суммы без НДС, на дату документа. Правило старшинства (без двойного счёта):
   - у документа задано поле «Инвестпроект» → весь документ идёт только в этот проект;
   - поле пустое → в проект идут строки (или шапка) со статьёй, закреплённой за проектом (статья — не больше чем за одним проектом).
   Возвраты (поставщику, от покупателя) — с минусом. Себестоимость списания и оприходования — по движениям (`documentCosts`).
   Суммы и показатели видят только admin и owner: маскирование — `maskInvestment*` ниже (через canSeeCost). */
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import {
  cashflowTable,
  dec,
  fmt,
  forecastFlows,
  INVESTMENT_FACT_TYPES,
  investmentMetrics,
  isInvestmentFactType,
  periodDate,
  periodIndexOf,
  periodLabel,
  periodRate,
  periodStart,
  sumByPeriod,
  type CashflowEntry,
  type Dec,
  type InvestmentCreate,
  type InvestmentPeriodKind,
  type InvestmentStatus,
  type InvestmentUpdate,
  type Role,
} from '@gr8r/shared';
import type { Db } from './client';
import { canSeeCost } from './cost';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { documentCosts } from './stock';
import { costItems, documentLines, documents, investmentCostItems, investmentPlanLines, investmentProjects, members, organizations, otherCostLines, projects } from './schema';

export interface InvestmentCtx {
  workspaceId: string;
  memberId: string | null;
}

type ProjectRow = typeof investmentProjects.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);

/** Проект по id (404, если нет) */
async function loadProject(db: Db, id: string): Promise<ProjectRow> {
  const [p] = await db.select().from(investmentProjects).where(eq(investmentProjects.id, id)).limit(1);
  if (!p) throw new DomainError(404, 'not_found', 'Investment project not found');
  return p;
}

/* ---------------- проверки ссылок ---------------- */

async function assertRefs(db: Db, input: Partial<InvestmentCreate>, periods: number): Promise<void> {
  if (input.projectId) {
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!p) throw new DomainError(422, 'invalid_reference', 'The project does not exist');
  }
  if (input.organizationId) {
    const [o] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
    if (!o) throw new DomainError(422, 'invalid_reference', 'The organization does not exist');
  }
  if (input.responsibleId) {
    const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, input.responsibleId)).limit(1);
    if (!m) throw new DomainError(422, 'invalid_reference', 'The member does not exist');
  }
  if (input.discountRate !== undefined && dec(input.discountRate) < 0n) throw new DomainError(422, 'invalid_rate', 'The discount rate cannot be negative');
  const ids = [...new Set([...(input.lines ?? []).map(l => l.costItemId), ...(input.costItemIds ?? [])])];
  const items = ids.length ? new Map((await db.select({ id: costItems.id, archivedAt: costItems.archivedAt }).from(costItems).where(inArray(costItems.id, ids))).map(i => [i.id, i])) : new Map();
  for (const id of ids) if (!items.get(id) || items.get(id)!.archivedAt) throw new DomainError(422, 'invalid_reference', 'The cost item does not exist or is archived');
  for (const l of input.lines ?? []) {
    if (dec(l.amount) <= 0n) throw new DomainError(422, 'invalid_amount', 'The amount must be greater than zero');
    if (l.periodIndex >= periods) throw new DomainError(422, 'period_out_of_range', 'The plan line is outside the project horizon');
  }
}

/** Строки плана — списком: прежние удаляются, новые пишутся в порядке ввода */
async function saveLines(db: Db, ctx: InvestmentCtx, projectId: string, lines: InvestmentCreate['lines']): Promise<void> {
  await db.delete(investmentPlanLines).where(eq(investmentPlanLines.investmentProjectId, projectId));
  if (!lines.length) return;
  await db.insert(investmentPlanLines).values(
    lines.map((l, i) => ({ ...(l.id ? { id: l.id } : {}), workspaceId: ctx.workspaceId, investmentProjectId: projectId, periodIndex: l.periodIndex, costItemId: l.costItemId, amount: fmt(dec(l.amount), 2), comment: l.comment.trim(), sortOrder: i })),
  );
}

/** Статьи проекта — списком. Статья другого проекта — 422 (иначе документ попал бы в факт двух проектов) */
async function saveCostItems(db: Db, ctx: InvestmentCtx, projectId: string, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length) {
    const [taken] = await db
      .select({ id: investmentCostItems.costItemId })
      .from(investmentCostItems)
      .where(and(inArray(investmentCostItems.costItemId, unique), sql`${investmentCostItems.investmentProjectId} <> ${projectId}`))
      .limit(1);
    if (taken) throw new DomainError(422, 'cost_item_taken', 'The cost item is already linked to another investment project', { costItemId: taken.id });
  }
  await db.delete(investmentCostItems).where(eq(investmentCostItems.investmentProjectId, projectId));
  if (unique.length) await db.insert(investmentCostItems).values(unique.map(costItemId => ({ workspaceId: ctx.workspaceId, investmentProjectId: projectId, costItemId })));
}

/* ---------------- создание, правка, статус ---------------- */

export async function createInvestment(db: Db, ctx: InvestmentCtx, input: InvestmentCreate): Promise<string> {
  await assertRefs(db, input, input.periods);
  const [row] = await db
    .insert(investmentProjects)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      name: input.name.trim(),
      periodKind: input.periodKind,
      startDate: periodStart(input.startDate, input.periodKind),
      periods: input.periods,
      discountRate: fmt(dec(input.discountRate), 4),
      projectId: input.projectId ?? null,
      organizationId: input.organizationId ?? null,
      responsibleId: input.responsibleId ?? null,
      comment: input.comment,
    })
    .returning({ id: investmentProjects.id });
  const id = row!.id;
  await saveLines(db, ctx, id, input.lines);
  await saveCostItems(db, ctx, id, input.costItemIds);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'investment.created', entity: 'investment', recordId: id, actorId: ctx.memberId, payload: { name: input.name } });
  return id;
}

/** Правка: план, ставку и горизонт — только у черновика; статьи проекта и ссылки — и у утверждённого */
export async function updateInvestment(db: Db, ctx: InvestmentCtx, id: string, input: InvestmentUpdate): Promise<void> {
  const p = await loadProject(db, id);
  if (p.archivedAt) throw new DomainError(422, 'archived', 'The investment project is archived');
  const planFields = ['periodKind', 'startDate', 'periods', 'discountRate', 'lines'] as const;
  if (p.status !== 'draft' && planFields.some(f => input[f] !== undefined)) throw new DomainError(422, 'investment_not_draft', 'Only a draft investment project can change its plan');
  if (p.status === 'closed') throw new DomainError(422, 'investment_closed', 'The investment project is closed');
  const periods = input.periods ?? p.periods;
  await assertRefs(db, input, periods);
  if (input.periods !== undefined && input.lines === undefined) {
    const [beyond] = await db.select({ id: investmentPlanLines.id }).from(investmentPlanLines).where(and(eq(investmentPlanLines.investmentProjectId, id), gte(investmentPlanLines.periodIndex, periods))).limit(1);
    if (beyond) throw new DomainError(422, 'period_out_of_range', 'Plan lines are outside the new horizon');
  }
  const kind = input.periodKind ?? p.periodKind;
  const set: Partial<typeof investmentProjects.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.periodKind !== undefined) set.periodKind = input.periodKind;
  if (input.startDate !== undefined || input.periodKind !== undefined) set.startDate = periodStart(input.startDate ?? p.startDate, kind);
  if (input.periods !== undefined) set.periods = input.periods;
  if (input.discountRate !== undefined) set.discountRate = fmt(dec(input.discountRate), 4);
  if (input.projectId !== undefined) set.projectId = input.projectId;
  if (input.organizationId !== undefined) set.organizationId = input.organizationId;
  if (input.responsibleId !== undefined) set.responsibleId = input.responsibleId;
  if (input.comment !== undefined) set.comment = input.comment;
  await db.update(investmentProjects).set(set).where(eq(investmentProjects.id, id));
  if (input.lines) await saveLines(db, ctx, id, input.lines);
  if (input.costItemIds) await saveCostItems(db, ctx, id, input.costItemIds);
  // в payload только имена полей: суммы участникам без права их видеть через ленту событий не уходят
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'investment.updated', entity: 'investment', recordId: id, actorId: ctx.memberId, payload: { fields: Object.keys(input) } });
}

const TRANSITIONS: Record<'approve' | 'unapprove' | 'close' | 'reopen', { from: InvestmentStatus; to: InvestmentStatus }> = {
  approve: { from: 'draft', to: 'approved' },
  unapprove: { from: 'approved', to: 'draft' },
  close: { from: 'approved', to: 'closed' },
  reopen: { from: 'closed', to: 'approved' },
};

/** Смена статуса: черновик → утверждён → закрыт и обратно по шагу */
export async function setInvestmentStatus(db: Db, ctx: InvestmentCtx, id: string, action: keyof typeof TRANSITIONS): Promise<void> {
  const p = await loadProject(db, id);
  const t = TRANSITIONS[action];
  if (p.archivedAt) throw new DomainError(422, 'archived', 'The investment project is archived');
  if (p.status !== t.from) throw new DomainError(422, 'invalid_status', `Cannot ${action} an investment project in status ${p.status}`);
  if (action === 'approve') {
    const [line] = await db.select({ id: investmentPlanLines.id }).from(investmentPlanLines).where(eq(investmentPlanLines.investmentProjectId, id)).limit(1);
    if (!line) throw new DomainError(422, 'no_lines', 'Add plan lines before approving');
  }
  await db
    .update(investmentProjects)
    .set({
      status: t.to,
      updatedAt: new Date(),
      ...(action === 'approve' ? { approvedAt: new Date(), approvedBy: ctx.memberId } : action === 'unapprove' ? { approvedAt: null, approvedBy: null } : {}),
      ...(action === 'close' ? { closedAt: new Date() } : action === 'reopen' ? { closedAt: null } : {}),
    })
    .where(eq(investmentProjects.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'investment.status_changed', entity: 'investment', recordId: id, actorId: ctx.memberId, payload: { changes: { status: { from: p.status, to: t.to } } } });
}

export async function archiveInvestment(db: Db, ctx: InvestmentCtx, id: string, restore = false): Promise<void> {
  await loadProject(db, id);
  await db.update(investmentProjects).set({ archivedAt: restore ? null : new Date(), updatedAt: new Date() }).where(eq(investmentProjects.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: restore ? 'investment.restored' : 'investment.archived', entity: 'investment', recordId: id, actorId: ctx.memberId });
}

/** Поле «Инвестпроект» документа: проект существует, не в архиве и не закрыт, тип документа даёт факт */
export async function assertInvestmentTarget(db: Db, investmentProjectId: string, documentType: string): Promise<void> {
  if (!isInvestmentFactType(documentType)) throw new DomainError(422, 'investment_not_applicable', 'This document type does not count towards investment projects');
  const [p] = await db.select({ status: investmentProjects.status, archivedAt: investmentProjects.archivedAt }).from(investmentProjects).where(eq(investmentProjects.id, investmentProjectId)).limit(1);
  if (!p || p.archivedAt) throw new DomainError(422, 'invalid_reference', 'The investment project does not exist or is archived');
  if (p.status === 'closed') throw new DomainError(422, 'investment_closed', 'The investment project is closed');
}

/** Принимает ли проект документы: существует, не в архиве и не закрыт */
export async function investmentOpen(db: Db, id: string): Promise<boolean> {
  const [p] = await db.select({ status: investmentProjects.status, archivedAt: investmentProjects.archivedAt }).from(investmentProjects).where(eq(investmentProjects.id, id)).limit(1);
  return !!p && !p.archivedAt && p.status !== 'closed';
}

/* ---------------- факт ---------------- */

export interface FactEntry {
  documentId: string;
  type: string;
  number: string | null;
  date: string;
  costItemId: string | null;
  direction: 'in' | 'out';
  /** Со знаком: возвраты — с минусом */
  amount: string;
  /** Как документ попал в факт: поле документа или статья проекта */
  via: 'field' | 'cost_item';
}

const LINE_TYPES = ['receipt', 'supplier_return', 'realization', 'act', 'customer_return'];
const HEADER_TYPES = ['write_off', 'stock_posting'];
const RETURN_TYPES = new Set(['supplier_return', 'customer_return']);
const FACT_TYPES = Object.keys(INVESTMENT_FACT_TYPES);

/** Факт проекта: строки проведённых документов по правилу старшинства */
export async function investmentFact(db: Db, p: Pick<ProjectRow, 'id' | 'startDate' | 'closedAt'>): Promise<FactEntry[]> {
  type Doc = { id: string; type: string; number: string | null; date: string; costItemId: string | null };
  const head = { id: documents.id, type: documents.type, number: documents.number, date: documents.date, costItemId: documents.costItemId };
  const posted = eq(documents.status, 'posted');
  const byField: Doc[] = await db
    .select(head)
    .from(documents)
    .where(and(eq(documents.investmentProjectId, p.id), posted, inArray(documents.type, FACT_TYPES)));
  const links = (await db.select({ id: investmentCostItems.costItemId }).from(investmentCostItems).where(eq(investmentCostItems.investmentProjectId, p.id))).map(r => r.id);
  // запасной путь: документы без поля, со статьёй проекта, не раньше начала проекта; у закрытого — проведённые до закрытия
  const free = and(isNull(documents.investmentProjectId), posted, gte(documents.date, p.startDate), p.closedAt ? lte(documents.postedAt, p.closedAt) : undefined);
  const out: FactEntry[] = [];
  const push = (d: Doc, costItemId: string | null, amount: string, via: FactEntry['via']) => {
    const v = RETURN_TYPES.has(d.type) ? -dec(amount) : dec(amount);
    if (v === 0n) return;
    out.push({ documentId: d.id, type: d.type, number: d.number, date: d.date, costItemId, direction: INVESTMENT_FACT_TYPES[d.type as keyof typeof INVESTMENT_FACT_TYPES]!, amount: fmt(v, 2), via });
  };

  // по полю: строки товаров и услуг, строки прочих затрат, себестоимость списаний и оприходований
  const fieldIds = byField.map(d => d.id);
  if (fieldIds.length) {
    const docs = new Map(byField.map(d => [d.id, d]));
    const ln = byField.filter(d => LINE_TYPES.includes(d.type)).map(d => d.id);
    if (ln.length) for (const l of await db.select({ documentId: documentLines.documentId, costItemId: documentLines.costItemId, net: documentLines.net }).from(documentLines).where(inArray(documentLines.documentId, ln))) push(docs.get(l.documentId)!, l.costItemId, l.net, 'field');
    const oc = byField.filter(d => d.type === 'other_costs').map(d => d.id);
    if (oc.length) for (const l of await db.select({ documentId: otherCostLines.documentId, costItemId: otherCostLines.costItemId, amount: otherCostLines.amount }).from(otherCostLines).where(inArray(otherCostLines.documentId, oc))) push(docs.get(l.documentId)!, l.costItemId, l.amount, 'field');
    const hd = byField.filter(d => HEADER_TYPES.includes(d.type));
    const costs = await documentCosts(db, hd.map(d => d.id));
    for (const d of hd) push(d, d.costItemId, costs.get(d.id) ?? '0', 'field');
  }

  if (links.length) {
    const lines = await db
      .select({ ...head, lineCostItemId: documentLines.costItemId, net: documentLines.net })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .where(and(free, inArray(documents.type, ['receipt', 'supplier_return']), inArray(documentLines.costItemId, links)));
    for (const l of lines) push(l, l.lineCostItemId, l.net, 'cost_item');
    const oc = await db
      .select({ ...head, lineCostItemId: otherCostLines.costItemId, amount: otherCostLines.amount })
      .from(otherCostLines)
      .innerJoin(documents, eq(documents.id, otherCostLines.documentId))
      .where(and(free, eq(documents.type, 'other_costs'), inArray(otherCostLines.costItemId, links)));
    for (const l of oc) push(l, l.lineCostItemId, l.amount, 'cost_item');
    const hd: Doc[] = await db
      .select(head)
      .from(documents)
      .where(and(free, inArray(documents.type, HEADER_TYPES), isNotNull(documents.costItemId), inArray(documents.costItemId, links)));
    const costs = await documentCosts(db, hd.map(d => d.id));
    for (const d of hd) push(d, d.costItemId, costs.get(d.id) ?? '0', 'cost_item');
  }
  // строка без статьи (реализация, акт, товар поступления) относится к статье проекта того же направления, если она одна —
  // иначе план-факт по статьям не сходился бы никогда; при нескольких статьях строка остаётся «без статьи»
  if (out.some(e => !e.costItemId)) {
    const own = await db
      .select({ id: costItems.id, kind: costItems.kind })
      .from(costItems)
      .where(
        sql`${costItems.id} in (select cost_item_id from investment_plan_lines where investment_project_id = ${p.id} union select cost_item_id from investment_cost_items where investment_project_id = ${p.id})`,
      );
    const single = (dir: 'in' | 'out') => {
      const ids = own.filter(c => (c.kind === 'income') === (dir === 'in')).map(c => c.id);
      return ids.length === 1 ? ids[0]! : null;
    };
    const target = { in: single('in'), out: single('out') };
    for (const e of out) if (!e.costItemId) e.costItemId = target[e.direction];
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.documentId.localeCompare(b.documentId));
}

/* ---------------- карточка и отчёты ---------------- */

type PlanLine = { id: string; periodIndex: number; costItemId: string; costItemName: string; kind: 'expense' | 'income'; amount: string; comment: string };

async function planLines(db: Db, projectId: string): Promise<PlanLine[]> {
  return db
    .select({ id: investmentPlanLines.id, periodIndex: investmentPlanLines.periodIndex, costItemId: investmentPlanLines.costItemId, costItemName: costItems.name, kind: costItems.kind, amount: investmentPlanLines.amount, comment: investmentPlanLines.comment })
    .from(investmentPlanLines)
    .innerJoin(costItems, eq(costItems.id, investmentPlanLines.costItemId))
    .where(eq(investmentPlanLines.investmentProjectId, projectId))
    .orderBy(asc(investmentPlanLines.sortOrder));
}

const planEntries = (lines: PlanLine[]): CashflowEntry[] => lines.map(l => ({ periodIndex: l.periodIndex, direction: l.kind === 'income' ? 'in' : 'out', amount: l.amount }));

/** Поток и показатели проекта: план, факт и прогноз (факт за прошедшие периоды + план за текущий и будущие) */
function analyse(p: ProjectRow, plan: PlanLine[], fact: FactEntry[], asOf = today()) {
  const kind = p.periodKind as InvestmentPeriodKind;
  const rate = Number(p.discountRate);
  const pr = periodRate(rate, kind);
  const factEntries = fact.map(f => ({ periodIndex: periodIndexOf(p.startDate, kind, f.date), direction: f.direction, amount: f.amount }));
  const P = sumByPeriod(planEntries(plan), p.periods);
  const F = sumByPeriod(factEntries, p.periods);
  const current = Math.max(0, Math.min(periodIndexOf(p.startDate, kind, asOf), p.periods));
  const Fc = { outflow: forecastFlows(P.outflow, F.outflow, current), inflow: forecastFlows(P.inflow, F.inflow, current) };
  const pack = (x: { outflow: Dec[]; inflow: Dec[] }) => ({ cashflow: cashflowTable(x.outflow, x.inflow, pr), metrics: investmentMetrics(x.outflow, x.inflow, rate, kind) });
  return {
    currentPeriod: current,
    outsideHorizon: factEntries.filter(e => e.periodIndex < 0 || e.periodIndex >= p.periods).length,
    periodList: Array.from({ length: p.periods }, (_, i) => ({ index: i, label: periodLabel(p.startDate, kind, i), start: periodDate(p.startDate, kind, i) })),
    plan: pack(P),
    fact: pack(F),
    forecast: pack(Fc),
  };
}

/** Карточка проекта: шапка, план, статьи, поток и показатели (суммы — без маскирования; маска — maskInvestmentDetail) */
export async function investmentDetail(db: Db, id: string, asOf?: string) {
  const p = await loadProject(db, id);
  const [proj] = p.projectId ? await db.select({ id: projects.id, key: projects.key, name: projects.name, status: projects.status, startDate: projects.startDate, dueDate: projects.dueDate }).from(projects).where(eq(projects.id, p.projectId)).limit(1) : [];
  const [org] = p.organizationId ? await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, p.organizationId)).limit(1) : [];
  const [resp] = p.responsibleId ? await db.select({ name: members.name }).from(members).where(eq(members.id, p.responsibleId)).limit(1) : [];
  const items = await db
    .select({ id: costItems.id, name: costItems.name, kind: costItems.kind })
    .from(investmentCostItems)
    .innerJoin(costItems, eq(costItems.id, investmentCostItems.costItemId))
    .where(eq(investmentCostItems.investmentProjectId, id))
    .orderBy(asc(costItems.name));
  const plan = await planLines(db, id);
  const fact = await investmentFact(db, p);
  return {
    ...p,
    project: proj ?? null,
    organizationName: org?.name ?? null,
    responsibleName: resp?.name ?? null,
    lines: plan,
    costItems: items,
    factDocuments: new Set(fact.map(f => f.documentId)).size,
    ...analyse(p, plan, fact, asOf),
  };
}

/** План-факт проекта: статья × период (план, факт, отклонение) и документы факта */
export async function investmentPlanFact(db: Db, id: string) {
  const p = await loadProject(db, id);
  const kind = p.periodKind as InvestmentPeriodKind;
  const plan = await planLines(db, id);
  const fact = await investmentFact(db, p);
  const ids = [...new Set([...fact.map(f => f.costItemId).filter((x): x is string => !!x), ...plan.map(l => l.costItemId)])];
  const names = new Map(ids.length ? (await db.select({ id: costItems.id, name: costItems.name }).from(costItems).where(inArray(costItems.id, ids))).map(r => [r.id, r.name]) : []);
  type Row = { costItemId: string | null; costItemName: string | null; direction: 'in' | 'out'; plan: Dec[]; fact: Dec[] };
  const rows = new Map<string, Row>();
  const row = (costItemId: string | null, direction: 'in' | 'out') => {
    const key = `${direction}:${costItemId ?? ''}`;
    if (!rows.has(key)) rows.set(key, { costItemId, costItemName: costItemId ? (names.get(costItemId) ?? '') : null, direction, plan: Array(p.periods).fill(0n), fact: Array(p.periods).fill(0n) });
    return rows.get(key)!;
  };
  const clamp = (i: number) => Math.min(Math.max(i, 0), p.periods - 1);
  for (const l of plan) row(l.costItemId, l.kind === 'income' ? 'in' : 'out').plan[l.periodIndex]! += dec(l.amount);
  for (const f of fact) row(f.costItemId, f.direction).fact[clamp(periodIndexOf(p.startDate, kind, f.date))]! += dec(f.amount);
  const sum = (xs: Dec[]) => xs.reduce((s, x) => s + x, 0n);
  return {
    id: p.id,
    name: p.name,
    periodList: Array.from({ length: p.periods }, (_, i) => ({ index: i, label: periodLabel(p.startDate, kind, i) })),
    rows: [...rows.values()]
      .sort((a, b) => (a.direction === b.direction ? (a.costItemName ?? '').localeCompare(b.costItemName ?? '') : a.direction === 'out' ? -1 : 1))
      .map(r => ({ costItemId: r.costItemId, costItemName: r.costItemName, direction: r.direction, plan: r.plan.map(x => fmt(x, 2)), fact: r.fact.map(x => fmt(x, 2)), planTotal: fmt(sum(r.plan), 2), factTotal: fmt(sum(r.fact), 2), deviation: fmt(sum(r.fact) - sum(r.plan), 2) })),
    documents: fact.map(f => ({ ...f, costItemName: f.costItemId ? (names.get(f.costItemId) ?? '') : null, periodIndex: clamp(periodIndexOf(p.startDate, kind, f.date)) })),
  };
}

/** Список проектов с итогами плана и факта и NPV/IRR плана */
export async function listInvestments(db: Db, params: { status?: InvestmentStatus; q?: string; archived: 'exclude' | 'include' | 'only'; limit: number; offset: number }, asOf?: string) {
  const conds = [
    params.status ? eq(investmentProjects.status, params.status) : undefined,
    params.q ? ilike(investmentProjects.name, `%${params.q}%`) : undefined,
    params.archived === 'exclude' ? isNull(investmentProjects.archivedAt) : params.archived === 'only' ? isNotNull(investmentProjects.archivedAt) : undefined,
  ];
  const rows = await db.select().from(investmentProjects).where(and(...conds)).orderBy(desc(investmentProjects.startDate), asc(investmentProjects.name)).limit(params.limit).offset(params.offset);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(investmentProjects).where(and(...conds));
  const items = [];
  for (const p of rows) {
    const a = analyse(p, await planLines(db, p.id), await investmentFact(db, p), asOf);
    items.push({ ...p, plan: a.plan.metrics, fact: a.fact.metrics, forecast: a.forecast.metrics, currentPeriod: a.currentPeriod });
  }
  return { items, total: Number(count?.n ?? 0) };
}

/** Проекты для поля «Инвестпроект» документа: неархивные и незакрытые (сумм нет — их видит любой участник) */
export async function investmentOptions(db: Db) {
  return db
    .select({ id: investmentProjects.id, name: investmentProjects.name, status: investmentProjects.status })
    .from(investmentProjects)
    .where(and(isNull(investmentProjects.archivedAt), inArray(investmentProjects.status, ['draft', 'approved'])))
    .orderBy(asc(investmentProjects.name));
}

/* ---------------- маскирование сумм ---------------- */

/** Поток без сумм: остаются только номера периодов */
const maskFlows = (rows: { index: number }[]) => rows.map(r => ({ index: r.index }));

/** Карточка без сумм и показателей для участника без права видеть стоимость */
export function maskInvestmentDetail<T extends Awaited<ReturnType<typeof investmentDetail>>>(d: T, role: Role | undefined) {
  if (canSeeCost(role)) return d;
  const pack = (x: T['plan']) => ({ cashflow: maskFlows(x.cashflow), metrics: null });
  return { ...d, discountRate: null, lines: d.lines.map(l => ({ ...l, amount: null })), plan: pack(d.plan), fact: pack(d.fact), forecast: pack(d.forecast) };
}

/** Строка списка без сумм */
export function maskInvestmentRow<T extends Awaited<ReturnType<typeof listInvestments>>['items'][number]>(r: T, role: Role | undefined) {
  if (canSeeCost(role)) return r;
  return { ...r, discountRate: null, plan: null, fact: null, forecast: null };
}

/** План-факт без сумм: состав статей и документов остаётся */
export function maskInvestmentPlanFact<T extends Awaited<ReturnType<typeof investmentPlanFact>>>(r: T, role: Role | undefined) {
  if (canSeeCost(role)) return r;
  return { ...r, rows: r.rows.map(x => ({ ...x, plan: null, fact: null, planTotal: null, factTotal: null, deviation: null })), documents: r.documents.map(d => ({ ...d, amount: null })) };
}
