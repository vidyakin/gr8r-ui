/* Кнопка «Чат с клиентом (автоперевод)» для карточек CRM: открывает/создаёт клиентский чат по сущности и копирует гостевую ссылку */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Check, Link2, MessageSquare } from 'lucide-react';
import { Button, IconButton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { guestChatUrl } from './data';

export interface EntityChatButtonProps {
  entityType: 'lead' | 'deal' | 'company';
  entityId: string;
  title: string;
  guestName?: string;
  guestLanguage?: string;
  size?: 'sm' | 'md';
}

interface CreateChatResponse {
  chat: {
    id: string;
    guestToken: string | null;
  };
}

export function EntityChatButton({
  entityType,
  entityId,
  title,
  guestName,
  guestLanguage,
  size = 'sm',
}: EntityChatButtonProps) {
  const ws = useWsId();
  const navigate = useNavigate();
  const t = useT();
  const [busy, setBusy] = React.useState<'open' | 'copy' | null>(null);
  const [copied, setCopied] = React.useState(false);

  const ensureChat = React.useCallback(async () => {
    const body: Record<string, unknown> = {
      kind: 'client',
      title,
      entityType,
      entityId,
      enableGuestLink: true,
    };
    if (guestName) body.guestName = guestName;
    if (guestLanguage) body.guestLanguage = guestLanguage;
    return call<CreateChatResponse>(ws, 'POST', '/chats', body);
  }, [ws, title, entityType, entityId, guestName, guestLanguage]);

  const handleOpen = async () => {
    setBusy('open');
    try {
      const res = await ensureChat();
      navigate(`/chats/${res.chat.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    setBusy('copy');
    try {
      const res = await ensureChat();
      const token = res.chat.guestToken;
      if (!token) {
        toast.error(t('crm.clientChat.noLink'));
        return;
      }
      const url = guestChatUrl(token);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t('crm.clientChat.linkCopied'));
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="row" style={{ gap: 2, display: 'inline-flex', alignItems: 'center' }}>
      <Button
        type="button"
        size={size}
        variant="ghost"
        loading={busy === 'open'}
        disabled={busy !== null}
        onClick={() => void handleOpen()}
      >
        <MessageSquare size={size === 'sm' ? 13 : 15} />
        <span className="hide-m">{t('crm.clientChat.button')}</span>
      </Button>
      <IconButton
        size={size}
        label={t('crm.clientChat.copyLink')}
        disabled={busy !== null}
        onClick={() => void handleCopy()}
      >
        {copied ? <Check size={size === 'sm' ? 13 : 15} /> : <Link2 size={size === 'sm' ? 13 : 15} />}
      </IconButton>
    </span>
  );
}
