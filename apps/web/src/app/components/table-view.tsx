/* Таблица задач — порт tableHtml / tcell из views/table.js: сортировка по заголовку, группы, выбор колонок,
   изменение ширины колонок, правка названия (двойной клик) и плана в часах (клик); колонки Plan / Actual / Variance с итогами. Используется на Tasks и (позже) на странице проекта. */
import * as React from 'react';
import { ArrowDown, ArrowUp, Calendar, Plus, SearchX, Timer } from 'lucide-react';
import { Button, EmptyState, Label, toast } from '@/components/ui';
import { PriorityIcon, StatusIcon, priorityName } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { t as tr, useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { LABELS, fmtHours, groupTasks, isOverdue, member, parseHours, planOfTask, project as findProject, projectColor, task as findTask, taskTime, totalTime, type GroupBy, type SortField, type TaskBucket, type TaskTime } from '../data/selectors';
import { fmtDate } from '../lib/dates';
import type { Task } from '../data/types';
import { AssigneeField, CustomerCell, DueField, PriorityField, StatusField } from './fields';
import { ProjectDot } from './project';
import type { ViewApi } from './view-toolbar';
import { CustomCell, isCustomColumn, useCustomColumns } from '../meta/custom-fields';
import type { MetaField } from '../meta/data';
import { MemberAvatar, TaskDue, useTaskActions } from './workspace';

export type BuiltinColumn = 'title' | 'status' | 'priority' | 'assignee' | 'due' | 'start' | 'labels' | 'deps' | 'plan' | 'actual' | 'variance' | 'created' | 'project' | 'customer';
/** Пользовательские поля задач приходят колонками cf:<ключ> (конструктор сущностей) */
export type TableColumn = BuiltinColumn | `cf:${string}`;

export function getTableColumns(tt: ReturnType<typeof useT>): { id: BuiltinColumn; name: string; width: number }[] {
  return [
    { id: 'title', name: tt('views.table.task'), width: 314 },
    { id: 'status', name: tt('views.table.status'), width: 132 },
    { id: 'priority', name: tt('views.table.priority'), width: 112 },
    { id: 'assignee', name: tt('views.table.assignee'), width: 156 },
    { id: 'due', name: tt('views.table.dueDate'), width: 112 },
    { id: 'start', name: tt('views.table.startDate'), width: 112 },
    { id: 'labels', name: tt('views.table.labels'), width: 180 },
    { id: 'deps', name: tt('views.table.dependencies'), width: 150 },
    { id: 'plan', name: tt('views.table.plan'), width: 92 },
    { id: 'actual', name: tt('views.table.actual'), width: 92 },
    { id: 'variance', name: tt('views.table.variance'), width: 100 },
    { id: 'created', name: tt('views.table.created'), width: 112 },
    { id: 'project', name: tt('views.table.project'), width: 156 },
  ];
}

/** Колонки таблицы: название и ширина по умолчанию (TCOLS) */
export const TABLE_COLUMNS: { id: TableColumn; name: string; width: number }[] = [
  { id: 'title', name: 'Task', width: 314 },
  { id: 'status', name: 'Status', width: 132 },
  { id: 'priority', name: 'Priority', width: 112 },
  { id: 'assignee', name: 'Assignee', width: 156 },
  { id: 'due', name: 'Due date', width: 112 },
  { id: 'start', name: 'Start date', width: 112 },
  { id: 'labels', name: 'Labels', width: 180 },
  { id: 'deps', name: 'Dependencies', width: 150 },
  { id: 'plan', name: 'Plan', width: 92 },
  { id: 'actual', name: 'Actual', width: 92 },
  { id: 'variance', name: 'Variance', width: 100 },
  { id: 'created', name: 'Created', width: 112 },
  { id: 'project', name: 'Project', width: 156 },
];

/** Колонки, которые можно скрывать (всё, кроме названия) */
export const TOGGLE_COLUMNS = TABLE_COLUMNS.filter(c => c.id !== 'title');

/** Колонка заказчика — только у списков задач модуля services (добавляется по месту, не в общий набор) */
export const CUSTOMER_COLUMN: { id: TableColumn; name: string; width: number } = { id: 'customer', name: 'Customer', width: 160 };

/** Колонки пользовательских полей задач: показываются по умолчанию, скрываются в меню Columns */
export function useTaskColumns() {
  const custom = useCustomColumns('task');
  return React.useMemo(() => {
    const extra = custom.map(c => ({ id: c.id as TableColumn, name: c.name, width: c.width }));
    return { all: [...TABLE_COLUMNS, ...extra] as { id: TableColumn; name: string; width: number }[], toggle: [...TOGGLE_COLUMNS, ...extra] as { id: TableColumn; name: string; width: number }[], fields: new Map(custom.map(c => [c.id, c.field] as const)) };
  }, [custom]);
}

const SORT_OF: Record<BuiltinColumn, SortField> = {
  title: 'title',
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  due: 'due',
  start: 'start',
  labels: 'manual',
  deps: 'manual',
  plan: 'plan',
  actual: 'actual',
  variance: 'variance',
  created: 'created',
  project: 'project',
  customer: 'manual',
};

/** Значок группы (поле html из groupTasks оригинала) */
export function BucketIcon({ group, bucket }: { group: GroupBy; bucket: TaskBucket }) {
  if (group === 'status') return <StatusIcon status={bucket.key} />;
  if (group === 'priority') return <PriorityIcon priority={bucket.key === 'none' ? null : +bucket.key} />;
  if (group === 'assignee') return <MemberAvatar id={bucket.key === 'none' ? null : bucket.key} size="sm" tooltip={false} />;
  if (group === 'project') return <ProjectDotById id={bucket.key} />;
  if (group === 'due') return <Calendar size={14} />;
  return null;
}

function ProjectDotById({ id }: { id: string }) {
  const { data } = useWorkspace();
  return <ProjectDot project={findProject(data, id)} />;
}

/** Колонки учёта времени: для них в строках групп и внизу считаются итоги */
const TIME_COLUMNS: TableColumn[] = ['plan', 'actual', 'variance'];

/** Отклонение: «+5.5h» красным при перерасходе, «−2h» приглушённо при запасе */
function Variance({ x }: { x: Pick<TaskTime, 'variance'> }) {
  const v = x.variance;
  if (v == null) return <span className="faint">—</span>;
  if (Math.abs(v) < 0.005) return <span className="muted">0h</span>;
  return <span style={{ color: v > 0 ? 'var(--red)' : 'var(--text-3)' }}>{v > 0 ? '+' : '−'}{fmtHours(Math.abs(v))}</span>;
}

/** Ячейка итогов (строка группы и общий итог) */
function TotalCell({ col, x }: { col: TableColumn; x: TaskTime }) {
  if (col === 'plan') return <>{x.plan > 0 ? fmtHours(x.plan) : <span className="faint">—</span>}</>;
  if (col === 'actual') return <>{x.actual > 0 ? fmtHours(x.actual) : <span className="faint">—</span>}</>;
  return <Variance x={x} />;
}

const notPorted = () => toast.info('Редактирование этого поля пока не перенесено');

/** Правка текста в ячейке: Enter / потеря фокуса — сохранить, Esc — отмена */
function CellInput({ value, placeholder, label, onCommit, onCancel }: { value: string; placeholder?: string; label: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = React.useState(value);
  const done = React.useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    save ? onCommit(v.trim()) : onCancel();
  };
  return (
    <input
      autoFocus
      value={v}
      placeholder={placeholder}
      aria-label={label}
      onFocus={e => e.currentTarget.select()}
      onChange={e => setV(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={e => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
    />
  );
}

function Cell({ task: t, col, edit, setEdit, cf }: { task: Task; col: TableColumn; edit: { id: string; f: 'title' | 'plan' } | null; setEdit: (e: { id: string; f: 'title' | 'plan' } | null) => void; cf?: MetaField }) {
  const tt = useT();
  const { data, dispatch } = useWorkspace();
  const actions = useTaskActions();
  const editing = edit?.id === t.id && edit.f === col;
  const faint = <span className="faint">—</span>;
  const save = (patch: { title?: string; planHours?: number | null }) => {
    dispatch({ type: 'task/update', id: t.id, patch });
    setEdit(null);
  };
  if (isCustomColumn(col)) return <td>{cf ? <CustomCell field={cf} custom={t.custom} /> : faint}</td>;
  switch (col) {
    case 'title':
      return editing ? (
        <td className="sticky editing">
          <CellInput label={tt('views.drawer.titleField')} value={t.title} onCommit={v => (v ? save({ title: v }) : setEdit(null))} onCancel={() => setEdit(null)} />
        </td>
      ) : (
        <td className="sticky cellbtn" title={tt('views.table.renameAria')} onClick={() => actions.open(t)} onDoubleClick={() => setEdit({ id: t.id, f: 'title' })}>
          <span className="row" style={{ gap: 8 }}>
            <StatusIcon status={t.status} size={13} />
            <span className="trunc" style={{ fontWeight: 450 }}>
              {t.title}
            </span>
            <span className="mono faint" style={{ fontSize: 11, marginLeft: 'auto' }}>
              {t.key}
            </span>
          </span>
        </td>
      );
    case 'status':
      return (
        <td className="cellbtn">
          <StatusField task={t} variant="cell" />
        </td>
      );
    case 'priority':
      return (
        <td className="cellbtn">
          <PriorityField task={t} variant="cell" />
        </td>
      );
    case 'assignee':
      return (
        <td className="cellbtn">
          <AssigneeField task={t} variant="cell" />
        </td>
      );
    case 'due':
      return (
        <td className="cellbtn num" style={isOverdue(t) ? { color: 'var(--red)' } : undefined}>
          <DueField task={t} className="cp" trigger={t.due ? fmtDate(t.due) : faint} />
        </td>
      );
    case 'start':
      return (
        <td className="cellbtn num" onClick={notPorted}>
          {t.start ? fmtDate(t.start) : faint}
        </td>
      );
    case 'labels':
      return (
        <td className="cellbtn" onClick={notPorted}>
          <span className="row" style={{ gap: 4 }}>
            {t.labels.length
              ? t.labels.map(id => (
                  <Label key={id} color={LABELS[id].c}>
                    {LABELS[id].name}
                  </Label>
                ))
              : faint}
          </span>
        </td>
      );
    case 'deps': {
      const deps = t.deps.map(d => findTask(data, d)).filter((x): x is Task => !!x);
      return (
        <td className="cellbtn" onClick={notPorted}>
          {deps.length
            ? deps.map(d => (
                <span key={d.id} className="depchip" title={d.title}>
                  {d.key}
                </span>
              ))
            : faint}
        </td>
      );
    }
    case 'plan': {
      const plan = planOfTask(t);
      return editing ? (
        <td className="editing">
          <CellInput
            label={tr('views.table.planHours')}
            placeholder={tr('views.table.planPlaceholder')}
            value={t.planHours != null ? String(t.planHours) : ''}
            onCommit={v => {
              const h = parseHours(v);
              if (!v) save({ planHours: null });
              else if (h != null) save({ planHours: h });
              else {
                toast.error(tt('views.time.dialog.enterHoursError'));
                setEdit(null);
              }
            }}
            onCancel={() => setEdit(null)}
          />
        </td>
      ) : (
        <td className="cellbtn num" title={t.planHours == null && plan > 0 ? tt('views.table.planFromSubtasks') : tt('views.table.editPlan')} onClick={() => setEdit({ id: t.id, f: 'plan' })}>
          {plan > 0 ? <span style={t.planHours == null ? { color: 'var(--text-2)', fontStyle: 'italic' } : undefined}>{fmtHours(plan)}</span> : faint}
        </td>
      );
    }
    case 'actual': {
      const x = taskTime(data.timeLogs, t);
      return <td className="num">{x.actual > 0 ? fmtHours(x.actual) : faint}</td>;
    }
    case 'variance':
      return (
        <td className="num">
          <Variance x={taskTime(data.timeLogs, t)} />
        </td>
      );
    case 'created':
      return <td className="num muted">{fmtDate(new Date(t.created))}</td>;
    case 'project': {
      const p = findProject(data, t.project);
      return (
        <td className="cellbtn" onClick={notPorted}>
          <span className="row" style={{ gap: 6 }}>
            <span className="pdot" style={{ '--c': projectColor(p) } as React.CSSProperties} />
            <span className="trunc">{p?.name}</span>
          </span>
        </td>
      );
    }
    case 'customer':
      return (
        <td className="cellbtn">
          <CustomerCell task={t} />
        </td>
      );
  }
}

export interface TableViewProps {
  tasks: Task[];
  /** Состояние вида из useListView: сортировка, группировка, скрытые колонки, ширины */
  api: ViewApi;
  /** Действие строки «New task» внизу таблицы */
  onNewTask: () => void;
  /** Таблица одного проекта: колонка Project скрыта */
  project?: string;
  /** Показывать колонку Customer — только у списков задач модуля services */
  customer?: boolean;
}

export function TableView({ tasks, api, onNewTask, project, customer }: TableViewProps) {
  const { data } = useWorkspace();
  const tt = useT();
  const actions = useTaskActions();
  const [edit, setEdit] = React.useState<{ id: string; f: 'title' | 'plan' } | null>(null);
  const { view } = api;
  const { all, fields: cfFields } = useTaskColumns();
  // Подменим локализованные имена встроенных колонок
  const localizedNames = new Map(getTableColumns(tt).map(c => [c.id, c.name] as const));
  const localizedAll = all.map(c => (localizedNames.has(c.id as BuiltinColumn) ? { ...c, name: localizedNames.get(c.id as BuiltinColumn)! } : c));
  const cols = [
    ...localizedAll.filter(c => c.id === 'title' || (!api.hidden.includes(c.id) && !(project && c.id === 'project'))),
    ...(customer && !api.hidden.includes('customer') ? [CUSTOMER_COLUMN] : []),
  ];
  const width = (c: (typeof cols)[number]) => api.colW[c.id] ?? c.width;
  const totalW = cols.reduce((a, c) => a + width(c), 0);
  const groups = groupTasks(data, tasks, api.group);
  const hasTime = cols.some(c => TIME_COLUMNS.includes(c.id));

  if (!tasks.length)
    return (
      <EmptyState
        icon={<SearchX size={20} />}
        title={tt('common.noResults')}
        action={
          <Button size="sm" onClick={api.clearFilters}>
            {tt('common.clearFilters')}
          </Button>
        }
      >
        {tt('views.table.emptyFiltered')}
      </EmptyState>
    );

  // Ширина колонки меняется перетаскиванием правого края заголовка
  const startResize = (e: React.PointerEvent, col: (typeof cols)[number]) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.classList.add('on');
    const w0 = width(col);
    const x0 = e.clientX;
    const mv = (ev: PointerEvent) => api.setColW(col.id, Math.max(64, Math.round(w0 + ev.clientX - x0)));
    const up = () => {
      el.classList.remove('on');
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  };

  return (
    <>
      <div className="tbl-wrap hide-m">
        <table className="tbl" style={{ width: totalW }} aria-label={tt('views.table.ariaLabel')}>
          <colgroup>
            {cols.map(c => (
              <col key={c.id} style={{ width: width(c) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {cols.map(c => {
                const f = isCustomColumn(c.id) ? null : SORT_OF[c.id as BuiltinColumn];
                const on = (view.sort.f as string) === c.id;
                const SortIcon = view.sort.dir > 0 ? ArrowUp : ArrowDown;
                return (
                  <th key={c.id} className={c.id === 'title' ? 'sticky' : undefined} style={{ position: 'sticky' }} scope="col" aria-sort={on ? (view.sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                    <div className="thi" style={f ? undefined : { cursor: 'default' }} onClick={f ? () => api.setSort(f) : undefined}>
                      {c.name}
                      {on && <SortIcon size={11} />}
                    </div>
                    <span className="rsz" aria-hidden onPointerDown={e => startResize(e, c)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <React.Fragment key={g.key}>
                {api.group !== 'none' && (
                  <tr className={cn('grow-row', hasTime && 'split')}>
                    <td className="sticky" colSpan={hasTime ? 1 : cols.length}>
                      <span className="row" style={{ gap: 6 }}>
                        <BucketIcon group={api.group} bucket={g} />
                        {g.name}
                        <span className="faint" style={{ fontWeight: 500 }}>
                          {g.tasks.length}
                        </span>
                      </span>
                    </td>
                    {/* Итоги группы стоят под колонками времени, остальные ячейки пустые */}
                    {hasTime &&
                      cols.slice(1).map(c => (
                        <td key={c.id} className="num">
                          {TIME_COLUMNS.includes(c.id) && <TotalCell col={c.id} x={totalTime(data.timeLogs, g.tasks)} />}
                        </td>
                      ))}
                  </tr>
                )}
                {g.tasks.map(t => (
                  <tr key={t.id} data-ctx="task" data-id={t.id}>
                    {cols.map(c => (
                      <Cell key={c.id} task={t} col={c.id} edit={edit} setEdit={setEdit} cf={cfFields.get(c.id)} />
                    ))}
                  </tr>
                ))}
              </React.Fragment>
            ))}
            <tr>
              <td className="sticky cellbtn" colSpan={cols.length} style={{ color: 'var(--text-3)' }} onClick={onNewTask}>
                <span className="row" style={{ gap: 6 }}>
                  <Plus size={14} />
                  {tt('views.board.newTask')}
                </span>
              </td>
            </tr>
            {hasTime && (
              <tr className="tot-row">
                <td className="sticky">
                  <span className="row" style={{ gap: 6 }}>
                    {tt('ui.total')}
                    <span className="faint" style={{ fontWeight: 500 }}>
                      {tasks.length}
                    </span>
                  </span>
                </td>
                {cols.slice(1).map(c => (
                  <td key={c.id} className="num">
                    {TIME_COLUMNS.includes(c.id) && <TotalCell col={c.id} x={totalTime(data.timeLogs, tasks)} />}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* На телефоне таблица заменяется списком карточек */}
      <div className="only-m" style={{ padding: '8px 16px 90px' }}>
        {tasks.map(t => (
          <div key={t.id} className="panel" style={{ padding: 12, marginBottom: 8 }} role="button" tabIndex={0} onClick={() => actions.open(t)} onKeyDown={e => e.key === 'Enter' && actions.open(t)}>
            <div className="row" style={{ marginBottom: 8 }}>
              <StatusIcon status={t.status} />
              <b style={{ fontWeight: 500 }} className="grow">
                {t.title}
              </b>
              <span className="mono faint" style={{ fontSize: 11 }}>
                {t.key}
              </span>
            </div>
            <div className={cn('row muted')} style={{ flexWrap: 'wrap', gap: 10, fontSize: 12 }}>
              {/* значок и название — прямые дети flex-строки, поэтому между ними тот же зазор 10px, что в оригинале */}
              <PriorityIcon priority={t.priority} />
              <span>{priorityName(t.priority)}</span>
              <MemberAvatar id={t.assignee} size="sm" tooltip={false} />
              <span className="muted">{member(data, t.assignee)?.name ?? 'Unassigned'}</span>
              <TaskDue task={t} />
              {planOfTask(t) > 0 && (
                <span className="faint">
                  <Timer size={12} /> {fmtHours(planOfTask(t))}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
