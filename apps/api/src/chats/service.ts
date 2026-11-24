/* Сервис чатов: поиск существующих чатов, управление участниками, доступ и экспорт фонового перевода. */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { chatMembers, chatMessages, chats, members, type Db } from '@erp/db';
import type { ChatEntityType } from '@erp/shared';
import { AppError, notFound } from '../errors';
import { loadChatMembersMap, workspaceDefaultLocale, type ChatRow } from './queries';
import type { BackfillMessage } from './translate-job';

export { scheduleBackfill, scheduleTranslation, translateAndStoreMessage, type BackfillMessage, type TranslateAndStoreParams } from './translate-job';

const norm = (l: string) => l.trim().toLowerCase().split(/[-_]/)[0] ?? '';

export async function assertWorkspaceMembers(db: Db, memberIds: string[]): Promise<void> {
  const unique = [...new Set(memberIds)];
  if (!unique.length) return;
  const rows = await db.select({ id: members.id }).from(members).where(inArray(members.id, unique));
  if (rows.length !== unique.length) {
    throw new AppError(400, 'invalid_member', 'One or more members do not belong to this workspace');
  }
}

export async function syncChatMembers(db: Db, workspaceId: string, chatId: string, nextIds: string[]): Promise<void> {
  await assertWorkspaceMembers(db, nextIds);
  const existing = await db.select({ memberId: chatMembers.memberId }).from(chatMembers).where(eq(chatMembers.chatId, chatId));
  const nextSet = new Set(nextIds);
  const toRemove = existing.map(r => r.memberId).filter(mid => !nextSet.has(mid));
  if (toRemove.length) {
    await db.delete(chatMembers).where(and(eq(chatMembers.chatId, chatId), inArray(chatMembers.memberId, toRemove)));
  }
  await db.insert(chatMembers).values(nextIds.map(memberId => ({ workspaceId, chatId, memberId }))).onConflictDoNothing();
}

export async function findDirectChat(db: Db, a: string, b: string): Promise<ChatRow | null> {
  const pair = [...new Set([a, b])];
  const ids = await db
    .select({ chatId: chatMembers.chatId })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .where(and(eq(chats.kind, 'direct'), isNull(chats.archivedAt)))
    .groupBy(chatMembers.chatId)
    .having(
      pair.length === 2
        ? sql`count(*) = 2 and count(*) filter (where ${inArray(chatMembers.memberId, pair)}) = 2`
        : sql`count(*) = 1 and count(*) filter (where ${eq(chatMembers.memberId, a)}) = 1`,
    )
    .limit(1);
  if (!ids[0]) return null;
  const [row] = await db.select().from(chats).where(eq(chats.id, ids[0].chatId)).limit(1);
  return row ?? null;
}

export async function findClientEntityChat(db: Db, entityType: ChatEntityType, entityId: string): Promise<ChatRow | null> {
  const [row] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.kind, 'client'), eq(chats.entityType, entityType), eq(chats.entityId, entityId), isNull(chats.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function getAccessibleChat(db: Db, chatId: string, memberId: string): Promise<ChatRow> {
  const [chat] = await db.select().from(chats).where(and(eq(chats.id, chatId), isNull(chats.archivedAt))).limit(1);
  if (!chat) throw notFound('Chat');
  if (chat.kind === 'client') return chat;
  const [membership] = await db
    .select({ id: chatMembers.id })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.memberId, memberId)))
    .limit(1);
  if (!membership) throw notFound('Chat');
  return chat;
}

export async function resolveTargetLanguages(db: Db, workspaceId: string, chat: ChatRow, originalLanguage: string): Promise<string[]> {
  const wsLocale = await workspaceDefaultLocale(db, workspaceId);
  const memberMap = await loadChatMembersMap(db, [chat.id], wsLocale);
  const src = norm(originalLanguage);
  const langs = new Set<string>();
  for (const m of memberMap.get(chat.id) ?? []) {
    const code = norm(m.language);
    if (code && code !== src) langs.add(code);
  }
  if (chat.kind === 'client' || chat.guestToken) {
    const g = norm(chat.guestLanguage);
    if (g && g !== src) langs.add(g);
  }
  return [...langs];
}

export async function collectMissingTranslations(db: Db, chatId: string, targetLang: string): Promise<BackfillMessage[]> {
  const target = norm(targetLang);
  const rows = await db
    .select({
      id: chatMessages.id,
      originalText: chatMessages.originalText,
      originalLanguage: chatMessages.originalLanguage,
      translations: chatMessages.translations,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.chatId, chatId), isNull(chatMessages.deletedAt)))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(20);
  const out: BackfillMessage[] = [];
  for (const r of rows.reverse()) {
    const orig = norm(r.originalLanguage ?? 'en');
    if (orig !== target && !r.translations?.[target]) {
      out.push({ id: r.id, originalText: r.originalText, originalLanguage: orig });
    }
  }
  return out;
}
