/* Состояние воркспейса: один reducer вместо прямых мутаций глобального объекта S из оригинала.
   Компоненты читают данные через useWorkspace() и меняют их только через dispatch(action). */
import * as React from 'react';
import { seed } from './seed';
import type { Activity, Status, Task, WorkspaceData } from './types';

export type TaskPatch = Partial<Pick<Task, 'title' | 'status' | 'assignee' | 'priority' | 'due' | 'fav' | 'project' | 'estimate' | 'order' | 'archived'>>;

export type Action =
  | { type: 'task/toggleDone'; id: string }
  | { type: 'task/update'; id: string; patch: TaskPatch }
  | { type: 'task/toggleSubtask'; id: string; subtask: string }
  | { type: 'task/create'; task: Pick<Task, 'title' | 'project'> & TaskPatch }
  | { type: 'notif/setRead'; id: string; read: boolean }
  | { type: 'notif/markAllRead' }
  | { type: 'comment/add'; task: string; text: string }
  | { type: 'comment/react'; id: string; emoji: string };

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${++seq}`;

function logActivity(d: WorkspaceData, verb: string, t: Task, extra = ''): Activity[] {
  return [{ id: uid('a'), by: d.me, verb, task: t.id, project: t.project, at: Date.now(), extra }, ...d.activity];
}

/** Применяет изменения к задаче; при смене статуса запоминает прошлый (для «Undo» и «вернуть в работу») */
function patchTask(t: Task, patch: TaskPatch): Task {
  const next: Task = { ...t, ...patch, updated: Date.now() };
  if (patch.status && patch.status !== t.status) {
    next.prevStatus = t.status;
    next.completedAt = patch.status === 'done' ? Date.now() : undefined;
  }
  return next;
}

function nextKey(d: WorkspaceData, projectId: string) {
  const p = d.projects.find(x => x.id === projectId)!;
  const nums = d.tasks.filter(t => t.project === projectId).map(t => +t.key.split('-')[1] || 0);
  return `${p.key}-${Math.max(100, ...nums) + 1}`;
}

function reducer(d: WorkspaceData, a: Action): WorkspaceData {
  switch (a.type) {
    case 'task/toggleDone': {
      const t = d.tasks.find(x => x.id === a.id);
      if (!t) return d;
      const status: Status = t.status === 'done' ? (t.prevStatus && t.prevStatus !== 'done' ? t.prevStatus : 'todo') : 'done';
      const next = patchTask(t, { status });
      return {
        ...d,
        tasks: d.tasks.map(x => (x.id === t.id ? next : x)),
        activity: status === 'done' ? logActivity(d, 'completed', t) : d.activity,
      };
    }
    case 'task/update':
      return { ...d, tasks: d.tasks.map(t => (t.id === a.id ? patchTask(t, a.patch) : t)) };
    case 'task/toggleSubtask':
      return {
        ...d,
        tasks: d.tasks.map(t => (t.id === a.id ? { ...t, updated: Date.now(), subtasks: t.subtasks.map(s => (s.id === a.subtask ? { ...s, done: !s.done } : s)) } : t)),
      };
    case 'task/create': {
      const t: Task = {
        id: uid('t'),
        key: nextKey(d, a.task.project),
        status: 'todo',
        assignee: null,
        priority: 'none',
        due: null,
        start: null,
        labels: [],
        subtasks: [],
        attachments: [],
        deps: [],
        desc: '',
        estimate: null,
        created: Date.now(),
        updated: Date.now(),
        order: Math.max(0, ...d.tasks.map(x => x.order)) + 1,
        fav: false,
        recur: null,
        ...a.task,
      };
      return { ...d, tasks: [...d.tasks, t], activity: logActivity(d, 'created', t) };
    }
    case 'notif/setRead':
      return { ...d, notifs: d.notifs.map(n => (n.id === a.id ? { ...n, read: a.read } : n)) };
    case 'notif/markAllRead':
      return { ...d, notifs: d.notifs.map(n => (n.read ? n : { ...n, read: true })) };
    case 'comment/add': {
      const t = d.tasks.find(x => x.id === a.task);
      if (!t || !a.text.trim()) return d;
      return {
        ...d,
        comments: [...d.comments, { id: uid('c'), task: a.task, by: d.me, at: Date.now(), text: a.text.trim(), re: {} }],
        activity: logActivity(d, 'commented on', t),
      };
    }
    case 'comment/react':
      return {
        ...d,
        comments: d.comments.map(c => {
          if (c.id !== a.id) return c;
          const list = c.re[a.emoji] ?? [];
          return { ...c, re: { ...c.re, [a.emoji]: list.includes(d.me) ? list.filter(x => x !== d.me) : [...list, d.me] } };
        }),
      };
  }
}

const Ctx = React.createContext<{ data: WorkspaceData; dispatch: React.Dispatch<Action> } | null>(null);

export function WorkspaceProvider({ children, initial }: { children: React.ReactNode; initial?: WorkspaceData }) {
  const [data, dispatch] = React.useReducer(reducer, initial, i => i ?? seed());
  const value = React.useMemo(() => ({ data, dispatch }), [data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useWorkspace() нужно вызывать внутри <WorkspaceProvider>');
  return c;
}
