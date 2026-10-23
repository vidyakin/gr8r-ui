/* Компоненты, которые знают о данных воркспейса: аватар участника, строка задачи, запись активности. */
import { Link } from 'react-router';
import { Avatar, AvatarStack, Checkbox, Tooltip, toast, type AvatarSize } from '@/components/ui';
import { DueDate, PriorityIcon, StatusIcon, priorityName } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { ago, parse, relDate } from '../lib/dates';
import { member, project, statusOf, task as findTask } from '../data/selectors';
import { useWorkspace } from '../data/store';
import type { Activity, Task } from '../data/types';
import { ProjectDot } from './project';
import { useTaskDrawer } from '../overlays';

/** Общие действия над задачей; open открывает карточку задачи (drawer). */
export function useTaskActions() {
  const { data, dispatch } = useWorkspace();
  const drawer = useTaskDrawer();
  const t = useT();
  return {
    toggleDone(tk: Task) {
      const wasDone = tk.status === 'done';
      dispatch({ type: 'task/toggleDone', id: tk.id });
      if (!wasDone) toast(t('views.list.completedTask', { title: tk.title }), { action: { label: t('views.board.undo'), onClick: () => dispatch({ type: 'task/update', id: tk.id, patch: { status: tk.status } }) } });
    },
    toggleFav(tk: Task) {
      dispatch({ type: 'task/update', id: tk.id, patch: { fav: !tk.fav } });
      toast.info(tk.fav ? t('views.list.removedFromFavorites') : t('views.list.addedToFavorites'), { duration: 1800 });
    },
    open(tk: Task) {
      drawer.open(tk.id);
    },
    data,
  };
}

export function MemberAvatar({ id, size = 'default', online, tooltip = true }: { id: string | null | undefined; size?: AvatarSize; online?: boolean; tooltip?: boolean }) {
  const { data } = useWorkspace();
  const m = member(data, id);
  return <Avatar name={m?.name} color={m?.c} size={size} online={online} tooltip={tooltip} />;
}

export function MemberStack({ ids, max = 3, size = 'sm' }: { ids: string[]; max?: number; size?: AvatarSize }) {
  const { data } = useWorkspace();
  const people = ids.flatMap(id => {
    const m = member(data, id);
    return m ? [{ name: m.name, color: m.c }] : [];
  });
  return <AvatarStack people={people} max={max} size={size} />;
}

export function TaskDue({ task, icon = true }: { task: Task; icon?: boolean }) {
  if (!task.due) return null;
  return <DueDate date={parse(task.due)} done={task.status === 'done'} icon={icon} format={relDate} />;
}

/** Компактная строка задачи для дашборда (miniRow из components/task-list.js) */
export function MiniTaskRow({ task: t, showProject = true, showAssignee = true, onOpen }: { task: Task; showProject?: boolean; showAssignee?: boolean; onOpen?: (t: Task) => void }) {
  const { data } = useWorkspace();
  const actions = useTaskActions();
  const tt = useT();
  const p = project(data, t.project);
  const done = t.status === 'done';
  const st = statusOf(data, t.status) ?? { name: t.status };
  return (
    <div
      className={cn('mini', done && 'done')}
      data-ctx="task"
      data-id={t.id}
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(t)}
      onKeyDown={e => {
        if (e.target === e.currentTarget && e.key === 'Enter') onOpen?.(t);
      }}
    >
      <Checkbox round checked={done} onChange={() => actions.toggleDone(t)} onClick={e => e.stopPropagation()} aria-label={tt('views.task.markComplete')} />
      <Tooltip content={st.name}>
        <span>
          <StatusIcon status={t.status} />
        </span>
      </Tooltip>
      <span className="tt">{t.title}</span>
      {showProject && p && (
        <span className="pj hide-m">
          <ProjectDot project={p} />
          <span className="trunc">{p.name}</span>
        </span>
      )}
      {t.priority != null && (
        <Tooltip content={priorityName(t.priority)}>
          <span>
            <PriorityIcon priority={t.priority} />
          </span>
        </Tooltip>
      )}
      <span className="hide-m" style={{ width: 74, textAlign: 'right' }}>
        <TaskDue task={t} icon={false} />
      </span>
      {showAssignee && <MemberAvatar id={t.assignee} size="sm" />}
    </div>
  );
}

/** Запись ленты активности (actHtml) */
export function ActivityItem({ a, showProject }: { a: Activity; showProject?: boolean }) {
  const { data } = useWorkspace();
  const m = member(data, a.by);
  const t = findTask(data, a.task);
  const p = project(data, a.project);
  const { open } = useTaskActions();
  const tt = useT();
  return (
    <div className="fitem">
      <MemberAvatar id={a.by} size="sm" />
      <div className="min-w-0 flex-1">
        <b>{m?.id === data.me ? tt('views.activity.you') : m?.name || 'Someone'}</b> <span className="muted">{a.verb}</span>{' '}
        {t ? (
          <span className="obj" role="button" tabIndex={0} onClick={() => open(t)} onKeyDown={e => e.key === 'Enter' && open(t)}>
            {t.title}
          </span>
        ) : p ? (
          <Link className="obj" to={`/projects/${p.id}`}>
            {p.name}
          </Link>
        ) : null}{' '}
        {a.extra && <span className="muted">{a.extra}</span>}
        {showProject && p && t && <span className="faint"> in {p.name}</span>}
      </div>
      <time>{ago(a.at)}</time>
    </div>
  );
}
