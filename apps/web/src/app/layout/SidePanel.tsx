/* Вторая левая панель — общий контейнер рядом с сайдбаром. Содержимое выбирается по id из реестра PANELS:
   сейчас это подпункты групп меню (group:<id>), позже — фильтры, избранное и т. п.
   Состояние (открыта ли и что показывает) запоминается в браузере и следует за адресом. */
import * as React from 'react';
import { NavLink, useLocation } from 'react-router';
import { ArrowLeft, X } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useSectionAccess } from '../positions/access';
import { NAV_GROUPS, SECTIONS, navGroupOf, type NavGroupId, type NavGroupItem } from '../routes';
import { t, useT } from '@/i18n';

const PANEL_KEY = 'gr8r-ui.side-panel';
/** ширина, на которой сайдбар — выезжающее меню (styles/app.css) */
const MOBILE = '(max-width: 900px)';

export const groupPanelId = (id: NavGroupId) => `group:${id}`;
const panelGroup = (pid: string | null) => (pid?.startsWith('group:') ? (pid.slice(6) as NavGroupId) : null);

interface PanelDef {
  title: () => string;
  render: () => React.ReactNode;
}

/** Подпункты группы. end — у пункта, под путём которого лежат другие пункты (/production и /production/orders) */
function GroupItems({ id }: { id: NavGroupId }) {
  const access = useSectionAccess();
  const items: NavGroupItem[] = NAV_GROUPS[id].items.filter(it => access.id(it.id)); // скрытые должностями разделы не показываем
  return (
    <>
      {items.map(it => {
        const s = SECTIONS[it.id];
        const end = items.some(o => SECTIONS[o.id].path.startsWith(s.path + '/'));
        return (
          <NavLink key={it.id} to={s.path} end={end} className={({ isActive }) => cn('sitem', isActive && 'on')}>
            <s.icon size={16} />
            <span className="trunc">{it.label ? t(it.label) : s.name}</span>
          </NavLink>
        );
      })}
    </>
  );
}

const PANELS: Record<string, PanelDef> = Object.fromEntries(
  (Object.keys(NAV_GROUPS) as NavGroupId[]).map(id => [groupPanelId(id), { title: () => t(`nav.groups.${id}`), render: () => <GroupItems id={id} /> }]),
);

interface Stored {
  id: string | null;
  open: boolean;
}

function load(): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(PANEL_KEY) ?? 'null') as Stored | null;
    if (v && (v.id === null || v.id in PANELS)) return { id: v.id, open: !!v.open && !!v.id };
  } catch {
    /* хранилище недоступно или испорчено */
  }
  return { id: null, open: false };
}

export interface SidePanelApi {
  /** что показывает панель (и покажет при открытии) */
  id: string | null;
  open: boolean;
  /** группа меню текущего адреса — для подсветки строки группы в сайдбаре */
  routeGroup: NavGroupId | null;
  /** телефон: панель показана поверх мобильного меню (не запоминается, сбрасывается при закрытии меню) */
  drill: boolean;
  toggle: (id: string) => void;
  close: () => void;
  back: () => void;
}

const Ctx = React.createContext<SidePanelApi | null>(null);
export const SidePanelProvider = Ctx.Provider;

export function useSidePanel() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('useSidePanel вне AppShell');
  return v;
}

/** Состояние панели — держит AppShell и раздаёт через SidePanelProvider */
export function useSidePanelState(): SidePanelApi {
  const { pathname } = useLocation();
  const [st, setSt] = React.useState(load);
  const [drill, setDrill] = React.useState(false);
  const routeGroup = navGroupOf(pathname, panelGroup(st.id));

  React.useEffect(() => {
    try {
      localStorage.setItem(PANEL_KEY, JSON.stringify(st));
    } catch {
      /* хранилище недоступно */
    }
  }, [st]);

  // Переход в раздел другой группы переключает панель на неё (если панель показывает группу, а не другое содержимое)
  React.useEffect(() => {
    if (!routeGroup) return;
    setSt(s => (s.id !== null && !panelGroup(s.id)) || s.id === groupPanelId(routeGroup) ? s : { ...s, id: groupPanelId(routeGroup) });
  }, [pathname, routeGroup]);

  const toggle = React.useCallback((id: string) => {
    // на телефоне строка группы всегда открывает панель поверх меню, запомненное «открыто» для десктопа не сбрасывает
    if (matchMedia(MOBILE).matches) {
      setSt({ id, open: true });
      setDrill(true);
    } else setSt(s => (s.open && s.id === id ? { ...s, open: false } : { id, open: true }));
  }, []);
  const close = React.useCallback(() => setSt(s => ({ ...s, open: false })), []);
  const back = React.useCallback(() => setDrill(false), []);
  return React.useMemo(() => ({ ...st, routeGroup, drill, toggle, close, back }), [st, routeGroup, drill, toggle, close, back]);
}

/** Сам контейнер: заголовок, кнопка закрытия и содержимое из реестра. Не модальный: фокус не удерживается,
    Esc внутри панели закрывает её и возвращает фокус туда, откуда панель открыли. */
export function SidePanel() {
  const { id, open, close, back } = useSidePanel();
  const tr = useT();
  const ref = React.useRef<HTMLElement>(null);
  const returnTo = React.useRef<HTMLElement | null>(null);
  const def = id ? PANELS[id] : undefined;

  // При открытии (или смене содержимого) фокус переходит в панель: следующий Tab попадёт на её первый пункт
  React.useEffect(() => {
    if (!open) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && !ref.current?.contains(active)) returnTo.current = active;
    if (active?.closest('[data-side-panel-trigger]')) ref.current?.focus({ preventScroll: true });
  }, [open, id]);

  const dismiss = () => {
    close();
    const back = returnTo.current;
    if (back?.isConnected) back.focus();
  };

  return (
    <aside
      ref={ref}
      id="side-panel"
      className={cn('side2', open && def && 'open')}
      aria-label={def?.title()}
      tabIndex={-1}
      inert={!open || !def}
      onKeyDown={e => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        // не даём AppShell закрыть заодно мобильное меню
        e.stopPropagation();
        dismiss();
      }}
    >
      {def && (
        <div className="side2-in">
          <div className="side2-h">
            <IconButton size="sm" className="side2-back" label={tr('nav.panel.back')} onClick={back}>
              <ArrowLeft size={15} />
            </IconButton>
            <span className="side2-title trunc">{def.title()}</span>
            <span className="sp" />
            <IconButton size="sm" className="side2-x" label={tr('nav.panel.close')} onClick={dismiss}>
              <X size={15} />
            </IconButton>
          </div>
          <div className="side2-scroll">{def.render()}</div>
        </div>
      )}
    </aside>
  );
}
