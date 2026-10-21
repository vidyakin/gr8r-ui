/* Операции над воркспейсами, общие для регистрации и /workspaces: создание (создатель — owner), список моих. */
import { eq } from 'drizzle-orm';
import { ensureCostItems, ensureDocumentDefaults, ensureModuleProjects, members, memberships, recordEvent, registerBaseUnits, registerSystemEntities, statuses, uuidv7, withContext, workspaces, type Sql } from '@gr8r/db';
import { STATUSES } from '@gr8r/shared';
import type { SessionUser } from './types';

const PALETTE = ['#5A67D8', '#C54B78', '#3B82C4', '#23918A', '#C48A1E', '#8662C9', '#3D8E5F', '#C0612B'];

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'workspace';

export interface WorkspaceInput {
  name: string;
  slug?: string;
  color?: string;
}

/** Создаёт воркспейс, членство owner, профиль участника, статусы по умолчанию и событие workspace.created */
export async function createWorkspace(sql: Sql, user: SessionUser, input: WorkspaceInput) {
  const id = uuidv7();
  const slug = input.slug ?? `${slugify(input.name)}-${id.slice(-6)}`;
  return withContext(sql, { userId: user.id, workspaceId: id }, async db => {
    const [ws] = await db.insert(workspaces).values({ id, name: input.name, slug, color: input.color ?? '#1D1C1A', createdBy: user.id }).returning();
    await db.insert(memberships).values({ workspaceId: id, userId: user.id, role: 'owner' });
    const [me] = await db
      .insert(members)
      .values({ workspaceId: id, userId: user.id, email: user.email, name: user.name, color: PALETTE[Math.floor(Math.random() * PALETTE.length)]!, role: 'owner' })
      .returning();
    await db.insert(statuses).values(STATUSES.map((s, i) => ({ workspaceId: id, key: s.id, name: s.name, color: `var(--st-${s.id})`, builtin: true, sortOrder: i })));
    await registerSystemEntities(db, id);
    await registerBaseUnits(db, id);
    await ensureDocumentDefaults(db, id, input.name);
    await ensureCostItems(db, id);
    await ensureModuleProjects(db, id);
    await recordEvent(db, { workspaceId: id, type: 'workspace.created', entity: 'workspace', recordId: id, actorId: me!.id, payload: { name: input.name } });
    return { ...ws!, role: 'owner' as const, memberId: me!.id };
  });
}

/** Мои воркспейсы с ролью и id моего профиля (политики RLS отдают только воркспейсы, где я состою) */
export async function listMyWorkspaces(sql: Sql, userId: string) {
  return withContext(sql, { userId }, async db => {
    const rows = await db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, color: workspaces.color, brand: workspaces.brand, createdAt: workspaces.createdAt, role: memberships.role })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, userId))
      .orderBy(workspaces.createdAt);
    return rows;
  });
}
