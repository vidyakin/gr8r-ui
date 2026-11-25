import { describe, expect, test } from 'bun:test';
import { isSupplierInvoiceType, parseSupplierPortalToken, supplierOrderResponsePatch, SUPPLIER_INVOICE_MAX_BYTES } from '../src';

const workspaceId = '018f1a2b-3c4d-7890-8abc-0123456789ab';
const secret = 'a'.repeat(43);

describe('supplier portal', () => {
  test('accepts only a UUID and a URL-safe 256-bit secret', () => {
    expect(parseSupplierPortalToken(`${workspaceId}.${secret}`)).toEqual({ workspaceId, secret });
    for (const token of [secret, `bad.${secret}`, `${workspaceId}.short`, `${workspaceId}.${secret}=`, `${workspaceId}.${secret}.other`]) {
      expect(parseSupplierPortalToken(token)).toBeNull();
    }
  });

  test('accepts all supplier statuses and rejects unknown statuses and empty patches', () => {
    for (const supplierStatus of ['pending', 'confirmed', 'shipped', 'declined']) {
      expect(supplierOrderResponsePatch.safeParse({ supplierStatus }).success).toBe(true);
    }
    for (const body of [{ supplierStatus: 'posted' }, {}, { status: 'posted' }]) {
      expect(supplierOrderResponsePatch.safeParse(body).success).toBe(false);
    }
  });

  test('accepts real ISO calendar dates and clearing a date', () => {
    for (const expectedShipDate of ['2028-02-29', '2026-11-25', null]) {
      expect(supplierOrderResponsePatch.safeParse({ expectedShipDate }).success).toBe(true);
    }
    for (const expectedShipDate of ['2026-02-29', '2026-13-01', '2026-11-31', '25.11.2026', '0000-01-01']) {
      expect(supplierOrderResponsePatch.safeParse({ expectedShipDate }).success).toBe(false);
    }
  });

  test('requires an allowed and matching extension and MIME', () => {
    expect(SUPPLIER_INVOICE_MAX_BYTES).toBe(15 * 1024 * 1024);
    expect(isSupplierInvoiceType('invoice.PDF', 'application/pdf')).toBe(true);
    expect(isSupplierInvoiceType('invoice.png', 'image/png')).toBe(true);
    expect(isSupplierInvoiceType('invoice.jpeg', 'image/jpeg')).toBe(true);
    expect(isSupplierInvoiceType('invoice.jpg', 'image/jpeg')).toBe(true);
    expect(isSupplierInvoiceType('invoice.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    expect(isSupplierInvoiceType('invoice.xlsx.exe', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(false);
    expect(isSupplierInvoiceType('invoice.pdf', 'image/png')).toBe(false);
    expect(isSupplierInvoiceType('invoice.svg', 'image/svg+xml')).toBe(false);
  });
});
