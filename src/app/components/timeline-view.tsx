/* Timeline (диаграмма Ганта) — порт tlControls, timelineHtml, msLane, tlAfter из views/timeline.js.
   Полосы задач перетаскиваются по оси времени (сдвиг start/due через task/update). */
import * as React from 'react';
import { Crosshair, Diamond, Plus, ChartGantt } from 'lucide-react';
import { Button, EmptyState, Segmented, Select, toast } from '@/components/ui';
import { StatusIcon } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { applyView, canSee, groupTasks, projectColor, project as findProject, task as findTask, tasksOf, visibleProjects, type GroupBy } from '../data/selectors';
import { diffDays, fmtDate, iso, parse, today } from '../lib/dates';
import type { Project, Task } from '../data/types';
import { MemberAvatar, useTaskActions } from './workspace';
import { BucketIcon } from './table-view';
import { ViewToolbar, useListView, type ViewApi } from './view-toolbar';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK_START = 1;
const RH = 36;

type Zoom = 'week' | 'month';

/** Состояние Timeline: масштаб, группировка и «прокрутить к сегодня» (S.ui.tlZoom / tlGroup) */
export function useTimeline(initialGroup: GroupBy = 'status') {
  const [zoom, setZoom] = React.useState<Zoom>('week');
  const [group, setGroup] = React.useState<GroupBy>(initialGroup);
  const [todayTick, setTodayTick] = React.useState(0);
  return { zoom, setZoom, group, setGroup, todayTick, goToday: () => setTodayTick(n => n + 1) };
}
export type TimelineApi = ReturnType<typeof useTimeline>;

/** Контролы масштаба, группировки и «Today» для ViewToolbar (tlControls) */
export function TimelineControls({ tl }: { tl: TimelineApi }) {
  return (
    <>
      <Segmented
        className="ml-1"
        aria-label="Zoom"
        value={tl.zoom}
        onValueChange={tl.setZoom}
        items={[
          { value: 'week', label: 'Weeks' },
          { value: 'month', label: 'Months' },
        ]}
      />
      <Select
        className="select !h-[26px] !w-auto !text-xs ml-1"
        aria-label="Group by"
        value={tl.group}
        onValueChange={g => tl.setGroup(g as GroupBy)}
        options={[
          { value: 'status', label: 'Group: Status' },
          { value: 'assignee', label: 'Group: Assignee' },
          { value: 'project', label: 'Group: Project' },
          { value: 'none', label: 'No grouping' },
        ]}
      />
      <Button variant="ghost" onClick={tl.goToday}>
        <Crosshair size={14} />
        Today
      </Button>
    </>
  );
}

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d: Date) => addDays(d, -((d.getDay() - WEEK_START + 7) % 7));

/** Прогресс полосы (taskProg из core/store.js) */
const taskProg = (t: Task) => {
  if (t.status === 'done') return 100;
  if (t.subtasks.length) return Math.round((t.subtasks.filter(s => s.done).length / t.subtasks.length) * 100);
  return ({ backlog: 0, todo: 5, progress: 45, review: 80 } as Record<string, number>)[t.status] ?? 0;
};

/* Положение прокрутки по ключу «вид:масштаб» — аналог data-keep и S.ui.tlInit оригинала */
const scrollMemo = new Map<string, { left: number; top: number }>();

interface Milestone {
  name: string;
  date: string;
  p?: Project;
}

