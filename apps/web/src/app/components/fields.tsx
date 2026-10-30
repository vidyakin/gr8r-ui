/* Редактируемые поля задачи — порт cellStatus / cellAssignee / cellPrio / cellDue из components/task-list.js.
   Кнопка-«таблетка» (.pillbtn) открывает меню выбора; изменение уходит в store через task/update. */
import * as React from 'react';
import { Calendar as CalendarIcon, Tag, X } from 'lucide-react';
import { Label, Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger, toast } from '@/components/ui';
import { Calendar } from '@/components/shadcn/calendar';
import { PriorityIcon, StatusIcon, priorityName, type Status } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { useT, weekStartsOn } from '@/i18n';
import { useWorkspace, type TaskPatch } from '../data/store';
import { LABELS, isOverdue, member, project, statusName, statusOf } from '../data/selectors';
import { dOff, iso, parse, relDate } from '../lib/dates';
import type { Task } from '../data/types';
import { MemberAvatar } from './workspace';
import { PriorityPopover } from './priority-panel';
import { ProjectDot } from './project';
import { useCompanyRequisites } from '../docs/data';
import { CounterpartyPicker } from '../docs/pickers';

function useUpdate(t: Task) {
  const { dispatch } = useWorkspace();
  return (patch: TaskPatch) => dispatch({ type: 'task/update', id: t.id, patch });
}

