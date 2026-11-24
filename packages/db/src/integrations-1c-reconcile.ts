/* Read-only comparison of posted ERP documents and ledger snapshots with 1C. */
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { dec, fmt, IC_DOCUMENT_TYPES, IC_MONEY_DOCUMENT_TYPES, type EnterpriseDataParseIssue,
  type IcBalance, type IcCatalogType, type IcDocumentType, type IcParsedDocument, type IcReconcileOptions, type ParsedEnterpriseData } from '@erp/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { icCurrency, planImport, type Resolve } from './integrations-1c-import';
import { linksOf, type IcSource } from './integrations-1c';
import { bankAccounts, cashMoves, cashRegisters, companies, documents, organizations, products, settlementMoves, stockCostAdjustments, stockMoves, warehouses } from './schema';

export interface IcErpDocument {
  id: string;
  type: IcDocumentType;
  number: string | null;
  date: string;
  organizationId: string;
  counterpartyId: string | null;
  currency: string;
  amount: string;
}

interface DocumentDiff {
  erp: IcErpDocument | null;
  oneC: IcParsedDocument | null;
  difference: string | null;
  reason: 'amount' | 'currency' | 'only_erp' | 'only_1c';
}

interface BalanceDiff {
  date: string;
  kind: IcBalance['kind'];
  key: string;
  label?: string;
  erpAmount: string | null;
  oneCAmount: string | null;
  amountDifference: string | null;
  erpQty?: string | null;
  oneCQty?: string | null;
  qtyDifference?: string | null;
  reason: 'balance' | 'missing_reference' | 'currency' | 'unit';
}

export interface IcReconcileReport {
  matchedCount: number;
  onlyInErp: IcErpDocument[];
  onlyIn1c: IcParsedDocument[];
  amountDiffs: DocumentDiff[];
  paymentDiffs: DocumentDiff[];
  stockDiffs: BalanceDiff[];
  balanceDiffs: BalanceDiff[];
  balanceKinds: IcBalance['kind'][];
  issues: EnterpriseDataParseIssue[];
  unresolvedOrganizations: string[];
}

const paymentTypes = new Set<IcDocumentType>(IC_MONEY_DOCUMENT_TYPES);
const documentTypes = new Set<string>(IC_DOCUMENT_TYPES);
const money = (amount: string) => fmt(dec(amount), 2);
const compatible = (erp: IcErpDocument, external: IcParsedDocument) =>
  erp.type === external.type || (external.type === 'realization' && external.serviceOnly && erp.type === 'act');

type OrgOf = (ref?: string) => string | undefined;

function shiftDay(date: string, offset: number) {
  const day = new Date(Date.parse(date) + offset * 864e5).toISOString().slice(0, 10);
  return day.startsWith('0000-') ? '0001-01-01' : day.startsWith('+') ? '9999-12-31' : day;
}

function documentDiff(erp: IcErpDocument | null, oneC: IcParsedDocument | null): DocumentDiff {
  if (!erp || !oneC) return { erp, oneC, difference: fmt(dec(erp?.amount) - dec(oneC?.amount), 2), reason: erp ? 'only_erp' : 'only_1c' };
  const currency = icCurrency(oneC.currency);
  if (currency && currency !== erp.currency) return { erp, oneC, difference: null, reason: 'currency' };
  return { erp, oneC, difference: fmt(dec(money(erp.amount)) - dec(money(oneC.amount)), 2), reason: 'amount' };
}

