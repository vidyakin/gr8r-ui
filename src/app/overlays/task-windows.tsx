/* Плавающие окна задач и док свёрнутых окон — новый функционал (в оригинале gr8r-studio его нет).
   Провайдер хранит список окон (задача, позиция, размер, свёрнуто ли, порядок) и сохраняет его в localStorage;
   хост (TaskWindowsHost, монтируется в AppShell) рисует окна поверх любой страницы и док свёрнутых окон слева внизу.
   Содержимое окна — та же панель, что и в боковой карточке (components/task-drawer/drawer-panel.tsx, режим inWindow). */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Maximize2, Minus, PanelRightOpen, X } from 'lucide-react';
import { FloatingWindow, IconButton, clampGeometry, toast, type WindowGeometry } from '@/components/ui';
import { StatusIcon } from '@/components/gr8r/task';
import { useWorkspace } from '../data/store';
import { canSee, project as findProject } from '../data/selectors';
import { findSub } from '../data/subtasks';
import { DrawerPanel } from '../components/task-drawer/drawer-panel';
import { PanelSharedCtx, useTaskDrawer } from './task-drawer';

/** Состояние одного окна */
export interface TaskWindow extends WindowGeometry {
  /** Задача (одна задача — одно окно) */
  id: string;
  /** Порядковый номер создания: окна рисуются в этом порядке, чтобы поднятие не пересоздавало DOM */
  c: number;
  /** Номер каскадного смещения — по нему считается положение по умолчанию */
  n: number;
  min: boolean;
  /** Когда свёрнуто (счётчик): в доке самое раннее внизу */
  minAt: number;
  sub: string | null;
  tab: 'comments' | 'activity';
}

export interface TaskWindowsApi {
  /** Открыть задачу окном; если окно уже есть — поднять (и развернуть, если свёрнуто) */
  popOut(taskId: string, subId?: string): void;
  close(taskId: string): void;
  minimize(taskId: string): void;
  restore(taskId: string): void;
  /** Окна в порядке z-order: последнее — сверху */
  list: TaskWindow[];
}

interface Internal extends TaskWindowsApi {
  raise(taskId: string): void;
  patch(taskId: string, p: Partial<TaskWindow>): void;
  /** true один раз после popOut/restore этого окна — тогда ему нужно взять фокус (при восстановлении после перезагрузки фокус не трогаем) */
  takeFocus(taskId: string): boolean;
}

const Ctx = React.createContext<Internal | null>(null);
const KEY = 'gr8r-ui.task-windows';
const CASCADE = 8;

function defaultGeometry(n: number): WindowGeometry {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(520, vw - 32);
  const h = Math.min(640, vh - 96);
  return clampGeometry({ w, h, x: vw - w - 24 - n * 32, y: 64 + n * 32 });
}

function load(): { wins: TaskWindow[]; seq: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || !Array.isArray(raw.wins)) return { wins: [], seq: 0 };
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const wins: TaskWindow[] = raw.wins
      .filter((w: { id?: unknown }) => typeof w?.id === 'string')
      .map((w: Partial<TaskWindow>, i: number) => ({
        id: w.id!,
        c: num(w.c, i),
        n: num(w.n, 0),
        min: !!w.min,
        minAt: num(w.minAt, i),
        x: num(w.x, 0),
        y: num(w.y, 0),
        w: num(w.w, 520),
        h: num(w.h, 640),
        sub: typeof w.sub === 'string' ? w.sub : null,
        tab: w.tab === 'activity' ? 'activity' : 'comments',
      }));
    return { wins, seq: Math.max(num(raw.seq, 0), ...wins.map(w => Math.max(w.c, w.minAt)), 0) };
  } catch {
    return { wins: [], seq: 0 };
  }
}

