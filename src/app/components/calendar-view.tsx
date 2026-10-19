/* Календарь задач (месяц / неделя) — порт calendarHtml из views/calendar.js.
   Перетаскивание задач между днями и события пока не перенесены. */
import * as React from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button, IconButton, Segmented } from '@/components/ui';
import { PriorityIcon, StatusIcon } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { project, projectColor } from '../data/selectors';
import { diffDays, fmtDate, iso, sod, today } from '../lib/dates';
import type { Task } from '../data/types';
import { MemberAvatar, useTaskActions } from './workspace';
import { ProjectDot } from './project';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK_START = 1;

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d: Date) => addDays(sod(d), -((d.getDay() - WEEK_START + 7) % 7));

function Chip({ t }: { t: Task }) {
  const { data } = useWorkspace();
  const { open } = useTaskActions();
  return (
    <button className={cn('cev', t.status === 'done' && 'done')} style={{ '--c': projectColor(project(data, t.project)) } as React.CSSProperties} title={t.title} onClick={() => open(t)}>
      {t.status === 'done' ? <StatusIcon status="done" size={11} /> : <PriorityIcon priority={t.priority} size={11} />}
      <span className="trunc">{t.title}</span>
      <MemberAvatar id={t.assignee} tooltip={false} />
    </button>
  );
}

function WeekCard({ t }: { t: Task }) {
  const { data } = useWorkspace();
  const { open } = useTaskActions();
  const p = project(data, t.project);
  return (
    <button className="wcard" style={{ '--c': projectColor(p) } as React.CSSProperties} onClick={() => open(t)}>
      <span className="t" style={t.status === 'done' ? { textDecoration: 'line-through', color: 'var(--text-3)' } : undefined}>
        <ProjectDot project={p} />
        {t.title}
      </span>
      <span className="m">
        <StatusIcon status={t.status} size={11} />
        <PriorityIcon priority={t.priority} size={11} />
        <span className="trunc min-w-0 flex-1">{p?.name}</span>
        <MemberAvatar id={t.assignee} size="sm" tooltip={false} />
      </span>
    </button>
  );
}

export function CalendarView({ tasks, onAdd }: { tasks: Task[]; onAdd?: (due: string) => void }) {
  const { data } = useWorkspace();
  const [mode, setMode] = React.useState<'month' | 'week'>('month');
  const [cur, setCur] = React.useState(today);
  const on = (ds: string) => tasks.filter(t => t.due === ds);
  const now = today();

  const nav = (dir: -1 | 0 | 1) =>
    setCur(c => {
      if (dir === 0) return today();
      if (mode === 'week') return addDays(c, dir * 7);
      return new Date(c.getFullYear(), c.getMonth() + dir, 1);
    });

  let label: string, body: React.ReactNode;
  if (mode === 'month') {
    label = `${MONTHS[cur.getMonth()]} ${cur.getFullYear()}`;
    const start = startOfWeek(new Date(cur.getFullYear(), cur.getMonth(), 1));
    const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const days = cells[35].getMonth() !== cur.getMonth() ? cells.slice(0, 35) : cells;
    body = (
      <>
        <div className="cal-h">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i}>{WD[(i + WEEK_START) % 7]}</div>
          ))}
        </div>
        <div className="cal-g" style={{ gridTemplateRows: `repeat(${days.length / 7},minmax(112px,1fr))` }}>
          {days.map(d => {
            const ds = iso(d);
            const items = on(ds);
            const isToday = diffDays(d, now) === 0;
            return (
              <div key={ds} className={cn('cday', d.getMonth() !== cur.getMonth() && 'out', isToday && 'today')}>
                <span className="dn" aria-current={isToday ? 'date' : undefined}>
                  {d.getDate()}
                </span>
                {onAdd && (
                  <button className="ibtn ibtn-xs add" aria-label={`Add task on ${fmtDate(ds)}`} onClick={() => onAdd(ds)}>
                    <Plus size={13} />
                  </button>
                )}
                {items.slice(0, 3).map(t => (
                  <Chip key={t.id} t={t} />
                ))}
                {items.length > 3 && (
                  <button className="cmore" onClick={() => (setCur(d), setMode('week'))}>
                    +{items.length - 3} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  } else {
    const ws = startOfWeek(cur);
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    label = `${fmtDate(days[0])} – ${fmtDate(days[6])}, ${days[6].getFullYear()}`;
    body = (
      <div className="week">
        {days.map(d => {
          const ds = iso(d);
          const items = on(ds);
          return (
            <div key={ds} className="wcol">
              <div className={cn('wcol-h', diffDays(d, now) === 0 && 'today')}>
                <span className="n">{d.getDate()}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {WD[d.getDay()]}
                </span>
                <span className="sp" />
                {onAdd && (
                  <IconButton size="xs" label="Add task" tooltip={false} onClick={() => onAdd(ds)}>
                    <Plus size={13} />
                  </IconButton>
                )}
              </div>
              <div className="wcol-b">
                {items.length ? (
                  items.map(t => <WeekCard key={t.id} t={t} />)
                ) : (
                  <span className="faint" style={{ fontSize: 12, padding: 4 }}>
                    No tasks
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const projects = [...new Set(tasks.map(t => t.project))].map(id => project(data, id)).filter(p => !!p);
  return (
    <div className="cal" style={{ minHeight: 640 }}>
      <div className="toolbar" style={{ gap: 8 }}>
        <Button size="sm" onClick={() => nav(0)}>
          Today
        </Button>
        <div className="row" style={{ gap: 0 }}>
          <IconButton size="sm" label="Previous" tooltip={false} onClick={() => nav(-1)}>
            <ChevronLeft size={16} />
          </IconButton>
          <IconButton size="sm" label="Next" tooltip={false} onClick={() => nav(1)}>
            <ChevronRight size={16} />
          </IconButton>
        </div>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 4px', letterSpacing: '-.01em' }} aria-live="polite">
          {label}
        </h2>
        <span className="sp" />
        {projects.length > 1 && (
          <span className="row hide-m" style={{ gap: 10, fontSize: 11.5, color: 'var(--text-2)', marginRight: 8 }}>
            {projects.slice(0, 5).map(p => (
              <span key={p.id} className="row" style={{ gap: 4 }}>
                <ProjectDot project={p} />
                {p.name}
              </span>
            ))}
          </span>
        )}
        <Segmented
          aria-label="Calendar range"
          value={mode}
          onValueChange={setMode}
          items={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
          ]}
        />
      </div>
      {body}
    </div>
  );
}
