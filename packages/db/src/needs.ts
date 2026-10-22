/* Сводная потребность по материалам заказов на производство: нужно, в резерве, размещено, доступно, к поступлению, дефицит.
   По потребности создаются черновики заказов поставщикам — по поставщику товара. */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { dec, fmt, type Dec } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { createDocument, type DocCtx } from './documents';
import { materialRows, supplierForProduct } from './materials';
import { companies, documents, products, productionHeaders, stockBalances, stockReservations, warehouses } from './schema';

/** Строка сводной потребности */
export interface NeedsRow {
  productId: string;
  productName: string;
  unitCode: string;
  /** Нужно (осталось обеспечить) */
  need: string;
  /** Зарезервировано под заказы */
  reserved: string;
  /** Размещено: заказано поставщикам и дочерними заказами */
  placed: string;
  /** Свободно на складах */
  free: string;
  /** К поступлению */
  incoming: string;
  /** Дефицит: что нужно заказать */
  deficit: string;
  /** Поставщик по умолчанию (по товару) */
  supplierId: string | null;
  supplierName: string | null;
  /** Заказы на производство, в которых нужен материал */
  orders: { orderId: string; number: string | null; need: string }[];
}

/** Сводная потребность по материалам проведённых незакрытых заказов на производство */
export async function productionNeeds(db: Db, _workspaceId: string, params: { productionOrderId?: string; productId?: string } = {}): Promise<NeedsRow[]> {
  const orders = await db
    .select({ doc: documents, header: productionHeaders })
    .from(documents)
    .leftJoin(productionHeaders, eq(productionHeaders.documentId, documents.id))
    .where(
      and(
        eq(documents.type, 'production_order'),
        eq(documents.status, 'posted'),
        sql`${documents.state} is distinct from 'done' and ${documents.state} is distinct from 'closed'`,
        params.productionOrderId ? eq(documents.id, params.productionOrderId) : undefined,
      ),
    )
    .orderBy(asc(documents.date));
  const byProduct = new Map<string, { need: Dec; reserved: Dec; placed: Dec; incoming: Dec; orders: { orderId: string; number: string | null; need: string }[] }>();
  for (const o of orders) {
    const rows = await materialRows(db, o.doc.id);
    for (const r of rows) {
      if (r.kind !== 'material') continue;
      if (params.productId && r.productId !== params.productId) continue;
      const cur = byProduct.get(r.productId) ?? { need: 0n, reserved: 0n, placed: 0n, incoming: 0n, orders: [] };
      cur.need += dec(r.required);
      cur.reserved += dec(r.reserved);
      cur.placed += dec(r.placed);
      // к поступлению — свободные заказы поставщикам по товару: одни и те же для всех заказов, не суммируются
      cur.incoming = dec(r.incoming);
      cur.orders.push({ orderId: o.doc.id, number: o.doc.number, need: r.required });
      byProduct.set(r.productId, cur);
    }
  }
  const productIds = [...byProduct.keys()];
  if (!productIds.length) return [];
  const prodRows = await db.select({ id: products.id, name: products.name, unitCode: products.unitCode, defaultSupplierId: products.defaultSupplierId }).from(products).where(inArray(products.id, productIds));
  const byProd = new Map(prodRows.map(p => [p.id, p]));
  const balances = await db.select({ productId: stockBalances.productId, qty: sql<string>`sum(${stockBalances.qty})` }).from(stockBalances).where(inArray(stockBalances.productId, productIds)).groupBy(stockBalances.productId);
  const hand = new Map(balances.map(b => [b.productId, dec(b.qty)]));
  const res = await db.select({ productId: stockReservations.productId, qty: sql<string>`sum(${stockReservations.qty})` }).from(stockReservations).where(inArray(stockReservations.productId, productIds)).groupBy(stockReservations.productId);
  const reserved = new Map(res.map(r => [r.productId, dec(r.qty)]));
  const out: NeedsRow[] = [];
  for (const [productId, v] of byProduct) {
    const p = byProd.get(productId);
    // свободно не бывает меньше нуля: перерезерв заказов покупателей не увеличивает дефицит материалов
    const rawFree = (hand.get(productId) ?? 0n) - (reserved.get(productId) ?? 0n);
    const free = rawFree > 0n ? rawFree : 0n;
    const deficit = v.need - v.reserved - v.placed - free;
    const supplierId = p?.defaultSupplierId ?? null;
    const [supplier] = supplierId ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, supplierId)).limit(1) : [];
    out.push({
      productId,
      productName: p?.name ?? '',
      unitCode: p?.unitCode ?? '796',
      need: fmt(v.need, 3),
      reserved: fmt(v.reserved, 3),
      placed: fmt(v.placed, 3),
      free: fmt(free, 3),
      incoming: fmt(v.incoming, 3),
      deficit: fmt(deficit > 0n ? deficit : 0n, 3),
      supplierId,
      supplierName: supplier?.name ?? null,
      orders: v.orders.map(o => ({ ...o, need: fmt(dec(o.need), 3) })),
    });
  }
  return out.sort((a, b) => Number(a.productName.localeCompare(b.productName)));
}

