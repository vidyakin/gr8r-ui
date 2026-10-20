/* Входящие — порт pageInbox / inboxItem / inboxPreview из pages/inbox.js */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, AtSign, CheckCheck, Inbox, Mail, MailOpen, MessageSquare, PanelRightOpen, RefreshCw, UserPlus } from 'lucide-react';
import { Alert, Button, EmptyState, IconButton, Switch, Tab, Tabs, TabsList, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { commentsOf, notifTarget } from '../data/selectors';
import { ago } from '../lib/dates';
import type { Notification } from '../data/types';
import { CommentItem, MentionText, NotifIcon, NotifText, ReplyBox } from '../components/conversation';
import { AssigneeField, DueField, PriorityField, StatusField } from '../components/fields';
import { ProjectDot } from '../components/project';
import { useTaskActions } from '../components/workspace';

type Category = 'all' | Notification['type'];
const CATEGORIES: [Category, string][] = [
  ['all', 'All'],
  ['mention', 'Mentions'],
  ['assign', 'Assignments'],
  ['comment', 'Comments'],
  ['update', 'Updates'],
];
const TYPE_ICON = { mention: AtSign, assign: UserPlus, comment: MessageSquare, update: RefreshCw } as const;

function InboxItem({ n, selected, onSelect }: { n: Notification; selected: boolean; onSelect: () => void }) {
  const { data, dispatch } = useWorkspace();
  const { project: p } = notifTarget(data, n);
  const TypeIcon = TYPE_ICON[n.type];
  return (
    <div
      className={cn('row relative cursor-pointer', selected && 'bg-surface-2')}
      style={{ alignItems: 'flex-start', gap: 10, padding: '12px var(--gutter)', borderBottom: '1px solid var(--divider)' }}
      role="button"
      tabIndex={0}
      aria-current={selected || undefined}
      onClick={onSelect}
      onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && onSelect()}
    >
      {!n.read && <span className="absolute top-[22px] left-1.5 size-1.5 rounded-full bg-brand" aria-label="Unread" />}
      <NotifIcon n={n} />
      <div className="min-w-0 flex-1" style={{ fontSize: 13, lineHeight: 1.45 }}>
        <div>
          <NotifText n={n} />
        </div>
        <div className="trunc muted" style={{ fontSize: 12.5, marginTop: 2 }}>
          <MentionText text={n.snippet} />
        </div>
        <div className="row" style={{ gap: 6, marginTop: 5, fontSize: 11.5, color: 'var(--text-3)' }}>
          <TypeIcon size={11} />
          {p && (
            <>
              <ProjectDot project={p} size={6} />
              {p.name}
            </>
          )}
          <span>·</span>
          <span>{ago(n.at)}</span>
        </div>
      </div>
      <IconButton
        size="xs"
        label={n.read ? 'Mark as unread' : 'Mark as read'}
        onClick={e => {
          e.stopPropagation();
          dispatch({ type: 'notif/setRead', id: n.id, read: !n.read });
        }}
      >
        {n.read ? <Mail size={13} /> : <MailOpen size={13} />}
      </IconButton>
    </div>
  );
}

