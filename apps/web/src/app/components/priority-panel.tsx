/* Панель выбора приоритета 1–10: сетка 2×5, «No priority», клавиатура (цифры, стрелки, Enter, Esc) и «Notify assignee».
   Новый функционал, в оригинале приоритет — пять фиксированных значений. Используется везде, где меняется приоритет. */
import * as React from 'react';
import { BellRing, Ban } from 'lucide-react';
import { IconButton, Popover, PopoverContent, PopoverTrigger, Tooltip, toast } from '@/components/ui';
import { PRIORITIES, priorityColor, type Priority } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { member } from '../data/selectors';
import type { Task } from '../data/types';

/** Значения в порядке сетки: два ряда по 5 (1–5, 6–10) */
const GRID = [...PRIORITIES].reverse();

export interface PriorityPanelProps {
  value: Priority;
  onChange: (p: Priority) => void;
  /** Задача, о смене приоритета которой можно уведомить исполнителя; без неё блок «Notify assignee» не показывается */
  task?: Task;
  /** Панель выбрала значение или закрывается по Esc */
  onClose?: () => void;
}

/** Содержимое панели; без обёртки, чтобы его можно было встроить и в поповер, и в контекстное меню */
export function PriorityPanel({ value, onChange, task, onClose }: PriorityPanelProps) {
  const { data, dispatch } = useWorkspace();
  const tt = useT();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const [cur, setCur] = React.useState(Math.max(0, GRID.indexOf(value ?? 1)));
  const pick = (p: Priority) => {
    onChange(p);
    onClose?.();
  };
  const focus = (i: number) => {
    const n = (i + GRID.length) % GRID.length;
    setCur(n);
    refs.current[n]?.focus();
  };
  React.useEffect(() => {
    // Фокус на текущем значении при открытии
    refs.current[cur]?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      pick(e.key === '0' ? 10 : +e.key);
      return;
    }
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 };
    if (e.key in step) {
      e.preventDefault();
      e.stopPropagation();
      // Вертикальные стрелки переходят между рядами без «заворота»
      const to = cur + step[e.key];
      if (Math.abs(step[e.key]) === 5 && (to < 0 || to >= GRID.length)) return;
      focus(to);
    }
  };

  const assignee = task ? member(data, task.assignee) : undefined;
  const self = !!task && task.assignee === data.me;
  const canNotify = !!assignee && !self;
  const notify = () => {
    if (!task || !assignee) return;
    dispatch({ type: 'task/notifyPriority', id: task.id });
    toast(tt('views.priority.notified', { name: assignee.name }));
    onClose?.();
  };
  const notifyBtn = (
    <button className="pp-notify" disabled={!canNotify} onClick={notify}>
      <BellRing size={14} />
      {tt('views.priority.notifyAssignee')}
    </button>
  );

  return (
    <div className="pprio" onKeyDown={onKeyDown}>
      <div className="pp-h">
        <IconButton size="xs" label={tt('views.field.noPriority')} onClick={() => pick(null)}>
          <Ban size={14} />
        </IconButton>
        <span className="sp" />
        <kbd className="kbd">esc</kbd>
      </div>
      <div className="pp-grid" role="radiogroup" aria-label={tt('views.priority.title')}>
        {GRID.map((p, i) => (
          <button
            key={p}
            ref={el => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={value === p}
            aria-label={tt('views.task.priorityLabel', { n: p })}
            tabIndex={i === cur ? 0 : -1}
            className={cn('pp-dot', value === p && 'on')}
            style={{ background: priorityColor(p) }}
            onFocus={() => setCur(i)}
            onClick={() => pick(p)}
          >
            {p}
          </button>
        ))}
      </div>
      {task && (
        <>
          <div className="pp-sep" />
          {canNotify ? (
            notifyBtn
          ) : (
            <Tooltip content={assignee ? tt('views.priority.youAreAssignee') : tt('views.priority.noAssigneeToNotify')} side="top">
              <span className="pp-notify-wrap">{notifyBtn}</span>
            </Tooltip>
          )}
        </>
      )}
    </div>
  );
}

/** Триггер + поповер с панелью приоритета. trigger — содержимое кнопки */
export function PriorityPopover({ value, onChange, task, trigger, className, label = 'Priority' }: PriorityPanelProps & { trigger: React.ReactNode; className?: string; label?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={className}
          aria-label={label}
          onClick={e => e.stopPropagation()}
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="!w-auto !min-w-0 !p-0" onClick={e => e.stopPropagation()} onOpenAutoFocus={e => e.preventDefault()}>
        <PriorityPanel value={value} onChange={onChange} task={task} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
