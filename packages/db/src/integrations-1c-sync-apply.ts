/* Applying received EnterpriseData objects under tenant RLS. */
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  dec, div, fmt, documentCreate, paymentCreate, resolveIcConflict, VAT_RATES,
  type IcCatalogObject, type IcCatalogType, type IcParsedDocument, type IcSyncIssue, type ParsedEnterpriseData,
  type PaymentOperation,
} from '@erp/shared';
import type { Db } from './client';
import { cancelDocument, createDocument, postDocument, restoreDocument, unpostDocument, updateDocument, type DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { catalogDependencies, createCatalog, icCurrency, planImport, type Resolve } from './integrations-1c-import';
import { linkEntity, linksOf, lockIcLinks } from './integrations-1c';
import { captureIcBacklog, discardIcChanges, pendingIcChanges, type IcChannel } from './integrations-1c-sync';
import { createPayment, updatePayment } from './payments';
import { bankAccounts, cashRegisters, companies, contracts, documents, members, organizations, products, stockBalances, warehouses } from './schema';

const catalogs = { organization: organizations, company: companies, product: products, warehouse: warehouses,
  contract: contracts, bank_account: bankAccounts, cash_register: cashRegisters };

type ObjectInfo = Pick<IcSyncIssue, 'type' | 'name' | 'refUuid' | 'entityId'>;
type ObjectError = 'missing_reference' | 'invalid_object' | 'document_total' | 'unsupported' | 'unmatched';
class IcObjectError extends Error {
  constructor(readonly code: ObjectError) { super(code); }
}

function required<T>(value: T | undefined | null): T {
  if (value == null) throw new IcObjectError('missing_reference');
  return value;
}

function referenceId(resolve: Resolve, type: IcCatalogType, ref?: string) {
  return ref ? required(resolve(type, ref)?.id) : null;
}

async function updateCatalog(db: Db, ctx: DocCtx, id: string, row: IcCatalogObject) {
  if (!row.name || row.name.length > 500) throw new IcObjectError('invalid_object');
  const base = { name: row.name, archivedAt: null, updatedAt: new Date() };
  const party = { ...base, kind: row.partyKind, inn: row.inn ?? '', kpp: row.kpp ?? '', ogrn: row.ogrn ?? '' };
  switch (row.type) {
    case 'organization':
      await db.update(organizations).set({ ...party, fullName: row.fullName ?? row.name }).where(eq(organizations.id, id));
      break;
    case 'company':
      await db.update(companies).set(party).where(eq(companies.id, id));
      break;
    case 'warehouse':
      await db.update(warehouses).set(base).where(eq(warehouses.id, id));
      break;
    case 'product': {
      const unitCode = row.unitCode;
      if ((unitCode && !/^\d{3,4}$/.test(unitCode)) || (row.sku?.length ?? 0) > 64 || (row.barcode?.length ?? 0) > 64) {
        throw new IcObjectError('invalid_object');
      }
      const [current] = await db.select({ kind: products.kind, unitCode: products.unitCode }).from(products).where(eq(products.id, id));
      // Changing base units or stock/service kind would reinterpret existing stock movements.
      if ((row.kind && row.kind !== current?.kind) || (unitCode && unitCode !== current?.unitCode)) throw new IcObjectError('unsupported');
      await db.update(products).set({ ...base, sku: row.sku ?? '', barcode: row.barcode ?? '', vatRate: row.vatRate && VAT_RATES.some(rate => rate === row.vatRate) ? row.vatRate : undefined }).where(eq(products.id, id));
      break;
    }
    case 'contract':
    case 'bank_account':
    case 'cash_register':
      // Matched dependency records retain their FutureERP accounting parameters.
      return false;
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: `${row.type}.updated`, entity: row.type, recordId: id });
  return true;
}

