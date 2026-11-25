/* Лента сообщений активного чата с автопереводом на текущий язык интерфейса, раскрытием оригинала и оценкой перевода */
import * as React from 'react';
import { ArrowLeft, Languages, Link2, Loader2, MessageSquare, Send, ThumbsDown, ThumbsUp, Trash2, Users } from 'lucide-react';
import { Avatar, Badge, Button, EmptyState, IconButton, Textarea } from '@/components/ui';
import { fmtDateTime, useLocale, useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { useChatActions, useChatMessages, type ChatListItem, type ChatMessageDto } from './data';

interface ChatThreadProps {
  chat: ChatListItem;
  onOpenGuestLink: () => void;
  onBack?: () => void;
}

function MessageBubble({
  msg,
  isMine,
  locale,
  onFeedback,
  onDelete,
}: {
  msg: ChatMessageDto;
  isMine: boolean;
  locale: string;
  onFeedback: (next: 'like' | 'dislike' | 'none') => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [showOrig, setShowOrig] = React.useState(false);
  const diffLang = !!msg.originalLanguage && msg.originalLanguage.toLowerCase() !== locale.toLowerCase();
  const translated = diffLang ? msg.translations?.[locale] : undefined;
  const displayText = translated ?? msg.originalText;
  const isPending = diffLang && !translated && msg.translationStatus === 'pending';
  const sender = msg.senderGuestName || msg.senderName;

  return (
    <div className={cn('flex flex-col gap-1 max-w-[88%] md:max-w-[78%]', isMine ? 'self-end items-end' : 'self-start items-start')}>
      <div className="flex items-center gap-1.5 text-xs muted px-1">
        <span className="font-medium text-text">{sender}</span>
        {!msg.senderMemberId && <Badge tone="violet">{t('chats.guestBadge')}</Badge>}
        <span>{fmtDateTime(msg.createdAt)}</span>
      </div>
      <div
        className={cn(
          'rounded-xl px-3.5 py-2.5 text-sm leading-relaxed border',
          isMine ? 'bg-brand/10 border-brand/25 text-text' : 'bg-surface border-border text-text',
        )}
        style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
      >
        <div>{displayText}</div>
        {isPending && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs muted">
            <Loader2 size={12} className="animate-spin" />
            <span>{t('chats.thread.translating')}</span>
          </div>
        )}
        {diffLang && showOrig && (
          <div className="mt-2 pt-2 border-t border-border/60 text-xs muted">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Badge tone="neutral">{msg.originalLanguage.toUpperCase()}</Badge>
              <span>{t('chats.thread.originalLabel', { lang: msg.originalLanguage.toUpperCase() })}</span>
            </div>
            <div className="text-text/80">{msg.originalText}</div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 px-1">
        {diffLang && translated && (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm !h-6 !px-1.5 !text-[11px] muted"
              onClick={() => setShowOrig(v => !v)}
            >
              <Languages size={12} />
              <span>{showOrig ? t('chats.thread.hideOriginal') : t('chats.thread.showOriginal')}</span>
            </button>
            <IconButton
              size="xs"
              label={t('chats.thread.like')}
              active={msg.feedback === 'like'}
              onClick={() => onFeedback(msg.feedback === 'like' ? 'none' : 'like')}
            >
              <ThumbsUp size={12} />
            </IconButton>
            <IconButton
              size="xs"
              label={t('chats.thread.dislike')}
              active={msg.feedback === 'dislike'}
              onClick={() => onFeedback(msg.feedback === 'dislike' ? 'none' : 'dislike')}
            >
              <ThumbsDown size={12} />
            </IconButton>
          </>
        )}
        {isMine && (
          <IconButton size="xs" label={t('chats.thread.deleteMessage')} onClick={onDelete}>
            <Trash2 size={12} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

export function ChatThread({ chat, onOpenGuestLink, onBack }: ChatThreadProps) {
  const t = useT();
  const locale = useLocale();
  const { data } = useWorkspace();
  const actions = useChatActions();
  const messagesQuery = useChatMessages(chat.id);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  const items = messagesQuery.data?.items ?? [];

  React.useEffect(() => {
    if (chat.unreadCount > 0) void actions.markRead(chat.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id, chat.unreadCount]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.id, items.length]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await actions.sendMessage(chat.id, { text, language: locale });
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  const title = chat.title || chat.guestName || t('chats.unnamed');

  return (
    <section className="flex flex-col h-full min-h-0 bg-bg">
      <header className="flex items-center gap-2.5 md:gap-3 px-3 md:px-4 py-2.5 md:py-3 border-b border-border bg-surface shrink-0">
        {onBack && (
          <IconButton
            size="sm"
            label={t('chats.title')}
            onClick={onBack}
            className="md:hidden shrink-0 -ml-1"
          >
            <ArrowLeft size={18} />
          </IconButton>
        )}
        <Avatar name={title} size="md" tooltip={false} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold trunc">{title}</h2>
            <Badge tone={chat.kind === 'client' ? 'violet' : 'neutral'} className="shrink-0">{t(`chats.kinds.${chat.kind}`)}</Badge>
          </div>
          <div className="flex items-center gap-2 text-xs muted mt-0.5 trunc">
            {chat.kind === 'client' ? (
              <span className="trunc">
                {chat.guestName ? `${chat.guestName} · ` : ''}
                {t('chats.thread.autoTranslateHint', { lang: locale.toUpperCase() })}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Users size={12} />
                {t('chats.membersCount', { count: chat.members.length })}
              </span>
            )}
          </div>
        </div>
        {chat.kind === 'client' && (
          <Button size="sm" variant={chat.guestToken ? 'secondary' : 'ghost'} onClick={onOpenGuestLink} className="shrink-0">
            <Link2 size={14} />
            <span className="hide-m">{t('chats.thread.guestLink')}</span>
          </Button>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messagesQuery.isLoading ? (
          <div className="flex items-center justify-center flex-1 muted text-sm gap-2">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState size="sm" icon={<MessageSquare size={22} />} title={t('chats.thread.noMessages')}>
              {t('chats.thread.noMessagesHint')}
            </EmptyState>
          </div>
        ) : (
          items.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isMine={msg.senderMemberId === data.me}
              locale={locale}
              onFeedback={fb => void actions.setFeedback(chat.id, msg.id, fb)}
              onDelete={() => void actions.deleteMessage(chat.id, msg.id)}
            />
          ))
        )}
        <div ref={endRef} />
      </div>

      <form
        className="p-3 border-t border-border bg-surface shrink-0"
        style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
        onSubmit={e => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={draft}
            placeholder={t('chats.thread.placeholder')}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            className="flex-1 resize-none min-h-[44px] max-h-[140px]"
          />
          <Button type="submit" variant="primary" disabled={!draft.trim()} loading={sending}>
            <Send size={14} />
            <span className="hide-m">{t('chats.thread.send')}</span>
          </Button>
        </div>
        <div className="text-[11px] faint mt-1.5 hide-m">{t('chats.thread.sendHint')}</div>
      </form>
    </section>
  );
}
