/* Чипы формы новой задачи — порт formChip и поповеров project/status/assignee/priority/date/labels/recur из overlays/modals.js и popovers.js */
import * as React from 'react';
import { Calendar as CalendarIcon, CalendarArrowUp, Check, Repeat, Tag } from 'lucide-react';
import { Label, Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { Calendar } from '@/components/shadcn/calendar';
import { PriorityIcon, StatusIcon, priorityName, type Priority, type Status } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { useT, weekStartsOn } from '@/i18n';
import { useWorkspace } from '../data/store';
import { PriorityPopover } from '../components/priority-panel';
import { LABELS, canSee, member, project, statusOf, visibleProjects } from '../data/selectors';
import type { IsoDate, LabelId } from '../data/types';
import { dOff, fmtDate, iso, parse } from '../lib/dates';
import { PillMenu } from '../components/fields';
import { MemberAvatar } from '../components/workspace';
import { ProjectDot } from '../components/project';

export interface TaskFormState {
  title: string;
  desc: string;
  project: string;
  status: Status;
  assignee: string | null;
  priority: Priority;
  due: IsoDate | null;
  start: IsoDate | null;
  labels: LabelId[];
  recur: string | null;
  subtasks: { id: string; title: string }[];
  files: { name: string; size: string }[];
}

const RECUR = ['Does not repeat', 'Daily', 'Weekly', 'Every 2 weeks', 'Monthly'];

/** Быстрые даты поповера — как в оригинале: «Next week» это ближайший понедельник */
function quickDates(): [string, number][] {
  const wd = new Date().getDay();
  return [
    ['Today', 0],
    ['Tomorrow', 1],
    ['Next week', 7 - ((wd + 6) % 7)],
    ['In 2 weeks', 14],
  ];
}

function quickDateLabel(t: ReturnType<typeof useT>, n: string): string {
  if (n === 'Today') return t('dates.today');
  if (n === 'Tomorrow') return t('dates.tomorrow');
  if (n === 'Next week') return t('overlays.taskForm.nextWeek');
  if (n === 'In 2 weeks') return t('overlays.taskForm.inTwoWeeks');
  return n;
}

function DateChip({ label, icon, text, value, onChange }: { label: string; icon: React.ReactNode; text: string; value: IsoDate | null; onChange: (v: IsoDate | null) => void }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const pick = (v: IsoDate | null) => {
    onChange(v);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="pillbtn bordered" aria-label={label}>
          {icon}
          {text}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="!max-w-none !p-1">
        <div className="row" style={{ gap: 4, padding: 4, flexWrap: 'wrap' }}>
          {quickDates().map(([n, d]) => (
            <button key={n} type="button" className="badge" style={{ cursor: 'pointer' }} onClick={() => pick(dOff(d))}>
              {quickDateLabel(t, n)}
            </button>
          ))}
          {value && (
            <button type="button" className="badge" style={{ cursor: 'pointer', color: 'var(--red)' }} onClick={() => pick(null)}>
              {t('overlays.taskForm.clear')}
            </button>
          )}
        </div>
        <div className="msep" />
        <Calendar mode="single" weekStartsOn={weekStartsOn()} selected={value ? parse(value) : undefined} defaultMonth={value ? parse(value) : undefined} onSelect={d => d && pick(iso(d))} />
      </PopoverContent>
    </Popover>
  );
}

/** Поповер-список с поиском (popList с search); multi — не закрывается после выбора (метки) */
function PickPop({
  label,
  placeholder,
  trigger,
  items,
  multi,
  onPick,
}: {
  label: string;
  placeholder: string;
  trigger: React.ReactNode;
  items: { id: string; name: string; icon: React.ReactNode; on: boolean }[];
  multi?: boolean;
  onPick: (id: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const list = items.filter(it => !q || it.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (o) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="pillbtn bordered" aria-label={label}>
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent collisionPadding={8} className="!p-1">
        <div className="pin">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
        </div>
        {list.map(it => (
          <button
            key={it.id}
            type="button"
            className="mi"
            role="menuitemradio"
            aria-checked={it.on}
            onClick={() => {
              onPick(it.id);
              if (!multi) setOpen(false);
            }}
          >
            {it.icon}
            <span className="trunc">{it.name}</span>
            {it.on && (
              <span className="ck">
                <Check size={14} />
              </span>
            )}
          </button>
        ))}
        {!list.length && (
          <div className="mi faint" style={{ cursor: 'default' }}>
            {t('common.noResults')}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function FormChips({ form, set }: { form: TaskFormState; set: (patch: Partial<TaskFormState>) => void }) {
  const t = useT();
  const { data } = useWorkspace();
  const p = project(data, form.project);
  const st = statusOf(data, form.status) ?? { name: form.status };
  const m = member(data, form.assignee);
  const projects = visibleProjects(data).filter(q => canSee(data, q) && q.status !== 'complete');
  const toggleLabel = (id: LabelId) => set({ labels: form.labels.includes(id) ? form.labels.filter(x => x !== id) : [...form.labels, id] });
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
      <PickPop
        label={t('overlays.taskForm.project')}
        placeholder={t('overlays.taskForm.moveToProject')}
        items={projects.map(q => ({ id: q.id, name: q.name, icon: <ProjectDot project={q} />, on: q.id === form.project }))}
        onPick={id => set({ project: id })}
        trigger={
          <>
            <ProjectDot project={p} />
            {p?.name || t('overlays.taskForm.project')}
          </>
        }
      />
      <PillMenu<Status>
        label={t('overlays.taskForm.status')}
        className="bordered"
        value={form.status}
        onChange={v => set({ status: v })}
        options={data.statuses.map(s => ({ value: s.id, label: s.name, icon: <StatusIcon status={s.id} /> }))}
        trigger={
          <>
            <StatusIcon status={form.status} />
            <span>{st.name}</span>
          </>
        }
      />
      <PickPop
        label={t('overlays.taskForm.assignee')}
        placeholder={t('overlays.taskForm.assignTo')}
        items={[
          { id: 'none', name: t('overlays.taskForm.unassigned'), icon: <MemberAvatar id={null} size="sm" tooltip={false} />, on: !form.assignee },
          ...data.members.map(x => ({ id: x.id, name: x.name + (x.id === data.me ? t('overlays.taskForm.youSuffix') : ''), icon: <MemberAvatar id={x.id} size="sm" tooltip={false} />, on: form.assignee === x.id })),
        ]}
        onPick={v => set({ assignee: v === 'none' ? null : v })}
        trigger={
          <>
            <MemberAvatar id={form.assignee} size="sm" tooltip={false} />
            {m?.name || t('overlays.taskForm.assignee')}
          </>
        }
      />
      <PriorityPopover
        className="pillbtn bordered"
        value={form.priority}
        onChange={v => set({ priority: v })}
        trigger={
          <>
            <PriorityIcon priority={form.priority} />
            <span>{priorityName(form.priority)}</span>
          </>
        }
      />
      <DateChip
        label={t('overlays.taskForm.dueDate')}
        icon={<CalendarIcon size={13} />}
        text={form.due ? t('overlays.taskForm.dueOn', { date: fmtDate(form.due) }) : t('overlays.taskForm.dueDate')}
        value={form.due}
        onChange={due => set({ due, start: due && form.start && form.start > due ? due : form.start })}
      />
      <DateChip label={t('overlays.taskForm.startDate')} icon={<CalendarArrowUp size={13} />} text={form.start ? t('overlays.taskForm.startsOn', { date: fmtDate(form.start) }) : t('overlays.taskForm.startDate')} value={form.start} onChange={start => set({ start })} />
      <PickPop
        label={t('overlays.taskForm.labels')}
        placeholder={t('overlays.taskForm.filterLabels')}
        multi
        items={(Object.keys(LABELS) as LabelId[]).map(id => ({ id, name: LABELS[id].name, icon: <span className="pdot" style={{ '--c': LABELS[id].c } as React.CSSProperties} />, on: form.labels.includes(id) }))}
        onPick={id => toggleLabel(id as LabelId)}
        trigger={
          form.labels.length ? (
            form.labels.map(id => (
              <Label key={id} color={LABELS[id].c}>
                {LABELS[id].name}
              </Label>
            ))
          ) : (
            <>
              <Tag size={13} />
              {t('overlays.taskForm.labels')}
            </>
          )
        }
      />
      <PillMenu<string>
        label={t('overlays.taskForm.repeat')}
        className={cn('bordered')}
        value={form.recur || 'Does not repeat'}
        onChange={v => set({ recur: v === 'Does not repeat' ? null : v })}
        options={RECUR.map(x => ({ value: x, label: t(`overlays.taskForm.recur.${x}` as 'overlays.taskForm.recur.Does not repeat'), icon: <Repeat size={14} /> }))}
        trigger={
          <>
            <Repeat size={13} />
            {form.recur ? t(`overlays.taskForm.recur.${form.recur}` as 'overlays.taskForm.recur.Does not repeat') : t('overlays.taskForm.repeat')}
          </>
        }
      />
    </div>
  );
}
