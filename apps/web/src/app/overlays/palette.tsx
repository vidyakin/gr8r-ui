/* Палитра команд и поиск — порт overlays/palette.js (commands, paletteItems, paletteHtml), горячих клавиш из actions/keyboard.js
   и действий openPalette/openSearch/palRun из actions/actions.js.
   Провайдер хранит «открыта ли палитра» и ловит горячие клавиши; само окно (PaletteHost) монтируется в AppShell
   внутри CrmOverlays — ему нужны действия CRM (карточки сделок и контактов). */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Dialog as D } from 'radix-ui';
import {
  Building2,
  Calendar,
  ChartGantt,
  CircleCheck,
  ClockAlert,
  Command,
  ContactRound,
  Folder,
  FolderKanban,
  FolderPlus,
  Handshake,
  History,
  House,
  Inbox,
  Keyboard,
  Layers,
  LogOut,
  MessageSquare,
  Moon,
  PanelLeft,
  Palette,
  Paperclip,
  Plus,
  Search,
  SearchX,
  Settings,
  SignalHigh,
  Sun,
  User,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState, toast, usePrefs } from '@/components/ui';
import { StatusIcon } from '@/components/gr8r/task';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { tOEnum } from './enums';
import { useWorkspace } from '../data/store';
import { PROJECT_STATUS, allTasks, project, sortTasks, task as findTask } from '../data/selectors';
import { addRecentSearch, searchAll, useCatalogHits, useDocumentHits, useRecentSearches, useRecordHits, type SearchCat } from '../data/search';
import { STATUS_LABEL, typeLabel } from '../docs/data';
import { money as fmtMoney } from '../catalog/data';
import { entityIcon } from '../meta/icons';
import { SECTIONS, type SectionId } from '../routes';
import { MOD } from '../lib/platform';
import { Logo } from '../components/brand';
import { Highlight } from '../components/highlight';
import { KindIcon } from '../components/files-view';
import { ProjectDot } from '../components/project';
import { MemberAvatar } from '../components/workspace';
import { CrmUiCtx } from '../crm/ui-context';
import { useCrm } from '../crm/store';
import { money } from '../crm/format';
import { company as crmCompany } from '../crm/selectors';
import { useInvite } from './invite';
import { useSectionAccess } from '../positions/access';
import { useProjectForms } from './project-forms';
import { useShortcuts } from './shortcuts';
import { useSession } from '../data/session';
import { useTaskDrawer } from './task-drawer';
import { useTaskForm } from './task-form';

export interface PaletteApi {
  /** Открыть палитру команд; query подставляется в поле ввода */
  open(query?: string): void;
  /** Открыть сразу в режиме поиска («/» в оригинале) */
  openSearch(): void;
  close(): void;
}

type Mode = 'cmd' | 'search';
interface PaletteState {
  open: boolean;
  mode: Mode;
  q: string;
  /** Меняется при каждом открытии — сбрасывает внутреннее состояние окна */
  nonce: number;
}

const Ctx = React.createContext<PaletteApi | null>(null);
const StateCtx = React.createContext<{ st: PaletteState; close(): void } | null>(null);

/** Переходы «G, затем буква» (map из actions/keyboard.js) */
const GO_KEYS: Record<string, SectionId> = {
  h: 'home',
  t: 'mytasks',
  p: 'projects',
  i: 'inbox',
  c: 'calendar',
  s: 'settings',
  n: 'notifications',
  a: 'activity',
  m: 'members',
};

const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');

