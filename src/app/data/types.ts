import type { Priority, Status } from '@/components/gr8r/task';

export type { Priority, Status };

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
  members: string[];
  desc: string;
  milestones: { name: string; date: IsoDate }[];
  last: number;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
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
  estimate: string | null;
  created: number;
  updated: number;
  completedAt?: number;
  /** Статус до последней смены — чтобы «вернуть в работу» туда же */
  prevStatus?: Status;
  order: number;
  fav: boolean;
  recur: string | null;
  archived?: boolean;
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
  filters: { f: 'status' | 'assignee' | 'priority' | 'due' | 'project'; v: string[] }[];
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
  projOrder: string[];
  savedViews: SavedView[];
}