function compareDocuments(
  erpDocs: IcErpDocument[], oneCDocs: IcParsedDocument[], byRef: Map<string, string>,
  orgOf: OrgOf, resolve: Resolve, options: IcReconcileOptions,
) {
  const erpById = new Map(erpDocs.map(row => [row.id, row]));
  const byNumber = new Map<string, IcErpDocument[]>();
  for (const row of erpDocs) {
    if (!row.number) continue;
    const key = JSON.stringify([row.number, row.date]);
    const bucket = byNumber.get(key) ?? [];
    bucket.push(row);
    byNumber.set(key, bucket);
  }
  const matches = new Map<IcParsedDocument, IcErpDocument>();
  const used = new Set<string>();
  const linkedErpIds = new Set(byRef.values());
  // Reserve ERP documents with a GUID match before trying the number/date fallback.
  const sameOrg = (row: IcErpDocument, external: IcParsedDocument) => {
    const org = orgOf(external.organizationRef);
    return !org || row.organizationId === org;
  };
  for (const external of oneCDocs) {
    const id = external.refUuid && byRef.get(external.refUuid);
    const row = id ? erpById.get(id) : undefined;
    if (row && compatible(row, external) && sameOrg(row, external)) {
      matches.set(external, row);
      used.add(row.id);
    }
  }

  // Exact dates get priority over shifted dates. Require a unique match on both sides.
  for (const offsets of [[0], [-1, 1]]) {
    const candidateMap = new Map<IcParsedDocument, IcErpDocument[]>();
    const candidateCounts = new Map<string, number>();
    for (const external of oneCDocs) {
      if (matches.has(external) || !external.number || (external.refUuid && byRef.has(external.refUuid))) continue;
      const party = resolve('company', external.companyRef)?.id;
      const candidateDays = [...new Set(offsets.map(offset => shiftDay(external.date, offset)))].filter(day => offsets[0] === 0 || day !== external.date);
      const candidates = candidateDays.flatMap(day => byNumber.get(JSON.stringify([external.number, day])) ?? [])
        .filter(row => !used.has(row.id) && (!external.refUuid || !linkedErpIds.has(row.id)) &&
          compatible(row, external) && sameOrg(row, external) && (!party || row.counterpartyId === party));
      candidateMap.set(external, candidates);
      for (const row of candidates) candidateCounts.set(row.id, (candidateCounts.get(row.id) ?? 0) + 1);
    }
    for (const [external, candidates] of candidateMap) {
      const [candidate] = candidates;
      if (candidate && candidates.length === 1 && candidateCounts.get(candidate.id) === 1) {
        matches.set(external, candidate);
        used.add(candidate.id);
      }
    }
  }

  const onlyInErp = erpDocs.filter(row => !used.has(row.id) && row.date >= options.dateFrom && row.date <= options.dateTo);
  const onlyIn1c = oneCDocs.filter(row => !matches.has(row));
  const amountDiffs = [...matches].flatMap(([oneC, erp]) => {
    const diff = documentDiff(erp, oneC);
    return diff.difference === null || dec(diff.difference) !== 0n ? [diff] : [];
  });
  const paymentDiffs = [
    ...amountDiffs.filter(diff => diff.erp && paymentTypes.has(diff.erp.type)),
    ...onlyInErp.filter(row => paymentTypes.has(row.type)).map(row => documentDiff(row, null)),
    ...onlyIn1c.filter(row => paymentTypes.has(row.type)).map(row => documentDiff(null, row)),
  ];
  return { matchedCount: matches.size, onlyInErp, onlyIn1c, amountDiffs, paymentDiffs };
}

interface LedgerRow { key: string; label: string; amount: string; qty?: string }
const ledgerKey = (...ids: string[]) => ids.join(' / ');

