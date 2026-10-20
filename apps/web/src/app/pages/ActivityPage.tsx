/* Активность — порт pageActivity из pages/activity.js */
import * as React from 'react';
import { Activity as ActivityIcon } from 'lucide-react';
import { EmptyState, Segmented } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { canSee, dayBucket, project } from '../data/selectors';
import type { Activity } from '../data/types';
import { ActivityItem } from '../components/workspace';

type Filter = 'all' | 'status' | 'comments' | 'projects';

/** Фильтр по типу события (глагол записи) */
const matches = (a: Activity, f: Filter) => (f === 'comments' ? a.verb.includes('comment') : f === 'status' ? /moved|completed|reopened/.test(a.verb) : f === 'projects' ? a.verb.includes('project') : true);

export function ActivityPage() {
  const { data } = useWorkspace();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [who, setWho] = React.useState('all');

  const list = data.activity.filter(a => {
    const p = project(data, a.project);
    return (!a.project || (p && canSee(data, p))) && matches(a, filter) && (who === 'all' || a.by === who);
  });
  const buckets = new Map<string, Activity[]>();
  for (const a of list) {
    const k = dayBucket(a.at);
    buckets.set(k, [...(buckets.get(k) ?? []), a]);
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="ph">
        <div>
          <h1>Activity</h1>
          <p>Everything that's changed across the workspace.</p>
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <Segmented
          aria-label="Filter"
          value={filter}
          onValueChange={setFilter}
          items={[
            { value: 'all', label: 'All' },
            { value: 'status', label: 'Status changes' },
            { value: 'comments', label: 'Comments' },
            { value: 'projects', label: 'Projects' },
          ]}
        />
        <select className="select" style={{ height: 26, width: 'auto', fontSize: 12 }} value={who} onChange={e => setWho(e.target.value)} aria-label="Filter by person">
          <option value="all">Everyone</option>
          {data.members.map(m => (
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
                <ActivityItem key={a.id} a={a} showProject />
              ))}
            </div>
          </React.Fragment>
        ))
      ) : (
        <EmptyState icon={<ActivityIcon />} title="No activity yet">
          Changes to tasks and projects will appear here.
        </EmptyState>
      )}
    </div>
  );
}
