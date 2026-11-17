/* Подразделения (оргструктура, docs/architecture/departments.md): справочник-дерево с руководителями, состав сотрудников,
   правило «руководитель подразделения сотрудника». Справочник правят admin и owner (проверка в маршрутах), читают все.
   У участника не больше одного подразделения; цикл в дереве запрещён (422 department_cycle). */
import { asc, eq, sql } from 'drizzle-orm';
import { departmentHeadOf, type DepartmentDef, type DepartmentMembership } from '@erp/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import type { DocCtx } from './documents';
import { departmentMembers, departments, members } from './schema';

export type DepartmentRow = typeof departments.$inferSelect;

export interface DepartmentInput {
  name: string;
  parentId?: string | null | undefined;
  headMemberId?: string | null | undefined;
  sortOrder?: number | undefined;
}

export interface DepartmentView extends DepartmentRow {
  memberIds: string[];
}

/** Список подразделений с составом (сортировка как в дереве: sortOrder, затем название) */
export async function listDepartments(db: Db): Promise<DepartmentView[]> {
  const rows = await db.select().from(departments).orderBy(asc(departments.sortOrder), asc(departments.name));
  const links = await db.select().from(departmentMembers);
  return rows.map(d => ({ ...d, memberIds: links.filter(l => l.departmentId === d.id).map(l => l.memberId) }));
}

async function viewOf(db: Db, id: string): Promise<DepartmentView> {
  const v = (await listDepartments(db)).find(d => d.id === id);
  if (!v) throw new DomainError(404, 'not_found', 'Department not found');
  return v;
}

async function assertParentExists(db: Db, parentId: string | null | undefined): Promise<void> {
  if (!parentId) return;
  const [p] = await db.select({ id: departments.id }).from(departments).where(eq(departments.id, parentId)).limit(1);
  if (!p) throw new DomainError(422, 'invalid_reference', 'The parent department does not exist');
}

async function assertHeadExists(db: Db, headMemberId: string | null | undefined): Promise<void> {
  if (!headMemberId) return;
  const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, headMemberId)).limit(1);
  if (!m) throw new DomainError(422, 'invalid_reference', 'The head member does not exist');
}

/** Запрет цикла: новый родитель не должен быть самим подразделением или его потомком (подъём от родителя к корню) */
async function assertNoCycle(db: Db, id: string, parentId: string | null | undefined): Promise<void> {
  if (!parentId) return;
  if (parentId === id) throw new DomainError(422, 'department_cycle', 'A department cannot be its own parent');
  const all = await db.select({ id: departments.id, parentId: departments.parentId }).from(departments);
  const parentOf = new Map(all.map(d => [d.id, d.parentId]));
  let cur: string | null = parentId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === id) throw new DomainError(422, 'department_cycle', 'The parent department is a descendant: the tree would have a cycle');
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
}

export async function createDepartment(db: Db, ctx: DocCtx, input: DepartmentInput): Promise<DepartmentView> {
  await assertParentExists(db, input.parentId);
  await assertHeadExists(db, input.headMemberId);
  const [row] = await db
    .insert(departments)
    .values({ workspaceId: ctx.workspaceId, name: input.name, parentId: input.parentId ?? null, headMemberId: input.headMemberId ?? null, sortOrder: input.sortOrder ?? 0 })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'department.created', entity: 'department', recordId: row!.id, actorId: ctx.memberId, payload: { name: input.name } });
  return viewOf(db, row!.id);
}

export async function updateDepartment(db: Db, ctx: DocCtx, id: string, input: Partial<DepartmentInput>): Promise<DepartmentView> {
  const [cur] = await db.select({ id: departments.id }).from(departments).where(eq(departments.id, id)).limit(1);
  if (!cur) throw new DomainError(404, 'not_found', 'Department not found');
  // undefined — не трогать, null — очистить; проверяем поле явно
  if (input.parentId !== undefined) {
    await assertParentExists(db, input.parentId);
    await assertNoCycle(db, id, input.parentId);
  }
  if (input.headMemberId !== undefined) await assertHeadExists(db, input.headMemberId);
  const set: Partial<typeof departments.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.parentId !== undefined) set.parentId = input.parentId;
  if (input.headMemberId !== undefined) set.headMemberId = input.headMemberId;
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
  await db.update(departments).set(set).where(eq(departments.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'department.updated', entity: 'department', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(input) } });
  return viewOf(db, id);
}

export async function deleteDepartment(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const [cur] = await db.select({ id: departments.id }).from(departments).where(eq(departments.id, id)).limit(1);
  if (!cur) throw new DomainError(404, 'not_found', 'Department not found');
  // удаление только пустого подразделения: без дочерних и без сотрудников
  const [children] = await db.select({ n: sql<number>`count(*)::int` }).from(departments).where(eq(departments.parentId, id));
  if (Number(children?.n ?? 0) > 0) throw new DomainError(409, 'department_in_use', 'The department has child departments');
  const [staff] = await db.select({ n: sql<number>`count(*)::int` }).from(departmentMembers).where(eq(departmentMembers.departmentId, id));
  if (Number(staff?.n ?? 0) > 0) throw new DomainError(409, 'department_in_use', 'The department has employees');
  await db.delete(departments).where(eq(departments.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'department.deleted', entity: 'department', recordId: id, actorId: ctx.memberId, payload: {} });
}

/** Назначить подразделение участнику (заменяет прежнее); null — убрать из подразделения */
export async function setMemberDepartment(db: Db, ctx: DocCtx, memberId: string, departmentId: string | null): Promise<string | null> {
  const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, memberId)).limit(1);
  if (!m) throw new DomainError(404, 'not_found', 'member not found');
  if (departmentId) {
    const [d] = await db.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId)).limit(1);
    if (!d) throw new DomainError(422, 'invalid_reference', 'The department does not exist');
  }
  // у участника не больше одного подразделения: прежняя связь удаляется
  await db.delete(departmentMembers).where(eq(departmentMembers.memberId, memberId));
  if (departmentId) await db.insert(departmentMembers).values({ workspaceId: ctx.workspaceId, departmentId, memberId });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'member.updated', entity: 'member', recordId: memberId, actorId: ctx.memberId, payload: { changes: ['department'] } });
  return departmentId;
}

/** Руководитель подразделения сотрудника (чистое правило departmentHeadOf): подразделение участника и найденный руководитель */
export async function departmentHeadOfMember(db: Db, memberId: string): Promise<{ memberId: string; departmentId: string | null; headMemberId: string | null }> {
  const rows = await db.select({ id: departments.id, parentId: departments.parentId, headMemberId: departments.headMemberId }).from(departments);
  const links = await db.select({ memberId: departmentMembers.memberId, departmentId: departmentMembers.departmentId }).from(departmentMembers);
  const defs: DepartmentDef[] = rows.map(d => ({ id: d.id, parentId: d.parentId, headMemberId: d.headMemberId }));
  const memberships: DepartmentMembership[] = links.map(l => ({ memberId: l.memberId, departmentId: l.departmentId }));
  const departmentId = links.find(l => l.memberId === memberId)?.departmentId ?? null;
  return { memberId, departmentId, headMemberId: departmentHeadOf(memberId, defs, memberships) };
}