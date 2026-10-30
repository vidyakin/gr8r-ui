/* Зарплата (задача 1184): кадровые данные, виды начислений, способы отражения, документы «Начисление зарплаты»
   и «Ведомость на выплату», расчёты с персоналом и отчёты. Правила — docs/architecture/payroll.md.
   Выплата идёт общим кодом денег: РКО или списание со счёта с операцией salary_payment на основании ведомости (payments.ts). */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import {
  advanceFor,
  dec,
  exceptionsFor,
  fmt,
  insuranceOf,
  isDeductionBase,
  isWorkingDayWith,
  lineMoves,
  ndflOf,
  percentAmount,
  periodEndOf,
  periodStartOf,
  dateRange,
  salaryByDays,
  salaryRegistryCsv,
  SYSTEM_PAYROLL_KINDS,
  TRIP_BASE_TYPES,
  tripAccrualAmount,
  type PayrollBaseType,
  type PayrollLineInput,
  type PayrollStatementPrintData,
  type PayslipData,
  type StatementLineInput,
} from '@gr8r/shared';
import type { Db } from './client';
import { assertPeriodOpen, clearPeriodCosts } from './cost-closing';
import { DOCUMENT_HOOKS } from './document-hooks';
import type { DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { createPayment, ensureCashFlowItems, printOrg } from './payments';
import { calendarContext } from './planning';
import { pieceworkReport } from './piecework';
import { postedSalesDocs, workOrdersFactDocs } from './service-reports';
import {
  costItems,
  documents,
  employeeAccruals,
  employeePayroll,
  fleetTripStops,
  fleetTrips,
  members,
  organizations,
  paymentLines,
  payrollHeaders,
  payrollKinds,
  payrollLines,
  payrollMoves,
  payrollReflections,
  payrollStatementHeaders,
  payrollStatementLines,
  periodCosts,
  stockMoves,
  workCenters,
  workspaces,
} from './schema';

const today = () => new Date().toISOString().slice(0, 10);
type DocRow = typeof documents.$inferSelect;
type KindRow = typeof payrollKinds.$inferSelect;

/* ---------------- справочники ---------------- */

/** Системные виды создаются при первом обращении; результат — по ключу */
export async function ensurePayrollKinds(db: Db, workspaceId: string): Promise<Map<string, KindRow>> {
  let rows = await db.select().from(payrollKinds).where(eq(payrollKinds.workspaceId, workspaceId));
  const have = new Set(rows.map(r => r.systemKey).filter(Boolean));
  const missing = SYSTEM_PAYROLL_KINDS.filter(k => !have.has(k.key));
  if (missing.length) {
    await db.insert(payrollKinds).values(missing.map(k => ({ workspaceId, name: k.name, baseType: k.key, systemKey: k.key, insurable: k.insurable }))).onConflictDoNothing();
    rows = await db.select().from(payrollKinds).where(eq(payrollKinds.workspaceId, workspaceId));
  }
  return new Map(rows.filter(r => r.systemKey).map(r => [r.systemKey!, r]));
}

export async function listPayrollKinds(db: Db, workspaceId: string) {
  await ensurePayrollKinds(db, workspaceId);
  return db.select().from(payrollKinds).where(and(eq(payrollKinds.workspaceId, workspaceId), isNull(payrollKinds.archivedAt))).orderBy(asc(payrollKinds.createdAt), asc(payrollKinds.name));
}

export async function createPayrollKind(db: Db, ctx: DocCtx, input: { id?: string; name: string; baseType: PayrollBaseType; insurable: boolean }): Promise<string> {
  const [row] = await db
    .insert(payrollKinds)
    .values({ ...(input.id ? { id: input.id } : {}), workspaceId: ctx.workspaceId, name: input.name, baseType: input.baseType, insurable: isDeductionBase(input.baseType) ? false : input.insurable })
    .returning({ id: payrollKinds.id });
  return row!.id;
}

export async function updatePayrollKind(db: Db, id: string, patch: { name?: string; insurable?: boolean }): Promise<void> {
  const [k] = await db.select().from(payrollKinds).where(eq(payrollKinds.id, id)).limit(1);
  if (!k) throw new DomainError(404, 'not_found', 'payroll kind not found');
  await db.update(payrollKinds).set({ ...(patch.name ? { name: patch.name } : {}), ...(patch.insurable !== undefined && !isDeductionBase(k.baseType) ? { insurable: patch.insurable } : {}) }).where(eq(payrollKinds.id, id));
}

export async function archivePayrollKind(db: Db, id: string): Promise<void> {
  const [k] = await db.select().from(payrollKinds).where(eq(payrollKinds.id, id)).limit(1);
  if (!k) throw new DomainError(404, 'not_found', 'payroll kind not found');
  if (k.systemKey) throw new DomainError(409, 'system_kind', 'A system payroll kind cannot be deleted');
  const [used] = await db.select({ id: payrollLines.id }).from(payrollLines).where(eq(payrollLines.kindId, id)).limit(1);
  if (used) throw new DomainError(409, 'payroll_kind_in_use', 'The payroll kind is used in documents');
  await db.update(payrollKinds).set({ archivedAt: new Date() }).where(eq(payrollKinds.id, id));
}

export async function listReflections(db: Db, workspaceId: string) {
  const rows = await db
    .select({ r: payrollReflections, costItemName: costItems.name, workCenterName: workCenters.name })
    .from(payrollReflections)
    .innerJoin(costItems, eq(costItems.id, payrollReflections.costItemId))
    .leftJoin(workCenters, eq(workCenters.id, payrollReflections.workCenterId))
    .where(and(eq(payrollReflections.workspaceId, workspaceId), isNull(payrollReflections.archivedAt)))
    .orderBy(asc(payrollReflections.name));
  return rows.map(x => ({ ...x.r, costItemName: x.costItemName, workCenterName: x.workCenterName }));
}

export async function createReflection(db: Db, ctx: DocCtx, input: { id?: string; name: string; costItemId: string; workCenterId?: string | null }): Promise<string> {
  const [row] = await db
    .insert(payrollReflections)
    .values({ ...(input.id ? { id: input.id } : {}), workspaceId: ctx.workspaceId, name: input.name, costItemId: input.costItemId, workCenterId: input.workCenterId ?? null })
    .returning({ id: payrollReflections.id });
  return row!.id;
}

export async function updateReflection(db: Db, id: string, patch: { name?: string; costItemId?: string; workCenterId?: string | null }): Promise<void> {
  const set: Partial<typeof payrollReflections.$inferInsert> = { updatedAt: new Date() };
  if (patch.name) set.name = patch.name;
  if (patch.costItemId) set.costItemId = patch.costItemId;
  if (patch.workCenterId !== undefined) set.workCenterId = patch.workCenterId;
  const res = await db.update(payrollReflections).set(set).where(eq(payrollReflections.id, id)).returning({ id: payrollReflections.id });
  if (!res.length) throw new DomainError(404, 'not_found', 'reflection not found');
}

export async function archiveReflection(db: Db, id: string): Promise<void> {
  await db.update(payrollReflections).set({ archivedAt: new Date() }).where(eq(payrollReflections.id, id));
}

export interface PayrollSettings {
  insuranceRate: string;
  /** Ставки оплаты водителям по рейсам (задача 1224) */
  tripPieceworkRate: string;
  tripKmRate: string;
  tripStopRate: string;
  tripPerdiemRate: string;
}

export async function payrollSettings(db: Db, workspaceId: string): Promise<PayrollSettings> {
  const [w] = await db
    .select({
      insuranceRate: workspaces.payrollInsuranceRate,
      tripPieceworkRate: workspaces.payrollTripPieceworkRate,
      tripKmRate: workspaces.payrollTripKmRate,
      tripStopRate: workspaces.payrollTripStopRate,
      tripPerdiemRate: workspaces.payrollTripPerdiemRate,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return {
    insuranceRate: w?.insuranceRate ?? '30',
    tripPieceworkRate: w?.tripPieceworkRate ?? '0',
    tripKmRate: w?.tripKmRate ?? '0',
    tripStopRate: w?.tripStopRate ?? '0',
    tripPerdiemRate: w?.tripPerdiemRate ?? '0',
  };
}

export interface PayrollSettingsPatch {
  insuranceRate?: string;
  tripPieceworkRate?: string;
  tripKmRate?: string;
  tripStopRate?: string;
  tripPerdiemRate?: string;
}

export async function setInsuranceRate(db: Db, workspaceId: string, rate: string): Promise<void> {
  await db.update(workspaces).set({ payrollInsuranceRate: rate }).where(eq(workspaces.id, workspaceId));
}

/** Обновить ставку страховых взносов и/или ставки оплаты рейсов (задача 1224): переданы только заданные поля */
export async function updatePayrollSettings(db: Db, workspaceId: string, patch: PayrollSettingsPatch): Promise<void> {
  const set: Record<string, string> = {};
  if (patch.insuranceRate !== undefined) set.payrollInsuranceRate = patch.insuranceRate;
  if (patch.tripPieceworkRate !== undefined) set.payrollTripPieceworkRate = patch.tripPieceworkRate;
  if (patch.tripKmRate !== undefined) set.payrollTripKmRate = patch.tripKmRate;
  if (patch.tripStopRate !== undefined) set.payrollTripStopRate = patch.tripStopRate;
  if (patch.tripPerdiemRate !== undefined) set.payrollTripPerdiemRate = patch.tripPerdiemRate;
  if (Object.keys(set).length === 0) return;
  await db.update(workspaces).set(set).where(eq(workspaces.id, workspaceId));
}

/* ---------------- кадровые данные ---------------- */

export interface EmployeePayrollPatch {
  hiredAt?: string | null | undefined;
  firedAt?: string | null | undefined;
  organizationId?: string | null | undefined;
  workCenterId?: string | null | undefined;
  reflectionId?: string | null | undefined;
  ndflRate?: string | undefined;
  cardAccount?: string | undefined;
  advanceAmount?: string | null | undefined;
  advancePercent?: string | null | undefined;
}

export async function listEmployees(db: Db, workspaceId: string) {
  const rows = await db
    .select({ m: { id: members.id, name: members.name, title: members.title, status: members.status }, e: employeePayroll })
    .from(members)
    .leftJoin(employeePayroll, and(eq(employeePayroll.workspaceId, members.workspaceId), eq(employeePayroll.memberId, members.id)))
    .where(eq(members.workspaceId, workspaceId))
    .orderBy(asc(members.name));
  const accruals = await db.select().from(employeeAccruals).where(eq(employeeAccruals.workspaceId, workspaceId)).orderBy(asc(employeeAccruals.validFrom));
  const kinds = new Map((await db.select().from(payrollKinds).where(eq(payrollKinds.workspaceId, workspaceId))).map(k => [k.id, k]));
  return rows.map(r => ({
    memberId: r.m.id,
    name: r.m.name,
    title: r.m.title,
    status: r.m.status,
    configured: !!r.e,
    hiredAt: r.e?.hiredAt ?? null,
    firedAt: r.e?.firedAt ?? null,
    organizationId: r.e?.organizationId ?? null,
    workCenterId: r.e?.workCenterId ?? null,
    reflectionId: r.e?.reflectionId ?? null,
    ndflRate: r.e?.ndflRate ?? '13',
    cardAccount: r.e?.cardAccount ?? '',
    advanceAmount: r.e?.advanceAmount ?? null,
    advancePercent: r.e?.advancePercent ?? null,
    accruals: accruals.filter(a => a.memberId === r.m.id).map(a => ({ ...a, kindName: kinds.get(a.kindId)?.name ?? '', baseType: kinds.get(a.kindId)?.baseType ?? '' })),
  }));
}

export async function updateEmployeePayroll(db: Db, ctx: DocCtx, memberId: string, patch: EmployeePayrollPatch): Promise<void> {
  const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, memberId)).limit(1);
  if (!m) throw new DomainError(404, 'not_found', 'employee not found');
  const set: Partial<typeof employeePayroll.$inferInsert> = { updatedAt: new Date() };
  for (const k of ['hiredAt', 'firedAt', 'organizationId', 'workCenterId', 'reflectionId', 'advanceAmount', 'advancePercent'] as const) if (patch[k] !== undefined) set[k] = patch[k] as never;
  if (patch.ndflRate !== undefined) set.ndflRate = patch.ndflRate;
  if (patch.cardAccount !== undefined) set.cardAccount = patch.cardAccount;
  await db.insert(employeePayroll).values({ workspaceId: ctx.workspaceId, memberId, ...set }).onConflictDoUpdate({ target: [employeePayroll.workspaceId, employeePayroll.memberId], set });
}

export async function addEmployeeAccrual(
  db: Db,
  ctx: DocCtx,
  input: { id?: string | undefined; memberId: string; kindId: string; validFrom: string; amount?: string | null | undefined; percent?: string | null | undefined; percentBasis: string },
): Promise<string> {
  const [k] = await db.select().from(payrollKinds).where(eq(payrollKinds.id, input.kindId)).limit(1);
  if (!k || !['salary', 'sales_percent', 'bonus'].includes(k.baseType)) throw new DomainError(422, 'invalid_accrual_kind', 'Planned accruals are salary, sales percent or bonus');
  if (k.baseType === 'sales_percent' ? input.percent == null : input.amount == null) throw new DomainError(422, 'accrual_value_required', k.baseType === 'sales_percent' ? 'Specify the percent' : 'Specify the amount');
  const values = { workspaceId: ctx.workspaceId, memberId: input.memberId, kindId: input.kindId, validFrom: input.validFrom, amount: k.baseType === 'sales_percent' ? null : input.amount!, percent: k.baseType === 'sales_percent' ? input.percent! : null, percentBasis: input.percentBasis };
  const [row] = await db
    .insert(employeeAccruals)
    .values({ ...(input.id ? { id: input.id } : {}), ...values })
    .onConflictDoUpdate({ target: [employeeAccruals.workspaceId, employeeAccruals.memberId, employeeAccruals.kindId, employeeAccruals.validFrom], set: { amount: values.amount, percent: values.percent, percentBasis: values.percentBasis } })
    .returning({ id: employeeAccruals.id });
  return row!.id;
}

export async function deleteEmployeeAccrual(db: Db, id: string): Promise<void> {
  await db.delete(employeeAccruals).where(eq(employeeAccruals.id, id));
}

/* ---------------- вспомогательное ---------------- */

async function defaultOrganizationId(db: Db): Promise<string> {
  const [o] = await db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.archivedAt)).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
  if (!o) throw new DomainError(422, 'organization_required', 'Add an organization in Settings → Organizations first');
  return o.id;
}

