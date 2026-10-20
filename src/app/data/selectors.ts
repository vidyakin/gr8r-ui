/* Чистые функции над данными воркспейса — порт «lookups» из core/store.js.
   Не зависят от React: их легко тестировать и переиспользовать на сервере. */
import { PRIORITIES, STATUSES } from '@/components/gr8r/task';
import { diffDays, parse, today } from '../lib/dates';
import type { LabelId, Notification, Project, ProjectColor, ProjectStatus, Task, WorkspaceData } from './types';

export const PROJECT_COLORS: Record<ProjectColor, string> = {
  indigo: '#5A67D8',
  blue: '#3B82C4',
  violet: '#8662C9',
  teal: '#23918A',
  rose: '#C54B78',
  amber: '#C48A1E',
  green: '#3D8E5F',
  slate: '#6B7280',
};

export const PROJECT_STATUS: Record<ProjectStatus, { name: string; c: string }> = {
  planning: { name: 'Planning', c: 'var(--gray)' },
  active: { name: 'In Progress', c: 'var(--blue)' },
  risk: { name: 'At Risk', c: 'var(--red)' },
  hold: { name: 'On Hold', c: 'var(--amber)' },
  complete: { name: 'Completed', c: 'var(--green)' },
};

/** Метки задач (LABELS из core/constants.js) */
export const LABELS: Record<LabelId, { name: string; c: string }> = {
  design: { name: 'Design', c: 'var(--violet)' },
  frontend: { name: 'Frontend', c: 'var(--blue)' },
  backend: { name: 'Backend', c: 'var(--teal)' },
  research: { name: 'Research', c: 'var(--amber)' },
  content: { name: 'Content', c: 'var(--rose)' },
  bug: { name: 'Bug', c: 'var(--red)' },
  qa: { name: 'QA', c: 'var(--green)' },
  growth: { name: 'Growth', c: 'var(--orange)' },
};

export const projectColor = (p?: Project | null) => PROJECT_COLORS[p?.color ?? 'slate'];

export const member = (d: WorkspaceData, id: string | null | undefined) => d.members.find(m => m.id === id);
export const project = (d: WorkspaceData, id: string | null | undefined) => d.projects.find(p => p.id === id);
export const task = (d: WorkspaceData, id: string | null | undefined) => d.tasks.find(t => t.id === id);
export const me = (d: WorkspaceData) => member(d, d.me)!;

export const canSee = (d: WorkspaceData, p?: Project) => !!p && (!p.private || p.members.includes(d.me));

export const visibleProjects = (d: WorkspaceData) =>
  d.projOrder
    .map(id => project(d, id))
    .filter((p): p is Project => !!p && !p.archived);

export const tasksOf = (d: WorkspaceData, pid: string) => d.tasks.filter(t => t.project === pid && !t.archived);

/** Все неархивные задачи из проектов, которые видит текущий пользователь */
export const allTasks = (d: WorkspaceData) => d.tasks.filter(t => !t.archived && canSee(d, project(d, t.project)));

export const isOverdue = (t: Task) => !!t.due && t.status !== 'done' && diffDays(parse(t.due), today()) < 0;

export function progressOf(d: WorkspaceData, pid: string) {
  const ts = tasksOf(d, pid);
  if (!ts.length) return 0;
  return Math.round((ts.filter(t => t.status === 'done').length / ts.length) * 100);
}

export type SortField = 'manual' | 'title' | 'due' | 'priority' | 'status' | 'created' | 'updated' | 'assignee' | 'start' | 'estimate' | 'project';

/** Для сортировки по исполнителю и проекту нужны данные воркспейса (d); без них эти поля падают на ручной порядок */
export function sortTasks(ts: Task[], f: SortField, dir: 1 | -1 = 1, d?: WorkspaceData) {
  const key: (t: Task) => string | number = {
    manual: (t: Task) => t.order,
    title: (t: Task) => t.title.toLowerCase(),
    due: (t: Task) => t.due || '9999',
    priority: (t: Task) => -PRIORITIES.find(p => p.id === t.priority)!.w,
    status: (t: Task) => STATUSES.findIndex(s => s.id === t.status),
    created: (t: Task) => -t.created,
    updated: (t: Task) => -t.updated,
    start: (t: Task) => t.start || '9999',
    estimate: (t: Task) => t.estimate || 'zzz',
    assignee: (t: Task) => (d ? member(d, t.assignee)?.name : undefined) || 'zzz',
    project: (t: Task) => (d ? project(d, t.project)?.name : undefined) ?? t.order,
  }[f];
  return [...ts].sort((x, y) => {
    const p = key(x),
      q = key(y);
    return (p > q ? 1 : p < q ? -1 : 0) * dir;
  });
}

