/* Список задач с группами и колонками — порт listHtml / taskRow из components/task-list.js.
   Состояние списка (свёрнутые группы, раскрытые подзадачи, строка добавления) живёт в компоненте. */
import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Ellipsis, Link as LinkIcon, ListChecks, MessageSquare, PanelRightOpen, Plus, Repeat, RotateCcw, Star, Check } from 'lucide-react';
import { Checkbox, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { useWorkspace, type TaskPatch } from '../data/store';
import { commentsOf, fmtTimePair, subTime, taskTime, type SortField } from '../data/selectors';
import { countSubs } from '../data/subtasks';
import type { Subtask, Task } from '../data/types';
import { useTaskDrawer } from '../overlays';
import { AssigneeField, CustomerCell, DueField, LabelsField, PriorityField, ProjectPill, StatusField } from './fields';
import { useTaskActions } from './workspace';

export type Column = 'project' | 'status' | 'assignee' | 'priority' | 'due' | 'labels' | 'time' | 'customer';

/** Колонка Time: «6/8h» — факт и план, красным при перерасходе */
function TimeCell({ task: t }: { task: Task }) {
  const { data } = useWorkspace();
  const tt = useT();
  const x = taskTime(data.timeLogs, t);
  const v = fmtTimePair(x);
  return v ? (
    <span className="num" style={{ fontSize: 'var(--fs-sm)', color: x.over ? 'var(--red)' : 'var(--text-2)' }} title={x.over ? tt('views.time.overBy') : tt('views.time.actual')}>
      {v}
    </span>
  ) : (
    <span className="faint">—</span>
  );
}

function getColumns(tt: ReturnType<typeof useT>): Record<Column, { name: string; width: string; sort?: SortField; Cell: (p: { task: Task }) => React.ReactNode }> {
  return {
    project: { name: tt('views.list.col.project'), width: '160px', Cell: ProjectPill },
    status: { name: tt('views.list.col.status'), width: '126px', sort: 'status', Cell: StatusField },
    assignee: { name: tt('views.list.col.assignee'), width: '150px', Cell: AssigneeField },
    priority: { name: tt('views.list.col.priority'), width: '108px', sort: 'priority', Cell: PriorityField },
    due: { name: tt('views.list.col.due'), width: '104px', sort: 'due', Cell: DueField },
    labels: { name: tt('views.list.col.labels'), width: '168px', sort: 'manual', Cell: LabelsField },
    time: { name: tt('views.list.col.time'), width: '84px', sort: 'actual', Cell: TimeCell },
    customer: { name: tt('views.list.col.customer'), width: '160px', Cell: CustomerCell },
  };
}

/** Шаблон ширин колонок без названий — нужен в TaskRow, который не использует t напрямую */
const COL_WIDTHS: Record<Column, string> = {
  project: '160px',
  status: '126px',
  assignee: '150px',
  priority: '108px',
  due: '104px',
  labels: '168px',
  time: '84px',
  customer: '160px',
};

/** Необязательные колонки списка для меню Columns (переключаются через api.hidden) */
export const LIST_OPTIONAL_COLUMNS = [{ id: 'time', name: 'Time' }];

/** Колонки списка с учётом скрытых в виде: Time добавляется последней, если включена */
export const withTimeColumn = (base: Column[], hidden: string[]): Column[] => (hidden.includes('time') ? base : [...base, 'time']);

/** Колонка Customer — только у списков задач модуля services (у остальных заказчика нет) */
export const withCustomerColumn = (base: Column[], services: boolean): Column[] => (services ? [...base, 'customer'] : base);

export interface TaskGroup {
  key: string;
  name: string;
  icon?: React.ReactNode;
  tasks: Task[];
  /** Поля, которые получит задача, созданная в этой группе */
  defaults?: TaskPatch;
  collapsed?: boolean;
}

export interface TaskListProps {
  groups: TaskGroup[];
  columns: Column[];
  /** Проект по умолчанию для новых задач */
  defaultProject: string;
  sort?: { f: SortField; dir: 1 | -1 };
  onSort?: (f: SortField) => void;
}

/** xs — компактная кнопка для карточки доски */
export function RowMenu({ task: t, xs }: { task: Task; xs?: boolean }) {
  const actions = useTaskActions();
  const tt = useT();
  const done = t.status === 'done';
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className={xs ? 'ibtn ibtn-xs' : 'ibtn ibtn-sm'} aria-label={tt('views.drawer.more')}>
          <Ellipsis size={xs ? 13 : 15} />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<PanelRightOpen size={15} />} onSelect={() => actions.open(t)}>
          {tt('views.list.openInPanel')}
        </MenuItem>
        <MenuItem icon={done ? <RotateCcw size={15} /> : <Check size={15} />} onSelect={() => actions.toggleDone(t)}>
          {done ? tt('views.list.reopen') : tt('views.list.markComplete')}
        </MenuItem>
        <MenuItem icon={<Star size={15} />} onSelect={() => actions.toggleFav(t)}>
          {t.fav ? tt('views.list.removeFromFavorites') : tt('views.list.addToFavorites')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LinkIcon size={15} />} onSelect={() => toast(tt('views.drawer.linkCopied'))}>
          {tt('views.list.copyLink')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** Подзадачи под строкой: дерево с отступом по глубине, ветки сворачиваются */
function SubRows({ task: t, list, depth }: { task: Task; list: Subtask[]; depth: number }) {
  const { data, dispatch } = useWorkspace();
  const drawer = useTaskDrawer();
  const tt = useT();
  const [shut, setShut] = React.useState<Record<string, boolean>>({});
  return (
    <>
      {list.map(s => {
        const kids = s.subtasks.length;
        const x = subTime(data.timeLogs, t.id, s);
        const v = fmtTimePair(x);
        return (
          <React.Fragment key={s.id}>
            <div className={cn('subrow', s.done && 'done')} style={depth ? { paddingLeft: 64 + depth * 20 } : undefined}>
              {kids ? (
                <span className="ibtn ibtn-xs" role="button" aria-label={shut[s.id] ? tt('views.task.subtasksShow') : tt('views.task.subtasksHide')} aria-expanded={!shut[s.id]} style={{ marginLeft: -22, marginRight: -4 }} onClick={() => setShut(m => ({ ...m, [s.id]: !m[s.id] }))}>
                  {shut[s.id] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </span>
              ) : null}
              <Checkbox checked={s.done} onChange={() => dispatch({ type: 'task/toggleSubtask', id: t.id, subtask: s.id })} aria-label={tt('views.task.completeSubtask')} />
              <span className="grow" style={{ cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => drawer.open(t.id, s.id)} onKeyDown={e => e.key === 'Enter' && drawer.open(t.id, s.id)}>
                {s.title}
              </span>
              {kids > 0 && (
                <span className="faint num tmv" style={{ fontSize: 11 }}>
                  {countSubs(s.subtasks).done}/{countSubs(s.subtasks).total}
                </span>
              )}
              {v && (
                <span className="num tmv" style={{ fontSize: 11, marginRight: 14, color: x.over ? 'var(--red)' : 'var(--text-3)' }}>
                  {v}
                </span>
              )}
            </div>
            {kids > 0 && !shut[s.id] && <SubRows task={t} list={s.subtasks} depth={depth + 1} />}
          </React.Fragment>
        );
      })}
    </>
  );
}

function TaskRow({ task: t, columns, COLUMNS, template }: { task: Task; columns: Column[]; COLUMNS: ReturnType<typeof getColumns>; template: string }) {
  const { data } = useWorkspace();
  const actions = useTaskActions();
  const tt = useT();
  const [open, setOpen] = React.useState(false);
  const cc = commentsOf(data, t.id).length;
  const { done: sd, total: st } = countSubs(t.subtasks);
  return (
    <>
      <div className={cn('trow', t.status === 'done' && 'done')} data-ctx="task" data-id={t.id} style={{ '--cols': template } as React.CSSProperties} role="row">
        <div className="handle" aria-hidden />
        <div className="c-check">
          <Checkbox round checked={t.status === 'done'} onChange={() => actions.toggleDone(t)} aria-label={tt('views.task.markComplete')} />
        </div>
        <div className="ttl" role="button" tabIndex={0} onClick={() => actions.open(t)} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && actions.open(t)}>
          {t.subtasks.length ? (
            <span
              className="ibtn ibtn-xs"
              role="button"
              aria-label={open ? tt('views.task.subtasksHide') : tt('views.task.subtasksShow')}
              aria-expanded={open}
              style={{ marginLeft: -4 }}
              onClick={e => {
                e.stopPropagation();
                setOpen(o => !o);
              }}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
          ) : (
            <span style={{ width: 18, flexShrink: 0 }} />
          )}
          <span className="key">{t.key}</span>
          <span className="tt">{t.title}</span>
          {t.recur && (
            <Tooltip content={tt('views.task.repeatsLabel', { what: t.recur.toLowerCase() })}>
              <span className="meta-mini">
                <Repeat size={11} />
              </span>
            </Tooltip>
          )}
          {!!t.subtasks.length && (
            <span className="meta-mini">
              <ListChecks size={11} />
              {sd}/{st}
            </span>
          )}
          {!!cc && (
            <span className="meta-mini">
              <MessageSquare size={11} />
              {cc}
            </span>
          )}
        </div>
        {columns.map(c => {
          const { Cell } = COLUMNS[c];
          return (
            <div key={c} className={`c-meta c-${c}`}>
              <Cell task={t} />
            </div>
          );
        })}
        <div className="c-more">
          <RowMenu task={t} />
        </div>
      </div>
      {open && (
        <div className="subrows">
          <SubRows task={t} list={t.subtasks} depth={0} />
        </div>
      )}
    </>
  );
}

/** Строка быстрого добавления: Enter — создать и продолжить, Esc — отмена */
function Composer({ onSubmit, onCancel }: { onSubmit: (title: string) => void; onCancel: () => void }) {
  const tt = useT();
  const [v, setV] = React.useState('');
  return (
    <div className="addrow" style={{ background: 'var(--surface-2)' }}>
      <Plus size={14} />
      <input
        className="inline-in"
        autoFocus
        value={v}
        placeholder={tt('views.list.addRowPlaceholder')}
        aria-label={tt('views.list.addRow')}
        onChange={e => setV(e.target.value)}
        onBlur={() => !v.trim() && onCancel()}
        onKeyDown={e => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter') {
            if (!v.trim()) return onCancel();
            onSubmit(v.trim());
            setV('');
          }
        }}
      />
    </div>
  );
}

export function TaskList({ groups, columns, defaultProject, sort, onSort }: TaskListProps) {
  const { dispatch } = useWorkspace();
  const tt = useT();
  const COLUMNS = getColumns(tt);
  const template = `18px 30px minmax(220px,1fr) ${columns.map(c => COL_WIDTHS[c]).join(' ')} 40px`;
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [composer, setComposer] = React.useState<string | null>(null);
  const SortIcon = sort?.dir === 1 ? ArrowUp : ArrowDown;

  const header = (label: string, f?: SortField) => (
    <div role="columnheader" style={f && onSort ? { cursor: 'pointer' } : undefined} onClick={() => f && onSort?.(f)} aria-sort={f && sort?.f === f ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      {label} {f && sort?.f === f && <SortIcon size={11} />}
    </div>
  );

  return (
    <div className="tlist" role="table" aria-label={tt('views.list.ariaLabel')}>
      <div className="thead" style={{ '--cols': template } as React.CSSProperties} role="row">
        <div />
        <div />
        {header(tt('views.list.col.title'), 'title')}
        {columns.map(c => (
          <React.Fragment key={c}>{header(COLUMNS[c].name, COLUMNS[c].sort)}</React.Fragment>
        ))}
        <div />
      </div>
      {groups.map(g => {
        const isCollapsed = collapsed[g.key] ?? !!g.collapsed;
        const add = () => {
          setCollapsed(c => ({ ...c, [g.key]: false }));
          setComposer(g.key);
        };
        return (
          <React.Fragment key={g.key}>
            <div className="grp">
              <IconButton size="xs" label={isCollapsed ? tt('views.list.expandGroup') : tt('views.list.collapseGroup')} tooltip={false} aria-expanded={!isCollapsed} onClick={() => setCollapsed(c => ({ ...c, [g.key]: !isCollapsed }))}>
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </IconButton>
              {g.icon}
              <span>{g.name}</span>
              <span className="cnt">{g.tasks.length}</span>
              <IconButton size="xs" label={tt('views.list.addToGroup', { name: g.name })} tooltip={false} onClick={add}>
                <Plus size={13} />
              </IconButton>
            </div>
            {!isCollapsed && g.tasks.map(t => <TaskRow key={t.id} task={t} columns={columns} COLUMNS={COLUMNS} template={template} />)}
            {!isCollapsed &&
              (composer === g.key ? (
                <Composer onCancel={() => setComposer(null)} onSubmit={title => dispatch({ type: 'task/create', task: { title, project: defaultProject, ...g.defaults } })} />
              ) : (
                <button className="addrow" onClick={add}>
                  <Plus size={14} />
                  {tt('views.list.addRow')}
                </button>
              ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}
