/* Меню задачи — порт ctxMenu('task') из overlays/context-menu.js и действий openTask/dupTask/archiveTask/delTask/copyLink из actions/actions.js.
   Одни и те же пункты показываются в «⋯» карточки и в контекстном меню (правый клик по строке/карточке). */
import * as React from 'react';
import { Archive, Check, CircleCheck, CircleDot, Copy, FolderInput, Link2, PanelRightOpen, Pencil, PictureInPicture2, RotateCcw, SignalHigh, Star, Trash2, User } from 'lucide-react';
import { ContextMenuItem, ContextMenuSeparator, MenuItem, MenuSeparator, toast, useMenuClose } from '@/components/ui';
import { StatusIcon } from '@/components/gr8r/task';
import { PriorityPanel } from '../priority-panel';
import { useT } from '@/i18n';
import { useWorkspace, type TaskPatch } from '../../data/store';
import { canSee, projectColor, statusName } from '../../data/selectors';
import type { Task } from '../../data/types';
import { MemberAvatar, useTaskActions } from '../workspace';

/** Действия, которым нужны диалоги и состояние провайдера карточки */
export interface TaskCommands {
  open(t: Task): void;
  edit(t: Task): void;
  askDelete(t: Task): void;
  archive(t: Task): void;
  duplicate(t: Task): void;
  copyLink(t: Task): void;
  /** Открыть задачу в плавающем окне */
  openWindow(t: Task): void;
}

export const TaskCommandsCtx = React.createContext<TaskCommands | null>(null);
export function useTaskCommands() {
  const c = React.useContext(TaskCommandsCtx);
  if (!c) throw new Error('useTaskCommands: нет TaskDrawerProvider');
  return c;
}

type View = 'root' | 'status' | 'assignee' | 'priority' | 'project';

/** Пункты меню; «Status…», «Assign to…», «Priority…», «Move to project…» заменяют содержимое меню списком выбора (ctxTo) */
export function TaskMenuItems({ task: t, context, hideOpen, hideWindow }: { task: Task; context?: boolean; hideOpen?: boolean; hideWindow?: boolean }) {
  const tt = useT();
  const { data, dispatch } = useWorkspace();
  const cmd = useTaskCommands();
  const closeMenu = useMenuClose();
  const actions = useTaskActions();
  const [view, setView] = React.useState<View>('root');
  const marker = React.useRef<HTMLSpanElement>(null);
  const Item = context ? ContextMenuItem : MenuItem;
  const Sep = context ? ContextMenuSeparator : MenuSeparator;
  const update = (patch: TaskPatch) => dispatch({ type: 'task/update', id: t.id, patch });
  const keep = (v: View) => (e: Event) => {
    e.preventDefault();
    setView(v);
  };
  // После замены содержимого фокус переносится на первый пункт нового списка
  React.useEffect(() => {
    if (view === 'root') return;
    const menu = marker.current?.closest('[role="menu"]');
    (menu?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus({ preventScroll: true });
  }, [view]);
  const ck = (on: boolean) =>
    on ? (
      <span className="ck">
        <Check size={14} />
      </span>
    ) : null;

  if (view !== 'root')
    return (
      <>
        <span ref={marker} hidden />
        {view === 'status' &&
          data.statuses.map((s, i) => (
            <Item key={s.id} icon={<StatusIcon status={s.id} />} shortcut={i < 9 ? String(i + 1) : undefined} onSelect={() => update({ status: s.id })}>
              {statusName(s)}
              {ck(t.status === s.id)}
            </Item>
          ))}
        {view === 'priority' && (
          <PriorityPanel
            value={t.priority}
            task={t}
            onChange={priority => update({ priority })}
            onClose={closeMenu}
          />
        )}
        {view === 'assignee' && (
          <>
            <Item icon={<MemberAvatar id={null} size="sm" tooltip={false} />} onSelect={() => update({ assignee: null })}>
              {tt('views.taskMenu.unassigned')}
              {ck(!t.assignee)}
            </Item>
            {data.members.map(m => (
              <Item key={m.id} icon={<MemberAvatar id={m.id} size="sm" tooltip={false} />} onSelect={() => update({ assignee: m.id })}>
                {m.name + (m.id === data.me ? tt('views.activity.you') : '')}
                {ck(t.assignee === m.id)}
              </Item>
            ))}
          </>
        )}
        {view === 'project' &&
          data.projects
            .filter(p => !p.archived && canSee(data, p) && p.status !== 'complete')
            .map(p => (
              <Item key={p.id} icon={<span className="pdot" style={{ '--c': projectColor(p) } as React.CSSProperties} />} onSelect={() => update({ project: p.id })}>
                {p.name}
                {ck(t.project === p.id)}
              </Item>
            ))}
      </>
    );

  const done = t.status === 'done';
  return (
    <>
      {!hideOpen && (
        <Item icon={<PanelRightOpen size={15} />} onSelect={() => cmd.open(t)}>
          {tt('views.taskMenu.open')}
        </Item>
      )}
      {!hideWindow && (
        <Item icon={<PictureInPicture2 size={15} />} onSelect={() => cmd.openWindow(t)}>
          {tt('views.taskMenu.openInWindow')}
        </Item>
      )}
      <Item icon={<Pencil size={15} />} shortcut="E" onSelect={() => cmd.edit(t)}>
        {tt('views.taskMenu.edit')}
      </Item>
      <Item icon={done ? <RotateCcw size={15} /> : <CircleCheck size={15} />} onSelect={() => actions.toggleDone(t)}>
        {done ? tt('views.taskMenu.reopen') : tt('views.taskMenu.markComplete')}
      </Item>
      <Sep />
      <Item icon={<CircleDot size={15} />} onSelect={keep('status')}>
        {tt('views.taskMenu.status')}
      </Item>
      <Item icon={<User size={15} />} onSelect={keep('assignee')}>
        {tt('views.taskMenu.assignTo')}
      </Item>
      <Item icon={<SignalHigh size={15} />} onSelect={keep('priority')}>
        {tt('views.taskMenu.priority')}
      </Item>
      <Item icon={<FolderInput size={15} />} onSelect={keep('project')}>
        {tt('views.taskMenu.moveToProject')}
      </Item>
      <Sep />
      <Item icon={<Star size={15} />} onSelect={() => actions.toggleFav(t)}>
        {t.fav ? tt('views.taskMenu.removeFromFavorites') : tt('views.taskMenu.addToFavorites')}
      </Item>
      <Item icon={<Link2 size={15} />} onSelect={() => cmd.copyLink(t)}>
        {tt('views.taskMenu.copyLink')}
      </Item>
      <Item icon={<Copy size={15} />} onSelect={() => cmd.duplicate(t)}>
        {tt('views.taskMenu.duplicate')}
      </Item>
      <Item icon={<Archive size={15} />} onSelect={() => cmd.archive(t)}>
        {tt('views.taskMenu.archive')}
      </Item>
      <Sep />
      <Item icon={<Trash2 size={15} />} danger shortcut="Del" onSelect={() => cmd.askDelete(t)}>
        {tt('views.taskMenu.delete')}
      </Item>
    </>
  );
}

/** Копирование ссылки на задачу (copy в actions.js) */
export function copyText(text: string, msg = 'Link copied', fallbackMsg = "Copy isn't available here — {text}") {
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .then(() => toast(msg))
    .catch(() => toast.info(fallbackMsg.replace('{text}', text), { duration: 6000 }));
}
