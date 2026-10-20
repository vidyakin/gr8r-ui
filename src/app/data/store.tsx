/* Состояние воркспейса: один reducer вместо прямых мутаций глобального объекта S из оригинала.
   Компоненты читают данные через useWorkspace() и меняют их только через dispatch(action). */
import * as React from 'react';
import { seed } from './seed';
import { PROJECT_STATUS, fileKind, fmtHours, statusOf, visibleProjects } from './selectors';
import { addSub, findSub, mapSub, reopenAncestors, removeSub, subPath, subtreeIds, toggleSub, flattenSubs } from './subtasks';
import { toast } from '@/components/ui';
import { dOff, fmtDate, iso, parse } from '../lib/dates';
import type { Activity, Member, Notification, Project, ProjectFile, SavedView, Status, StatusDef, Subtask, Task, TimeLog, WorkspaceData } from './types';

export type TaskPatch = Partial<Pick<Task, 'title' | 'status' | 'assignee' | 'priority' | 'due' | 'start' | 'fav' | 'project' | 'planHours' | 'order' | 'archived' | 'labels' | 'deps' | 'recur' | 'desc' | 'subtasks'>>;
export type SubtaskPatch = Partial<Pick<Subtask, 'title' | 'assignee' | 'due' | 'note' | 'planHours'>>;
export type TimeLogPatch = Partial<Pick<TimeLog, 'sub' | 'by' | 'hours' | 'date' | 'note'>>;

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
  /** Сдвиг проекта в сайдбаре на соседний видимый (projUp / projDown) */
  | { type: 'project/move'; id: string; dir: -1 | 1 }
  | { type: 'project/inviteMember'; id: string; member: Member; perm: string }
  | { type: 'savedView/create'; view: SavedView }
  /** Уведомление исполнителю о приоритете задачи */
  | { type: 'task/notifyPriority'; id: string }
  | { type: 'status/add'; status: StatusDef }
  | { type: 'status/rename'; id: string; name: string }
  /** Задачи удалённой колонки уходят в «To Do» */
  | { type: 'status/delete'; id: string }
  | { type: 'notif/setRead'; id: string; read: boolean }
  | { type: 'notif/markAllRead' }
  | { type: 'task/delete'; ids: string[] }
  | { type: 'task/archive'; id: string }
  | { type: 'task/duplicate'; id: string; newId: string }
  | { type: 'task/attach'; id: string; file: { name: string; size: string } }
  | { type: 'task/detach'; id: string; attachment: string }
  /** parent — id подзадачи, в которую вкладывается новая; без него — подзадача первого уровня */
  | { type: 'subtask/add'; id: string; sub: string; title: string; parent?: string }
  | { type: 'subtask/remove'; id: string; sub: string }
  | { type: 'subtask/update'; id: string; sub: string; patch: SubtaskPatch }
  | { type: 'subtask/promote'; id: string; sub: string; newId: string }
  | { type: 'timelog/add'; log: TimeLog }
  | { type: 'timelog/update'; id: string; patch: TimeLogPatch }
  | { type: 'timelog/delete'; id: string }
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
      const name = (id: Status) => statusOf(d, id)?.name;
      out.push(nv === 'done' ? ['completed', ''] : ['moved', `from ${name(t.status)} to ${name(nv as Status)}`]);
    } else if (k === 'assignee') out.push(['assigned', nv ? `to ${who(nv as string)}` : '(unassigned)']);
    else if (k === 'priority') out.push(['changed priority of', `to ${nv ?? 'none'}`]);
    else if (k === 'due') out.push(['changed due date of', nv ? `to ${fmtDate(nv as string)}` : '(cleared)']);
    else if (k === 'start') out.push(['changed start date of', nv ? `to ${fmtDate(nv as string)}` : '(cleared)']);
    else if (k === 'project') out.push(['moved', `to ${d.projects.find(p => p.id === nv)?.name}`]);
    else if (k === 'labels') out.push(['updated labels on', '']);
    else if (k === 'title') out.push(['renamed', `to “${nv}”`]);
    else if (k === 'recur') out.push(['set repeat on', nv ? String(nv).toLowerCase() : 'off']);
    else if (k === 'planHours') out.push(['changed plan of', nv == null ? '(cleared)' : `to ${fmtHours(nv as number)}`]);
    else if (k === 'deps') out.push(['updated dependencies of', '']);
  }
  return out;
}

/** Шаг повтора в днях (RECUR_DAYS из actions.js) */
const RECUR_DAYS: Record<string, number> = { Daily: 1, Weekly: 7, 'Every 2 weeks': 14, Monthly: 30 };

