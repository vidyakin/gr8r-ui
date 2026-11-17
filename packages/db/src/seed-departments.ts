/* Демо подразделений (оргструктура, docs/architecture/departments.md): «Руководство» (руководитель — владелец) → «Продажи»,
   «Производство», «Бухгалтерия». Сотрудники разнесены по тому же порядку, что и должности в seedPositions:
   массажисты и менеджер — продажи (руководитель — менеджер), рабочий цеха и курьеры — производство (руководитель — рабочий),
   остальные — бухгалтерия. Запускается после seedPositions. */
import { and, asc, eq, ne } from 'drizzle-orm';
import type { Db } from './client';
import type { DocCtx } from './documents';
import { createDepartment, setMemberDepartment } from './departments';
import { members } from './schema';

export async function seedDepartments(db: Db, ctx: DocCtx): Promise<void> {
  const ws = ctx.workspaceId;
  // участники по порядку создания, без автора — как в seedPositions
  const people = await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, ws), eq(members.status, 'active'), ne(members.id, ctx.memberId ?? ''))).orderBy(asc(members.createdAt), asc(members.id));
  const root = await createDepartment(db, ctx, { name: 'Руководство', headMemberId: ctx.memberId ?? null, sortOrder: 1 });
  const sales = await createDepartment(db, ctx, { name: 'Продажи', parentId: root.id, headMemberId: people[2]?.id ?? null, sortOrder: 2 });
  const prod = await createDepartment(db, ctx, { name: 'Производство', parentId: root.id, headMemberId: people[3]?.id ?? null, sortOrder: 3 });
  const acc = await createDepartment(db, ctx, { name: 'Бухгалтерия', parentId: root.id, sortOrder: 4 });

  if (ctx.memberId) await setMemberDepartment(db, ctx, ctx.memberId, root.id);
  for (const [i, p] of people.entries()) await setMemberDepartment(db, ctx, p.id, i <= 2 ? sales.id : i <= 5 ? prod.id : acc.id);
}
