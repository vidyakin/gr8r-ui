/* Доска задач по статусам — порт boardHtml / kcard из views/board.js и drag-and-drop карточек из actions/drag-drop.js.
   Используется на странице Tasks и (позже) на странице проекта. Перетаскивание — нативный HTML5 DnD. */
import * as React from 'react';
import { ArrowDownWideNarrow, Check, CheckCheck, Archive, ChevronDown, FoldHorizontal, ListChecks, MessageSquare, Paperclip, Pencil, Plus, Repeat, RotateCcw, Ellipsis, Trash2, X } from 'lucide-react';
import { Button, Checkbox, ConfirmDialog, IconButton, Input, Label, Menu, Segmented, Switch, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Progress, Tooltip, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { StatusIcon, type Status } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { useWorkspace, type TaskPatch } from '../data/store';
import { newStatusKey } from '../lib/uuid';
import { countSubs } from '../data/subtasks';
import { LABELS, STATUS_PALETTE, statusName, commentsOf, fmtHours, planOfTask, project as findProject, sortTasks } from '../data/selectors';
import type { StatusDef, Subtask, Task } from '../data/types';
import { clipWords, htmlToText } from '../lib/text';
import { useTaskDrawer, useTaskForm } from '../overlays';
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
  /** Full — обычные карточки, Compact — заголовок и план в часах */
  density?: BoardDensity;
}

export type BoardDensity = 'full' | 'compact';

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

const DENSITY_KEY = 'gr8r-ui.board-density';

/** Режим Full / Compact — общий для всех досок, запоминается между заходами */
export function useBoardDensity() {
  const [d, setD] = React.useState<BoardDensity>(() => {
    try {
      return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'full';
    } catch {
      return 'full';
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(DENSITY_KEY, d);
    } catch {
      /* хранилище недоступно */
    }
  }, [d]);
  return [d, setD] as const;
}

/** Параметры доски для слота extra тулбара: Full | Compact и «Show subtasks» */
export function BoardOptions({ density, onDensity, showSubtasks, onShowSubtasks }: { density: BoardDensity; onDensity: (d: BoardDensity) => void; showSubtasks: boolean; onShowSubtasks: (on: boolean) => void }) {
  const t = useT();
  return (
    <>
      <Segmented
        aria-label={t('views.board.density')}
        value={density}
        onValueChange={onDensity}
        items={[
          { value: 'full', label: t('views.board.densityFull') },
          { value: 'compact', label: t('views.board.densityCompact') },
        ]}
      />
      <ShowSubtasksSwitch checked={showSubtasks} onChange={onShowSubtasks} />
    </>
  );
}

/** Переключатель «Show subtasks» для тулбара доски */
export function ShowSubtasksSwitch({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  const t = useT();
  return (
    <label className="row cursor-pointer" style={{ fontSize: 12.5, color: 'var(--text-2)', gap: 6, whiteSpace: 'nowrap' }}>
      <Switch checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="hide-m">{t('views.board.showSubtasks')}</span>
      <span className="only-m">{t('views.board.subtasksShort')}</span>
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
  const form = useTaskForm();
  const tt = useT();
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
          <span className="done-ic" aria-label={tt('views.board.doneAria')}>
            <StatusIcon status="done" />
          </span>
        )}
        <div className="title">{t.title}</div>
      </div>
      {st > 0 && (
        <>
          <div className="subp">
            <button className="subt-tg" aria-expanded={open} aria-label={open ? tt('views.task.subtasksHide') : tt('views.task.subtasksShow')} onClick={e => (e.stopPropagation(), setOpen(o => !o))}>
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
          <Tooltip content={tt('views.task.repeatsLabel', { what: t.recur.toLowerCase() })}>
            <span className="m">
              <Repeat size={12} />
            </span>
          </Tooltip>
        )}
        {!!cc && (
          <span className="m" aria-label={tt('views.task.comments', { n: cc })}>
            <MessageSquare size={12} />
            {cc}
          </span>
        )}
        {!!ac && (
          <span className="m" aria-label={tt('views.task.attachments', { n: ac })}>
            <Paperclip size={12} />
            {ac}
          </span>
        )}
        <AssigneeField task={t} variant="icon" />
      </div>
      <div className="hacts" onClick={e => e.stopPropagation()}>
        <Tooltip content={done ? tt('views.task.reopen') : tt('views.task.markComplete')}>
          <button className="ibtn ibtn-xs" aria-label={done ? tt('views.task.reopen') : tt('views.task.markComplete')} onClick={() => actions.toggleDone(t)}>
            {done ? <RotateCcw size={13} /> : <Check size={13} />}
          </button>
        </Tooltip>
        <Tooltip content={tt('views.task.quickEdit')}>
          <button className="ibtn ibtn-xs" aria-label={tt('views.task.quickEdit')} onClick={() => form.edit(t.id)}>
            <Pencil size={12} />
          </button>
        </Tooltip>
        <RowMenu task={t} xs />
      </div>
    </div>
  );
}

