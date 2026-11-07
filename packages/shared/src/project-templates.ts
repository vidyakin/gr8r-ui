/* Шаблоны проектов: чистые правила без БД (сервис — packages/db/src/project-templates.ts).
   Срок в шаблоне — «день N от старта»: день 1 — дата старта проекта, день 2 — следующий и т. д. */
import type { Subtask } from './domain';

export interface TemplateSubtask {
  title: string;
  note?: string | undefined;
  /** День от старта (≥ 1) */
  dueDay?: number | null | undefined;
  /** Исполнитель по должности */
  positionId?: string | null | undefined;
  planHours?: number | null | undefined;
  subtasks: TemplateSubtask[];
}

export interface TemplateMilestone {
  name: string;
  /** День от старта (≥ 1) */
  day: number;
}

/** Задача шаблона в виде, удобном и для сохранения, и для создания проекта */
export interface TemplateTaskDef {
  title: string;
  description: string;
  status: string;
  priority: number | null;
  startDay: number | null;
  dueDay: number | null;
  planHours: string | null;
  positionId: string | null;
  labels: string[];
  subtasks: TemplateSubtask[];
}

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** День от старта для даты: дата старта — день 1; дата раньше старта — тоже день 1 (шаблон не знает «до старта») */
export function dayFromDate(start: string, date: string | null | undefined): number | null {
  if (!date) return null;
  return Math.max(1, Math.round((utc(date) - utc(start)) / DAY_MS) + 1);
}

/** Дата для дня от старта (день 1 — сама дата старта) */
export function dateFromDay(start: string, day: number | null | undefined): string | null {
  if (day == null) return null;
  return new Date(utc(start) + (Math.max(1, day) - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** Точка отсчёта при сохранении: дата старта проекта, иначе самая ранняя дата задач, иначе сегодня */
export function templateBaseDate(projectStart: string | null | undefined, taskDates: (string | null | undefined)[], today: string): string {
  if (projectStart) return projectStart;
  const dates = taskDates.filter((d): d is string => !!d).sort();
  return dates[0] ?? today;
}

export interface SourceSubtask {
  title: string;
  note?: string | undefined;
  due?: string | null | undefined;
  assignee?: string | null | undefined;
  planHours?: number | null | undefined;
  subtasks?: SourceSubtask[] | undefined;
}

/** Дерево подзадач проекта → дерево шаблона: даты в дни, исполнители в должности (positionOf: участник → должность или null) */
export function subtasksToTemplate(list: readonly SourceSubtask[], start: string, positionOf: (memberId: string) => string | null): TemplateSubtask[] {
  return list.map(s => ({
    title: s.title,
    ...(s.note ? { note: s.note } : {}),
    dueDay: dayFromDate(start, s.due),
    positionId: s.assignee ? positionOf(s.assignee) : null,
    planHours: s.planHours ?? null,
    subtasks: subtasksToTemplate(s.subtasks ?? [], start, positionOf),
  }));
}

/** Дерево шаблона → подзадачи проекта: новые id, всё не выполнено, даты от старта, исполнители — memberOf(должность) */
export function subtasksFromTemplate(list: readonly TemplateSubtask[], start: string, memberOf: (positionId: string) => string | null, newId: () => string): Subtask[] {
  return list.map(s => ({
    id: newId(),
    title: s.title,
    done: false,
    assignee: s.positionId ? memberOf(s.positionId) : null,
    due: dateFromDay(start, s.dueDay) as Subtask['due'],
    ...(s.note ? { note: s.note } : {}),
    planHours: s.planHours ?? null,
    subtasks: subtasksFromTemplate(s.subtasks, start, memberOf, newId),
  }));
}

/** Статус задачи шаблона: «выполнено» при сохранении сбрасывается в todo (проект создаётся с нуля); неизвестный статус — тоже todo */
export function templateStatus(status: string, known: ReadonlySet<string>): string {
  return status !== 'done' && known.has(status) ? status : 'todo';
}

/** Вехи проекта → вехи шаблона (дни от старта) */
export function milestonesToTemplate(list: readonly { name: string; date: string }[], start: string): TemplateMilestone[] {
  return list.map(m => ({ name: m.name, day: dayFromDate(start, m.date) ?? 1 }));
}
