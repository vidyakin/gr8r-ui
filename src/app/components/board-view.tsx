/* Доска задач по статусам — порт boardHtml / kcard из views/board.js и drag-and-drop карточек из actions/drag-drop.js.
   Используется на странице Tasks и (позже) на странице проекта. Перетаскивание — нативный HTML5 DnD. */
import * as React from 'react';
import { ArrowDownWideNarrow, Check, CheckCheck, Archive, ChevronDown, FoldHorizontal, ListChecks, MessageSquare, Paperclip, Pencil, Plus, Repeat, RotateCcw, Ellipsis } from 'lucide-react';
import { Button, Checkbox, Label, Menu, Switch, MenuContent, MenuItem, MenuLabel, MenuTrigger, Progress, Tooltip, toast } from '@/components/ui';
import { STATUSES, StatusIcon, type Status } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { useWorkspace, type TaskPatch } from '../data/store';
import { countSubs } from '../data/subtasks';
import { LABELS, commentsOf, project as findProject, sortTasks } from '../data/selectors';
import type { Subtask, Task } from '../data/types';
import { useTaskDrawer } from '../overlays';
import { AssigneeField, DueField, PriorityField } from './fields';
import { ProjectDot } from './project';
import { RowMenu } from './task-list';
import { TaskDue, useTaskActions } from './workspace';

export interface BoardViewProps {
  tasks: Task[];
  /** Проект для новых задач, когда доска показывает несколько проектов */
  defaultProject: string;
  /** Доска одного проекта: новые задачи создаются в нём, точка проекта на карточках скрыта */
  project?: string;
  /** Подзадачи раскрыты на всех карточках (переключатель «Show subtasks»); каждую карточку можно свернуть отдельно */
  showSubtasks?: boolean;
}

const SUBTASKS_KEY = 'gr8r-ui.board-subtasks';

/** Состояние переключателя «Show subtasks» — запоминается между заходами */
export function useBoardSubtasks() {
  const [on, setOn] = React.useState(() => {
    try {
      return localStorage.getItem(SUBTASKS_KEY) === '1';
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(SUBTASKS_KEY, on ? '1' : '0');
    } catch {
      /* хранилище недоступно */
    }
  }, [on]);
  return [on, setOn] as const;
}

/** Переключатель «Show subtasks» для тулбара доски */
export function ShowSubtasksSwitch({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="row cursor-pointer" style={{ fontSize: 12.5, color: 'var(--text-2)', gap: 6, whiteSpace: 'nowrap' }}>
      <Switch checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="hide-m">Show subtasks</span>
      <span className="only-m">Subtasks</span>
    </label>
  );
}

/** Дерево подзадач на карточке: отметка выполнения и переход в карточку подзадачи */
function KSubTree({ task: t, list, depth = 0 }: { task: Task; list: Subtask[]; depth?: number }) {
  const { dispatch } = useWorkspace();
  const drawer = useTaskDrawer();
  return (
    <>
      {list.map(s => (
        <React.Fragment key={s.id}>
          <div className={cn('ksub', s.done && 'done')} style={depth ? { paddingLeft: depth * 16 } : undefined}>
            <Checkbox checked={s.done} onChange={() => dispatch({ type: 'task/toggleSubtask', id: t.id, subtask: s.id })} aria-label={`Complete subtask ${s.title}`} />
            <button className="t" onClick={() => drawer.open(t.id, s.id)}>
              {s.title}
            </button>
          </div>
          {!!s.subtasks.length && <KSubTree task={t} list={s.subtasks} depth={depth + 1} />}
        </React.Fragment>
      ))}
    </>
  );
}

