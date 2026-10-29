/* Воронки продаж (задача 1176, docs/architecture/pipelines.md): воронки и этапы, переход сделки между этапами (одна точка входа
   для API, конвертации лида и автоматизаций), история этапов, просрочка норматива, отчёт-воронка.
   Всё идёт в транзакции вызывающего (данные + события outbox вместе). Права проверяют маршруты. */
import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import {
  conversionPct,
  daysOnStage,
  missingRequiredFields,
  PIPELINE_TEMPLATES,
  qualifiedStageIndex,
  weightedAmount,
  type DealStageCategory,
  type PipelineTemplate,
  type StageTemplate,
} from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { crmActivities, dealContacts, dealLostReasons, dealPipelines, dealStageHistory, dealStages, deals } from './schema';

export type DealRow = typeof deals.$inferSelect;
export type PipelineRow = typeof dealPipelines.$inferSelect;
export type StageRow = typeof dealStages.$inferSelect;

export interface DealCtx {
  workspaceId: string;
  /** members.id автора; null — автоматизация или сервер */
  memberId: string | null;
  /** Метка flow (защита от зацикливания): попадает в payload событий */
  via?: Record<string, unknown> | undefined;
}
const withVia = (ctx: DealCtx, payload: Record<string, unknown>) => (ctx.via ? { ...payload, via: ctx.via } : payload);
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- воронки и этапы ---------------- */

export const DEFAULT_LOST_REASONS = ['Price too high', 'Chose a competitor', 'No budget', 'No decision', 'Bad timing', 'Requirements changed'];

/** Шаблон по ключу (`sale` по умолчанию) */
export function templateOf(key: string | undefined): PipelineTemplate {
  return PIPELINE_TEMPLATES.find(t => t.key === key) ?? PIPELINE_TEMPLATES[0]!;
}

/** Создать воронку с этапами. Инварианты (один «выиграна», хотя бы один «проиграна») проверяются здесь же */
export async function createPipeline(db: Db, workspaceId: string, input: { name: string; stages: StageTemplate[]; isDefault?: boolean }): Promise<{ pipeline: PipelineRow; stages: StageRow[] }> {
  assertStageSetValid(input.stages);
  const [last] = await db.select({ m: max(dealPipelines.sortOrder) }).from(dealPipelines).where(eq(dealPipelines.workspaceId, workspaceId));
  const [pipeline] = await db
    .insert(dealPipelines)
    .values({ workspaceId, name: input.name.trim(), sortOrder: (last?.m ?? -1) + 1, isDefault: input.isDefault ?? false })
    .returning();
  const stages = await db
    .insert(dealStages)
    .values(input.stages.map((s, i) => ({ workspaceId, pipelineId: pipeline!.id, name: s.name, color: s.color, sortOrder: i, category: s.category, probability: s.probability, slaDays: s.slaDays ?? null, requiredFields: s.requiredFields ?? [] })))
    .returning();
  return { pipeline: pipeline!, stages: stages.sort((a, b) => a.sortOrder - b.sortOrder) };
}

/** Набор этапов нового шаблона: ровно один «выиграна», хотя бы один «проиграна», хотя бы один открытый */
export function assertStageSetValid(stages: readonly { category: DealStageCategory }[]) {
  const won = stages.filter(s => s.category === 'won').length;
  const lost = stages.filter(s => s.category === 'lost').length;
  if (won !== 1) throw new DomainError(422, 'pipeline_stage_invariant', 'A pipeline must have exactly one "won" stage');
  if (lost < 1) throw new DomainError(422, 'pipeline_stage_invariant', 'A pipeline must have at least one "lost" stage');
  if (!stages.some(s => s.category === 'in_progress')) throw new DomainError(422, 'pipeline_stage_invariant', 'A pipeline must have at least one open stage');
}

/** Проверка воронки в БД после правки этапов */
export async function assertPipelineValid(db: Db, pipelineId: string) {
  const stages = await db.select({ category: dealStages.category }).from(dealStages).where(eq(dealStages.pipelineId, pipelineId));
  assertStageSetValid(stages);
}