function paymentOperation(row: IcParsedDocument, counterpartyId: string | null): PaymentOperation {
  const incoming = row.type === 'bank_receipt' || row.type === 'cash_receipt';
  const operation = row.operation ?? row.sync?.paymentKind;
  if (operation === 'РасчетыССотрудниками') return incoming ? 'from_accountable' : 'to_accountable';
  if (operation === 'РасчетыСКонтрагентами') return incoming ? 'from_customer' : 'to_supplier';
  if (operation === 'СПокупателем') return incoming ? 'from_customer' : 'customer_refund';
  if (operation === 'СПоставщиком') return incoming ? 'supplier_refund' : 'to_supplier';
  if (counterpartyId && !operation) return incoming ? 'from_customer' : 'to_supplier';
  if (!operation || ['ПрочееПоступление', 'ПрочееСписание', 'ПрочаяВыдача'].includes(operation)) {
    return incoming ? 'other_income' : 'other_expense';
  }
  if (!incoming && ['Перемещение', 'ПеремещениеДенежныхСредств'].includes(operation)) return 'money_transfer';
  throw new IcObjectError('unsupported');
}

async function applyDocument(
  db: Db, ctx: DocCtx, resolve: Resolve, row: IcParsedDocument, existing?: typeof documents.$inferSelect,
) {
  const detail = required(row.sync);
  const type = existing?.type === 'realization' && row.serviceOnly ? 'realization' : row.serviceOnly ? 'act' : row.type;
  if (existing && existing.type !== type) throw new IcObjectError('invalid_object');
  const organizationId = required(referenceId(resolve, 'organization', row.organizationRef));
  const counterpartyId = referenceId(resolve, 'company', row.companyRef);
  const common = { organizationId, counterpartyId, date: row.date, comment: detail.comment };
  // Keep FutureERP's allocated document number. The cross-system identity is the EnterpriseData GUID.
  if (existing?.status === 'posted') await unpostDocument(db, ctx, existing.id, { repost: true });
  if (existing?.status === 'cancelled') await restoreDocument(db, ctx, existing.id);

  let id: string;
  if (type === 'realization' || type === 'act' || type === 'receipt') {
    const lines = await Promise.all(detail.tradeLines.map(async line => {
      const productId = required(referenceId(resolve, 'product', line.productRef));
      const [product] = await db.select({ unitCode: products.unitCode }).from(products).where(eq(products.id, productId));
      if (line.unitCode && line.unitCode !== product?.unitCode) throw new IcObjectError('unsupported');
      const qty = required(line.qty);
      if (dec(qty) <= 0n) throw new IcObjectError('invalid_object');
      const price = line.amount === undefined ? required(line.price) : fmt(div(dec(line.amount), dec(qty)), 6);
      return { productId, qty, price, vatRate: line.vatRate };
    }));
    const input = documentCreate.safeParse({ ...common, type, lines, priceIncludesVat: detail.priceIncludesVat,
      warehouseId: referenceId(resolve, 'warehouse', detail.warehouseRef),
      contractId: referenceId(resolve, 'contract', detail.contractRef) });
    if (!lines.length || !input.success) throw new IcObjectError('invalid_object');
    if (existing) {
      const { type: _type, id: _id, ...patch } = input.data;
      await updateDocument(db, ctx, existing.id, patch);
      id = existing.id;
    } else {
      id = await createDocument(db, ctx, input.data);
    }
  } else {
    const advance = type === 'advance_report';
    const bank = type === 'bank_receipt' || type === 'bank_payment';
    const bankAccountId = bank ? required(referenceId(resolve, 'bank_account', detail.accountRef)) : null;
    const cashRegisterId = bank || advance ? null : required(referenceId(resolve, 'cash_register', detail.cashRegisterRef));
    const isTransfer = !!(detail.targetAccountRef || detail.targetCashRegisterRef);
    if (isTransfer && (type === 'bank_receipt' || type === 'cash_receipt')) throw new IcObjectError('unsupported');
    const operation = advance ? undefined : isTransfer ? 'money_transfer' : paymentOperation(row, counterpartyId);
    let accountableMemberId: string | null = null;
    if (advance || operation === 'from_accountable' || operation === 'to_accountable') {
      const [direct] = detail.accountableRef ? await db.select({ id: members.id }).from(members)
        .where(and(eq(members.id, detail.accountableRef), eq(members.status, 'active'))) : [];
      if (direct) {
        accountableMemberId = direct.id;
      } else if (detail.accountableName) {
        const matches = await db.select({ id: members.id }).from(members)
          .where(and(eq(members.name, detail.accountableName), eq(members.status, 'active'))).limit(2);
        if (matches.length === 1) accountableMemberId = matches[0]!.id;
      }
      required(accountableMemberId);
    }
    if (advance && !detail.paymentLines.length) throw new IcObjectError('unsupported');
    const lines = detail.paymentLines.length ? detail.paymentLines.map(line => ({
      amount: line.amount, contractId: referenceId(resolve, 'contract', line.contractRef),
      counterpartyId: referenceId(resolve, 'company', line.companyRef), comment: line.comment,
    })) : [{ amount: row.amount, contractId: referenceId(resolve, 'contract', detail.contractRef) }];
    const input = paymentCreate.safeParse({ ...common, type, operation, bankAccountId, cashRegisterId, accountableMemberId, lines,
      targetBankAccountId: referenceId(resolve, 'bank_account', detail.targetAccountRef),
      targetCashRegisterId: referenceId(resolve, 'cash_register', detail.targetCashRegisterRef) });
    if (!input.success) throw new IcObjectError('invalid_object');
    if (existing) {
      const { type: _type, id: _id, ...patch } = input.data;
      await updatePayment(db, ctx, existing.id, patch);
      id = existing.id;
    } else {
      id = await createPayment(db, ctx, input.data);
    }
  }
  await postDocument(db, ctx, id);
  const [stored] = await db.select({ total: documents.total, currency: documents.currency }).from(documents).where(eq(documents.id, id));
  if (fmt(dec(stored?.total), 2) !== fmt(dec(row.amount), 2) || (row.currency && icCurrency(row.currency) !== stored?.currency)) {
    throw new IcObjectError('document_total');
  }
  return id;
}