/** Тёмная ли тема сейчас (effectiveDark из core/theme.js) */
function useIsDark() {
  const { prefs } = usePrefs();
  return prefs.theme === 'dark' || (prefs.theme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
}

function useToggleDark() {
  const { setPrefs } = usePrefs();
  const t = useT();
  const dark = useIsDark();
  return React.useCallback(() => {
    setPrefs({ theme: dark ? 'light' : 'dark' });
    toast.info(t(dark ? 'overlays.palette.toast.lightOn' : 'overlays.palette.toast.darkOn'), { duration: 1800 });
  }, [dark, setPrefs, t]);
}

/** Сворачивание сайдбара живёт в AppShell и слушает «[» — отправляем ему эту клавишу */
const toggleSidebar = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const taskForm = useTaskForm();
  const projectForms = useProjectForms();
  const toggleDark = useToggleDark();
  const shortcuts = useShortcuts();
  const [st, setSt] = React.useState<PaletteState>({ open: false, mode: 'cmd', q: '', nonce: 0 });

  const open = React.useCallback((query = '', mode: Mode = 'cmd') => setSt(s => ({ open: true, mode, q: query, nonce: s.nonce + 1 })), []);
  const close = React.useCallback(() => setSt(s => ({ ...s, open: false })), []);
  const api = React.useMemo<PaletteApi>(() => ({ open: q => open(q), openSearch: () => open('', 'search'), close }), [open, close]);
  const state = React.useMemo(() => ({ st, close }), [st, close]);

  // Свежие значения для обработчика клавиш, чтобы не переподписываться на каждое изменение
  const latest = React.useRef({ st, taskForm, projectForms, toggleDark, shortcuts });
  latest.current = { st, taskForm, projectForms, toggleDark, shortcuts };
  const gPending = React.useRef(0);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { st, taskForm, projectForms, toggleDark, shortcuts } = latest.current;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'k') {
        e.preventDefault();
        if (st.open) close();
        else open();
        return;
      }
      if (mod && e.shiftKey && k === 'l') {
        e.preventDefault();
        toggleDark();
        return;
      }
      // Остальные клавиши — только вне полей ввода и поверх «чистой» страницы
      if (st.open || e.defaultPrevented || mod || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('.modal, [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) return;
      if (gPending.current && Date.now() - gPending.current < 1200) {
        gPending.current = 0;
        const id = GO_KEYS[k];
        if (id) {
          e.preventDefault();
          navigate(SECTIONS[id].path);
        }
        return;
      }
      if (k === 'g') gPending.current = Date.now();
      else if (e.key === '/') {
        e.preventDefault();
        open('', 'search');
      } else if (k === 'n') {
        e.preventDefault();
        taskForm.open();
      } else if (k === 'p') {
        e.preventDefault();
        projectForms.create();
      } else if (e.key === '?') {
        e.preventDefault();
        shortcuts.open();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close, navigate]);

  return (
    <Ctx.Provider value={api}>
      <StateCtx.Provider value={state}>{children}</StateCtx.Provider>
    </Ctx.Provider>
  );
}

export function usePalette() {
  const api = React.useContext(Ctx);
  if (!api) throw new Error('usePalette: нет PaletteProvider');
  return api;
}

/* ---------------- элементы списка ---------------- */

interface Item {
  id: string;
  /** Иконка lucide или готовый узел слева */
  icon?: LucideIcon;
  lead?: React.ReactNode;
  name: string;
  sub?: string;
  /** Правый текст (ключ задачи, размер файла) */
  r?: string;
  /** Подсказка клавиш, части через пробел */
  kbd?: string;
  /** Не закрывать палитру после выбора */
  keep?: boolean;
  /** Переход в раздел (не зависит от подписи на языке) */
  nav?: boolean;
  /** Раздел меню: пункт скрыт, если должности участника его не открывают (задача 1172) */
  section?: SectionId;
  /** CRM-разделы показываются только при вводе, чтобы пустая палитра совпадала с оригиналом */
  quiet?: boolean;
  run(): void;
}
interface Group {
  name: string;
  items: Item[];
}

const SCOPES: [SearchCat, LucideIcon][] = [
  ['all', Layers],
  ['tasks', CircleCheck],
  ['projects', Folder],
  ['people', Users],
  ['files', Paperclip],
  ['comments', MessageSquare],
];

/** Окно палитры. Монтируется один раз внутри CrmOverlays */
export function PaletteHost() {
  const ctx = React.useContext(StateCtx);
  if (!ctx) throw new Error('PaletteHost: нет PaletteProvider');
  const { st, close } = ctx;
  return (
    <D.Root open={st.open} onOpenChange={o => !o && close()}>
      {st.open && <PaletteWindow key={st.nonce} init={st} close={close} />}
    </D.Root>
  );
}

