/* Редактируемые поля задачи — порт cellStatus / cellAssignee / cellPrio / cellDue из components/task-list.js.
   Кнопка-«таблетка» (.pillbtn) открывает меню выбора; изменение уходит в store через task/update. */
import * as React from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { Calendar } from '@/components/shadcn/calendar';
import { PRIORITIES, PriorityIcon, STATUSES, StatusIcon, type Priority, type Status } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { useWorkspace, type TaskPatch } from '../data/store';
import { isOverdue, member, project } from '../data/selectors';
import { dOff, iso, parse, relDate } from '../lib/dates';
import type { Task } from '../data/types';
import { MemberAvatar } from './workspace';
import { ProjectDot } from './project';

function useUpdate(t: Task) {
  const { dispatch } = useWorkspace();
  return (patch: TaskPatch) => dispatch({ type: 'task/update', id: t.id, patch });
}

/** Общая обёртка: таблетка-триггер + меню с радио-пунктами */
function PillMenu<V extends string>({
  label,
  trigger,
  empty,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  trigger: React.ReactNode;
  empty?: boolean;
  value: V;
  options: { value: V; label: string; icon: React.ReactNode }[];
  onChange: (v: V) => void;
  className?: string;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className={cn('pillbtn', empty && 'empty', className)} aria-label={label} onClick={e => e.stopPropagation()}>
          {trigger}
        </button>
      </MenuTrigger>
      <MenuContent onClick={e => e.stopPropagation()}>
        <MenuRadioGroup value={value} onValueChange={v => onChange(v as V)}>
          {options.map(o => (
            <MenuRadioItem key={o.value} value={o.value} icon={o.icon}>
              {o.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

export function StatusField({ task: t }: { task: Task }) {
  const update = useUpdate(t);
  const st = STATUSES.find(s => s.id === t.status)!;
  return (
    <PillMenu<Status>
      label={`Status: ${st.name}`}
      value={t.status}
      onChange={status => update({ status })}
      options={STATUSES.map(s => ({ value: s.id, label: s.name, icon: <StatusIcon status={s.id} /> }))}
      trigger={
        <>
          <StatusIcon status={t.status} />
          <span>{st.name}</span>
        </>
      }
    />
  );
}

export function PriorityField({ task: t }: { task: Task }) {
  const update = useUpdate(t);
  const pr = PRIORITIES.find(p => p.id === t.priority)!;
  return (
    <PillMenu<Priority>
      label="Priority"
      empty={t.priority === 'none'}
      value={t.priority}
      onChange={priority => update({ priority })}
      options={PRIORITIES.map(p => ({ value: p.id, label: p.name, icon: <PriorityIcon priority={p.id} /> }))}
      trigger={
        <>
          <PriorityIcon priority={t.priority} />
          <span>{pr.name}</span>
        </>
      }
    />
  );
}

export function AssigneeField({ task: t }: { task: Task }) {
  const { data } = useWorkspace();
  const update = useUpdate(t);
  const m = member(data, t.assignee);
  return (
    <PillMenu<string>
      label="Assignee"
      empty={!m}
      value={t.assignee ?? 'none'}
      onChange={v => update({ assignee: v === 'none' ? null : v })}
      options={[
        { value: 'none', label: 'Unassigned', icon: <MemberAvatar id={null} size="sm" tooltip={false} /> },
        ...data.members.map(x => ({ value: x.id, label: x.name + (x.id === data.me ? ' (you)' : ''), icon: <MemberAvatar id={x.id} size="sm" tooltip={false} /> })),
      ]}
      trigger={
        <>
          <MemberAvatar id={t.assignee} size="sm" tooltip={false} />
          <span className="trunc">{m ? m.name : 'Unassigned'}</span>
        </>
      }
    />
  );
}

const QUICK_DATES = [
  ['Today', 0],
  ['Tomorrow', 1],
  ['Next week', 7],
] as const;

export function DueField({ task: t }: { task: Task }) {
  const update = useUpdate(t);
  const [open, setOpen] = React.useState(false);
  const set = (due: string | null) => {
    update({ due });
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn('pillbtn', t.due ? isOverdue(t) && 'over' : 'empty')} aria-label="Due date" onClick={e => e.stopPropagation()}>
          <CalendarIcon size={13} />
          {t.due ? <span className="num">{relDate(t.due)}</span> : <span>Set date</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={8} className="!max-w-none !p-1" onClick={e => e.stopPropagation()}>
        <div className="flex max-w-[248px] flex-wrap gap-1 p-1 pb-0">
          {QUICK_DATES.map(([label, n]) => (
            <button key={label} className="btn btn-sm btn-ghost" onClick={() => set(dOff(n))}>
              {label}
            </button>
          ))}
          {t.due && (
            <button className="btn btn-sm btn-ghost" onClick={() => set(null)}>
              Clear
            </button>
          )}
        </div>
        {/* Calendar — готовый компонент shadcn, оформление берётся из токенов Gr8r */}
        <Calendar mode="single" weekStartsOn={1} selected={t.due ? parse(t.due) : undefined} defaultMonth={t.due ? parse(t.due) : undefined} onSelect={d => d && set(iso(d))} />
      </PopoverContent>
    </Popover>
  );
}

export function ProjectPill({ task: t }: { task: Task }) {
  const { data } = useWorkspace();
  const p = project(data, t.project);
  return (
    <span className="pillbtn" style={{ cursor: 'default' }}>
      <ProjectDot project={p} />
      <span className="trunc">{p?.name}</span>
    </span>
  );
}
