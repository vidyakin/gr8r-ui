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
import { useT } from '@/i18n';

function NotificationRow({ n }: { n: Notification }) {
  const t = useT();
  const { data, dispatch } = useWorkspace();
  const navigate = useNavigate();
  const { open } = useTaskActions();
  const { task, project: proj } = notifTarget(data, n);
  const activate = () => {
    dispatch({ type: 'notif/setRead', id: n.id, read: true });
    if (task) open(task);
    else if (proj) navigate(`/projects/${proj.id}`);
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
          {proj ? `${proj.name} · ` : ''}
          {ago(n.at)}
        </div>
      </div>
      {!n.read && <span className="size-[7px] rounded-full bg-brand" style={{ marginTop: 8 }} aria-label={t('pages.notifications.unread')} />}
      <IconButton
        size="sm"
        label={n.read ? t('pages.notifications.markUnread') : t('pages.notifications.markRead')}
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
  const t = useT();
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
            {t('pages.notifications.title')} {!!unread && <Badge tone="accent">{t('pages.notifications.unreadCount', { count: unread })}</Badge>}
          </h1>
          <p>{t('pages.notifications.subline')}</p>
        </div>
        <div className="acts">
          <Segmented
            aria-label={t('pages.notifications.filterLabel')}
            value={filter}
            onValueChange={setFilter}
            items={[
              { value: 'all', label: t('pages.notifications.all') },
              { value: 'unread', label: t('pages.notifications.unread') },
            ]}
          />
          <Button disabled={!unread} onClick={() => dispatch({ type: 'notif/markAllRead' })}>
            <CheckCheck size={14} />
            {t('pages.notifications.markAllRead')}
          </Button>
          <IconButton label={t('pages.notifications.preferences')} onClick={() => navigate(`${SECTIONS.settings.path}/notif-email`)}>
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
            title={t('pages.notifications.allCaughtUp')}
            action={
              <Button size="sm" onClick={() => setFilter('all')}>
                {t('pages.notifications.showAll')}
              </Button>
            }
          >
            {t('pages.notifications.allCaughtUpHint')}
          </EmptyState>
        </div>
      )}
    </div>
  );
}
