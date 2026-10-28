/* Договоры и тарифные планы (этап 8 «УНФ: Услуги»).
   Справочник договоров общий: с покупателем, с поставщиком, прочее. Договор обслуживания включает биллинг.
   Связи — составные внешние ключи (workspace_id, id): договор чужого арендатора нельзя подставить даже в обход API. */
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { companies, contracts, documentLines, documents, organizations, products, tariffPlanLines, tariffPlans } from './schema';

/* ---------------- тарифные планы ---------------- */

export interface TariffPlanLineView {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unitCode: string;
  vatRate: string;
  qty: string;
  price: string;
  isSubscription: boolean;
  invoiceAsProductId: string | null;
  invoiceAsProductName: string | null;
}

/** Строки тарифного плана с товарами */
export async function tariffPlanLinesOf(db: Db, planId: string): Promise<TariffPlanLineView[]> {
  const rows = await db
    .select({ line: tariffPlanLines, product: products })
    .from(tariffPlanLines)
    .innerJoin(products, eq(products.id, tariffPlanLines.productId))
    .where(eq(tariffPlanLines.tariffPlanId, planId))
    .orderBy(asc(tariffPlanLines.sortOrder), asc(tariffPlanLines.createdAt));
  const asIds = [...new Set(rows.map(r => r.line.invoiceAsProductId).filter((x): x is string => !!x))];
  const asRows = asIds.length ? await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, asIds)) : [];
  const asNames = new Map(asRows.map(p => [p.id, p.name]));
  return rows.map(r => ({
    id: r.line.id,
    productId: r.line.productId,
    productName: r.product.name,
    sku: r.product.sku,
    unitCode: r.product.unitCode,
    vatRate: r.product.vatRate,
    qty: r.line.qty,
    price: r.line.price,
    isSubscription: r.line.isSubscription,
    invoiceAsProductId: r.line.invoiceAsProductId,
    invoiceAsProductName: r.line.invoiceAsProductId ? (asNames.get(r.line.invoiceAsProductId) ?? null) : null,
  }));
}

/** Строки тарифного плана заменяются целиком */
export async function saveTariffPlanLines(db: Db, ctx: { workspaceId: string; memberId: string | null }, planId: string, lines: { productId: string; qty: string; price: string; isSubscription: boolean; invoiceAsProductId?: string | null }[]): Promise<void> {
  // список позиций заменяется целиком
  await db.delete(tariffPlanLines).where(eq(tariffPlanLines.tariffPlanId, planId));
  const ids = [...new Set(lines.map(l => l.productId))];
  const products_ = ids.length ? await db.select({ id: products.id, archivedAt: products.archivedAt }).from(products).where(inArray(products.id, ids)) : [];
  const byId = new Map(products_.map(p => [p.id, p]));
  for (const [i, l] of lines.entries()) {
    const p = byId.get(l.productId);
    if (!p || p.archivedAt) throw new DomainError(422, 'invalid_reference', 'The product of the tariff plan line does not exist or is archived');
    await db.insert(tariffPlanLines).values({ workspaceId: ctx.workspaceId, tariffPlanId: planId, productId: l.productId, qty: l.qty, price: l.price, isSubscription: l.isSubscription, invoiceAsProductId: l.invoiceAsProductId ?? null, sortOrder: i });
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'tariff_plan.updated', entity: 'tariff_plan', recordId: planId, actorId: ctx.memberId, payload: { lines: lines.length } });
}

/* ---------------- договоры ---------------- */

export interface ContractView {
  id: string;
  companyId: string;
  companyName: string;
  organizationId: string;
  organizationName: string;
  number: string;
  date: string;
  kind: 'customer' | 'supplier' | 'other';
  category: string;
  isSigned: boolean;
  isDefault: boolean;
  validFrom: string;
  validTo: string | null;
  paymentDays: number;
  priceType: string;
  /** Вид цен из справочника (задача 1178): подставляется в документы по договору */
  priceKindId: string | null;
  isService: boolean;
  tariffPlanId: string | null;
  tariffPlanName: string | null;
  extraProductPolicy: 'allow' | 'warn' | 'forbid';
  periodicity: 'month' | 'quarter' | 'year' | null;
  billingDay: number;
  documentPackage: 'invoice' | 'invoice_act';
  note: string;
}

