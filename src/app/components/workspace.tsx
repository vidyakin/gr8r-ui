/* Компоненты, которые знают о данных воркспейса: аватар участника, строка задачи, запись активности. */
import { Link } from 'react-router';
import { Avatar, AvatarStack, Checkbox, Tooltip, toast, type AvatarSize } from '@/components/ui';
import { DueDate, PRIORITIES, PriorityIcon, STATUSES, StatusIcon } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { ago, parse, relDate } from '../lib/dates';
import { member, project, task as findTask } from '../data/selectors';
import { useWorkspace } from '../data/store';
import type { Activity, Task } from '../data/types';
import { ProjectDot } from './project';
import { useTaskDrawer } from '../overlays';

/** Общие действия над задачей; open открывает карточку задачи (drawer). */
export function useTaskActions() {
  const { data, dispatch } = useWorkspace();
  const drawer = useTaskDrawer();
  return {
    toggleDone(t: Task) {
      const wasDone = t.status === 'done';
      dispatch({ type: 'task/toggleDone', id: t.id });
      if (!wasDone) toast(`Completed “${t.title}”`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'task/update', id: t.id, patch: { status: t.status } }) } });
    },
    toggleFav(t: Task) {
      dispatch({ type: 'task/update', id: t.id, patch: { fav: !t.fav } });
      toast.info(t.fav ? 'Removed from favorites' : 'Added to favorites', { duration: 1800 });
    },
    open(t: Task) {
      drawer.open(t.id);
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
  const p = project(data, t.project);
  const done = t.status === 'done';
  const st = STATUSES.find(s => s.id === t.status)!;
  const pr = PRIORITIES.find(x => x.id === t.priority)!;
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
      <Checkbox round checked={done} onChange={() => actions.toggleDone(t)} onClick={e => e.stopPropagation()} aria-label={`Complete ${t.title}`} />
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
      <Tooltip content={`${pr.name} priority`}>
        <span>
          <PriorityIcon priority={t.priority} />
        </span>
      </Tooltip>
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
  return (
    <div className="fitem">
      <MemberAvatar id={a.by} size="sm" />
      <div className="min-w-0 flex-1">
        <b>{m?.id === data.me ? 'You' : m?.name || 'Someone'}</b> <span className="muted">{a.verb}</span>{' '}
        {t ? <span className="obj">{t.title}</span> : p ? (
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