/** Воронка и причины проигрыша нового воркспейса (в существующих их создаёт миграция). Повторный вызов ничего не дублирует */
export async function ensureDealPipeline(db: Db, workspaceId: string, opts: { name?: string; stages?: StageTemplate[]; reasons?: string[] } = {}): Promise<PipelineRow> {
  const [existing] = await db.select().from(dealPipelines).where(and(eq(dealPipelines.workspaceId, workspaceId), eq(dealPipelines.isDefault, true))).limit(1);
  let pipeline = existing;
  if (!pipeline) {
    const t = templateOf('sale');
    pipeline = (await createPipeline(db, workspaceId, { name: opts.name ?? t.name, stages: opts.stages ?? t.stages, isDefault: true })).pipeline;
  }
  const reasons = opts.reasons ?? DEFAULT_LOST_REASONS;
  await db
    .insert(dealLostReasons)
    .values(reasons.map((name, i) => ({ workspaceId, name, sortOrder: i })))
    .onConflictDoNothing();
  return pipeline;
}

export async function defaultPipeline(db: Db): Promise<PipelineRow> {
  const [p] = await db.select().from(dealPipelines).where(eq(dealPipelines.isDefault, true)).limit(1);
  if (!p) throw new DomainError(422, 'pipeline_missing', 'The workspace has no default sales pipeline');
  return p;
}

export async function stagesOf(db: Db, pipelineId: string): Promise<StageRow[]> {
  return db.select().from(dealStages).where(eq(dealStages.pipelineId, pipelineId)).orderBy(asc(dealStages.sortOrder), asc(dealStages.createdAt));
}

export async function loadStage(db: Db, id: string): Promise<StageRow> {
  const [s] = await db.select().from(dealStages).where(eq(dealStages.id, id)).limit(1);
  if (!s) throw new DomainError(422, 'deal_stage_missing', 'Deal stage not found');
  return s;
}

/** Первый открытый этап воронки (по порядку) */
export async function firstStage(db: Db, pipelineId: string): Promise<StageRow> {
  const stages = await stagesOf(db, pipelineId);
  const s = stages.find(x => x.category === 'in_progress') ?? stages[0];
  if (!s) throw new DomainError(422, 'deal_stage_missing', 'The pipeline has no stages');
  return s;
}

/** Этап, на который попадает сделка из конвертированного лида: «квалифицирован» основной воронки (второй открытый, иначе первый) */
export async function qualifiedStage(db: Db): Promise<StageRow> {
  const p = await defaultPipeline(db);
  const stages = await stagesOf(db, p.id);
  const s = stages[qualifiedStageIndex(stages)];
  if (!s) throw new DomainError(422, 'deal_stage_missing', 'The pipeline has no stages');
  return s;
}

/** Этап по умолчанию для новой сделки: указанный этап (воронка берётся из него), либо первый этап указанной / основной воронки */
export async function resolveTargetStage(db: Db, input: { stageId?: string | null | undefined; pipelineId?: string | null | undefined }): Promise<StageRow> {
  if (input.stageId) {
    const s = await loadStage(db, input.stageId);
    if (input.pipelineId && input.pipelineId !== s.pipelineId) throw new DomainError(422, 'deal_stage_pipeline_mismatch', 'The stage does not belong to the pipeline');
    return s;
  }
  if (input.pipelineId) {
    const [p] = await db.select({ id: dealPipelines.id }).from(dealPipelines).where(eq(dealPipelines.id, input.pipelineId)).limit(1);
    if (!p) throw new DomainError(422, 'pipeline_missing', 'Pipeline not found');
    return firstStage(db, p.id);
  }
  return firstStage(db, (await defaultPipeline(db)).id);
}

/* ---------------- переход сделки ---------------- */