/** Компактная карточка: заголовок (до 2 строк) и план в часах; описание — в подсказке */
function KCardCompact({ task: t, showSubtasks, dragging, onDragStart, onDragEnd }: { task: Task; showSubtasks: boolean; dragging: boolean; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void }) {
  const actions = useTaskActions();
  const tt = useT();
  const plan = planOfTask(t);
  const { done: sd, total: st } = countSubs(t.subtasks);
  // Своё состояние карточки; общий переключатель перезаписывает его у всех карточек
  const [open, setOpen] = React.useState(showSubtasks);
  React.useEffect(() => setOpen(showSubtasks), [showSubtasks]);
  const desc = React.useMemo(() => clipWords(htmlToText(t.desc), 500), [t.desc]);
  return (
    <Tooltip
      side="right"
      className="tip-rich"
      content={
        <>
          <b>{t.title}</b>
          {desc && <span>{desc}</span>}
        </>
      }
    >
      <div
        className={cn('kcard compact', t.status === 'done' && 'done', dragging && 'dragging')}
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
        <div className="crow">
          <div className="title">{t.title}</div>
          {st > 0 && (
            <button className="subt-tg" aria-expanded={open} aria-label={open ? tt('views.task.subtasksHide') : tt('views.task.subtasksShow')} onClick={e => (e.stopPropagation(), setOpen(o => !o))}>
              <ChevronDown size={11} className="chev" />
              <span className="num">
                {sd}/{st}
              </span>
            </button>
          )}
          {plan > 0 && <span className="plan num">{fmtHours(plan)}</span>}
          {t.priority != null && <PriorityField task={t} variant="icon" />}
          {t.assignee && <AssigneeField task={t} variant="icon" />}
        </div>
        {!!t.labels.length && (
          <div className="labels">
            {t.labels.map(id => (
              <Label key={id} color={LABELS[id].c}>
                {LABELS[id].name}
              </Label>
            ))}
          </div>
        )}
        {st > 0 && (
          <div className={cn('ksubs', open && 'open')} inert={!open} onClick={e => e.stopPropagation()}>
            <div className="ksubs-in">
              <KSubTree task={t} list={t.subtasks} />
            </div>
          </div>
        )}
      </div>
    </Tooltip>
  );
}

