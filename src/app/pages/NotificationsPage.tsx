/* Уведомления — порт pageNotifications из pages/notifications.js */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { BellOff, Check, CheckCheck, Mail, Settings2 } from 'lucide-react';
import { Badge, Button, EmptyState, IconButton, Segmented } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { dayBucket, notifTarget } from '../data/selectors';
import { ago } from '../lib/dates';
import type { Notification } from '../data/types';
import { SECTIONS } from '../routes';
import { MentionText, NotifIcon, NotifText } from '../components/conversation';
import { useTaskActions } from '../components/workspace';

function NotificationRow({ n }: { n: Notification }) {
  const { data, dispatch } = useWorkspace();
  const navigate = useNavigate();
  const { open } = useTaskActions();
  const { task: t, project: p } = notifTarget(data, n);
  const activate = () => {
    dispatch({ type: 'notif/setRead', id: n.id, read: true });
    if (t) open(t);
    else if (p) navigate(`/projects/${p.id}`);
  };
  return (
    <div className={cn('nrow', !n.read && 'unread')} role="button" tabIndex={0} onClick={activate} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && activate()}>
      <NotifIcon n={n} />
      <div className="min-w-0 flex-1" style={{ fontSize: 13 }}>
        <div>
          <NotifText n={n} />
        </div>
        <div className="muted trunc" style={{ fontSize: 12.5, marginTop: 2 }}>
          <MentionText text={n.snippet} />
        </div>
        <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
          {p ? `${p.name} · ` : ''}
          {ago(n.at)}
        </div>
      </div>
      {!n.read && <span className="size-[7px] rounded-full bg-brand" style={{ marginTop: 8 }} aria-label="Unread" />}
      <IconButton
        size="sm"
        label={n.read ? 'Mark as unread' : 'Mark as read'}
        onClick={e => {
          e.stopPropagation();
          dispatch({ type: 'notif/setRead', id: n.id, read: !n.read });
        }}
      >
        {n.read ? <Mail size={14} /> : <Check size={14} />}
      </IconButton>
    </div>
  );
}

export function NotificationsPage() {
  const { data, dispatch } = useWorkspace();
  const navigate = useNavigate();
  const [filter, setFilter] = React.useState<'all' | 'unread'>('all');

  const sorted = [...data.notifs].sort((a, b) => b.at - a.at);
  const unread = sorted.filter(n => !n.read).length;
  const list = filter === 'unread' ? sorted.filter(n => !n.read) : sorted;
  const buckets = new Map<string, Notification[]>();
  for (const n of list) buckets.set(dayBucket(n.at), [...(buckets.get(dayBucket(n.at)) ?? []), n]);

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="ph">
        <div>
          <h1 className="row" style={{ gap: 10 }}>
            Notifications {!!unread && <Badge tone="accent">{unread} unread</Badge>}
          </h1>
          <p>Updates on tasks and projects you follow.</p>
        </div>
        <div className="acts">
          <Segmented
            aria-label="Filter"
            value={filter}
            onValueChange={setFilter}
            items={[
              { value: 'all', label: 'All' },
              { value: 'unread', label: 'Unread' },
            ]}
          />
          <Button disabled={!unread} onClick={() => dispatch({ type: 'notif/markAllRead' })}>
            <CheckCheck size={14} />
            Mark all as read
          </Button>
          <IconButton label="Notification preferences" onClick={() => navigate(SECTIONS.settings.path)}>
            <Settings2 size={16} />
          </IconButton>
        </div>
      </div>
      {list.length ? (
        [...buckets].map(([bucket, items]) => (
          <React.Fragment key={bucket}>
            <div className="day-h">{bucket}</div>
            <div className="panel" style={{ overflow: 'hidden' }}>
              {items.map(n => (
                <NotificationRow key={n.id} n={n} />
              ))}
            </div>
          </React.Fragment>
        ))
      ) : (
        <div className="panel">
          <EmptyState
            icon={<BellOff />}
            title="You're all caught up."
            action={
              <Button size="sm" onClick={() => setFilter('all')}>
                Show all
              </Button>
            }
          >
            No unread notifications. We'll let you know when something needs you.
          </EmptyState>
        </div>
      )}
    </div>
  );
}
