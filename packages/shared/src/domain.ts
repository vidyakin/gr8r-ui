/* Доменные типы фронтенда (форма данных в браузере). Источник правды для демо-данных, сидов и API-клиента. */

import type { TaskModule } from './constants';

/** Идентификатор статуса: пять встроенных + пользовательские колонки доски */
export type Status = string;

/** Приоритет — шкала 1–10 (10 — самый срочный); null — без приоритета */
export type Priority = number | null;

/** Дата без времени в формате YYYY-MM-DD */
export type IsoDate = string;

export interface Member {
  id: string;
  name: string;
  email: string;
  role: 'Owner' | 'Admin' | 'Member' | 'Guest';
  team: string;
  title: string;
  c: string;
  status: 'active' | 'invited' | 'deactivated';
  /** Минут с последней активности */
  last: number | null;
  tz: string;
}

export type ProjectStatus = 'planning' | 'active' | 'risk' | 'hold' | 'complete';
export type ProjectColor = 'indigo' | 'blue' | 'violet' | 'teal' | 'rose' | 'amber' | 'green' | 'slate';

export interface Project {
  id: string;
  key: string;
  name: string;
  /** Модуль проекта: general — обычный, production/services — системный проект модуля */
  module: TaskModule;
  icon: string;
  color: ProjectColor;
  status: ProjectStatus;
  team: string;
  lead: string;
  due: IsoDate;
  start: IsoDate;
  fav: boolean;
  private?: boolean;
  archived?: boolean;
  archivedAt?: number | null;
  members: string[];
  /** Права участников по id (форма Share) */
  perms?: Record<string, string>;
  /** Общий доступ к проекту */
  access?: 'private' | 'workspace';
  desc: string;
  milestones: { name: string; date: IsoDate }[];
  last: number;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  /** Поля карточки подзадачи (появляются, когда их задают) */
  assignee?: string | null;
  due?: IsoDate | null;
  note?: string;
  /** План в часах; если не задан, считается суммой плана вложенных подзадач */
  planHours?: number | null;
  /** Вложенные подзадачи — дерево любой глубины */
  subtasks: Subtask[];
}

/** Запись учёта времени (факт). sub — подзадача, к которой относятся часы; без неё — задача целиком */
export interface TimeLog {
  id: string;
  task: string;
  sub?: string;
  by: string;
  hours: number;
  date: IsoDate;
  note: string;
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: string;
  by: string;
  at: number;
}

export type LabelId = 'design' | 'frontend' | 'backend' | 'research' | 'content' | 'bug' | 'qa' | 'growth';

export interface Task {
  id: string;
  key: string;
  project: string;
  /** Модуль задачи — совпадает с модулем проекта */
  module: TaskModule;
  title: string;
  status: Status;
  assignee: string | null;
  priority: Priority;
  due: IsoDate | null;
  start: IsoDate | null;
  labels: LabelId[];
  subtasks: Subtask[];
  attachments: Attachment[];
  deps: string[];
  desc: string;
  /** Заказчик (id компании) — только у задач модуля services */
  company?: string | null;
  /** План в часах; если не задан, считается суммой плана подзадач */
  planHours: number | null;
  created: number;
  updated: number;
  completedAt?: number;
  /** Статус до последней смены — чтобы «вернуть в работу» туда же */
  prevStatus?: Status;
  order: number;
  fav: boolean;
  recur: string | null;
  archived?: boolean;
  archivedAt?: number | null;
  /** Пользовательские поля (конструктор сущностей): ключ поля → значение */
  custom?: Record<string, unknown>;
}

export interface Comment {
  id: string;
  task: string;
  by: string;
  at: number;
  text: string;
  /** Реакции: эмодзи → id участников */
  re: Record<string, string[]>;
}

export interface Activity {
  id: string;
  by: string;
  verb: string;
  task: string | null;
  project: string | null;
  at: number;
  extra: string;
}

export interface Notification {
  id: string;
  type: 'mention' | 'assign' | 'comment' | 'update';
  by: string | null;
  task?: string;
  project?: string;
  text: string;
  snippet: string;
  at: number;
  read: boolean;
}

export interface Team {
  id: string;
  name: string;
  icon: string;
  c: string;
  desc: string;
}

/** Событие календаря (встреча проекта) */
export interface CalendarEvent {
  id: string;
  title: string;
  date: IsoDate;
  time: string;
  project: string;
}

/** Сохранённый вид проекта: фильтры + тип вкладки, к которой они применяются */
export interface SavedView {
  id: string;
  project: string;
  name: string;
  type: 'list' | 'board' | 'table' | 'calendar' | 'timeline';
  filters: { f: 'status' | 'assignee' | 'priority' | 'due' | 'project' | 'module'; v: string[] }[];
}

/** Статус задачи = колонка доски. Встроенные (builtin) нельзя переименовать и удалить */
export interface StatusDef {
  id: Status;
  name: string;
  /** Цвет значка: токен вроде var(--blue) */
  color: string;
  builtin?: boolean;
}

export interface WorkspaceInfo {
  name: string;
  url: string;
  c: string;
  brand?: boolean;
}

export type FileKind = 'fig' | 'pdf' | 'zip' | 'img' | 'sheet' | 'doc' | 'code' | 'other';

/** Файл проекта (вкладка Files) */
export interface ProjectFile {
  id: string;
  project: string;
  name: string;
  type: FileKind;
  size: string;
  by: string;
  at: number;
  task?: string | null;
}

export interface WorkspaceData {
  ws: WorkspaceInfo;
  me: string;
  members: Member[];
  projects: Project[];
  tasks: Task[];
  comments: Comment[];
  activity: Activity[];
  notifs: Notification[];
  teams: Team[];
  events: CalendarEvent[];
  files: ProjectFile[];
  timeLogs: TimeLog[];
  projOrder: string[];
  savedViews: SavedView[];
  /** Статусы в порядке колонок доски */
  statuses: StatusDef[];
}

/* Типы демо-модуля CRM. Владельцы (owner, by) — id участников основного воркспейса (Member.id). */

export type StageId = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';

export interface Company {
  id: string;
  name: string;
  industry: string;
  size: string;
  owner: string;
  website: string;
  city: string;
  created: number;
  /** Следующий контакт (задача 1133): дата YYYY-MM-DD и заметка; пустая строка — не запланирован */
  nextContactDate?: string;
  nextContactNote?: string;
  custom?: Record<string, unknown>;
}

export interface Contact {
  id: string;
  company: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  owner: string;
  created: number;
  custom?: Record<string, unknown>;
}

export interface Deal {
  id: string;
  name: string;
  company: string;
  contacts: string[];
  owner: string;
  /** Сумма в USD */
  amount: number;
  stage: StageId;
  closeDate: IsoDate;
  created: number;
  /** Дата закрытия (для Won/Lost) */
  closedAt?: IsoDate;
  lostReason?: string;
  /** Порядок карточки внутри колонки воронки */
  order: number;
  custom?: Record<string, unknown>;
}

export type ActivityType = 'call' | 'email' | 'meeting' | 'note' | 'task';

export interface CrmActivity {
  id: string;
  type: ActivityType;
  subject: string;
  deal?: string;
  company?: string;
  contact?: string;
  by: string;
  at: number;
  /** Служебная запись (смена этапа) */
  system?: boolean;
  /** Для type=task: срок и отметка выполнения */
  due?: IsoDate;
  done?: boolean;
  body?: string;
}

export interface CrmData {
  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
  activities: CrmActivity[];
}