async function loadDoc(db: Db, id: string, type: 'payroll' | 'payroll_statement', lock = false): Promise<DocRow> {
  const q = db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row || row.type !== type) throw new DomainError(404, 'not_found', 'document not found');
  return row;
}

const sumDec = (xs: string[]) => xs.reduce((s, x) => s + dec(x), 0n);

/** Баланс долга перед сотрудниками на дату: member → сумма (+ мы должны) */
export async function payrollBalances(db: Db, workspaceId: string, asOf?: string): Promise<Map<string, bigint>> {
  const rows = await db
    .select({ memberId: payrollMoves.memberId, s: sql<string>`coalesce(sum(${payrollMoves.amount}), 0)::text` })
    .from(payrollMoves)
    .where(and(eq(payrollMoves.workspaceId, workspaceId), asOf ? lte(payrollMoves.date, asOf) : undefined))
    .groupBy(payrollMoves.memberId);
  return new Map(rows.map(r => [r.memberId, dec(r.s)]));
}

/* ---------------- начисление зарплаты: ввод ---------------- */

export interface PayrollInput {
  id?: string | undefined;
  organizationId?: string | null | undefined;
  period?: string | undefined;
  workCenterId?: string | null | undefined;
  date?: string | undefined;
  comment?: string | undefined;
  lines?: PayrollLineInput[] | undefined;
}

async function payrollTotals(db: Db, docId: string): Promise<void> {
  const rows = await db.select({ amount: payrollLines.amount, kindId: payrollLines.kindId }).from(payrollLines).where(eq(payrollLines.documentId, docId));
  const kinds = new Map((await db.select({ id: payrollKinds.id, baseType: payrollKinds.baseType }).from(payrollKinds)).map(k => [k.id, k.baseType]));
  const accrued = sumDec(rows.filter(r => !isDeductionBase(kinds.get(r.kindId) ?? '')).map(r => r.amount));
  await db.update(documents).set({ amountNet: fmt(accrued, 2), vatTotal: '0.00', total: fmt(accrued, 2), updatedAt: new Date() }).where(eq(documents.id, docId));
}

