/* Каркас приложения — порт renderShell() из shell/layout.js.
   В отличие от оригинала, React перерисовывает только изменившиеся части,
   поэтому фокус и прокрутка сохраняются сами, без ручного восстановления. */
import * as React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Ellipsis } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { SECTIONS, type SectionId } from '../routes';
import { Sidebar } from './Sidebar';
import { Topbar, useCrumbs } from './Topbar';
import { OverlayProviders, PaletteHost, TaskWindowsHost } from '../overlays';
import { CrmOverlays } from '../crm/overlays';
import { PageBoundary } from '../components/error-states';

const COLLAPSED_KEY = 'gr8r-ui.sidebar-collapsed';

function BottomNav({ onMore }: { onMore: () => void }) {
  const { data } = useWorkspace();
  const unread = data.notifs.some(n => !n.read && n.type !== 'update');
  return (
    <nav className="bottomnav" aria-label="Primary">
      {(['home', 'mytasks', 'projects', 'inbox'] as SectionId[]).map(id => {
        const s = SECTIONS[id];
        return (
          <NavLink key={id} to={s.path} end={s.path === '/' || s.path === '/projects'} className={({ isActive }) => cn(isActive && 'on')}>
            <s.icon size={19} />
            <span>{s.name}</span>
            {id === 'inbox' && unread && <span className="bdot" />}
          </NavLink>
        );
      })}
      <button onClick={onMore}>
        <Ellipsis size={19} />
        <span>More</span>
      </button>
    </nav>
  );
}

export function AppShell() {
  const { data } = useWorkspace();
  const location = useLocation();
  // Вкладки проекта не пересоздают страницу: фильтры вида живут, пока открыт тот же проект (как S.views в оригинале)
  const pageKey = location.pathname.replace(/^(\/projects\/[^/]+)\/.*$/, '$1').replace(/^(\/settings)\/.*$/, '$1');
  const crumbs = useCrumbs();
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mnav, setMnav] = React.useState(false);

  const toggle = React.useCallback(() => setCollapsed(c => !c), []);
  React.useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* хранилище недоступно */
    }
  }, [collapsed]);

  // «[» сворачивает сайдбар, как в оригинале
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '[' && !e.metaKey && !e.ctrlKey && !t.closest('input, textarea, select, [contenteditable]')) toggle();
      if (e.key === 'Escape') setMnav(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle]);

  // Смена раздела закрывает мобильное меню; прокрутка сбрасывается сама — .content пересоздаётся по key
  React.useEffect(() => setMnav(false), [location.pathname]);
  const title = `${crumbs.map(c => c.label).join(' · ')} · ${data.ws.name}`;
  React.useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <OverlayProviders>
    <CrmOverlays>
    <div className={cn('shell', collapsed && 'collapsed', mnav && 'mnav')}>
      <button className="skip" onClick={() => document.getElementById('main-content')?.focus()}>
        Skip to content
      </button>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      {mnav && <div className="side-scrim" onClick={() => setMnav(false)} />}
      <main className="main" id="main">
        <Topbar onOpenNav={() => setMnav(true)} />
        {/* key перезапускает анимацию появления при смене страницы */}
        <div key={pageKey} className="content fx-route" id="main-content" tabIndex={-1}>
          <PageBoundary resetKey={location.pathname}>
            <Outlet />
          </PageBoundary>
        </div>
      </main>
      <BottomNav onMore={() => setMnav(true)} />
      <TaskWindowsHost />
    </div>
    <PaletteHost />
    </CrmOverlays>
    </OverlayProviders>
  );
}