/** Значения сделки ПОСЛЕ изменения: по ним проверяются обязательные поля этапа */
export interface DealValuesAfter {
  amount: string | null | undefined;
  closeDate: string | null | undefined;
  contactIds: readonly string[];
  sourceId: string | null | undefined;
  custom: Record<string, unknown> | null | undefined;
}

export interface StagePlan {
  to: StageRow;
  from: StageRow | null;
  changed: boolean;
  /** Колонки сделки, которые нужно записать (воронка, этап, закрытие, причина, отметки норматива, порядок) */
  patch: Record<string, unknown>;
}

async function nextSortOrder(db: Db, stageId: string): Promise<number> {
  const [r] = await db.select({ m: max(deals.sortOrder) }).from(deals).where(eq(deals.stageId, stageId));
  return Number(r?.m ?? 0) + 1;
}

/**
 * Проверка и расчёт перехода. `existing` = null — создание сделки. Проверяет: этап принадлежит воронке, обязательные поля этапа
 * (по значениям после изменения), причину проигрыша при переходе в категорию «проиграна». Возвращает колонки для записи.
 * Если этап не меняется — `changed: false`, патч пуст (кроме явного `sortOrder`, который вызывающий решает сам).
 */
export async function planStageChange(
  db: Db,
  existing: DealRow | null,
  input: { stageId?: string | null | undefined; pipelineId?: string | null | undefined; lostReasonId?: string | null | undefined; closedAt?: string | null | undefined; skipRequired?: boolean },
  after: DealValuesAfter,
): Promise<StagePlan> {
  const from = existing ? await loadStage(db, existing.stageId) : null;
  // Только воронка (или ничего, если сделки ещё нет) — первый этап воронки; только этап — воронка этапа
  const wantsMove = !!(input.stageId || input.pipelineId) && !(existing && !input.stageId && input.pipelineId === existing.pipelineId);
  if (existing && !wantsMove) return { to: from!, from, changed: false, patch: {} };
  const to = wantsMove ? await resolveTargetStage(db, input) : await resolveTargetStage(db, {});
  if (existing && to.id === existing.stageId) return { to, from, changed: false, patch: {} };

  const missing = missingRequiredFields(to.requiredFields, {
    amount: after.amount,
    closeDate: after.closeDate,
    contactCount: after.contactIds.length,
    sourceId: after.sourceId,
    custom: after.custom,
  });
  if (missing.length && !input.skipRequired) throw new DomainError(422, 'deal_stage_required_fields', `Required fields for the stage "${to.name}" are not filled: ${missing.join(', ')}`, { stageId: to.id, fields: missing });

  const patch: Record<string, unknown> = { pipelineId: to.pipelineId, stageId: to.id, stageEnteredAt: new Date(), stageOverdueNotifiedAt: null, sortOrder: await nextSortOrder(db, to.id) };
  if (to.category === 'in_progress') Object.assign(patch, { closedAt: null, lostReasonId: null, lostReason: null });
  else Object.assign(patch, { closedAt: input.closedAt ?? today() });
  if (to.category === 'won') Object.assign(patch, { lostReasonId: null, lostReason: null });
  if (to.category === 'lost') {
    const reasonId = input.lostReasonId ?? existing?.lostReasonId ?? null;
    if (!reasonId) throw new DomainError(422, 'deal_lost_reason_required', 'A lost reason is required to move a deal to a "lost" stage', { stageId: to.id });
    const [r] = await db.select({ id: dealLostReasons.id }).from(dealLostReasons).where(eq(dealLostReasons.id, reasonId)).limit(1);
    if (!r) throw new DomainError(422, 'deal_lost_reason_missing', 'Lost reason not found');
    patch.lostReasonId = reasonId;
  }
  return { to, from, changed: true, patch };
}

