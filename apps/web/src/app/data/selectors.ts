/* Чистые функции над данными воркспейса — порт «lookups» из core/store.js.
   Не зависят от React: их легко тестировать и переиспользовать на сервере. */
import { PRIORITIES, priorityName } from '@/components/gr8r/task';
import { t, tEnum } from '@/i18n';
import { diffDays, parse, today } from '../lib/dates';
import { flattenSubs, subtreeIds } from './subtasks';
import type { FileKind, LabelId, Notification, Project, ProjectColor, ProjectStatus, StatusDef, Subtask, Task, TimeLog, WorkspaceData } from './types';

/** Статусы воркспейса в порядке колонок доски */
export const statusesOf = (d: Pick<WorkspaceData, 'statuses'>): StatusDef[] => d.statuses;
export const statusOf = (d: Pick<WorkspaceData, 'statuses'>, id: string): StatusDef | undefined => d.statuses.find(s => s.id === id);

/** Исходные английские названия пяти встроенных колонок (сид воркспейса) */
const DEFAULT_STATUS_NAMES: Record<string, string> = { backlog: 'Backlog', todo: 'To Do', progress: 'In Progress', review: 'Review', done: 'Done' };
/** Название колонки для показа: нетронутые встроенные переводятся, переименованные и свои — как есть */
export const statusName = (s: { id: string; name: string }): string =>
  DEFAULT_STATUS_NAMES[s.id] === s.name ? tEnum('taskStatus', s.id, s.name) : s.name;

/** Палитра цветов новых колонок (по кругу) */
export const STATUS_PALETTE = ['var(--blue)', 'var(--teal)', 'var(--rose)', 'var(--orange)', 'var(--violet)', 'var(--green)'];

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