async function savePayrollLines(db: Db, ctx: DocCtx, doc: DocRow, inputs: PayrollLineInput[]): Promise<void> {
  await ensurePayrollKinds(db, ctx.workspaceId);
  const kinds = new Map((await db.select().from(payrollKinds).where(eq(payrollKinds.workspaceId, ctx.workspaceId))).map(k => [k.id, k]));
  const emps = new Map((await db.select().from(employeePayroll).where(eq(employeePayroll.workspaceId, ctx.workspaceId))).map(e => [e.memberId, e]));
  const { insuranceRate } = await payrollSettings(db, ctx.workspaceId);
  const rows = inputs.map((l, i) => {
    const kind = kinds.get(l.kindId);
    if (!kind) throw new DomainError(422, 'invalid_reference', 'The payroll kind does not exist');
    const deduction = isDeductionBase(kind.baseType);
    return {
      id: l.id,
      workspaceId: ctx.workspaceId,
      documentId: doc.id,
      sortOrder: i,
      memberId: l.memberId,
      kindId: l.kindId,
      base: fmt(dec(l.base), 2),
      rate: fmt(dec(l.rate), 4),
      workedDays: l.workedDays,
      normDays: l.normDays,
      amount: fmt(dec(l.amount), 2),
      ndfl: deduction ? '0.00' : (l.ndfl ?? ndflOf(l.amount, emps.get(l.memberId)?.ndflRate ?? '13')),
      insurance: deduction ? '0.00' : (l.insurance ?? insuranceOf(l.amount, insuranceRate, kind.insurable)),
      reflectionId: l.reflectionId ?? emps.get(l.memberId)?.reflectionId ?? null,
      tripId: l.tripId ?? null,
      comment: l.comment?.trim() ?? '',
    } satisfies typeof payrollLines.$inferInsert;
  });
  const existing = new Set((await db.select({ id: payrollLines.id }).from(payrollLines).where(eq(payrollLines.documentId, doc.id))).map(r => r.id));
  const keep = new Set(rows.map(r => r.id).filter((x): x is string => !!x));
  const drop = [...existing].filter(id => !keep.has(id));
  if (drop.length) await db.delete(payrollLines).where(inArray(payrollLines.id, drop));
  for (const r of rows) {
    if (r.id && existing.has(r.id)) {
      const { id, workspaceId: _w, documentId: _d, ...set } = r;
      await db.update(payrollLines).set(set).where(eq(payrollLines.id, id));
    } else await db.insert(payrollLines).values(r);
  }
  await payrollTotals(db, doc.id);
}

export async function createPayroll(db: Db, ctx: DocCtx, input: PayrollInput): Promise<string> {
  if (!input.period) throw new DomainError(422, 'period_required', 'Select the payroll period');
  const organizationId = input.organizationId ?? (await defaultOrganizationId(db));
  const period = periodStartOf(input.period);
  await ensurePayrollKinds(db, ctx.workspaceId);
  const [row] = await db
    .insert(documents)
    .values({ ...(input.id ? { id: input.id } : {}), workspaceId: ctx.workspaceId, type: 'payroll', date: input.date ?? periodEndOf(period), organizationId, comment: input.comment ?? '', responsibleId: ctx.memberId, createdBy: ctx.memberId })
    .returning();
  await db.insert(payrollHeaders).values({ workspaceId: ctx.workspaceId, documentId: row!.id, period, workCenterId: input.workCenterId ?? null });
  if (input.lines?.length) await savePayrollLines(db, ctx, row!, input.lines);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: row!.id, actorId: ctx.memberId, payload: { documentType: 'payroll' } });
  return row!.id;
}

export async function updatePayroll(db: Db, ctx: DocCtx, id: string, patch: Omit<PayrollInput, 'id'>): Promise<void> {
  const doc = await loadDoc(db, id, 'payroll', true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only a draft can be edited: unpost the document first');
  if (patch.date && patch.date !== doc.date) await assertPeriodOpen(db, ctx.workspaceId, patch.date);
  const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  if (patch.organizationId) set.organizationId = patch.organizationId;
  if (patch.date) set.date = patch.date;
  if (patch.comment !== undefined) set.comment = patch.comment;
  const [row] = await db.update(documents).set(set).where(eq(documents.id, id)).returning();
  const hdr: Partial<typeof payrollHeaders.$inferInsert> = {};
  if (patch.period) hdr.period = periodStartOf(patch.period);
  if (patch.workCenterId !== undefined) hdr.workCenterId = patch.workCenterId;
  if (Object.keys(hdr).length) await db.update(payrollHeaders).set(hdr).where(eq(payrollHeaders.documentId, id));
  if (patch.lines) await savePayrollLines(db, ctx, row!, patch.lines);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'payroll' } });
}

/* ---------------- заполнение по фактам периода ---------------- */

/** Факт выручки или маржи по ответственным за период (те же документы, что план-факт продаж) */
async function salesByResponsible(db: Db, workspaceId: string, from: string, to: string, wantMargin: boolean): Promise<{ revenue: Map<string, bigint>; margin: Map<string, bigint> }> {
  const docs = [...(await postedSalesDocs(db, workspaceId, from, to)), ...(await workOrdersFactDocs(db, workspaceId, from, to))].filter(d => d.responsibleId);
  const revenue = new Map<string, bigint>();
  const margin = new Map<string, bigint>();
  const cost = new Map<string, bigint>();
  if (wantMargin && docs.length) {
    const rows = await db
      .select({ documentId: stockMoves.documentId, c: sql<string>`coalesce(sum(-${stockMoves.qty} * ${stockMoves.cost}), 0)::text` })
      .from(stockMoves)
      .where(inArray(stockMoves.documentId, docs.map(d => d.id)))
      .groupBy(stockMoves.documentId);
    for (const r of rows) cost.set(r.documentId, dec(r.c));
  }
  for (const d of docs) {
    const sign = d.type === 'customer_return' ? -1n : 1n;
    const net = sign * dec(d.net);
    revenue.set(d.responsibleId!, (revenue.get(d.responsibleId!) ?? 0n) + net);
    margin.set(d.responsibleId!, (margin.get(d.responsibleId!) ?? 0n) + net - (cost.get(d.id) ?? 0n));
  }
  return { revenue, margin };
}

/** Начисления водителям по фактически завершённым рейсам за период: за рейс, за км маршрута, за точку доставки (done),
    суточные по междугородним рейсам (день рейса — каждый день dateFrom..dateTo). Одна запись на сотрудника × вид × рейс
    (строка документа получает trip_id и номер рейса в комментарии); совместный водитель получает начисление по тем же
    ставкам, что основной (решение задачи 1224 — ставки не делятся). Рейс относится ровно к одному периоду по дате
    завершения (finishedAt, в её отсутствие — dateTo). Рейс, по которому у сотрудника этот вид уже есть в другом
    неотменённом документе начисления (кроме самого заполняемого — его старые строки будут заменены), не включается:
    это защита от двойного начисления; повторное «Заполнить» того же документа пересчитывает его собственные строки. */