/** История, служебная заметка и событие `deal.stage_changed` (его слушают триггеры автоматизаций) после записи перехода */
export async function recordStageChange(db: Db, ctx: DealCtx, deal: DealRow, plan: Pick<StagePlan, 'to' | 'from'>) {
  const { to, from } = plan;
  await db.insert(dealStageHistory).values({
    workspaceId: ctx.workspaceId,
    dealId: deal.id,
    fromPipelineId: from?.pipelineId ?? null,
    fromStageId: from?.id ?? null,
    toPipelineId: to.pipelineId,
    toStageId: to.id,
    memberId: ctx.memberId,
  });
  if (!from) return; // создание: только история
  let subject = `Stage changed: ${from.name} → ${to.name}`;
  if (from.pipelineId !== to.pipelineId) {
    const names = await db.select({ id: dealPipelines.id, name: dealPipelines.name }).from(dealPipelines).where(inArray(dealPipelines.id, [from.pipelineId, to.pipelineId]));
    const n = (id: string) => names.find(p => p.id === id)?.name ?? '';
    subject = `Stage changed: ${n(from.pipelineId)} / ${from.name} → ${n(to.pipelineId)} / ${to.name}`;
  }
  if (to.category === 'lost' && deal.lostReasonId) {
    const [r] = await db.select({ name: dealLostReasons.name }).from(dealLostReasons).where(eq(dealLostReasons.id, deal.lostReasonId)).limit(1);
    if (r) subject += ` (${r.name})`;
  }
  await db.insert(crmActivities).values({ workspaceId: ctx.workspaceId, type: 'note', subject, dealId: deal.id, companyId: deal.companyId, authorId: ctx.memberId, system: true });
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: 'deal.stage_changed',
    entity: 'deal',
    recordId: deal.id,
    actorId: ctx.memberId,
    payload: withVia(ctx, {
      record: json(deal),
      stage: { fromId: from.id, fromCategory: from.category, fromPipelineId: from.pipelineId, toId: to.id, toCategory: to.category, toPipelineId: to.pipelineId },
    }),
  });
}

/** Создать сделку в воронке: этап проверяется как при переходе, пишется история. Для конвертации лида и автоматизаций */
export async function insertDeal(
  db: Db,
  ctx: DealCtx,
  values: Omit<typeof deals.$inferInsert, 'workspaceId' | 'pipelineId' | 'stageId'>,
  target: { stageId?: string | null | undefined; pipelineId?: string | null | undefined; skipRequired?: boolean },
  contactIds: readonly string[] = [],
): Promise<DealRow> {
  const plan = await planStageChange(db, null, { ...target, lostReasonId: null }, { amount: values.amount ?? '0', closeDate: values.closeDate, contactIds, sourceId: values.sourceId, custom: (values.custom as Record<string, unknown> | undefined) ?? {} });
  if (plan.to.category === 'lost') throw new DomainError(422, 'deal_lost_reason_required', 'A deal cannot be created on a "lost" stage without a reason');
  const [row] = await db.insert(deals).values({ ...values, workspaceId: ctx.workspaceId, ...(plan.patch as object), sortOrder: values.sortOrder ?? (plan.patch.sortOrder as number) } as never).returning();
  await recordStageChange(db, ctx, row!, { to: plan.to, from: null });
  return row!;
}

/** Перевести существующую сделку (автоматизация, быстрые действия): сама блокирует строку, проверяет, пишет, события — как у PATCH */
export async function moveDeal(
  db: Db,
  ctx: DealCtx,
  dealId: string,
  input: { stageId?: string | null; pipelineId?: string | null; lostReasonId?: string | null; lostReason?: string | null },
): Promise<{ deal: DealRow; changed: boolean; from: StageRow | null; to: StageRow }> {
  const [existing] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1).for('update');
  if (!existing) throw new DomainError(404, 'not_found', 'Deal not found');
  const contactIds = (await db.select({ id: dealContacts.contactId }).from(dealContacts).where(eq(dealContacts.dealId, dealId))).map(r => r.id);
  const plan = await planStageChange(db, existing, input, { amount: existing.amount, closeDate: existing.closeDate, contactIds, sourceId: existing.sourceId, custom: existing.custom });
  if (!plan.changed) return { deal: existing, changed: false, from: plan.from, to: plan.to };
  const patch = { ...plan.patch, ...(input.lostReason !== undefined && plan.to.category === 'lost' ? { lostReason: input.lostReason } : {}), updatedAt: new Date() };
  const [after] = await db.update(deals).set(patch as never).where(eq(deals.id, dealId)).returning();
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(patch) as (keyof DealRow)[]) {
    if (k === 'updatedAt' || k === 'sortOrder' || k === 'stageEnteredAt' || k === 'stageOverdueNotifiedAt') continue;
    if (JSON.stringify(existing[k]) !== JSON.stringify(after![k])) changes[k] = { from: json(existing[k]), to: json(after![k]) };
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'deal.updated', entity: 'deal', recordId: dealId, actorId: ctx.memberId, payload: withVia(ctx, { changes }) });
  await recordStageChange(db, ctx, after!, plan);
  return { deal: after!, changed: true, from: plan.from, to: plan.to };
}

