/* Раздел /chats: двухколоночный мультиязычный мессенджер (список диалогов слева + лента с автопереводом справа) */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { Globe, MessageSquare, Plus, Search, Users } from 'lucide-react';
import { Avatar, Badge, Button, EmptyState, Input, Segmented } from '@/components/ui';
import { fmtDateTime, useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { ChatThread } from './ChatThread';
import { GuestLinkDialog } from './GuestLinkDialog';
import { NewChatDialog } from './NewChatDialog';
import { useChats, type ChatFilterKind, type ChatListItem } from './data';

function ChatRow({ chat, active, onClick }: { chat: ChatListItem; active: boolean; onClick: () => void }) {
  const t = useT();
  const title = chat.title || chat.guestName || t('chats.unnamed');

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left flex items-start gap-2.5 px-3 py-2.5 border-b border-border/50 transition-colors',
        active ? 'bg-brand/10' : 'hover:bg-surface-2',
      )}
    >
      <Avatar name={title} size="md" tooltip={false} className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm trunc flex-1 text-text">{title}</span>
          {chat.lastMessageAt && (
            <span className="text-[11px] faint shrink-0">{fmtDateTime(chat.lastMessageAt)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs muted trunc flex-1">
            {chat.lastMessagePreview || t('chats.noMessages')}
          </span>
          {chat.unreadCount > 0 && (
            <Badge tone="accent" className="shrink-0">
              {chat.unreadCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          {chat.kind === 'client' ? (
            <span className="inline-flex items-center gap-1 text-[11px] muted">
              <Globe size={11} />
              {t('chats.kinds.client')}
              {chat.guestLanguage ? ` · ${chat.guestLanguage.toUpperCase()}` : ''}
            </span>
          ) : chat.kind === 'group' ? (
            <span className="inline-flex items-center gap-1 text-[11px] muted">
              <Users size={11} />
              {t('chats.membersCount', { count: chat.members.length })}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export function ChatsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { chatId } = useParams<{ chatId?: string }>();
  const [filter, setFilter] = React.useState<ChatFilterKind>('all');
  const [search, setSearch] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [newOpen, setNewOpen] = React.useState(false);
  const [guestOpen, setGuestOpen] = React.useState(false);

  React.useEffect(() => {
    const id = window.setTimeout(() => setQuery(search), 220);
    return () => window.clearTimeout(id);
  }, [search]);

  const chatsQuery = useChats({ kind: filter, q: query });
  const chats = chatsQuery.data ?? [];
  const activeChat = React.useMemo(
    () => (chatId ? chats.find(c => c.id === chatId) ?? null : null),
    [chats, chatId],
  );

  const openChat = (id: string) => navigate(`/chats/${id}`);

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-bg">
      <aside className="w-[320px] max-w-[42vw] shrink-0 border-r border-border bg-surface flex flex-col min-h-0">
        <div className="p-3 border-b border-border flex flex-col gap-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-base font-semibold trunc">{t('chats.title')}</h1>
            <Button size="sm" variant="primary" onClick={() => setNewOpen(true)}>
              <Plus size={14} />
              <span>{t('chats.newChat')}</span>
            </Button>
          </div>
          <Input
            size="sm"
            icon={<Search size={13} />}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('chats.search')}
          />
          <Segmented
            value={filter}
            onValueChange={setFilter}
            items={[
              { value: 'all', label: t('chats.all') },
              { value: 'team', label: t('chats.team') },
              { value: 'client', label: t('chats.clients') },
            ]}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {chatsQuery.isLoading ? (
            <div className="p-4 text-sm muted">{t('common.loading')}</div>
          ) : chats.length === 0 ? (
            <div className="p-4">
              <EmptyState
                size="sm"
                icon={<MessageSquare size={20} />}
                title={query ? t('chats.emptySearch') : t('chats.emptyList')}
                action={
                  !query && (
                    <Button size="sm" variant="primary" onClick={() => setNewOpen(true)}>
                      <Plus size={14} />
                      <span>{t('chats.newChat')}</span>
                    </Button>
                  )
                }
              >
                {!query && t('chats.emptyListHint')}
              </EmptyState>
            </div>
          ) : (
            chats.map(chat => (
              <ChatRow
                key={chat.id}
                chat={chat}
                active={chat.id === activeChat?.id}
                onClick={() => openChat(chat.id)}
              />
            ))
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        {activeChat ? (
          <ChatThread chat={activeChat} onOpenGuestLink={() => setGuestOpen(true)} />
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            <EmptyState
              icon={<MessageSquare size={26} />}
              title={t('chats.selectChat')}
              action={
                <Button variant="primary" onClick={() => setNewOpen(true)}>
                  <Plus size={14} />
                  <span>{t('chats.newChat')}</span>
                </Button>
              }
            >
              {t('chats.selectChatHint')}
            </EmptyState>
          </div>
        )}
      </main>

      <NewChatDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={chat => openChat(chat.id)}
      />
      <GuestLinkDialog
        chat={activeChat}
        open={guestOpen}
        onOpenChange={setGuestOpen}
      />
    </div>
  );
}