/** name — геттер: язык читается при обращении, перевод — enums.projectStatus */
const projectStatus = (id: ProjectStatus, en: string, c: string) => ({
  get name() {
    return tEnum('projectStatus', id, en);
  },
  c,
});
export const PROJECT_STATUS: Record<ProjectStatus, { name: string; c: string }> = {
  planning: projectStatus('planning', 'Planning', 'var(--gray)'),
  active: projectStatus('active', 'In Progress', 'var(--blue)'),
  risk: projectStatus('risk', 'At Risk', 'var(--red)'),
  hold: projectStatus('hold', 'On Hold', 'var(--amber)'),
  complete: projectStatus('complete', 'Completed', 'var(--green)'),
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

/** Общие списки задач по всем проектам: задачи модулей (производство, услуги) живут отдельно от обычных и видны
    только с фильтром «Module». «Мои задачи» и страница проекта этим не пользуются — там модульные задачи видны всегда */
export const generalScope = (ts: Task[], v: Pick<ListView, 'filters'>) =>
  v.filters.some(f => f.f === 'module' && f.v.length) ? ts : ts.filter(t => t.module === 'general');

export const isOverdue = (t: Task) => !!t.due && t.status !== 'done' && diffDays(parse(t.due), today()) < 0;

export function progressOf(d: WorkspaceData, pid: string) {
  const ts = tasksOf(d, pid);
  if (!ts.length) return 0;
  return Math.round((ts.filter(t => t.status === 'done').length / ts.length) * 100);
}

export type SortField = 'manual' | 'title' | 'due' | 'priority' | 'status' | 'created' | 'updated' | 'assignee' | 'start' | 'plan' | 'actual' | 'variance' | 'project';

/** Для сортировки по исполнителю и проекту нужны данные воркспейса (d); без них эти поля падают на ручной порядок */
export function sortTasks(ts: Task[], f: SortField, dir: 1 | -1 = 1, d?: WorkspaceData) {
  // Часы: задачи без значения всегда в конце, в каком бы направлении ни шла сортировка
  const hours = (pick: (x: TaskTime) => number | null) => (t: Task) => pick(taskTime(d?.timeLogs ?? [], t)) ?? (dir > 0 ? Infinity : -Infinity);
  const key: (t: Task) => string | number = {
    manual: (t: Task) => t.order,
    title: (t: Task) => t.title.toLowerCase(),
    due: (t: Task) => t.due || '9999',
    priority: (t: Task) => (t.priority == null ? 1 : -t.priority),
    status: (t: Task) => d?.statuses.findIndex(s => s.id === t.status) ?? 0,
    created: (t: Task) => -t.created,
    updated: (t: Task) => -t.updated,
    start: (t: Task) => t.start || '9999',
    plan: hours(x => (x.plan > 0 ? x.plan : null)),
    actual: hours(x => (x.actual > 0 ? x.actual : null)),
    variance: hours(x => x.variance),
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

/** Группа ленты по дате: сегодня / вчера / на этой неделе / ранее — подпись на языке интерфейса */
export function dayBucket(ts: number) {
  const n = diffDays(new Date(ts), today());
  if (n === 0) return t('crm.activities.bucket.today');
  if (n === -1) return t('crm.activities.bucket.yesterday');
  if (n > -7) return t('crm.activities.bucket.week');
  return t('crm.activities.bucket.earlier');
}

/* ---------- фильтры списков (порт shell/view-engine.js) ---------- */

export type FilterField = 'status' | 'assignee' | 'priority' | 'due' | 'project' | 'module';
export interface Filter {
  f: FilterField;
  v: string[];
}

export function matchFilter(t: Task, f: Filter) {
  if (!f.v.length) return true;
  if (f.f === 'assignee') return f.v.includes(t.assignee || 'none');
  if (f.f === 'module') return f.v.includes(t.module);
  if (f.f === 'due')
    return f.v.some(v => {
      if (v === 'nodate') return !t.due;
      if (!t.due) return false;
      const n = diffDays(parse(t.due), today());
      return v === 'overdue' ? isOverdue(t) : v === 'today' ? n === 0 : v === 'week' ? n >= 0 && n <= 7 : n > 7;
    });
  if (f.f === 'priority') return f.v.includes(t.priority == null ? 'none' : String(t.priority));
  return f.v.includes(t[f.f]);
}

export interface ListView {
  q: string;
  filters: Filter[];
  sort: { f: SortField; dir: 1 | -1 };
}

export function applyView(ts: Task[], v: ListView, d?: WorkspaceData) {
  const q = v.q.trim().toLowerCase();
  // Поиск заглядывает и в подзадачи любой глубины
  const hit = (t: Task) => t.title.toLowerCase().includes(q) || t.key.toLowerCase().includes(q) || flattenSubs(t.subtasks).some(x => x.sub.title.toLowerCase().includes(q));
  const out = ts.filter(t => v.filters.every(f => matchFilter(t, f)) && (!q || hit(t)));
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
  if (g === 'status') groups = statusesOf(d).map(s => ({ key: s.id, name: statusName(s), set: { status: s.id } }));
  else if (g === 'priority') groups = [...PRIORITIES.map(p => ({ key: String(p), name: priorityName(p), set: { priority: p as number | null } })), { key: 'none', name: priorityName(null), set: { priority: null } }];
  else if (g === 'assignee')
    groups = [...d.members.map(m => ({ key: m.id, name: m.name, set: { assignee: m.id } })), { key: 'none', name: 'Unassigned', set: { assignee: null } }];
  else if (g === 'project') groups = visibleProjects(d).filter(p => canSee(d, p)).map(p => ({ key: p.id, name: p.name, set: { project: p.id } }));
  else groups = DUE_BUCKETS;
  const out = groups.map(G => ({
    ...G,
    tasks: ts.filter(t => {
      if (g === 'assignee') return (t.assignee || 'none') === G.key;
      if (g === 'due') return matchFilter(t, { f: 'due', v: [G.key] });
      if (g === 'priority') return (t.priority == null ? 'none' : String(t.priority)) === G.key;
      return t[g] === G.key;
    }),
  }));
  return g === 'status' || g === 'priority' ? out : out.filter(G => G.tasks.length);
}

/* Типы файлов (FT / fileType из ui/helpers.js): цвет, название и имя иконки lucide */
export const FILE_TYPES: Record<FileKind, { c: string; i: string; n: string }> = {
  fig: { c: '#8662C9', i: 'pen-tool', n: 'Figma' },
  pdf: { c: '#C4473A', i: 'file-text', n: 'PDF' },
  zip: { c: '#6B7280', i: 'folder-archive', n: 'Archive' },
  img: { c: '#23918A', i: 'image', n: 'Image' },
  sheet: { c: '#3D8E5F', i: 'file-spreadsheet', n: 'Spreadsheet' },
  doc: { c: '#3B82C4', i: 'file-text', n: 'Document' },
  code: { c: '#C48A1E', i: 'file-code', n: 'Code' },
  other: { c: '#6B7280', i: 'file', n: 'File' },
};

/** Тип файла по расширению */
export function fileKind(name: string): FileKind {
  const e = (name.split('.').pop() || '').toLowerCase();
  if (e === 'fig') return 'fig';
  if (e === 'pdf') return 'pdf';
  if (['zip', 'rar', '7z'].includes(e)) return 'zip';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(e)) return 'img';
  if (['xlsx', 'xls', 'csv', 'numbers'].includes(e)) return 'sheet';
  if (['doc', 'docx', 'txt', 'md', 'pages', 'rtf'].includes(e)) return 'doc';
  if (['js', 'ts', 'json', 'html', 'css', 'py'].includes(e)) return 'code';
  return 'other';
}

/** Размер файла для подписи (fsize) */
export function fileSize(b: number) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return Math.round(b / 1024) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

/* ---------- учёт времени: план, факт, отклонение ---------- */

/** Часы для подписи: 3.5h, 8h, 0.25h */
export const fmtHours = (h: number) => `${+h.toFixed(2)}h`;

/** Часы из строки: «2», «1.5», «2h», «1d» (= 8h), «30m»; null, если не разобрать */
export function parseHours(v: string): number | null {
  const m = v.trim().toLowerCase().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(h|d|m)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'd' ? n * 8 : m[2] === 'm' ? n / 60 : n;
}

/** План подзадачи: свой, если задан, иначе сумма плана вложенных */
export function planOfSub(s: Subtask): number {
  return s.planHours ?? s.subtasks.reduce((a, c) => a + planOfSub(c), 0);
}

/** План задачи: свой, если задан, иначе сумма плана подзадач первого уровня */
export function planOfTask(t: Pick<Task, 'planHours' | 'subtasks'>): number {
  return t.planHours ?? t.subtasks.reduce((a, c) => a + planOfSub(c), 0);
}

export interface TaskTime {
  plan: number;
  actual: number;
  /** Сколько осталось по плану (не меньше нуля) */
  remaining: number;
  /** Отклонение: факт − план; плюс — перерасход. null, если нет ни плана, ни факта */
  variance: number | null;
  /** Факт в процентах от плана (null, если плана нет) */
  pct: number | null;
  over: boolean;
}

function timeOf(plan: number, actual: number): TaskTime {
  return {
    plan,
    actual,
    remaining: Math.max(plan - actual, 0),
    variance: plan || actual ? actual - plan : null,
    pct: plan > 0 ? Math.round((actual / plan) * 100) : null,
    over: actual > plan + 1e-9,
  };
}

const sum = (logs: TimeLog[]) => logs.reduce((a, l) => a + l.hours, 0);

/** «6/8h»: факт и план; без плана — только факт, без обоих — пусто */
export const fmtTimePair = (x: Pick<TaskTime, 'plan' | 'actual'>) => (x.plan > 0 ? `${+x.actual.toFixed(2)}/${fmtHours(x.plan)}` : x.actual > 0 ? fmtHours(x.actual) : '');

/** Время задачи: факт — записи по самой задаче и всем её подзадачам */
export const taskTime = (logs: TimeLog[], t: Pick<Task, 'id' | 'planHours' | 'subtasks'>): TaskTime =>
  timeOf(planOfTask(t), sum(logs.filter(l => l.task === t.id)));

/** Время подзадачи: факт — записи по ней и по всему её поддереву */
export function subTime(logs: TimeLog[], taskId: string, s: Subtask): TaskTime {
  const ids = subtreeIds(s);
  return timeOf(planOfSub(s), sum(logs.filter(l => l.task === taskId && l.sub && ids.has(l.sub))));
}

/** Записи по задаче (новые сверху); со sub — только по этой подзадаче и её потомкам */
export function logsOf(logs: TimeLog[], taskId: string, s?: Subtask) {
  const ids = s ? subtreeIds(s) : null;
  return logs
    .filter(l => l.task === taskId && (!ids || (l.sub && ids.has(l.sub))))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Сумма по набору задач — для итогов таблицы и сводок */
export function totalTime(logs: TimeLog[], ts: Pick<Task, 'id' | 'planHours' | 'subtasks'>[]): TaskTime {
  const ids = new Set(ts.map(t => t.id));
  return timeOf(
    ts.reduce((a, t) => a + planOfTask(t), 0),
    sum(logs.filter(l => ids.has(l.task))),
  );
}
