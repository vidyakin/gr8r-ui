/* Данные раздела /chats: TanStack Query хуки и действия для мультиязычных чатов с автопереводом */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export type ChatKind = 'direct' | 'group' | 'client';
export type ChatEntityType = 'lead' | 'deal' | 'company' | 'project';
export type ChatFilterKind = 'all' | 'team' | 'client';

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
  translationStatus: 'pending' | 'done' | 'failed' | 'none';
  feedback: 'like' | 'dislike' | null;
  createdAt: string;
}

export interface CreateChatInput {
  kind: ChatKind;
  title?: string;
  memberIds?: string[];
  entityType?: ChatEntityType;
  entityId?: string;
  guestName?: string;
  guestLanguage?: string;
  enableGuestLink?: boolean;
}

export interface UpdateChatInput {
  title?: string;
  guestName?: string;
  guestLanguage?: string;
  preferredLanguage?: string;
}

export interface GuestLinkInput {
  action: 'enable' | 'rotate' | 'revoke';
  guestName?: string;
  guestLanguage?: string;
}

export interface GuestLinkResponse {
  guestToken: string | null;
  path: string | null;
}

export { CHAT_LANGUAGE_CODES } from '@erp/shared';

export const chatsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'chats', ...rest] as const;

export function useChats(opts?: { kind?: ChatFilterKind; q?: string }) {
  const ws = useWsId();
  const kind = opts?.kind ?? 'all';
  const q = opts?.q?.trim() ?? '';
  const apiKind = kind === 'client' ? 'client' : '';

  return useQuery({
    queryKey: chatsKey(ws, 'list', kind, q),
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (apiKind) sp.set('kind', apiKind);
      if (q) sp.set('q', q);
      const qs = sp.toString();
      const res = await call<{ items: ChatListItem[] }>(ws, 'GET', `/chats${qs ? `?${qs}` : ''}`);
      if (kind === 'team') return res.items.filter(c => c.kind !== 'client');
      return res.items;
    },
    staleTime: 15_000,
  });
}

export function useChatMessages(chatId: string | undefined, limit = 50) {
  const ws = useWsId();
  return useQuery({
    queryKey: chatsKey(ws, 'messages', chatId, limit),
    queryFn: () => call<{ items: ChatMessageDto[]; nextCursor: string | null }>(ws, 'GET', `/chats/${chatId}/messages?limit=${limit}`),
    enabled: !!chatId,
    staleTime: 5_000,
    refetchInterval: query => {
      const items = query.state.data?.items;
      return items?.some(m => m.translationStatus === 'pending') ? 2500 : false;
    },
  });
}

export function useChatActions() {
  const ws = useWsId();
  const qc = useQueryClient();
  const invalidateAll = () => qc.invalidateQueries({ queryKey: chatsKey(ws) });
  const invalidateMessages = (chatId: string) => qc.invalidateQueries({ queryKey: chatsKey(ws, 'messages', chatId) });

  const run = async <T,>(fn: () => Promise<T>, opts?: { quiet?: boolean; chatId?: string }): Promise<T> => {
    try {
      const res = await fn();
      await (opts?.chatId ? Promise.all([invalidateMessages(opts.chatId), qc.invalidateQueries({ queryKey: chatsKey(ws, 'list') })]) : invalidateAll());
      return res;
    } catch (e) {
      if (!opts?.quiet) toast.error(errorMessage(e));
      throw e;
    }
  };

  return {
    createChat: (body: CreateChatInput) => run(() => call<{ chat: ChatListItem }>(ws, 'POST', '/chats', body).then(r => r.chat)),
    updateChat: (id: string, body: UpdateChatInput) => run(() => call<{ chat: ChatListItem }>(ws, 'PATCH', `/chats/${id}`, body).then(r => r.chat)),
    manageGuestLink: (id: string, body: GuestLinkInput) => run(() => call<GuestLinkResponse>(ws, 'POST', `/chats/${id}/guest-link`, body)),
    sendMessage: (chatId: string, body: { text: string; language?: string }) =>
      run(() => call<{ message: ChatMessageDto }>(ws, 'POST', `/chats/${chatId}/messages`, body).then(r => r.message), { chatId }),
    markRead: (chatId: string) =>
      run(() => call<{ ok: true }>(ws, 'POST', `/chats/${chatId}/read`), { quiet: true }),
    setFeedback: (chatId: string, messageId: string, feedback: 'like' | 'dislike' | 'none') =>
      run(() => call<{ ok: true; feedback: 'like' | 'dislike' | null }>(ws, 'POST', `/chats/${chatId}/messages/${messageId}/feedback`, { feedback }), { chatId }),
    deleteMessage: (chatId: string, messageId: string) =>
      run(() => call<{ ok: true }>(ws, 'DELETE', `/chats/${chatId}/messages/${messageId}`), { chatId }),
  };
}

/* Публичная гостевая ссылка (приложение на hash-роутере) */
export const guestChatUrl = (token: string) => `${window.location.origin}/#/c/${token}`;
