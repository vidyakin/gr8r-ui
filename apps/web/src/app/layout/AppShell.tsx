/* Каркас приложения — порт renderShell() из shell/layout.js.
   В отличие от оригинала, React перерисовывает только изменившиеся части,
   поэтому фокус и прокрутка сохраняются сами, без ручного восстановления. */
import * as React from 'react';
import { NavLink, useLocation, useMatches, type RouteObject } from 'react-router';
import { Ellipsis } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { SECTIONS, type SectionId } from '../routes';
import { Sidebar } from './Sidebar';
import { SidePanel, SidePanelProvider, useSidePanelState } from './SidePanel';
import { Topbar, useCrumbs } from './Topbar';
import { PageTabs, usePageTabs } from './PageTabs';
import { TabPages } from './TabPages';
import { OverlayProviders, PaletteHost, TaskWindowsHost } from '../overlays';
import { CrmOverlays } from '../crm/overlays';
import { useSectionAccess } from '../positions/access';
import { LicenseBanner } from '../licensing/LicenseBanner';
import { t } from '@/i18n';
import { identifyUser, trackPageview } from '@/lib/analytics';
import { useSession } from '../data/session';

const COLLAPSED_KEY = 'gr8r-ui.sidebar-collapsed';

function BottomNav({ onMore }: { onMore: () => void }) {
  const { data } = useWorkspace();
  const unread = data.notifs.some(n => !n.read && n.type !== 'update');
  const access = useSectionAccess();
  return (
    <nav className="bottomnav" aria-label={t('nav.primary')}>
      {(['home', 'mytasks', 'projects', 'inbox'] as SectionId[]).filter(id => access.id(id)).map(id => {
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
        <span>{t('nav.more')}</span>
      </button>
    </nav>
  );
}

export function AppShell({ pages }: { pages: RouteObject[] }) {
  const { data } = useWorkspace();
  const location = useLocation();
  // Вкладки проекта не пересоздают страницу: фильтры вида живут, пока открыт тот же проект (как S.views в оригинале)
  // Маршрут может задать свой ключ (handle.pageKey): список с боковой карточкой по адресу не пересоздаётся при её открытии
  const routeKey = (useMatches().at(-1)?.handle as { pageKey?: string } | undefined)?.pageKey;
  const pageKey = routeKey ?? location.pathname.replace(/^(\/projects\/[^/]+)\/.*$/, '$1').replace(/^(\/settings)\/.*$/, '$1');
  const crumbs = useCrumbs();
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mnav, setMnav] = React.useState(false);
  const panel = useSidePanelState();

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
  // закрытое мобильное меню в следующий раз открывается с основного списка, а не со второй панели
  const { back } = panel;
  React.useEffect(() => {
    if (!mnav) back();
  }, [mnav, back]);
  // Аналитика (docs/architecture/analytics.md): без ID сайта оба вызова — no-op. identify раньше просмотра: он ставит в очередь первым
  const session = useSession();
  const analyticsUser = session.user?.id;
  const analyticsWs = session.active?.id;
  const analyticsRole = session.active?.role;
  React.useEffect(() => {
    if (analyticsUser) identifyUser({ userId: analyticsUser, workspaceId: analyticsWs, role: analyticsRole });
  }, [analyticsUser, analyticsWs, analyticsRole]);
  React.useEffect(() => trackPageview(location.pathname), [location.pathname]);
  const tabs = usePageTabs({ ws: analyticsWs ?? '', pageKey, title: crumbs.at(-1)?.label ?? '' });
  const title = `${crumbs.map(c => c.label).join(' · ')} · ${data.ws.name}`;
  React.useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <OverlayProviders>
    <CrmOverlays>
    <SidePanelProvider value={panel}>
    <div className={cn('shell', collapsed && 'collapsed', mnav && 'mnav', panel.open && panel.id && 'panel-open', panel.drill && 'drill')}>
      <button className="skip" onClick={() => document.getElementById('main-content')?.focus()}>
        {t('nav.skipToContent')}
      </button>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <SidePanel />
      {mnav && <div className="side-scrim" onClick={() => setMnav(false)} />}
      <main className="main" id="main">
        <Topbar onOpenNav={() => setMnav(true)} />
        <PageTabs state={tabs} />
        <LicenseBanner />
        {/* Каждая открытая вкладка — своя страница со своим адресом; живые скрыты в <Activity> */}
        <TabPages pages={pages} tabs={tabs.tabs} activeKey={tabs.activeKey} recent={tabs.recent} />
      </main>
      <BottomNav onMore={() => setMnav(true)} />
      <TaskWindowsHost />
    </div>
    </SidePanelProvider>
    <PaletteHost />
    </CrmOverlays>
    </OverlayProviders>
  );
}
