/* Биллинг договоров обслуживания (этап 8 «УНФ: Услуги»).

   Счёт периода: абонплата за текущий период (аванс, с пропорцией по дням действия договора) плюс работы по факту
   за прошедший период (заказ-наряды, отгрузки и учёт времени по заказчику без заказ-наряда). Правила абонентской
   позиции — как в 1С:УНФ (packages/shared/src/billing.ts, чистые функции).

   Идемпотентность: один счёт на договор и период (billing_runs, уникальный индекс), каждый первичный документ и
   каждая запись времени попадают в счёт ровно один раз (billing_sources). */
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  actLines,
  computeBilling,
  dateInTimezone,
  dec,
  fmt,
  periodOf,
  shiftPeriod,
  type BillingComputation,
  type BillingFact,
  type BillingPeriod,
  type BillingProduct,
  type ExtraProductPolicy,
  type TariffPlanLine,
  type Dec,
  type VatRate,
} from '@gr8r/shared';
import { addDays } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { createDocument, postDocument, type DocCtx } from './documents';
import { contractDetail, listContracts, type ContractView } from './contracts';
import { billingBreakdowns, billingRuns, billingSources, contracts, documentLines, documents, products, tasks, timeLogs, workspaces, workOrderAssignments } from './schema';

/* ---------------- периоды ---------------- */

/** Дата внутри периода по его ключу: «2026-10» → 2026-10-01, «2026-Q3» → 2026-07-01, «2026» → 2026-01-01 */
export function periodAnchor(key: string): string {
  const m = /^(\d{4})(?:-(?:Q(\d)|(\d{2})))?$/.exec(key);
  if (!m) throw new DomainError(422, 'invalid_period', 'Period: 2026-10, 2026-Q3 or 2026');
  if (m[2]) return `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0')}-01`;
  if (m[3]) return `${m[1]}-${m[3]}-01`;
  return `${m[1]}-01-01`;
}

/** Часовой пояс арендатора (по умолчанию — Europe/Moscow) */
export async function workspaceTimezone(db: Db, workspaceId: string): Promise<string> {
  const [row] = await db.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return row?.timezone || 'Europe/Moscow';
}

/* ---------------- первичные документы ---------------- */

interface ServiceContractInfo {
  id: string;
  companyId: string;
  validFrom: string;
  validTo: string | null;
}

/** Договоры обслуживания контрагента: по ним определяется, кому принадлежит запись времени */
async function serviceContractsOfCompany(db: Db, workspaceId: string, companyId: string): Promise<ServiceContractInfo[]> {
  const rows = await db
    .select({ id: contracts.id, companyId: contracts.companyId, validFrom: contracts.validFrom, validTo: contracts.validTo })
    .from(contracts)
    .where(and(eq(contracts.workspaceId, workspaceId), eq(contracts.companyId, companyId), eq(contracts.isService, true), isNull(contracts.archivedAt)));
  return rows;
}

/** Договор-владелец записи времени: из договоров контрагента, действующих в этот день, — самый поздний по началу */
function ownerContract(list: ServiceContractInfo[], date: string): string | null {
  const covering = list.filter(c => c.validFrom <= date && (!c.validTo || c.validTo >= date));
  if (!covering.length) return null;
  covering.sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : a.id < b.id ? -1 : 1));
  return covering[0]!.id;
}

