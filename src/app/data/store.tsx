/* Состояние воркспейса: один reducer вместо прямых мутаций глобального объекта S из оригинала.
   Компоненты читают данные через useWorkspace() и меняют их только через dispatch(action). */
import * as React from 'react';
import { seed } from './seed';
import { PRIORITIES, STATUSES } from '@/components/gr8r/task';
import { PROJECT_STATUS, fileKind } from './selectors';
import { dOff, fmtDate } from '../lib/dates';
import type { Activity, Member, Project, ProjectFile, SavedView, Status, Subtask, Task, WorkspaceData } from './types';

export type TaskPatch = Partial<Pick<Task, 'title' | 'status' | 'assignee' | 'priority' | 'due' | 'start' | 'fav' | 'project' | 'estimate' | 'order' | 'archived' | 'labels' | 'deps' | 'recur' | 'desc'>>;
export type SubtaskPatch = Partial<Pick<Subtask, 'title' | 'assignee' | 'due' | 'note'>>;

export type Action =
  | { type: 'task/toggleDone'; id: string }
  | { type: 'task/update'; id: string; patch: TaskPatch }
  | { type: 'task/toggleSubtask'; id: string; subtask: string }
  | { type: 'task/create'; task: Pick<Task, 'title' | 'project'> & TaskPatch & Partial<Pick<Task, 'id' | 'key' | 'labels' | 'recur' | 'subtasks' | 'attachments' | 'desc'>> }
  | { type: 'project/toggleFav'; id: string }
  | { type: 'project/update'; id: string; patch: ProjectPatch }
  | { type: 'project/create'; id: string; form: ProjectForm; tasks: string[] }
  | { type: 'project/duplicate'; id: string; newId: string }
  | { type: 'project/delete'; id: string }
  | { type: 'project/inviteMember'; id: string; member: Member; perm: string }
  | { type: 'savedView/create'; view: SavedView }
  | { type: 'workspace/restore'; snapshot: WorkspaceData }
  | { type: 'notif/setRead'; id: string; read: boolean }
  | { type: 'notif/markAllRead' }
  | { type: 'task/delete'; ids: string[] }
  | { type: 'task/archive'; id: string }
  | { type: 'task/duplicate'; id: string; newId: string }
  | { type: 'task/attach'; id: string; file: { name: string; size: string } }
  | { type: 'task/detach'; id: string; attachment: string }
  | { type: 'subtask/add'; id: string; sub: string; title: string }
  | { type: 'subtask/remove'; id: string; sub: string }
  | { type: 'subtask/update'; id: string; sub: string; patch: SubtaskPatch }
  | { type: 'subtask/promote'; id: string; sub: string; newId: string }
  | { type: 'comment/add'; task: string; text: string }
  | { type: 'comment/delete'; id: string }
  | { type: 'comment/react'; id: string; emoji: string }
  /** Откат к снимку данных (Undo после удаления и архивации) */
  | { type: 'data/restore'; data: WorkspaceData }
  | { type: 'file/add'; file: Pick<ProjectFile, 'project' | 'name' | 'size'> & Partial<Pick<ProjectFile, 'task'>> }
  | { type: 'file/rename'; id: string; name: string }
  | { type: 'file/duplicate'; id: string }
  | { type: 'file/delete'; id: string }
  | { type: 'file/restore'; file: ProjectFile; index: number }
  | { type: 'member/invite'; emails: string[]; role: Member['role']; team: string }
  | { type: 'member/setRole'; id: string; role: Member['role'] }
  | { type: 'member/remove'; id: string }
  | { type: 'member/restore'; member: Member; index: number; tasks: string[]; projects: string[] };

export type ProjectPatch = Partial<Pick<Project, 'status' | 'name' | 'desc' | 'icon' | 'color' | 'team' | 'lead' | 'due' | 'members' | 'perms' | 'access' | 'archived' | 'archivedAt'>>;
export type ProjectForm = Pick<Project, 'name' | 'desc' | 'icon' | 'color' | 'team' | 'lead' | 'due'>;

