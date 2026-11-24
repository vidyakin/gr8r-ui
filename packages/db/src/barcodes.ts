/** Внутренние штрихкоды: docs/architecture/barcodes.md. */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { allocateEan13 } from '@erp/shared';
import type { Db } from './client';
import { products } from './schema';
import { recordEvent } from './events';

export async function generateProductBarcodes(db: Db, workspaceId: string, actorId: string, ids: string[]) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${workspaceId}, 1391))`);
  const rows = await db.select().from(products).where(and(eq(products.workspaceId, workspaceId), inArray(products.id, ids))).for('update');
  const existing = await db.select({ barcode: products.barcode }).from(products).where(eq(products.workspaceId, workspaceId));
  const used = new Set(existing.map(x => x.barcode));
  const result: { id: string; barcode: string }[] = [];
  for (const row of rows) {
    let barcode = row.barcode;
    if (!barcode) {
      barcode = allocateEan13(used, () => Number(BigInt.asUintN(64, BigInt('0x' + Array.from(crypto.getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join(''))) % 100_000_000_000n));
      await db.update(products).set({ barcode, updatedAt: new Date() }).where(and(eq(products.workspaceId, workspaceId), eq(products.id, row.id)));
      await recordEvent(db, { workspaceId, actorId, type: 'product.updated', entity: 'product', recordId: row.id, payload: { changes: ['barcode'] } });
    }
    result.push({ id: row.id, barcode });
  }
  return result;
}
