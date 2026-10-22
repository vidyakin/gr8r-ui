/* Параметрические спецификации: параметры изделия и выбор спецификации для товара.

   У спецификации (`manufactured_items.params`) свой список параметров — те же описания полей, что у характеристик
   категории. К ним добавляются характеристики категории товара спецификации (с унаследованными): ключи не должны
   пересекаться. В формулах количества и условия строки доступны и параметры, и характеристики.

   Спецификация для товара выбирается так: своя спецификация варианта (`manufactured_items.product_id` = вариант),
   иначе спецификация по умолчанию родителя (`product_manufacturing.default_item_id`). Недействительные
   спецификации (`is_invalid`) в новых документах не предлагаются и по умолчанию не выбираются. */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { buildRecordSchema, paramFields, paramKeyClash, type FieldDef, type FieldType, type SpecParamDef } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { attributeDefs, manufacturedItems, productCategories, productManufacturing, products } from './schema';

export interface SpecParams {
  /** Собственные параметры спецификации */
  params: SpecParamDef[];
  /** Ключи, доступные в формулах: параметры спецификации и характеристики категории товара */
  keys: string[];
  /** Ключи характеристик категории товара (с унаследованными) */
  attrKeys: string[];
}

/** Характеристики категории товара с наследованием: описания полей (от корня к категории товара) */
export async function loadCategoryAttributeDefs(db: Db, productIds: string[]): Promise<Map<string, FieldDef[]>> {
  const out = new Map<string, FieldDef[]>();
  if (!productIds.length) return out;
  const rows = await db
    .select({ productId: products.id, categoryId: products.categoryId, path: productCategories.path })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(inArray(products.id, productIds));
  const defs = await db.select().from(attributeDefs).orderBy(asc(attributeDefs.sortOrder), asc(attributeDefs.createdAt));
  const byCategory = new Map<string, FieldDef[]>();
  for (const d of defs) byCategory.set(d.categoryId, [...(byCategory.get(d.categoryId) ?? []), { key: d.key, name: d.name, type: d.type as FieldType, required: d.required, options: d.options }]);
  for (const r of rows) {
    // путь категории: идентификаторы предков от корня к категории — характеристики наследуются от всех предков
    const fields: FieldDef[] = [];
    if (r.categoryId && r.path) for (const id of r.path.split('/')) for (const f of byCategory.get(id) ?? []) if (!fields.some(x => x.key === f.key)) fields.push(f);
    out.set(r.productId, fields);
  }
  return out;
}

/** Ключи характеристик категории товара (с унаследованными) */
export async function loadCategoryAttributeKeys(db: Db, productIds: string[]): Promise<Map<string, string[]>> {
  const defs = await loadCategoryAttributeDefs(db, productIds);
  return new Map([...defs].map(([id, fields]) => [id, fields.map(f => f.key)]));
}

/** Описания значений параметров изделия: параметры спецификации + характеристики категории её товара */
export async function specParamFields(db: Db, itemId: string): Promise<FieldDef[]> {
  const [item] = await db.select({ params: manufacturedItems.params, productId: manufacturedItems.productId }).from(manufacturedItems).where(eq(manufacturedItems.id, itemId)).limit(1);
  if (!item) return [];
  const attrs = item.productId ? ((await loadCategoryAttributeDefs(db, [item.productId])).get(item.productId) ?? []) : [];
  return [...paramFields((item.params ?? []) as SpecParamDef[]), ...attrs];
}

/** Проверка значений параметров строки заказа (тем же buildRecordSchema, что поля конструктора): тип, варианты select,
    лишние ключи. Обязательность не проверяется здесь — незаполненный параметр формулы даёт ошибку при расчёте состава */
export function checkParamValues(fields: FieldDef[], values: Record<string, unknown>): Record<string, unknown> {
  const parsed = buildRecordSchema(fields, 'patch').safeParse(values);
  if (parsed.success) return Object.fromEntries(Object.entries(parsed.data as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined));
  const i = parsed.error.issues[0]!;
  const key = i.code === 'unrecognized_keys' ? (i.keys[0] ?? '') : String(i.path[0] ?? '');
  const message = i.code === 'unrecognized_keys' ? `“${key}” is not a parameter of this product` : `${fields.find(f => f.key === key)?.name ?? key}: ${i.message}`;
  throw new DomainError(422, 'invalid_params', message);
}

