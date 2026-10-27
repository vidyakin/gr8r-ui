/* Должности сотрудников и виды номенклатуры (задача 1172; docs/architecture/positions.md): справочники, должности
   участника, контекст для фильтров («участники с функцией», разделы меню, виды специалиста). Права API не меняются —
   разделы меню это видимость интерфейса. Справочники правят admin и owner (проверка в маршрутах). */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { membersWithFunction, positionsOfMember, specialistProductKindIds, visibleSections, type MemberPositionLink, type PositionDef, type PositionFunction, type PositionSection, type Role } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import type { DocCtx } from './documents';
import { memberPositions, members, positionProductKinds, positions, productKinds, products } from './schema';

export type ProductKindRow = typeof productKinds.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;

/* ---------------- виды номенклатуры ---------------- */

export interface ProductKindInput {
  name: string;
  type?: 'goods' | 'service' | 'work' | undefined;
  sortOrder?: number | undefined;
}

async function loadKind(db: Db, id: string): Promise<ProductKindRow> {
  const [k] = await db.select().from(productKinds).where(eq(productKinds.id, id)).limit(1);
  if (!k) throw new DomainError(404, 'not_found', 'Product kind not found');
  return k;
}

async function usedBy(db: Db, kindId: string, otherThanType?: string): Promise<number> {
  const conds = [eq(products.productKindId, kindId)];
  if (otherThanType) conds.push(sql`${products.kind} <> ${otherThanType}`);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(and(...conds));
  return Number(r?.n ?? 0);
}

export async function listProductKinds(db: Db) {
  return db.select().from(productKinds).orderBy(asc(productKinds.sortOrder), asc(productKinds.name));
}

export async function createProductKind(db: Db, ctx: DocCtx, input: ProductKindInput): Promise<ProductKindRow> {
  const [row] = await db
    .insert(productKinds)
    .values({ workspaceId: ctx.workspaceId, name: input.name, type: input.type ?? 'goods', sortOrder: input.sortOrder ?? 0 })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'product_kind.created', entity: 'product_kind', recordId: row!.id, actorId: ctx.memberId, payload: { name: input.name } });
  return row!;
}

export async function updateProductKind(db: Db, ctx: DocCtx, id: string, input: Partial<ProductKindInput>): Promise<ProductKindRow> {
  const cur = await loadKind(db, id);
  // тип вида должен совпадать с типом товаров, которые его используют
  if (input.type !== undefined && input.type !== cur.type && (await usedBy(db, id, input.type)) > 0) throw new DomainError(422, 'product_kind_in_use', 'Products of another type use this kind');
  const set: Partial<typeof productKinds.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.type !== undefined) set.type = input.type;
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
  const [row] = await db.update(productKinds).set(set).where(eq(productKinds.id, id)).returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'product_kind.updated', entity: 'product_kind', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(input) } });
  return row!;
}

export async function deleteProductKind(db: Db, ctx: DocCtx, id: string): Promise<void> {
  await loadKind(db, id);
  if ((await usedBy(db, id)) > 0) throw new DomainError(409, 'product_kind_in_use', 'The kind is used by products');
  await db.delete(productKinds).where(eq(productKinds.id, id)); // связи с должностями удаляются каскадом
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'product_kind.deleted', entity: 'product_kind', recordId: id, actorId: ctx.memberId, payload: {} });
}

/** Проверка пары «товар — вид номенклатуры»: тип вида совпадает с kind товара */
export async function assertProductKind(db: Db, productKind: string, productKindId: string | null | undefined): Promise<void> {
  if (!productKindId) return;
  const [k] = await db.select({ type: productKinds.type }).from(productKinds).where(eq(productKinds.id, productKindId)).limit(1);
  if (!k) throw new DomainError(422, 'invalid_reference', 'The product kind does not exist');
  if (k.type !== productKind) throw new DomainError(422, 'product_kind_mismatch', 'The type of the product kind does not match the product type');
}

/* ---------------- должности ---------------- */

export interface PositionInput {
  name: string;
  functions?: PositionFunction[] | undefined;
  sections?: PositionSection[] | undefined;
  productKindIds?: string[] | undefined;
  sortOrder?: number | undefined;
}

export interface PositionView extends PositionRow {
  productKindIds: string[];
  memberIds: string[];
}

export async function listPositions(db: Db): Promise<PositionView[]> {
  const rows = await db.select().from(positions).orderBy(asc(positions.sortOrder), asc(positions.name));
  const kinds = await db.select().from(positionProductKinds);
  const links = await db.select().from(memberPositions);
  return rows.map(p => ({ ...p, productKindIds: kinds.filter(k => k.positionId === p.id).map(k => k.productKindId), memberIds: links.filter(l => l.positionId === p.id).map(l => l.memberId) }));
}

async function assertKindsExist(db: Db, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const found = await db.select({ id: productKinds.id }).from(productKinds).where(inArray(productKinds.id, ids));
  if (found.length !== new Set(ids).size) throw new DomainError(422, 'invalid_reference', 'A product kind does not exist');
}

async function replaceKinds(db: Db, ws: string, positionId: string, ids: string[]): Promise<void> {
  await db.delete(positionProductKinds).where(eq(positionProductKinds.positionId, positionId));
  const uniq = [...new Set(ids)];
  if (uniq.length) await db.insert(positionProductKinds).values(uniq.map(productKindId => ({ workspaceId: ws, positionId, productKindId })));
}