/** Карточка задачи (kcard) */
function KCard({ task: t, showProject, showSubtasks, dragging, onDragStart, onDragEnd }: { task: Task; showProject: boolean; showSubtasks: boolean; dragging: boolean; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void }) {
  const { data } = useWorkspace();
  const actions = useTaskActions();
  const cc = commentsOf(data, t.id).length;
  const ac = t.attachments.length;
  const { done: sd, total: st } = countSubs(t.subtasks);
  const p = findProject(data, t.project);
  const done = t.status === 'done';
  // Своё состояние карточки; общий переключатель перезаписывает его у всех карточек
  const [open, setOpen] = React.useState(showSubtasks);
  React.useEffect(() => setOpen(showSubtasks), [showSubtasks]);
  return (
    <div
      className={cn('kcard', done && 'done', dragging && 'dragging')}
      draggable
      data-card={t.id}
      role="button"
      tabIndex={0}
      aria-label={t.title}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => actions.open(t)}
      onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && actions.open(t)}
    >
      {!!t.labels.length && (
        <div className="labels">
          {t.labels.map(id => (
            <Label key={id} color={LABELS[id].c}>
              {LABELS[id].name}
            </Label>
          ))}
        </div>
      )}
      <div className="top">
        {done && (
          <span className="done-ic" aria-label="Done">
            <StatusIcon status="done" />
          </span>
        )}
        <div className="title">{t.title}</div>
      </div>
      {st > 0 && (
        <>
          <div className="subp">
            <button className="subt-tg" aria-expanded={open} aria-label={open ? 'Hide subtasks' : 'Show subtasks'} onClick={e => (e.stopPropagation(), setOpen(o => !o))}>
              <ChevronDown size={12} className="chev" />
              <ListChecks size={12} />
              <span className="num">
                {sd}/{st}
              </span>
            </button>
            <Progress value={Math.round((sd / st) * 100)} tone={sd === st ? 'green' : undefined} />
          </div>
          {/* Плавное раскрытие: grid-template-rows 0fr → 1fr */}
          <div className={cn('ksubs', open && 'open')} inert={!open} onClick={e => e.stopPropagation()}>
            <div className="ksubs-in">
              <KSubTree task={t} list={t.subtasks} />
            </div>
          </div>
        </>
      )}
      <div className="meta">
        {showProject && p && (
          <Tooltip content={p.name}>
            <span className="m">
              <ProjectDot project={p} />
            </span>
          </Tooltip>
        )}
        <span className="key">{t.key}</span>
        <PriorityField task={t} variant="icon" />
        {t.due && <DueField task={t} className="m" trigger={<TaskDue task={t} />} />}
        {t.recur && (
          <Tooltip content={`Repeats ${t.recur.toLowerCase()}`}>
            <span className="m">
              <Repeat size={12} />
            </span>
          </Tooltip>
        )}
        {!!cc && (
          <span className="m" aria-label={`${cc} comments`}>
            <MessageSquare size={12} />
            {cc}
          </span>
        )}
        {!!ac && (
          <span className="m" aria-label={`${ac} attachments`}>
            <Paperclip size={12} />
            {ac}
          </span>
        )}
        <AssigneeField task={t} variant="icon" />
      </div>
      <div className="hacts" onClick={e => e.stopPropagation()}>
        <Tooltip content={done ? 'Reopen' : 'Mark complete'}>
          <button className="ibtn ibtn-xs" aria-label={done ? 'Reopen' : 'Mark complete'} onClick={() => actions.toggleDone(t)}>
            {done ? <RotateCcw size={13} /> : <Check size={13} />}
          </button>
        </Tooltip>
        <Tooltip content="Quick edit">
          <button className="ibtn ibtn-xs" aria-label="Quick edit" onClick={() => actions.open(t)}>
            <Pencil size={12} />
          </button>
        </Tooltip>
        <RowMenu task={t} xs />
      </div>
    </div>
  );
}

