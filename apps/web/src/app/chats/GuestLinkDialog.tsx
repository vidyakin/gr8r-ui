/* Управление гостевой ссылкой клиентского чата (/c/:token): копировать, перевыпустить, отозвать, имя и язык клиента */
import * as React from 'react';
import { Check, Copy, Link2, RefreshCw, ShieldOff } from 'lucide-react';
import { Alert, Button, Dialog, DialogContent, Field, Input, Select, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { CHAT_LANGUAGE_CODES, guestChatUrl, useChatActions, type ChatListItem } from './data';

interface GuestLinkDialogProps {
  chat: ChatListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GuestLinkDialog({ chat, open, onOpenChange }: GuestLinkDialogProps) {
  const t = useT();
  const actions = useChatActions();
  const [guestName, setGuestName] = React.useState('');
  const [guestLanguage, setGuestLanguage] = React.useState('en');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!chat || !open) return;
    setGuestName(chat.guestName ?? '');
    setGuestLanguage(chat.guestLanguage || 'en');
    setCopied(false);
  }, [chat, open]);

  if (!chat) return null;

  const publicUrl = chat.guestToken ? guestChatUrl(chat.guestToken) : '';
  const langOptions = CHAT_LANGUAGE_CODES.map(code => ({ value: code, label: t(`chats.languages.${code}`) }));

  const copyLink = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    toast.success(t('chats.guestDialog.copied'));
    window.setTimeout(() => setCopied(false), 2000);
  };

  const runAction = async (action: 'enable' | 'rotate' | 'revoke') => {
    setBusy(action);
    try {
      await actions.manageGuestLink(chat.id, {
        action,
        guestName: guestName.trim() || undefined,
        guestLanguage,
      });
      toast.success(
        t(
          action === 'revoke'
            ? 'chats.guestDialog.revoked'
            : action === 'rotate'
              ? 'chats.guestDialog.rotated'
              : 'chats.guestDialog.enabled',
        ),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    setBusy('save');
    try {
      await actions.updateChat(chat.id, {
        guestName: guestName.trim() || undefined,
        guestLanguage,
      });
      toast.success(t('chats.guestDialog.saved'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('chats.guestDialog.title')}
        description={t('chats.guestDialog.description')}
        footer={
          <>
            <span className="sp" />
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('chats.guestDialog.close')}
            </Button>
            <Button variant="primary" loading={busy === 'save'} disabled={busy !== null} onClick={() => void handleSave()}>
              {t('chats.guestDialog.save')}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 14 }}>
          {chat.guestToken ? (
            <Field label={t('chats.guestDialog.linkLabel')}>
              {p => (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <Input {...p} readOnly value={publicUrl} className="flex-1 font-mono text-xs" />
                    <Button size="sm" variant="secondary" onClick={() => void copyLink()}>
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      <span>{t('chats.guestDialog.copy')}</span>
                    </Button>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <Button size="sm" variant="ghost" loading={busy === 'rotate'} disabled={busy !== null} onClick={() => void runAction('rotate')}>
                      <RefreshCw size={13} />
                      <span>{t('chats.guestDialog.rotate')}</span>
                    </Button>
                    <Button size="sm" variant="danger-ghost" loading={busy === 'revoke'} disabled={busy !== null} onClick={() => void runAction('revoke')}>
                      <ShieldOff size={13} />
                      <span>{t('chats.guestDialog.revoke')}</span>
                    </Button>
                  </div>
                </div>
              )}
            </Field>
          ) : (
            <Alert
              tone="info"
              action={
                <Button size="sm" variant="primary" loading={busy === 'enable'} disabled={busy !== null} onClick={() => void runAction('enable')}>
                  <Link2 size={13} />
                  <span>{t('chats.guestDialog.enable')}</span>
                </Button>
              }
            >
              {t('chats.guestDialog.noLink')}
            </Alert>
          )}

          <Field label={t('chats.guestDialog.guestNameLabel')}>
            {p => <Input {...p} value={guestName} onChange={e => setGuestName(e.target.value)} placeholder={t('chats.newDialog.guestNamePlaceholder')} />}
          </Field>

          <Field label={t('chats.guestDialog.guestLangLabel')}>
            {p => <Select {...p} value={guestLanguage} onValueChange={setGuestLanguage} options={langOptions} />}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
