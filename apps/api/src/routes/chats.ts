/* Встроенный мультиязычный чат: список, создание/повторное открытие, настройки, гостевые ссылки. */
import { randomBytes } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, exists, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { chatMembers, chats, isUuid, members, recordEvent } from '@erp/db';
import {
  CHAT_ENTITY_TYPES,
  CHAT_KINDS,
  chatCreateBody,
  chatGuestLinkBody,
  chatPatchBody,
  idParam,
  type ChatEntityType,
  type ChatKind,
} from '@erp/shared';
import { escapeLike, validationHook } from '../crud';
import { AppError } from '../errors';
import { requireRole } from '../middleware';
import { buildChatItems } from '../chats/queries';
import {
  assertWorkspaceMembers,
  collectMissingTranslations,
  findClientEntityChat,
  findDirectChat,
  getAccessibleChat,
  scheduleBackfill,
  syncChatMembers,
} from '../chats/service';
import type { AppEnv } from '../types';
import { chatMessageRoutes } from './chat-messages';

const makeGuestToken = () => randomBytes(16).toString('hex');

export const chatRoutes = new Hono<AppEnv>()
  .use('*', requireRole('member'))
  .get('/', async c => {
    const db = c.var.db;
    const memberId = c.var.memberId;
    const kindQ = c.req.query('kind')?.trim();
    const entTypeQ = c.req.query('entityType')?.trim();
    const entIdQ = c.req.query('entityId')?.trim();
    const q = c.req.query('q')?.trim();

    const kind = CHAT_KINDS.includes(kindQ as ChatKind) ? (kindQ as ChatKind) : undefined;
    const entityType = CHAT_ENTITY_TYPES.includes(entTypeQ as ChatEntityType) ? (entTypeQ as ChatEntityType) : undefined;
    const mine = exists(
      db.select({ id: chatMembers.id }).from(chatMembers).where(and(eq(chatMembers.chatId, chats.id), eq(chatMembers.memberId, memberId))),
    );
    const pat = q ? `%${escapeLike(q)}%` : null;
    const memberMatch = pat
      ? exists(
          db
            .select({ id: chatMembers.id })
            .from(chatMembers)
            .innerJoin(members, eq(members.id, chatMembers.memberId))
            .where(and(eq(chatMembers.chatId, chats.id), ilike(members.name, pat))),
        )
      : undefined;

    const conds: (SQL | undefined)[] = [
      isNull(chats.archivedAt),
      or(eq(chats.kind, 'client'), mine),
      kind ? eq(chats.kind, kind) : undefined,
      entityType ? eq(chats.entityType, entityType) : undefined,
      entIdQ && isUuid(entIdQ) ? eq(chats.entityId, entIdQ) : undefined,
      pat ? or(ilike(chats.title, pat), ilike(chats.guestName, pat), ilike(chats.lastMessagePreview, pat), memberMatch) : undefined,
    ];

    const rows = await db
      .select()
      .from(chats)
      .where(and(...conds))
      .orderBy(desc(sql`coalesce(${chats.lastMessageAt}, ${chats.createdAt})`), desc(chats.createdAt))
      .limit(200);
    return c.json({ items: await buildChatItems(db, c.var.workspaceId, rows, memberId) });
  })
  .post('/', zValidator('json', chatCreateBody, validationHook), async c => {
    const body = c.req.valid('json');
    const db = c.var.db;
    const wsId = c.var.workspaceId;
    const me = c.var.memberId;

    const participantIds = [...new Set([me, ...(body.memberIds ?? [])])];
    await assertWorkspaceMembers(db, participantIds);

    if (body.kind === 'direct') {
      if (participantIds.length > 2) throw new AppError(400, 'invalid_direct_chat', 'Direct chat must have at most 2 participants');
      const existing = await findDirectChat(db, me, participantIds.find(id => id !== me) ?? me);
      if (existing) return c.json({ chat: (await buildChatItems(db, wsId, [existing], me))[0]! });
    }

    if (body.kind === 'client' && body.entityType && body.entityId) {
      let existing = await findClientEntityChat(db, body.entityType, body.entityId);
      if (existing) {
        await db.insert(chatMembers).values({ workspaceId: wsId, chatId: existing.id, memberId: me }).onConflictDoNothing();
        if (body.enableGuestLink && !existing.guestToken) {
          const [upd] = await db.update(chats).set({ guestToken: makeGuestToken(), updatedAt: new Date() }).where(eq(chats.id, existing.id)).returning();
          if (upd) existing = upd;
        }
        return c.json({ chat: (await buildChatItems(db, wsId, [existing], me))[0]! });
      }
    }

    const [created] = await db
      .insert(chats)
      .values({
        workspaceId: wsId,
        kind: body.kind,
        title: body.title ?? '',
        entityType: body.entityType ?? null,
        entityId: body.entityId ?? null,
        guestToken: body.enableGuestLink ? makeGuestToken() : null,
        guestName: body.guestName ?? null,
        guestLanguage: body.guestLanguage ?? 'en',
        createdBy: me,
      })
      .returning();

    await db.insert(chatMembers).values(participantIds.map(memberId => ({ workspaceId: wsId, chatId: created!.id, memberId }))).onConflictDoNothing();
    await recordEvent(db, { workspaceId: wsId, type: 'chat.created', entity: 'chat', recordId: created!.id, actorId: me, payload: { kind: created!.kind } });
    return c.json({ chat: (await buildChatItems(db, wsId, [created!], me))[0]! }, 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const { id } = c.req.valid('param');
    const row = await getAccessibleChat(c.var.db, id, c.var.memberId);
    return c.json({ chat: (await buildChatItems(c.var.db, c.var.workspaceId, [row], c.var.memberId))[0]! });
  })
  .patch('/:id', zValidator('param', idParam, validationHook), zValidator('json', chatPatchBody, validationHook), async c => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.var.db;
    const wsId = c.var.workspaceId;
    const me = c.var.memberId;

    let current = await getAccessibleChat(db, id, me);
    const prevGuestLang = current.guestLanguage;
    const patch: Partial<typeof chats.$inferInsert> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.entityType !== undefined) patch.entityType = body.entityType;
    if (body.entityId !== undefined) patch.entityId = body.entityId;
    if (body.guestName !== undefined) patch.guestName = body.guestName;
    if (body.guestLanguage !== undefined) patch.guestLanguage = body.guestLanguage;
    if (body.archived !== undefined) patch.archivedAt = body.archived ? new Date() : null;

    if (Object.keys(patch).length) {
      patch.updatedAt = new Date();
      const [upd] = await db.update(chats).set(patch).where(eq(chats.id, id)).returning();
      if (upd) current = upd;
    }
    if (body.preferredLanguage !== undefined) {
      await db
        .insert(chatMembers)
        .values({ workspaceId: wsId, chatId: id, memberId: me, preferredLanguage: body.preferredLanguage })
        .onConflictDoUpdate({ target: [chatMembers.chatId, chatMembers.memberId], set: { preferredLanguage: body.preferredLanguage } });
    }
    if (body.memberIds !== undefined && current.kind !== 'direct') {
      await syncChatMembers(db, wsId, id, [...new Set([me, ...body.memberIds])]);
    }
    if (body.guestLanguage && body.guestLanguage !== prevGuestLang) {
      const missing = await collectMissingTranslations(db, id, body.guestLanguage);
      scheduleBackfill(c.get('sql'), wsId, id, body.guestLanguage, missing, c.get('config').landingAi);
    }

    await recordEvent(db, { workspaceId: wsId, type: 'chat.updated', entity: 'chat', recordId: id, actorId: me, payload: { changes: Object.keys(body) } });
    return c.json({ chat: (await buildChatItems(db, wsId, [current], me))[0]! });
  })
  .post('/:id/guest-link', zValidator('param', idParam, validationHook), zValidator('json', chatGuestLinkBody, validationHook), async c => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.var.db;
    const current = await getAccessibleChat(db, id, c.var.memberId);

    const guestToken =
      body.action === 'revoke' ? null : body.action === 'rotate' ? makeGuestToken() : (current.guestToken ?? makeGuestToken());
    const patch: Partial<typeof chats.$inferInsert> = { guestToken, updatedAt: new Date() };
    if (body.guestName !== undefined) patch.guestName = body.guestName;
    if (body.guestLanguage !== undefined) patch.guestLanguage = body.guestLanguage;

    await db.update(chats).set(patch).where(eq(chats.id, id));
    await recordEvent(db, { workspaceId: c.var.workspaceId, type: 'chat.guest_link', entity: 'chat', recordId: id, actorId: c.var.memberId, payload: { action: body.action } });
    return c.json({ guestToken, path: guestToken ? `/c/${guestToken}` : null });
  })
  .route('/', chatMessageRoutes);