async function ledgerAt(db: Db, workspaceId: string, kind: IcBalance['kind'], date: string, orgIds: string[]): Promise<LedgerRow[]> {
  const org = orgIds.length ? inArray(documents.organizationId, orgIds) : undefined;
  const ledgerJoin = (table: typeof stockMoves | typeof cashMoves | typeof settlementMoves) =>
    and(eq(documents.id, table.documentId), eq(documents.workspaceId, workspaceId));
  if (kind === 'stock') {
    const rows = await db.select({ warehouse: stockMoves.warehouseId, product: stockMoves.productId,
      warehouseName: warehouses.name, productName: products.name, qty: sql<string>`sum(${stockMoves.qty})::text`,
      amount: sql<string>`round(sum(${stockMoves.qty} * (${stockMoves.cost} + coalesce(${stockCostAdjustments.deltaCost}, 0))), 2)::text`,
    }).from(stockMoves)
      .innerJoin(documents, ledgerJoin(stockMoves))
      .innerJoin(warehouses, and(eq(warehouses.workspaceId, workspaceId), eq(warehouses.id, stockMoves.warehouseId)))
      .innerJoin(products, and(eq(products.workspaceId, workspaceId), eq(products.id, stockMoves.productId)))
      .leftJoin(stockCostAdjustments, and(eq(stockCostAdjustments.workspaceId, workspaceId), eq(stockCostAdjustments.moveId, stockMoves.id)))
      .where(and(eq(stockMoves.workspaceId, workspaceId), lte(stockMoves.movedAt, date), org))
      .groupBy(stockMoves.warehouseId, stockMoves.productId, warehouses.name, products.name);
    return rows.map(row => ({ key: ledgerKey(row.warehouse, row.product), amount: row.amount, qty: row.qty, label: ledgerKey(row.warehouseName, row.productName) }));
  }
  if (kind === 'settlement') {
    const rows = await db.select({ company: settlementMoves.companyId, name: companies.name,
      amount: sql<string>`sum(case when ${settlementMoves.side} = 'customer' then ${settlementMoves.amount} else -${settlementMoves.amount} end)::text`,
    }).from(settlementMoves).innerJoin(documents, ledgerJoin(settlementMoves))
      .innerJoin(companies, and(eq(companies.workspaceId, workspaceId), eq(companies.id, settlementMoves.companyId)))
      .where(and(eq(settlementMoves.workspaceId, workspaceId), lte(settlementMoves.date, date), org)).groupBy(settlementMoves.companyId, companies.name);
    return rows.map(row => ({ key: row.company, label: row.name, amount: row.amount }));
  }
  const account = kind === 'cash' ? cashMoves.cashRegisterId : cashMoves.bankAccountId;
  const table = kind === 'cash' ? cashRegisters : bankAccounts;
  const name = kind === 'cash' ? cashRegisters.name : bankAccounts.account;
  const rows = await db.select({ account, name, amount: sql<string>`sum(case when ${cashMoves.direction} = 'in' then ${cashMoves.amount} else -${cashMoves.amount} end)::text` })
    .from(cashMoves).innerJoin(documents, ledgerJoin(cashMoves))
    .innerJoin(table, and(eq(table.workspaceId, workspaceId), eq(table.id, account)))
    .where(and(eq(cashMoves.workspaceId, workspaceId), eq(cashMoves.accountKind, kind), lte(cashMoves.date, date), org)).groupBy(account, name);
  return rows.flatMap(row => row.account ? [{ key: row.account, label: row.name, amount: row.amount }] : []);
}

function balanceKeys(row: IcBalance, find: (type: IcCatalogType, ref?: string) => string | undefined) {
  if (row.kind === 'stock') return [find('warehouse', row.warehouseRef), find('product', row.productRef)];
  if (row.kind === 'settlement') return [find('company', row.companyRef)];
  return [find(row.kind === 'cash' ? 'cash_register' : 'bank_account', row.accountRef)];
}