/** Поле названия колонки в шапке: Enter/кнопка — сохранить, Esc/крестик — отмена. Пустое и повторяющееся имя не сохраняется */
function ColumnNameField({ initial = '', statuses, selfId, onSave, onCancel }: { initial?: string; statuses: StatusDef[]; selfId?: string; onSave: (name: string) => void; onCancel: () => void }) {
  const tt = useT();
  const [v, setV] = React.useState(initial);
  const [err, setErr] = React.useState('');
  const save = () => {
    const name = v.trim();
    if (!name) return setErr(tt('views.board.errEmptyName'));
    if (statuses.some(s => s.id !== selfId && s.name.toLowerCase() === name.toLowerCase())) return setErr(tt('views.board.errDupName'));
    onSave(name);
  };
  return (
    <>
      <div className="bcol-h editing">
        <Input
          autoFocus
          size="sm"
          className="bcol-name"
          value={v}
          maxLength={40}
          placeholder={tt('views.board.columnPlaceholder')}
          aria-label={tt('views.board.columnPlaceholder')}
          invalid={!!err}
          onFocus={e => e.currentTarget.select()}
          onChange={e => (setV(e.target.value), setErr(''))}
          onKeyDown={e => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <IconButton size="sm" label={tt('views.board.saveColumn')} onClick={save}>
          <Check size={14} />
        </IconButton>
        <IconButton size="sm" label={tt('views.board.cancelColumn')} onClick={onCancel}>
          <X size={14} />
        </IconButton>
      </div>
      {err && (
        <div className="err bcol-err" role="alert">
          {err}
        </div>
      )}
    </>
  );
}

/** Поле быстрого добавления в колонке: Enter — создать, Esc — отмена */
function Composer({ onSubmit, onCancel }: { onSubmit: (title: string) => void; onCancel: () => void }) {
  const tt = useT();
  const [v, setV] = React.useState('');
  const submit = () => (v.trim() ? onSubmit(v.trim()) : onCancel());
  return (
    <div className="composer">
      <textarea
        autoFocus
        rows={2}
        value={v}
        placeholder={tt('views.board.taskName')}
        aria-label={tt('views.board.newTask')}
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
          {tt('views.board.enterAddEscCancel')}
        </span>
        <span className="sp" />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {tt('views.board.cancel')}
        </Button>
        <Button size="sm" variant="primary" onClick={submit}>
          {tt('views.board.add')}
        </Button>
      </div>
    </div>
  );
}

export function BoardView({ tasks, defaultProject, project, showSubtasks = false, density = 'full' }: BoardViewProps) {
  const { data, dispatch } = useWorkspace();
  const statuses = data.statuses;
  const compact = density === 'compact';
  // Новая колонка (поле имени справа), переименование и удаление пользовательских колонок
  const [adding, setAdding] = React.useState(false);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<StatusDef | null>(null);
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
  // Во время перетаскивания подсказки компактных карточек скрыты
  React.useEffect(() => {
    document.body.classList.toggle('card-dragging', !!dragId);
    return () => document.body.classList.remove('card-dragging');
  }, [dragId]);

  const tt = useT();
  const addColumn = (name: string) => {
    const n = statuses.filter(s => !s.builtin).length;
    dispatch({ type: 'status/add', status: { id: newStatusKey(), name, color: STATUS_PALETTE[n % STATUS_PALETTE.length] } });
    setAdding(false);
  };
  const deleteColumn = (s: StatusDef) => {
    const snap = data;
    dispatch({ type: 'status/delete', id: s.id });
    toast(tt('views.board.deletedColumn', { name: s.name }), { action: { label: tt('views.board.undo'), onClick: () => dispatch({ type: 'data/restore', data: snap }) } });
  };
  const inColumn = (id: string) => data.tasks.filter(t => t.status === id).length;

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
    if (moved) toast(tt('views.board.movedTo', { title: t.title, status: statusName(statuses.find(s => s.id === col) ?? { id: col, name: '' }) }), { duration: 2200 });
  };

  // Новая задача встаёт в начало колонки
  const addTask = (status: Status, title: string) => {
    const top = Math.min(0, ...tasks.filter(t => t.status === status).map(t => t.order));
    dispatch({ type: 'task/create', task: { title, project: project ?? defaultProject, status, order: top - 1 } });
  };

  const dragProps = (t: Task) => ({
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
      // Класс .dragging ставим после старта, иначе браузер снимет «призрак» уже полупрозрачным
      setTimeout(() => setDragId(t.id), 0);
    },
    onDragEnd: clearDrag,
  });

  return (
    <div className="board">
      {statuses.map(s => {
        const col = tasks.filter(t => t.status === s.id).sort((a, b) => a.order - b.order);
        const over = drop?.col === s.id;
        if (collapsed[s.id])
          return (
            <div
              key={s.id}
              className={cn('bcol collapsed', over && 'over')}
              role="button"
              tabIndex={0}
              aria-label={tt('views.board.expandColumn', { name: statusName(s) })}
              title={tt('views.board.expand')}
              onClick={() => setCollapsed(c => ({ ...c, [s.id]: false }))}
              onKeyDown={e => e.key === 'Enter' && setCollapsed(c => ({ ...c, [s.id]: false }))}
              onDragOver={e => onDragOver(e, s.id)}
              onDrop={onDrop}
            >
              <StatusIcon status={s.id} />
              <span className="vname">
                {statusName(s)}
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
              {tt('views.board.addCard')}
            </button>
          );
        const doneAll = s.id !== 'done';
        return (
          <section key={s.id} className={cn('bcol', over && 'over')} aria-label={statusName(s)} onDragOver={e => onDragOver(e, s.id)} onDragLeave={e => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)} onDrop={onDrop}>
            {renaming === s.id ? (
              <ColumnNameField
                initial={s.name}
                statuses={statuses}
                selfId={s.id}
                onCancel={() => setRenaming(null)}
                onSave={name => {
                  dispatch({ type: 'status/rename', id: s.id, name });
                  setRenaming(null);
                }}
              />
            ) : (
            <div className="bcol-h">
              <StatusIcon status={s.id} />
              <span className="trunc">{statusName(s)}</span>
              <span className="cnt">{col.length}</span>
              <span className="acts">
                <Tooltip content={tt('views.board.addCard')}>
                  <button className="ibtn ibtn-xs" aria-label={tt('views.board.addColumnTo', { name: statusName(s) })} onClick={() => setComposer(s.id)}>
                    <Plus size={14} />
                  </button>
                </Tooltip>
                <Menu>
                  <MenuTrigger asChild>
                    <button className="ibtn ibtn-xs" aria-label={tt('views.board.columnOptions')}>
                      <Ellipsis size={14} />
                    </button>
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuLabel>{statusName(s)}</MenuLabel>
                    <MenuItem icon={<Plus size={15} />} onSelect={() => setComposer(s.id)}>
                      {tt('views.board.addCard')}
                    </MenuItem>
                    <MenuItem icon={<FoldHorizontal size={15} />} onSelect={() => setCollapsed(c => ({ ...c, [s.id]: true }))}>
                      {tt('views.board.collapseColumn')}
                    </MenuItem>
                    {doneAll ? (
                      <MenuItem
                        icon={<CheckCheck size={15} />}
                        onSelect={() => {
                          col.forEach(t => patch(t.id, { status: 'done' }));
                          toast(tt('views.board.markedDone', { count: col.length }));
                        }}
                      >
                        {tt('views.board.markAllDone')}
                      </MenuItem>
                    ) : (
                      <MenuItem
                        icon={<Archive size={15} />}
                        onSelect={() => {
                          col.forEach(t => patch(t.id, { archived: true }));
                          toast(tt('views.board.archivedCompleted', { count: col.length }));
                        }}
                      >
                        {tt('views.board.archiveCompleted')}
                      </MenuItem>
                    )}
                    <MenuItem
                      icon={<ArrowDownWideNarrow size={15} />}
                      onSelect={() => {
                        const orders = col.map(t => t.order).sort((a, b) => a - b);
                        sortTasks(col, 'priority').forEach((t, i) => patch(t.id, { order: orders[i] }));
                      }}
                    >
                      {tt('views.board.sortByPriority')}
                    </MenuItem>
                    {!s.builtin && (
                      <>
                        <MenuSeparator />
                        <MenuItem icon={<Pencil size={15} />} onSelect={() => setRenaming(s.id)}>
                          {tt('views.board.rename')}
                        </MenuItem>
                        <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => (inColumn(s.id) ? setDeleting(s) : deleteColumn(s))}>
                          {tt('views.board.deleteColumn')}
                        </MenuItem>
                      </>
                    )}
                  </MenuContent>
                </Menu>
              </span>
            </div>
            )}
            <div className="bcol-b">
              {addRow}
              {col.map(t => (
                <React.Fragment key={t.id}>
                  {over && drop?.before === t.id && line}
                  {compact ? <KCardCompact task={t} showSubtasks={showSubtasks} dragging={dragId === t.id} {...dragProps(t)} /> : <KCard task={t} showProject={!project} showSubtasks={showSubtasks} dragging={dragId === t.id} {...dragProps(t)} />}
                </React.Fragment>
              ))}
              {over && drop?.before === null && line}
            </div>
          </section>
        );
      })}
      {adding ? (
        <section className="bcol bcol-new" aria-label={tt('views.board.newColumn')}>
          <ColumnNameField statuses={statuses} onCancel={() => setAdding(false)} onSave={addColumn} />
          <div className="bcol-b" />
        </section>
      ) : (
        <Tooltip content={tt('views.board.addColumn')}>
          <button className="bcol-add" aria-label={tt('views.board.addColumn')} onClick={() => setAdding(true)}>
            <Plus size={16} />
          </button>
        </Tooltip>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={o => !o && setDeleting(null)}
        danger
        title={tt('views.board.deleteColumnTitle', { name: deleting?.name ?? '' })}
        description={deleting && tt('views.board.tasksWillMove', { count: inColumn(deleting.id) })}
        confirmLabel={tt('views.board.deleteColumn')}
        cancelLabel={tt('views.board.cancelColumn')}
        onConfirm={() => deleting && deleteColumn(deleting)}
      />
    </div>
  );
}