/** Следующая задача серии после завершения повторяющейся (applyPatch в actions.js): срок по правилу, To Do, подзадачи сброшены */
function nextRecurrence(d: WorkspaceData, t: Task): Task | null {
  if (!t.recur || !t.due) return null;
  const nd = parse(t.due);
  nd.setDate(nd.getDate() + (RECUR_DAYS[t.recur] || 7));
  const due = iso(nd);
  const reset = (list: Subtask[]): Subtask[] => list.map(x => ({ ...x, done: false, subtasks: reset(x.subtasks) }));
  const { prevStatus: _p, completedAt: _c, ...rest } = structuredClone(t);
  return {
    ...rest,
    id: uid('t'),
    key: nextKey(d, t.project),
    status: 'todo',
    due,
    start: due,
    subtasks: reset(t.subtasks),
    attachments: [],
    created: Date.now(),
    updated: Date.now(),
    order: Math.max(0, ...d.tasks.map(x => x.order)) + 1,
    fav: false,
  };
}

/** Какая задача станет «выполненной» этим действием — для создания следующей в серии */
function completedBy(d: WorkspaceData, a: Action): Task | undefined {
  if (a.type === 'task/toggleDone') {
    const t = d.tasks.find(x => x.id === a.id);
    return t && t.status !== 'done' ? t : undefined;
  }
  if (a.type === 'task/update' && a.patch.status === 'done') {
    const t = d.tasks.find(x => x.id === a.id);
    return t && t.status !== 'done' ? t : undefined;
  }
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
    priority: null,
    due: null,
    start: null,
    labels: [],
    subtasks: [],
    attachments: [],
    deps: [],
    desc: '',
    planHours: null,
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
      blankTask(withP, { project: id, title, status: i === 0 ? 'todo' : 'backlog', assignee: i === 0 ? d.me : null, priority: i === 0 ? 8 : 5, due: dOff(5 + i * 5), start: dOff(i * 5) }, tasks),
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
      const status: Status = t.status === 'done' ? (t.prevStatus && t.prevStatus !== 'done' && statusOf(d, t.prevStatus) ? t.prevStatus : 'todo') : 'done';
      const next = patchTask(t, { status });
      const rec = status === 'done' ? nextRecurrence(d, t) : null;
      const base = {
        ...d,
        tasks: [...d.tasks.map(x => (x.id === t.id ? next : x)), ...(rec ? [rec] : [])],
        activity: status === 'done' ? logActivity(d, 'completed', t) : d.activity,
      };
      return rec ? { ...base, activity: logActivity(base, 'created', rec) } : base;
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
      // Завершение повторяющейся задачи создаёт следующую
      const rec = completedBy(d, a) ? nextRecurrence(d, next) : null;
      if (rec) activity = logActivity({ ...d, activity }, 'created', rec);
      return { ...d, tasks: [...d.tasks.map(x => (x.id === t.id ? next : x)), ...(rec ? [rec] : [])], activity };
    }
    case 'task/toggleSubtask': {
      const t = d.tasks.find(x => x.id === a.id);
      const sub = findSub(t?.subtasks ?? [], a.subtask);
      if (!t || !sub) return d;
      // Закрытие закрывает всё поддерево, открытие — саму подзадачу и её предков (см. toggleSub)
      const nested = sub.done ? 0 : flattenSubs(sub.subtasks).filter(x => !x.sub.done).length;
      return {
        ...d,
        tasks: d.tasks.map(x => (x.id === t.id ? { ...t, updated: Date.now(), subtasks: toggleSub(t.subtasks, sub.id) } : x)),
        activity: logActivity(d, sub.done ? 'reopened subtask on' : 'completed subtask on', t, `“${sub.title}”${nested ? ` and ${nested} nested` : ''}`),
      };
    }
    case 'task/delete': {
      const ids = new Set(a.ids);
      return {
        ...d,
        tasks: d.tasks.filter(t => !ids.has(t.id)).map(t => (t.deps.some(x => ids.has(x)) ? { ...t, deps: t.deps.filter(x => !ids.has(x)) } : t)),
        comments: d.comments.filter(c => !ids.has(c.task)),
        timeLogs: d.timeLogs.filter(l => !ids.has(l.task)),
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
      if (!t || (a.parent && !findSub(t.subtasks, a.parent))) return d;
      const sub: Subtask = { id: a.sub, title: a.title, done: false, subtasks: [] };
      // Новая открытая подзадача не может лежать в закрытой ветке — предки открываются
      let subtasks = addSub(t.subtasks, a.parent ?? null, sub);
      if (a.parent) subtasks = reopenAncestors(subtasks, a.sub);
      const parent = findSub(t.subtasks, a.parent);
      return {
        ...d,
        tasks: d.tasks.map(x => (x.id === t.id ? { ...t, updated: Date.now(), subtasks } : x)),
        activity: logActivity(d, 'added subtask to', t, `“${a.title}”${parent ? ` under “${parent.title}”` : ''}`),
      };
    }
    case 'subtask/remove': {
      const t = d.tasks.find(x => x.id === a.id);
      const path = subPath(t?.subtasks ?? [], a.sub);
      const sub = path[path.length - 1];
      if (!t || !sub) return d;
      // Списанные часы не пропадают: записи удалённой ветки переходят к её родителю (или к задаче целиком)
      const gone = subtreeIds(sub);
      const parent = path.length > 1 ? path[path.length - 2].id : undefined;
      return {
        ...d,
        tasks: d.tasks.map(x => (x.id === t.id ? { ...t, subtasks: removeSub(t.subtasks, a.sub) } : x)),
        timeLogs: d.timeLogs.map(l => (l.task === t.id && l.sub && gone.has(l.sub) ? { ...l, sub: parent } : l)),
      };
    }
    case 'subtask/update': {
      const t = d.tasks.find(x => x.id === a.id);
      const sub = findSub(t?.subtasks ?? [], a.sub);
      if (!t || !sub) return d;
      let activity = d.activity;
      if ('assignee' in a.patch && (a.patch.assignee ?? null) !== (sub.assignee ?? null))
        activity = logActivity({ ...d, activity }, 'assigned a subtask on', t, a.patch.assignee ? `to ${d.members.find(m => m.id === a.patch.assignee)?.name}` : '(unassigned)');
      if ('due' in a.patch && (a.patch.due ?? null) !== (sub.due ?? null))
        activity = logActivity({ ...d, activity }, 'set a subtask due date on', t, a.patch.due ? fmtDate(a.patch.due) : '(cleared)');
      if ('planHours' in a.patch && (a.patch.planHours ?? null) !== (sub.planHours ?? null))
        activity = logActivity({ ...d, activity }, 'changed plan of a subtask on', t, `“${sub.title}” ${a.patch.planHours == null ? '(cleared)' : `to ${fmtHours(a.patch.planHours)}`}`);
      return {
        ...d,
        tasks: d.tasks.map(x => (x.id === t.id ? { ...t, updated: Date.now(), subtasks: mapSub(t.subtasks, sub.id, s => ({ ...s, ...a.patch })) } : x)),
        activity,
      };
    }
    case 'subtask/promote': {
      const t = d.tasks.find(x => x.id === a.id);
      const sub = findSub(t?.subtasks ?? [], a.sub);
      if (!t || !sub) return d;
      const esc = (v: string) => v.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      // Подзадача уходит в новую задачу вместе с детьми и своими часами
      const moved = subtreeIds(sub);
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
        subtasks: sub.subtasks,
        attachments: [],
        deps: [],
        desc: sub.note ? `<p>${esc(sub.note)}</p>` : '',
        planHours: sub.planHours ?? null,
        created: Date.now(),
        updated: Date.now(),
        order: Math.max(0, ...d.tasks.map(x => x.order)) + 1,
        fav: false,
        recur: null,
      };
      const base = {
        ...d,
        tasks: [...d.tasks.map(x => (x.id === t.id ? { ...t, subtasks: removeSub(t.subtasks, sub.id) } : x)), n],
        timeLogs: d.timeLogs.map(l => (l.task === t.id && l.sub && moved.has(l.sub) ? { ...l, task: n.id, sub: l.sub === sub.id ? undefined : l.sub } : l)),
      };
      const created = { ...base, activity: logActivity(base, 'created', n) };
      return { ...created, activity: logActivity(created, 'converted a subtask of', t, `into ${n.key}`) };
    }
    case 'timelog/add': {
      const t = d.tasks.find(x => x.id === a.log.task);
      if (!t) return d;
      const s = findSub(t.subtasks, a.log.sub);
      return {
        ...d,
        timeLogs: [...d.timeLogs, a.log],
        tasks: d.tasks.map(x => (x.id === t.id ? { ...t, updated: Date.now() } : x)),
        activity: [{ id: uid('a'), by: a.log.by, verb: `logged ${fmtHours(a.log.hours)} on`, task: t.id, project: t.project, at: Date.now(), extra: s ? `in “${s.title}”` : '' }, ...d.activity],
      };
    }
    case 'timelog/update':
      return { ...d, timeLogs: d.timeLogs.map(l => (l.id === a.id ? { ...l, ...a.patch } : l)) };
    case 'timelog/delete':
      return { ...d, timeLogs: d.timeLogs.filter(l => l.id !== a.id) };
    case 'task/create': {
      const t: Task = {
        id: uid('t'),
        key: nextKey(d, a.task.project),
        status: 'todo',
        assignee: null,
        priority: null,
        due: null,
        start: null,
        labels: [],
        subtasks: [],
        attachments: [],
        deps: [],
        desc: '',
        planHours: null,
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
        timeLogs: d.timeLogs.filter(l => !ids.has(l.task)),
        files: d.files.filter(f => f.project !== a.id),
        savedViews: d.savedViews.filter(v => v.project !== a.id),
      };
    }
    case 'project/move': {
      const vis = visibleProjects(d).map(p => p.id);
      const i = vis.indexOf(a.id);
      const j = i + a.dir;
      if (i < 0 || j < 0 || j >= vis.length) return d;
      const o = [...d.projOrder];
      const x = o.indexOf(vis[i]);
      const y = o.indexOf(vis[j]);
      [o[x], o[y]] = [o[y], o[x]];
      return { ...d, projOrder: o };
    }
    case 'project/inviteMember':
      return {
        ...d,
        members: [...d.members, a.member],
        projects: d.projects.map(p => (p.id === a.id ? { ...p, members: [...p.members, a.member.id], perms: { ...p.perms, [a.member.id]: a.perm } } : p)),
      };
    case 'task/notifyPriority': {
      const t = d.tasks.find(x => x.id === a.id);
      if (!t) return d;
      const n: Notification = { id: uid('n'), type: 'update', by: d.me, task: t.id, project: t.project, text: t.priority == null ? 'cleared the priority of' : `set priority to ${t.priority} on`, snippet: `Priority ${t.priority ?? 'none'} · ${t.key}`, at: Date.now(), read: false };
      return { ...d, notifs: [n, ...d.notifs] };
    }
    case 'status/add':
      return { ...d, statuses: [...d.statuses, a.status] };
    case 'status/rename':
      return { ...d, statuses: d.statuses.map(s => (s.id === a.id && !s.builtin ? { ...s, name: a.name } : s)) };
    case 'status/delete': {
      const st = statusOf(d, a.id);
      if (!st || st.builtin) return d;
      return {
        ...d,
        statuses: d.statuses.filter(s => s.id !== a.id),
        tasks: d.tasks.map(t => (t.status === a.id ? { ...t, status: 'todo', updated: Date.now() } : t.prevStatus === a.id ? { ...t, prevStatus: undefined } : t)),
        savedViews: d.savedViews.map(v => ({ ...v, filters: v.filters.map(f => (f.f === 'status' ? { ...f, v: f.v.filter(x => x !== a.id) } : f)) })),
      };
    }
    case 'savedView/create':
      return { ...d, savedViews: [...d.savedViews, a.view] };
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
  const [data, rawDispatch] = React.useReducer(reducer, initial, i => i ?? seed());
  // Тост «Next … scheduled» — побочный эффект, поэтому не в reducer: решаем по текущим данным до отправки действия
  const latest = React.useRef(data);
  latest.current = data;
  const dispatch = React.useCallback<React.Dispatch<Action>>(a => {
    const t = completedBy(latest.current, a);
    const rec = t && nextRecurrence(latest.current, t);
    rawDispatch(a);
    if (t && rec) toast.info(`Next “${t.title}” scheduled for ${fmtDate(rec.due!)}`);
  }, []);
  const value = React.useMemo(() => ({ data, dispatch }), [data, dispatch]);
  return (
    <Ctx.Provider value={value}>
      <StatusColors statuses={data.statuses} />
      {children}
    </Ctx.Provider>
  );
}

/** Цвета пользовательских статусов как CSS-переменные --st-<id>: так StatusIcon везде рисует их по одному id */
function StatusColors({ statuses }: { statuses: StatusDef[] }) {
  const css = statuses
    .filter(s => !s.builtin)
    .map(s => `--st-${s.id}:${s.color};`)
    .join('');
  return css ? <style>{`:root{${css}}`}</style> : null;
}

/** Статусы воркспейса (колонки доски) */
export function useStatuses() {
  return useWorkspace().data.statuses;
}

export function useWorkspace() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useWorkspace() нужно вызывать внутри <WorkspaceProvider>');
  return c;
}
