/* Воркспейсы: список моих, создание, настройки, приглашения (токен вместо почты — пока), смена роли, принятие приглашения. */
import { zValidator } from '@hono/zod-validator';
import { and, count, eq, gt, isNull, sql as dsql } from 'drizzle-orm';
import { Hono } from 'hono';
import { assertLimit, invites, members, memberships, recordEvent, uuidv7, withContext, workspaces } from '@gr8r/db';
import { inviteAcceptBody, inviteCreateBody, memberParam, roleChangeBody, workspaceCreateBody, workspaceParam, workspaceUpdateBody, idParam } from '@gr8r/shared';
import { AppError, forbidden, notFound } from './errors';
import { ctxOf, validationHook } from './crud';
import { requireRole, requireSession, sha256, tenant } from './middleware';
import { createWorkspace, listMyWorkspaces } from './workspaces-service';
import type { AppEnv } from './types';

const INVITE_TTL_MS = 7 * 864e5;
const newInviteToken = (wsId: string) => `${wsId}.${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url')}`;

export const workspaceRoutes = new Hono<AppEnv>()
  .use('*', requireSession)
  .get('/', async c => c.json({ items: await listMyWorkspaces(c.get('sql'), c.get('user').id) }))
  .post('/', zValidator('json', workspaceCreateBody, validationHook), async c => c.json(await createWorkspace(c.get('sql'), c.get('user'), c.req.valid('json')), 201))
  // ---- всё, что ниже, выполняется в контексте арендатора :id (членство проверяется) ----
  .use('/:id/*', tenant('param'))
  .get('/:id', zValidator('param', workspaceParam, validationHook), async c => {
    const { db, workspaceId, role } = ctxOf(c);
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!ws) throw notFound('Workspace');
    return c.json({ ...ws, role });
  })
  .patch('/:id', requireRole('admin'), zValidator('json', workspaceUpdateBody, validationHook), async c => {
    const { db, workspaceId, memberId } = ctxOf(c);
    const body = c.req.valid('json');
    const { locale, ...rest } = body;
    // Язык живёт в settings (jsonb): null снимает ключ, значение — дописывает
    const settings =
      locale === undefined ? undefined : locale === null ? dsql`${workspaces.settings} - 'locale'` : dsql`${workspaces.settings} || jsonb_build_object('locale', ${locale}::text)`;
    const [ws] = await db
      .update(workspaces)
      .set({ ...rest, ...(settings ? { settings } : {}), updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    if (!ws) throw notFound('Workspace');
    await recordEvent(db, { workspaceId, type: 'workspace.updated', entity: 'workspace', recordId: workspaceId, actorId: memberId, payload: { changes: body } });
    return c.json(ws);
  })
  // Удаление воркспейса целиком (только owner): все данные арендатора уходят каскадом внешних ключей
  .delete('/:id', requireRole('owner'), async c => {
    const { db, workspaceId } = ctxOf(c);
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    return c.json({ id: workspaceId, deleted: true as const });
  })
  // ---- приглашения ----
  .get('/:id/invites', requireRole('admin'), async c => {
    const { db } = ctxOf(c);
    const rows = await db
      .select({ id: invites.id, email: invites.email, role: invites.role, expiresAt: invites.expiresAt, acceptedAt: invites.acceptedAt, createdAt: invites.createdAt })
      .from(invites)
      .orderBy(invites.createdAt);
    return c.json({ items: rows });
  })
  .post('/:id/invites', requireRole('admin'), zValidator('json', inviteCreateBody, validationHook), async c => {
    const { db, workspaceId, memberId } = ctxOf(c);
    const { email, role, memberId: wantedId } = c.req.valid('json');
    const [existing] = await db.select({ id: members.id, status: members.status }).from(members).where(eq(dsql`lower(${members.email})`, email)).limit(1);
    if (existing && existing.status === 'active') throw new AppError(409, 'already_member', 'This person is already a member of the workspace');
    await assertLimit(db, 'members'); // лимит пользователей тарифа: участники и неотвеченные приглашения
    const token = newInviteToken(workspaceId);
    const [invite] = await db
      .insert(invites)
      .values({ workspaceId, email, role, tokenHash: sha256(token), invitedBy: c.get('user').id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
      .returning({ id: invites.id, email: invites.email, role: invites.role, expiresAt: invites.expiresAt });
    // Заготовка профиля (статус invited): участник виден в списке до принятия приглашения
    let profileId = existing?.id;
    if (!existing) [{ id: profileId }] = (await db.insert(members).values({ ...(wantedId ? { id: wantedId } : {}), workspaceId, email, name: email.split('@')[0]!, role, status: 'invited' }).returning({ id: members.id })) as [{ id: string }];
    await recordEvent(db, { workspaceId, type: 'member.invited', entity: 'invite', recordId: invite!.id, actorId: memberId, payload: { email, role } });
    // Токен отдаётся один раз (почты пока нет — передайте ссылку вручную)
    return c.json({ invite: invite!, token, memberId: profileId! }, 201);
  })
  .delete('/:id/invites/:inviteId', requireRole('admin'), async c => {
    const { db, workspaceId, memberId } = ctxOf(c);
    const inviteId = idParam.parse({ id: c.req.param('inviteId') }).id;
    const [row] = await db.delete(invites).where(eq(invites.id, inviteId)).returning({ id: invites.id });
    if (!row) throw notFound('Invite');
    await recordEvent(db, { workspaceId, type: 'member.invite_revoked', entity: 'invite', recordId: inviteId, actorId: memberId });
    return c.json({ id: inviteId, deleted: true as const });
  })
  // ---- смена роли ----
  .patch('/:id/members/:memberId', requireRole('admin'), zValidator('param', memberParam, validationHook), zValidator('json', roleChangeBody, validationHook), async c => {
    const { db, workspaceId, memberId: actorId, role: actorRole } = ctxOf(c);
    const { memberId } = c.req.valid('param');
    const { role } = c.req.valid('json');
    const [target] = await db.select().from(members).where(eq(members.id, memberId)).limit(1).for('update');
    if (!target) throw notFound('Member');
    if (target.role === role) return c.json(target);
    // Назначать и снимать owner может только owner
    if ((role === 'owner' || target.role === 'owner') && actorRole !== 'owner') throw forbidden('Only an owner can grant or revoke the owner role');
    if (target.role === 'owner') {
      const [{ n }] = await db.select({ n: count() }).from(members).where(and(eq(members.role, 'owner'), eq(members.status, 'active')));
      if (n <= 1) throw new AppError(422, 'last_owner', 'A workspace must keep at least one owner');
    }
    const [updated] = await db.update(members).set({ role, updatedAt: new Date() }).where(eq(members.id, memberId)).returning();
    if (target.userId) await db.update(memberships).set({ role }).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, target.userId)));
    await recordEvent(db, { workspaceId, type: 'member.role_changed', entity: 'member', recordId: memberId, actorId, payload: { changes: { role: { from: target.role, to: role } } } });
    return c.json(updated!);
  });

/** Принятие приглашения по токену: `POST /invites/accept`. Не требует X-Workspace-Id — воркспейс зашит в токен */
export const inviteRoutes = new Hono<AppEnv>().use('*', requireSession).post('/accept', zValidator('json', inviteAcceptBody, validationHook), async c => {
  const user = c.get('user');
  const { token } = c.req.valid('json');
  const wsId = token.split('.')[0] ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(wsId)) throw new AppError(404, 'invite_not_found', 'Invite not found or expired');
  const result = await withContext(c.get('sql'), { userId: user.id, workspaceId: wsId.toLowerCase() }, async db => {
    const [inv] = await db
      .select()
      .from(invites)
      .where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
      .limit(1)
      .for('update');
    if (!inv) throw new AppError(404, 'invite_not_found', 'Invite not found or expired');
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw forbidden('This invite was issued for a different email address');
    const [already] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.workspaceId, inv.workspaceId), eq(memberships.userId, user.id)));
    if (already) throw new AppError(409, 'already_member', 'You are already a member of this workspace');
    await db.insert(memberships).values({ workspaceId: inv.workspaceId, userId: user.id, role: inv.role });
    const [profile] = await db.select({ id: members.id }).from(members).where(eq(dsql`lower(${members.email})`, inv.email.toLowerCase())).limit(1);
    let memberId = profile?.id;
    if (profile) await db.update(members).set({ userId: user.id, status: 'active', name: user.name, role: inv.role, updatedAt: new Date() }).where(eq(members.id, profile.id));
    else [{ id: memberId }] = (await db.insert(members).values({ id: uuidv7(), workspaceId: inv.workspaceId, userId: user.id, email: user.email, name: user.name, role: inv.role }).returning({ id: members.id })) as [{ id: string }];
    await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, inv.id));
    await recordEvent(db, { workspaceId: inv.workspaceId, type: 'member.joined', entity: 'member', recordId: memberId, actorId: memberId, payload: { role: inv.role } });
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, inv.workspaceId));
    return { ...ws!, role: inv.role, memberId: memberId! };
  });
  return c.json(result);
});
