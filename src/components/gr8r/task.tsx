/* Доменные компоненты из Gr8r: иконки статуса и приоритета, дата, карточка задачи.
   Пример того, как «прикладные» компоненты собираются из базовых из components/ui. */
import { Calendar, Check, Ellipsis, ListChecks, MessageSquare, Paperclip, Pencil, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, IconButton, Label, Progress, Tooltip } from '@/components/ui';

export const STATUSES = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'todo', name: 'To Do' },
  { id: 'progress', name: 'In Progress' },
  { id: 'review', name: 'Review' },
  { id: 'done', name: 'Done' },
] as const;
export type Status = (typeof STATUSES)[number]['id'];

export const PRIORITIES = [
  { id: 'urgent', name: 'Urgent', w: 4 },
  { id: 'high', name: 'High', w: 3 },
  { id: 'medium', name: 'Medium', w: 2 },
  { id: 'low', name: 'Low', w: 1 },
  { id: 'none', name: 'No priority', w: 0 },
] as const;
export type Priority = (typeof PRIORITIES)[number]['id'];

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
      {status === 'done' && (
        <>
          <circle cx="7" cy="7" r="6.2" fill={c} />
          <path d="M4.4 7.2 6.2 9 9.7 5.3" fill="none" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  if (priority === 'urgent')
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--red)" />
        <path d="M7 3.8v4" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="7" cy="10.1" r=".95" fill="#fff" />
      </svg>
    );
  if (priority === 'none')
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
        <path d="M2.5 7h2M6 7h2M9.5 7h2" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  const w = PRIORITIES.find(p => p.id === priority)!.w;
  const bar = (x: number, h: number, on: boolean) => <rect x={x} y={12 - h} width="2.6" height={h} rx="1" fill={on ? 'var(--text-2)' : 'var(--border-strong)'} />;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
      {bar(1.8, 4.5, w >= 1)}
      {bar(5.7, 7.5, w >= 2)}
      {bar(9.6, 10.5, w >= 3)}
    </svg>
  );
}

const DAY = 864e5;
const sod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Срок: «Сегодня», «Завтра», «3 дн. назад», дата; подсветка просрочки и близкого срока */
export function DueDate({ date, done, icon = true, format }: { date: Date; done?: boolean; icon?: boolean; format?: (d: Date) => string }) {
  const n = Math.round((sod(date) - sod(new Date())) / DAY);
  const text = format
    ? format(date)
    : n === 0 ? 'Сегодня' : n === 1 ? 'Завтра' : n === -1 ? 'Вчера' : n < 0 && n > -7 ? `${-n} дн. назад` : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
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
export function TaskCard({ task: t, onOpen, onToggleDone, onEdit, onMore }: TaskCardProps) {
  const done = t.status === 'done';
  const pr = PRIORITIES.find(p => p.id === t.priority)!;
  return (
    <div
      className={cn('kcard', done && 'done')}
      role="button"
      tabIndex={0}
      aria-label={t.title}
      onClick={() => onOpen?.(t)}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen?.(t);
        }
      }}
    >
      {!!t.labels?.length && (
        <div className="labels">
          {t.labels.map(l => (
            <Label key={l.name} color={l.color}>
              {l.name}
            </Label>
          ))}
        </div>
      )}
      <div className="top">
        {done && <StatusIcon status="done" />}
        <div className="title">{t.title}</div>
      </div>
      {t.subtasks && t.subtasks.total > 0 && (
        <div className="subp">
          <ListChecks size={12} />
          <span className="num">
            {t.subtasks.done}/{t.subtasks.total}
          </span>
          <Progress value={(t.subtasks.done / t.subtasks.total) * 100} tone={t.subtasks.done === t.subtasks.total ? 'green' : undefined} />
        </div>
      )}
      <div className="meta">
        <span className="key">{t.key}</span>
        <Tooltip content={pr.name}>
          <span className="m" role="img" aria-label={`Приоритет: ${pr.name}`}>
            <PriorityIcon priority={t.priority} size={13} />
          </span>
        </Tooltip>
        {t.due && (
          <span className="m">
            <DueDate date={t.due} done={done} />
          </span>
        )}
        {!!t.comments && (
          <span className="m" aria-label={`${t.comments} комментариев`}>
            <MessageSquare size={12} />
            {t.comments}
          </span>
        )}
        {!!t.attachments && (
          <span className="m" aria-label={`${t.attachments} вложений`}>
            <Paperclip size={12} />
            {t.attachments}
          </span>
        )}
        <Avatar name={t.assignee} size="sm" />
      </div>
      <div className="hacts" onClick={e => e.stopPropagation()}>
        <IconButton size="xs" label={done ? 'Вернуть в работу' : 'Завершить'} onClick={() => onToggleDone?.(t)}>
          {done ? <RotateCcw size={13} /> : <Check size={13} />}
        </IconButton>
        <IconButton size="xs" label="Быстрое редактирование" onClick={() => onEdit?.(t)}>
          <Pencil size={12} />
        </IconButton>
        <IconButton size="xs" label="Ещё" onClick={() => onMore?.(t)}>
          <Ellipsis size={13} />
        </IconButton>
      </div>
    </div>
  );
}
