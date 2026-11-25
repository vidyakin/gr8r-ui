/* Кабинет поставщика. Публичные операции выполняются в контексте арендатора и с companyId из проверенной ссылки. */
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { isSupplierInvoiceType, SUPPLIER_INVOICE_MAX_BYTES, unitQtyOf, type SupplierOrderResponsePatch } from '@erp/shared';
import { createSupplierInvoiceAttachment, type UploadInput } from './attachments';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { getFileStore } from './file-store';
import { attachments, attachmentVersions, companies, documentLines, documents, organizations, supplierPortalLinks, units } from './schema';

const notFound = () => new DomainError(404, 'not_found', 'Not found');
const newSecret = () => randomBytes(32).toString('base64url');

const companyScope = (workspaceId: string, companyId: string) =>
  and(eq(companies.workspaceId, workspaceId), eq(companies.id, companyId), eq(companies.isSupplier, true), isNull(companies.archivedAt));

const linkScope = (workspaceId: string, companyId: string) =>
  and(eq(supplierPortalLinks.workspaceId, workspaceId), eq(supplierPortalLinks.companyId, companyId));

function linkView(row: typeof supplierPortalLinks.$inferSelect) {
  return {
    token: `${row.workspaceId}.${row.secret}`,
    enabled: row.enabled,
    expiresAt: row.expiresAt,
    lastAccessedAt: row.lastAccessedAt,
  };
}

async function assertCompany(db: Db, workspaceId: string, companyId: string) {
  const [company] = await db.select({ id: companies.id }).from(companies).where(companyScope(workspaceId, companyId));
  if (!company) throw notFound();
}

export async function getSupplierPortalLink(db: Db, workspaceId: string, companyId: string) {
  await assertCompany(db, workspaceId, companyId);
  const [row] = await db.select().from(supplierPortalLinks).where(linkScope(workspaceId, companyId));
  return row ? linkView(row) : null;
}

export async function getOrCreateSupplierPortalLink(db: Db, workspaceId: string, companyId: string, actorId?: string) {
  await assertCompany(db, workspaceId, companyId);
  const [row] = await db.insert(supplierPortalLinks).values({ workspaceId, companyId, secret: newSecret() })
    .onConflictDoUpdate({
      target: [supplierPortalLinks.workspaceId, supplierPortalLinks.companyId],
      set: { enabled: true, updatedAt: new Date() },
    }).returning();
  await recordEvent(db, { workspaceId, type: 'supplier_portal_link.enabled', entity: 'supplier_portal_link', recordId: row!.id, actorId, payload: { companyId, enabled: row!.enabled } });
  return linkView(row!);
}

export async function rotateSupplierPortalLink(db: Db, workspaceId: string, companyId: string, actorId?: string) {
  await assertCompany(db, workspaceId, companyId);
  const [row] = await db.update(supplierPortalLinks)
    .set({ secret: newSecret(), expiresAt: null, lastAccessedAt: null, updatedAt: new Date() })
    .where(linkScope(workspaceId, companyId)).returning();
  if (!row) throw notFound();
  await recordEvent(db, { workspaceId, type: 'supplier_portal_link.rotated', entity: 'supplier_portal_link', recordId: row.id, actorId, payload: { companyId, enabled: row.enabled } });
  return linkView(row);
}

export async function toggleSupplierPortalLink(db: Db, workspaceId: string, companyId: string, enabled: boolean, actorId?: string) {
  await assertCompany(db, workspaceId, companyId);
  const [row] = await db.update(supplierPortalLinks).set({ enabled, updatedAt: new Date() })
    .where(linkScope(workspaceId, companyId)).returning();
  if (!row) throw notFound();
  await recordEvent(db, { workspaceId, type: 'supplier_portal_link.toggled', entity: 'supplier_portal_link', recordId: row.id, actorId, payload: { companyId, enabled: row.enabled } });
  return linkView(row);
}