async function tripAccrualsReport(
  db: Db,
  workspaceId: string,
  from: string,
  to: string,
  rates: { tripPieceworkRate: string; tripKmRate: string; tripStopRate: string; tripPerdiemRate: string },
  excludeDocumentId: string,
): Promise<{ memberId: string; tripId: string; tripNumber: string; base: PayrollBaseType; amount: string }[]> {
  const out: { memberId: string; tripId: string; tripNumber: string; base: PayrollBaseType; amount: string }[] = [];

  const trips = await db
    .select()
    .from(fleetTrips)
    .where(
      and(
        eq(fleetTrips.workspaceId, workspaceId),
        eq(fleetTrips.status, 'done'),
        sql`coalesce(${fleetTrips.finishedAt}::date, ${fleetTrips.dateTo}) >= ${from}::date`,
        sql`coalesce(${fleetTrips.finishedAt}::date, ${fleetTrips.dateTo}) <= ${to}::date`,
      ),
    );
  if (!trips.length) return out;

  const tripIds = trips.map(t => t.id);
  const stopCounts = new Map<string, number>();
  if (dec(rates.tripStopRate) > 0n) {
    const rows = await db
      .select({ tripId: fleetTripStops.tripId, n: sql<string>`count(*)` })
      .from(fleetTripStops)
      .where(and(inArray(fleetTripStops.tripId, tripIds), eq(fleetTripStops.kind, 'delivery'), eq(fleetTripStops.status, 'done')))
      .groupBy(fleetTripStops.tripId);
    for (const r of rows) stopCounts.set(r.tripId, Number(r.n));
  }

  // уже начислено по рейсу × сотруднику × виду в других неотменённых документах — такой рейс пропускаем (защита от двойного начисления)
  const already = await db
    .select({ tripId: payrollLines.tripId, memberId: payrollLines.memberId, kindId: payrollLines.kindId })
    .from(payrollLines)
    .innerJoin(documents, eq(documents.id, payrollLines.documentId))
    .where(and(eq(payrollLines.workspaceId, workspaceId), inArray(payrollLines.tripId, tripIds), ne(documents.status, 'cancelled'), ne(documents.id, excludeDocumentId)));
  const kindBase = new Map((await db.select({ id: payrollKinds.id, baseType: payrollKinds.baseType }).from(payrollKinds).where(eq(payrollKinds.workspaceId, workspaceId))).map(k => [k.id, k.baseType]));
  const taken = new Set(already.map(r => `${r.tripId}:${r.memberId}:${kindBase.get(r.kindId) ?? ''}`));

  for (const t of trips) {
    const drivers = [t.driverMemberId, ...(t.coDriverMemberId ? [t.coDriverMemberId] : [])];
    for (const memberId of drivers) {
      const add = (base: PayrollBaseType, amount: string) => {
        if (dec(amount) <= 0n) return;
        if (taken.has(`${t.id}:${memberId}:${base}`)) return;
        out.push({ memberId, tripId: t.id, tripNumber: t.number, base, amount });
      };
      add('trip_piecework', tripAccrualAmount(1, rates.tripPieceworkRate));
      if (t.routeKm) add('trip_km', tripAccrualAmount(t.routeKm, rates.tripKmRate));
      const stops = stopCounts.get(t.id) ?? 0;
      if (stops > 0) add('trip_stop', tripAccrualAmount(stops, rates.tripStopRate));
      if (t.kind === 'intercity') {
        const days = dateRange(t.dateFrom, t.dateTo).length;
        if (days > 0) add('trip_perdiem', tripAccrualAmount(days, rates.tripPerdiemRate));
      }
    }
  }
  return out;
}

/** Сумма оплаты водителю за рейс (задача 1224): amount + insurance строк с этим trip_id в проведённых документах начисления.
    Берёт маржа рейса (задача 1223) — поэтому только проведённые суммы, ещё не выплата, а начисленная затрата. */
export async function tripDriverPay(db: Db, tripId: string): Promise<string> {
  const [row] = await db
    .select({ s: sql<string>`coalesce(sum(${payrollLines.amount} + ${payrollLines.insurance}), 0)::text` })
    .from(payrollLines)
    .innerJoin(documents, eq(documents.id, payrollLines.documentId))
    .where(and(eq(payrollLines.tripId, tripId), eq(documents.status, 'posted')));
  return fmt(dec(row?.s ?? '0'), 2);
}

/** Заполнить: оклад по графику, сдельная по нарядам, процент от продаж и премии. Строки разовых начислений и удержаний сохраняются */
export async function fillPayroll(db: Db, ctx: DocCtx, id: string, memberIds?: string[]): Promise<void> {
  const doc = await loadDoc(db, id, 'payroll', true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only a draft can be edited: unpost the document first');
  const [hdr] = await db.select().from(payrollHeaders).where(eq(payrollHeaders.documentId, id)).limit(1);
  if (!hdr) throw new DomainError(404, 'not_found', 'document not found');
  const from = hdr.period;
  const to = periodEndOf(from);
  const kinds = await ensurePayrollKinds(db, ctx.workspaceId);
  const kindById = new Map([...kinds.values()].map(k => [k.id, k]));
  const { insuranceRate, tripPieceworkRate, tripKmRate, tripStopRate, tripPerdiemRate } = await payrollSettings(db, ctx.workspaceId);

  const empRows = await db
    .select({ m: members, e: employeePayroll })
    .from(employeePayroll)
    .innerJoin(members, and(eq(members.workspaceId, employeePayroll.workspaceId), eq(members.id, employeePayroll.memberId)))
    .where(eq(employeePayroll.workspaceId, ctx.workspaceId));
  const emps = empRows.filter(({ m, e }) => {
    if (memberIds?.length && !memberIds.includes(m.id)) return false;
    if (e.hiredAt && e.hiredAt > to) return false;
    if (e.firedAt && e.firedAt < from) return false;
    if (e.organizationId && e.organizationId !== doc.organizationId) return false;
    if (hdr.workCenterId && e.workCenterId !== hdr.workCenterId) return false;
    return true;
  });

  // плановые начисления: действует последнее значение с датой не позже конца периода (смена в середине месяца — со следующего)
  const accRows = await db.select().from(employeeAccruals).where(and(eq(employeeAccruals.workspaceId, ctx.workspaceId), lte(employeeAccruals.validFrom, to))).orderBy(asc(employeeAccruals.validFrom));
  const planned = new Map<string, (typeof accRows)[number]>();
  for (const a of accRows) planned.set(`${a.memberId}:${a.kindId}`, a);

  const cal = await calendarContext(db, ctx.workspaceId);
  const monthDays = dateRange(from, to);
  const pw = new Map<string, bigint>();
  for (const r of await pieceworkReport(db, { from, to })) pw.set(r.memberId, (pw.get(r.memberId) ?? 0n) + dec(r.amount));
  const wantMargin = [...planned.values()].some(a => a.percentBasis === 'margin' && a.percent !== null);
  const sales = await salesByResponsible(db, ctx.workspaceId, from, to, wantMargin);
  const tripAccruals = await tripAccrualsReport(db, ctx.workspaceId, from, to, { tripPieceworkRate, tripKmRate, tripStopRate, tripPerdiemRate }, id);
  const tripByMember = new Map<string, (typeof tripAccruals)[number][]>();
  for (const t of tripAccruals) tripByMember.set(t.memberId, [...(tripByMember.get(t.memberId) ?? []), t]);

  const auto: PayrollLineInput[] = [];
  for (const { m, e } of emps) {
    const calendar = (m.calendarId ? cal.calendars.get(m.calendarId) : null) ?? cal.defaultCalendar;
    const exceptions = exceptionsFor(cal.exceptionsByScope, 'member', m.id);
    const norm = monthDays.filter(d => isWorkingDayWith(calendar, d, cal.holidays, [])).length;
    const empFrom = e.hiredAt && e.hiredAt > from ? e.hiredAt : from;
    const empTo = e.firedAt && e.firedAt < to ? e.firedAt : to;
    const worked = monthDays.filter(d => d >= empFrom && d <= empTo && isWorkingDayWith(calendar, d, cal.holidays, exceptions)).length;
    const push = (kindId: string, base: string, rate: string, amount: string, extra: Partial<PayrollLineInput> = {}) => {
      if (dec(amount) <= 0n) return;
      const kind = kindById.get(kindId)!;
      auto.push({
        memberId: m.id,
        kindId,
        base,
        rate,
        workedDays: 0,
        normDays: 0,
        amount,
        ndfl: ndflOf(amount, e.ndflRate),
        insurance: insuranceOf(amount, insuranceRate, kind.insurable),
        reflectionId: e.reflectionId,
        comment: '',
        ...extra,
      });
    };
    for (const a of accRows.filter(x => x.memberId === m.id && planned.get(`${x.memberId}:${x.kindId}`) === x)) {
      const kind = kindById.get(a.kindId);
      if (!kind) continue;
      if (kind.baseType === 'salary' && a.amount) push(kind.id, a.amount, '0', salaryByDays(a.amount, worked, norm), { workedDays: worked, normDays: norm });
      else if (kind.baseType === 'sales_percent' && a.percent) {
        const base = fmt((a.percentBasis === 'margin' ? sales.margin : sales.revenue).get(m.id) ?? 0n, 2);
        push(kind.id, base, a.percent, percentAmount(base, a.percent));
      } else if (kind.baseType === 'bonus' && a.amount) push(kind.id, a.amount, '0', fmt(dec(a.amount), 2));
    }
    const pieceSum = pw.get(m.id) ?? 0n;
    if (pieceSum > 0n) push(kinds.get('piecework')!.id, fmt(pieceSum, 2), '0', fmt(pieceSum, 2));
    // одна строка на сотрудника × вид × рейс, номер рейса — в комментарии (задача 1224)
    for (const t of tripByMember.get(m.id) ?? []) push(kinds.get(t.base)!.id, t.amount, '0', t.amount, { tripId: t.tripId, comment: `рейс ${t.tripNumber}` });
  }

  // сохраняем ручные строки (разовые, удержания) и строки сотрудников вне выборки
  const existing = await db.select().from(payrollLines).where(eq(payrollLines.documentId, id)).orderBy(asc(payrollLines.sortOrder));
  const keepRows = existing.filter(l => {
    const b = kindById.get(l.kindId)?.baseType;
    const isAuto = b === 'salary' || b === 'piecework' || b === 'sales_percent' || b === 'bonus' || (TRIP_BASE_TYPES as readonly string[]).includes(b ?? '');
    return !(isAuto && (!memberIds?.length || memberIds.includes(l.memberId)));
  });
  const keepInputs: PayrollLineInput[] = keepRows.map(l => ({ id: l.id, memberId: l.memberId, kindId: l.kindId, base: l.base, rate: l.rate, workedDays: l.workedDays, normDays: l.normDays, amount: l.amount, ndfl: l.ndfl, insurance: l.insurance, reflectionId: l.reflectionId, tripId: l.tripId, comment: l.comment }));
  await savePayrollLines(db, ctx, doc, [...keepInputs, ...auto]);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'payroll', filled: true } });
}