let seq = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${++seq}`;
/** Идентификатор для новой сущности, который вызывающий код должен знать заранее (например, чтобы открыть её) */
export const newId = uid;

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

/** Записи активности для изменённых полей — как applyPatch в оригинале */
function patchLog(d: WorkspaceData, t: Task, patch: TaskPatch): [string, string][] {
  const out: [string, string][] = [];
  const who = (id: string | null) => d.members.find(m => m.id === id)?.name;
  for (const k of Object.keys(patch) as (keyof TaskPatch)[]) {
    const nv = patch[k];
    if (JSON.stringify(t[k]) === JSON.stringify(nv)) continue;
    if (k === 'status') {
      const name = (id: Status) => STATUSES.find(x => x.id === id)?.name;
      out.push(nv === 'done' ? ['completed', ''] : ['moved', `from ${name(t.status)} to ${name(nv as Status)}`]);
    } else if (k === 'assignee') out.push(['assigned', nv ? `to ${who(nv as string)}` : '(unassigned)']);
    else if (k === 'priority') out.push(['changed priority of', `to ${PRIORITIES.find(x => x.id === nv)?.name}`]);
    else if (k === 'due') out.push(['changed due date of', nv ? `to ${fmtDate(nv as string)}` : '(cleared)']);
    else if (k === 'start') out.push(['changed start date of', nv ? `to ${fmtDate(nv as string)}` : '(cleared)']);
    else if (k === 'project') out.push(['moved', `to ${d.projects.find(p => p.id === nv)?.name}`]);
    else if (k === 'labels') out.push(['updated labels on', '']);
    else if (k === 'title') out.push(['renamed', `to “${nv}”`]);
    else if (k === 'recur') out.push(['set repeat on', nv ? String(nv).toLowerCase() : 'off']);
    else if (k === 'estimate') out.push(['estimated', (nv as string) || 'none']);
    else if (k === 'deps') out.push(['updated dependencies of', '']);
  }
  return out;
}

export function nextKey(d: WorkspaceData, projectId: string) {
  const p = d.projects.find(x => x.id === projectId)!;
  const nums = d.tasks.filter(t => t.project === projectId).map(t => +t.key.split('-')[1] || 0);
  return `${p.key}-${Math.max(100, ...nums) + 1}`;
}

/** Ключ нового проекта из инициалов названия (makeKey из actions.js); занятые ключи получают суффикс X */
function makeKey(d: WorkspaceData, name: string) {
  let k = name
    .split(/\s+/)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3);
  if (k.length < 2) k = name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PRJ';
  while (d.projects.some(p => p.key === k)) k += 'X';
  return k;
}

/** Заготовка задачи со значениями по умолчанию (createTask из actions.js) */
function blankTask(d: WorkspaceData, extra: Partial<Task> & Pick<Task, 'project'>, tasks: Task[]): Task {
  return {
    id: uid('t'),
    key: nextKey({ ...d, tasks }, extra.project),
    title: 'Untitled',
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
    order: Math.max(0, ...tasks.map(x => x.order)) + 1,
    fav: false,
    recur: null,
    ...extra,
  };
}

/** Новый проект + задачи шаблона (createProject из actions.js) */
function addProject(d: WorkspaceData, id: string, f: ProjectForm, starter: string[]): WorkspaceData {
  const p: Project = {
    id,
    key: makeKey(d, f.name),
    name: f.name,
    icon: f.icon,
    color: f.color,
    status: 'planning',
    team: f.team,
    lead: f.lead,
    due: f.due || dOff(30),
    start: dOff(0),
    fav: false,
    members: [...new Set([d.me, f.lead])],
    desc: f.desc || 'No description yet.',
    milestones: [],
    last: 0,
  };
  const withP = { ...d, projects: [...d.projects, p] };
  let tasks = d.tasks;
  starter.forEach((title, i) => {
    tasks = [
      ...tasks,
      blankTask(withP, { project: id, title, status: i === 0 ? 'todo' : 'backlog', assignee: i === 0 ? d.me : null, priority: i === 0 ? 'high' : 'medium', due: dOff(5 + i * 5), start: dOff(i * 5) }, tasks),
    ];
  });
  return {
    ...withP,
    tasks,
    projOrder: [id, ...d.projOrder],
    activity: [{ id: uid('a'), by: d.me, verb: 'created project', task: null, project: id, at: Date.now(), extra: '' }, ...d.activity],
  };
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
    case 'task/update': {
      const t = d.tasks.find(x => x.id === a.id);
      if (!t) return d;
      const patch = { ...a.patch };
      // Срок раньше даты начала подтягивает начало (popPick в оригинале)
      if (patch.due && t.start && t.start > patch.due) patch.start = patch.due;
      const next = patchTask(t, patch);
      if (patch.project && patch.project !== t.project) next.key = nextKey(d, patch.project);
      let activity = d.activity;
      for (const [verb, extra] of patchLog(d, t, patch)) activity = [{ id: uid('a'), by: d.me, verb, task: t.id, project: next.project, at: Date.now(), extra }, ...activity];
      return { ...d, tasks: d.tasks.map(x => (x.id === t.id ? next : x)), activity };
    }
    case 'task/toggleSubtask': {
      const t = d.tasks.find(x => x.id === a.id);
      const sub = t?.subtasks.find(s => s.id === a.subtask);
      if (!t || !sub) return d;
      return {
        ...d,
        tasks: d.tasks.map(x => (x.id === t.id ? { ...t, updated: Date.now(), subtasks: t.subtasks.map(s => (s.id === sub.id ? { ...s, done: !s.done } : s)) } : x)),
        activity: logActivity(d, sub.done ? 'reopened subtask on' : 'completed subtask on', t, `“${sub.title}”`),
      };
    }
    case 'task/delete': {
      const ids = new Set(a.ids);
      return {
        ...d,
        tasks: d.tasks.filter(t => !ids.has(t.id)).map(t => (t.deps.some(x => ids.has(x)) ? { ...t, deps: t.deps.filter(x => !ids.has(x)) } : t)),
        comments: d.comments.filter(c => !ids.has(c.task)),
      };
    }
    case 'task/archive': {
      const t = d.tasks.find(x => x.id === a.id);
      if (!t) return d;
      return {
        ...d,
        tasks: d.tasks.map(x => (x.id === t.id ? { ...t, archived: true, archivedAt: Date.now(), updated: Date.now() } : x)),
        activity: logActivity(d, 'archived', t),
      };
    }
    case 'task/duplicate': {
      const t = d.tasks.find(x => x.id === a.id);
      if (!t) return d;
      const copy: Task = {
        ...(JSON.parse(JSON.stringify(t)) as Task),
        id: a.newId,
        key: nextKey(d, t.project),
        title: t.title + ' (copy)',
        created: Date.now(),
        updated: Date.now(),
        fav: false,
        order: Math.max(0, ...d.tasks.map(x => x.order)) + 1,
      };
      return { ...d, tasks: [...d.tasks, copy], activity: logActivity(d, 'created', copy) };
    }
    case 'task/attach': {
      const t = d.tasks.find(x => x.id === a.id);
      if (!t) return d;
      const rec = { id: uid('f'), name: a.file.name, type: fileKind(a.file.name), size: a.file.size, by: d.me, at: Date.now() };
      return {
        ...d,
        tasks: d.tasks.map(x => (x.id === t.id ? { ...t, updated: Date.now(), attachments: [...t.attachments, rec] } : x)),
        files: [{ ...rec, project: t.project, task: t.id }, ...d.files],
        activity: logActivity(d, 'added a file to', t, a.file.name),
      };
    }
    case 'task/detach': {
      const t = d.tasks.find(x => x.id === a.id);
      if (!t) return d;
      return {
        ...d,
        tasks: d.tasks.map(x => (x.id === t.id ? { ...t, updated: Date.now(), attachments: t.attachments.filter(f => f.id !== a.attachment) } : x)),
        activity: logActivity(d, 'removed a file from', t),
      };
    }
    case 'subtask/add': {
      const t = d.tasks.find(x => x.id === a.id);
      if (!t) return d;
      return {
        ...d,
        tasks: d.tasks.map(x => (x.id === t.id ? { ...t, updated: Date.now(), subtasks: [...t.subtasks, { id: a.sub, title: a.title, done: false }] } : x)),
        activity: logActivity(d, 'added subtask to', t, `“${a.title}”`),
      };
    }
    case 'subtask/remove':
      return { ...d, tasks: d.tasks.map(t => (t.id === a.id ? { ...t, subtasks: t.subtasks.filter(s => s.id !== a.sub) } : t)) };
    case 'subtask/update': {
      const t = d.tasks.find(x => x.id === a.id);
      const sub = t?.subtasks.find(s => s.id === a.sub);
      if (!t || !sub) return d;
      let activity = d.activity;
      if ('assignee' in a.patch && (a.patch.assignee ?? null) !== (sub.assignee ?? null))
        activity = logActivity({ ...d, activity }, 'assigned a subtask on', t, a.patch.assignee ? `to ${d.members.find(m => m.id === a.patch.assignee)?.name}` : '(unassigned)');
      if ('due' in a.patch && (a.patch.due ?? null) !== (sub.due ?? null))
        activity = logActivity({ ...d, activity }, 'set a subtask due date on', t, a.patch.due ? fmtDate(a.patch.due) : '(cleared)');
      return {
        ...d,
        tasks: d.tasks.map(x => (x.id === t.id ? { ...t, updated: Date.now(), subtasks: t.subtasks.map(s => (s.id === sub.id ? { ...s, ...a.patch } : s)) } : x)),
        activity,
      };
    }
    case 'subtask/promote': {
      const t = d.tasks.find(x => x.id === a.id);
      const sub = t?.subtasks.find(s => s.id === a.sub);
      if (!t || !sub) return d;
      const esc = (v: string) => v.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      const n: Task = {
        id: a.newId,
        key: nextKey(d, t.project),
        project: t.project,
        title: sub.title,
        status: sub.done ? 'done' : 'todo',
        assignee: sub.assignee || t.assignee,
        priority: t.priority,
        due: sub.due || null,
        start: null,
        labels: [...t.labels],
        subtasks: [],
        attachments: [],
        deps: [],
        desc: sub.note ? `<p>${esc(sub.note)}</p>` : '',
        estimate: null,
        created: Date.now(),
        updated: Date.now(),
        order: Math.max(0, ...d.tasks.map(x => x.order)) + 1,
        fav: false,
        recur: null,
      };
      const base = { ...d, tasks: [...d.tasks.map(x => (x.id === t.id ? { ...t, subtasks: t.subtasks.filter(s => s.id !== sub.id) } : x)), n] };
      const created = { ...base, activity: logActivity(base, 'created', n) };
      return { ...created, activity: logActivity(created, 'converted a subtask of', t, `into ${n.key}`) };
    }
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
    case 'project/create':
      return addProject(d, a.id, a.form, a.tasks);
    case 'project/duplicate': {
      const p = d.projects.find(x => x.id === a.id);
      if (!p) return d;
      const { name, desc, icon, color, team, lead, due } = p;
      let next = addProject(d, a.newId, { name: name + ' copy', desc, icon, color, team, lead, due }, []);
      let tasks = next.tasks;
      d.tasks.filter(t => t.project === p.id && !t.archived).forEach(t => {
        const { key: _key, ...rest } = structuredClone(t);
        tasks = [...tasks, blankTask(next, { ...rest, id: uid('t'), project: a.newId, status: 'todo' }, tasks)];
      });
      next = { ...next, tasks };
      return next;
    }
    case 'project/delete': {
      const ids = new Set(d.tasks.filter(t => t.project === a.id).map(t => t.id));
      return {
        ...d,
        projects: d.projects.filter(p => p.id !== a.id),
        projOrder: d.projOrder.filter(x => x !== a.id),
        tasks: d.tasks.filter(t => !ids.has(t.id)).map(t => (t.deps.some(x => ids.has(x)) ? { ...t, deps: t.deps.filter(x => !ids.has(x)) } : t)),
        comments: d.comments.filter(c => !ids.has(c.task)),
        files: d.files.filter(f => f.project !== a.id),
        savedViews: d.savedViews.filter(v => v.project !== a.id),
      };
    }
    case 'project/inviteMember':
      return {
        ...d,
        members: [...d.members, a.member],
        projects: d.projects.map(p => (p.id === a.id ? { ...p, members: [...p.members, a.member.id], perms: { ...p.perms, [a.member.id]: a.perm } } : p)),
      };
    case 'savedView/create':
      return { ...d, savedViews: [...d.savedViews, a.view] };
    case 'workspace/restore':
      return a.snapshot;
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
    case 'comment/delete':
      return { ...d, comments: d.comments.filter(c => c.id !== a.id) };
    case 'data/restore':
      return a.data;
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
    case 'member/invite': {
      // Приглашённый получает имя из адреса (john.doe@… → John Doe); уже существующие адреса пропускаются
      const fresh = a.emails.filter((e, i) => a.emails.indexOf(e) === i && !d.members.some(m => m.email === e));
      const added: Member[] = fresh.map(e => ({
        id: uid('m'),
        name: e
          .split('@')[0]
          .replace(/[._-]+/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase()),
        email: e,
        role: a.role,
        team: a.team,
        title: a.role,
        c: '#6B7280',
        status: 'invited',
        last: null,
        tz: '—',
      }));
      return { ...d, members: [...d.members, ...added] };
    }
    case 'member/setRole':
      return { ...d, members: d.members.map(m => (m.id === a.id ? { ...m, role: a.role } : m)) };
    case 'member/remove':
      // Открытые задачи участника остаются без исполнителя, из проектов он выходит
      return {
        ...d,
        members: d.members.filter(m => m.id !== a.id),
        tasks: d.tasks.map(t => (t.assignee === a.id ? { ...t, assignee: null } : t)),
        projects: d.projects.map(p => (p.members.includes(a.id) ? { ...p, members: p.members.filter(x => x !== a.id) } : p)),
      };
    case 'member/restore':
      // Отмена удаления: участник возвращается на прежнее место, в свои задачи и проекты
      return {
        ...d,
        members: [...d.members.slice(0, a.index), a.member, ...d.members.slice(a.index)],
        tasks: d.tasks.map(t => (a.tasks.includes(t.id) ? { ...t, assignee: a.member.id } : t)),
        projects: d.projects.map(p => (a.projects.includes(p.id) ? { ...p, members: [...p.members, a.member.id] } : p)),
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
