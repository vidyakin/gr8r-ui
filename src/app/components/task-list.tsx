/* Список задач с группами и колонками — порт listHtml / taskRow из components/task-list.js.
   Состояние списка (свёрнутые группы, раскрытые подзадачи, строка добавления) живёт в компоненте. */
import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Ellipsis, Link as LinkIcon, ListChecks, MessageSquare, PanelRightOpen, Plus, Repeat, RotateCcw, Star, Check } from 'lucide-react';
import { Checkbox, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useWorkspace, type TaskPatch } from '../data/store';
import { commentsOf, type SortField } from '../data/selectors';
import type { Task } from '../data/types';
import { AssigneeField, DueField, LabelsField, PriorityField, ProjectPill, StatusField } from './fields';
import { useTaskActions } from './workspace';

export type Column = 'project' | 'status' | 'assignee' | 'priority' | 'due' | 'labels';

const COLUMNS: Record<Column, { name: string; width: string; sort?: SortField; Cell: (p: { task: Task }) => React.ReactNode }> = {
  project: { name: 'Project', width: '160px', Cell: ProjectPill },
  status: { name: 'Status', width: '126px', sort: 'status', Cell: StatusField },
  assignee: { name: 'Assignee', width: '150px', Cell: AssigneeField },
  priority: { name: 'Priority', width: '108px', sort: 'priority', Cell: PriorityField },
  due: { name: 'Due date', width: '104px', sort: 'due', Cell: DueField },
  labels: { name: 'Labels', width: '168px', sort: 'manual', Cell: LabelsField },
};

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
  const done = t.status === 'done';
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className={xs ? 'ibtn ibtn-xs' : 'ibtn ibtn-sm'} aria-label="More actions">
          <Ellipsis size={xs ? 13 : 15} />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<PanelRightOpen size={15} />} onSelect={() => actions.open(t)}>
          Open task
        </MenuItem>
        <MenuItem icon={done ? <RotateCcw size={15} /> : <Check size={15} />} onSelect={() => actions.toggleDone(t)}>
          {done ? 'Reopen' : 'Mark complete'}
        </MenuItem>
        <MenuItem icon={<Star size={15} />} onSelect={() => actions.toggleFav(t)}>
          {t.fav ? 'Remove from favorites' : 'Add to favorites'}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LinkIcon size={15} />} onSelect={() => toast('Link copied')}>
          Copy link
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function TaskRow({ task: t, columns, template }: { task: Task; columns: Column[]; template: string }) {
  const { data, dispatch } = useWorkspace();
  const actions = useTaskActions();
  const [open, setOpen] = React.useState(false);
  const cc = commentsOf(data, t.id).length;
  const sd = t.subtasks.filter(s => s.done).length;
  return (
    <>
      <div className={cn('trow', t.status === 'done' && 'done')} style={{ '--cols': template } as React.CSSProperties} role="row">
        <div className="handle" aria-hidden />
        <div className="c-check">
          <Checkbox round checked={t.status === 'done'} onChange={() => actions.toggleDone(t)} aria-label={`Mark ${t.title} complete`} />
        </div>
        <div className="ttl" role="button" tabIndex={0} onClick={() => actions.open(t)} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && actions.open(t)}>
          {t.subtasks.length ? (
            <span
              className="ibtn ibtn-xs"
              role="button"
              aria-label={`${open ? 'Hide' : 'Show'} subtasks`}
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
            <Tooltip content={`Repeats ${t.recur.toLowerCase()}`}>
              <span className="meta-mini">
                <Repeat size={11} />
              </span>
            </Tooltip>
          )}
          {!!t.subtasks.length && (
            <span className="meta-mini">
              <ListChecks size={11} />
              {sd}/{t.subtasks.length}
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
          {t.subtasks.map(s => (
            <div key={s.id} className={cn('subrow', s.done && 'done')}>
              <Checkbox checked={s.done} onChange={() => dispatch({ type: 'task/toggleSubtask', id: t.id, subtask: s.id })} aria-label="Complete subtask" />
              <span>{s.title}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Строка быстрого добавления: Enter — создать и продолжить, Esc — отмена */
function Composer({ onSubmit, onCancel }: { onSubmit: (title: string) => void; onCancel: () => void }) {
  const [v, setV] = React.useState('');
  return (
    <div className="addrow" style={{ background: 'var(--surface-2)' }}>
      <Plus size={14} />
      <input
        className="inline-in"
        autoFocus
        value={v}
        placeholder="Task name — press Enter to add, Esc to cancel"
        aria-label="New task name"
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
  const template = `18px 30px minmax(220px,1fr) ${columns.map(c => COLUMNS[c].width).join(' ')} 40px`;
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [composer, setComposer] = React.useState<string | null>(null);
  const SortIcon = sort?.dir === 1 ? ArrowUp : ArrowDown;

  const header = (label: string, f?: SortField) => (
    <div role="columnheader" style={f && onSort ? { cursor: 'pointer' } : undefined} onClick={() => f && onSort?.(f)} aria-sort={f && sort?.f === f ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      {label} {f && sort?.f === f && <SortIcon size={11} />}
    </div>
  );

  return (
    <div className="tlist" role="table" aria-label="Tasks">
      <div className="thead" style={{ '--cols': template } as React.CSSProperties} role="row">
        <div />
        <div />
        {header('Task', 'title')}
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
              <IconButton size="xs" label={isCollapsed ? 'Expand group' : 'Collapse group'} tooltip={false} aria-expanded={!isCollapsed} onClick={() => setCollapsed(c => ({ ...c, [g.key]: !isCollapsed }))}>
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </IconButton>
              {g.icon}
              <span>{g.name}</span>
              <span className="cnt">{g.tasks.length}</span>
              <IconButton size="xs" label={`Add task to ${g.name}`} tooltip={false} onClick={add}>
                <Plus size={13} />
              </IconButton>
            </div>
            {!isCollapsed && g.tasks.map(t => <TaskRow key={t.id} task={t} columns={columns} template={template} />)}
            {!isCollapsed &&
              (composer === g.key ? (
                <Composer onCancel={() => setComposer(null)} onSubmit={title => dispatch({ type: 'task/create', task: { title, project: defaultProject, ...g.defaults } })} />
              ) : (
                <button className="addrow" onClick={add}>
                  <Plus size={14} />
                  Add task
                </button>
              ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}