async function viewOf(db: Db, id: string): Promise<PositionView> {
  const v = (await listPositions(db)).find(p => p.id === id);
  if (!v) throw new DomainError(404, 'not_found', 'Position not found');
  return v;
}

export async function createPosition(db: Db, ctx: DocCtx, input: PositionInput): Promise<PositionView> {
  await assertKindsExist(db, input.productKindIds ?? []);
  const [row] = await db
    .insert(positions)
    .values({ workspaceId: ctx.workspaceId, name: input.name, functions: [...new Set(input.functions ?? [])], sections: [...new Set(input.sections ?? [])], sortOrder: input.sortOrder ?? 0 })
    .returning();
  await replaceKinds(db, ctx.workspaceId, row!.id, input.productKindIds ?? []);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'position.created', entity: 'position', recordId: row!.id, actorId: ctx.memberId, payload: { name: input.name } });
  return viewOf(db, row!.id);
}

export async function updatePosition(db: Db, ctx: DocCtx, id: string, input: Partial<PositionInput>): Promise<PositionView> {
  const [cur] = await db.select({ id: positions.id }).from(positions).where(eq(positions.id, id)).limit(1);
  if (!cur) throw new DomainError(404, 'not_found', 'Position not found');
  if (input.productKindIds) await assertKindsExist(db, input.productKindIds);
  const set: Partial<typeof positions.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.functions !== undefined) set.functions = [...new Set(input.functions)];
  if (input.sections !== undefined) set.sections = [...new Set(input.sections)];
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
  await db.update(positions).set(set).where(eq(positions.id, id));
  if (input.productKindIds !== undefined) await replaceKinds(db, ctx.workspaceId, id, input.productKindIds);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'position.updated', entity: 'position', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(input) } });
  return viewOf(db, id);
}

export async function deletePosition(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const [cur] = await db.select({ id: positions.id }).from(positions).where(eq(positions.id, id)).limit(1);
  if (!cur) throw new DomainError(404, 'not_found', 'Position not found');
  await db.delete(positions).where(eq(positions.id, id)); // связи с участниками и видами удаляются каскадом
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'position.deleted', entity: 'position', recordId: id, actorId: ctx.memberId, payload: {} });
}

/** Задать должности участника (заменяет набор) */
export async function setMemberPositions(db: Db, ctx: DocCtx, memberId: string, positionIds: string[]): Promise<string[]> {
  const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, memberId)).limit(1);
  if (!m) throw new DomainError(404, 'not_found', 'member not found');
  const ids = [...new Set(positionIds)];
  if (ids.length) {
    const found = await db.select({ id: positions.id }).from(positions).where(inArray(positions.id, ids));
    if (found.length !== ids.length) throw new DomainError(422, 'invalid_reference', 'A position does not exist');
  }
  await db.delete(memberPositions).where(eq(memberPositions.memberId, memberId));
  if (ids.length) await db.insert(memberPositions).values(ids.map(positionId => ({ workspaceId: ctx.workspaceId, memberId, positionId })));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'member.updated', entity: 'member', recordId: memberId, actorId: ctx.memberId, payload: { changes: ['positions'] } });
  return ids;
}

/* ---------------- контекст для фильтров ---------------- */

export interface PositionContext {
  positions: PositionDef[];
  links: MemberPositionLink[];
}

export async function loadPositionContext(db: Db): Promise<PositionContext> {
  const list = await listPositions(db);
  return {
    positions: list.map(p => ({ id: p.id, functions: p.functions, sections: p.sections, productKindIds: p.productKindIds })),
    links: list.flatMap(p => p.memberIds.map(memberId => ({ memberId, positionId: p.id }))),
  };
}

/** id участников с функцией; null — фильтра нет (в воркспейсе нет ни одной должности с этой функцией: показываем всех) */
export async function memberIdsWithFunction(db: Db, fn: PositionFunction): Promise<Set<string> | null> {
  const cx = await loadPositionContext(db);
  if (!cx.positions.some(p => p.functions.includes(fn))) return null;
  return new Set(membersWithFunction(cx.links.map(l => ({ id: l.memberId })), cx.positions, cx.links, fn).map(m => m.id));
}

/** Есть ли у участника должность с функцией (в отличие от списков, без поблажки «нет должностей — все») */
export async function memberHasFunction(db: Db, memberId: string, fn: PositionFunction): Promise<boolean> {
  const cx = await loadPositionContext(db);
  return positionsOfMember(memberId, cx.positions, cx.links).some(p => p.functions.includes(fn));
}

/** Должности и видимые разделы текущего участника (для интерфейса) */
export async function myPositions(db: Db, memberId: string, role: Role) {
  const cx = await loadPositionContext(db);
  const mine = positionsOfMember(memberId, cx.positions, cx.links);
  return {
    memberId,
    role,
    positionIds: mine.map(p => p.id),
    functions: [...new Set(mine.flatMap(p => [...p.functions]))],
    sections: visibleSections(role, mine),
  };
}

export async function specialistKinds(db: Db, memberId: string): Promise<string[] | null> {
  const cx = await loadPositionContext(db);
  return specialistProductKindIds(memberId, cx.positions, cx.links);
}
