/* Доменные компоненты из Gr8r: иконки статуса и приоритета, дата, карточка задачи.
   Пример того, как «прикладные» компоненты собираются из базовых из components/ui. */
import { Calendar, Check, Ellipsis, ListChecks, MessageSquare, Paperclip, Pencil, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDateTimeIntl, t } from '@/i18n';
import { Avatar, IconButton, Label, Progress, Tooltip } from '@/components/ui';

/** Набор статусов по умолчанию: сид воркспейса и страница дизайн-системы. Актуальный список — WorkspaceData.statuses */
export const STATUSES = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'todo', name: 'To Do' },
  { id: 'progress', name: 'In Progress' },
  { id: 'review', name: 'Review' },
  { id: 'done', name: 'Done' },
] as const;
/** Идентификатор статуса: пять встроенных + пользовательские колонки доски (см. WorkspaceData.statuses) */
export type Status = string;

/** Приоритет — шкала 1–10 (10 — самый срочный); null — без приоритета */
export type Priority = number | null;
/** Значения от высшего к низшему: порядок в фильтрах и группировке */
export const PRIORITIES: number[] = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
export const priorityColor = (p: number) => `var(--pr-${p})`;
export const priorityName = (p: Priority) => (p == null ? t('views.task.noPriority') : t('views.task.priorityLabel', { n: p }));

export function StatusIcon({ status, size = 14 }: { status: Status; size?: number }) {
  const c = `var(--st-${status})`;
  const r = 5.4;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
      {status === 'backlog' && <circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="1.9 2.1" />}
      {status === 'todo' && <circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" />}
      {status === 'progress' && (
        <>
          <circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" />
          <path d="M7 3.4A3.6 3.6 0 0 1 7 10.6Z" fill={c} />
        </>
      )}
      {status === 'review' && (
        <>
          <circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" />
          <path d="M7 3.4A3.6 3.6 0 1 1 3.4 7L7 7Z" fill={c} />
        </>
      )}
      {!['backlog', 'todo', 'progress', 'review', 'done'].includes(status) && <circle cx="7" cy="7" r="5" fill={c} />}
      {status === 'done' && (
        <>
          <circle cx="7" cy="7" r="6.2" fill={c} />
          <path d="M4.4 7.2 6.2 9 9.7 5.3" fill="none" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

/** Бейдж приоритета: число в скруглённом квадрате цвета приоритета; без приоритета — пунктирный пустой квадрат */
export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  const px = Math.max(16, size + 2);
  return (
    <span
      className={cn('prio', priority == null && 'none')}
      aria-hidden
      style={{ width: px, height: px, fontSize: px <= 16 ? 10.5 : 11.5, ...(priority != null ? { background: priorityColor(priority) } : null) }}
    >
      {priority}
    </span>
  );
}

const DAY = 864e5;
const sod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Срок: «Today»/«Сегодня», «3d ago»/«3 дн. назад», дата по языку интерфейса; подсветка просрочки и близкого срока */
export function DueDate({ date, done, icon = true, format }: { date: Date; done?: boolean; icon?: boolean; format?: (d: Date) => string }) {
  const n = Math.round((sod(date) - sod(new Date())) / DAY);
  const text = format
    ? format(date)
    : n === 0 ? t('dates.today') : n === 1 ? t('dates.tomorrow') : n === -1 ? t('dates.yesterday') : n < 0 && n > -7 ? t('dates.daysAgo', { n: -n }) : fmtDateTimeIntl(date, { day: 'numeric', month: 'short' });
  return (
    <span className={cn('due', !done && (n < 0 ? 'over' : n <= 1 && 'soon'))}>
      {icon && <Calendar size={12} />}
      {text}
    </span>
  );
}

export interface Task {
  id: string;
  key: string;
  title: string;
  status: Status;
  priority: Priority;
  assignee?: string;
  due?: Date;
  labels?: { name: string; color: string }[];
  subtasks?: { done: number; total: number };
  comments?: number;
  attachments?: number;
}

export interface TaskCardProps {
  task: Task;
  onOpen?: (t: Task) => void;
  onToggleDone?: (t: Task) => void;
  onEdit?: (t: Task) => void;
  onMore?: (t: Task) => void;
}

/** Карточка задачи для доски (kcard из views/board.js) */
export function TaskCard({ task, onOpen, onToggleDone, onEdit, onMore }: TaskCardProps) {
  const tk = task;
  const done = tk.status === 'done';
  const prName = priorityName(tk.priority);
  return (
    <div
      className={cn('kcard', done && 'done')}
      role="button"
      tabIndex={0}
      aria-label={tk.title}
      onClick={() => onOpen?.(tk)}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen?.(tk);
        }
      }}
    >
      {!!tk.labels?.length && (
        <div className="labels">
          {tk.labels.map(l => (
            <Label key={l.name} color={l.color}>
              {l.name}
            </Label>
          ))}
        </div>
      )}
      <div className="top">
        {done && <StatusIcon status="done" />}
        <div className="title">{tk.title}</div>
      </div>
      {tk.subtasks && tk.subtasks.total > 0 && (
        <div className="subp">
          <ListChecks size={12} />
          <span className="num">
            {tk.subtasks.done}/{tk.subtasks.total}
          </span>
          <Progress value={(tk.subtasks.done / tk.subtasks.total) * 100} tone={tk.subtasks.done === tk.subtasks.total ? 'green' : undefined} />
        </div>
      )}
      <div className="meta">
        <span className="key">{tk.key}</span>
        <Tooltip content={prName}>
          <span className="m" role="img" aria-label={prName}>
            <PriorityIcon priority={tk.priority} size={13} />
          </span>
        </Tooltip>
        {tk.due && (
          <span className="m">
            <DueDate date={tk.due} done={done} />
          </span>
        )}
        {!!tk.comments && (
          <span className="m" aria-label={t('views.task.comments', { n: tk.comments })}>
            <MessageSquare size={12} />
            {tk.comments}
          </span>
        )}
        {!!tk.attachments && (
          <span className="m" aria-label={t('views.task.attachments', { n: tk.attachments })}>
            <Paperclip size={12} />
            {tk.attachments}
          </span>
        )}
        <Avatar name={tk.assignee} size="sm" />
      </div>
      <div className="hacts" onClick={e => e.stopPropagation()}>
        <IconButton size="xs" label={done ? t('views.task.reopen') : t('views.task.markComplete')} onClick={() => onToggleDone?.(tk)}>
          {done ? <RotateCcw size={13} /> : <Check size={13} />}
        </IconButton>
        <IconButton size="xs" label={t('views.task.quickEdit')} onClick={() => onEdit?.(tk)}>
          <Pencil size={12} />
        </IconButton>
        <IconButton size="xs" label={t('views.drawer.more')} onClick={() => onMore?.(tk)}>
          <Ellipsis size={13} />
        </IconButton>
      </div>
    </div>
  );
}
