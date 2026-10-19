/* Чистые функции над данными воркспейса — порт «lookups» из core/store.js.
   Не зависят от React: их легко тестировать и переиспользовать на сервере. */
import { PRIORITIES, STATUSES } from '@/components/gr8r/task';
import { diffDays, parse, today } from '../lib/dates';
import type { Project, ProjectColor, ProjectStatus, Task, WorkspaceData } from './types';

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

export type SortField = 'manual' | 'title' | 'due' | 'priority' | 'status' | 'created' | 'updated';

export function sortTasks(ts: Task[], f: SortField, dir: 1 | -1 = 1) {
  const key: (t: Task) => string | number = {
    manual: (t: Task) => t.order,
    title: (t: Task) => t.title.toLowerCase(),
    due: (t: Task) => t.due || '9999',
    priority: (t: Task) => -PRIORITIES.find(p => p.id === t.priority)!.w,
    status: (t: Task) => STATUSES.findIndex(s => s.id === t.status),
    created: (t: Task) => -t.created,
    updated: (t: Task) => -t.updated,
  }[f];
  return [...ts].sort((x, y) => {
    const p = key(x),
      q = key(y);
    return (p > q ? 1 : p < q ? -1 : 0) * dir;
  });
}