/** Поле быстрого добавления в колонке: Enter — создать, Esc — отмена */
function Composer({ onSubmit, onCancel }: { onSubmit: (title: string) => void; onCancel: () => void }) {
  const [v, setV] = React.useState('');
  const submit = () => (v.trim() ? onSubmit(v.trim()) : onCancel());
  return (
    <div className="composer">
      <textarea
        autoFocus
        rows={2}
        value={v}
        placeholder="Task name"
        aria-label="New task name"
        onChange={e => setV(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="row">
        <span className="faint" style={{ fontSize: 11 }}>
          Enter to add · Esc to cancel
        </span>
        <span className="sp" />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={submit}>
          Add
        </Button>
      </div>
    </div>
  );
}

export function BoardView({ tasks, defaultProject, project, showSubtasks = false }: BoardViewProps) {
  const { data, dispatch } = useWorkspace();
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [composer, setComposer] = React.useState<Status | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  // Куда упадёт карточка: колонка и карточка, перед которой вставляем (null — в конец)
  const [drop, setDrop] = React.useState<{ col: Status; before: string | null } | null>(null);

  const patch = (id: string, p: TaskPatch) => dispatch({ type: 'task/update', id, patch: p });

  const clearDrag = () => {
    setDragId(null);
    setDrop(null);
  };

  const onDragOver = (e: React.DragEvent<HTMLElement>, col: Status) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('.kcard:not(.dragging)')];
    const after = cards.find(c => {
      const r = c.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    const before = after?.dataset.card ?? null;
    setDrop(d => (d && d.col === col && d.before === before ? d : { col, before }));
  };

  const onDrop = (e: React.DragEvent) => {
    if (!dragId || !drop) return;
    e.preventDefault();
    const t = data.tasks.find(x => x.id === dragId);
    const { col, before } = drop;
    clearDrag();
    if (!t) return;
    const colTs = data.tasks.filter(x => x.status === col && x.id !== t.id && !x.archived && (!project || x.project === project)).sort((a, b) => a.order - b.order);
    let order: number;
    if (before) {
      const i = colTs.findIndex(x => x.id === before);
      const prev = colTs[i - 1];
      const nx = colTs[i];
      order = prev ? (prev.order + nx.order) / 2 : nx.order - 1;
    } else order = colTs.length ? colTs[colTs.length - 1].order + 1 : t.order;
    const moved = t.status !== col;
    patch(t.id, moved ? { order, status: col } : { order });
    if (moved) toast(`Moved “${t.title}” to ${STATUSES.find(s => s.id === col)!.name}`, { duration: 2200 });
  };

  // Новая задача встаёт в начало колонки
  const addTask = (status: Status, title: string) => {
    const top = Math.min(0, ...tasks.filter(t => t.status === status).map(t => t.order));
    dispatch({ type: 'task/create', task: { title, project: project ?? defaultProject, status, order: top - 1 } });
  };

  return (
    <div className="board">
      {STATUSES.map(s => {
        const col = tasks.filter(t => t.status === s.id).sort((a, b) => a.order - b.order);
        const over = drop?.col === s.id;
        if (collapsed[s.id])
          return (
            <div
              key={s.id}
              className={cn('bcol collapsed', over && 'over')}
              role="button"
              tabIndex={0}
              aria-label={`Expand ${s.name}`}
              title="Expand"
              onClick={() => setCollapsed(c => ({ ...c, [s.id]: false }))}
              onKeyDown={e => e.key === 'Enter' && setCollapsed(c => ({ ...c, [s.id]: false }))}
              onDragOver={e => onDragOver(e, s.id)}
              onDrop={onDrop}
            >
              <StatusIcon status={s.id} />
              <span className="vname">
                {s.name}
                <span className="faint">{col.length}</span>
              </span>
            </div>
          );
        const line = <div className="drop-line" />;
        const addRow =
          composer === s.id ? (
            <Composer
              onCancel={() => setComposer(null)}
              onSubmit={title => {
                addTask(s.id, title);
                setComposer(null);
              }}
            />
          ) : (
            <button className="addcard" onClick={() => setComposer(s.id)}>
              <Plus size={14} />
              Add task
            </button>
          );
        const doneAll = s.id !== 'done';
        return (
          <section key={s.id} className={cn('bcol', over && 'over')} aria-label={s.name} onDragOver={e => onDragOver(e, s.id)} onDragLeave={e => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)} onDrop={onDrop}>
            <div className="bcol-h">
              <StatusIcon status={s.id} />
              <span>{s.name}</span>
              <span className="cnt">{col.length}</span>
              <span className="acts">
                <Tooltip content="Add task">
                  <button className="ibtn ibtn-xs" aria-label={`Add task to ${s.name}`} onClick={() => setComposer(s.id)}>
                    <Plus size={14} />
                  </button>
                </Tooltip>
                <Menu>
                  <MenuTrigger asChild>
                    <button className="ibtn ibtn-xs" aria-label="Column options">
                      <Ellipsis size={14} />
                    </button>
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuLabel>{s.name}</MenuLabel>
                    <MenuItem icon={<Plus size={15} />} onSelect={() => setComposer(s.id)}>
                      Add task
                    </MenuItem>
                    <MenuItem icon={<FoldHorizontal size={15} />} onSelect={() => setCollapsed(c => ({ ...c, [s.id]: true }))}>
                      Collapse column
                    </MenuItem>
                    {doneAll ? (
                      <MenuItem
                        icon={<CheckCheck size={15} />}
                        onSelect={() => {
                          col.forEach(t => patch(t.id, { status: 'done' }));
                          toast(`Marked ${col.length} ${col.length === 1 ? 'task' : 'tasks'} as done`);
                        }}
                      >
                        Mark all as done
                      </MenuItem>
                    ) : (
                      <MenuItem
                        icon={<Archive size={15} />}
                        onSelect={() => {
                          col.forEach(t => patch(t.id, { archived: true }));
                          toast(`Archived ${col.length} completed ${col.length === 1 ? 'task' : 'tasks'}`);
                        }}
                      >
                        Archive completed
                      </MenuItem>
                    )}
                    <MenuItem
                      icon={<ArrowDownWideNarrow size={15} />}
                      onSelect={() => {
                        // Раздаём прежние значения order в порядке приоритета
                        const orders = col.map(t => t.order).sort((a, b) => a - b);
                        sortTasks(col, 'priority').forEach((t, i) => patch(t.id, { order: orders[i] }));
                      }}
                    >
                      Sort by priority
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </span>
            </div>
            <div className="bcol-b">
              {addRow}
              {col.map(t => (
                <React.Fragment key={t.id}>
                  {over && drop?.before === t.id && line}
                  <KCard
                    task={t}
                    showProject={!project}
                    showSubtasks={showSubtasks}
                    dragging={dragId === t.id}
                    onDragStart={e => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', t.id);
                      // Класс .dragging ставим после старта, иначе браузер снимет «призрак» уже полупрозрачным
                      setTimeout(() => setDragId(t.id), 0);
                    }}
                    onDragEnd={clearDrag}
                  />
                </React.Fragment>
              ))}
              {over && drop?.before === null && line}
            </div>
          </section>
        );
      })}
    </div>
  );
}