/** Первичные документы периода: заказ-наряды и отгрузки по договору, записи времени по заказчику без заказ-наряда */
export async function collectFacts(db: Db, workspaceId: string, contract: ContractView, period: BillingPeriod): Promise<BillingFact[]> {
  const facts: BillingFact[] = [];

  // заказ-наряды и отгрузки периода по этому договору (уже выставленные первички пропускаем)
  const docRows = await db
    .select({ id: documents.id, type: documents.type, date: documents.date, productId: documentLines.productId, name: documentLines.name, qty: documentLines.qty, price: documentLines.price })
    .from(documents)
    .innerJoin(documentLines, eq(documentLines.documentId, documents.id))
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        eq(documents.contractId, contract.id),
        eq(documents.status, 'posted'),
        inArray(documents.type, ['work_order', 'realization']),
        gte(documents.date, period.start),
        lte(documents.date, period.end),
      ),
    )
    .orderBy(asc(documents.date), asc(documentLines.sortOrder));
  const billed = new Set((await db.select({ sourceId: billingSources.sourceId }).from(billingSources).where(and(eq(billingSources.workspaceId, workspaceId), eq(billingSources.contractId, contract.id)))).map(r => r.sourceId));
  const seen = new Set<string>();
  for (const r of docRows) {
    if (billed.has(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    facts.push({ sourceKind: r.type === 'realization' ? 'realization' : 'work_order', sourceId: r.id, productId: r.productId, qty: r.qty, price: r.price, date: r.date, name: r.name });
  }

  // учёт времени: задачи модуля services с заказчиком, без заказ-наряда
  const companyContracts = await serviceContractsOfCompany(db, workspaceId, contract.companyId);
  const timeRows = await db
    .select({ id: timeLogs.id, logDate: timeLogs.logDate, hours: timeLogs.hours, productId: tasks.workProductId, taskId: tasks.id })
    .from(timeLogs)
    .innerJoin(tasks, eq(tasks.id, timeLogs.taskId))
    .where(
      and(
        eq(timeLogs.workspaceId, workspaceId),
        eq(tasks.module, 'services'),
        eq(tasks.companyId, contract.companyId),
        gte(timeLogs.logDate, period.start),
        lte(timeLogs.logDate, period.end),
        sql`${tasks.workProductId} is not null`,
      ),
    )
    .orderBy(asc(timeLogs.logDate));
  if (timeRows.length) {
    const assigned = new Set((await db.select({ taskId: workOrderAssignments.taskId }).from(workOrderAssignments).where(eq(workOrderAssignments.workspaceId, workspaceId))).map(r => r.taskId));
    const timeBilled = new Set((await db.select({ sourceId: billingSources.sourceId }).from(billingSources).where(and(eq(billingSources.workspaceId, workspaceId), eq(billingSources.sourceKind, 'time_log')))).map(r => r.sourceId));
    for (const r of timeRows) {
      if (assigned.has(r.taskId)) continue; // время по заказ-наряду выставляется заказ-нарядом
      if (timeBilled.has(r.id)) continue; // уже выставлено
      if (ownerContract(companyContracts, r.logDate) !== contract.id) continue; // договору принадлежит другой период
      facts.push({ sourceKind: 'time_log', sourceId: r.id, productId: r.productId!, qty: r.hours, price: null, date: r.logDate });
    }
  }

  return facts;
}

/* ---------------- расчёт договора ---------------- */

export interface BillingComputationResult {
  contract: ContractView;
  /** Период абонплаты (текущий) */
  period: BillingPeriod;
  /** Период фактических работ (прошедший) */
  factPeriod: BillingPeriod;
  computation: BillingComputation;
  /** Уже выставленный счёт за этот период */
  existingDocumentId: string | null;
}

/** Расчёт счёта периода по договору: строки, предупреждения и признак «счёт уже есть» */
export async function computeContractBilling(db: Db, workspaceId: string, contract: ContractView, anchorDate: string): Promise<BillingComputationResult> {
  const periodicity = contract.periodicity ?? 'month';
  const period = periodOf(periodicity, anchorDate);
  const factPeriod = shiftPeriod(periodicity, period, -1);
  const detail = await contractDetail(db, contract.id);
  const planLines: TariffPlanLine[] = (detail?.tariffPlanLines ?? []).map(l => ({ id: l.id, productId: l.productId, qty: l.qty, price: l.price, isSubscription: l.isSubscription, invoiceAsProductId: l.invoiceAsProductId }));
  const facts = await collectFacts(db, workspaceId, contract, factPeriod);
  const productIds = [...new Set([...planLines.map(l => l.productId), ...facts.map(f => f.productId), ...planLines.map(l => l.invoiceAsProductId).filter((x): x is string => !!x)])];
  const productRows = productIds.length ? await db.select().from(products).where(inArray(products.id, productIds)) : [];
  const catalog: Record<string, BillingProduct> = {};
  for (const p of productRows) catalog[p.id] = { id: p.id, name: p.name, unitCode: p.unitCode, vatRate: p.vatRate, price: p.price };
  const computation = computeBilling({
    tariffLines: planLines,
    facts,
    products: catalog,
    subscriptionPeriod: period,
    factPeriod,
    validFrom: contract.validFrom,
    validTo: contract.validTo,
    extraProductPolicy: contract.extraProductPolicy as ExtraProductPolicy,
  });
  const [run] = await db.select({ documentId: billingRuns.documentId }).from(billingRuns).where(and(eq(billingRuns.workspaceId, workspaceId), eq(billingRuns.contractId, contract.id), eq(billingRuns.period, period.key))).limit(1);
  return { contract, period, factPeriod, computation, existingDocumentId: run?.documentId ?? null };
}

export interface BillingOptions {
  /** Ключ периода («2026-10»): задаёт дату внутри периода; пусто — сегодня в поясе воркспейса */
  period?: string;
  /** Договоры (по умолчанию — все договоры обслуживания) */
  contractIds?: string[];
}

/** Договоры-кандидаты: договоры обслуживания арендатора */
async function candidates(db: Db, opts: BillingOptions & { workspaceId: string }): Promise<ContractView[]> {
  const all = (await listContracts(db, { workspaceId: opts.workspaceId, isService: true })).filter(c => c.periodicity);
  if (!opts.contractIds?.length) return all;
  return all.filter(c => opts.contractIds!.includes(c.id));
}

/** Предпросмотр: что будет выставлено за период (ничего не записывается) */
export async function previewBilling(db: Db, ctx: { workspaceId: string; memberId: string | null }, opts: BillingOptions): Promise<BillingComputationResult[]> {
  const tz = await workspaceTimezone(db, ctx.workspaceId);
  const anchor = opts.period ? periodAnchor(opts.period) : dateInTimezone(tz);
  const list = await candidates(db, { ...opts, workspaceId: ctx.workspaceId });
  const out: BillingComputationResult[] = [];
  for (const c of list) out.push(await computeContractBilling(db, ctx.workspaceId, c, anchor));
  return out;
}

export interface BillingRunItem {
  contractId: string;
  contractNumber: string;
  documentId: string | null;
  number: string | null;
  /** Счёт уже был выставлен за этот период */
  skipped: boolean;
  reason?: string;
}

/**
 * Отменённый счёт не держит период: запуск и выставленные им первички освобождаются, и следующий запуск выставляет
 * период заново. Проведённый или черновой счёт период держит.
 */
async function releaseCancelledRun(db: Db, workspaceId: string, contractId: string, period: string): Promise<void> {
  const [run] = await db
    .select({ id: billingRuns.id, documentId: billingRuns.documentId, status: documents.status })
    .from(billingRuns)
    .leftJoin(documents, eq(documents.id, billingRuns.documentId))
    .where(and(eq(billingRuns.workspaceId, workspaceId), eq(billingRuns.contractId, contractId), eq(billingRuns.period, period)))
    .limit(1);
  if (!run || (run.documentId && run.status !== 'cancelled')) return;
  if (run.documentId) await db.delete(billingSources).where(eq(billingSources.documentId, run.documentId));
  await db.delete(billingRuns).where(eq(billingRuns.id, run.id));
}

/** Запуск биллинга: создаёт счёт на договор и период. Повторный запуск ничего не создаёт */
export async function runBilling(db: Db, ctx: DocCtx, opts: BillingOptions): Promise<{ period: string; items: BillingRunItem[] }> {
  const tz = await workspaceTimezone(db, ctx.workspaceId);
  const today = dateInTimezone(tz);
  const anchor = opts.period ? periodAnchor(opts.period) : today;
  const list = await candidates(db, { ...opts, workspaceId: ctx.workspaceId });
  const items: BillingRunItem[] = [];
  for (const contract of list) {
    await releaseCancelledRun(db, ctx.workspaceId, contract.id, periodOf(contract.periodicity ?? 'month', anchor).key);
    const result = await computeContractBilling(db, ctx.workspaceId, contract, anchor);
    const period = result.period.key;
    // идемпотентность: строка запуска уникальна по (договор, период) — второй воркер её не вставит
    const [run] = await db
      .insert(billingRuns)
      .values({ workspaceId: ctx.workspaceId, contractId: contract.id, period })
      .onConflictDoNothing()
      .returning();
    if (!run) {
      items.push({ contractId: contract.id, contractNumber: contract.number, documentId: null, number: null, skipped: true, reason: 'The invoice for this period has already been issued' });
      continue;
    }
    if (!result.computation.lines.length) {
      // строк нет — счёт не создаём, запуск удаляем: когда появятся работы, период можно будет выставить заново
      await db.delete(billingRuns).where(eq(billingRuns.id, run.id));
      items.push({ contractId: contract.id, contractNumber: contract.number, documentId: null, number: null, skipped: true, reason: 'There are no lines to invoice' });
      continue;
    }
    const docId = await createDocument(db, ctx, {
      type: 'invoice',
      organizationId: contract.organizationId,
      counterpartyId: contract.companyId,
      contractId: contract.id,
      date: today,
      dueDate: contract.paymentDays ? addDays(today, contract.paymentDays) : null,
      comment: `Billing for ${period}`,
      lines: result.computation.lines.map(l => ({ productId: l.productId, name: l.name, unitCode: l.unitCode, qty: l.qty, price: l.price, discountPct: '0', vatRate: l.vatRate as VatRate })),
    });
    // расшифровка биллинга — вкладка «Billing breakdown» счёта
    await db.insert(billingBreakdowns).values({
      workspaceId: ctx.workspaceId,
      documentId: docId,
      payload: {
        period,
        subscriptionPeriod: result.period.key,
        factPeriod: result.factPeriod.key,
        lines: result.computation.lines.map(l => ({ productId: l.productId, name: l.name, qty: l.qty, price: l.price, vatRate: l.vatRate, invoiceAsProductId: l.invoiceAsProductId, rows: l.breakdown })),
        warnings: result.computation.warnings,
      },
    });
    // учёт выставленных первичек: каждый документ и каждая запись времени — ровно один раз
    for (const s of result.computation.sources) {
      await db.insert(billingSources).values({ workspaceId: ctx.workspaceId, contractId: contract.id, sourceKind: s.sourceKind, sourceId: s.sourceId, documentId: docId }).onConflictDoNothing();
    }
    await db.update(billingRuns).set({ documentId: docId }).where(eq(billingRuns.id, run.id));
    // пакет «счёт + акт»
    let actId: string | null = null;
    const toAct = actLines(result.computation.lines);
    if (contract.documentPackage === 'invoice_act' && toAct.length) {
      actId = await createDocument(db, ctx, {
        type: 'act',
        organizationId: contract.organizationId,
        counterpartyId: contract.companyId,
        contractId: contract.id,
        date: today,
        comment: `Billing for ${period}`,
        lines: toAct.map(l => ({ productId: l.productId, name: l.name, unitCode: l.unitCode, qty: l.qty, price: l.price, discountPct: '0', vatRate: l.vatRate as VatRate })),
      });
      await db.update(documents).set({ basedOnId: docId }).where(eq(documents.id, actId));
    }
    // счёт периода проводится сразу: номер выдаётся при проведении (номера идут подряд, без дыр)
    await postDocument(db, ctx, docId);
    if (actId) await postDocument(db, ctx, actId);
    const [doc] = await db.select({ number: documents.number }).from(documents).where(eq(documents.id, docId)).limit(1);
    const number = doc?.number ?? null;
    items.push({ contractId: contract.id, contractNumber: contract.number, documentId: docId, number, skipped: false });
    await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'billing.run', entity: 'billing_run', recordId: docId, actorId: ctx.memberId, payload: { contractId: contract.id, period, number } });
  }
  return { period: opts.period ?? anchor, items };
}

