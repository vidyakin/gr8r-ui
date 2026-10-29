/* Операции над воркспейсами, общие для регистрации и /workspaces: создание (создатель — owner), список моих. */
import { and, eq, isNull, sql as dsql } from 'drizzle-orm';
import { initWorkspace, memberships, slugify, uuidv7, withContext, workspaces, type Sql } from '@gr8r/db';
import type { SessionUser } from './types';

export { slugify };

export interface WorkspaceInput {
  name: string;
  slug?: string;
  color?: string;
}

/** Создаёт воркспейс, членство owner, профиль участника, статусы по умолчанию и событие workspace.created (initWorkspace) */
export async function createWorkspace(sql: Sql, user: Pick<SessionUser, 'id' | 'email' | 'name'>, input: WorkspaceInput) {
  const id = uuidv7();
  const slug = input.slug ?? `${slugify(input.name)}-${id.slice(-6)}`;
  return withContext(sql, { userId: user.id, workspaceId: id }, async db => {
    const { ws, me } = await initWorkspace(db, { id, name: input.name, slug, color: input.color, owner: { userId: user.id, email: user.email, name: user.name } });
    return { ...ws, role: 'owner' as const, memberId: me.id };
  });
}

/** Мои воркспейсы с ролью и id моего профиля (политики RLS отдают только воркспейсы, где я состою) */
export async function listMyWorkspaces(sql: Sql, userId: string) {
  return withContext(sql, { userId }, async db => {
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        color: workspaces.color,
        brand: workspaces.brand,
        createdAt: workspaces.createdAt,
        role: memberships.role,
        // Язык воркспейса по умолчанию (settings.locale), null — не задан
        locale: dsql<string | null>`${workspaces.settings}->>'locale'`,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(and(eq(memberships.userId, userId), isNull(workspaces.deleteRequestedAt)))
      .orderBy(workspaces.createdAt);
    return rows;
  });
}