export async function resolveSupplierPortalLink(db: Db, workspaceId: string, secret: string, touch = false) {
  const condition = and(
    eq(supplierPortalLinks.workspaceId, workspaceId),
    eq(supplierPortalLinks.secret, secret),
    eq(supplierPortalLinks.enabled, true),
    or(isNull(supplierPortalLinks.expiresAt), gt(supplierPortalLinks.expiresAt, sql`now()`)),
  );
  const [link] = await (touch
    ? db.update(supplierPortalLinks).set({ lastAccessedAt: sql`now()` }).where(condition)
      .returning({ id: supplierPortalLinks.id, companyId: supplierPortalLinks.companyId })
    : db.select({ id: supplierPortalLinks.id, companyId: supplierPortalLinks.companyId }).from(supplierPortalLinks).where(condition));
  if (!link) throw notFound();
  const [company] = await db.select({ name: companies.name }).from(companies).where(companyScope(workspaceId, link.companyId));
  if (!company) throw notFound();
  return { ...link, supplierName: company.name };
}

const orderScope = (workspaceId: string, companyId: string) =>
  and(eq(documents.workspaceId, workspaceId), eq(documents.counterpartyId, companyId), eq(documents.type, 'supplier_order'), eq(documents.status, 'posted'));

const responseColumns = {
  supplierStatus: documents.supplierStatus,
  expectedShipDate: documents.expectedShipDate,
  supplierComment: documents.supplierComment,
};

function supplierInvoiceQuery(db: Db) {
  // Показываем исходный счёт, даже если менеджер позднее добавил внутреннюю версию.
  return db.select({
    id: attachments.id, orderId: attachments.entityId, name: attachments.name,
    sizeBytes: attachmentVersions.sizeBytes, mime: attachmentVersions.mime, storageKey: attachmentVersions.storageKey,
  }).from(attachments)
    .innerJoin(attachmentVersions, and(
      eq(attachmentVersions.workspaceId, attachments.workspaceId),
      eq(attachmentVersions.attachmentId, attachments.id),
      eq(attachmentVersions.version, 1),
    ));
}

const invoiceScope = (workspaceId: string, companyId: string) => and(
  eq(attachments.workspaceId, workspaceId), eq(attachments.supplierPortalCompanyId, companyId),
  eq(attachments.entityType, 'document'), isNull(attachments.archivedAt), isNotNull(attachmentVersions.storageKey),
);

function groupByOrder<T extends { orderId: string }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.orderId);
    if (group) group.push(item);
    else groups.set(item.orderId, [item]);
  }
  return groups;
}

export async function listSupplierPortalOrders(db: Db, workspaceId: string, companyId: string) {
  const scope = orderScope(workspaceId, companyId);
  const orders = await db.select({
    id: documents.id, number: documents.number, date: documents.date, status: documents.status,
    currency: documents.currency, total: documents.total, vatTotal: documents.vatTotal, comment: documents.comment,
    organizationName: organizations.name, ...responseColumns,
  }).from(documents).innerJoin(organizations, and(
    eq(organizations.workspaceId, documents.workspaceId), eq(organizations.id, documents.organizationId),
  )).where(scope).orderBy(desc(documents.date), desc(documents.id));
  if (!orders.length) return [];

  const lines = await db.select({
    id: documentLines.id, orderId: documentLines.documentId, name: documentLines.name,
    qty: documentLines.qty, unitFactor: documentLines.unitFactor, unit: sql<string>`coalesce(${units.symbol}, ${documentLines.unitCode})`,
    price: documentLines.price, total: documentLines.total,
  }).from(documentLines)
    .innerJoin(documents, and(eq(documents.workspaceId, documentLines.workspaceId), eq(documents.id, documentLines.documentId)))
    .leftJoin(units, and(eq(units.workspaceId, documentLines.workspaceId), eq(units.code, documentLines.unitCode)))
    .where(scope).orderBy(asc(documentLines.sortOrder), asc(documentLines.id));
  const invoices = await supplierInvoiceQuery(db)
    .innerJoin(documents, and(eq(documents.workspaceId, attachments.workspaceId), eq(documents.id, attachments.entityId)))
    .where(and(scope, invoiceScope(workspaceId, companyId))).orderBy(asc(attachments.createdAt), asc(attachments.id));

  const linesByOrder = groupByOrder(lines);
  const invoicesByOrder = groupByOrder(invoices);
  return orders.map(order => ({
    ...order,
    lines: (linesByOrder.get(order.id) ?? []).map(({ id, name, qty, unitFactor, unit, price, total }) => ({ id, name, qty: unitQtyOf(qty, unitFactor), unit, price, total })),
    invoices: (invoicesByOrder.get(order.id) ?? []).map(({ id, name, sizeBytes, mime }) => ({ id, name, sizeBytes, mime })),
  }));
}