function Preview({ n, onBack }: { n: Notification; onBack: () => void }) {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const { open } = useTaskActions();
  const { task: t, project: p } = notifTarget(data, n);

  if (!t)
    return (
      <div style={{ padding: '24px 28px' }}>
        <Button size="sm" variant="ghost" style={{ margin: '-4px 0 12px -8px' }} onClick={onBack}>
          <ArrowLeft size={14} />
          Back
        </Button>
        <Alert tone="danger" title={n.text}>
          <div className="muted" style={{ marginTop: 2 }}>
            {n.snippet}
          </div>
        </Alert>
        {p && (
          <div style={{ marginTop: 14 }}>
            <Button onClick={() => navigate(`/projects/${p.id}`)}>Open project</Button>
          </div>
        )}
      </div>
    );

  const comments = commentsOf(data, t.id).slice(-4);
  return (
    <>
      <div className="row" style={{ height: 46, padding: '0 16px', borderBottom: '1px solid var(--border)', gap: 8, flexShrink: 0 }}>
        <IconButton size="sm" label="Back" tooltip={false} onClick={onBack}>
          <ArrowLeft size={15} />
        </IconButton>
        <ProjectDot project={p} />
        <span className="muted" style={{ fontSize: 12.5 }}>
          {p?.name}
        </span>
        <span className="faint mono">{t.key}</span>
        <span className="sp" />
        <Button size="sm" onClick={() => open(t)}>
          <PanelRightOpen size={14} />
          Open task
        </Button>
      </div>
      <div style={{ padding: '24px 28px', maxWidth: 720, width: '100%' }}>
        <h2 style={{ fontSize: 'var(--fs-xl)', margin: '0 0 10px', fontWeight: 600, letterSpacing: '-.015em' }}>{t.title}</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginBottom: 18 }}>
          <StatusField task={t} />
          <AssigneeField task={t} />
          <PriorityField task={t} />
          <DueField task={t} />
        </div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>
          Conversation
        </div>
        {comments.length ? (
          comments.map(c => <CommentItem key={c.id} c={c} />)
        ) : (
          <p className="muted">
            <MentionText text={n.snippet} />
          </p>
        )}
        <ReplyBox key={t.id} taskId={t.id} />
      </div>
    </>
  );
}

export function InboxPage() {
  const { data, dispatch } = useWorkspace();
  const [cat, setCat] = React.useState<Category>('all');
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [selId, setSelId] = React.useState<string | null>(null);

  const all = [...data.notifs].sort((a, b) => b.at - a.at);
  const unreadIn = (k: Category) => all.filter(n => (k === 'all' || n.type === k) && !n.read).length;
  const list = all.filter(n => (cat === 'all' || n.type === cat) && (!unreadOnly || !n.read));
  const sel = data.notifs.find(n => n.id === selId) ?? null;

  const select = (n: Notification) => {
    setSelId(n.id);
    if (!n.read) dispatch({ type: 'notif/setRead', id: n.id, read: true });
  };
  const markAll = () => {
    const had = unreadIn('all');
    dispatch({ type: 'notif/markAllRead' });
    if (had) toast("You're all caught up.");
  };

  return (
    <div className="page flush">
      <div className="grid min-h-0 flex-1 grid-cols-1 min-[901px]:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-r border-border">
          <div className="row" style={{ padding: '18px var(--gutter) 0' }}>
            <h1 style={{ fontSize: 'var(--fs-xl)', margin: 0, fontWeight: 600, letterSpacing: '-.015em' }}>Inbox</h1>
            <span className="sp" />
            <label className="row cursor-pointer" style={{ fontSize: 12, color: 'var(--text-2)', gap: 6 }}>
              <Switch checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
              Unread
            </label>
            <IconButton size="sm" label="Mark all as read" onClick={markAll}>
              <CheckCheck size={15} />
            </IconButton>
          </div>
          <Tabs value={cat} onValueChange={v => setCat(v as Category)}>
            <TabsList className="inbox-tabs">
              {CATEGORIES.map(([k, name]) => (
                <Tab key={k} value={k} count={unreadIn(k) || undefined}>
                  {name}
                </Tab>
              ))}
            </TabsList>
          </Tabs>
          <div className="inbox-list">
            {list.length ? (
              list.map(n => <InboxItem key={n.id} n={n} selected={sel?.id === n.id} onSelect={() => select(n)} />)
            ) : (
              <EmptyState size="sm" icon={<Inbox />} title="You're all caught up.">
                {unreadOnly ? 'No unread notifications in this category.' : 'New mentions, assignments, and comments will show up here.'}
              </EmptyState>
            )}
          </div>
        </div>
        {/* На узком экране превью открывается поверх списка */}
        <div className={cn('min-h-0 flex-col overflow-y-auto', sel ? 'flex max-[900px]:fixed max-[900px]:inset-0 max-[900px]:z-[48] max-[900px]:bg-surface' : 'hidden min-[901px]:flex')}>
          {sel ? (
            <Preview key={sel.id} n={sel} onBack={() => setSelId(null)} />
          ) : (
            <div className="fullstate">
              <div className="box">
                <EmptyState icon={<MailOpen />} title="Select a notification" className="!p-0">
                  Read the conversation and reply without leaving your inbox.
                </EmptyState>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