async function compareBalances(
  db: Db, workspaceId: string, parsed: ParsedEnterpriseData, resolve: Resolve, orgOf: OrgOf, options: IcReconcileOptions,
  unresolvedOrganizations: Set<string>,
) {
  const snapshots = new Map<string, { date: string; kind: IcBalance['kind']; rows: IcBalance[]; emptyOrgs: (string | undefined)[] }>();
  const include = (kind: IcBalance['kind'], date = options.dateTo) => {
    if (date < options.dateFrom || date > options.dateTo) return undefined;
    const key = `${date}:${kind}`;
    const snapshot = snapshots.get(key) ?? { date, kind, rows: [], emptyOrgs: [] };
    snapshots.set(key, snapshot);
    return snapshot;
  };
  for (const row of parsed.balances) include(row.kind, row.date)?.rows.push(row);
  for (const snapshot of parsed.balanceSnapshots) include(snapshot.kind, snapshot.date)?.emptyOrgs.push(snapshot.organizationRef);

  const result: BalanceDiff[] = [];
  const findId = (type: IcCatalogType, ref?: string) => resolve(type, ref)?.id;
  const names = new Map([...parsed.references, ...parsed.catalogs].map(row => [`${row.type}:${row.refUuid}`, row.name]));
  const labelOf = (row: IcBalance) => ledgerKey(...balanceKeys(row, (type, ref) => resolve(type, ref)?.name ?? names.get(`${type}:${ref}`) ?? ref ?? '?') as string[]);
  const fileOrgs = parsed.catalogs.filter(row => row.type === 'organization');
  const fileOrgId = fileOrgs.length === 1 ? orgOf(fileOrgs[0]!.refUuid) : undefined;
  const comparedKinds = new Set<IcBalance['kind']>();
  for (const { date, kind, rows, emptyOrgs } of snapshots.values()) {
    const external = new Map<string, { amount: bigint; qty: bigint; hasCost: boolean; label: string }>();
    const scopedIds = new Set<string>();
    let hasUnscoped = false;
    let incomplete = parsed.issues.some(issue => issue.reason === 'invalid_balance' && (issue.type === kind || issue.type === 'money' && (kind === 'bank' || kind === 'cash')));
    for (const ref of emptyOrgs) {
      const org = orgOf(ref) ?? fileOrgId;
      if (ref && !orgOf(ref)) { unresolvedOrganizations.add(ref); incomplete = true; continue; }
      if (options.organizationId && org !== options.organizationId) continue;
      if (org) scopedIds.add(org);
      else hasUnscoped = true;
    }
    for (const row of rows) {
      const account = row.kind === 'cash' || row.kind === 'bank' ? resolve(row.kind === 'cash' ? 'cash_register' : 'bank_account', row.accountRef) : undefined;
      const contract = row.kind === 'settlement' ? resolve('contract', row.contractRef) : undefined;
      const ownOrg = orgOf(row.organizationRef) ?? account?.organization ?? contract?.organization ?? fileOrgId;
      if (row.organizationRef && !orgOf(row.organizationRef)) {
        unresolvedOrganizations.add(row.organizationRef);
        incomplete = true;
      }
      if (options.organizationId && ownOrg !== options.organizationId) {
        if (!ownOrg) incomplete = true;
        continue;
      }
      if (ownOrg) scopedIds.add(ownOrg);
      else hasUnscoped = true;

      const ids = balanceKeys(row, findId);
      const product = row.kind === 'stock' ? resolve('product', row.productRef) : undefined;
      const invalidUnit = row.kind === 'stock' && row.unitCode && product?.unitCode && product.unitCode !== row.unitCode;
      const invalidCurrency = row.kind !== 'stock' && row.currency && icCurrency(row.currency) !== (account?.currency ?? 'RUB');
      if (!ids.every((id): id is string => !!id) || invalidUnit || invalidCurrency) {
        incomplete = true;
        const refs = balanceKeys(row, (_type, ref) => ref ?? '?') as string[];
        result.push({ date, kind, key: ledgerKey(...refs), label: labelOf(row), erpAmount: null,
          oneCAmount: row.kind === 'stock' && !row.hasCost ? null : money(row.amount), amountDifference: null,
          oneCQty: row.kind === 'stock' ? fmt(dec(row.qty), 3) : undefined,
          reason: invalidCurrency ? 'currency' : invalidUnit ? 'unit' : 'missing_reference' });
        continue;
      }
      const key = ledgerKey(...ids);
      const aggregate = external.get(key) ?? { amount: 0n, qty: 0n, hasCost: true, label: labelOf(row) };
      aggregate.amount += dec(row.amount);
      if (row.kind === 'stock') {
        aggregate.qty += dec(row.qty);
        aggregate.hasCost &&= row.hasCost;
      }
      external.set(key, aggregate);
    }
    if (!external.size && incomplete) {
      if (result.some(row => row.kind === kind && row.date === date)) comparedKinds.add(kind);
      continue;
    }
    const orgIds = options.organizationId ? [options.organizationId] : hasUnscoped ? [] : [...scopedIds];
    if (options.organizationId && !scopedIds.size) continue;
    comparedKinds.add(kind);
    const ledger = await ledgerAt(db, workspaceId, kind, date, orgIds);
    const byKey = new Map(ledger.map(row => [row.key, row]));
    const keys = incomplete ? external.keys() : new Set([...external.keys(), ...byKey.keys()]);
    for (const key of keys) {
      const erp = byKey.get(key);
      const oneC = external.get(key);
      const erpAmount = money(erp?.amount ?? '0');
      const oneCAmount = oneC?.hasCost === false ? null : fmt(oneC?.amount ?? 0n, 2);
      const amountDifference = oneCAmount === null ? null : fmt(dec(erpAmount) - dec(oneCAmount), 2);
      const erpQty = kind === 'stock' ? fmt(dec(erp?.qty), 3) : undefined;
      const oneCQty = kind === 'stock' ? fmt(oneC?.qty ?? 0n, 3) : undefined;
      const qtyDifference = kind === 'stock' ? fmt(dec(erpQty) - dec(oneCQty), 3) : undefined;
      if (dec(amountDifference) !== 0n || dec(qtyDifference) !== 0n) {
        result.push({ date, kind, key, label: erp?.label ?? oneC?.label, erpAmount, oneCAmount, amountDifference, erpQty, oneCQty, qtyDifference, reason: 'balance' });
      }
    }
  }
  return { stockDiffs: result.filter(row => row.kind === 'stock'), balanceDiffs: result.filter(row => row.kind !== 'stock'),
    balanceKinds: [...comparedKinds] };
}

