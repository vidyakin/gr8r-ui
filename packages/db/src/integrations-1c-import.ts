/* Migration from 1C through the standard opening documents. See docs/architecture/payments.md. */
import { createHash } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  dec, fmt, type DocumentLineInput, type EnterpriseDataParseIssue,
  type IcBalance, type IcCatalogObject, type IcCatalogType, type IcImportOptions,
  type OpeningLineInput, type ParsedEnterpriseData,
} from '@erp/shared';
import type { Db } from './client';
import { assertPeriodOpen } from './cost-closing';
import { createDocument, postDocument, type DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { autoMatch, linksOf, linkEntity, lockIcLinks, type IcSource, type MatchResult } from './integrations-1c';
import { createOpening } from './opening-balances';
import { bankAccounts, cashRegisters, companies, contracts, documents, organizations, products, units, warehouses } from './schema';

const catalogOrder = ['organization', 'company', 'warehouse', 'product', 'contract', 'bank_account', 'cash_register'] as const satisfies readonly IcCatalogType[];
const refKey = (type: IcCatalogType, ref: string) => `${type}:${ref}`;
const currencyCodes: Record<string, string> = { '643': 'RUB', '810': 'RUB', '840': 'USD', '978': 'EUR', '156': 'CNY', '398': 'KZT', '933': 'BYN',
  '860': 'UZS', '826': 'GBP', '784': 'AED', '484': 'MXN', '032': 'ARS', '986': 'BRL', '152': 'CLP', '170': 'COP', '604': 'PEN', '392': 'JPY',
  '949': 'TRY', '051': 'AMD' };
export const icCurrency = (code?: string) => currencyCodes[code ?? ''] ?? code?.toUpperCase();

type MatchIssue = 'ambiguous' | 'link_conflict' | 'missing_dependency' | 'invalid_details' | 'duplicate_identity';
type BalanceIssue = 'missing_reference' | 'organization_mismatch' | 'unsupported_balance';
type PlanMatch = { status: 'matched'; entityId: string; rule: string } | { status: 'new' }
  | { status: 'unmatched'; reason: MatchIssue; candidates?: { entityId: string; name: string }[] };
type PlanRow = { row: IcCatalogObject; match: PlanMatch };
interface RefTarget {
  id?: string;
  name?: string;
  ref?: string;
  organization?: string;
  company?: string;
  kind?: string;
  unitCode?: string;
  currency?: string;
  serials?: boolean;
  batches?: boolean;
}
interface BalanceProblem { index: number; balance: IcBalance; reason: BalanceIssue }
export interface IcImportPreview {
  matchedCount: number;
  newCount: number;
  unmatchedCount: number;
  catalogs: { type: IcCatalogType; matchedCount: number; newCount: number; unmatchedCount: number }[];
  unmatched: { type: IcCatalogType; refUuid: string; name: string; reason: MatchIssue; candidates?: { entityId: string; name: string }[] }[];
  balances: Record<IcBalance['kind'], number>;
  balanceDates: string[];
  balanceIssues: BalanceProblem[];
  issues: EnterpriseDataParseIssue[];
}
export interface IcImportResult {
  createdCount: number;
  linkedCount: number;
  openingDocumentIds: string[];
  unmatched: IcImportPreview['unmatched'];
}

const catalogTables = { organization: organizations, company: companies, warehouse: warehouses, product: products,
  contract: contracts, bank_account: bankAccounts, cash_register: cashRegisters } as const;

async function targetsOf(db: Db, workspaceId: string, type: IcCatalogType, ids: string[]): Promise<Map<string, RefTarget>> {
  if (!ids.length) return new Map();
  const table = catalogTables[type];
  const rows = await db.select({
    id: table.id,
    name: 'name' in table ? table.name : type === 'contract' ? contracts.number : bankAccounts.account,
    archivedAt: 'archivedAt' in table ? table.archivedAt : sql<null>`null`,
    organization: 'organizationId' in table ? table.organizationId : sql<null>`null`,
    company: 'companyId' in table ? table.companyId : sql<null>`null`,
    kind: 'kind' in table ? table.kind : sql<null>`null`,
    unitCode: type === 'product' ? products.unitCode : sql<null>`null`,
    currency: type === 'cash_register' ? cashRegisters.currency : sql<null>`null`,
    serials: type === 'product' ? products.trackSerials : sql<null>`null`,
    batches: type === 'product' ? products.trackBatches : sql<null>`null`,
  }).from(table).where(and(eq(table.workspaceId, workspaceId), sql`${table.id} = any(${`{${ids.join(',')}}`}::uuid[])`));
  return new Map(rows.filter(row => !row.archivedAt).map(row => [row.id, {
    id: row.id, name: row.name, organization: row.organization ?? undefined, company: row.company ?? undefined,
    kind: row.kind ?? undefined, unitCode: row.unitCode ?? undefined, currency: row.currency ?? undefined,
    serials: row.serials ?? undefined, batches: row.batches ?? undefined,
  }]));
}

export type Resolve = (type: IcCatalogType, ref?: string) => RefTarget | undefined;
const identity = (target?: RefTarget) => target?.id ?? target?.ref;

function catalogDependencies(resolve: Resolve, row: IcCatalogObject) {
  return {
    organization: resolve('organization', row.organizationRef ?? (!row.companyRef ? row.ownerRef : undefined)),
    company: resolve('company', row.companyRef ?? (!row.organizationRef ? row.ownerRef : undefined)),
  };
}

const distinctKeys = (row: IcCatalogObject) => {
  if (row.type === 'product') return [row.sku && `sku:${row.sku.toLowerCase()}`, row.barcode && `barcode:${row.barcode}`].filter(Boolean) as string[];
  if (row.type === 'warehouse' || row.type === 'cash_register') return [row.name.toLowerCase()];
  if (row.type === 'organization' || row.type === 'company') {
    const taxId = row.inn ? [row.inn, row.kpp ?? ''].join(':') : row.ogrn;
    return taxId ? [taxId] : [];
  }
  if (row.type === 'bank_account' && row.bik && row.account) return [`${row.bik}:${row.account}`];
  if (row.type === 'contract' && row.number) return [[row.organizationRef, row.companyRef, row.number, row.date].join(':')];
  return [];
};

export async function planImport(db: Db, workspaceId: string, source: IcSource, parsed: ParsedEnterpriseData) {
  const targets = new Map<string, RefTarget>();
  const resolve: Resolve = (type, ref) => ref ? targets.get(refKey(type, ref)) : undefined;
  const rows: PlanRow[] = [];
  const explicit = new Set(parsed.catalogs.map(row => refKey(row.type, row.refUuid)));
  const supplemental = parsed.references.filter(row => !explicit.has(refKey(row.type, row.refUuid)));
  const sourceRecords = [...parsed.catalogs, ...supplemental];
  const duplicateRefs = new Set(parsed.issues.filter(issue => issue.reason === 'duplicate_catalog').map(issue => `${issue.type}:${issue.refUuid}`));

  for (const type of catalogOrder) {
    const catalogRows = sourceRecords.filter(row => row.type === type);
    const links = await linksOf(db, workspaceId, source, type);
    const byEntity = new Map(links.map(link => [link.entityId, link.refUuid]));
    const candidates = catalogRows.map(row => {
      const deps = catalogDependencies(resolve, row);
      return { ...row, refName: row.name, organizationId: deps.organization?.id, companyId: deps.company?.id };
    });
    const matches = candidates.length ? await autoMatch(db, workspaceId, source, type, candidates, links) : [];
    const matchByRef = new Map(matches.map(({ candidate, result }) => [candidate.refUuid, result]));
    const existing = await targetsOf(db, workspaceId, type, [...new Set([
      ...links.map(link => link.entityId),
      ...matches.flatMap(({ result }) => result.status === 'matched' ? [result.entity.entityId] : []),
    ])]);
    for (const link of links) {
      const target = existing.get(link.entityId);
      if (target) targets.set(refKey(type, link.refUuid), target);
    }

    const candidateCounts = new Map<string, number>();
    const naturalCounts = new Map<string, number>();
    for (const row of catalogRows) {
      const match = matchByRef.get(row.refUuid);
      if (explicit.has(refKey(type, row.refUuid)) && match?.status === 'matched' && match.rule !== 'existing') candidateCounts.set(match.entity.entityId, (candidateCounts.get(match.entity.entityId) ?? 0) + 1);
      if (explicit.has(refKey(type, row.refUuid)) && match?.status !== 'matched') {
        for (const key of distinctKeys(row)) naturalCounts.set(key, (naturalCounts.get(key) ?? 0) + 1);
      }
    }

    for (const row of catalogRows) {
      const key = refKey(type, row.refUuid);
      const match = matchByRef.get(row.refUuid)!;
      const plan = classifyCatalog(row, match, resolve, existing, byEntity, candidateCounts,
        duplicateRefs.has(key) || distinctKeys(row).some(value => (naturalCounts.get(value) ?? 0) > 1));
      if (explicit.has(key)) rows.push({ row, match: plan });
      else if (plan.status !== 'matched' || (plan.rule !== 'existing' && candidateCounts.has(plan.entityId))) continue;
      if (plan.status === 'unmatched') {
        targets.delete(key);
      } else if (plan.status === 'matched') {
        targets.set(key, existing.get(plan.entityId)!);
      } else {
        const deps = catalogDependencies(resolve, row);
        targets.set(key, { ref: row.refUuid, name: row.name, organization: identity(deps.organization), company: identity(deps.company),
          kind: row.kind, unitCode: row.unitCode || '796', currency: icCurrency(row.currency) });
      }
    }
  }
  return { rows, resolve, targets };
}

function classifyCatalog(
  row: IcCatalogObject, match: MatchResult, resolve: Resolve, existing: Map<string, RefTarget>, byEntity: Map<string, string>,
  candidateCounts: Map<string, number>, duplicate: boolean,
): PlanMatch {
  if (match.status === 'matched' && match.rule === 'existing' && existing.has(match.entity.entityId)) {
    return { status: 'matched', entityId: match.entity.entityId, rule: match.rule };
  }
  if (duplicate) return { status: 'unmatched', reason: 'duplicate_identity' };
  if (match.status === 'candidates') return { status: 'unmatched', reason: 'ambiguous', candidates: match.candidates };

  const { organization, company } = catalogDependencies(resolve, row);
  if (match.status === 'matched') {
    const id = match.entity.entityId;
    const target = existing.get(id);
    if (!target || byEntity.has(id) || (candidateCounts.get(id) ?? 0) > 1 ||
      (row.type === 'bank_account' && (row.ownerRef || row.organizationRef || row.companyRef) &&
        !(target.organization && target.organization === organization?.id || target.company && target.company === company?.id)) ||
      (row.type === 'cash_register' && row.organizationRef && target.organization !== organization?.id) ||
      (row.type === 'product' && row.kind && target.kind !== row.kind)) {
      return { status: 'unmatched', reason: 'link_conflict', candidates: [match.entity] };
    }
    return { status: 'matched', entityId: id, rule: match.rule };
  }
  if ((row.type === 'contract' && (!organization || !company)) || (row.type === 'cash_register' && !organization) ||
    (row.type === 'bank_account' && (!!organization === !!company))) return { status: 'unmatched', reason: 'missing_dependency' };
  if (row.name.length > 500 || (row.type === 'contract' && (!row.date || (row.number || row.name).length > 100)) ||
    (row.type === 'bank_account' && (!row.bik || !row.account || row.bik.length > 12 || row.account.length > 64)) ||
    (row.type === 'product' && ((row.unitCode && !/^\d{3,4}$/.test(row.unitCode)) || (row.sku?.length ?? 0) > 64 || (row.barcode?.length ?? 0) > 64))) return { status: 'unmatched', reason: 'invalid_details' };
  return { status: 'new' };
}

const zero = (value: string, precision: number) => dec(fmt(dec(value), precision)) === 0n;
const isZeroBalance = (row: IcBalance) => zero(row.amount, 2) && (row.kind !== 'stock' || zero(row.qty, 3));

async function defaultOpeningOrganization(db: Db, workspaceId: string, parsed: ParsedEnterpriseData, resolve: Resolve) {
  const fileOrgs = parsed.catalogs.filter(row => row.type === 'organization');
  if (fileOrgs.length === 1) return resolve('organization', fileOrgs[0]!.refUuid);
  if (fileOrgs.length) return undefined;
  const orgs = await db.select({ id: organizations.id }).from(organizations)
    .where(and(eq(organizations.workspaceId, workspaceId), isNull(organizations.archivedAt))).limit(2);
  return orgs.length === 1 ? orgs[0] : undefined;
}

function openingOrganization(resolve: Resolve, row: IcBalance, fallback?: RefTarget) {
  if (row.organizationRef) return resolve('organization', row.organizationRef);
  if (row.kind === 'stock') return fallback;
  const owner = row.kind === 'settlement' ? resolve('contract', row.contractRef)
    : resolve(row.kind === 'cash' ? 'cash_register' : 'bank_account', row.accountRef);
  return owner?.organization ? { id: owner.organization } : fallback;
}

function checkBalance(resolve: Resolve, row: IcBalance, defaultOrg?: RefTarget): BalanceIssue | undefined {
  if (isZeroBalance(row)) return;
  const org = resolve('organization', row.organizationRef);
  if (row.organizationRef && !org) return 'missing_reference';
  const organization = identity(org);
  if (row.kind === 'stock') {
    const product = resolve('product', row.productRef);
    if (!product || !resolve('warehouse', row.warehouseRef) || !openingOrganization(resolve, row, defaultOrg)) return 'missing_reference';
    if (product.kind !== 'goods' || product.serials || product.batches || (row.unitCode && row.unitCode !== product.unitCode) ||
      dec(row.qty) <= 0n || zero(row.qty, 3) || dec(row.amount) < 0n) return 'unsupported_balance';
  } else if (row.kind === 'settlement') {
    const company = resolve('company', row.companyRef);
    const contract = resolve('contract', row.contractRef);
    if (!company || (row.contractRef && !contract) || !openingOrganization(resolve, row, defaultOrg)) return 'missing_reference';
    if (contract && (contract.company !== identity(company) || organization && contract.organization !== organization)) return 'organization_mismatch';
    if (row.currency && icCurrency(row.currency) !== 'RUB') return 'unsupported_balance';
  } else {
    const account = resolve(row.kind === 'cash' ? 'cash_register' : 'bank_account', row.accountRef);
    if (!account) return 'missing_reference';
    if (!account.organization || organization && account.organization !== organization) return 'organization_mismatch';
    if (dec(row.amount) < 0n || (row.currency && icCurrency(row.currency) !== (account.currency ?? 'RUB'))) return 'unsupported_balance';
  }
}

const unmatchedOf = (rows: PlanRow[]): IcImportPreview['unmatched'] => rows.flatMap(({ row, match }) =>
  match.status === 'unmatched' ? [{ type: row.type, refUuid: row.refUuid, name: row.name, reason: match.reason, candidates: match.candidates }] : []);

export async function preview1cImport(db: Db, workspaceId: string, source: IcSource, parsed: ParsedEnterpriseData): Promise<IcImportPreview> {
  const { rows, resolve } = await planImport(db, workspaceId, source, parsed);
  const defaultOrg = parsed.balances.length ? await defaultOpeningOrganization(db, workspaceId, parsed, resolve) : undefined;
  const catalogs = catalogOrder.map(type => {
    const group = rows.filter(entry => entry.row.type === type);
    return { type, matchedCount: group.filter(entry => entry.match.status === 'matched').length,
      newCount: group.filter(entry => entry.match.status === 'new').length, unmatchedCount: group.filter(entry => entry.match.status === 'unmatched').length };
  });
  const balances = { stock: 0, bank: 0, cash: 0, settlement: 0 };
  const balanceIssues: BalanceProblem[] = [];
  for (const [index, balance] of parsed.balances.entries()) {
    balances[balance.kind]++;
    const reason = checkBalance(resolve, balance, defaultOrg);
    if (reason) balanceIssues.push({ index, balance, reason });
  }
  const unmatched = unmatchedOf(rows);
  return {
    matchedCount: catalogs.reduce((sum, row) => sum + row.matchedCount, 0),
    newCount: catalogs.reduce((sum, row) => sum + row.newCount, 0),
    unmatchedCount: unmatched.length + parsed.issues.filter(issue => issue.reason === 'invalid_catalog').length,
    catalogs, unmatched, balances, balanceIssues,
    balanceDates: [...new Set(parsed.balances.flatMap(row => row.date ? [row.date] : []))].sort(), issues: parsed.issues,
  };
}

async function createCatalog(db: Db, ctx: DocCtx, row: IcCatalogObject, resolve: Resolve) {
  const { organization, company } = catalogDependencies(resolve, row);
  const base = { workspaceId: ctx.workspaceId, name: row.name };
  const party = { ...base, kind: row.partyKind, inn: row.inn, kpp: row.kpp, ogrn: row.ogrn };
  const unitCode = row.unitCode || '796';
  const vatRate = row.vatRate && ['none', '0', '5', '7', '10', '20'].includes(row.vatRate) ? row.vatRate : undefined;
  const insert = async () => {
    switch (row.type) {
      case 'organization': return db.insert(organizations).values({ ...party, fullName: row.fullName ?? row.name }).returning({ id: organizations.id });
      case 'company': return db.insert(companies).values(party).returning({ id: companies.id });
      case 'warehouse': return db.insert(warehouses).values(base).returning({ id: warehouses.id });
      case 'product': {
        const added = await db.insert(units).values({ workspaceId: ctx.workspaceId, code: unitCode, name: unitCode, symbol: unitCode }).onConflictDoNothing().returning({ id: units.id });
        if (added[0]) await recordEvent(db, { ...ctx, type: 'unit.created', entity: 'unit', recordId: added[0].id, actorId: ctx.memberId });
        return db.insert(products).values({ ...base, kind: row.kind, sku: row.sku, barcode: row.barcode, unitCode, vatRate }).returning({ id: products.id });
      }
      case 'contract': return db.insert(contracts).values({ workspaceId: ctx.workspaceId, organizationId: organization!.id!, companyId: company!.id!,
        number: row.number || row.name, date: row.date!, validFrom: row.date!, kind: row.contractKind }).returning({ id: contracts.id });
      case 'bank_account': return db.insert(bankAccounts).values({ workspaceId: ctx.workspaceId, organizationId: organization?.id, companyId: company?.id,
        bik: row.bik!, account: row.account!, bankName: row.bankName || row.bik!, corrAccount: row.corrAccount }).returning({ id: bankAccounts.id });
      case 'cash_register': return db.insert(cashRegisters).values({ ...base, organizationId: organization!.id!, currency: icCurrency(row.currency) }).returning({ id: cashRegisters.id });
    }
  };
  const [created] = await insert();
  const id = created!.id;
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: `${row.type}.created`, entity: row.type, recordId: id, actorId: ctx.memberId });
  return { id, name: row.name, organization: organization?.id, company: company?.id, kind: row.kind, unitCode, currency: icCurrency(row.currency) };
}