/** Параметры всех спецификаций воркспейса: ключи формул и собственные параметры */
export async function loadSpecParams(db: Db, workspaceId?: string): Promise<Map<string, SpecParams>> {
  const items = workspaceId ? await db.select().from(manufacturedItems).where(eq(manufacturedItems.workspaceId, workspaceId)) : await db.select().from(manufacturedItems);
  const prodIds = [...new Set(items.map(i => i.productId).filter((x): x is string => !!x))];
  const attrKeys = await loadCategoryAttributeKeys(db, prodIds);
  const out = new Map<string, SpecParams>();
  for (const i of items) {
    const params = (i.params ?? []) as SpecParamDef[];
    const akeys = i.productId ? (attrKeys.get(i.productId) ?? []) : [];
    out.set(i.id, { params, attrKeys: akeys, keys: [...params.map(p => p.key), ...akeys] });
  }
  return out;
}

/** Ключ параметра спецификации пересекается с характеристикой категории — такое сочетание запрещено */
export function specParamClash(params: SpecParamDef[], attrKeys: string[]): string | null {
  return paramKeyClash(params, attrKeys.map(key => ({ key, name: key, type: 'text', required: false, options: {} })));
}

/** Спецификация товара: своя (вариант) или по умолчанию (родителя) */
export interface SpecChoice {
  /** Спецификация */
  itemId: string;
  /** Товар, для которого спецификация выбрана */
  productId: string;
  /** Корень товара: у варианта — его родитель */
  rootProductId: string;
  /** Спецификация по умолчанию родителя (для варианта) */
  inherited: boolean;
}

/**
 * Спецификация для товара. У варианта — своя спецификация варианта, иначе спецификация по умолчанию родителя.
 * У обычного товара — спецификация по умолчанию (`product_manufacturing.default_item_id`), а без неё — самая ранняя
 * своя (`manufactured_items.product_id`). Недействительные и архивные спецификации пропускаются. null — выпускать нечего.
 */
export async function resolveSpecForProduct(db: Db, workspaceId: string, productId: string): Promise<SpecChoice | null> {
  // корень товара: у варианта — его родитель (способ пополнения и спецификация по умолчанию — у родителя)
  const [row] = await db.select({ parentProductId: products.parentProductId }).from(products).where(eq(products.id, productId)).limit(1);
  const rootId = row?.parentProductId ?? productId;
  const isVariant = rootId !== productId;
  const ownOf = async (pid: string) =>
    (
      await db
        .select({ id: manufacturedItems.id })
        .from(manufacturedItems)
        .where(and(eq(manufacturedItems.workspaceId, workspaceId), eq(manufacturedItems.productId, pid), isNull(manufacturedItems.archivedAt), eq(manufacturedItems.isInvalid, false)))
        .orderBy(asc(manufacturedItems.createdAt))
        .limit(1)
    )[0];
  if (isVariant) {
    const own = await ownOf(productId);
    if (own) return { itemId: own.id, productId, rootProductId: rootId, inherited: false };
  }
  const [setting] = await db.select({ defaultItemId: productManufacturing.defaultItemId }).from(productManufacturing).where(eq(productManufacturing.productId, rootId)).limit(1);
  if (setting?.defaultItemId) {
    const [spec] = await db
      .select({ id: manufacturedItems.id })
      .from(manufacturedItems)
      .where(and(eq(manufacturedItems.workspaceId, workspaceId), eq(manufacturedItems.id, setting.defaultItemId), isNull(manufacturedItems.archivedAt), eq(manufacturedItems.isInvalid, false)))
      .limit(1);
    if (spec) return { itemId: spec.id, productId: rootId, rootProductId: rootId, inherited: isVariant };
  }
  if (isVariant) return null;
  const own = await ownOf(productId);
  return own ? { itemId: own.id, productId, rootProductId: rootId, inherited: false } : null;
}
