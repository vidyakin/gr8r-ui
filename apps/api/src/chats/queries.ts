/* Запросы и сборка DTO для списка чатов, участников и счётчика непрочитанных. */
import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { chatMembers, chatMessages, chats, members, users, workspaces, type Db } from '@erp/db';
import { DEFAULT_LOCALE, type ChatEntityType, type ChatKind } from '@erp/shared';

export interface ChatMemberDto {
  memberId: string;
  name: string;
  avatar: string | null;
  language: string;
}

export interface ChatListItem {
  id: string;
  kind: ChatKind;
  title: string;
  entityType: ChatEntityType | null;
  entityId: string | null;
  guestToken: string | null;
  guestName: string | null;
  guestLanguage: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  members: ChatMemberDto[];
}

export type ChatRow = typeof chats.$inferSelect;

export async function workspaceDefaultLocale(db: Db, workspaceId: string): Promise<string> {
  const [ws] = await db
    .select({ settings: workspaces.settings })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const loc = ws?.settings && typeof ws.settings.locale === 'string' ? ws.settings.locale.trim().toLowerCase() : '';
  return loc || DEFAULT_LOCALE;
}

export async function loadChatMembersMap(db: Db, chatIds: string[], wsLocale: string): Promise<Map<string, ChatMemberDto[]>> {
  const map = new Map<string, ChatMemberDto[]>();
  if (!chatIds.length) return map;
  const rows = await db
    .select({
      chatId: chatMembers.chatId,
      memberId: chatMembers.memberId,
      preferredLanguage: chatMembers.preferredLanguage,
      name: members.name,
      color: members.color,
      userLocale: users.locale,
    })
    .from(chatMembers)
    .innerJoin(members, eq(members.id, chatMembers.memberId))
    .leftJoin(users, eq(users.id, members.userId))
    .where(inArray(chatMembers.chatId, chatIds))
    .orderBy(asc(chatMembers.createdAt));

  for (const r of rows) {
    const list = map.get(r.chatId) ?? [];
    list.push({
      memberId: r.memberId,
      name: r.name,
      avatar: r.color ?? null,
      language: r.preferredLanguage || r.userLocale || wsLocale,
    });
    map.set(r.chatId, list);
  }
  return map;
}

async function loadUnreadMap(db: Db, chatIds: string[], currentMemberId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!chatIds.length) return map;
  const rows = await db
    .select({ chatId: chatMessages.chatId, n: sql<number>`count(*)::int` })
    .from(chatMessages)
    .leftJoin(chatMembers, and(eq(chatMembers.chatId, chatMessages.chatId), eq(chatMembers.memberId, currentMemberId)))
    .where(
      and(
        inArray(chatMessages.chatId, chatIds),
        isNull(chatMessages.deletedAt),
        or(isNull(chatMessages.senderMemberId), ne(chatMessages.senderMemberId, currentMemberId)),
        or(isNull(chatMembers.lastReadAt), gt(chatMessages.createdAt, chatMembers.lastReadAt)),
      ),
    )
    .groupBy(chatMessages.chatId);
  for (const r of rows) map.set(r.chatId, r.n);
  return map;
}

export async function buildChatItems(
  db: Db,
  workspaceId: string,
  rows: ChatRow[],
  currentMemberId: string,
): Promise<ChatListItem[]> {
  if (!rows.length) return [];
  const wsLocale = await workspaceDefaultLocale(db, workspaceId);
  const ids = rows.map(r => r.id);
  const [membersMap, unreadMap] = await Promise.all([
    loadChatMembersMap(db, ids, wsLocale),
    loadUnreadMap(db, ids, currentMemberId),
  ]);
  return rows.map(row => {
    const list = membersMap.get(row.id) ?? [];
    const directTitle =
      row.kind === 'direct' && !row.title
        ? (list.find(m => m.memberId !== currentMemberId)?.name ?? list[0]?.name ?? '')
        : row.title;
    return {
      id: row.id,
      kind: row.kind,
      title: directTitle,
      entityType: row.entityType,
      entityId: row.entityId,
      guestToken: row.guestToken,
      guestName: row.guestName,
      guestLanguage: row.guestLanguage,
      lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      lastMessagePreview: row.lastMessagePreview,
      unreadCount: unreadMap.get(row.id) ?? 0,
      members: list,
    };
  });
}