/* ---------------- проверка и проведение начисления ---------------- */

async function payrollContext(db: Db, doc: DocRow) {
  const [hdr] = await db.select().from(payrollHeaders).where(eq(payrollHeaders.documentId, doc.id)).limit(1);
  const lines = await db.select().from(payrollLines).where(eq(payrollLines.documentId, doc.id)).orderBy(asc(payrollLines.sortOrder));
  const kinds = new Map((await db.select().from(payrollKinds)).map(k => [k.id, k]));
  const reflections = new Map((await db.select().from(payrollReflections)).map(r => [r.id, r]));
  return { hdr: hdr!, lines, kinds, reflections };
}

/** Затрата строки: сдельная уже в себестоимости выпуска (только взносы), остальное — вся сумма и взносы; удержания затрат не дают */
const lineCost = (baseType: string, amount: string, insurance: string): bigint => (isDeductionBase(baseType) ? 0n : (baseType === 'piecework' ? 0n : dec(amount)) + dec(insurance));

DOCUMENT_HOOKS.payroll = {
  check: async (db, ctx, doc) => {
    const { hdr, lines, kinds, reflections } = await payrollContext(db, doc);
    if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one line before posting');
    await assertPeriodOpen(db, ctx.workspaceId, periodEndOf(hdr.period));
    for (const l of lines) {
      const kind = kinds.get(l.kindId);
      if (!kind || kind.archivedAt) throw new DomainError(422, 'invalid_reference', 'The payroll kind does not exist or is archived');
      if (dec(l.amount) <= 0n) throw new DomainError(422, 'invalid_amount', 'The amount must be greater than zero');
      if (lineCost(kind.baseType, l.amount, l.insurance) > 0n && (!l.reflectionId || !reflections.get(l.reflectionId))) throw new DomainError(422, 'reflection_required', 'Select a cost reflection for every accrual line', { memberId: l.memberId });
    }
  },
  post: async (db, ctx, doc) => {
    const { hdr, lines, kinds, reflections } = await payrollContext(db, doc);
    await payrollTotals(db, doc.id);
    await db.delete(payrollMoves).where(eq(payrollMoves.documentId, doc.id));
    await clearPeriodCosts(db, ctx.workspaceId, doc.id);
    const costs = new Map<string, { costItemId: string; workCenterId: string | null; amount: bigint }>();
    for (const l of lines) {
      const kind = kinds.get(l.kindId)!;
      for (const mv of lineMoves({ amount: l.amount, ndfl: l.ndfl, deduction: isDeductionBase(kind.baseType) })) {
        await db.insert(payrollMoves).values({ workspaceId: ctx.workspaceId, memberId: l.memberId, documentId: doc.id, lineId: l.id, date: doc.date, kind: mv.kind, amount: mv.amount });
      }
      const cost = lineCost(kind.baseType, l.amount, l.insurance);
      if (cost <= 0n) continue;
      const r = reflections.get(l.reflectionId!)!;
      const wc = r.workCenterId ?? hdr.workCenterId ?? null;
      const key = `${r.costItemId}|${wc ?? ''}`;
      const cur = costs.get(key) ?? { costItemId: r.costItemId, workCenterId: wc, amount: 0n };
      cur.amount += cost;
      costs.set(key, cur);
    }
    for (const c of costs.values()) {
      await db.insert(periodCosts).values({ workspaceId: ctx.workspaceId, period: hdr.period, costItemId: c.costItemId, workCenterId: c.workCenterId, amount: fmt(c.amount, 2), source: 'payroll', documentId: doc.id });
    }
  },
  afterPost: async (db, ctx, doc) => {
    await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.payroll_posted', entity: 'document', recordId: doc.id, actorId: ctx.memberId, payload: { documentType: 'payroll' } });
  },
  afterUnpost: async (db, ctx, doc) => {
    await db.delete(payrollMoves).where(eq(payrollMoves.documentId, doc.id));
    await clearPeriodCosts(db, ctx.workspaceId, doc.id);
  },
};

/* ---------------- карточка и журнал начисления ---------------- */

export async function payrollDetail(db: Db, id: string) {
  const doc = await loadDoc(db, id, 'payroll');
  const { hdr, lines, kinds, reflections } = await payrollContext(db, doc);
  const names = new Map((await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, [...new Set(lines.map(l => l.memberId))].length ? [...new Set(lines.map(l => l.memberId))] : ['00000000-0000-0000-0000-000000000000']))).map(m => [m.id, m.name]));
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, doc.organizationId)).limit(1);
  let accrued = 0n;
  let ndfl = 0n;
  let insurance = 0n;
  let deductions = 0n;
  for (const l of lines) {
    if (isDeductionBase(kinds.get(l.kindId)?.baseType ?? '')) deductions += dec(l.amount);
    else {
      accrued += dec(l.amount);
      ndfl += dec(l.ndfl);
      insurance += dec(l.insurance);
    }
  }
  return {
    ...doc,
    period: hdr.period,
    workCenterId: hdr.workCenterId,
    organizationName: org?.name ?? null,
    lines: lines.map(l => ({
      ...l,
      memberName: names.get(l.memberId) ?? '',
      kindName: kinds.get(l.kindId)?.name ?? '',
      baseType: kinds.get(l.kindId)?.baseType ?? '',
      reflectionName: l.reflectionId ? (reflections.get(l.reflectionId)?.name ?? null) : null,
    })),
    totals: { accrued: fmt(accrued, 2), ndfl: fmt(ndfl, 2), deductions: fmt(deductions, 2), insurance: fmt(insurance, 2), payable: fmt(accrued - ndfl - deductions, 2) },
  };
}

export interface PayrollListParams {
  status?: string[] | undefined;
  period?: string | undefined;
  limit: number;
  offset: number;
}

async function listByType(db: Db, workspaceId: string, type: 'payroll' | 'payroll_statement', p: PayrollListParams) {
  const hdrTable = type === 'payroll' ? payrollHeaders : payrollStatementHeaders;
  const conds = [
    eq(documents.workspaceId, workspaceId),
    eq(documents.type, type),
    p.status?.length ? inArray(documents.status, p.status as ('draft' | 'posted' | 'cancelled')[]) : undefined,
    p.period ? eq(hdrTable.period, periodStartOf(p.period)) : undefined,
  ];
  const rows = await db
    .select({ d: documents, period: hdrTable.period })
    .from(documents)
    .innerJoin(hdrTable, eq(hdrTable.documentId, documents.id))
    .where(and(...conds))
    .orderBy(desc(documents.date), desc(documents.createdAt))
    .limit(p.limit)
    .offset(p.offset);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).innerJoin(hdrTable, eq(hdrTable.documentId, documents.id)).where(and(...conds));
  return { rows, total: Number(count?.n ?? 0) };
}

