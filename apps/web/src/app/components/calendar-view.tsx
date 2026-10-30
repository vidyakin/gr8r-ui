/* Календарь задач (месяц / неделя) — порт calendarHtml из views/calendar.js.
   Опция events подмешивает события проектов (поповеры event / daylist из overlays/popovers.js).
   Задачи перетаскиваются между днями (drop type 'cal' из actions/drag-drop.js): меняется срок, начало сдвигается на ту же длину. */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { ArrowUpRight, Calendar, ChevronLeft, ChevronRight, Clock, Folder, Plus, Users } from 'lucide-react';
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, Segmented, toast } from '@/components/ui';
import { PriorityIcon, StatusIcon } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { useT, weekStartsOn } from '@/i18n';
import { useWorkspace } from '../data/store';
import { project, projectColor } from '../data/selectors';
import { diffDays, fmtDate, iso, parse, sod, today } from '../lib/dates';
import type { CalendarEvent, Task } from '../data/types';
import { MemberAvatar, MemberStack, useTaskActions } from './workspace';
import { ProjectDot } from './project';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTH_LONG_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d: Date) => addDays(sod(d), -((d.getDay() - weekStartsOn() + 7) % 7));

/** Свойства источника перетаскивания: карточка задачи в ячейке дня */
type DragSrc = { draggable: true; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void };

function Chip({ t, drag }: { t: Task; drag: DragSrc }) {
  const { data } = useWorkspace();
  const { open } = useTaskActions();
  return (
    <button data-ctx="task" data-id={t.id} {...drag} className={cn('cev', t.status === 'done' && 'done')} style={{ '--c': projectColor(project(data, t.project)) } as React.CSSProperties} title={t.title} onClick={() => open(t)}>
      {t.status === 'done' ? <StatusIcon status="done" size={11} /> : t.priority != null && <PriorityIcon priority={t.priority} size={11} />}
      <span className="trunc">{t.title}</span>
      <MemberAvatar id={t.assignee} tooltip={false} />
    </button>
  );
}

/** Поповер события: название, дата, проект, участники (popover «event») */
function EventPopover({ e, children }: { e: CalendarEvent; children: React.ReactNode }) {
  const { data } = useWorkspace();
  const tt = useT();
  const navigate = useNavigate();
  const p = project(data, e.project);
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="!p-0" style={{ width: 270 }}>
        <div style={{ padding: '10px 10px 6px' }}>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="pdot" style={{ '--c': projectColor(p), borderRadius: '50%' } as React.CSSProperties} />
            <b style={{ fontSize: 14, fontWeight: 600 }}>{e.title}</b>
          </div>
          <div className="muted" style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="row" style={{ gap: 6 }}>
              <Calendar size={13} />
              {fmtDate(e.date, true)} · {e.time}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <Folder size={13} />
              {p?.name}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <Users size={13} />
              <MemberStack ids={p?.members ?? []} max={5} />
            </span>
          </div>
        </div>
        <div className="msep" />
        <button className="mi" onClick={() => navigate(`/projects/${e.project}`)}>
          <ArrowUpRight size={14} />
          {tt('views.calendar.openProject')}
        </button>
      </PopoverContent>
    </Popover>
  );
}

function EventChip({ e }: { e: CalendarEvent }) {
  const { data } = useWorkspace();
  return (
    <EventPopover e={e}>
      <button className="cev event" style={{ '--c': projectColor(project(data, e.project)) } as React.CSSProperties} title={`${e.title} · ${e.time}`}>
        <span className="num faint" style={{ fontSize: 11 }}>
          {e.time}
        </span>
        <span className="trunc">{e.title}</span>
      </button>
    </EventPopover>
  );
}

function EventCard({ e }: { e: CalendarEvent }) {
  const { data } = useWorkspace();
  const p = project(data, e.project);
  return (
    <EventPopover e={e}>
      <button className="wcard event" style={{ '--c': projectColor(p) } as React.CSSProperties}>
        <span className="t">
          <span className="pdot" style={{ '--c': projectColor(p), borderRadius: '50%' } as React.CSSProperties} />
          {e.title}
        </span>
        <span className="m">
          <Clock size={11} />
          {e.time} · {p?.name}
        </span>
      </button>
    </EventPopover>
  );
}