/* ---------------- просрочка норматива этапа ---------------- */

/** Условие «сделка открыта, у этапа задан норматив и он превышен» — для SQL фильтра и для прохода воркера */
export const overdueCondition = (now: Date = new Date()) =>
  sql`${dealStages.category} = 'in_progress' AND ${dealStages.slaDays} IS NOT NULL AND ${deals.stageEnteredAt} + (${dealStages.slaDays} * interval '1 day') < ${now.toISOString()}::timestamptz`;

/** Проход воркера: по каждой просроченной сделке один раз за вход в этап пишется событие `deal.stage_overdue`. Возвращает число событий */
export async function runDealOverdue(db: Db, workspaceId: string, now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ id: deals.id, stageId: deals.stageId, pipelineId: deals.pipelineId, slaDays: dealStages.slaDays, enteredAt: deals.stageEnteredAt })
    .from(deals)
    .innerJoin(dealStages, and(eq(dealStages.workspaceId, deals.workspaceId), eq(dealStages.id, deals.stageId)))
    .where(and(eq(deals.workspaceId, workspaceId), isNull(deals.archivedAt), isNull(deals.stageOverdueNotifiedAt), overdueCondition(now)))
    .for('update', { of: deals, skipLocked: true })
    .limit(500);
  for (const r of rows) {
    // повторный проход не создаст второго события: отметка ставится в той же транзакции
    const [done] = await db.update(deals).set({ stageOverdueNotifiedAt: now }).where(and(eq(deals.id, r.id), isNull(deals.stageOverdueNotifiedAt))).returning();
    if (!done) continue;
    await recordEvent(db, {
      workspaceId,
      type: 'deal.stage_overdue',
      entity: 'deal',
      recordId: r.id,
      actorId: null,
      payload: { record: json(done), stage: { toId: r.stageId, toPipelineId: r.pipelineId, slaDays: r.slaDays, days: Math.floor(daysOnStage(r.enteredAt, now)) } },
    });
  }
  return rows.length;
}

/* ---------------- отчёт-воронка ---------------- */

export interface FunnelRow {
  stageId: string;
  name: string;
  color: string;
  category: DealStageCategory;
  probability: number;
  /** Сделки когорты, которые сейчас на этом этапе, и их сумма */
  count: number;
  amount: string;
  /** Сколько сделок когорты побывало на этапе или дальше (для открытых этапов и «выиграна») */
  reached: number;
  /** Конверсия к предыдущему открытому этапу, % */
  conversion: number | null;
  /** Среднее время на этапе, дней (по завершённым и текущим пребываниям) */
  avgDays: number | null;
  /** Сумма × вероятность этапа для открытых сделок */
  weighted: string;
}
export interface FunnelReport {
  pipelineId: string;
  from: string;
  to: string;
  rows: FunnelRow[];
  totals: { deals: number; open: number; won: number; lost: number; amount: string; weighted: string };
}

