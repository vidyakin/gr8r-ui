/* Упаковки товара (docs/plans/2026-11-14-product-packages.md): единицы с коэффициентом пересчёта в базовую — «ящик = 100 шт».
   Базовая единица — products.unit_code; коэффициент строки документа фиксируется при вводе (document_lines.unit_factor).
   Вызывается под контекстом арендатора (RLS). */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { dec, fmt } from '@gr8r/shared';
import type { Db } from './client';
import type { Actor } from './attachments';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { products, productUnits, units } from './schema';

export type ProductUnitRow = typeof productUnits.$inferSelect;

export interface ProductUnitInput {
  unitCode: string;
  factor: string;
}

/** Нормализованный коэффициент: до 6 знаков, строго больше нуля */
export function normFactor(v: string | number): string | null {
  const d = dec(v);
  return d > 0n ? fmt(d, 6) : null;
}

/** Упаковки товаров пачкой: productId → [{ unitCode, factor }] */
export async function productUnitsOf(db: Db, productIds: string[]): Promise<Map<string, { unitCode: string; factor: string }[]>> {
  const out = new Map<string, { unitCode: string; factor: string }[]>();
  const ids = [...new Set(productIds)];
  for (let i = 0; i < ids.length; i += 5000) {
    const rows = await db
      .select({ productId: productUnits.productId, unitCode: productUnits.unitCode, factor: productUnits.factor })
      .from(productUnits)
      .where(inArray(productUnits.productId, ids.slice(i, i + 5000)))
      .orderBy(asc(productUnits.factor));
    for (const r of rows) out.set(r.productId, [...(out.get(r.productId) ?? []), { unitCode: r.unitCode, factor: r.factor }]);
  }
  return out;
}

export async function listProductUnits(db: Db, workspaceId: string, productId: string): Promise<ProductUnitRow[]> {
  return db
    .select()
    .from(productUnits)
    .where(and(eq(productUnits.workspaceId, workspaceId), eq(productUnits.productId, productId)))
    .orderBy(asc(productUnits.factor));
}

/** Список упаковок товара заменяется целиком. Базовая единица и повтор единицы — 422; коэффициент > 0.
    Документы хранят свой коэффициент, поэтому правка упаковки прежние строки не меняет */
export async function saveProductUnits(db: Db, actor: Actor, productId: string, items: ProductUnitInput[]): Promise<ProductUnitRow[]> {
  const ws = actor.workspaceId;
  const [p] = await db.select({ id: products.id, unitCode: products.unitCode }).from(products).where(and(eq(products.workspaceId, ws), eq(products.id, productId)));
  if (!p) throw new DomainError(404, 'not_found', 'product not found');
  const seen = new Set<string>();
  const rows: { unitCode: string; factor: string }[] = [];
  for (const i of items) {
    const factor = normFactor(i.factor);
    if (!factor) throw new DomainError(422, 'product_unit_invalid', 'The unit factor must be greater than zero');
    if (i.unitCode === p.unitCode) throw new DomainError(422, 'product_unit_base', 'The base unit of the product cannot be a package');
    if (seen.has(i.unitCode)) throw new DomainError(422, 'product_unit_duplicate', 'Each unit can be added to the product only once');
    seen.add(i.unitCode);
    rows.push({ unitCode: i.unitCode, factor });
  }
  if (rows.length) {
    const known = new Set((await db.select({ code: units.code }).from(units).where(and(eq(units.workspaceId, ws), inArray(units.code, rows.map(r => r.unitCode))))).map(u => u.code));
    if (rows.some(r => !known.has(r.unitCode))) throw new DomainError(422, 'invalid_reference', 'The unit does not exist');
  }
  await db.delete(productUnits).where(and(eq(productUnits.workspaceId, ws), eq(productUnits.productId, productId)));
  if (rows.length) await db.insert(productUnits).values(rows.map(r => ({ workspaceId: ws, productId, ...r })));
  await recordEvent(db, { workspaceId: ws, type: 'product.updated', entity: 'product', recordId: productId, actorId: actor.memberId, payload: { units: rows } });
  return listProductUnits(db, ws, productId);
}

/** Заводит упаковки, которых у товаров ещё нет (загрузка прайса): существующие не меняются */
export async function ensureProductUnits(db: Db, workspaceId: string, items: { productId: string; unitCode: string; factor: string }[]): Promise<void> {
  const uniq = new Map<string, { productId: string; unitCode: string; factor: string }>();
  for (const i of items) uniq.set(`${i.productId}|${i.unitCode}`, i);
  const rows = [...uniq.values()];
  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insert(productUnits)
      .values(rows.slice(i, i + 1000).map(r => ({ workspaceId, ...r })))
      .onConflictDoNothing({ target: [productUnits.workspaceId, productUnits.productId, productUnits.unitCode] });
  }
}
