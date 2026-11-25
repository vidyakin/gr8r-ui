import { z } from 'zod';

const workspaceIdSchema = z.uuid();
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

export function parseSupplierPortalToken(token: string) {
  if (token.length !== 80 || token[36] !== '.') return null;
  const workspaceId = workspaceIdSchema.safeParse(token.slice(0, 36));
  const secret = token.slice(37);
  return workspaceId.success && secretPattern.test(secret) ? { workspaceId: workspaceId.data.toLowerCase(), secret } : null;
}

export const SUPPLIER_ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'declined'] as const;
export type SupplierOrderStatus = (typeof SUPPLIER_ORDER_STATUSES)[number];

export const supplierOrderResponsePatch = z.strictObject({
  supplierStatus: z.enum(SUPPLIER_ORDER_STATUSES).optional(),
  expectedShipDate: z.iso.date().refine(date => !date.startsWith('0000-')).nullable().optional(),
  supplierComment: z.string().trim().max(4000).optional(),
}).refine(patch => Object.values(patch).some(value => value !== undefined));

export type SupplierOrderResponsePatch = z.infer<typeof supplierOrderResponsePatch>;

export const supplierPortalLinkToggle = z.strictObject({ enabled: z.boolean() });

export const SUPPLIER_INVOICE_MAX_BYTES = 15 * 1024 * 1024;
const invoiceMimeByExtension = new Map([
  ['pdf', 'application/pdf'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);
export const SUPPLIER_INVOICE_ACCEPT = [...invoiceMimeByExtension.keys()].map(ext => `.${ext}`).join(',');

export function isSupplierInvoiceType(name: string, mime: string): boolean {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  return !!ext && invoiceMimeByExtension.get(ext) === mime;
}