const contractQuery = (db: Db) =>
  db
    .select({ c: contracts, companyName: companies.name, organizationName: organizations.name, planName: tariffPlans.name, policy: tariffPlans.extraProductPolicy })
    .from(contracts)
    .innerJoin(companies, eq(companies.id, contracts.companyId))
    .innerJoin(organizations, eq(organizations.id, contracts.organizationId))
    .leftJoin(tariffPlans, eq(tariffPlans.id, contracts.tariffPlanId));

const toView = (r: {
  c: typeof contracts.$inferSelect;
  companyName: string;
  organizationName: string;
  planName: string | null;
  policy: 'allow' | 'warn' | 'forbid' | null;
}): ContractView => ({
  id: r.c.id,
  companyId: r.c.companyId,
  companyName: r.companyName,
  organizationId: r.c.organizationId,
  organizationName: r.organizationName,
  number: r.c.number,
  date: r.c.date,
  kind: r.c.kind,
  category: r.c.category,
  isSigned: r.c.isSigned,
  isDefault: r.c.isDefault,
  validFrom: r.c.validFrom,
  validTo: r.c.validTo,
  paymentDays: r.c.paymentDays,
  priceType: r.c.priceType,
  priceKindId: r.c.priceKindId,
  isService: r.c.isService,
  tariffPlanId: r.c.tariffPlanId,
  tariffPlanName: r.planName,
  extraProductPolicy: r.policy ?? 'allow',
  periodicity: r.c.periodicity,
  billingDay: r.c.billingDay,
  documentPackage: r.c.documentPackage,
  note: r.c.note,
});

/** Договоры арендатора: по контрагенту, виду, «обслуживание» */
export async function listContracts(db: Db, params: { workspaceId?: string; companyId?: string; kind?: string; isService?: boolean; q?: string }): Promise<ContractView[]> {
  const conds = [isNull(contracts.archivedAt)];
  if (params.workspaceId) conds.push(eq(contracts.workspaceId, params.workspaceId));
  if (params.companyId) conds.push(eq(contracts.companyId, params.companyId));
  if (params.kind) conds.push(eq(contracts.kind, params.kind as 'customer'));
  if (params.isService !== undefined) conds.push(eq(contracts.isService, params.isService));
  if (params.q) conds.push(or(sql`${contracts.number} ilike ${'%' + params.q + '%'}`, sql`${contracts.category} ilike ${'%' + params.q + '%'}`)!);
  const rows = await contractQuery(db).where(and(...conds)).orderBy(asc(companies.name), desc(contracts.date));
  return rows.map(toView);
}

