/* Публичный гостевой роут чата (/public/chats/:token) без авторизации, безопасный обход RLS по токену. */
import { zValidator } from '@hono/zod-validator';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { chats, withContext, workspaces, type Db, type Sql } from '@erp/db';
import { CHAT_LANGUAGES, publicChatMessageBody, publicChatPatchBody } from '@erp/shared';
import { validationHook } from '../crud';
import { notFound } from '../errors';
import { insertChatMessage, listChatMessages, loadRecentContext, toMessageDto } from '../chats/messages';
import { collectMissingTranslations, resolveTargetLanguages, scheduleBackfill, translateAndStoreMessage } from '../chats/service';
import type { AppEnv } from '../types';

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

async function resolveGuestChat(sql: Sql, token: string): Promise<{ id: string; workspaceId: string }> {
  if (!TOKEN_RE.test(token)) throw notFound('Chat');
  const [found] = await withContext(
    sql,
    {},
    db => db.select({ id: chats.id, workspaceId: chats.workspaceId }).from(chats).where(and(eq(chats.guestToken, token), isNull(chats.archivedAt))).limit(1),
    'app_worker',
  );
  if (!found) throw notFound('Chat');
  return found;
}

const loadActiveGuestChat = async (db: Db, id: string, token: string) => {
  const [chat] = await db.select().from(chats).where(and(eq(chats.id, id), eq(chats.guestToken, token), isNull(chats.archivedAt))).limit(1);
  return chat ?? null;
};

export const publicChatRoutes = new Hono<AppEnv>()
  .use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 86400 }))
  .get('/:token', async c => {
    const token = c.req.param('token');
    const sql = c.get('sql');
    const { id: chatId, workspaceId } = await resolveGuestChat(sql, token);
    const after = c.req.query('after')?.trim() || undefined;

    const payload = await withContext(sql, { workspaceId }, async db => {
      const chat = await loadActiveGuestChat(db, chatId, token);
      if (!chat) return null;
      const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      const page = await listChatMessages(db, chat, { after, limit: 100 });
      const wsName = ws?.name ?? '';
      return {
        chat: {
          id: chat.id,
          title: chat.title || chat.guestName || wsName,
          workspaceName: wsName,
          guestName: chat.guestName,
          guestLanguage: chat.guestLanguage,
        },
        messages: page.items,
        languages: [...CHAT_LANGUAGES],
      };
    });

    if (!payload) throw notFound('Chat');
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.json(payload);
  })
  .patch('/:token', zValidator('json', publicChatPatchBody, validationHook), async c => {
    const token = c.req.param('token');
    const body = c.req.valid('json');
    const sql = c.get('sql');
    const { id: chatId, workspaceId } = await resolveGuestChat(sql, token);

    const out = await withContext(sql, { workspaceId }, async db => {
      const chat = await loadActiveGuestChat(db, chatId, token);
      if (!chat) return null;
      const patch: Partial<typeof chats.$inferInsert> = {};
      if (body.guestName !== undefined) patch.guestName = body.guestName;
      if (body.guestLanguage !== undefined) patch.guestLanguage = body.guestLanguage;

      let updated = chat;
      if (Object.keys(patch).length) {
        patch.updatedAt = new Date();
        const [row] = await db.update(chats).set(patch).where(eq(chats.id, chatId)).returning();
        if (row) updated = row;
      }
      const missing =
        body.guestLanguage && body.guestLanguage !== chat.guestLanguage
          ? await collectMissingTranslations(db, chatId, body.guestLanguage)
          : [];
      return { guestName: updated.guestName, guestLanguage: updated.guestLanguage, missing };
    });

    if (!out) throw notFound('Chat');
    if (body.guestLanguage && out.missing.length) {
      scheduleBackfill(sql, workspaceId, chatId, body.guestLanguage, out.missing, c.get('config').landingAi);
    }
    return c.json({ ok: true as const, guestName: out.guestName, guestLanguage: out.guestLanguage });
  })
  .post('/:token/messages', zValidator('json', publicChatMessageBody, validationHook), async c => {
    const token = c.req.param('token');
    const body = c.req.valid('json');
    const sql = c.get('sql');
    const { id: chatId, workspaceId } = await resolveGuestChat(sql, token);

    const created = await withContext(sql, { workspaceId }, async db => {
      const chat = await loadActiveGuestChat(db, chatId, token);
      if (!chat) return null;
      const originalLanguage = body.language ?? chat.guestLanguage ?? 'en';
      const senderGuestName = body.guestName ?? chat.guestName ?? null;
      const targetLanguages = await resolveTargetLanguages(db, workspaceId, chat, originalLanguage);

      const msg = await insertChatMessage(db, {
        workspaceId,
        chatId,
        senderMemberId: null,
        senderGuestName,
        text: body.text,
        originalLanguage,
        translationStatus: targetLanguages.length > 0 ? 'pending' : 'none',
        updateGuestName: body.guestName && !chat.guestName ? body.guestName : null,
        guestEvent: true,
      });

      const context = targetLanguages.length > 0 ? await loadRecentContext(db, chatId, msg.id) : [];
      return { dto: toMessageDto(msg, new Map(), chat.guestName), originalLanguage, targetLanguages, context };
    });

    if (!created) throw notFound('Chat');
    if (created.targetLanguages.length > 0) {
      void translateAndStoreMessage({
        sql,
        workspaceId,
        chatId,
        messageId: created.dto.id,
        originalText: created.dto.originalText,
        originalLanguage: created.originalLanguage,
        targetLanguages: created.targetLanguages,
        context: created.context,
        aiConfig: c.get('config').landingAi,
      }).catch(err => console.error('[public-chats] translation failed:', err));
    }
    return c.json({ message: created.dto }, 201);
  });