export const commentsOf = (d: WorkspaceData, taskId: string) => d.comments.filter(c => c.task === taskId);

/** Задача и проект, к которым относится уведомление */
export function notifTarget(d: WorkspaceData, n: Notification) {
  const t = task(d, n.task);
  const p = project(d, n.project ?? t?.project);
  return { task: t, project: p };
}

/** Группа ленты по дате: Today / Yesterday / This week / Earlier */
export function dayBucket(ts: number) {
  const n = diffDays(new Date(ts), today());
  if (n === 0) return 'Today';
  if (n === -1) return 'Yesterday';
  if (n > -7) return 'This week';
  return 'Earlier';
}

/* ---------- фильтры списков (порт shell/view-engine.js) ---------- */

export type FilterField = 'status' | 'assignee' | 'priority' | 'due' | 'project';
export interface Filter {
  f: FilterField;
  v: string[];
}

export function matchFilter(t: Task, f: Filter) {
  if (!f.v.length) return true;
  if (f.f === 'assignee') return f.v.includes(t.assignee || 'none');
  if (f.f === 'due')
    return f.v.some(v => {
      if (v === 'nodate') return !t.due;
      if (!t.due) return false;
      const n = diffDays(parse(t.due), today());
      return v === 'overdue' ? isOverdue(t) : v === 'today' ? n === 0 : v === 'week' ? n >= 0 && n <= 7 : n > 7;
    });
  return f.v.includes(t[f.f]);
}

export interface ListView {
  q: string;
  filters: Filter[];
  sort: { f: SortField; dir: 1 | -1 };
}

export function applyView(ts: Task[], v: ListView, d?: WorkspaceData) {
  const q = v.q.trim().toLowerCase();
  const out = ts.filter(t => v.filters.every(f => matchFilter(t, f)) && (!q || t.title.toLowerCase().includes(q) || t.key.toLowerCase().includes(q)));
  return sortTasks(out, v.sort.f, v.sort.dir, d);
}

/* ---------- группировка (порт groupTasks из shell/view-engine.js) ---------- */

export type GroupBy = 'status' | 'priority' | 'assignee' | 'project' | 'due' | 'none';

export interface TaskBucket {
  key: string;
  name: string;
  tasks: Task[];
  /** Поля, которые получит задача, созданная или перетащенная в эту группу */
  set?: Partial<Pick<Task, 'status' | 'priority' | 'assignee' | 'project' | 'due'>>;
}

const DUE_BUCKETS = [
  { key: 'overdue', name: 'Overdue' },
  { key: 'today', name: 'Today' },
  { key: 'week', name: 'Next 7 days' },
  { key: 'later', name: 'Later' },
  { key: 'nodate', name: 'No due date' },
];

export function groupTasks(d: WorkspaceData, ts: Task[], g: GroupBy): TaskBucket[] {
  if (g === 'none') return [{ key: 'all', name: 'All tasks', tasks: ts }];
  let groups: Omit<TaskBucket, 'tasks'>[];
  if (g === 'status') groups = STATUSES.map(s => ({ key: s.id, name: s.name, set: { status: s.id } }));
  else if (g === 'priority') groups = PRIORITIES.map(p => ({ key: p.id, name: p.name, set: { priority: p.id } }));
  else if (g === 'assignee')
    groups = [...d.members.map(m => ({ key: m.id, name: m.name, set: { assignee: m.id } })), { key: 'none', name: 'Unassigned', set: { assignee: null } }];
  else if (g === 'project') groups = visibleProjects(d).filter(p => canSee(d, p)).map(p => ({ key: p.id, name: p.name, set: { project: p.id } }));
  else groups = DUE_BUCKETS;
  const out = groups.map(G => ({
    ...G,
    tasks: ts.filter(t => {
      if (g === 'assignee') return (t.assignee || 'none') === G.key;
      if (g === 'due') return matchFilter(t, { f: 'due', v: [G.key] });
      return t[g] === G.key;
    }),
  }));
  return g === 'status' || g === 'priority' ? out : out.filter(G => G.tasks.length);
}
