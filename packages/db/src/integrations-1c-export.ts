/* Сборка файловой выгрузки под RLS. Пользовательская справка — docs/user/automations/integrations.md. */
import { and, asc, eq, gte, isNull, lte, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { generateEnterpriseData, IC_DOCUMENT_TYPES, unitQtyOf, type EnterpriseDataDocument, type EnterpriseDataInput, type EnterpriseDataOptions, type EnterpriseDataSchedule } from '@erp/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { lockIcLinks, type IcEntityType } from './integrations-1c';
import { bankAccounts, cashRegisters, companies, contracts, documentLines, documents, integrations1cLinks, integrations1cSchedules, members, organizations, paymentLines, products, warehouses } from './schema';

type ExportActor = { workspaceId: string; memberId: string | null };
const source = 'buh3';
const isExportDocument = (type: string): type is EnterpriseDataDocument['type'] =>
  (IC_DOCUMENT_TYPES as readonly string[]).includes(type);
const ids = (values: (string | null | undefined)[]) => [...new Set(values.filter((value): value is string => !!value))];
// A single parameter also works for batches with more than PostgreSQL's bind-parameter limit.
const matchesIds = (column: SQLWrapper, values: string[]) => values.length
  ? sql`${column} = any(${`{${values.join(',')}}`}::uuid[])`
  : sql`false`;

function groupLines<T extends { documentId: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.documentId);
    if (group) group.push(row);
    else groups.set(row.documentId, [row]);
  }
  return groups;
}

async function assertOrganization(db: Db, workspaceId: string, organizationId: string | undefined) {
  if (!organizationId) return;
  const [row] = await db.select({ id: organizations.id }).from(organizations)
    .where(and(eq(organizations.workspaceId, workspaceId), eq(organizations.id, organizationId)));
  if (!row) throw new DomainError(404, 'not_found', 'Organization not found');
}

