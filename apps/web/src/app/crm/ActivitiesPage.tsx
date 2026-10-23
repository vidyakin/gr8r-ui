/* Activities — лента звонков, писем, встреч, заметок и follow-up по дням (как страница Activity приложения) */
import * as React from 'react';
import { Activity as ActivityIcon } from 'lucide-react';
import { EmptyState, Segmented } from '@/components/ui';
import { useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { dayBucket } from '../data/selectors';
import { diffDays, parse, today } from '../lib/dates';
import { ActivityRow } from './components';
import { filterActivities } from './selectors';
import { ACTIVITY_TYPES } from './stages';
import { activityPlural } from './labels';
import { useCrm } from './store';
import type { ActivityType, CrmActivity } from './types';

export function ActivitiesPage() {
  const { data } = useCrm();
  const { data: ws } = useWorkspace();
  const t = useT();
  const [type, setType] = React.useState<ActivityType | 'all'>('all');
  const [who, setWho] = React.useState('all');

  const list = filterActivities(data.activities, { type, who });
  const buckets = new Map<string, CrmActivity[]>();
  for (const a of list) {
    const k = dayBucket(a.at);
    buckets.set(k, [...(buckets.get(k) ?? []), a]);
  }
  const open = data.activities.filter(a => a.type === 'task' && !a.done);
  const overdue = open.filter(a => a.due && diffDays(parse(a.due), today()) < 0).length;

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="ph">
        <div>
          <h1>{t('crm.activities.title')}</h1>
          <p>
            {t('crm.activities.summary', { count: open.length })}
            {overdue > 0 && <span style={{ color: 'var(--red)' }}> {t('crm.activities.overdue', { count: overdue })}</span>}
          </p>
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <Segmented
          aria-label={t('crm.activities.typeLabel')}
          value={type}
          onValueChange={setType}
          items={[
            { value: 'all', label: t('crm.activities.all') },
            ...ACTIVITY_TYPES.map(a => ({ value: a.id, label: activityPlural(a.id, a.plural) })),
          ]}
        />
        <select className="select" style={{ height: 26, width: 'auto', fontSize: 12 }} value={who} onChange={e => setWho(e.target.value)} aria-label={t('crm.activities.whoLabel')}>
          <option value="all">{t('crm.activities.everyone')}</option>
          {ws.members
            .filter(m => m.status === 'active')
            .map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </div>
      {list.length ? (
        [...buckets].map(([k, items]) => (
          <React.Fragment key={k}>
            <div className="day-h">{k}</div>
            <div className="feed lined">
              {items.map(a => (
                <ActivityRow key={a.id} a={a} showDeal showCompany />
              ))}
            </div>
          </React.Fragment>
        ))
      ) : (
        <EmptyState icon={<ActivityIcon />} title={t('crm.activities.empty')}>
          {t('crm.activities.emptyHint')}
        </EmptyState>
      )}
    </div>
  );
}
