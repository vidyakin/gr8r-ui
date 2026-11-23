/* Боковая карточка сессии ИИ-чата: метаданные, переписка по ролям, создание лида и удаление. */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Clock, Database, GitBranch, Globe, Languages, Link2, Monitor, Trash2, User, UserPlus } from 'lucide-react';
import { Badge, Button, ConfirmDialog, toast } from '@/components/ui';
import { DrawerSection, EntityDrawer, type DrawerField } from '@/components/erp/entity-drawer';
import { useT } from '@/i18n';
import { fmtDateTime } from '@/i18n/format';
import { firstUserMessage, useAiChatSettings, useAiChatsApi, type AiChatSession } from './ai-chats-data';
import { AiChatText } from './AiChatText';

export function AiChatDrawer({ session, onClose }: { session: AiChatSession; onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const api = useAiChatsApi();
  const settings = useAiChatSettings();
  const [creatingLead, setCreatingLead] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const stageTitle = React.useMemo(() => {
    if (!session.currentNodeId) return null;
    return settings.data?.script?.nodes.find(n => n.id === session.currentNodeId)?.title ?? session.currentNodeId;
  }, [session.currentNodeId, settings.data]);

  const collectedEntries = React.useMemo(
    () => Object.entries(session.collectedData ?? {}).filter(([, v]) => v !== '' && v != null),
    [session.collectedData],
  );

  const handleCreateLead = async () => {
    setCreatingLead(true);
    const res = await api.createLead(session.id);
    setCreatingLead(false);
    if (res) toast.success(t('aiChats.actions.leadCreated'));
  };

  const handleDelete = async () => {
    const ok = await api.remove(session.id);
    if (ok) onClose();
  };

  const fields: DrawerField[] = [
    ...(session.visitorName ? [{ icon: User, label: t('aiChats.meta.visitor'), value: <span style={{ fontWeight: 500 }}>{session.visitorName}</span> }] : []),
    ...(stageTitle ? [{ icon: GitBranch, label: t('aiChats.meta.stage'), value: <Badge tone="accent">{stageTitle}</Badge> }] : []),
    ...(collectedEntries.length > 0
      ? [
          {
            icon: Database,
            label: t('aiChats.meta.collected'),
            value: (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {collectedEntries.map(([k, v]) => (
                  <Badge key={k} tone="neutral">
                    <span className="muted">{k}:</span>
                    <strong>{v}</strong>
                  </Badge>
                ))}
              </div>
            ),
          },
        ]
      : []),
    { icon: Globe, label: t('aiChats.meta.ip'), value: <span className="num">{session.ip}</span> },
    { icon: Link2, label: t('aiChats.meta.page'), value: <span className="trunc">{session.pageUrl || '—'}</span> },
    { icon: Languages, label: t('aiChats.meta.locale'), value: <Badge tone="accent">{session.locale.toUpperCase()}</Badge> },
    { icon: Clock, label: t('aiChats.meta.started'), value: <span className="num">{fmtDateTime(session.createdAt)}</span> },
    { icon: Clock, label: t('aiChats.meta.updated'), value: <span className="num">{fmtDateTime(session.updatedAt)}</span> },
    {
      icon: Monitor,
      label: t('aiChats.meta.userAgent'),
      value: <span className="muted" style={{ fontSize: 12, wordBreak: 'break-word' }}>{session.userAgent || '—'}</span>,
    },
  ];

  const title = firstUserMessage(session) || t('aiChats.drawerTitle');

  return (
    <>
      <EntityDrawer
        trackName="ai-chat"
        label={`${t('aiChats.drawerTitle')}: ${session.botName}`}
        crumb={<span className="muted num">{session.visitorName || session.botName}</span>}
        title={title}
        subtitle={fmtDateTime(session.updatedAt)}
        fields={fields}
        actions={
          <div className="row" style={{ gap: 6 }}>
            {session.leadId ? (
              <>
                <Badge tone="green">{t('aiChats.actions.leadCreated')}</Badge>
                <Button size="sm" variant="ghost" onClick={() => void nav('/crm/leads')}>
                  {t('aiChats.actions.openLeads')}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="primary" loading={creatingLead} onClick={() => void handleCreateLead()}>
                <UserPlus size={13} />
                {t('aiChats.actions.createLead')}
              </Button>
            )}
            <Button size="sm" variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} />
              {t('aiChats.actions.delete')}
            </Button>
          </div>
        }
        onClose={onClose}
      >
        <DrawerSection title={t('aiChats.transcript')} count={session.messages.length}>
          {session.messages.length === 0 ? (
            <p className="faint" style={{ fontSize: 13 }}>{t('aiChats.noMessages')}</p>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {session.messages.map((m, i) => {
                const isUser = m.role === 'user';
                return (
                  <div
                    key={`${m.ts}-${i}`}
                    style={{
                      alignSelf: isUser ? 'flex-end' : 'flex-start',
                      maxWidth: '88%',
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--line)',
                      background: isUser ? 'var(--bg-2)' : 'var(--surf)',
                    }}
                  >
                    <div className="row faint" style={{ gap: 8, fontSize: 11.5, marginBottom: 4, justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 500 }}>{isUser ? t('aiChats.role.visitor') : t('aiChats.role.assistant')}</span>
                      <span className="num">{fmtDateTime(m.ts)}</span>
                    </div>
                    <AiChatText text={m.content} />
                  </div>
                );
              })}
            </div>
          )}
        </DrawerSection>
      </EntityDrawer>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        danger
        title={t('aiChats.actions.delete')}
        description={t('aiChats.actions.deleteConfirm')}
        confirmLabel={t('aiChats.actions.delete')}
        cancelLabel={t('aiChats.actions.cancel')}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