export async function listPayrolls(db: Db, workspaceId: string, p: PayrollListParams) {
  const { rows, total } = await listByType(db, workspaceId, 'payroll', p);
  return { items: rows.map(r => ({ id: r.d.id, number: r.d.number, date: r.d.date, status: r.d.status, total: r.d.total, comment: r.d.comment, period: r.period })), total };
}

/* ---------------- ведомость на выплату ---------------- */

export interface StatementInput {
  id?: string | undefined;
  organizationId?: string | null | undefined;
  period?: string | undefined;
  kind?: 'advance' | 'settlement' | undefined;
  method?: 'cash' | 'bank' | undefined;
  date?: string | undefined;
  comment?: string | undefined;
  lines?: StatementLineInput[] | undefined;
}

async function saveStatementLines(db: Db, ctx: DocCtx, doc: DocRow, inputs: StatementLineInput[]): Promise<void> {
  const rows = inputs.map((l, i) => {
    if (dec(l.amount) <= 0n) throw new DomainError(422, 'invalid_amount', 'The amount must be greater than zero');
    return { id: l.id, workspaceId: ctx.workspaceId, documentId: doc.id, sortOrder: i, memberId: l.memberId, amount: fmt(dec(l.amount), 2), comment: l.comment?.trim() ?? '' } satisfies typeof payrollStatementLines.$inferInsert;
  });
  const existing = new Set((await db.select({ id: payrollStatementLines.id }).from(payrollStatementLines).where(eq(payrollStatementLines.documentId, doc.id))).map(r => r.id));
  const keep = new Set(rows.map(r => r.id).filter((x): x is string => !!x));
  const drop = [...existing].filter(id => !keep.has(id));
  if (drop.length) await db.delete(payrollStatementLines).where(inArray(payrollStatementLines.id, drop));
  for (const r of rows) {
    if (r.id && existing.has(r.id)) {
      const { id, workspaceId: _w, documentId: _d, ...set } = r;
      await db.update(payrollStatementLines).set(set).where(eq(payrollStatementLines.id, id));
    } else await db.insert(payrollStatementLines).values(r);
  }
  const total = sumDec(rows.map(r => r.amount));
  await db.update(documents).set({ amountNet: fmt(total, 2), vatTotal: '0.00', total: fmt(total, 2), updatedAt: new Date() }).where(eq(documents.id, doc.id));
}

export async function createStatement(db: Db, ctx: DocCtx, input: StatementInput): Promise<string> {
  if (!input.period || !input.kind || !input.method) throw new DomainError(422, 'period_required', 'Select the period, the kind and the method of the statement');
  const organizationId = input.organizationId ?? (await defaultOrganizationId(db));
  const [row] = await db
    .insert(documents)
    .values({ ...(input.id ? { id: input.id } : {}), workspaceId: ctx.workspaceId, type: 'payroll_statement', date: input.date ?? today(), organizationId, comment: input.comment ?? '', responsibleId: ctx.memberId, createdBy: ctx.memberId })
    .returning();
  await db.insert(payrollStatementHeaders).values({ workspaceId: ctx.workspaceId, documentId: row!.id, period: periodStartOf(input.period), kind: input.kind, method: input.method });
  await ensureCashFlowItems(db, ctx.workspaceId);
  if (input.lines?.length) await saveStatementLines(db, ctx, row!, input.lines);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: row!.id, actorId: ctx.memberId, payload: { documentType: 'payroll_statement' } });
  return row!.id;
}

export async function updateStatement(db: Db, ctx: DocCtx, id: string, patch: Omit<StatementInput, 'id'>): Promise<void> {
  const doc = await loadDoc(db, id, 'payroll_statement', true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only a draft can be edited: unpost the document first');
  if (patch.date && patch.date !== doc.date) await assertPeriodOpen(db, ctx.workspaceId, patch.date);
  const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  if (patch.organizationId) set.organizationId = patch.organizationId;
  if (patch.date) set.date = patch.date;
  if (patch.comment !== undefined) set.comment = patch.comment;
  const [row] = await db.update(documents).set(set).where(eq(documents.id, id)).returning();
  const hdr: Partial<typeof payrollStatementHeaders.$inferInsert> = {};
  if (patch.period) hdr.period = periodStartOf(patch.period);
  if (patch.kind) hdr.kind = patch.kind;
  if (patch.method) hdr.method = patch.method;
  if (Object.keys(hdr).length) await db.update(payrollStatementHeaders).set(hdr).where(eq(payrollStatementHeaders.documentId, id));
  if (patch.lines) await saveStatementLines(db, ctx, row!, patch.lines);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'payroll_statement' } });
}

/** Заполнить ведомость: расчёт — остаток долга перед сотрудником; аванс — по кадровым данным (сумма или % оклада),
    без тех, кому аванс за период уже оформлен проведённой ведомостью */
export async function fillStatement(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const doc = await loadDoc(db, id, 'payroll_statement', true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only a draft can be edited: unpost the document first');
  const [hdr] = await db.select().from(payrollStatementHeaders).where(eq(payrollStatementHeaders.documentId, id)).limit(1);
  if (!hdr) throw new DomainError(404, 'not_found', 'document not found');
  const lines: StatementLineInput[] = [];
  const emps = await db.select({ m: { id: members.id, name: members.name }, e: employeePayroll }).from(employeePayroll).innerJoin(members, and(eq(members.workspaceId, employeePayroll.workspaceId), eq(members.id, employeePayroll.memberId))).orderBy(asc(members.name));
  if (hdr.kind === 'settlement') {
    const bal = await payrollBalances(db, ctx.workspaceId);
    // уже выписанное в других проведённых и черновых ведомостях не дублируется
    const pending = await statementsPending(db, ctx.workspaceId, id);
    for (const { m } of emps) {
      const left = (bal.get(m.id) ?? 0n) - (pending.get(m.id) ?? 0n);
      if (left > 0n) lines.push({ memberId: m.id, amount: fmt(left, 2), comment: '' });
    }
  } else {
    const done = await db
      .select({ memberId: payrollStatementLines.memberId })
      .from(payrollStatementLines)
      .innerJoin(documents, eq(documents.id, payrollStatementLines.documentId))
      .innerJoin(payrollStatementHeaders, eq(payrollStatementHeaders.documentId, documents.id))
      .where(and(eq(documents.status, 'posted'), eq(payrollStatementHeaders.kind, 'advance'), eq(payrollStatementHeaders.period, hdr.period), ne(documents.id, id)));
    const skip = new Set(done.map(d => d.memberId));
    const accRows = await db.select().from(employeeAccruals).where(lte(employeeAccruals.validFrom, periodEndOf(hdr.period))).orderBy(asc(employeeAccruals.validFrom));
    const kinds = new Map((await db.select().from(payrollKinds)).map(k => [k.id, k.baseType]));
    for (const { m, e } of emps) {
      if (skip.has(m.id)) continue;
      const salaryRow = accRows.filter(a => a.memberId === m.id && kinds.get(a.kindId) === 'salary').at(-1);
      const amount = advanceFor(salaryRow?.amount ?? null, e.advanceAmount, e.advancePercent);
      if (dec(amount) > 0n) lines.push({ memberId: m.id, amount, comment: '' });
    }
  }
  await saveStatementLines(db, ctx, doc, lines);
}

/** Суммы к выплате в чужих непроведённых и проведённых ведомостях, ещё не оплаченные */
async function statementsPending(db: Db, workspaceId: string, exceptId: string): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  const lines = await db
    .select({ docId: payrollStatementLines.documentId, memberId: payrollStatementLines.memberId, amount: payrollStatementLines.amount })
    .from(payrollStatementLines)
    .innerJoin(documents, eq(documents.id, payrollStatementLines.documentId))
    .where(and(eq(payrollStatementLines.workspaceId, workspaceId), ne(documents.status, 'cancelled'), ne(documents.id, exceptId)));
  for (const l of lines) out.set(l.memberId, (out.get(l.memberId) ?? 0n) + dec(l.amount));
  // вычесть то, что по этим ведомостям уже выплачено проведёнными платежами (долг уже уменьшен регистром)
  const docIds = [...new Set(lines.map(l => l.docId))];
  if (docIds.length) {
    const paid = await db
      .select({ memberId: paymentLines.memberId, s: sql<string>`sum(${paymentLines.amount})::text` })
      .from(paymentLines)
      .innerJoin(documents, eq(documents.id, paymentLines.documentId))
      .where(and(eq(documents.status, 'posted'), inArray(documents.basedOnId, docIds), sql`${paymentLines.memberId} is not null`))
      .groupBy(paymentLines.memberId);
    for (const p of paid) if (p.memberId) out.set(p.memberId, (out.get(p.memberId) ?? 0n) - dec(p.s));
  }
  return out;
}

