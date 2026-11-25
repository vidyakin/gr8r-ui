/* Раздел /chats: двухколоночный мультиязычный мессенджер (список диалогов слева + лента с автопереводом справа) */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { Globe, MessageSquare, Plus, Search, Users, Volume2, VolumeX, X } from 'lucide-react';
import { Avatar, Badge, Button, EmptyState, IconButton, Input, Segmented } from '@/components/ui';
import { fmtDateTime, useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { ChatThread } from './ChatThread';
import { GuestLinkDialog } from './GuestLinkDialog';
import { NewChatDialog } from './NewChatDialog';
import { useChats, type ChatFilterKind, type ChatListItem } from './data';
import { isChatSoundMuted, playChatNotificationSound, setChatSoundMuted } from './sound';

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
  const [mobileSearchOpen, setMobileSearchOpen] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [guestOpen, setGuestOpen] = React.useState(false);
  const [muted, setMuted] = React.useState(() => isChatSoundMuted());
  const prevUnreadRef = React.useRef<Map<string, number> | null>(null);

  React.useEffect(() => {
    const id = window.setTimeout(() => setQuery(search), 220);
    return () => window.clearTimeout(id);
  }, [search]);

  const chatsQuery = useChats({ kind: filter, q: query });
  const chats = chatsQuery.data ?? [];

  React.useEffect(() => {
    if (!chatsQuery.data) return;
    const prev = prevUnreadRef.current;
    const next = new Map<string, number>();
    let hasNewIncoming = false;
    for (const c of chatsQuery.data) {
      next.set(c.id, c.unreadCount);
      if (prev) {
        const oldCount = prev.get(c.id) ?? 0;
        if (c.unreadCount > oldCount) hasNewIncoming = true;
      }
    }
    prevUnreadRef.current = next;
    if (hasNewIncoming) playChatNotificationSound();
  }, [chatsQuery.data]);

  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    setChatSoundMuted(next);
  };
  const activeChat = React.useMemo(
    () => (chatId ? chats.find(c => c.id === chatId) ?? null : null),
    [chats, chatId],
  );

  const openChat = (id: string) => navigate(`/chats/${id}`);
  const toggleMobileSearch = () => {
    setMobileSearchOpen(prev => {
      if (prev) {
        setSearch('');
        setQuery('');
      }
      return !prev;
    });
  };

  const filterItems: { value: ChatFilterKind; label: string }[] = [
    { value: 'all', label: t('chats.all') },
    { value: 'team', label: t('chats.team') },
    { value: 'client', label: t('chats.clients') },
  ];

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-bg">
      <aside
        className={cn(
          'relative w-full md:w-[320px] md:max-w-[42vw] shrink-0 md:border-r border-border bg-surface flex-col min-h-0',
          activeChat ? 'hidden md:flex' : 'flex',
        )}
      >
        {/* Мобильная верхняя панель: переключатель + звук + лупа, выпадающая строка поиска ниже */}
        <div className="md:hidden px-3 py-2 border-b border-border flex flex-col gap-2 shrink-0 bg-surface">
          <div className="flex items-center gap-1.5">
            <Segmented
              value={filter}
              onValueChange={setFilter}
              className="flex-1 min-w-0 [&>button]:flex-1 [&>button]:justify-center [&>button]:px-2 [&>button]:text-xs"
              items={filterItems}
            />
            <IconButton
              size="sm"
              label={muted ? 'Unmute sound' : 'Mute sound'}
              onClick={toggleSound}
              className="shrink-0"
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </IconButton>
            <IconButton
              size="sm"
              label={t('chats.search')}
              active={mobileSearchOpen || !!search}
              onClick={toggleMobileSearch}
              className="shrink-0"
            >
              {mobileSearchOpen ? <X size={16} /> : <Search size={16} />}
            </IconButton>
          </div>
          {mobileSearchOpen && (
            <Input
              autoFocus
              size="sm"
              icon={<Search size={13} />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('chats.search')}
            />
          )}
        </div>

        {/* Десктопная/планшетная шапка списка чатов */}
        <div className="hidden md:flex p-3 border-b border-border flex-col gap-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-base font-semibold trunc">{t('chats.title')}</h1>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={toggleSound} aria-label={muted ? 'Unmute sound' : 'Mute sound'}>
                {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </Button>
              <Button size="sm" variant="primary" onClick={() => setNewOpen(true)}>
                <Plus size={14} />
                <span>{t('chats.newChat')}</span>
              </Button>
            </div>
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
            items={filterItems}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pb-20 md:pb-0">
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

        <button
          type="button"
          onClick={() => setNewOpen(true)}
          aria-label={t('chats.newChat')}
          title={t('chats.newChat')}
          className="md:hidden absolute right-4 z-10 w-12 h-12 rounded-full bg-brand text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
          style={{ bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))' }}
        >
          <Plus size={22} />
        </button>
      </aside>

      <main className={cn('flex-1 min-w-0 min-h-0 flex-col', activeChat ? 'flex' : 'hidden md:flex')}>
        {activeChat ? (
          <ChatThread
            chat={activeChat}
            onOpenGuestLink={() => setGuestOpen(true)}
            onBack={() => navigate('/chats')}
          />
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