function stockOpeningLines(productId: string, quantity: string, amount: string): DocumentLineInput[] {
  const qty = dec(fmt(dec(quantity), 3)) / 1000n;
  const value = dec(fmt(dec(amount), 2)) / 10n;
  // The document stores prices in cents and quantities in thousandths. Split the
  // quantity between adjacent prices when necessary to preserve the total ledger cost.
  const price = value / qty;
  const atHigherPrice = value % qty;
  const lines: DocumentLineInput[] = [
    { productId, qty: fmt((qty - atHigherPrice) * 1000n, 3), price: fmt(price * 10_000n, 2), vatRate: 'none' },
  ];
  if (atHigherPrice) lines.push({ productId, qty: fmt(atHigherPrice * 1000n, 3), price: fmt((price + 1n) * 10_000n, 2), vatRate: 'none' });
  return lines;
}

const openingOptions = (row: IcBalance, options: IcImportOptions) =>
  row.kind === 'stock' ? options.stock : row.kind === 'settlement' ? options.settlements : options.money;

async function importOpening(db: Db, ctx: DocCtx, source: IcSource, parsed: ParsedEnterpriseData, options: IcImportOptions, resolve: Resolve) {
  if (!options.stock && !options.money && !options.settlements) return [];
  const date = options.date;
  if (!date) throw new DomainError(422, 'ic_unresolved_balances', 'Select the opening date');
  const rows = parsed.balances.filter(row => openingOptions(row, options) && (!row.date || row.date === date));
  const selectedParseIssue = parsed.issues.some(issue => issue.reason === 'invalid_balance' && (
    (issue.type === 'stock' && options.stock) || (issue.type === 'settlement' && options.settlements) ||
    (['cash', 'bank', 'money'].includes(issue.type) && options.money)
  ));
  const selectedKinds = new Set(rows.map(row => row.kind));
  if (selectedParseIssue || !rows.length || (options.stock && !selectedKinds.has('stock')) ||
    (options.money && !selectedKinds.has('cash') && !selectedKinds.has('bank')) || (options.settlements && !selectedKinds.has('settlement'))) {
    throw new DomainError(422, 'ic_unresolved_balances', 'Opening balances are missing or contain invalid rows on the selected date');
  }
  const defaultOrg = await defaultOpeningOrganization(db, ctx.workspaceId, parsed, resolve);
  const groups = new Map<string, { organizationId: string; warehouseId?: string; stock: DocumentLineInput[]; money: OpeningLineInput[] }>();
  for (const [index, row] of rows.entries()) {
    if (isZeroBalance(row)) continue;
    const reason = checkBalance(resolve, row, defaultOrg);
    const account = row.kind === 'bank' || row.kind === 'cash'
      ? resolve(row.kind === 'cash' ? 'cash_register' : 'bank_account', row.accountRef) : undefined;
    const contract = row.kind === 'settlement' ? resolve('contract', row.contractRef) : undefined;
    const organizationId = openingOrganization(resolve, row, defaultOrg)?.id;
    if (reason || !organizationId) throw new DomainError(422, 'ic_unresolved_balances', 'Opening balances contain unresolved rows', { index, reason: reason ?? 'missing_reference', balance: row });
    const warehouseId = row.kind === 'stock' ? resolve('warehouse', row.warehouseRef)!.id : undefined;
    const key = `${organizationId}:${warehouseId ?? 'money'}`;
    const group = groups.get(key) ?? { organizationId, warehouseId, stock: [], money: [] };
    groups.set(key, group);
    const amount = dec(row.amount);
    if (row.kind === 'stock') {
      group.stock.push(...stockOpeningLines(resolve('product', row.productRef)!.id!, row.qty, row.amount));
    } else if (row.kind === 'settlement') {
      const side = row.side ?? (amount > 0n ? 'customer' : 'supplier');
      // Signed amounts express net receivables. An explicit side also lets us preserve advances.
      const advance = side === 'customer' ? amount < 0n : amount > 0n;
      group.money.push({ kind: advance ? `${side}_advance` : `${side}_debt`, counterpartyId: resolve('company', row.companyRef)!.id,
        contractId: contract?.id, amount: fmt(amount < 0n ? -amount : amount, 2), comment: '' });
    } else {
      group.money.push({ kind: row.kind, bankAccountId: row.kind === 'bank' ? account!.id : undefined,
        cashRegisterId: row.kind === 'cash' ? account!.id : undefined, amount: fmt(amount, 2), comment: '' });
    }
  }

  const ids: string[] = [];
  for (const group of [...groups.values()].sort((a, b) => `${a.organizationId}:${a.warehouseId}`.localeCompare(`${b.organizationId}:${b.warehouseId}`))) {
    const type = group.warehouseId ? 'opening_stock' : 'opening_balance';
    const hash = createHash('sha256').update(JSON.stringify([source, date, (group.warehouseId ? group.stock : group.money).map(row => JSON.stringify(row)).sort()])).digest('hex');
    const marker = `1C · ${source} · ${hash}`;
    const existing = await db.select({ id: documents.id, comment: documents.comment, status: documents.status }).from(documents)
      .where(and(eq(documents.workspaceId, ctx.workspaceId), eq(documents.organizationId, group.organizationId), eq(documents.type, type),
        ne(documents.status, 'cancelled'), group.warehouseId ? eq(documents.warehouseId, group.warehouseId) : undefined));
    const same = existing.find(row => row.comment === marker);
    if (existing.some(row => row.id !== same?.id)) throw new DomainError(409, 'ic_opening_exists', 'An opening document already exists for this organization or warehouse', { documentId: existing[0]!.id });
    if (!same || (options.post && same.status === 'draft')) await assertPeriodOpen(db, ctx.workspaceId, date);
    const id = same?.id ?? (group.warehouseId
      ? await createDocument(db, { ...ctx, explicitOpeningStockCost: true }, { type: 'opening_stock', organizationId: group.organizationId, warehouseId: group.warehouseId,
        date, comment: marker, priceIncludesVat: true, lines: group.stock })
      : await createOpening(db, ctx, { organizationId: group.organizationId, date, comment: marker, lines: group.money }));
    if (options.post && same?.status !== 'posted') await postDocument(db, ctx, id);
    ids.push(id);
  }
  return ids;
}

