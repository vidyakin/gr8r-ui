/* Сообщения чата, прочтение, оценка перевода и мягкое удаление своих сообщений. */
import { zValidator } from '@hono/zod-validator';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { chatMembers, chatMessages, members, recordEvent } from '@erp/db';
import { chatMessageCreateBody, chatMessageFeedbackBody, idParam, uuid } from '@erp/shared';
import { validationHook } from '../crud';
import { forbidden, notFound } from '../errors';
import { insertChatMessage, listChatMessages, loadRecentContext, refreshChatPreview, toMessageDto } from '../chats/messages';
import { workspaceDefaultLocale } from '../chats/queries';
import { getAccessibleChat, resolveTargetLanguages, scheduleTranslation } from '../chats/service';
import type { AppEnv } from '../types';

const msgParam = z.object({ id: uuid, messageId: uuid });

export const chatMessageRoutes = new Hono<AppEnv>()
  .get('/:id/messages', zValidator('param', idParam, validationHook), async c => {
    const { id } = c.req.valid('param');
    const chat = await getAccessibleChat(c.var.db, id, c.var.memberId);
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
    const cursor = c.req.query('cursor')?.trim() || undefined;
    return c.json(await listChatMessages(c.var.db, chat, { cursor, limit }));
  })
  .post(
    '/:id/messages',
    zValidator('param', idParam, validationHook),
    zValidator('json', chatMessageCreateBody, validationHook),
    async c => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const db = c.var.db;
      const wsId = c.var.workspaceId;
      const memberId = c.var.memberId;

      const chat = await getAccessibleChat(db, id, memberId);
      const [me] = await db
        .select({ name: members.name, preferred: chatMembers.preferredLanguage })
        .from(members)
        .leftJoin(chatMembers, and(eq(chatMembers.chatId, id), eq(chatMembers.memberId, memberId)))
        .where(eq(members.id, memberId))
        .limit(1);

      const originalLanguage =
        body.language ?? me?.preferred ?? c.get('user').locale ?? (await workspaceDefaultLocale(db, wsId));
      const targetLanguages = await resolveTargetLanguages(db, wsId, chat, originalLanguage);

      const msg = await insertChatMessage(db, {
        workspaceId: wsId,
        chatId: id,
        senderMemberId: memberId,
        text: body.text,
        originalLanguage,
        translationStatus: targetLanguages.length > 0 ? 'pending' : 'none',
      });

      await db
        .insert(chatMembers)
        .values({ workspaceId: wsId, chatId: id, memberId, lastReadAt: msg.createdAt })
        .onConflictDoUpdate({ target: [chatMembers.chatId, chatMembers.memberId], set: { lastReadAt: msg.createdAt } });

      if (targetLanguages.length > 0) {
        const context = await loadRecentContext(db, id, msg.id);
        scheduleTranslation({
          sql: c.get('sql'),
          workspaceId: wsId,
          chatId: id,
          messageId: msg.id,
          originalText: body.text,
          originalLanguage,
          targetLanguages,
          context,
          aiConfig: c.get('config').landingAi,
        });
      }

      const names = new Map<string, string>([[memberId, me?.name ?? c.get('user').name]]);
      return c.json({ message: toMessageDto(msg, names, chat.guestName) }, 201);
    },
  )
  .post('/:id/read', zValidator('param', idParam, validationHook), async c => {
    const { id } = c.req.valid('param');
    await getAccessibleChat(c.var.db, id, c.var.memberId);
    const now = new Date();
    await c.var.db
      .insert(chatMembers)
      .values({ workspaceId: c.var.workspaceId, chatId: id, memberId: c.var.memberId, lastReadAt: now })
      .onConflictDoUpdate({ target: [chatMembers.chatId, chatMembers.memberId], set: { lastReadAt: now } });
    return c.json({ ok: true as const });
  })
  .post(
    '/:id/messages/:messageId/feedback',
    zValidator('param', msgParam, validationHook),
    zValidator('json', chatMessageFeedbackBody, validationHook),
    async c => {
      const { id, messageId } = c.req.valid('param');
      const body = c.req.valid('json');
      await getAccessibleChat(c.var.db, id, c.var.memberId);
      const feedback = body.feedback === 'none' ? null : body.feedback;
      const [updated] = await c.var.db
        .update(chatMessages)
        .set({ feedback })
        .where(and(eq(chatMessages.id, messageId), eq(chatMessages.chatId, id), isNull(chatMessages.deletedAt)))
        .returning({ id: chatMessages.id, feedback: chatMessages.feedback });
      if (!updated) throw notFound('Message');
      return c.json({ ok: true as const, feedback: updated.feedback });
    },
  )
  .delete('/:id/messages/:messageId', zValidator('param', msgParam, validationHook), async c => {
    const { id, messageId } = c.req.valid('param');
    const db = c.var.db;
    await getAccessibleChat(db, id, c.var.memberId);
    const [msg] = await db
      .select({ id: chatMessages.id, senderMemberId: chatMessages.senderMemberId })
      .from(chatMessages)
      .where(and(eq(chatMessages.id, messageId), eq(chatMessages.chatId, id), isNull(chatMessages.deletedAt)))
      .limit(1);
    if (!msg) throw notFound('Message');
    if (msg.senderMemberId !== c.var.memberId) throw forbidden('You can only delete your own messages');

    await db.update(chatMessages).set({ deletedAt: new Date() }).where(eq(chatMessages.id, messageId));
    await refreshChatPreview(db, id);
    await recordEvent(db, {
      workspaceId: c.var.workspaceId,
      type: 'chat.message_deleted',
      entity: 'chat',
      recordId: id,
      actorId: c.var.memberId,
      payload: { messageId },
    });
    return c.json({ ok: true as const });
  });