/** Дорожка вех: один ромб на дату, подпись не заходит на следующий ромб (msLane) */
function MilestoneLane({ ms, X, dw, y }: { ms: Milestone[]; X: (ds: string) => number; dw: number; y: number }) {
  const byDate: Record<string, Milestone[]> = {};
  ms.forEach(m => (byDate[m.date] ||= []).push(m));
  const pts = Object.entries(byDate)
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([date, list]) => ({ date, list, x: X(date) + dw / 2 }));
  return (
    <>
      {pts.map((pt, i) => {
        const room = (pts[i + 1] ? pts[i + 1].x : Infinity) - pt.x - 24;
        const first = pt.list[0];
        const name = first.name + (pt.list.length > 1 ? ` +${pt.list.length - 1}` : '');
        const tip = pt.list.map(m => m.name + (m.p ? ` (${m.p.name})` : '')).join(' · ') + ' · ' + fmtDate(pt.date);
        return (
          <div key={pt.date} className="ms-w" style={{ left: pt.x - 6, top: y + 9 }} data-tip={tip} tabIndex={0} aria-label={`Milestone: ${tip}`}>
            <span className="ms" style={first.p ? { background: projectColor(first.p) } : undefined} />
            {room >= 28 && (
              <span className="ms-l" style={{ maxWidth: Number.isFinite(room) ? Math.round(room) : 'none' }}>
                {name}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

type Row = { type: 'ms' } | { type: 'g'; G: ReturnType<typeof groupTasks>[number] } | { type: 't'; t: Task };

export interface TimelineViewProps {
  tasks: Task[];
  /** Проект: тогда показываются только его вехи */
  project?: Project;
  tl: TimelineApi;
  /** Ключ вида для запоминания прокрутки */
  id?: string;
  onNewTask?: () => void;
}

export function TimelineView({ tasks, project: p, tl, id = 'tl', onNewTask }: TimelineViewProps) {
  const { data, dispatch } = useWorkspace();
  const { open } = useTaskActions();
  const { zoom, group: g } = tl;
  const rightRef = React.useRef<HTMLDivElement>(null);
  const leftRef = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<{ id: string; days: number } | null>(null);
  const justDragged = React.useRef(false);

  const dw = zoom === 'week' ? 32 : 11;
  const TODAY = today();
  const rs = startOfWeek(addDays(TODAY, zoom === 'week' ? -21 : -56));
  const nDays = zoom === 'week' ? 7 * 13 : 7 * 34;
  const X = (ds: string) => diffDays(parse(ds), rs) * dw;

  const groups = groupTasks(
    data,
    tasks.filter(t => t.due),
    g === 'project' && p ? 'status' : g,
  ).filter(G => G.tasks.length);
  const ms: Milestone[] = p
    ? p.milestones
    : visibleProjects(data)
        .filter(q => canSee(data, q))
        .flatMap(q => q.milestones.map(m => ({ ...m, p: q })));
  const rows: Row[] = [];
  if (ms.length) rows.push({ type: 'ms' });
  groups.forEach(G => {
    if (g !== 'none') rows.push({ type: 'g', G });
    [...G.tasks].sort((a, b) => ((a.start || a.due!) > (b.start || b.due!) ? 1 : -1)).forEach(t => rows.push({ type: 't', t }));
  });

  const W = nDays * dw;
  const H = rows.length * RH;
  const todayX = diffDays(TODAY, rs) * dw;

  // Прокрутка: восстановить сохранённую позицию вида, иначе — к сегодняшнему дню (tlAfter)
  const memoKey = `${id}:${zoom}`;
  React.useLayoutEffect(() => {
    const r = rightRef.current;
    if (!r) return;
    const m = scrollMemo.get(memoKey);
    r.scrollLeft = m ? m.left : Math.max(0, todayX - 160);
    r.scrollTop = m ? m.top : 0;
    if (leftRef.current) leftRef.current.scrollTop = r.scrollTop;
    if (!m) scrollMemo.set(memoKey, { left: r.scrollLeft, top: r.scrollTop });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoKey, rows.length > 0]);
  const firstTick = React.useRef(tl.todayTick);
  React.useEffect(() => {
    if (tl.todayTick === firstTick.current) return;
    rightRef.current?.scrollTo({ left: Math.max(0, todayX - 160), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl.todayTick]);

  if (!rows.length)
    return (
      <EmptyState
        icon={<ChartGantt size={20} />}
        title="Nothing on the timeline"
        action={
          <Button variant="primary" size="sm" onClick={onNewTask}>
            <Plus size={14} />
            New task
          </Button>
        }
      >
        Give tasks a start and due date to see them here.
      </EmptyState>
    );

  const rowY: Record<string, number> = {};
  rows.forEach((r, i) => {
    if (r.type === 't') rowY[r.t.id] = i * RH + RH / 2;
  });

  // Шапка: месяцы и дни/недели
  const months: { d: Date; n: number }[] = [];
  let cm: string | null = null;
  for (let i = 0; i < nDays; i++) {
    const d = addDays(rs, i);
    const k = d.getMonth() + '-' + d.getFullYear();
    if (k !== cm) {
      months.push({ d, n: 0 });
      cm = k;
    }
    months[months.length - 1].n++;
  }

  const onScroll = () => {
    const r = rightRef.current;
    if (!r) return;
    if (leftRef.current) leftRef.current.scrollTop = r.scrollTop;
    scrollMemo.set(memoKey, { left: r.scrollLeft, top: r.scrollTop });
  };

  // Перетаскивание полосы: сдвиг по дням, при отпускании — task/update
  const startDrag = (e: React.PointerEvent, t: Task) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    let moved = false;
    let days = 0;
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 4) moved = true;
      if (moved) {
        days = Math.round(dx / dw);
        setDrag({ id: t.id, days });
      }
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      setDrag(null);
      if (!moved) return;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 60);
      if (!days) return;
      dispatch({
        type: 'task/update',
        id: t.id,
        patch: { due: iso(addDays(parse(t.due!), days)), start: t.start ? iso(addDays(parse(t.start), days)) : null },
      });
      toast(`Moved “${t.title}” ${Math.abs(days)} day${Math.abs(days) > 1 ? 's' : ''} ${days > 0 ? 'later' : 'earlier'}`, { duration: 2200 });
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  };

  const bars = rows.map((r, i) => {
    const y = i * RH;
    if (r.type === 'g') return <div key={'g' + i} className="tl-rowbg g" style={{ top: y }} />;
    if (r.type === 'ms')
      return (
        <React.Fragment key="ms">
          <div className="tl-rowbg" style={{ top: y }} />
          <MilestoneLane ms={ms} X={X} dw={dw} y={y} />
        </React.Fragment>
      );
    const t = r.t;
    const pp = findProject(data, t.project);
    const s = t.start && t.start <= t.due! ? t.start : t.due!;
    const shift = drag?.id === t.id ? drag.days * dw : 0;
    const x = X(s) + shift;
    const w = Math.max(dw, (diffDays(parse(t.due!), parse(s)) + 1) * dw);
    const c = g === 'status' || g === 'none' ? projectColor(pp) : `var(--st-${t.status})`;
    const inside = w > 110;
    return (
      <React.Fragment key={t.id}>
        <div className="tl-rowbg" style={{ top: y }} />
        <div
          className={cn('bar', t.status === 'done' && 'done', shift !== 0 && 'dragging')}
          style={{ '--c': c, left: x, top: y + 7, width: w } as React.CSSProperties}
          title={`${t.title} · ${fmtDate(s)} → ${fmtDate(t.due!)}`}
          onPointerDown={e => startDrag(e, t)}
          onClick={() => !justDragged.current && open(t)}
        >
          <span className="pf" style={{ width: `${taskProg(t)}%` }} />
          {inside && (
            <>
              <MemberAvatar id={t.assignee} size="sm" tooltip={false} />
              <span className="trunc">{t.title}</span>
            </>
          )}
        </div>
        {!inside && (
          <div className="bar-lbl" style={{ left: x + w + 8, top: y + 10 }}>
            {t.title}
          </div>
        )}
      </React.Fragment>
    );
  });

  // Зависимости между полосами
  const deps = tasks.flatMap(t =>
    t.deps
      .filter(d => rowY[d] != null && rowY[t.id] != null)
      .map(d => {
        const a = findTask(data, d)!;
        const x1 = X(a.due!) + dw;
        const y1 = rowY[d];
        const s = t.start && t.start <= t.due! ? t.start : t.due!;
        const x2 = X(s);
        const y2 = rowY[t.id];
        const mx = Math.max(x1 + 10, x2 - 10);
        return (
          <React.Fragment key={t.id + d}>
            <path d={`M${x1} ${y1} C ${mx} ${y1}, ${Math.min(x1 + 10, x2 - 10)} ${y2}, ${x2 - 1} ${y2}`} fill="none" stroke="var(--text-3)" strokeWidth="1.3" strokeDasharray={x2 < x1 ? '3 3' : ''} />
            <path d={`M${x2 - 6} ${y2 - 3.5} L${x2 - 1} ${y2} L${x2 - 6} ${y2 + 3.5}`} fill="none" stroke="var(--text-3)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </React.Fragment>
        );
      }),
  );

  return (
    <div className="tl">
      <div className="tl-left">
        <div className="tl-head">Task</div>
        <div className="tl-rows" ref={leftRef}>
          {rows.map((r, i) => {
            if (r.type === 'ms')
              return (
                <div key="ms" className="tl-row g">
                  <Diamond size={12} />
                  Milestones
                  <span className="faint" style={{ fontWeight: 500 }}>
                    {ms.length}
                  </span>
                </div>
              );
            if (r.type === 'g')
              return (
                <div key={'g' + i} className="tl-row g">
                  <BucketIcon group={g} bucket={r.G} />
                  {r.G.name}
                  <span className="faint" style={{ fontWeight: 500 }}>
                    {r.G.tasks.length}
                  </span>
                </div>
              );
            const t = r.t;
            return (
              <div key={t.id} className="tl-row" onClick={() => open(t)}>
                <StatusIcon status={t.status} size={13} />
                <span className="trunc grow" style={t.status === 'done' ? { color: 'var(--text-3)' } : undefined}>
                  {t.title}
                </span>
                {!!t.subtasks.length && (
                  <span className="faint num" style={{ fontSize: 11 }}>
                    {t.subtasks.filter(s => s.done).length}/{t.subtasks.length}
                  </span>
                )}
                <MemberAvatar id={t.assignee} size="sm" />
              </div>
            );
          })}
          <div style={{ height: 40 }} />
        </div>
      </div>
      <div className="tl-right" ref={rightRef} onScroll={onScroll}>
        <div className="tl-head" style={{ width: W }}>
          <div className="tl-months">
            {months.map(m => (
              <div key={m.d.getTime()} style={{ width: m.n * dw }}>
                <span>
                  {MONL[m.d.getMonth()]} {m.d.getFullYear()}
                </span>
              </div>
            ))}
          </div>
          <div className="tl-days">
            {zoom === 'week'
              ? Array.from({ length: nDays }, (_, i) => {
                  const d = addDays(rs, i);
                  return (
                    <div key={i} style={{ width: dw }} className={diffDays(d, TODAY) === 0 ? 'today' : ''}>
                      {d.getDate()}
                    </div>
                  );
                })
              : Array.from({ length: nDays / 7 }, (_, i) => {
                  const d = addDays(rs, i * 7);
                  return (
                    <div key={i} style={{ width: dw * 7 }}>
                      {MON[d.getMonth()]} {d.getDate()}
                    </div>
                  );
                })}
          </div>
        </div>
        <div className="tl-grid" style={{ width: W, height: H + 40 }}>
          {zoom === 'week' &&
            Array.from({ length: nDays }, (_, i) => {
              const wd = addDays(rs, i).getDay();
              return wd === 0 || wd === 6 ? <div key={i} className="tl-we" style={{ left: i * dw, width: dw }} /> : null;
            })}
          {Array.from({ length: nDays / 7 }, (_, i) => (
            <div key={i} className="tl-gl" style={{ left: i * 7 * dw }} />
          ))}
          <div className="tl-today" style={{ left: todayX + dw / 2 }} title="Today" />
          {bars}
          <svg className="tl-deps" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            {deps}
          </svg>
        </div>
      </div>
    </div>
  );
}

/** Вкладка Timeline страницы проекта (taskViewBody('timeline')): тулбар с контролами, «New task» и диаграмма */
/* api — общее состояние вида страницы проекта: фильтры сохраняются при переключении вкладок */
export function ProjectTimelineTab({ project, api: shared }: { project: Project; api?: ViewApi }) {
  const { data } = useWorkspace();
  const own = useListView();
  const api = shared ?? own;
  const tl = useTimeline('status');
  // Форма новой задачи ещё не перенесена
  const newTask = () => toast.info('Форма новой задачи пока не перенесена');
  const tasks = applyView(tasksOf(data, project.id), api.view, data);
  return (
    <>
      <ViewToolbar
        api={api}
        group={false}
        extra={<TimelineControls tl={tl} />}
        right={
          <Button variant="primary" size="sm" onClick={newTask}>
            <Plus size={13} />
            New task
          </Button>
        }
      />
      <TimelineView tasks={tasks} project={project} tl={tl} id={`tl:${project.id}`} onNewTask={newTask} />
    </>
  );
}