/** Общая обёртка: таблетка-триггер + меню с радио-пунктами */
export function PillMenu<V extends string>({
  label,
  trigger,
  empty,
  value,
  options,
  onChange,
  className,
  plain,
}: {
  label: string;
  trigger: React.ReactNode;
  empty?: boolean;
  value: V;
  options: { value: V; label: string; icon: React.ReactNode }[];
  onChange: (v: V) => void;
  className?: string;
  /** Без оформления «таблетки» — для ячеек таблицы и карточек доски */
  plain?: boolean;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className={cn(!plain && 'pillbtn', empty && 'empty', className)} aria-label={label} onClick={e => e.stopPropagation()}>
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

/** Вид поля: «таблетка» (список), ячейка таблицы (иконка + название без рамки) или только иконка (карточка доски) */
export type FieldVariant = 'pill' | 'cell' | 'icon';
const variantProps = (v: FieldVariant) => ({ plain: v !== 'pill', className: v === 'cell' ? 'cp' : v === 'icon' ? 'm' : undefined });

export function StatusField({ task: t, variant = 'pill' }: { task: Task; variant?: FieldVariant }) {
  const update = useUpdate(t);
  const { data } = useWorkspace();
  const st = statusOf(data, t.status) ?? { name: t.status };
  return (
    <PillMenu<Status>
      label={`Status: ${'id' in st ? statusName(st) : st.name}`}
      {...variantProps(variant)}
      value={t.status}
      onChange={status => update({ status })}
      options={data.statuses.map(s => ({ value: s.id, label: statusName(s), icon: <StatusIcon status={s.id} /> }))}
      trigger={
        <>
          <StatusIcon status={t.status} />
          <span>{'id' in st ? statusName(st) : st.name}</span>
        </>
      }
    />
  );
}

export function PriorityField({ task: t, variant = 'pill' }: { task: Task; variant?: FieldVariant }) {
  const update = useUpdate(t);
  const name = priorityName(t.priority);
  const vp = variantProps(variant);
  return (
    <PriorityPopover
      task={t}
      label={variant === 'icon' ? `Priority: ${name}` : 'Priority'}
      className={cn(!vp.plain && 'pillbtn', variant === 'pill' && t.priority == null && 'empty', vp.className)}
      value={t.priority}
      onChange={priority => update({ priority })}
      trigger={
        <>
          <PriorityIcon priority={t.priority} size={variant === 'icon' ? 13 : 14} />
          {variant !== 'icon' && <span>{name}</span>}
        </>
      }
    />
  );
}

export function AssigneeField({ task: t, variant = 'pill' }: { task: Task; variant?: FieldVariant }) {
  const { data } = useWorkspace();
  const update = useUpdate(t);
  const tt = useT();
  const m = member(data, t.assignee);
  return (
    <PillMenu<string>
      label={tt('views.field.assignee')}
      {...variantProps(variant)}
      empty={variant === 'pill' && !m}
      value={t.assignee ?? 'none'}
      onChange={v => update({ assignee: v === 'none' ? null : v })}
      options={[
        { value: 'none', label: tt('views.field.unassigned'), icon: <MemberAvatar id={null} size="sm" tooltip={false} /> },
        ...data.members.map(x => ({ value: x.id, label: x.name + (x.id === data.me ? tt('views.toolbar.you') : ''), icon: <MemberAvatar id={x.id} size="sm" tooltip={false} /> })),
      ]}
      trigger={
        <>
          <MemberAvatar id={t.assignee} size="sm" tooltip={false} />
          {variant !== 'icon' && <span className={cn('trunc', variant === 'cell' && !m && 'faint')}>{m ? m.name : tt('views.field.unassigned')}</span>}
        </>
      }
    />
  );
}

const QUICK_DATES = (tt: ReturnType<typeof useT>) => [
  [tt('views.field.today'), 0],
  [tt('views.field.tomorrow'), 1],
  [tt('views.field.nextWeek'), 7],
] as const;

/** trigger — своё содержимое кнопки (тогда она без оформления «таблетки», стили задаёт className) */
export function DueField({ task: t, trigger, className }: { task: Task; trigger?: React.ReactNode; className?: string }) {
  const update = useUpdate(t);
  const tt = useT();
  const QUICK = QUICK_DATES(tt);
  const [open, setOpen] = React.useState(false);
  const set = (due: string | null) => {
    update({ due });
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(!trigger && 'pillbtn', !trigger && (t.due ? isOverdue(t) && 'over' : 'empty'), className)} aria-label={tt('views.field.setDueDate')} onClick={e => e.stopPropagation()}>
          {trigger ?? (
            <>
              <CalendarIcon size={13} />
              {t.due ? <span className="num">{relDate(t.due)}</span> : <span>{tt('views.field.setDate')}</span>}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={8} className="!max-w-none !p-1" onClick={e => e.stopPropagation()}>
        <div className="flex max-w-[248px] flex-wrap gap-1 p-1 pb-0">
          {QUICK.map(([label, n]) => (
            <button key={label} className="btn btn-sm btn-ghost" onClick={() => set(dOff(n))}>
              {label}
            </button>
          ))}
          {t.due && (
            <button className="btn btn-sm btn-ghost" onClick={() => set(null)}>
              {tt('views.field.clear')}
            </button>
          )}
        </div>
        <Calendar mode="single" weekStartsOn={weekStartsOn()} selected={t.due ? parse(t.due) : undefined} defaultMonth={t.due ? parse(t.due) : undefined} onSelect={d => d && set(iso(d))} />
      </PopoverContent>
    </Popover>
  );
}

/** Название заказчика задачи (только у задач модуля services) */
export function CustomerCell({ task: t }: { task: Task }) {
  const co = useCompanyRequisites(t.company ?? undefined);
  if (!t.company) return <span className="faint">—</span>;
  return <span className="trunc">{co.data?.name ?? '…'}</span>;
}

/** Заказчик у задачи модуля services: выбор компании из справочника (с поиском) и очистка */
export function CustomerField({ task: t }: { task: Task }) {
  const update = useUpdate(t);
  const tt = useT();
  const co = useCompanyRequisites(t.company ?? undefined);
  return (
    <div className="row" style={{ gap: 6, width: '100%' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <CounterpartyPicker value={co.data?.name ?? ''} placeholder={tt('views.field.searchCustomer')} onPick={c => update({ company: c.id })} />
      </div>
      {t.company && (
        <button className="btn btn-sm btn-ghost" aria-label={tt('views.field.clearCustomer')} onClick={() => update({ company: null })}>
          <X size={13} />
        </button>
      )}
    </div>
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

/** Метки задачи в списке (cellLabels): две первые + «+N»; выбор меток пока не перенесён */
export function LabelsField({ task: t }: { task: Task }) {
  const tt = useT();
  return (
    <button className={cn('pillbtn', !t.labels.length && 'empty')} aria-label={tt('views.field.labels')} style={{ gap: 4, overflow: 'hidden' }} onClick={() => toast.info(tt('views.field.labelsNotImplemented'))}>
      {t.labels.length ? (
        <>
          {t.labels.slice(0, 2).map(id => (
            <Label key={id} color={LABELS[id].c}>
              {LABELS[id].name}
            </Label>
          ))}
          {t.labels.length > 2 && (
            <span className="faint" style={{ fontSize: 11 }}>
              +{t.labels.length - 2}
            </span>
          )}
        </>
      ) : (
        <>
          <Tag size={13} />
          <span>{tt('views.field.add')}</span>
        </>
      )}
    </button>
  );
}