function PaletteWindow({ init, close }: { init: PaletteState; close: () => void }) {
  const { data } = useWorkspace();
  const crm = useCrm();
  const crmUi = React.useContext(CrmUiCtx);
  const navigate = useNavigate();
  const session = useSession();
  const taskForm = useTaskForm();
  const projectForms = useProjectForms();
  const invite = useInvite();
  const shortcuts = useShortcuts();
  const drawer = useTaskDrawer();
  const dark = useIsDark();
  const toggleDark = useToggleDark();
  const recent = useRecentSearches();
  const t = useT();
  const access = useSectionAccess();

  const [q, setQ] = React.useState(init.q);
  const recordHits = useRecordHits(q);
  const catalogHits = useCatalogHits(q);
  const docHits = useDocumentHits(q);
  const [mode, setMode] = React.useState<Mode>(init.mode);
  const [scope, setScope] = React.useState<SearchCat>('all');
  const [hl, setHl] = React.useState(0);
  const input = React.useRef<HTMLInputElement>(null);
  // После выбора пункта фокус не возвращаем на открывшую палитру кнопку: он нужен новому окну
  const ran = React.useRef(false);
  // Radix без триггера фокус не возвращает — запоминаем, что было в фокусе при открытии, и возвращаем сами
  const opener = React.useRef(document.activeElement as HTMLElement | null);

  const go = (path: string, state?: unknown) => navigate(path, state ? { state } : undefined);
  const section = (id: SectionId) => () => go(SECTIONS[id].path);

  const allCommands: Item[] = [
    { id: 'c-task', name: t('overlays.palette.cmd.createTask'), icon: Plus, kbd: 'N', run: () => taskForm.open() },
    { id: 'c-proj', name: t('overlays.palette.cmd.createProject'), icon: FolderPlus, kbd: 'P', run: () => projectForms.create() },
    {
      id: 'c-search',
      name: t('overlays.palette.cmd.searchWorkspace'),
      icon: Search,
      kbd: '/',
      keep: true,
      run: () => {
        setQ('');
        setMode('search');
        setScope('all');
        setHl(0);
      },
    },
    { id: 'c-home', name: t('overlays.palette.cmd.goHome'), icon: House, kbd: 'G H', nav: true, section: 'home', run: section('home') },
    { id: 'c-inbox', name: t('overlays.palette.cmd.goInbox'), icon: Inbox, kbd: 'G I', nav: true, section: 'inbox', run: section('inbox') },
    { id: 'c-my', name: t('overlays.palette.cmd.goMyTasks'), icon: CircleCheck, kbd: 'G T', nav: true, section: 'mytasks', run: section('mytasks') },
    { id: 'c-projs', name: t('overlays.palette.cmd.goProjects'), icon: FolderKanban, kbd: 'G P', nav: true, section: 'projects', run: section('projects') },
    { id: 'c-cal', name: t('overlays.palette.cmd.goCalendar'), icon: Calendar, kbd: 'G C', nav: true, section: 'calendar', run: section('calendar') },
    { id: 'c-tl', name: t('overlays.palette.cmd.goTimeline'), icon: ChartGantt, nav: true, section: 'timeline', run: section('timeline') },
    { id: 'c-mem', name: t('overlays.palette.cmd.goMembers'), icon: Users, nav: true, section: 'members', run: section('members') },
    // Разделы CRM (их нет в оригинале)
    { id: 'c-crm', name: t('overlays.palette.cmd.goCrm'), icon: SECTIONS.crm.icon, nav: true, quiet: true, section: 'crm', run: section('crm') },
    { id: 'c-deals', name: t('overlays.palette.cmd.goDeals'), icon: Handshake, nav: true, quiet: true, section: 'crmDeals', run: section('crmDeals') },
    { id: 'c-comps', name: t('overlays.palette.cmd.goCompanies'), icon: Building2, nav: true, quiet: true, section: 'crmCompanies', run: section('crmCompanies') },
    { id: 'c-conts', name: t('overlays.palette.cmd.goContacts'), icon: ContactRound, nav: true, quiet: true, section: 'crmContacts', run: section('crmContacts') },
    { id: 'c-acts', name: t('overlays.palette.cmd.goCrmActivities'), icon: SECTIONS.crmActivities.icon, nav: true, quiet: true, section: 'crmActivities', run: section('crmActivities') },
    { id: 'c-cat', name: t('overlays.palette.cmd.goCatalog'), icon: SECTIONS.catalog.icon, nav: true, quiet: true, section: 'catalog', run: section('catalog') },
    { id: 'c-prod', name: t('overlays.palette.cmd.goProduction'), icon: SECTIONS.production.icon, nav: true, quiet: true, section: 'production', run: section('production') },
    { id: 'c-sales', name: t('overlays.palette.cmd.goSales'), icon: SECTIONS.sales.icon, nav: true, quiet: true, section: 'sales', run: section('sales') },
    { id: 'c-purch', name: t('overlays.palette.cmd.goPurchases'), icon: SECTIONS.purchases.icon, nav: true, quiet: true, section: 'purchases', run: section('purchases') },
    { id: 'c-stock', name: t('overlays.palette.cmd.goInventory'), icon: SECTIONS.inventory.icon, nav: true, quiet: true, section: 'inventory', run: section('inventory') },
    { id: 'c-wc', name: t('overlays.palette.cmd.goWorkCenters'), icon: SECTIONS.workCenters.icon, nav: true, quiet: true, section: 'workCenters', run: section('workCenters') },
    { id: 'c-set', name: t('overlays.palette.cmd.openSettings'), icon: Settings, kbd: 'G S', nav: true, section: 'settings', run: section('settings') },
    { id: 'c-app', name: t('overlays.palette.cmd.appearance'), icon: Palette, run: () => go(`${SECTIONS.settings.path}/appearance`) },
    { id: 'c-dark', name: t(dark ? 'overlays.palette.cmd.darkOn' : 'overlays.palette.cmd.darkOff'), icon: dark ? Sun : Moon, kbd: `${MOD} ⇧ L`, run: toggleDark },
    { id: 'c-inv', name: t('overlays.palette.cmd.inviteMember'), icon: UserPlus, run: () => invite.open() },
    { id: 'c-side', name: t('overlays.palette.cmd.toggleSidebar'), icon: PanelLeft, kbd: '[', run: toggleSidebar },
    { id: 'c-keys', name: t('overlays.palette.cmd.keyboardShortcuts'), icon: Keyboard, kbd: '?', run: () => shortcuts.open() },
    { id: 'c-out', name: t('overlays.palette.cmd.signOut'), icon: LogOut, run: () => void session.signOut().then(() => navigate('/signin')) },
  ];

  const commands = allCommands.filter(c => !c.section || access.id(c.section));
  const query = q.trim();
  const ql = query.toLowerCase();
  const taskItem = (t: (typeof data.tasks)[number]): Item => ({
    id: 't-' + t.id,
    lead: <StatusIcon status={t.status} />,
    name: t.title,
    sub: project(data, t.project)?.name,
    r: t.key,
    run: () => drawer.open(t.id),
  });

  const groups: Group[] = [];
  if (mode === 'cmd') {
    const cmds = commands.filter(c => !query || c.name.toLowerCase().includes(ql));
    if (!query) {
      const visible = commands.filter(c => !c.quiet);
      groups.push({ name: t('overlays.palette.group.suggestions'), items: visible.slice(0, 3).concat(visible.filter(c => c.id === 'c-dark')) });
      const recentTasks = sortTasks(
        allTasks(data).filter(t => t.assignee === data.me || t.fav),
        'updated',
        1,
        data,
      ).slice(0, 4);
      groups.push({ name: t('overlays.palette.group.recentTasks'), items: recentTasks.map(taskItem) });
      groups.push({ name: t('overlays.palette.group.navigation'), items: visible.filter(c => c.nav) });
    } else if (cmds.length) groups.push({ name: t('overlays.palette.group.commands'), items: cmds.slice(0, 5) });
  }
  const sc = mode === 'search' ? scope : 'all';
  if (!(mode === 'cmd' && !query)) {
    const r = searchAll(data, query);
    const lim = sc === 'all' ? 4 : 12;
    if (mode === 'search' && !query) {
      groups.push({
        name: t('overlays.palette.group.recentSearches'),
        items: recent.map(s => ({
          id: 'r-' + s,
          icon: History,
          name: s,
          keep: true,
          run: () => {
            setQ(s);
            setHl(0);
          },
        })),
      });
      groups.push({
        name: t('overlays.palette.group.suggested'),
        items: [
          { id: 's-over', icon: ClockAlert, name: t('overlays.palette.suggested.overdue'), run: () => go(SECTIONS.tasks.path, { filter: 'overdue' }) },
          { id: 's-mine', icon: User, name: t('overlays.palette.suggested.mine'), run: section('mytasks') },
          { id: 's-high', icon: SignalHigh, name: t('overlays.palette.suggested.highPriority'), run: () => go('/projects/p1/v:v1') },
          { id: 's-files', icon: Paperclip, name: t('overlays.palette.suggested.files'), run: () => go('/projects/p1/files') },
        ],
      });
    } else if (query) {
      if (sc === 'all' || sc === 'tasks') groups.push({ name: t('overlays.palette.group.tasks'), items: r.tasks.slice(0, lim).map(taskItem) });
      if (sc === 'all' || sc === 'projects')
        groups.push({
          name: t('overlays.palette.group.projects'),
          items: r.projects.slice(0, lim).map(p => ({ id: 'p-' + p.id, lead: <ProjectDot project={p} />, name: p.name, sub: PROJECT_STATUS[p.status].name, run: () => go(`/projects/${p.id}`) })),
        });
      if (sc === 'all' || sc === 'people')
        groups.push({
          name: t('overlays.palette.group.people'),
          items: r.people.slice(0, lim).map(m => ({ id: 'm-' + m.id, lead: <MemberAvatar id={m.id} size="sm" tooltip={false} />, name: m.name, sub: m.title, run: () => go(`${SECTIONS.members.path}/${m.id}`) })),
        });
      if (sc === 'all' || sc === 'files')
        groups.push({
          name: t('overlays.palette.group.files'),
          items: r.files.slice(0, lim).map(f => ({ id: 'f-' + f.id, lead: <KindIcon kind={f.type} size={15} />, name: f.name, sub: project(data, f.project)?.name, r: f.size, run: () => go(`/projects/${f.project}/files`) })),
        });
      if (sc === 'all' || sc === 'comments')
        groups.push({
          name: t('overlays.palette.group.comments'),
          items: r.comments.slice(0, lim).map(c => ({
            id: 'cm-' + c.id,
            lead: <MemberAvatar id={c.by} size="sm" tooltip={false} />,
            name: c.text,
            sub: t('overlays.palette.commentSub', { title: findTask(data, c.task)?.title ?? '' }),
            run: () => drawer.open(c.task),
          })),
        });
      // Записи своих сущностей (конструктор): по группе на сущность
      if (sc === 'all')
        for (const key of [...new Set(recordHits.map(h => h.entityKey))]) {
          const hs = recordHits.filter(h => h.entityKey === key);
          groups.push({ name: hs[0]!.entityName, items: hs.slice(0, lim).map(h => ({ id: 'rec-' + h.id, icon: entityIcon(h.icon), name: h.title || t('overlays.palette.untitled'), sub: h.entityName, run: () => go(`/data/${h.entityKey}/${h.id}`) })) });
        }
      // Каталог и производство: товары, услуги, изделия и полуфабрикаты
      if (sc === 'all') {
        if (catalogHits.products.length && access.section('catalog'))
          groups.push({
            name: t('overlays.palette.group.products'),
            items: catalogHits.products.slice(0, lim).map(p => ({ id: 'pr-' + p.id, icon: p.kind === 'service' ? SECTIONS.workCenters.icon : SECTIONS.catalog.icon, name: p.name, sub: p.sku || t(p.kind === 'service' ? 'overlays.palette.productSub.service' : 'overlays.palette.productSub.goods'), run: () => go(`${SECTIONS.catalog.path}/${p.id}`) })),
          });
        if (catalogHits.items.length && access.section('production'))
          groups.push({
            name: t('overlays.palette.group.production'),
            items: catalogHits.items.slice(0, lim).map(i => ({ id: 'pi-' + i.id, icon: SECTIONS.production.icon, name: i.name, sub: t(i.kind === 'semi' ? 'overlays.palette.productionSub.semi' : 'overlays.palette.productionSub.product'), run: () => go(`${SECTIONS.production.path}/${i.id}`) })),
          });
      }
      // Документы продаж и закупок: находятся по номеру («СЧ-2026-00012», «00012»), контрагенту и комментарию
      if (sc === 'all' && docHits.length)
        groups.push({
          name: t('overlays.palette.group.documents'),
          items: docHits.slice(0, lim).map(d => ({ id: 'doc-' + d.id, icon: SECTIONS.sales.icon, name: `${tOEnum('documentType', d.type, typeLabel(d.type))} ${d.number ?? `(${t('overlays.palette.draftNumber')})`}`, sub: `${d.counterpartyName ?? t('overlays.palette.noCounterparty')} · ${tOEnum('documentStatus', d.status, STATUS_LABEL[d.status])}`, r: fmtMoney(d.total), run: () => go(`/documents/${d.id}`) })),
        });
      // CRM — только в общем поиске, после основных групп
      if (sc === 'all' && crmUi && access.section('crm')) {
        const has = (s: string) => s.toLowerCase().includes(ql);
        groups.push({
          name: t('overlays.palette.group.deals'),
          items: crm.data.deals
            .filter(d => has(d.name))
            .slice(0, lim)
            .map(d => ({ id: 'd-' + d.id, icon: Handshake, name: d.name, sub: crmCompany(crm.data, d.company)?.name, r: money(d.amount), run: () => crmUi.openDeal(d.id) })),
        });
        groups.push({
          name: t('overlays.palette.group.companies'),
          items: crm.data.companies
            .filter(c => has(c.name) || has(c.industry))
            .slice(0, lim)
            .map(c => ({ id: 'co-' + c.id, icon: Building2, name: c.name, sub: c.industry, run: () => go(`${SECTIONS.crmCompanies.path}/${c.id}`) })),
        });
        groups.push({
          name: t('overlays.palette.group.contacts'),
          items: crm.data.contacts
            .filter(c => has(c.name) || has(c.email))
            .slice(0, lim)
            .map(c => ({ id: 'ct-' + c.id, icon: ContactRound, name: c.name, sub: c.title, run: () => crmUi.openContact(c.id) })),
        });
      }
    }
  }
  let shown = query ? groups.filter(g => g.items.length) : groups;
  if (query)
    // «View all results» — отдельная группа без заголовка, есть при любом непустом запросе, как в оригинале
    shown = shown.concat({
      name: '',
      items: [
        {
          id: 'all',
          icon: Search,
          name: t('overlays.palette.viewAll', { query }),
          run: () => {
            addRecentSearch(query);
            go(`${SECTIONS.search.path}?q=${encodeURIComponent(query)}&cat=${sc}`);
          },
        },
      ],
    });

  const flat = shown.flatMap(g => g.items);
  const cur = Math.min(hl, Math.max(flat.length - 1, 0));
  React.useEffect(() => {
    document.getElementById('pi-' + cur)?.scrollIntoView({ block: 'nearest' });
  }, [cur]);

  const run = (it?: Item) => {
    if (!it) return;
    if (it.keep) return it.run();
    ran.current = true;
    close();
    it.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = flat.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHl((cur + (e.key === 'ArrowDown' ? 1 : -1) + Math.max(n, 1)) % Math.max(n, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(flat[cur]);
    } else if (e.key === 'Tab') {
      // Tab переключает режимы, фокус остаётся в поле
      e.preventDefault();
      setMode(m => (m === 'cmd' ? 'search' : 'cmd'));
      setHl(0);
    } else if (e.key === 'Backspace' && !q && mode !== 'cmd') {
      e.preventDefault();
      setMode('cmd');
    }
  };

  const ph = mode === 'search' ? t('overlays.palette.placeholder.search') : t('overlays.palette.placeholder.cmd');
  let idx = 0;
  return (
    <D.Portal>
      <D.Overlay className="scrim" style={{ zIndex: 89 }} />
      <D.Content
        className="palette"
        aria-label={t('overlays.palette.title')}
        aria-describedby={undefined}
        onOpenAutoFocus={e => {
          e.preventDefault();
          input.current?.focus();
        }}
        onCloseAutoFocus={e => {
          e.preventDefault();
          const o = opener.current;
          if (!ran.current && o?.isConnected && o !== document.body) o.focus();
        }}
        onKeyDown={onKeyDown}
      >
        <D.Title className="sr-only">{t('overlays.palette.title')}</D.Title>
        <div className="pal-in">
          {mode === 'search' ? <Search size={17} /> : <Command size={17} />}
          {mode !== 'cmd' && (
            <span className="badge" style={{ flexShrink: 0 }}>
              {t('overlays.palette.badge')}
            </span>
          )}
          <input
            ref={input}
            id="pal-in"
            value={q}
            placeholder={ph}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-activedescendant={`pi-${cur}`}
            onChange={e => {
              setQ(e.target.value);
              setHl(0);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        {mode === 'search' && (
          <div className="pal-scope" role="tablist">
            {SCOPES.map(([k, Icon]) => (
              <button
                key={k}
                role="tab"
                aria-selected={scope === k}
                className={cn(scope === k && 'on')}
                onClick={() => {
                  setScope(k);
                  setHl(0);
                  input.current?.focus();
                }}
              >
                <Icon size={12} />
                {t(`overlays.palette.scope.${k}`)}
              </button>
            ))}
          </div>
        )}
        <div className="pal-list" id="pal-list" role="listbox">
          {flat.length ? (
            shown.map((g, gi) => (
              <div className="pal-group" key={gi}>
                {g.name && <div className="pal-sec">{g.name}</div>}
                {g.items.map(it => {
                  const i = idx++;
                  const Icon = it.icon;
                  return (
                    <div
                      key={it.id}
                      className={cn('pi', i === cur && 'hl')}
                      id={`pi-${i}`}
                      role="option"
                      aria-selected={i === cur}
                      onClick={() => run(it)}
                      onMouseMove={() => i !== cur && setHl(i)}
                    >
                      {it.lead ?? (Icon && <Icon size={15} />)}
                      <span className="trunc">
                        <Highlight text={it.name} q={query} />
                      </span>
                      {it.sub && <span className="sub">{it.sub}</span>}
                      <span className="r">
                        {it.r && <span className="mono">{it.r}</span>}
                        {it.kbd?.split(' ').map((k, ki) => <kbd key={ki}>{k}</kbd>)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            <EmptyState size="sm" icon={<SearchX size={18} />} title={t('overlays.palette.emptyTitle')}>
              {t('overlays.palette.emptyText')}
            </EmptyState>
          )}
        </div>
        <div className="pal-f">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            {t('overlays.palette.footer.navigate')}
          </span>
          <span>
            <kbd>↵</kbd>
            {t('overlays.palette.footer.select')}
          </span>
          {mode === 'cmd' ? (
            <span>
              <kbd>Tab</kbd>
              {t('overlays.palette.footer.searchMode')}
            </span>
          ) : (
            <span>
              <kbd>⌫</kbd>
              {t('overlays.palette.footer.backToCommands')}
            </span>
          )}
          <span className="sp" style={{ flex: 1 }} />
          <span>
            <Logo height={12} />
          </span>
        </div>
      </D.Content>
    </D.Portal>
  );
}