async function lockOrder(db: Db, workspaceId: string, companyId: string, orderId: string) {
  const [order] = await db.select({ ...responseColumns, supplierConfirmedAt: documents.supplierConfirmedAt, responsibleId: documents.responsibleId })
    .from(documents).where(and(orderScope(workspaceId, companyId), eq(documents.id, orderId))).for('update');
  if (!order) throw notFound();
  return order;
}

export async function updateSupplierOrderResponse(db: Db, workspaceId: string, companyId: string, orderId: string, patch: SupplierOrderResponsePatch) {
  const current = await lockOrder(db, workspaceId, companyId, orderId);
  const supplierStatus = patch.supplierStatus ?? current.supplierStatus;
  const expectedShipDate = patch.expectedShipDate === undefined ? current.expectedShipDate : patch.expectedShipDate;
  const supplierComment = patch.supplierComment ?? current.supplierComment;
  const response = { supplierStatus, expectedShipDate, supplierComment };
  if (supplierStatus === current.supplierStatus && expectedShipDate === current.expectedShipDate && supplierComment === current.supplierComment) return response;

  const confirmed = supplierStatus === 'confirmed' || supplierStatus === 'shipped';
  const now = new Date();
  await db.update(documents).set({
    ...response, supplierConfirmedAt: confirmed ? current.supplierConfirmedAt ?? now : null, updatedAt: now,
  }).where(and(orderScope(workspaceId, companyId), eq(documents.id, orderId)));
  await recordEvent(db, {
    workspaceId, type: 'document.supplier_response_updated', entity: 'document', recordId: orderId,
    payload: { companyId, responsibleId: current.responsibleId, ...response },
  });
  return response;
}

const signatures: Record<string, readonly number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [0x50, 0x4b, 0x03, 0x04],
};

export async function uploadSupplierInvoice(db: Db, workspaceId: string, companyId: string, orderId: string, input: UploadInput) {
  const { responsibleId } = await lockOrder(db, workspaceId, companyId, orderId);
  if (input.data.length > SUPPLIER_INVOICE_MAX_BYTES) {
    throw new DomainError(413, 'attachment_too_large', 'Invoice must be 15 MB or smaller', { maxBytes: SUPPLIER_INVOICE_MAX_BYTES });
  }
  const mime = input.mime ?? '';
  if (!isSupplierInvoiceType(input.name, mime) || !signatures[mime]?.every((byte, i) => input.data[i] === byte)) {
    throw new DomainError(422, 'supplier_invoice_type', 'Choose a PDF, PNG, JPG or XLSX invoice');
  }
  const { attachment, version } = await createSupplierInvoiceAttachment(db, workspaceId, companyId, orderId, input);
  await recordEvent(db, {
    workspaceId, type: 'document.supplier_invoice_uploaded', entity: 'document', recordId: orderId,
    payload: { companyId, responsibleId, attachmentId: attachment.id },
  });
  return { id: attachment.id, name: attachment.name, mime: version.mime, sizeBytes: version.sizeBytes };
}

export async function readSupplierInvoice(db: Db, workspaceId: string, companyId: string, orderId: string, attachmentId: string) {
  const [file] = await supplierInvoiceQuery(db)
    .innerJoin(documents, and(eq(documents.workspaceId, attachments.workspaceId), eq(documents.id, attachments.entityId)))
    .where(and(orderScope(workspaceId, companyId), invoiceScope(workspaceId, companyId), eq(attachments.entityId, orderId), eq(attachments.id, attachmentId)));
  if (!file?.storageKey) throw notFound();
  const store = getFileStore();
  if (!store) throw new DomainError(503, 'storage_unavailable', 'File storage is not configured');
  const data = await store.get(file.storageKey);
  if (!data) throw notFound();
  return { name: file.name, mime: file.mime || 'application/octet-stream', data };
}