export async function reconcile1c(db: Db, workspaceId: string, source: IcSource, parsed: ParsedEnterpriseData, options: IcReconcileOptions): Promise<IcReconcileReport> {
  const { organizationId, dateFrom, dateTo } = options;
  const erpOrganizations = await db.select({ id: organizations.id }).from(organizations)
    .where(and(eq(organizations.workspaceId, workspaceId), isNull(organizations.archivedAt)));
  const organizationIds = new Set(erpOrganizations.map(row => row.id));
  if (organizationId && !organizationIds.has(organizationId)) throw new DomainError(404, 'not_found', 'Organization not found');

  const { resolve } = await planImport(db, workspaceId, source, parsed);
  const linked = await linksOf(db, workspaceId, source, 'document');
  const byRef = new Map(linked.map(row => [row.refUuid, row.entityId]));
  const orgOf: OrgOf = ref => resolve('organization', ref)?.id ?? (ref && organizationIds.has(ref) ? ref : undefined);
  const unresolvedOrganizations = new Set<string>();
  const docRows = await db.select({
    id: documents.id, type: documents.type, number: documents.number, date: documents.date,
    organizationId: documents.organizationId, counterpartyId: documents.counterpartyId,
    currency: documents.currency, amount: documents.total,
  }).from(documents).where(and(
    eq(documents.workspaceId, workspaceId), eq(documents.status, 'posted'), inArray(documents.type, [...IC_DOCUMENT_TYPES]),
    gte(documents.date, shiftDay(dateFrom, -1)), lte(documents.date, shiftDay(dateTo, 1)), organizationId ? eq(documents.organizationId, organizationId) : undefined,
  )).orderBy(documents.date, documents.number, documents.id);
  const erpDocs = docRows.filter((row): row is IcErpDocument => documentTypes.has(row.type));
  const erpById = new Map(erpDocs.map(row => [row.id, row]));
  const oneCDocs = parsed.documents.filter(row => {
    if (row.date < dateFrom || row.date > dateTo) return false;
    if (!organizationId) return true;
    const link = row.refUuid ? byRef.get(row.refUuid) : undefined;
    const mapped = orgOf(row.organizationRef) ?? (link ? erpById.get(link)?.organizationId : undefined);
    if (!mapped && row.organizationRef) unresolvedOrganizations.add(row.organizationRef);
    if (!mapped && !row.organizationRef) unresolvedOrganizations.add('?');
    return mapped === organizationId;
  }).map(row => ({ ...row, currency: icCurrency(row.currency) }));
  const comparison = compareDocuments(erpDocs, oneCDocs, byRef, orgOf, resolve, options);
  const balances = await compareBalances(db, workspaceId, parsed, resolve, orgOf, options, unresolvedOrganizations);
  return { ...comparison, ...balances, issues: parsed.issues, unresolvedOrganizations: [...unresolvedOrganizations] };
}