/** Заказы поставщикам по сводной потребности: черновики группируются по поставщику (поставщик товара по умолчанию,
    иначе поставщик последнего проведённого поступления). Строки без поставщика возвращаются отдельно — заказ по ним не создаётся */
export async function createNeedsSupplierOrders(
  db: Db,
  ctx: DocCtx,
  input: { lines: { productId: string; qty: string; supplierId?: string | null }[]; date?: string; comment?: string },
): Promise<{ orders: { id: string; supplierId: string; supplierName: string; lines: { productId: string; productName: string; qty: string }[] }[]; withoutSupplier: { productId: string; productName: string; qty: string }[] }> {
  const groups = new Map<string, { productId: string; productName: string; qty: string }[]>();
  const withoutSupplier: { productId: string; productName: string; qty: string }[] = [];
  for (const l of input.lines) {
    const [p] = await db.select({ id: products.id, name: products.name, purchasePrice: products.purchasePrice }).from(products).where(eq(products.id, l.productId)).limit(1);
    if (!p) throw new DomainError(422, 'invalid_reference', 'The product does not exist');
    let supplierId = l.supplierId ?? (await supplierForProduct(db, l.productId));
    if (supplierId) {
      const [supplier] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, supplierId)).limit(1);
      if (!supplier) throw new DomainError(422, 'invalid_reference', 'The supplier does not exist');
    }
    if (!supplierId) {
      withoutSupplier.push({ productId: l.productId, productName: p.name, qty: l.qty });
      continue;
    }
    groups.set(supplierId, [...(groups.get(supplierId) ?? []), { productId: l.productId, productName: p.name, qty: l.qty }]);
  }
  const [wh] = await db.select({ id: warehouses.id }).from(warehouses).where(sql`${warehouses.archivedAt} is null`).orderBy(sql`${warehouses.isDefault} desc`).limit(1);
  const orders: { id: string; supplierId: string; supplierName: string; lines: { productId: string; productName: string; qty: string }[] }[] = [];
  for (const [supplierId, lines] of groups) {
    const [supplier] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, supplierId)).limit(1);
    if (!supplier) {
      withoutSupplier.push(...lines.map(l => ({ productId: l.productId, productName: l.productName, qty: l.qty })));
      continue;
    }
    const prices = await db.select({ id: products.id, purchasePrice: products.purchasePrice }).from(products).where(inArray(products.id, lines.map(l => l.productId)));
    const price = new Map(prices.map(p => [p.id, p.purchasePrice]));
    const id = await createDocument(db, ctx, {
      type: 'supplier_order',
      counterpartyId: supplierId,
      warehouseId: wh?.id ?? undefined,
      date: input.date,
      comment: input.comment?.trim() ?? '',
      lines: lines.map(l => ({ productId: l.productId, qty: l.qty, price: price.get(l.productId) ?? '0', discountPct: '0' })),
    });
    orders.push({ id, supplierId, supplierName: supplier.name, lines });
  }
  return { orders, withoutSupplier };
}
