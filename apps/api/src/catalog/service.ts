/* Каталог: характеристики категорий с наследованием и проверка attrs товара. Тот же механизм, что у полей конструктора:
   характеристики превращаются в описания полей, а значения проверяет buildRecordSchema (packages/shared/src/fields.ts). */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { attributeDefs, productCategories, units } from '@gr8r/db';
import { buildRecordSchema, type FieldDef, type FieldType, type RecordData, type RecordMode } from '@gr8r/shared';
import type { Ctx } from '../crud';
import { AppError, notFound } from '../errors';

export type CategoryRow = typeof productCategories.$inferSelect;
export type AttributeRow = typeof attributeDefs.$inferSelect;

export async function loadCategory(ctx: Ctx, id: string): Promise<CategoryRow> {
  const [row] = await ctx.db.select().from(productCategories).where(eq(productCategories.id, id)).limit(1);
  if (!row) throw notFound('category');
  return row;
}

/** Id категорий от корня до самой категории (из материализованного пути) */
export const chainIds = (c: Pick<CategoryRow, 'path'>) => c.path.split('/');

/** Условие «категория или любая из её потомков» */
export const subtreeWhere = (path: string) => sql`(${productCategories.path} = ${path} or ${productCategories.path} like ${path + '/%'})`;

export interface EffectiveAttribute extends AttributeRow {
  /** Характеристика унаследована от предка */
  inherited: boolean;
  categoryName: string;
}

/** Действующие характеристики категории: от корня к самой категории, внутри уровня — по порядку */
export async function effectiveAttributes(ctx: Ctx, category: CategoryRow): Promise<EffectiveAttribute[]> {
  const ids = chainIds(category);
  const cats = await ctx.db.select({ id: productCategories.id, name: productCategories.name }).from(productCategories).where(inArray(productCategories.id, ids));
  const name = new Map(cats.map(c => [c.id, c.name]));
  const rows = await ctx.db.select().from(attributeDefs).where(inArray(attributeDefs.categoryId, ids)).orderBy(asc(attributeDefs.sortOrder), asc(attributeDefs.createdAt));
  const depth = (id: string) => ids.indexOf(id);
  return rows
    .map(r => ({ ...r, inherited: r.categoryId !== category.id, categoryName: name.get(r.categoryId) ?? '' }))
    .sort((a, b) => depth(a.categoryId) - depth(b.categoryId) || a.sortOrder - b.sortOrder);
}

export const attributeDef = (a: AttributeRow): FieldDef => ({ key: a.key, name: a.name, type: a.type as FieldType, required: a.required, options: a.options });

/** Ошибка проверки в формате API: путь начинается с attrs */
function attrsError(issues: { path: PropertyKey[]; message: string }[]): AppError {
  const list = issues.map(i => ({ path: ['attrs', ...i.path.slice(0, 1).map(String)].join('.'), message: i.message }));
  return new AppError(400, 'validation_error', list[0] ? `${list[0].path}: ${list[0].message}` : 'Invalid attributes', { issues: list });
}

/** Проверка значений характеристик по схеме категории. Без категории характеристик нет: любые значения отклоняются */
export function validateAttrs(defs: AttributeRow[], input: unknown, mode: RecordMode): RecordData {
  const parsed = buildRecordSchema(defs.map(attributeDef), mode).safeParse(input ?? {});
  if (parsed.success) return parsed.data as RecordData;
  const issues = parsed.error.issues.flatMap(i => (i.code === 'unrecognized_keys' ? i.keys.map(k => ({ path: [k] as PropertyKey[], message: 'Not a characteristic of this category' })) : [{ path: i.path, message: i.message }]));
  throw attrsError(issues);
}

/** Единица должна существовать в справочнике воркспейса */
export async function assertUnit(ctx: Ctx, code: string) {
  const [u] = await ctx.db.select({ code: units.code }).from(units).where(eq(units.code, code)).limit(1);
  if (!u) throw new AppError(422, 'invalid_reference', `Unknown unit code "${code}"`, { issues: [{ path: 'unitCode', message: 'Unknown unit' }] });
}

/** Ключ характеристики не должен повторяться у предков, самой категории и её потомков */
export async function assertAttributeKeyFree(ctx: Ctx, category: CategoryRow, key: string, exceptId?: string) {
  const rows = await ctx.db
    .select({ id: attributeDefs.id, categoryName: productCategories.name })
    .from(attributeDefs)
    .innerJoin(productCategories, eq(productCategories.id, attributeDefs.categoryId))
    .where(and(eq(attributeDefs.key, key), sql`(${inArray(productCategories.id, chainIds(category))} or ${subtreeWhere(category.path)})`));
  const clash = rows.find(r => r.id !== exceptId);
  if (clash) throw new AppError(409, 'conflict', `The key "${key}" is already used by a characteristic of "${clash.categoryName}" (a parent or sub-category)`, { issues: [{ path: 'key', message: 'Key already used in this branch' }] });
}