async function loadExportData(db: Db, workspaceId: string, options: EnterpriseDataOptions) {
  const org = options.organizationId;
  const emit = (type: NonNullable<EnterpriseDataOptions['catalogTypes']>[number]) =>
    options.includeCatalogs !== false && (!options.catalogTypes || options.catalogTypes.includes(type));
  const types = options.includeDocuments === false ? [] : options.documentTypes ?? IC_DOCUMENT_TYPES;
  const docs = types.length ? await db.select({
    id: documents.id, type: documents.type, number: documents.number, date: documents.date,
    organizationId: documents.organizationId, counterpartyId: documents.counterpartyId, contractId: documents.contractId,
    warehouseId: documents.warehouseId, bankAccountId: documents.bankAccountId, targetBankAccountId: documents.targetBankAccountId,
    cashRegisterId: documents.cashRegisterId, targetCashRegisterId: documents.targetCashRegisterId, accountableMemberId: documents.accountableMemberId,
    operation: documents.operation, currency: documents.currency, priceIncludesVat: documents.priceIncludesVat,
    total: documents.total, comment: documents.comment,
  }).from(documents).where(and(
    eq(documents.workspaceId, workspaceId), eq(documents.status, 'posted'),
    gte(documents.date, options.dateFrom), lte(documents.date, options.dateTo),
    sql`${documents.type} = any(${`{${types.join(',')}}`}::text[])`,
    org ? eq(documents.organizationId, org) : undefined,
  )).orderBy(asc(documents.id)).for('share') : [];
  const docIds = docs.map(row => row.id);
  const [lines, payments] = docIds.length ? await Promise.all([
    db.select().from(documentLines).where(and(eq(documentLines.workspaceId, workspaceId), matchesIds(documentLines.documentId, docIds)))
      .orderBy(asc(documentLines.sortOrder), asc(documentLines.id)),
    db.select().from(paymentLines).where(and(eq(paymentLines.workspaceId, workspaceId), matchesIds(paymentLines.documentId, docIds)))
      .orderBy(asc(paymentLines.sortOrder), asc(paymentLines.id)),
  ]) : [[], []];

  const contractIds = ids([...docs.map(row => row.contractId), ...payments.map(row => row.contractId)]);
  const contractRows = await db.select().from(contracts).where(and(eq(contracts.workspaceId, workspaceId),
    or(matchesIds(contracts.id, contractIds), emit('contract')
      ? and(isNull(contracts.archivedAt), org ? eq(contracts.organizationId, org) : undefined)
      : undefined)));

  const accountIds = ids(docs.flatMap(row => [row.bankAccountId, row.targetBankAccountId]));
  const accountRows = await db.select().from(bankAccounts).where(and(eq(bankAccounts.workspaceId, workspaceId),
    or(matchesIds(bankAccounts.id, accountIds), emit('bank_account')
      ? org ? or(eq(bankAccounts.organizationId, org), isNull(bankAccounts.organizationId)) : sql`true`
      : undefined)));

  const activeOrReferenced = (column: SQLWrapper, references: string[], active?: SQL) =>
    or(matchesIds(column, references), active);
  const organizationIds = ids([...docs.map(row => row.organizationId), ...contractRows.map(row => row.organizationId), ...accountRows.map(row => row.organizationId)]);
  const companyIds = ids([...docs.map(row => row.counterpartyId), ...payments.map(row => row.counterpartyId), ...contractRows.map(row => row.companyId), ...accountRows.map(row => row.companyId)]);
  const productIds = ids(lines.map(row => row.productId));
  const warehouseIds = ids(docs.map(row => row.warehouseId));
  const memberIds = ids(docs.map(row => row.accountableMemberId));
  const cashRegisterIds = ids(docs.flatMap(row => [row.cashRegisterId, row.targetCashRegisterId]));
  const [orgRows, companyRows, productRows, warehouseRows, memberRows, cashRegisterRows] = await Promise.all([
    db.select().from(organizations).where(and(eq(organizations.workspaceId, workspaceId), activeOrReferenced(
      organizations.id, organizationIds, emit('organization') ? (org ? eq(organizations.id, org) : isNull(organizations.archivedAt)) : undefined))),
    db.select().from(companies).where(and(eq(companies.workspaceId, workspaceId),
      activeOrReferenced(companies.id, companyIds, emit('company') ? isNull(companies.archivedAt) : undefined))),
    db.select().from(products).where(and(eq(products.workspaceId, workspaceId),
      activeOrReferenced(products.id, productIds, emit('product') ? isNull(products.archivedAt) : undefined))),
    db.select().from(warehouses).where(and(eq(warehouses.workspaceId, workspaceId),
      activeOrReferenced(warehouses.id, warehouseIds, emit('warehouse') ? isNull(warehouses.archivedAt) : undefined))),
    db.select({ id: members.id, name: members.name }).from(members)
      .where(and(eq(members.workspaceId, workspaceId), matchesIds(members.id, memberIds))),
    db.select({ id: cashRegisters.id, name: cashRegisters.name }).from(cashRegisters)
      .where(and(eq(cashRegisters.workspaceId, workspaceId), matchesIds(cashRegisters.id, cashRegisterIds))),
  ]);
  const cashRegisterById = new Map(cashRegisterRows.map(row => [row.id, row]));
  const memberById = new Map(memberRows.map(row => [row.id, row]));
  const linesByDoc = groupLines(lines);
  const paymentsByDoc = groupLines(payments);

  const data: EnterpriseDataInput = {
    organizations: orgRows,
    companies: companyRows,
    // Contracts have no currency column. RUB is the contract/billing default.
    contracts: contractRows.map(row => ({ ...row, name: row.number || row.date, currency: 'RUB' })),
    products: productRows,
    warehouses: warehouseRows,
    bankAccounts: accountRows.map(row => ({ ...row, name: row.account })),
    documents: docs.flatMap(row => !isExportDocument(row.type) ? [] : [{
      ...row,
      type: row.type,
      number: row.number ?? '',
      companyId: row.counterpartyId,
      cashRegister: row.cashRegisterId ? cashRegisterById.get(row.cashRegisterId) : undefined,
      targetCashRegister: row.targetCashRegisterId ? cashRegisterById.get(row.targetCashRegisterId) : undefined,
      accountable: row.accountableMemberId ? memberById.get(row.accountableMemberId) : undefined,
      lines: linesByDoc.get(row.id)?.map(line => ({ ...line, qty: unitQtyOf(line.qty, line.unitFactor) })),
      paymentLines: paymentsByDoc.get(row.id)?.map(line => ({ ...line, companyId: line.counterpartyId })),
    }]),
  };
  return data;
}