async function statementPaid(db: Db, id: string, statuses: ('draft' | 'posted')[]): Promise<Map<string, bigint>> {
  const rows = await db
    .select({ memberId: paymentLines.memberId, s: sql<string>`sum(${paymentLines.amount})::text` })
    .from(paymentLines)
    .innerJoin(documents, eq(documents.id, paymentLines.documentId))
    .where(and(eq(documents.basedOnId, id), inArray(documents.status, statuses), sql`${paymentLines.memberId} is not null`))
    .groupBy(paymentLines.memberId);
  return new Map(rows.map(r => [r.memberId!, dec(r.s)]));
}

DOCUMENT_HOOKS.payroll_statement = {
  // сумма документа — сумма строк (общий код проведения свою не пересчитывает: строк товаров нет)
  post: async (db, ctx, doc) => {
    const rows = await db.select({ amount: payrollStatementLines.amount }).from(payrollStatementLines).where(eq(payrollStatementLines.documentId, doc.id));
    const total = fmt(sumDec(rows.map(r => r.amount)), 2);
    await db.update(documents).set({ amountNet: total, vatTotal: '0.00', total, updatedAt: new Date() }).where(eq(documents.id, doc.id));
    void ctx;
  },
  check: async (db, _ctx, doc) => {
    const lines = await db.select().from(payrollStatementLines).where(eq(payrollStatementLines.documentId, doc.id));
    if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one line before posting');
  },
  beforeUnpost: async (db, _ctx, doc) => {
    const paid = await statementPaid(db, doc.id, ['draft', 'posted']);
    if ([...paid.values()].some(v => v > 0n)) throw new DomainError(409, 'statement_has_payments', 'The statement has payments: unpost or delete them first');
  },
};

export async function statementDetail(db: Db, id: string) {
  const doc = await loadDoc(db, id, 'payroll_statement');
  const [hdr] = await db.select().from(payrollStatementHeaders).where(eq(payrollStatementHeaders.documentId, id)).limit(1);
  const lines = await db.select().from(payrollStatementLines).where(eq(payrollStatementLines.documentId, id)).orderBy(asc(payrollStatementLines.sortOrder));
  const ids = [...new Set(lines.map(l => l.memberId))];
  const names = new Map((ids.length ? await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, ids)) : []).map(m => [m.id, m.name]));
  const posted = await statementPaid(db, id, ['posted']);
  const planned = await statementPaid(db, id, ['draft', 'posted']);
  const payments = await db.select({ id: documents.id, type: documents.type, number: documents.number, status: documents.status, total: documents.total, date: documents.date }).from(documents).where(and(eq(documents.basedOnId, id), ne(documents.status, 'cancelled')));
  const paidTotal = [...posted.values()].reduce((s, v) => s + v, 0n);
  const total = dec(doc.total);
  return {
    ...doc,
    period: hdr!.period,
    kind: hdr!.kind,
    method: hdr!.method,
    lines: lines.map(l => ({ ...l, memberName: names.get(l.memberId) ?? '', paid: fmt(posted.get(l.memberId) ?? 0n, 2), scheduled: fmt(planned.get(l.memberId) ?? 0n, 2) })),
    payments,
    paidTotal: fmt(paidTotal, 2),
    remaining: fmt(total - paidTotal, 2),
    payState: doc.status !== 'posted' ? 'none' : paidTotal >= total ? 'paid' : paidTotal > 0n ? 'partial' : 'unpaid',
  };
}

export async function listStatements(db: Db, workspaceId: string, p: PayrollListParams) {
  const { rows, total } = await listByType(db, workspaceId, 'payroll_statement', p);
  const hdrs = rows.length ? await db.select().from(payrollStatementHeaders).where(inArray(payrollStatementHeaders.documentId, rows.map(r => r.d.id))) : [];
  const byDoc = new Map(hdrs.map(h => [h.documentId, h]));
  return { items: rows.map(r => ({ id: r.d.id, number: r.d.number, date: r.d.date, status: r.d.status, total: r.d.total, comment: r.d.comment, period: r.period, kind: byDoc.get(r.d.id)?.kind ?? 'settlement', method: byDoc.get(r.d.id)?.method ?? 'cash' })), total };
}

/** Выплата на основании ведомости: черновик РКО (касса) или списания со счёта (банк) на остаток по каждому сотруднику */
export async function payStatement(db: Db, ctx: DocCtx, id: string, account: { cashRegisterId?: string | null | undefined; bankAccountId?: string | null | undefined }): Promise<string> {
  const doc = await loadDoc(db, id, 'payroll_statement', true);
  if (doc.status !== 'posted') throw new DomainError(422, 'statement_not_posted', 'Post the payroll statement before paying it');
  const [hdr] = await db.select().from(payrollStatementHeaders).where(eq(payrollStatementHeaders.documentId, id)).limit(1);
  const lines = await db.select().from(payrollStatementLines).where(eq(payrollStatementLines.documentId, id)).orderBy(asc(payrollStatementLines.sortOrder));
  const scheduled = await statementPaid(db, id, ['draft', 'posted']);
  const keys = await ensureCashFlowItems(db, ctx.workspaceId);
  const payLines = lines
    .map(l => ({ l, left: dec(l.amount) - (scheduled.get(l.memberId) ?? 0n) }))
    .filter(x => x.left > 0n)
    .map(x => ({ memberId: x.l.memberId, amount: fmt(x.left, 2), cashFlowItemId: keys.get('salary')!, comment: x.l.comment }));
  if (!payLines.length) throw new DomainError(422, 'nothing_to_pay', 'The statement is already fully paid or has a payment draft');
  return createPayment(db, ctx, {
    type: hdr!.method === 'cash' ? 'cash_payment' : 'bank_payment',
    operation: 'salary_payment',
    organizationId: doc.organizationId,
    date: today() < doc.date ? doc.date : today(),
    cashRegisterId: account.cashRegisterId ?? null,
    bankAccountId: account.bankAccountId ?? null,
    basedOnId: id,
    comment: `${doc.number ?? ''}`.trim(),
    lines: payLines as never,
  });
}

/** Зарплатный реестр для банка: CSV «ФИО;Счёт;Сумма» по строкам ведомости */
export async function statementRegistry(db: Db, id: string): Promise<{ csv: string; skipped: number }> {
  const d = await statementDetail(db, id);
  const emps = new Map((await db.select({ memberId: employeePayroll.memberId, card: employeePayroll.cardAccount }).from(employeePayroll)).map(e => [e.memberId, e.card]));
  const rows = d.lines.map(l => ({ name: l.memberName, account: emps.get(l.memberId) ?? '', amount: l.amount }));
  const ok = rows.filter(r => r.account);
  return { csv: salaryRegistryCsv(ok), skipped: rows.length - ok.length };
}

/* ---------------- отчёты ---------------- */