/** Поповер «+N more»: события и задачи дня (popover «daylist») */
function DayList({ ds, evs, ts }: { ds: string; evs: CalendarEvent[]; ts: Task[] }) {
  const navigate = useNavigate();
  const tt = useT();
  const { open } = useTaskActions();
  const n = evs.length + ts.length - 3;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="cmore">{tt('views.calendar.moreCount', { n })}</button>
      </PopoverTrigger>
      <PopoverContent className="!p-1" style={{ width: 280 }}>
        <div className="mh">{fmtDate(ds, true)}</div>
        {evs.map(e => (
          <button key={e.id} className="mi" onClick={() => navigate(`/projects/${e.project}/calendar`)}>
            <Clock size={14} />
            {e.title}
            <span className="r">{e.time}</span>
          </button>
        ))}
        {ts.map(t => (
          <button key={t.id} className="mi" onClick={() => open(t)}>
            <StatusIcon status={t.status} />
            <span className="trunc">{t.title}</span>
            <span className="r">
              <MemberAvatar id={t.assignee} size="sm" tooltip={false} />
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function WeekCard({ t, drag }: { t: Task; drag: DragSrc }) {
  const { data } = useWorkspace();
  const { open } = useTaskActions();
  const p = project(data, t.project);
  return (
    <button data-ctx="task" data-id={t.id} {...drag} className="wcard" style={{ '--c': projectColor(p) } as React.CSSProperties} onClick={() => open(t)}>
      <span className="t" style={t.status === 'done' ? { textDecoration: 'line-through', color: 'var(--text-3)' } : undefined}>
        <ProjectDot project={p} />
        {t.title}
      </span>
      <span className="m">
        <StatusIcon status={t.status} size={11} />
        {t.priority != null && <PriorityIcon priority={t.priority} size={11} />}
        <span className="trunc min-w-0 flex-1">{p?.name}</span>
        <MemberAvatar id={t.assignee} size="sm" tooltip={false} />
      </span>
    </button>
  );
}

export function CalendarView({ tasks, onAdd, events }: { tasks: Task[]; onAdd?: (due: string) => void; events?: CalendarEvent[] }) {
  const { data, dispatch } = useWorkspace();
  const tt = useT();
  const [mode, setMode] = React.useState<'month' | 'week'>('month');
  const [cur, setCur] = React.useState(today);
  const [dragId, setDragId] = React.useState<string | null>(null);
  // День под курсором во время перетаскивания (класс .over)
  const [overDay, setOverDay] = React.useState<string | null>(null);
  const endDrag = () => {
    setDragId(null);
    setOverDay(null);
  };
  const dragSrc = (t: Task): DragSrc => ({
    draggable: true,
    onDragStart: e => {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', t.id);
      } catch {
        /* не поддерживается — безопасно пропустить */
      }
      setDragId(t.id);
    },
    onDragEnd: endDrag,
  });
  const dropTarget = (ds: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOverDay(d => (d === ds ? d : ds));
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverDay(d => (d === ds ? null : d));
    },
    onDrop: (e: React.DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      const t = data.tasks.find(x => x.id === dragId);
      endDrag();
      if (!t || t.due === ds) return;
      // Начало сдвигается так, чтобы длина задачи не менялась
      const len = t.start && t.due ? diffDays(parse(t.due), parse(t.start)) : null;
      dispatch({ type: 'task/update', id: t.id, patch: { due: ds, ...(len != null ? { start: iso(addDays(parse(ds), -len)) } : {}) } });
      toast(tt('views.calendar.rescheduled', { title: t.title, date: fmtDate(ds) }), { duration: 2200 });
    },
  });
  const on = (ds: string) => tasks.filter(t => t.due === ds);
  const evOn = (ds: string) => (events ?? []).filter(e => e.date === ds);
  const now = today();

  const nav = (dir: -1 | 0 | 1) =>
    setCur(c => {
      if (dir === 0) return today();
      if (mode === 'week') return addDays(c, dir * 7);
      return new Date(c.getFullYear(), c.getMonth() + dir, 1);
    });

  let label: string, body: React.ReactNode;
  if (mode === 'month') {
    label = `${tt(`views.calendar.monthsLong.${MONTH_LONG_KEYS[cur.getMonth()]}`)} ${cur.getFullYear()}`;
    const start = startOfWeek(new Date(cur.getFullYear(), cur.getMonth(), 1));
    const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const days = cells[35].getMonth() !== cur.getMonth() ? cells.slice(0, 35) : cells;
    body = (
      <>
        <div className="cal-h">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i}>{tt(`views.calendar.weekDaysShort.${WEEKDAY_KEYS[(i + weekStartsOn()) % 7]}`)}</div>
          ))}
        </div>
        <div className="cal-g" style={{ gridTemplateRows: `repeat(${days.length / 7},minmax(112px,1fr))` }}>
          {days.map(d => {
            const ds = iso(d);
            const evs = evOn(ds);
            const items = on(ds);
            const total = evs.length + items.length;
            const isToday = diffDays(d, now) === 0;
            return (
              <div key={ds} className={cn('cday', d.getMonth() !== cur.getMonth() && 'out', isToday && 'today', overDay === ds && 'over')} {...dropTarget(ds)}>
                <span className="dn" aria-current={isToday ? 'date' : undefined}>
                  {d.getDate()}
                </span>
                {onAdd && (
                  <button className="ibtn ibtn-xs add" aria-label={tt('views.calendar.addOn', { date: fmtDate(ds) })} onClick={() => onAdd(ds)}>
                    <Plus size={13} />
                  </button>
                )}
                {evs.slice(0, 3).map(e => (
                  <EventChip key={e.id} e={e} />
                ))}
                {items.slice(0, 3 - Math.min(evs.length, 3)).map(t => (
                  <Chip key={t.id} t={t} drag={dragSrc(t)} />
                ))}
                {total > 3 &&
                  (events ? (
                    <DayList ds={ds} evs={evs} ts={items} />
                  ) : (
                    <button className="cmore" onClick={() => (setCur(d), setMode('week'))}>
                      {tt('views.calendar.moreCount', { n: total - 3 })}
                    </button>
                  ))}
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
          const evs = evOn(ds);
          const items = on(ds);
          return (
            <div key={ds} className="wcol">
              <div className={cn('wcol-h', diffDays(d, now) === 0 && 'today')}>
                <span className="n">{d.getDate()}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {tt(`views.calendar.weekDaysShort.${WEEKDAY_KEYS[d.getDay()]}`)}
                </span>
                <span className="sp" />
                {onAdd && (
                  <IconButton size="xs" label={tt('views.calendar.addTask')} tooltip={false} onClick={() => onAdd(ds)}>
                    <Plus size={13} />
                  </IconButton>
                )}
              </div>
              <div className={cn('wcol-b', overDay === ds && 'over')} {...dropTarget(ds)}>
                {evs.length + items.length ? (
                  <>
                    {evs.map(e => (
                      <EventCard key={e.id} e={e} />
                    ))}
                    {items.map(t => (
                      <WeekCard key={t.id} t={t} drag={dragSrc(t)} />
                    ))}
                  </>
                ) : (
                  <span className="faint" style={{ fontSize: 12, padding: 4 }}>
                    {tt('views.calendar.noTasks')}
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
          {tt('views.calendar.today')}
        </Button>
        <div className="row" style={{ gap: 0 }}>
          <IconButton size="sm" label={tt('common.previous')} tooltip={false} onClick={() => nav(-1)}>
            <ChevronLeft size={16} />
          </IconButton>
          <IconButton size="sm" label={tt('common.next')} tooltip={false} onClick={() => nav(1)}>
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
          aria-label={tt('views.calendar.calendarRange')}
          value={mode}
          onValueChange={setMode}
          items={[
            { value: 'month', label: tt('views.calendar.month') },
            { value: 'week', label: tt('views.calendar.week') },
          ]}
        />
      </div>
      {body}
    </div>
  );
}