/** Called within the workspace transaction. All links, catalogs and ledger entries commit together. */
export async function apply1cImport(db: Db, workspaceId: string, memberId: string, source: IcSource, parsed: ParsedEnterpriseData, options: IcImportOptions): Promise<IcImportResult> {
  // One opening per organization/accounting scope, even if two imports use different configurations.
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`integrations-1c-import:${workspaceId}`}, 0))`);
  await lockIcLinks(db, workspaceId, source);
  const { rows, targets, resolve } = await planImport(db, workspaceId, source, parsed);
  // Planned objects only become usable after their actual insert and mapping.
  for (const { row, match } of rows) if (match.status === 'new') targets.delete(refKey(row.type, row.refUuid));
  const actor = { workspaceId, memberId, role: 'admin' as const };
  let createdCount = 0;
  let linkedCount = 0;
  for (const entry of rows) {
    const { row, match } = entry;
    if (!options.catalogTypes.includes(row.type) || match.status === 'unmatched' || (match.status === 'matched' && match.rule === 'existing')) continue;
    let entityId: string;
    if (match.status === 'matched') {
      entityId = match.entityId;
    } else {
      const available = classifyCatalog(row, { status: 'none' }, resolve, new Map(), new Map(), new Map(), false);
      if (available.status !== 'new') {
        entry.match = available;
        continue;
      }
      const target = await createCatalog(db, actor, row, resolve);
      entityId = target.id;
      targets.set(refKey(row.type, row.refUuid), target);
      createdCount++;
    }
    await linkEntity(db, actor, source, row.type, entityId, { refUuid: row.refUuid, refName: row.name }, { by: 'auto', rule: match.status === 'new' ? 'import' : match.rule });
    linkedCount++;
  }
  const openingDocumentIds = await importOpening(db, actor, source, parsed, options, resolve);
  return { createdCount, linkedCount, openingDocumentIds, unmatched: unmatchedOf(rows) };
}
