/* Состояние воркспейса: один reducer вместо прямых мутаций глобального объекта S из оригинала.
   Компоненты читают данные через useWorkspace() и меняют их только через dispatch(action). */
import * as React from 'react';
import { seed } from './seed';
import { PROJECT_STATUS, fileKind } from './selectors';
import type { Activity, Project, ProjectFile, Status, Task, WorkspaceData } from './types';

export type TaskPatch = Partial<Pick<Task, 'title' | 'status' | 'assignee' | 'priority' | 'due' | 'start' | 'fav' | 'project' | 'estimate' | 'order' | 'archived'>>;

export type Action =
  | { type: 'task/toggleDone'; id: string }
  | { type: 'task/update'; id: string; patch: TaskPatch }
  | { type: 'task/toggleSubtask'; id: string; subtask: string }
  | { type: 'task/create'; task: Pick<Task, 'title' | 'project'> & TaskPatch & Partial<Pick<Task, 'id' | 'key' | 'labels' | 'recur' | 'subtasks' | 'attachments' | 'desc'>> }
  | { type: 'project/toggleFav'; id: string }
  | { type: 'project/update'; id: string; patch: Partial<Pick<Project, 'status'>> }
  | { type: 'notif/setRead'; id: string; read: boolean }
  | { type: 'notif/markAllRead' }
  | { type: 'comment/add'; task: string; text: string }
  | { type: 'comment/react'; id: string; emoji: string }
  | { type: 'file/add'; file: Pick<ProjectFile, 'project' | 'name' | 'size'> & Partial<Pick<ProjectFile, 'task'>> }
  | { type: 'file/rename'; id: string; name: string }
  | { type: 'file/duplicate'; id: string }
  | { type: 'file/delete'; id: string }
  | { type: 'file/restore'; file: ProjectFile; index: number };

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

export function nextKey(d: WorkspaceData, projectId: string) {
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
    case 'project/toggleFav':
      return { ...d, projects: d.projects.map(p => (p.id === a.id ? { ...p, fav: !p.fav } : p)) };
    case 'project/update': {
      const p = d.projects.find(x => x.id === a.id);
      if (!p) return d;
      const next = { ...p, ...a.patch };
      // Смена статуса проекта попадает в ленту активности — как в оригинале (popPick → pstatus)
      const activity: Activity[] =
        a.patch.status && a.patch.status !== p.status
          ? [{ id: uid('a'), by: d.me, verb: 'changed status of project', task: null, project: p.id, at: Date.now(), extra: 'to ' + PROJECT_STATUS[a.patch.status].name }, ...d.activity]
          : d.activity;
      return { ...d, projects: d.projects.map(x => (x.id === p.id ? next : x)), activity };
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
    case 'file/add':
      return { ...d, files: [{ id: uid('f'), type: fileKind(a.file.name), by: d.me, at: Date.now(), task: null, ...a.file }, ...d.files] };
    case 'file/rename':
      return { ...d, files: d.files.map(f => (f.id === a.id ? { ...f, name: a.name, type: fileKind(a.name) } : f)) };
    case 'file/duplicate': {
      const i = d.files.findIndex(f => f.id === a.id);
      if (i < 0) return d;
      const f = d.files[i];
      const copy: ProjectFile = { ...f, id: uid('f'), name: f.name.replace(/(\.[^.]+)$/, ' copy$1'), at: Date.now(), by: d.me };
      return { ...d, files: [...d.files.slice(0, i + 1), copy, ...d.files.slice(i + 1)] };
    }
    case 'file/delete': {
      const f = d.files.find(x => x.id === a.id);
      if (!f) return d;
      // Файл, прикреплённый к задаче, пропадает и из её вложений
      return {
        ...d,
        files: d.files.filter(x => x.id !== a.id),
        tasks: f.task ? d.tasks.map(t => (t.id === f.task ? { ...t, attachments: t.attachments.filter(x => x.name !== f.name) } : t)) : d.tasks,
      };
    }
    case 'file/restore':
      return { ...d, files: [...d.files.slice(0, a.index), a.file, ...d.files.slice(a.index)] };
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
