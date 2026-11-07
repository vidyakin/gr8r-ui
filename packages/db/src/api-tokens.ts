/* Токены доступа агентов (задача 1285, docs/architecture/agent-tokens.md). Выпуск, список, отзыв и служебные
   сотрудники. Токен действует от имени участника и может только сузить его права: role/должности/RLS/maskCost — как
   у сотрудника; read_only и sections ограничивают дополнительно. Хранится только sha256, полный токен отдаётся один раз. */
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PositionSection, Role } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { memberSections } from './positions';
import { apiTokens, members, memberships, memberPositions, positions, users } from './schema';
import { uuidv7 } from './uuid';

export interface ApiTokenCtx {
  workspaceId: string;
  /** members.id выпускающего (автор действия) */
  memberId: string;
  role: Role;
}

export interface ApiTokenItem {
  id: string;
  name: string;
  prefix: string;
  memberId: string;
  memberName: string;
  readOnly: boolean;
  sections: PositionSection[] | null;
  canPost: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

type TokenRow = typeof apiTokens.$inferSelect;

const isAdmin = (role: Role) => role === 'owner' || role === 'admin';

const toItem = (row: TokenRow, memberName: string): ApiTokenItem => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  memberId: row.memberId,
  memberName,
  readOnly: row.readOnly,
  sections: (row.sections as PositionSection[] | null) ?? null,
  canPost: row.canPost,
  expiresAt: row.expiresAt,
  lastUsedAt: row.lastUsedAt,
  revokedAt: row.revokedAt,
  createdAt: row.createdAt,
});

export interface ApiTokenCreateInput {
  name: string;
  /** По умолчанию — сам выпускающий; другого может назначить только admin/owner */
  memberId?: string;
  readOnly: boolean;
  /** null — все разделы сотрудника; пустой массив — только открытые пути; подмножество видимых разделов */
  sections?: PositionSection[] | null;
  canPost: boolean;
  expiresAt?: string | null;
}

/** Список токенов воркспейса: admin/owner — все, остальные — свои */
export async function listApiTokens(db: Db, ctx: ApiTokenCtx): Promise<ApiTokenItem[]> {
  const rows = await db
    .select({ t: apiTokens, memberName: members.name })
    .from(apiTokens)
    .innerJoin(members, eq(members.id, apiTokens.memberId))
    .where(isAdmin(ctx.role) ? undefined : eq(apiTokens.memberId, ctx.memberId))
    .orderBy(desc(apiTokens.createdAt));
  return rows.map(r => toItem(r.t, r.memberName));
}

/** Выпуск токена: генерирует `gr8r_` + 32 байта base64url, хранит sha256 и первые 12 символов */
export async function createApiToken(db: Db, ctx: ApiTokenCtx, input: ApiTokenCreateInput): Promise<{ token: string; item: ApiTokenItem }> {
  const targetMemberId = input.memberId ?? ctx.memberId;
  if (!isAdmin(ctx.role) && targetMemberId !== ctx.memberId) throw new DomainError(403, 'forbidden', 'Only an admin can issue a token for another member');
  if (ctx.role === 'guest' && !input.readOnly) throw new DomainError(422, 'token_guest_write', 'Guests can only create read-only tokens');
  if (input.canPost && input.readOnly) throw new DomainError(422, 'token_can_post_read_only', 'A read-only token cannot post');
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) throw new DomainError(422, 'token_expires_past', 'The expiration date is in the past');

  const [member] = await db.select().from(members).where(and(eq(members.workspaceId, ctx.workspaceId), eq(members.id, targetMemberId))).limit(1);
  if (!member) throw new DomainError(404, 'not_found', 'Member not found');

  const sections = input.sections == null ? null : [...new Set(input.sections)];
  if (sections && sections.length) {
    const allowed = await memberSections(db, member.id, member.role);
    const bad = sections.filter(s => !allowed.includes(s));
    if (bad.length) throw new DomainError(422, 'token_sections_exceed', 'Sections exceed the member positions', { sections: bad });
  }

  const token = 'gr8r_' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const [row] = await db
    .insert(apiTokens)
    .values({
      workspaceId: ctx.workspaceId,
      memberId: targetMemberId,
      createdBy: ctx.memberId,
      name: input.name,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      prefix: token.slice(0, 12),
      readOnly: input.readOnly,
      sections,
      canPost: input.canPost,
      expiresAt,
    })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'api_token.created', entity: 'api_token', recordId: row!.id, actorId: ctx.memberId, payload: { name: input.name, prefix: row!.prefix, memberId: targetMemberId } });
  return { token, item: toItem(row!, member.name) };
}

/** Отзыв токена: свой или любой для admin/owner. Повторный отзыв идемпотентен (200, без нового события) */
export async function revokeApiToken(db: Db, ctx: ApiTokenCtx, id: string): Promise<ApiTokenItem> {
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, id), isAdmin(ctx.role) ? undefined : eq(apiTokens.memberId, ctx.memberId)))
    .limit(1)
    .for('update');
  if (!row) throw new DomainError(404, 'not_found', 'Token not found');
  let updated = row;
  if (!row.revokedAt) {
    const [u] = await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, id)).returning();
    updated = u!;
    await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'api_token.revoked', entity: 'api_token', recordId: id, actorId: ctx.memberId, payload: { name: row.name, prefix: row.prefix } });
  }
  const [member] = await db.select({ name: members.name }).from(members).where(eq(members.id, updated.memberId)).limit(1);
  return toItem(updated, member?.name ?? '');
}

/** Служебный сотрудник для агента без человека: пользователь is_service (вход по паролю запрещён), участник с ролью и должностями */
export async function createServiceMember(db: Db, ctx: ApiTokenCtx, input: { name: string; role: 'member' | 'guest'; positionIds?: string[] }): Promise<{ memberId: string }> {
  const userId = uuidv7();
  const email = `agent-${userId}@agents.invalid`;
  await db.insert(users).values({ id: userId, email, passwordHash: '!service', name: input.name, isService: true });
  await db.insert(memberships).values({ workspaceId: ctx.workspaceId, userId, role: input.role });
  const [member] = await db.insert(members).values({ workspaceId: ctx.workspaceId, userId, email, name: input.name, role: input.role, status: 'active' }).returning({ id: members.id });
  const ids = [...new Set(input.positionIds ?? [])];
  if (ids.length) {
    const found = await db.select({ id: positions.id }).from(positions).where(and(eq(positions.workspaceId, ctx.workspaceId), inArray(positions.id, ids)));
    if (found.length !== ids.length) throw new DomainError(422, 'invalid_reference', 'A position does not exist');
    await db.insert(memberPositions).values(ids.map(positionId => ({ workspaceId: ctx.workspaceId, memberId: member!.id, positionId })));
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'member.created', entity: 'member', recordId: member!.id, actorId: ctx.memberId, payload: { name: input.name, isService: true } });
  return { memberId: member!.id };
}

/** Подпись «через агента»: к строкам с apiTokenId добавить apiTokenName (название токена; отозванные тоже) */
export async function withApiTokenNames<R extends { apiTokenId: string | null }>(db: Db, rows: R[]): Promise<(R & { apiTokenName: string | null })[]> {
  const ids = [...new Set(rows.map(r => r.apiTokenId).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (ids.length) for (const t of await db.select({ id: apiTokens.id, name: apiTokens.name }).from(apiTokens).where(inArray(apiTokens.id, ids))) names.set(t.id, t.name);
  return rows.map(r => ({ ...r, apiTokenName: r.apiTokenId ? (names.get(r.apiTokenId) ?? null) : null }));
}