export async function settlementsReport(db: Db, workspaceId: string, q: { from: string; to: string; memberId?: string | undefined }) {
  const rows = await db
    .select({
      memberId: payrollMoves.memberId,
      opening: sql<string>`coalesce(sum(${payrollMoves.amount}) filter (where ${payrollMoves.date} < ${q.from}), 0)::text`,
      accrued: sql<string>`coalesce(sum(${payrollMoves.amount}) filter (where ${payrollMoves.date} >= ${q.from} and ${payrollMoves.date} <= ${q.to} and ${payrollMoves.kind} = 'accrual'), 0)::text`,
      withheld: sql<string>`coalesce(-sum(${payrollMoves.amount}) filter (where ${payrollMoves.date} >= ${q.from} and ${payrollMoves.date} <= ${q.to} and ${payrollMoves.kind} in ('ndfl','deduction')), 0)::text`,
      paid: sql<string>`coalesce(-sum(${payrollMoves.amount}) filter (where ${payrollMoves.date} >= ${q.from} and ${payrollMoves.date} <= ${q.to} and ${payrollMoves.kind} = 'payment'), 0)::text`,
      closing: sql<string>`coalesce(sum(${payrollMoves.amount}) filter (where ${payrollMoves.date} <= ${q.to}), 0)::text`,
    })
    .from(payrollMoves)
    .where(and(eq(payrollMoves.workspaceId, workspaceId), q.memberId ? eq(payrollMoves.memberId, q.memberId) : undefined))
    .groupBy(payrollMoves.memberId);
  const ids = rows.map(r => r.memberId);
  const names = new Map((ids.length ? await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, ids)) : []).map(m => [m.id, m.name]));
  const items = rows
    .map(r => ({ memberId: r.memberId, memberName: names.get(r.memberId) ?? '', opening: fmt(dec(r.opening), 2), accrued: fmt(dec(r.accrued), 2), withheld: fmt(dec(r.withheld), 2), paid: fmt(dec(r.paid), 2), closing: fmt(dec(r.closing), 2) }))
    .filter(r => [r.opening, r.accrued, r.withheld, r.paid, r.closing].some(v => dec(v) !== 0n))
    .sort((a, b) => a.memberName.localeCompare(b.memberName));
  const sum = (k: 'opening' | 'accrued' | 'withheld' | 'paid' | 'closing') => fmt(sumDec(items.map(i => i[k])), 2);
  return { from: q.from, to: q.to, items, totals: { opening: sum('opening'), accrued: sum('accrued'), withheld: sum('withheld'), paid: sum('paid'), closing: sum('closing') } };
}

/** Свод начислений по видам и участкам за период (по месяцу начисления проведённых документов) */
export async function payrollSummary(db: Db, workspaceId: string, q: { from: string; to: string }) {
  const rows = await db
    .select({
      kindId: payrollLines.kindId,
      workCenterId: sql<string | null>`coalesce(${payrollReflections.workCenterId}, ${payrollHeaders.workCenterId})`,
      amount: sql<string>`sum(${payrollLines.amount})::text`,
      ndfl: sql<string>`sum(${payrollLines.ndfl})::text`,
      insurance: sql<string>`sum(${payrollLines.insurance})::text`,
    })
    .from(payrollLines)
    .innerJoin(documents, eq(documents.id, payrollLines.documentId))
    .innerJoin(payrollHeaders, eq(payrollHeaders.documentId, documents.id))
    .leftJoin(payrollReflections, eq(payrollReflections.id, payrollLines.reflectionId))
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.status, 'posted'), gte(payrollHeaders.period, periodStartOf(q.from)), lte(payrollHeaders.period, q.to)))
    .groupBy(payrollLines.kindId, sql`coalesce(${payrollReflections.workCenterId}, ${payrollHeaders.workCenterId})`);
  const kinds = new Map((await db.select().from(payrollKinds)).map(k => [k.id, k]));
  const wcs = new Map((await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters)).map(w => [w.id, w.name]));
  const byKind = new Map<string, { kindId: string; kindName: string; baseType: string; amount: bigint; ndfl: bigint; insurance: bigint }>();
  const byCenter = new Map<string, { workCenterId: string | null; workCenterName: string; accrued: bigint; insurance: bigint }>();
  for (const r of rows) {
    const k = kinds.get(r.kindId);
    const ded = isDeductionBase(k?.baseType ?? '');
    const bk = byKind.get(r.kindId) ?? { kindId: r.kindId, kindName: k?.name ?? '', baseType: k?.baseType ?? '', amount: 0n, ndfl: 0n, insurance: 0n };
    bk.amount += dec(r.amount);
    bk.ndfl += dec(r.ndfl);
    bk.insurance += dec(r.insurance);
    byKind.set(r.kindId, bk);
    if (ded) continue;
    const key = r.workCenterId ?? '';
    const bc = byCenter.get(key) ?? { workCenterId: r.workCenterId, workCenterName: r.workCenterId ? (wcs.get(r.workCenterId) ?? '') : '', accrued: 0n, insurance: 0n };
    bc.accrued += dec(r.amount);
    bc.insurance += dec(r.insurance);
    byCenter.set(key, bc);
  }
  const f = (v: bigint) => fmt(v, 2);
  return {
    from: q.from,
    to: q.to,
    byKind: [...byKind.values()].map(x => ({ ...x, amount: f(x.amount), ndfl: f(x.ndfl), insurance: f(x.insurance) })),
    byWorkCenter: [...byCenter.values()].map(x => ({ ...x, accrued: f(x.accrued), insurance: f(x.insurance) })),
  };
}

/** Расчётный листок сотрудника за месяц: начисления, удержания, выплаты и долг на конец месяца */
export async function payslip(db: Db, workspaceId: string, memberId: string, period: string) {
  const from = periodStartOf(period);
  const to = periodEndOf(from);
  const [m] = await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.id, memberId)).limit(1);
  if (!m) throw new DomainError(404, 'not_found', 'employee not found');
  const lines = await db
    .select({ l: payrollLines, number: documents.number })
    .from(payrollLines)
    .innerJoin(documents, eq(documents.id, payrollLines.documentId))
    .innerJoin(payrollHeaders, eq(payrollHeaders.documentId, documents.id))
    .where(and(eq(payrollLines.memberId, memberId), eq(documents.status, 'posted'), eq(payrollHeaders.period, from)))
    .orderBy(asc(payrollLines.sortOrder));
  const kinds = new Map((await db.select().from(payrollKinds)).map(k => [k.id, k]));
  const moves = await db.select().from(payrollMoves).where(and(eq(payrollMoves.memberId, memberId), eq(payrollMoves.kind, 'payment'), gte(payrollMoves.date, from), lte(payrollMoves.date, to)));
  const bal = await payrollBalances(db, workspaceId, to);
  let accrued = 0n;
  let ndfl = 0n;
  let deductions = 0n;
  const items = lines.map(({ l }) => {
    const kind = kinds.get(l.kindId);
    const ded = isDeductionBase(kind?.baseType ?? '');
    if (ded) deductions += dec(l.amount);
    else {
      accrued += dec(l.amount);
      ndfl += dec(l.ndfl);
    }
    return { kindName: kind?.name ?? '', baseType: kind?.baseType ?? '', base: l.base, rate: l.rate, workedDays: l.workedDays, normDays: l.normDays, amount: l.amount, ndfl: l.ndfl, deduction: ded };
  });
  const paid = sumDec(moves.map(x => x.amount)) * -1n;
  return { memberId, memberName: m.name, period: from, items, totals: { accrued: fmt(accrued, 2), ndfl: fmt(ndfl, 2), deductions: fmt(deductions, 2), paid: fmt(paid, 2), debtAtEnd: fmt(bal.get(memberId) ?? 0n, 2) } };
}

/* ---------------- печать ---------------- */

/** Данные расчётного листка для печати */
export async function payslipPrintData(db: Db, workspaceId: string, memberId: string, period: string): Promise<PayslipData> {
  const p = await payslip(db, workspaceId, memberId, period);
  const orgId = await defaultOrganizationId(db);
  return { organization: await printOrg(db, orgId), memberName: p.memberName, period: p.period, items: p.items, totals: p.totals };
}

/** Данные платёжной ведомости (Т-53) для печати */
export async function statementPrintData(db: Db, id: string): Promise<PayrollStatementPrintData> {
  const d = await statementDetail(db, id);
  return {
    organization: await printOrg(db, d.organizationId),
    number: d.number,
    date: d.date,
    period: d.period,
    kindLabel: d.kind === 'advance' ? 'Аванс' : 'Расчёт',
    lines: d.lines.map(l => ({ memberName: l.memberName, amount: l.amount })),
    total: d.total,
  };
}