/** Called in a tenant transaction. Preview passes saveLinks=false and leaves mappings untouched. */
export async function exportEnterpriseData(db: Db, actor: ExportActor, options: EnterpriseDataOptions) {
  const { workspaceId, memberId } = actor;
  await assertOrganization(db, workspaceId, options.organizationId);
  const data = await loadExportData(db, workspaceId, options);
  if (options.saveLinks) await lockIcLinks(db, workspaceId, source);

  const links = await db.select({ entityType: integrations1cLinks.entityType, entityId: integrations1cLinks.entityId, refUuid: integrations1cLinks.refUuid })
    .from(integrations1cLinks).where(and(eq(integrations1cLinks.workspaceId, workspaceId), eq(integrations1cLinks.source, source)));
  const byEntity = new Map(links.map(row => [`${row.entityType}:${row.entityId}`, row.refUuid]));
  const byRef = new Map(links.map(row => [`${row.entityType}:${row.refUuid}`, row.entityId]));
  const newLinks: (typeof integrations1cLinks.$inferInsert)[] = [];
  const applyLinks = (entityType: IcEntityType, rows: { id: string; refUuid?: string; name?: string; number?: string }[]) => {
    for (const row of rows) {
      const existing = byEntity.get(`${entityType}:${row.id}`);
      row.refUuid = existing ?? row.id;
      const owner = byRef.get(`${entityType}:${row.refUuid}`);
      if (owner && owner !== row.id) {
        throw new DomainError(409, 'conflict', 'The default GUID is linked to another 1C record. Assign an explicit GUID in 1C links.');
      }
      if (options.saveLinks && !existing) {
        newLinks.push({ workspaceId, source, entityType, entityId: row.id, refUuid: row.refUuid,
          refName: (row.name ?? row.number ?? '').slice(0, 255), matchedBy: 'auto', matchedRule: 'export', createdBy: memberId });
      }
    }
  };
  applyLinks('organization', data.organizations);
  applyLinks('company', data.companies);
  applyLinks('contract', data.contracts);
  applyLinks('product', data.products);
  applyLinks('warehouse', data.warehouses);
  applyLinks('bank_account', data.bankAccounts);
  applyLinks('document', data.documents);

  const result = generateEnterpriseData(data, options);
  for (let i = 0; i < newLinks.length; i += 1000) {
    await db.insert(integrations1cLinks).values(newLinks.slice(i, i + 1000));
  }
  if (newLinks.length) {
    await recordEvent(db, { workspaceId, type: 'ic_link.exported', entity: 'ic_link', actorId: memberId, payload: { count: newLinks.length } });
  }
  return result;
}

export async function saveIcExportSchedule(db: Db, { workspaceId, memberId }: ExportActor, options: EnterpriseDataSchedule) {
  await assertOrganization(db, workspaceId, options.organizationId);
  await db.insert(integrations1cSchedules).values({ workspaceId, options })
    .onConflictDoUpdate({ target: integrations1cSchedules.workspaceId, set: { options, failedAt: null } });
  await recordEvent(db, { workspaceId, type: 'ic_export.schedule_updated', entity: 'ic_export', actorId: memberId, payload: { enabled: options.enabled } });
}