/** Когорта — сделки воронки, созданные в периоде [from, to]. Суммы складываются как есть (валюты не пересчитываются) */
export async function dealFunnel(db: Db, q: { pipelineId: string; from: string; to: string }, now: Date = new Date()): Promise<FunnelReport> {
  const stages = await stagesOf(db, q.pipelineId);
  const cohort = await db
    .select({ id: deals.id, stageId: deals.stageId, amount: deals.amount })
    .from(deals)
    .where(and(eq(deals.pipelineId, q.pipelineId), isNull(deals.archivedAt), sql`${deals.createdAt}::date >= ${q.from}::date`, sql`${deals.createdAt}::date <= ${q.to}::date`));
  const ids = cohort.map(d => d.id);
  const history = ids.length ? await db.select().from(dealStageHistory).where(and(inArray(dealStageHistory.dealId, ids), eq(dealStageHistory.toPipelineId, q.pipelineId))).orderBy(asc(dealStageHistory.createdAt), asc(dealStageHistory.id)) : [];

  const order = new Map(stages.map((s, i) => [s.id, i] as const));
  const byDeal = new Map<string, typeof history>();
  for (const h of history) byDeal.set(h.dealId, [...(byDeal.get(h.dealId) ?? []), h]);
  const reachedBy = new Map<string, Set<string>>(stages.map(s => [s.id, new Set<string>()]));
  const durations = new Map<string, number[]>(stages.map(s => [s.id, []]));
  const currentStage = new Map(cohort.map(d => [d.id, d.stageId] as const));
  for (const [dealId, rows] of byDeal) {
    let maxOpen = -1;
    for (const [i, h] of rows.entries()) {
      const idx = order.get(h.toStageId);
      if (idx === undefined) continue;
      if (stages[idx]!.category !== 'lost') maxOpen = Math.max(maxOpen, idx);
      const end = rows[i + 1]?.createdAt ?? (stages[idx]!.category === 'in_progress' && currentStage.get(dealId) === h.toStageId ? now : null);
      if (end) durations.get(h.toStageId)!.push(daysOnStage(h.createdAt, end));
    }
    // «дошла до этапа» — побывала на нём или на любом открытом этапе позже (прыжок через этап считается пройденным)
    for (const s of stages) if (s.category !== 'lost' && order.get(s.id)! <= maxOpen) reachedBy.get(s.id)!.add(dealId);
  }

  const rows: FunnelRow[] = [];
  let prevReached: number | null = null;
  let totalWeighted = 0;
  let totalAmount = 0;
  for (const s of stages) {
    const here = cohort.filter(d => d.stageId === s.id);
    const amount = here.reduce((a, d) => a + Number(d.amount), 0);
    const weighted = s.category === 'in_progress' ? weightedAmount(amount, s.probability) : 0;
    totalWeighted += weighted;
    totalAmount += amount;
    const reached = reachedBy.get(s.id)!.size;
    const ds = durations.get(s.id)!;
    rows.push({
      stageId: s.id,
      name: s.name,
      color: s.color,
      category: s.category,
      probability: s.probability,
      count: here.length,
      amount: amount.toFixed(2),
      reached,
      conversion: s.category === 'lost' ? null : prevReached === null ? null : conversionPct(reached, prevReached),
      avgDays: ds.length ? Math.round((ds.reduce((a, b) => a + b, 0) / ds.length) * 10) / 10 : null,
      weighted: weighted.toFixed(2),
    });
    if (s.category !== 'lost') prevReached = reached;
  }
  const cat = (c: DealStageCategory) => rows.filter(r => r.category === c).reduce((a, r) => a + r.count, 0);
  return {
    pipelineId: q.pipelineId,
    from: q.from,
    to: q.to,
    rows,
    totals: { deals: cohort.length, open: cat('in_progress'), won: cat('won'), lost: cat('lost'), amount: totalAmount.toFixed(2), weighted: totalWeighted.toFixed(2) },
  };
}

/** Удалять нельзя, пока этапом пользуются сделки */
export async function stageDealCount(db: Db, stageId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(deals).where(eq(deals.stageId, stageId));
  return r?.n ?? 0;
}
