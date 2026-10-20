/* Карточка задачи (drawer) — порт overlays/drawer.js (renderLayer, drawerHtml), features/subtasks.js и действий openTask/closeDrawer/delTask/archiveTask/dupTask.
   Провайдер хранит, какая задача открыта (и подзадача, полноэкранный режим, вкладку), черновики комментариев и загрузки;
   сама панель — components/task-drawer/drawer-panel.tsx. Здесь же контекстное меню задачи (правый клик по [data-ctx="task"]). */
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ConfirmDialog, ContextMenu, ContextMenuContent, ContextMenuTrigger, toast } from '@/components/ui';
import { newId, useWorkspace } from '../data/store';
import { canSee, project as findProject } from '../data/selectors';
import { fileSize } from '../data/selectors';
import { countSubs, findSub } from '../data/subtasks';
import type { Task } from '../data/types';
import { DrawerPanel, type UploadItem } from '../components/task-drawer/drawer-panel';
import { TaskCommandsCtx, TaskMenuItems, copyText, type TaskCommands } from '../components/task-drawer/task-menu';

export interface TaskDrawerApi {
  /** Открыть карточку задачи; subId — сразу открыть подзадачу */
  open(taskId: string, subId?: string): void;
  close(): void;
}

const Ctx = React.createContext<TaskDrawerApi | null>(null);
/** Мост к форме редактирования: форма лежит ниже по дереву и записывает сюда свой edit(), а «Edit» / клавиша E в карточке его вызывают */
export const TaskEditorCtx = React.createContext<React.RefObject<((taskId: string) => void) | null> | null>(null);

interface DrawerState {
  taskId: string;
  subId: string | null;
  full: boolean;
  tab: 'comments' | 'activity';
  /** Анимация появления — только при первом показе задачи */
  enter: boolean;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

export function TaskDrawerProvider({ children }: { children: React.ReactNode }) {
  const { data, dispatch } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const [st, setSt] = React.useState<DrawerState | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);
  const [confirm, setConfirm] = React.useState<Task | null>(null);
  const [ctxId, setCtxId] = React.useState<string | null>(null);

  const dataRef = React.useRef(data);
  dataRef.current = data;
  const stRef = React.useRef(st);
  stRef.current = st;
  const editorRef = React.useRef<((taskId: string) => void) | null>(null);
  const panel = React.useRef<HTMLElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  const trig = React.useRef<HTMLSpanElement>(null);
  const timers = React.useRef<number[]>([]);
  React.useEffect(() => () => timers.current.forEach(clearInterval), []);

  const open = React.useCallback((taskId: string, subId?: string) => {
    const d = dataRef.current;
    const t = d.tasks.find(x => x.id === taskId);
    if (!t) return;
    if (!canSee(d, findProject(d, t.project))) {
      toast.error("You don't have access to that task");
      return;
    }
    const prev = stRef.current;
    // Запоминаем, что открыло карточку, чтобы вернуть туда фокус при закрытии
    const a = document.activeElement as HTMLElement | null;
    if (!prev || !a?.closest('.drawer')) opener.current = a && a !== document.body ? a : opener.current;
    setSt({
      taskId,
      subId: subId && findSub(t.subtasks, subId) ? subId : null,
      full: !!prev && prev.taskId === taskId && prev.full,
      tab: prev?.tab ?? 'comments',
      enter: !prev || prev.taskId !== taskId,
    });
  }, []);
  const close = React.useCallback(() => setSt(null), []);
  const api = React.useMemo<TaskDrawerApi>(() => ({ open, close }), [open, close]);

  const task = st ? data.tasks.find(t => t.id === st.taskId) : undefined;
  // Задача удалена или архивирована (в том числе извне) — карточку закрываем
  React.useEffect(() => {
    if (st && (!task || task.archived)) setSt(null);
  }, [st, task]);