/** Journal each rejected object and roll back its writes, including post/unpost, independently. */
export async function applyIcPackage(db: Db, channel: IcChannel, parsed: ParsedEnterpriseData, remoteAck: number) {
  const workspaceId = channel.workspaceId;
  const actor = { workspaceId, memberId: null, role: 'admin' as const };
  const issues: IcSyncIssue[] = [
    ...parsed.issues.map(issue => ({ ...issue, stage: 'pull' as const, code: 'invalid_object' as const })),
    ...(parsed.unsupported ?? []).map(issue => ({ ...issue, stage: 'pull' as const, code: 'unsupported' as const })),
  ];
  if (parsed.balanceSnapshots.length || parsed.balances.length) issues.push({ code: 'unsupported', stage: 'pull', type: 'opening_balances' });
  const invalid = new Set(parsed.issues.filter(issue => issue.refUuid).map(issue =>
    `${issue.reason.endsWith('document') ? 'document' : issue.type}:${issue.refUuid}`));
  await lockIcLinks(db, workspaceId, channel.source);
  await db.execute(sql`select set_config('app.ic_sync_import', 'on', true)`);
  const plan = await planImport(db, workspaceId, channel.source, parsed);
  // An upsert and a removal of the same GUID in a single message have no safe ordering.
  const upserts = new Set([...parsed.catalogs.map(row => `${row.type}:${row.refUuid}`),
    ...parsed.documents.map(row => `document:${row.refUuid}`)]);
  const removals = new Set<string>();
  for (const row of parsed.removals ?? []) {
    const key = `${row.type}:${row.refUuid}`;
    if ((upserts.has(key) || removals.has(key)) && !invalid.has(key)) {
      invalid.add(key);
      issues.push({ type: row.type, refUuid: row.refUuid, code: 'invalid_object', stage: 'pull' });
    }
    removals.add(key);
  }
  for (const { row, match } of plan.rows) {
    if (match.status === 'new') plan.targets.delete(`${row.type}:${row.refUuid}`);
  }
  const resolve = plan.resolve;
  let blockPending = false;

  const apply = async (info: ObjectInfo, fn: () => Promise<boolean>) => {
    if (invalid.has(`${info.type}:${info.refUuid}`)) return;
    await db.execute(sql`savepoint ic_sync_object`);
    try {
      await fn();
    } catch (error) {
      await db.execute(sql`rollback to savepoint ic_sync_object`);
      const cause = error instanceof Error ? error.cause : undefined;
      const pgCode = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
      const invalidRow = typeof pgCode === 'string' && /^(22|23)[0-9A-Z]{3}$/.test(pgCode);
      if (!(error instanceof IcObjectError || error instanceof DomainError) && !invalidRow) throw error;
      issues.push({ ...info, stage: 'pull', code: error instanceof IcObjectError ? error.code : 'apply_failed',
        reason: error instanceof DomainError ? error.code : invalidRow ? pgCode : undefined });
    }
    await db.execute(sql`release savepoint ic_sync_object`);
  };

  const prioritize = async (info: ObjectInfo & { type: string; entityId: string }, fn: () => Promise<boolean>) => {
    // Caller locks the record first so a just-committed ERP write is visible in the outbox.
    await captureIcBacklog(db, channel, { type: info.type, id: info.entityId });
    const pending = await pendingIcChanges(db, channel, info.type, info.entityId);
    const policy = channel.conflictPolicy;
    const decision = resolveIcConflict(policy, pending.length > 0);
    if (pending.length) issues.push({ ...info, code: 'conflict', stage: 'pull', policy });
    if (decision === 'keep_local') return false;
    if (decision === 'apply' && !(await fn())) return false;
    await discardIcChanges(db, channel, pending.map(row => row.id));
    if (pending.some(row => row.sentMessageNo !== null && row.sentMessageNo > remoteAck)) blockPending = true;
    return decision === 'apply';
  };

  for (const entry of plan.rows) {
    const { row } = entry;
    const info = { type: row.type, refUuid: row.refUuid, name: row.name.slice(0, 500) };
    await apply(info, async () => {
      let match = entry.match;
      const table = catalogs[row.type];
      if (match.status === 'unmatched' && match.reason === 'link_conflict' && 'archivedAt' in table && row.type !== 'contract' && row.type !== 'cash_register') {
        const link = (await linksOf(db, workspaceId, channel.source, row.type)).find(link => link.refUuid === row.refUuid);
        if (link) {
          const [archived] = await db.select({ id: table.id, archivedAt: table.archivedAt }).from(table)
            .where(eq(table.id, link.entityId)).for('update');
          if (archived?.archivedAt) match = { status: 'matched', rule: 'existing', entityId: archived.id };
        }
      }
      if (match.status === 'unmatched') {
        issues.push({ ...info, code: 'unmatched', stage: 'pull', reason: match.reason });
        return false;
      }
      if (match.status === 'new') {
        const { organization, company } = catalogDependencies(resolve, row);
        if ((row.type === 'contract' && (!organization?.id || !company?.id)) ||
            (row.type === 'cash_register' && !organization?.id) ||
            (row.type === 'bank_account' && !!organization?.id === !!company?.id)) {
          throw new IcObjectError('missing_reference');
        }
        const target = await createCatalog(db, actor, row, resolve);
        await linkEntity(db, actor, channel.source, row.type, target.id, { refUuid: row.refUuid, refName: info.name }, { by: 'auto', rule: 'sync' });
        plan.targets.set(`${row.type}:${row.refUuid}`, target);
        return true;
      }
      const entityId = match.entityId;
      const [existing] = await db.select({ id: table.id }).from(table).where(eq(table.id, entityId)).for('update');
      if (!existing) throw new IcObjectError('unmatched');
      if (match.rule !== 'existing') {
        await linkEntity(db, actor, channel.source, row.type, entityId, { refUuid: row.refUuid, refName: info.name }, { by: 'auto', rule: match.rule });
      }
      if (row.type === 'contract' || row.type === 'bank_account' || row.type === 'cash_register') return match.rule !== 'existing';
      return prioritize({ ...info, entityId }, async () => {
        const updated = await updateCatalog(db, actor, entityId, row);
        if (updated) plan.targets.set(`${row.type}:${row.refUuid}`, { id: entityId, name: row.name, kind: row.kind, unitCode: row.unitCode });
        return updated;
      });
    });
  }

  const docLinks = await linksOf(db, workspaceId, channel.source, 'document');
  const byRef = new Map(docLinks.map(row => [row.refUuid, row.entityId]));
  const byId = new Set(docLinks.map(row => row.entityId));
  for (const row of parsed.documents) {
    const info = { type: 'document', refUuid: row.refUuid, name: row.number.slice(0, 500) };
    await apply(info, async () => {
      if (!row.refUuid) throw new IcObjectError('invalid_object');
      let entityId = byRef.get(row.refUuid);
      if (!entityId && row.number) {
        const organizationId = required(referenceId(resolve, 'organization', row.organizationRef));
        const type = row.serviceOnly ? 'act' : row.type;
        const candidates = await db.select({ id: documents.id }).from(documents)
          .where(and(eq(documents.organizationId, organizationId), eq(documents.date, row.date),
            eq(documents.number, row.number), eq(documents.type, type))).limit(2);
        if (candidates.length > 1 || (candidates[0] && byId.has(candidates[0].id))) throw new IcObjectError('unmatched');
        entityId = candidates[0]?.id;
      }
      const refUuid = row.refUuid;
      const link = async (id: string) => {
        if (byRef.has(refUuid)) return;
        await linkEntity(db, actor, channel.source, 'document', id, { refUuid, refName: info.name }, { by: 'auto', rule: 'sync' });

      };
      if (!entityId) {
        const id = await applyDocument(db, actor, resolve, row);
        await link(id);
        byRef.set(refUuid, id);
        byId.add(id);
        return true;
      }
      const [existing] = await db.select().from(documents).where(eq(documents.id, entityId)).for('update');
      if (!existing) throw new IcObjectError('unmatched');
      await link(existing.id);
      const accepted = await prioritize({ ...info, entityId }, async () => {
        await applyDocument(db, actor, resolve, row, existing);
        return true;
      });
      byRef.set(refUuid, existing.id);
      byId.add(existing.id);
      return accepted;
    });
  }

  for (const removal of parsed.removals ?? []) {
    const { type, refUuid, unposted } = removal;
    await apply({ type, refUuid }, async () => {
      if (type === 'document') {
        const entityId = byRef.get(refUuid);
        if (!entityId) return false;
        const [doc] = await db.select({ status: documents.status }).from(documents).where(eq(documents.id, entityId)).for('update');
        if (!doc) return false;
        return prioritize({ type, refUuid, entityId }, async () => {
          if (doc.status === 'posted') await unpostDocument(db, actor, entityId);
          if (!unposted && doc.status !== 'cancelled') await cancelDocument(db, actor, entityId);
          return true;
        });
      }
      if (type === 'bank_account' || type === 'contract' || type === 'cash_register') throw new IcObjectError('unsupported');
      const link = (await linksOf(db, workspaceId, channel.source, type)).find(row => row.refUuid === refUuid);
      if (!link) return false;
      const table = catalogs[type];
      await db.select({ id: table.id }).from(table).where(eq(table.id, link.entityId)).for('update');
      return prioritize({ type, refUuid, entityId: link.entityId }, async () => {
        if (type === 'warehouse') {
          const [balance] = await db.select({ id: stockBalances.productId }).from(stockBalances)
            .where(and(eq(stockBalances.warehouseId, link.entityId), sql`${stockBalances.qty} <> 0`)).limit(1);
          if (balance) throw new DomainError(422, 'warehouse_not_empty', 'The warehouse still has stock');
        }
        if (type === 'warehouse' || type === 'organization') {
          const scope = type === 'warehouse' ? warehouses : organizations;
          const [current] = await db.select({ isDefault: scope.isDefault }).from(scope).where(eq(scope.id, link.entityId));
          if (current?.isDefault) {
            const [other] = await db.select({ id: scope.id }).from(scope)
              .where(and(ne(scope.id, link.entityId), isNull(scope.archivedAt))).limit(1);
            if (other) throw new DomainError(422, 'default_required', 'Set another default before archiving');
          }
        }
        if (type === 'product') {
          const [variant] = await db.select({ id: products.id }).from(products).where(eq(products.parentProductId, link.entityId)).limit(1);
          if (variant) throw new DomainError(422, 'variants_exist', 'The product still has variants');
        }
        await db.update(table).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(table.id, link.entityId));
        await recordEvent(db, { workspaceId, type: `${type}.archived`, entity: type, recordId: link.entityId });
        return true;
      });
    });
  }
  return { issues, blockPending };
}
