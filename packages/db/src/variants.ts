/* Варианты товара: комбинации значений параметров спецификации с флажком «разрез склада».

   Вариант — обычная складская позиция каталога: своя строка `products` с `parent_product_id` и `variant_values`.
   Склад, резервы, цены и документы работают по `products.id` и ничего не меняют. Создаётся лениво при первом заказе
   комбинации или заранее генератором «создать все комбинации». Уникальность — (родитель, набор значений). */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { VARIANT_MAX_COMBINATIONS, variantCombinations, variantName, variantSku, variantValuesOf, type SpecParamDef } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { manufacturedItems, products } from './schema';
import { resolveSpecForProduct } from './specs';

export type ProductRow = typeof products.$inferSelect;

/** Набор вариантов товара (по родителю) */
export async function listVariants(db: Db, parentId: string): Promise<ProductRow[]> {
  return db.select().from(products).where(and(eq(products.parentProductId, parentId), isNull(products.archivedAt))).orderBy(asc(products.name));
}

/** Вариант по набору значений: null — такого ещё нет */
export async function findVariant(db: Db, parentId: string, values: Record<string, string>): Promise<ProductRow | null> {
  const rows = await db.select().from(products).where(and(eq(products.parentProductId, parentId), eq(products.variantValues, values)));
  return rows[0] ?? null;
}

/** Товар — вариант (у него есть родитель) */
export async function isVariant(db: Db, productId: string): Promise<boolean> {
  const [row] = await db.select({ parentProductId: products.parentProductId }).from(products).where(eq(products.id, productId)).limit(1);
  return !!row?.parentProductId;
}

/**
 * Вариант комбинации: существующий или новый. Гонка двух одновременных созданий одной комбинации
 * не создаёт двух строк: уникальный индекс (родитель, значения) и ON CONFLICT DO NOTHING.
 */
export async function ensureVariant(db: Db, workspaceId: string, parent: ProductRow, params: SpecParamDef[], values: Record<string, unknown> | null | undefined): Promise<ProductRow | null> {
  const vv = variantValuesOf(params, values);
  if (!Object.keys(vv).length) return null;
  const existing = await findVariant(db, parent.id, vv);
  if (existing) return existing;
  const name = variantName(parent.name, params, vv);
  // артикул варианта занят другим товаром — вариант без артикула (уникальность артикула не должна терять вариант)
  let sku = variantSku(parent.sku, vv);
  if (sku) {
    const [taken] = await db.select({ id: products.id }).from(products).where(and(eq(products.workspaceId, workspaceId), sql`lower(${products.sku}) = lower(${sku})`)).limit(1);
    if (taken) sku = '';
  }
  const inserted = await db
    .insert(products)
    .values({
      workspaceId,
      name,
      sku,
      kind: parent.kind,
      categoryId: parent.categoryId,
      unitCode: parent.unitCode,
      price: parent.price,
      purchasePrice: parent.purchasePrice,
      vatRate: parent.vatRate,
      barcode: '',
      parentProductId: parent.id,
      variantValues: vv,
    })
    // конфликт только по комбинации (родитель, значения): прочие нарушения уникальности — ошибка, а не «тихо без варианта»
    .onConflictDoNothing({ target: [products.workspaceId, products.parentProductId, products.variantValues], where: sql`${products.parentProductId} is not null` })
    .returning();
  if (inserted[0]) return inserted[0];
  // комбинацию создал другой запрос — берём его строку
  return findVariant(db, parent.id, vv);
}

/** Параметры спецификации товара — той, по которой он выпускается (resolveSpecForProduct): по ним проверяются значения
    строки заказа и строятся варианты */
export async function specParamsOfProduct(db: Db, workspaceId: string, productId: string): Promise<SpecParamDef[]> {
  const choice = await resolveSpecForProduct(db, workspaceId, productId);
  if (!choice) return [];
  const [spec] = await db.select({ params: manufacturedItems.params }).from(manufacturedItems).where(eq(manufacturedItems.id, choice.itemId)).limit(1);
  return (spec?.params ?? []) as SpecParamDef[];
}

/**
 * Генератор «создать все комбинации»: по select-параметрам с флажком «разрез склада».
 * Больше VARIANT_MAX_COMBINATIONS комбинаций — 422.
 */
export async function generateVariants(db: Db, workspaceId: string, parent: ProductRow, params: SpecParamDef[]): Promise<{ created: number; total: number }> {
  const combos = variantCombinations(params);
  if (combos === null) throw new DomainError(422, 'too_many_combinations', `There are more than ${VARIANT_MAX_COMBINATIONS} combinations: narrow the list of parameters`);
  let created = 0;
  for (const combo of combos) {
    const before = await findVariant(db, parent.id, combo);
    const row = await ensureVariant(db, workspaceId, parent, params, combo);
    if (row && !before) created++;
  }
  return { created, total: combos.length };
}

/** Товары с вариантами: родители (для вложенного показания в каталоге) */
export async function parentsWithVariants(db: Db, workspaceId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ id: products.parentProductId }).from(products).where(and(eq(products.workspaceId, workspaceId), isNull(products.archivedAt)));
  return rows.map(r => r.id).filter((x): x is string => !!x);
}