/* ---------------- отчёт по договору ---------------- */

export interface ContractReportRow {
  contractId: string;
  contractNumber: string;
  companyName: string;
  income: string;
  expense: string;
}

/** Доходы и расходы по договорам (по документам с полем «Договор») */
export async function contractReport(db: Db, workspaceId: string, opts: { from?: string; to?: string; contractId?: string }): Promise<ContractReportRow[]> {
  const conds = [eq(documents.workspaceId, workspaceId), eq(documents.status, 'posted'), sql`${documents.contractId} is not null`];
  if (opts.from) conds.push(gte(documents.date, opts.from));
  if (opts.to) conds.push(lte(documents.date, opts.to));
  if (opts.contractId) conds.push(eq(documents.contractId, opts.contractId));
  const rows = await db
    .select({ contractId: documents.contractId, type: documents.type, total: documents.total })
    .from(documents)
    .where(and(...conds));
  // выручка — документы продажи (счёт — только требование оплаты, его сумма уже есть в отгрузке, акте или заказ-наряде);
  // расход — поступления (заказ поставщику — ещё не расход)
  const incomeTypes = ['realization', 'act', 'work_order'];
  const expenseTypes = ['receipt'];
  const map = new Map<string, { income: Dec; expense: Dec }>();
  for (const r of rows) {
    const id = r.contractId!;
    const cur = map.get(id) ?? { income: 0n, expense: 0n };
    const total = dec(r.total);
    if (incomeTypes.includes(r.type)) cur.income += total;
    if (expenseTypes.includes(r.type)) cur.expense += total;
    map.set(id, cur);
  }
  const list = await listContracts(db, { workspaceId });
  const out: ContractReportRow[] = [];
  for (const [id, v] of map) {
    const c = list.find(x => x.id === id);
    out.push({
      contractId: id,
      contractNumber: c?.number ?? '',
      companyName: c?.companyName ?? '',
      income: fmt(v.income, 2),
      expense: fmt(v.expense, 2),
    });
  }
  return out.sort((a, b) => a.companyName.localeCompare(b.companyName));
}