export function TaskWindowsProvider({ children }: { children: React.ReactNode }) {
  const { data } = useWorkspace();
  const [state, setState] = React.useState(load);
  const dataRef = React.useRef(data);
  dataRef.current = data;
  const focusReq = React.useRef<string | null>(null);
  const { wins } = state;

  // Сохраняем при каждом изменении; без доступа к хранилищу окна просто живут до перезагрузки
  React.useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* хранилище недоступно */
    }
  }, [state]);

  // Удалённые и архивированные задачи выкидываем из списка
  React.useEffect(() => {
    const alive = new Set(data.tasks.filter(t => !t.archived).map(t => t.id));
    setState(s => (s.wins.every(w => alive.has(w.id)) ? s : { ...s, wins: s.wins.filter(w => alive.has(w.id)) }));
  }, [data.tasks]);

  const api = React.useMemo<Internal>(() => {
    const mut = (fn: (s: { wins: TaskWindow[]; seq: number }) => { wins: TaskWindow[]; seq: number }) => setState(fn);
    const upd = (id: string, fn: (w: TaskWindow, seq: number) => Partial<TaskWindow>, top = false) =>
      mut(s => {
        const i = s.wins.findIndex(w => w.id === id);
        if (i < 0) return s;
        const seq = s.seq + 1;
        const next = { ...s.wins[i], ...fn(s.wins[i], seq) };
        const rest = s.wins.filter((_, j) => j !== i);
        return { seq, wins: top ? [...rest, next] : s.wins.map((w, j) => (j === i ? next : w)) };
      });
    return {
      list: wins,
      popOut(taskId, subId) {
        const d = dataRef.current;
        const t = d.tasks.find(x => x.id === taskId);
        if (!t || t.archived) return;
        if (!canSee(d, findProject(d, t.project))) {
          toast.error("You don't have access to that task");
          return;
        }
        focusReq.current = taskId;
        mut(s => {
          const sub = subId && findSub(t.subtasks, subId) ? subId : null;
          const seq = s.seq + 1;
          const old = s.wins.find(w => w.id === taskId);
          if (old) return { seq, wins: [...s.wins.filter(w => w !== old), { ...old, min: false, sub: sub ?? old.sub }] };
          const used = new Set(s.wins.map(w => w.n));
          let n = 0;
          while (used.has(n) && n < CASCADE - 1) n++;
          return { seq, wins: [...s.wins, { id: taskId, c: seq, n, min: false, minAt: 0, sub, tab: 'comments', ...defaultGeometry(n) }] };
        });
      },
      close: id => mut(s => ({ ...s, wins: s.wins.filter(w => w.id !== id) })),
      minimize: id => upd(id, (_, seq) => ({ min: true, minAt: seq })),
      restore: id => {
        focusReq.current = id;
        upd(id, () => ({ min: false }), true);
      },
      takeFocus: id => (focusReq.current === id ? !(focusReq.current = null) : false),
      raise(id) {
        setState(s => (s.wins[s.wins.length - 1]?.id === id ? s : { ...s, wins: [...s.wins.filter(w => w.id !== id), ...s.wins.filter(w => w.id === id)] }));
      },
      patch: (id, p) => upd(id, () => p),
    };
  }, [wins]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useTaskWindows(): TaskWindowsApi {
  const api = React.useContext(Ctx);
  if (!api) throw new Error('useTaskWindows: нет TaskWindowsProvider');
  return api;
}

function useInternal() {
  const api = React.useContext(Ctx);
  if (!api) throw new Error('нет TaskWindowsProvider');
  return api;
}

/** Хост: окна и док. Должен стоять внутри TaskDrawerProvider (берёт у него черновики и загрузки) */
export function TaskWindowsHost() {
  const api = useInternal();
  const { data } = useWorkspace();
  const open = api.list.filter(w => w.min === false);
  const docked = api.list.filter(w => w.min).sort((a, b) => a.minAt - b.minAt);
  const byCreation = [...open].sort((a, b) => a.c - b.c);
  return (
    <>
      {byCreation.length > 0 && (
        <div className="fwin-layer">
          {byCreation.map(w => {
            const t = data.tasks.find(x => x.id === w.id);
            return t ? <TaskWindowView key={w.id} win={w} z={api.list.indexOf(w) + 1} /> : null;
          })}
        </div>
      )}
      {docked.length > 0 && <Dock wins={docked} />}
    </>
  );
}

function TaskWindowView({ win: w, z }: { win: TaskWindow; z: number }) {
  const api = useInternal();
  const shared = React.useContext(PanelSharedCtx)!;
  const drawer = useTaskDrawer();
  const navigate = useNavigate();
  const { data } = useWorkspace();
  const ref = React.useRef<HTMLElement>(null);
  const noRef = React.useRef<HTMLElement>(null);
  const t = data.tasks.find(x => x.id === w.id)!;
  const sub = findSub(t.subtasks, w.sub) ? w.sub : null;

  // При появлении окна (в том числе после разворота) фокус переходит в него
  React.useEffect(() => {
    if (api.takeFocus(w.id)) ref.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const geometry = React.useMemo(() => ({ x: w.x, y: w.y, w: w.w, h: w.h }), [w.x, w.y, w.w, w.h]);
  const onGeometry = React.useCallback((g: WindowGeometry) => api.patch(w.id, g), [api, w.id]);
  const panel = () => {
    drawer.open(w.id, sub ?? undefined);
    api.close(w.id);
  };
  const label = `Task window: ${t.key} ${t.title}`;

  return (
    <FloatingWindow
      ref={ref}
      label={label}
      zIndex={z}
      geometry={geometry}
      onGeometryChange={onGeometry}
      onRaise={() => api.raise(w.id)}
      onReset={() => api.patch(w.id, defaultGeometry(w.n))}
      title={
        <>
          <StatusIcon status={t.status} />
          <span className="mono faint fwin-key">{t.key}</span>
          <span className="fwin-ttl">{t.title}</span>
        </>
      }
      actions={
        <>
          <IconButton size="sm" label="Minimize" onClick={() => api.minimize(w.id)}>
            <Minus size={16} />
          </IconButton>
          <IconButton size="sm" label="Open in panel" onClick={panel}>
            <PanelRightOpen size={15} />
          </IconButton>
          <IconButton size="sm" label="Close" onClick={() => api.close(w.id)}>
            <X size={16} />
          </IconButton>
        </>
      }
    >
      <DrawerPanel
        inWindow
        task={t}
        subId={sub}
        full={false}
        tab={w.tab}
        enter={false}
        draft={shared.drafts[t.id] ?? ''}
        uploads={shared.uploads}
        panelRef={noRef}
        onDraft={v => shared.setDraft(t.id, v)}
        onTab={tab => api.patch(w.id, { tab })}
        onClose={() => api.close(w.id)}
        onToggleFull={() => {}}
        onOpenSub={id => api.patch(w.id, { sub: id })}
        onOpenTask={shared.openTask}
        onProject={p => navigate(`/projects/${p.id}`)}
        onFiles={shared.onFiles}
        onKeyDown={() => {}}
      />
    </FloatingWindow>
  );
}

/** Док: свёрнутые окна стопкой, видны только шапки. Самое раннее свёрнутое — внизу, новые наращивают стопку вверх */
function Dock({ wins }: { wins: TaskWindow[] }) {
  const api = useInternal();
  const { data } = useWorkspace();
  return (
    <nav className="fdock" aria-label="Minimized task windows">
      <ul className="fdock-stack">
        {wins.map(w => {
          const t = data.tasks.find(x => x.id === w.id);
          if (!t) return null;
          return (
            <li key={w.id} className="fdock-i">
              <button type="button" className="fdock-main" aria-label={`Restore window: ${t.key} ${t.title}`} onClick={() => api.restore(w.id)}>
                <StatusIcon status={t.status} />
                <span className="mono faint fwin-key">{t.key}</span>
                <span className="fwin-ttl">{t.title}</span>
              </button>
              <IconButton size="xs" label="Expand window" onClick={() => api.restore(w.id)}>
                <Maximize2 size={13} />
              </IconButton>
              <IconButton size="xs" label="Close window" onClick={() => api.close(w.id)}>
                <X size={14} />
              </IconButton>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
