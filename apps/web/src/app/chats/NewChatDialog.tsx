/* Диалог создания чата: личный 1:1, групповой или клиентский с гостевой ссылкой */
import * as React from 'react';
import { Button, Checkbox, Choice, Dialog, DialogContent, Field, Input, Segmented, Select, Switch, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { CHAT_LANGUAGE_CODES, useChatActions, type ChatKind, type ChatListItem } from './data';

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (chat: ChatListItem) => void;
}

export function NewChatDialog({ open, onOpenChange, onCreated }: NewChatDialogProps) {
  const t = useT();
  const { data } = useWorkspace();
  const actions = useChatActions();

  const [kind, setKind] = React.useState<ChatKind>('direct');
  const [memberId, setMemberId] = React.useState('');
  const [memberIds, setMemberIds] = React.useState<string[]>([]);
  const [title, setTitle] = React.useState('');
  const [guestName, setGuestName] = React.useState('');
  const [guestLanguage, setGuestLanguage] = React.useState('en');
  const [enableGuestLink, setEnableGuestLink] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const others = React.useMemo(() => data.members.filter(m => m.id !== data.me), [data.members, data.me]);
  const langOptions = CHAT_LANGUAGE_CODES.map(code => ({ value: code, label: t(`chats.languages.${code}`) }));

  React.useEffect(() => {
    if (!open) return;
    setKind('direct');
    setMemberId(others[0]?.id ?? '');
    setMemberIds([]);
    setTitle('');
    setGuestName('');
    setGuestLanguage('en');
    setEnableGuestLink(true);
  }, [open, others]);

  const toggleMember = (id: string) =>
    setMemberIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const canSubmit =
    (kind === 'direct' && !!memberId) ||
    (kind === 'group' && !!title.trim()) ||
    (kind === 'client' && !!(title.trim() || guestName.trim()));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      const chat = await actions.createChat(
        kind === 'direct'
          ? { kind: 'direct', memberIds: [memberId] }
          : kind === 'group'
            ? { kind: 'group', title: title.trim(), memberIds }
            : {
                kind: 'client',
                title: (title.trim() || guestName.trim()),
                guestName: guestName.trim() || undefined,
                guestLanguage,
                enableGuestLink,
              },
      );
      toast.success(t('chats.newDialog.created'));
      onOpenChange(false);
      onCreated(chat);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('chats.newDialog.title')}
        description={t('chats.newDialog.description')}
        footer={
          <>
            <span className="sp" />
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('chats.newDialog.cancel')}
            </Button>
            <Button type="submit" form="new-chat-form" variant="primary" disabled={!canSubmit} loading={busy}>
              {t('chats.newDialog.create')}
            </Button>
          </>
        }
      >
        <form id="new-chat-form" className="stack" style={{ gap: 14 }} onSubmit={e => void handleSubmit(e)}>
          <Field label={t('chats.newDialog.kindLabel')}>
            {() => (
              <Segmented
                value={kind}
                onValueChange={setKind}
                items={[
                  { value: 'direct', label: t('chats.newDialog.direct') },
                  { value: 'group', label: t('chats.newDialog.group') },
                  { value: 'client', label: t('chats.newDialog.client') },
                ]}
              />
            )}
          </Field>

          {kind === 'direct' && (
            <Field label={t('chats.newDialog.memberLabel')}>
              {p =>
                others.length ? (
                  <Select
                    {...p}
                    value={memberId}
                    onValueChange={setMemberId}
                    placeholder={t('chats.newDialog.memberPlaceholder')}
                    options={others.map(m => ({ value: m.id, label: m.name }))}
                  />
                ) : (
                  <p className="muted text-sm">{t('chats.newDialog.noMembers')}</p>
                )
              }
            </Field>
          )}

          {kind === 'group' && (
            <>
              <Field label={t('chats.newDialog.titleLabel')}>
                {p => <Input {...p} value={title} onChange={e => setTitle(e.target.value)} placeholder={t('chats.newDialog.titlePlaceholder')} autoFocus />}
              </Field>
              <Field label={t('chats.newDialog.membersLabel')}>
                {() => (
                  <div className="stack max-h-[180px] overflow-y-auto rounded-lg border border-border p-2" style={{ gap: 6 }}>
                    {others.length ? (
                      others.map(m => (
                        <Choice key={m.id}>
                          <Checkbox checked={memberIds.includes(m.id)} onChange={() => toggleMember(m.id)} />
                          <span>{m.name}</span>
                        </Choice>
                      ))
                    ) : (
                      <span className="muted text-xs">{t('chats.newDialog.noMembers')}</span>
                    )}
                  </div>
                )}
              </Field>
            </>
          )}

          {kind === 'client' && (
            <>
              <Field label={t('chats.newDialog.titleLabel')}>
                {p => <Input {...p} value={title} onChange={e => setTitle(e.target.value)} placeholder={t('chats.newDialog.titlePlaceholder')} autoFocus />}
              </Field>
              <Field label={t('chats.newDialog.guestNameLabel')}>
                {p => <Input {...p} value={guestName} onChange={e => setGuestName(e.target.value)} placeholder={t('chats.newDialog.guestNamePlaceholder')} />}
              </Field>
              <Field label={t('chats.newDialog.guestLangLabel')}>
                {p => <Select {...p} value={guestLanguage} onValueChange={setGuestLanguage} options={langOptions} />}
              </Field>
              <Choice>
                <Switch checked={enableGuestLink} onChange={e => setEnableGuestLink(e.target.checked)} />
                <span>{t('chats.newDialog.enableGuestLink')}</span>
              </Choice>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
