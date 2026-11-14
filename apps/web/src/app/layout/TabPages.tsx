/* Содержимое вкладок (как KeepAlive во Vue): каждая живая вкладка рисуется в своём <Activity>, активная — visible,
   остальные — hidden. Скрытая страница сохраняет состояние, прокрутку и DOM, но её эффекты сняты: нет подписок,
   горячих клавиш, таймеров, а запросы TanStack Query без наблюдателей доживают до gcTime (30 минут, main.tsx).
   Страница вкладки видит свой адрес: маршруты рисуются через useRoutes с собственной локацией (активная — живая
   локация роутера, скрытая — сохранённый адрес вкладки), поэтому useParams, useLocation, useSearchParams работают как обычно.
   Живыми остаются KEEP_ALIVE последних активных вкладок; маршрут с handle.keepAlive: false выгружается сразу при уходе. */
import * as React from 'react';
import { Outlet, UNSAFE_RouteContext, matchRoutes, parsePath, useLocation, useRoutes, type Location, type RouteObject } from 'react-router';
import { PageBoundary } from '../components/error-states';
import { SectionGuard } from '../positions/access';
import type { PageTab } from './PageTabs';

/** Сколько вкладок держать живыми, вместе с активной */
export const KEEP_ALIVE = 5;

/** Можно ли держать страницу адреса живой в фоне (handle.keepAlive у самого вложенного маршрута) */
export function keepsAlive(pages: RouteObject[], url: string): boolean {
  const leaf = matchRoutes(pages, url)?.at(-1)?.route.handle as { keepAlive?: boolean } | undefined;
  return leaf?.keepAlive !== false;
}

/** Ключи вкладок, которые рисуются: активная и последние активные из recent, всего не больше KEEP_ALIVE */
export function aliveKeys(tabs: PageTab[], activeKey: string, recent: string[], canKeep: (url: string) => boolean): string[] {
  const byKey = new Map(tabs.map(x => [x.key, x]));
  const out = [activeKey];
  for (const k of recent) {
    if (out.length >= KEEP_ALIVE) break;
    const tab = byKey.get(k);
    if (k !== activeKey && tab && canKeep(tab.url)) out.push(k);
  }
  return out;
}

// Корень маршрутов вкладки: без него useRoutes считал бы себя вложенным в оболочку
const ROOT_CONTEXT = { outlet: null, matches: [], isDataRoute: false };

function Frame() {
  const { pathname } = useLocation();
  return (
    <PageBoundary resetKey={pathname}>
      <SectionGuard>
        <Outlet />
      </SectionGuard>
    </PageBoundary>
  );
}

function Routes({ routes, location }: { routes: RouteObject[]; location: Partial<Location> }) {
  return useRoutes(routes, location);
}

const TabPage = React.memo(function TabPage({ routes, url, active }: { routes: RouteObject[]; url: string; active: boolean }) {
  const live = useLocation();
  const own = React.useMemo(() => ({ ...parsePath(url), hash: '', state: null, key: 'tab' }), [url]);
  const ref = React.useRef<HTMLDivElement>(null);
  const scroll = React.useRef(0);
  // При показе возвращаем прокрутку: layout-эффекты Activity пересоздаёт при каждом показе
  React.useLayoutEffect(() => {
    if (active && ref.current && scroll.current) ref.current.scrollTop = scroll.current;
  }, [active]);
  return (
    <div
      ref={ref}
      className="content fx-route"
      id={active ? 'main-content' : undefined}
      tabIndex={-1}
      onScroll={e => {
        if (active) scroll.current = e.currentTarget.scrollTop;
      }}
    >
      <UNSAFE_RouteContext.Provider value={ROOT_CONTEXT}>
        <Routes routes={routes} location={active ? live : own} />
      </UNSAFE_RouteContext.Provider>
    </div>
  );
});

export function TabPages({ pages, tabs, activeKey, recent }: { pages: RouteObject[]; tabs: PageTab[]; activeKey: string; recent: string[] }) {
  const { pathname, search } = useLocation();
  const routes = React.useMemo<RouteObject[]>(() => [{ element: <Frame />, children: pages }], [pages]);
  const canKeep = React.useCallback((url: string) => keepsAlive(pages, url), [pages]);
  // Порядок в DOM — по первому появлению вкладки: вставка новой не двигает узлы остальных (иначе сбросится прокрутка)
  const seq = React.useRef(new Map<string, number>());
  const keys = aliveKeys(tabs, activeKey, recent, canKeep);
  for (const k of keys) if (!seq.current.has(k)) seq.current.set(k, seq.current.size);
  keys.sort((a, b) => seq.current.get(a)! - seq.current.get(b)!);
  const urls = new Map(tabs.map(x => [x.key, x.url]));
  return keys.map(k => {
    const active = k === activeKey;
    return (
      <React.Activity key={k} mode={active ? 'visible' : 'hidden'}>
        <TabPage routes={routes} url={active ? pathname + search : urls.get(k)!} active={active} />
      </React.Activity>
    );
  });
}
