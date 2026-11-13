/* Вкладки открытых страниц (как в 1С): каждый раздел или карточка, открытые по адресу, копятся вкладкой над содержимым.
   Вкладка — ключ страницы (тот же pageKey, что пересоздаёт .content) и последний адрес в ней; переход внутри страницы
   (вкладка проекта, параметры поиска, боковая карточка списка) обновляет адрес вкладки, а не плодит новые.
   Список хранится в localStorage на воркспейс и восстанавливается после перезагрузки. Отрисовывается только активная
   страница: несохранённый ввод на скрытой вкладке не держится — как и раньше при переходе. */
import * as React from 'react';
import { useLocation, useMatches, useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui';
import { useT } from '@/i18n';
import { SECTIONS, type Section } from '../routes';

export interface PageTab {
  key: string;
  /** Последний адрес во вкладке: путь + параметры */
  url: string;
  title: string;
}

/** Больше вкладок не держим: при переполнении закрывается самая левая неактивная */
export const MAX_TABS = 20;
const STORAGE = 'gr8r-ui.page-tabs.';

function load(ws: string): PageTab[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE + ws) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is PageTab => !!x && typeof x.key === 'string' && typeof x.url === 'string' && typeof x.title === 'string').slice(0, MAX_TABS);
  } catch {
    return [];
  }
}

/** Открыть или обновить вкладку текущей страницы. Новая встаёт справа от активной (prev — ключ прошлой страницы) */
export function upsertTab(tabs: PageTab[], tab: PageTab, prev: string | null): PageTab[] {
  const i = tabs.findIndex(x => x.key === tab.key);
  if (i >= 0) {
    const cur = tabs[i]!;
    if (cur.url === tab.url && cur.title === tab.title) return tabs;
    const next = tabs.slice();
    next[i] = tab;
    return next;
  }
  const at = prev ? tabs.findIndex(x => x.key === prev) : -1;
  const next = tabs.slice();
  next.splice(at >= 0 ? at + 1 : next.length, 0, tab);
  while (next.length > MAX_TABS) {
    const drop = next.findIndex(x => x.key !== tab.key);
    next.splice(drop, 1);
  }
  return next;
}

/** Раздел меню для значка: самый длинный путь, которым начинается адрес */
function sectionOf(pathname: string): Section | undefined {
  let best: Section | undefined;
  for (const s of Object.values(SECTIONS)) {
    const hit = s.path === '/' ? pathname === '/' : pathname === s.path || pathname.startsWith(s.path + '/');
    if (hit && (!best || s.path.length > best.path.length)) best = s;
  }
  return best;
}

export function PageTabs({ ws, pageKey: shellKey, title }: { ws: string; pageKey: string; title: string }) {
  const t = useT();
  const location = useLocation();
  // Подвкладка карточки в адресе (параметр :tab — проект, контрагент, редактор автоматизации) — та же вкладка
  const sub = (useMatches().at(-1)?.params as { tab?: string } | undefined)?.tab;
  const pageKey = sub && shellKey.endsWith('/' + sub) ? shellKey.slice(0, -sub.length - 1) : shellKey;
  const navigate = useNavigate();
  const url = location.pathname + location.search;
  const [tabs, setTabs] = React.useState<PageTab[]>(() => load(ws));
  const loadedWs = React.useRef(ws);
  const prevKey = React.useRef<string | null>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);

  // Смена воркспейса — свой набор вкладок
  if (loadedWs.current !== ws) {
    loadedWs.current = ws;
    prevKey.current = null;
    setTabs(load(ws));
  }

  React.useEffect(() => {
    setTabs(list => upsertTab(list, { key: pageKey, url, title }, prevKey.current));
    prevKey.current = pageKey;
  }, [pageKey, url, title]);

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE + ws, JSON.stringify(tabs));
    } catch {
      /* хранилище недоступно */
    }
  }, [ws, tabs]);

  // Активная вкладка всегда видна в полосе
  React.useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pageKey, tabs.length]);

  const close = (keys: string[]) => {
    const drop = new Set(keys);
    const rest = tabs.filter(x => !drop.has(x.key));
    if (drop.has(pageKey)) {
      // Закрыли активную — переходим на соседа справа, иначе слева; последней не стало — на главную
      const i = tabs.findIndex(x => x.key === pageKey);
      const near = tabs.slice(i + 1).find(x => !drop.has(x.key)) ?? tabs.slice(0, i).reverse().find(x => !drop.has(x.key));
      prevKey.current = null;
      setTabs(rest);
      navigate(near ? near.url : SECTIONS.home.path);
    } else setTabs(rest);
  };

  return (
    <div ref={stripRef} className="ptabs" role="tablist" aria-label={t('nav.tabs.label')}>
      {tabs.map(tab => {
        const on = tab.key === pageKey;
        const Icon = sectionOf(tab.url.split('?')[0]!)?.icon;
        return (
          <ContextMenu key={tab.key}>
            <ContextMenuTrigger asChild>
              <div className={cn('ptab', on && 'on')} title={tab.title}>
                <button
                  role="tab"
                  aria-selected={on}
                  className="ptab-main"
                  onClick={() => !on && navigate(tab.url)}
                  onAuxClick={e => e.button === 1 && close([tab.key])}
                >
                  {Icon && <Icon size={13} className="shrink-0" />}
                  <span className="trunc">{tab.title}</span>
                </button>
                <button className="ptab-x" aria-label={t('nav.tabs.close')} onClick={() => close([tab.key])}>
                  <X size={12} />
                </button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => close([tab.key])}>{t('nav.tabs.close')}</ContextMenuItem>
              <ContextMenuItem disabled={tabs.length < 2} onSelect={() => close(tabs.filter(x => x.key !== tab.key).map(x => x.key))}>
                {t('nav.tabs.closeOthers')}
              </ContextMenuItem>
              <ContextMenuItem
                disabled={tabs.findIndex(x => x.key === tab.key) === tabs.length - 1}
                onSelect={() => close(tabs.slice(tabs.findIndex(x => x.key === tab.key) + 1).map(x => x.key))}
              >
                {t('nav.tabs.closeRight')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => close(tabs.map(x => x.key))}>{t('nav.tabs.closeAll')}</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}
