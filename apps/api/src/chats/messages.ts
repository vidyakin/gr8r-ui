/* Сообщения чата: DTO, курсорная пагинация, контекст, вставка и обновление предпросмотра. */
import { and, desc, eq, gt, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { chatMessages, chats, isUuid, members, recordEvent, type Db } from '@erp/db';
import type { ChatMessageFeedback, ChatTranslationStatus } from '@erp/shared';
import type { ChatRow } from './queries';
import type { TranslateContextItem } from './translator';

export interface ChatMessageDto {
  id: string;
  chatId: string;
  senderMemberId: string | null;
  senderName: string;
  senderGuestName: string | null;
  originalText: string;
  originalLanguage: string;
  translations: Record<string, string>;
  translationProvider: string | null;
  translationStatus: ChatTranslationStatus;
  feedback: ChatMessageFeedback | null;
  createdAt: string;
}

export type ChatMessageRow = typeof chatMessages.$inferSelect;

export async function loadSenderNames(db: Db, rows: ChatMessageRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map(r => r.senderMemberId).filter((x): x is string => Boolean(x)))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const list = await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, ids));
  for (const m of list) map.set(m.id, m.name);
  return map;
}

export const toMessageDto = (
  row: ChatMessageRow,
  senderNames: Map<string, string>,
  chatGuestName: string | null,
): ChatMessageDto => ({
  id: row.id,
  chatId: row.chatId,
  senderMemberId: row.senderMemberId,
  senderName: row.senderMemberId
    ? (senderNames.get(row.senderMemberId) ?? 'Member')
    : (row.senderGuestName ?? chatGuestName ?? 'Guest'),
  senderGuestName: row.senderGuestName,
  originalText: row.originalText,
  originalLanguage: row.originalLanguage ?? 'en',
  translations: row.translations ?? {},
  translationProvider: row.translationProvider,
  translationStatus: row.translationStatus,
  feedback: row.feedback,
  createdAt: row.createdAt.toISOString(),
});

export async function listChatMessages(
  db: Db,
  chat: Pick<ChatRow, 'id' | 'guestName'>,
  opts: { cursor?: string; after?: string; limit: number },
): Promise<{ items: ChatMessageDto[]; nextCursor: string | null }> {
  const conds = [eq(chatMessages.chatId, chat.id), isNull(chatMessages.deletedAt)];
  if (opts.cursor && isUuid(opts.cursor)) {
    const [pivot] = await db
      .select({ id: chatMessages.id, createdAt: chatMessages.createdAt })
      .from(chatMessages)
      .where(and(eq(chatMessages.id, opts.cursor), eq(chatMessages.chatId, chat.id)))
      .limit(1);
    if (!pivot) return { items: [], nextCursor: null };
    conds.push(or(lt(chatMessages.createdAt, pivot.createdAt), and(eq(chatMessages.createdAt, pivot.createdAt), lt(chatMessages.id, pivot.id)))!);
  }
  if (opts.after) {
    if (isUuid(opts.after)) {
      const [pivot] = await db
        .select({ id: chatMessages.id, createdAt: chatMessages.createdAt })
        .from(chatMessages)
        .where(and(eq(chatMessages.id, opts.after), eq(chatMessages.chatId, chat.id)))
        .limit(1);
      if (pivot) conds.push(or(gt(chatMessages.createdAt, pivot.createdAt), and(eq(chatMessages.createdAt, pivot.createdAt), gt(chatMessages.id, pivot.id)))!);
    } else {
      const dt = new Date(opts.after);
      if (!Number.isNaN(dt.getTime())) conds.push(gt(chatMessages.createdAt, dt));
    }
  }
  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(...conds))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(opts.limit + 1);
  const hasMore = rows.length > opts.limit;
  const page = (hasMore ? rows.slice(0, opts.limit) : rows).reverse();
  const names = await loadSenderNames(db, page);
  const items = page.map(r => toMessageDto(r, names, chat.guestName));
  return { items, nextCursor: hasMore && items.length ? items[0]!.id : null };
}

export async function loadRecentContext(db: Db, chatId: string, beforeMessageId?: string): Promise<TranslateContextItem[]> {
  const rows = await db
    .select({ id: chatMessages.id, lang: chatMessages.originalLanguage, text: chatMessages.originalText })
    .from(chatMessages)
    .where(and(eq(chatMessages.chatId, chatId), isNull(chatMessages.deletedAt), beforeMessageId ? ne(chatMessages.id, beforeMessageId) : undefined))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(10);
  return rows.reverse().map(r => ({ lang: r.lang, text: r.text }));
}

export async function insertChatMessage(
  db: Db,
  params: {
    workspaceId: string;
    chatId: string;
    senderMemberId: string | null;
    senderGuestName?: string | null;
    text: string;
    originalLanguage: string;
    translationStatus: ChatTranslationStatus;
    updateGuestName?: string | null;
    guestEvent?: boolean;
  },
): Promise<ChatMessageRow> {
  const [msg] = await db
    .insert(chatMessages)
    .values({
      workspaceId: params.workspaceId,
      chatId: params.chatId,
      senderMemberId: params.senderMemberId,
      senderGuestName: params.senderGuestName ?? null,
      originalText: params.text,
      originalLanguage: params.originalLanguage,
      translations: {},
      translationStatus: params.translationStatus,
    })
    .returning();

  await db
    .update(chats)
    .set({
      ...(params.updateGuestName ? { guestName: params.updateGuestName } : {}),
      lastMessageAt: msg!.createdAt,
      lastMessagePreview: params.text.slice(0, 140),
      updatedAt: msg!.createdAt,
    })
    .where(eq(chats.id, params.chatId));

  await recordEvent(db, {
    workspaceId: params.workspaceId,
    type: 'chat.message',
    entity: 'chat',
    recordId: params.chatId,
    actorId: params.senderMemberId,
    payload: { messageId: msg!.id, ...(params.guestEvent ? { guest: true } : {}) },
  });
  return msg!;
}

export async function refreshChatPreview(db: Db, chatId: string): Promise<void> {
  const [last] = await db
    .select({ text: chatMessages.originalText, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(and(eq(chatMessages.chatId, chatId), isNull(chatMessages.deletedAt)))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(1);
  await db
    .update(chats)
    .set({
      lastMessageAt: last ? last.createdAt : null,
      lastMessagePreview: last ? last.text.slice(0, 140) : null,
      updatedAt: new Date(),
    })
    .where(eq(chats.id, chatId));
}