/** Карточка договора: реквизиты, тарифный план и последние запуски биллинга */
export async function contractDetail(db: Db, id: string) {
  const rows = await contractQuery(db).where(eq(contracts.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  const view = toView(row);
  const lines = row.c.tariffPlanId ? await tariffPlanLinesOf(db, row.c.tariffPlanId) : [];
  const docs = await db
    .select({ id: documents.id, type: documents.type, number: documents.number, date: documents.date, status: documents.status, total: documents.total })
    .from(documents)
    .where(eq(documents.contractId, id))
    .orderBy(desc(documents.date))
    .limit(50);
  return { ...view, tariffPlanLines: lines, documents: docs };
}

/** Договор по умолчанию контрагента — подставляется в документы */
export async function defaultContract(db: Db, companyId: string): Promise<ContractView | null> {
  const rows = await contractQuery(db).where(and(eq(contracts.companyId, companyId), eq(contracts.isDefault, true), isNull(contracts.archivedAt))).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

/** Проверка договора для документа: договор должен существовать и принадлежать тому же контрагенту */
export async function assertContractOfCompany(db: Db, contractId: string, companyId: string | null): Promise<ContractView> {
  const rows = await contractQuery(db).where(eq(contracts.id, contractId)).limit(1);
  const row = rows[0];
  if (!row || row.c.archivedAt) throw new DomainError(422, 'invalid_reference', 'The contract does not exist or is archived');
  if (companyId && row.c.companyId !== companyId) throw new DomainError(422, 'contract_mismatch', 'The contract belongs to another counterparty');
  return toView(row);
}

/** Номера договоров контрагента: совпадение — предупреждение, не ошибка */
export async function duplicateContractNumbers(db: Db, companyId: string, number: string, exceptId?: string): Promise<string[]> {
  if (!number.trim()) return [];
  const rows = await db.select({ id: contracts.id, number: contracts.number }).from(contracts).where(and(eq(contracts.companyId, companyId), eq(contracts.number, number.trim()), isNull(contracts.archivedAt)));
  return rows.filter(r => r.id !== exceptId).map(r => r.id);
}

/** Договоры, у которых наступил день выставления (для задачи воркера billing.run) */
export async function serviceContractsForPeriod(db: Db, workspaceId: string, opts: { today: string; periodKeys: string[] }): Promise<ContractView[]> {
  const rows = await contractQuery(db).where(and(eq(contracts.workspaceId, workspaceId), eq(contracts.isService, true), isNull(contracts.archivedAt))).orderBy(asc(companies.name));
  return rows.map(toView).filter(c => c.periodicity && opts.periodKeys.includes(periodKeyOf(c.periodicity, opts.today)));
}

/** Ключ периода договора на дату (по его периодичности) */
export function periodKeyOf(periodicity: 'month' | 'quarter' | 'year', date: string): string {
  if (periodicity === 'month') return date.slice(0, 7);
  if (periodicity === 'quarter') {
    const y = Number(date.slice(0, 4));
    const q = Math.floor(Number(date.slice(5, 7)) / 3) + 1;
    return `${y}-Q${q}`;
  }
  return date.slice(0, 4);
}

/** Строки документа договора: номенклатура и цена — для проверки правила внеплановых позиций */
export async function contractDocumentProducts(db: Db, documentId: string): Promise<{ productId: string; name: string }[]> {
  const rows = await db
    .select({ productId: documentLines.productId, name: documentLines.name })
    .from(documentLines)
    .where(eq(documentLines.documentId, documentId))
    .orderBy(asc(documentLines.sortOrder));
  return rows;
}

/** Номенклатура тарифного плана договора */
export async function contractPlanProductIds(db: Db, contractId: string): Promise<string[]> {
  const [row] = await db.select({ tariffPlanId: contracts.tariffPlanId }).from(contracts).where(eq(contracts.id, contractId)).limit(1);
  if (!row?.tariffPlanId) return [];
  const lines = await db.select({ productId: tariffPlanLines.productId }).from(tariffPlanLines).where(eq(tariffPlanLines.tariffPlanId, row.tariffPlanId));
  return lines.map(l => l.productId);
}

/** Договоры контрагента (для подстановки в документы) */
export async function contractsOfCompany(db: Db, companyId: string): Promise<ContractView[]> {
  const rows = await contractQuery(db).where(and(eq(contracts.companyId, companyId), isNull(contracts.archivedAt))).orderBy(desc(contracts.isDefault), desc(contracts.date));
  return rows.map(toView);
}

/** Договоры, к которым относится документ (для фильтра журнала) */
export async function contractName(db: Db, id: string): Promise<string> {
  const [row] = await db.select({ number: contracts.number, companyName: companies.name }).from(contracts).innerJoin(companies, eq(companies.id, contracts.companyId)).where(eq(contracts.id, id)).limit(1);
  return row ? (row.number ? `${row.companyName} · ${row.number}` : row.companyName) : '';
}