  // Анимация входа проигрывается один раз: убираем класс, чтобы переключение режимов её не повторяло
  React.useEffect(() => {
    if (!st?.enter) return;
    const id = window.setTimeout(() => setSt(s => (s ? { ...s, enter: false } : s)), 600);
    return () => clearTimeout(id);
  }, [st?.enter, st?.taskId]);

  // Фокус: в карточку при открытии, назад — при закрытии
  const openId = st?.taskId;
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (openId) {
      wasOpen.current = true;
      const el = panel.current;
      if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    } else if (wasOpen.current) {
      wasOpen.current = false;
      const a = document.activeElement;
      if ((!a || a === document.body) && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    }
  }, [openId]);

  // Вернулись из подзадачи — фокус на её строке в списке (как tryFocus('.drawer .subt [data-sid]') в оригинале)
  const subId = st?.subId ?? null;
  const lastSub = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (subId) lastSub.current = subId;
    else if (lastSub.current) {
      const a = document.activeElement;
      if (!a || a === document.body || a.closest('.drawer')) panel.current?.querySelector<HTMLElement>(`.subt [data-sid="${lastSub.current}"]`)?.focus({ preventScroll: true });
      lastSub.current = null;
    }
  }, [subId]);

  // На узких экранах переход на другую страницу закрывает карточку (go без keepDrawer)
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (window.innerWidth < 900) setSt(null);
  }, [location.pathname]);

  // E при открытой карточке — редактирование задачи (keyboard.js)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stRef.current;
      if (!s || e.key.toLowerCase() !== 'e' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('[role="dialog"]:not(.drawer), [role="menu"]')) return;
      e.preventDefault();
      editorRef.current?.(s.taskId);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Esc: сначала подзадача, затем карточка. Поповеры и диалоги Radix гасят событие сами (defaultPrevented)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stRef.current;
      if (!s || e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (t.closest?.('input, textarea, [contenteditable="true"]')) t.blur();
      if (s.subId) setSt({ ...s, subId: null });
      else setSt(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Контекстное меню задачи: правый клик по строке/карточке с data-ctx="task" (или data-card на доске)
  React.useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('input, textarea, [contenteditable="true"], .drawer')) return;
      const el = t.closest?.('[data-ctx="task"], [data-card]');
      const id = el?.getAttribute('data-id') ?? el?.getAttribute('data-card');
      if (!el || !id || !dataRef.current.tasks.some(x => x.id === id)) return;
      e.preventDefault();
      e.stopPropagation();
      setCtxId(id);
      const { clientX, clientY } = e;
      // Radix открывает меню по событию на своём триггере — подаём его в точке клика
      requestAnimationFrame(() => trig.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY })));
    };
    document.addEventListener('contextmenu', onCtx, true);
    return () => document.removeEventListener('contextmenu', onCtx, true);
  }, []);

  // Загрузка файлов — имитация прогресса, по завершении файл прикрепляется к задаче (handleFiles)
  const onFiles = React.useCallback(
    (files: FileList | null, t: Task) => {
      if (!files || !files.length) return;
      [...files].forEach(file => {
        const up: UploadItem = { id: newId('u'), name: file.name, size: fileSize(file.size), task: t.id, pct: 0 };
        setUploads(u => [...u, up]);
        let pct = 0;
        const iv = window.setInterval(() => {
          pct = Math.min(100, pct + 9 + Math.round(Math.random() * 22));
          if (pct < 100) return setUploads(u => u.map(x => (x.id === up.id ? { ...x, pct } : x)));
          clearInterval(iv);
          setUploads(u => u.filter(x => x.id !== up.id));
          dispatch({ type: 'task/attach', id: t.id, file: { name: up.name, size: up.size } });
          toast(`Uploaded ${up.name}`);
        }, 220);
        timers.current.push(iv);
      });
    },
    [dispatch],
  );

  const commands = React.useMemo<TaskCommands>(
    () => ({
      open: t => open(t.id),
      // Форма редактирования — режим формы задачи (A.editTask)
      edit: t => editorRef.current?.(t.id),
      askDelete: t => setConfirm(t),
      archive: t => {
        const snap = dataRef.current;
        dispatch({ type: 'task/archive', id: t.id });
        toast(`Archived “${t.title}”`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'data/restore', data: snap }) } });
      },
      duplicate: t => {
        const id = newId('t');
        dispatch({ type: 'task/duplicate', id: t.id, newId: id });
        toast('Task duplicated', { action: { label: 'Open', onClick: () => open(id) } });
      },
      copyLink: t => copyText(`https://gr8rstudio.com/${dataRef.current.ws.url}/task/${t.key}`),
    }),
    [open, dispatch],
  );

  const deleteTask = (t: Task) => {
    const snap = dataRef.current;
    dispatch({ type: 'task/delete', ids: [t.id] });
    toast(`Deleted “${t.title}”`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'data/restore', data: snap }) } });
  };

  const ctxTask = ctxId ? data.tasks.find(t => t.id === ctxId) : undefined;
  const nComments = confirm ? data.comments.filter(c => c.task === confirm.id).length : 0;

  // Tab в полноэкранном режиме не уходит за пределы карточки
  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !stRef.current?.full) return;
    const f = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      f[f.length - 1].focus();
    } else if (!e.shiftKey && (i === f.length - 1 || i === -1)) {
      e.preventDefault();
      f[0].focus();
    }
  };

  return (
    <Ctx.Provider value={api}>
      <TaskCommandsCtx.Provider value={commands}>
        <TaskEditorCtx.Provider value={editorRef}>{children}</TaskEditorCtx.Provider>
        {st && task && (
          <>
            {st.full && <div className={`drawer-scrim full${st.enter ? ' enter' : ''}`} onClick={close} />}
            <DrawerPanel
              key={task.id}
              task={task}
              subId={st.subId}
              full={st.full}
              tab={st.tab}
              enter={st.enter}
              draft={drafts[task.id] ?? ''}
              uploads={uploads}
              panelRef={panel}
              onDraft={v => setDrafts(d => ({ ...d, [task.id]: v }))}
              onTab={tab => setSt(s => (s ? { ...s, tab } : s))}
              onClose={close}
              onToggleFull={() => setSt(s => (s ? { ...s, full: !s.full } : s))}
              onOpenSub={subId => setSt(s => (s ? { ...s, subId } : s))}
              onOpenTask={open}
              onProject={p => navigate(`/projects/${p.id}`)}
              onFiles={onFiles}
              onKeyDown={onPanelKey}
            />
          </>
        )}
        <ContextMenu onOpenChange={o => !o && setCtxId(null)}>
          <ContextMenuTrigger asChild>
            <span ref={trig} aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }} />
          </ContextMenuTrigger>
          <ContextMenuContent>{ctxTask && <TaskMenuItems task={ctxTask} context />}</ContextMenuContent>
        </ContextMenu>
        <ConfirmDialog
          open={!!confirm}
          onOpenChange={o => !o && setConfirm(null)}
          danger
          title="Delete task?"
          description={
            confirm && (
              <>
                <b>{confirm.title}</b>
                {confirm.subtasks.length ? `, its ${countSubs(confirm.subtasks).total} subtasks,` : ''} and {nComments} comment{nComments === 1 ? '' : 's'} will be permanently deleted.
              </>
            )
          }
          confirmLabel="Delete task"
          cancelLabel="Cancel"
          onConfirm={() => confirm && deleteTask(confirm)}
        />
      </TaskCommandsCtx.Provider>
    </Ctx.Provider>
  );
}

export function useTaskDrawer() {
  const api = React.useContext(Ctx);
  if (!api) throw new Error('useTaskDrawer: нет TaskDrawerProvider');
  return api;
}
