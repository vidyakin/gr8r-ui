/* Единый список разделов: из него строятся навигация, хлебные крошки и заголовок вкладки. */
import {
  Activity,
  Archive,
  ArrowLeftRight,
  Bell,
  Building2,
  Calendar,
  CalendarClock,
  ChartGantt,
  ClipboardList,
  ChartNoAxesCombined,
  CircleCheck,
  Component,
  FolderKanban,
  Handshake,
  House,
  Inbox,
  Layers,
  Hammer,
  LayoutDashboard,
  ListChecks,
  PhoneCall,
  Play,
  Search,
  Settings,
  Star,
  Users,
  ContactRound,
  Factory,
  Package,
  PackageSearch,
  Wrench,
  Workflow,
  Boxes,
  PackageCheck,
  Truck,
  ReceiptText,
  Split,
  ShoppingCart,
  CalendarRange,
  CalendarCheck,
  FileSignature,
  Store,
  BriefcaseBusiness,
  Landmark,
  TrendingUp,
  Scale,
  ScanBarcode,
  Target,
  type LucideIcon,
} from 'lucide-react';
import type { PositionSection } from '@gr8r/shared';
import { hasKey, t, type TKey } from '@/i18n';

export interface Section {
  path: string;
  name: string;
  icon: LucideIcon;
}

export const SECTIONS = {
  home: { path: '/', name: 'Home', icon: House },
  inbox: { path: '/inbox', name: 'Inbox', icon: Inbox },
  mytasks: { path: '/my-tasks', name: 'My Tasks', icon: CircleCheck },
  favorites: { path: '/favorites', name: 'Favorites', icon: Star },
  notifications: { path: '/notifications', name: 'Notifications', icon: Bell },
  overview: { path: '/overview', name: 'Overview', icon: LayoutDashboard },
  projects: { path: '/projects', name: 'Projects', icon: FolderKanban },
  tasks: { path: '/tasks', name: 'Tasks', icon: ListChecks },
  calendar: { path: '/calendar', name: 'Calendar', icon: Calendar },
  timeline: { path: '/timeline', name: 'Timeline', icon: ChartGantt },
  members: { path: '/members', name: 'Members', icon: Users },
  activity: { path: '/activity', name: 'Activity', icon: Activity },
  archive: { path: '/archive', name: 'Archive', icon: Archive },
  search: { path: '/search', name: 'Search', icon: Search },
  settings: { path: '/settings', name: 'Settings', icon: Settings },
  system: { path: '/design-system', name: 'Design system', icon: Component },
  // Демо-модуль CRM (src/app/crm)
  crm: { path: '/crm', name: 'Dashboard', icon: ChartNoAxesCombined },
  crmDeals: { path: '/crm/deals', name: 'Deals', icon: Handshake },
  crmCompanies: { path: '/crm/companies', name: 'Companies', icon: Building2 },
  crmContacts: { path: '/crm/contacts', name: 'Contacts', icon: ContactRound },
  crmActivities: { path: '/crm/activities', name: 'Activities', icon: PhoneCall },
  crmSalesPlan: { path: '/crm/sales-plan', name: 'Sales plan', icon: Target },
  crmAppointments: { path: '/crm/appointments', name: 'Appointments', icon: CalendarCheck },
  // Каталог и производство
  catalog: { path: '/catalog', name: 'Catalog', icon: Package },
  production: { path: '/production', name: 'Production', icon: Factory },
  productionOrders: { path: '/production/orders', name: 'Production orders', icon: ClipboardList },
  productionWorkbench: { path: '/production/workbench', name: 'Production release', icon: Play },
  productionNeeds: { path: '/production/needs', name: 'Needs', icon: PackageSearch },
  productionPlans: { path: '/production/plans', name: 'Production plans', icon: CalendarRange },
  productionPlanOrders: { path: '/production/plan-orders', name: 'Orders by plan', icon: ClipboardList },
  productionStages: { path: '/production/stages', name: 'Production stages', icon: Layers },
  productionPiecework: { path: '/production/piecework', name: 'Piecework', icon: Hammer },
  productionPlanner: { path: '/production/planner', name: 'Resource planner', icon: CalendarRange },
  productionResources: { path: '/production/resources', name: 'Resources', icon: Hammer },
  productionClosing: { path: '/production/closing', name: 'Month closing', icon: CalendarCheck },
  productionWip: { path: '/production/wip', name: 'Work in progress', icon: Layers },
  productionReports: { path: '/production/reports', name: 'Reports', icon: ChartNoAxesCombined },
  otherCosts: { path: '/other-costs', name: 'Other costs', icon: ReceiptText },
  materialAllocation: { path: '/material-allocations', name: 'Material allocation', icon: Split },
  workCenters: { path: '/work-centers', name: 'Work centers', icon: Wrench },
  // Автоматизации
  automations: { path: '/automations', name: 'Automations', icon: Workflow },
  // Документы продаж и закупок, склад
  sales: { path: '/sales', name: 'Sales', icon: ReceiptText },
  workOrders: { path: '/work-orders', name: 'Work orders', icon: ClipboardList },
  servicesTimesheet: { path: '/services/timesheet', name: 'Timesheet', icon: CalendarClock },
  servicesPlanner: { path: '/services/planner', name: 'Service planner', icon: CalendarRange },
  servicesReports: { path: '/services/reports', name: 'Service reports', icon: ChartNoAxesCombined },
  purchases: { path: '/purchases', name: 'Purchases', icon: ShoppingCart },
  stockDocs: { path: '/stock-docs', name: 'Stock documents', icon: ArrowLeftRight },
  processingDocs: { path: '/processing-docs', name: 'Documents of processing', icon: PackageSearch },
  inventory: { path: '/inventory', name: 'Inventory', icon: Boxes },
  inUse: { path: '/stock/in-use', name: 'In use', icon: PackageCheck },
  serials: { path: '/serials', name: 'Serial numbers', icon: ScanBarcode },
  repairItems: { path: '/repair-items', name: 'Items in repair', icon: Wrench },
  deliveries: { path: '/deliveries', name: 'Deliveries', icon: Truck },
  myDeliveries: { path: '/deliveries/mine', name: 'My deliveries', icon: PackageCheck },
  // Договоры и биллинг
  contracts: { path: '/contracts', name: 'Contracts', icon: FileSignature },
  tariffPlans: { path: '/tariff-plans', name: 'Tariff plans', icon: ListChecks },
  billing: { path: '/billing', name: 'Billing', icon: ReceiptText },
  // Финансы: инвестпроекты и окупаемость
  investments: { path: '/investments', name: 'Investment projects', icon: TrendingUp },
  investmentsPlanFact: { path: '/investments/plan-fact', name: 'Plan vs actual', icon: Scale },
} satisfies Record<string, Section>;

export type SectionId = keyof typeof SECTIONS;

/* Группы меню, которые в сайдбаре сведены в одну строку, а подпункты показываются во второй панели (layout/SidePanel.tsx).
   label — ключ словаря, если подпись пункта в группе отличается от названия раздела. */
export interface NavGroupItem {
  id: SectionId;
  label?: TKey;
}
export interface NavGroup {
  icon: LucideIcon;
  items: NavGroupItem[];
}

export const NAV_GROUPS = {
  production: {
    icon: Factory,
    items: (
      [
        'production',
        'productionWorkbench',
        'productionOrders',
        'productionNeeds',
        'productionPlans',
        'productionPlanOrders',
        'productionStages',
        'productionPiecework',
        'productionPlanner',
        'productionResources',
        'productionWip',
        'productionReports',
        'productionClosing',
        'otherCosts',
        'materialAllocation',
        'workCenters',
      ] as const
    ).map(id => ({ id })),
  },
  trade: {
    icon: Store,
    // расчёт потребностей открывается из закупок и склада — тот же экран, что и в производстве
    items: [{ id: 'sales' }, { id: 'purchases' }, { id: 'stockDocs' }, { id: 'processingDocs' }, { id: 'inventory' }, { id: 'inUse' }, { id: 'serials' }, { id: 'productionNeeds', label: 'nav.stockNeeds' }],
  },
  services: {
    icon: BriefcaseBusiness,
    items: [{ id: 'workOrders' }, { id: 'repairItems' }, { id: 'deliveries' }, { id: 'myDeliveries' }, { id: 'servicesTimesheet' }, { id: 'servicesPlanner' }, { id: 'servicesReports' }, { id: 'contracts' }, { id: 'tariffPlans' }, { id: 'billing' }],
  },
  finance: {
    icon: Landmark,
    items: [{ id: 'investments' }, { id: 'investmentsPlanFact' }],
  },
} satisfies Record<string, NavGroup>;

export type NavGroupId = keyof typeof NAV_GROUPS;

const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(path + '/');

/** Группа, к которой относится адрес: по самому длинному совпадению пути пункта.
    prefer — уже показанная группа: если адрес есть и в ней (потребности — и в торговле, и в производстве), она и остаётся. */
export function navGroupOf(pathname: string, prefer?: NavGroupId | null): NavGroupId | null {
  let best: NavGroupId | null = null;
  let len = 0;
  for (const [gid, g] of Object.entries(NAV_GROUPS) as [NavGroupId, NavGroup][]) {
    for (const it of g.items) {
      const path = SECTIONS[it.id].path;
      if (within(pathname, path) && (path.length > len || (path.length === len && gid === prefer))) [best, len] = [gid, path.length];
    }
  }
  return best;
}

/* Раздел меню для должностей (задача 1172): какой набор разделов открывает пункт. Нет в таблице — виден всегда
   (главная, входящие, избранное, уведомления, участники, активность, архив, поиск, настройки). */
const POSITION_SECTION_OF: Partial<Record<SectionId, PositionSection>> = {
  overview: 'projects',
  projects: 'projects',
  tasks: 'projects',
  mytasks: 'projects',
  calendar: 'projects',
  timeline: 'projects',
  crm: 'crm',
  crmDeals: 'crm',
  crmCompanies: 'crm',
  crmContacts: 'crm',
  crmActivities: 'crm',
  crmSalesPlan: 'crm',
  crmAppointments: 'crm',
  catalog: 'catalog',
  production: 'production',
  productionOrders: 'production',
  productionWorkbench: 'production',
  productionNeeds: 'production',
  productionPlans: 'production',
  productionPlanOrders: 'production',
  productionStages: 'production',
  productionPiecework: 'production',
  productionPlanner: 'production',
  productionResources: 'production',
  productionClosing: 'production',
  productionWip: 'production',
  productionReports: 'production',
  otherCosts: 'production',
  materialAllocation: 'production',
  workCenters: 'production',
  automations: 'automations',
  sales: 'trade',
  purchases: 'trade',
  processingDocs: 'trade',
  stockDocs: 'stock',
  inventory: 'stock',
  inUse: 'stock',
  serials: 'stock',
  workOrders: 'services',
  repairItems: 'services',
  servicesTimesheet: 'services',
  servicesPlanner: 'services',
  servicesReports: 'services',
  contracts: 'services',
  tariffPlans: 'services',
  billing: 'services',
  deliveries: 'deliveries',
  myDeliveries: 'deliveries',
  investments: 'finance',
  investmentsPlanFact: 'finance',
};

export const positionSectionOf = (id: SectionId): PositionSection | null => POSITION_SECTION_OF[id] ?? null;

/** Раздел для должностей по адресу: самое длинное совпадение пути пункта (адреса вне меню, например /documents/:id, не ограничиваются) */
export function positionSectionOfPath(pathname: string): PositionSection | null {
  let best: PositionSection | null = null;
  let len = 0;
  for (const [id, sec] of Object.entries(POSITION_SECTION_OF) as [SectionId, PositionSection][]) {
    const path = SECTIONS[id].path;
    if (within(pathname, path) && path.length > len) [best, len] = [sec, path.length];
  }
  return best;
}

/** Вкладки страницы проекта (id — часть адреса /projects/:id/:tab); по умолчанию открывается board */
export const PROJECT_TABS = [
  { id: 'overview', name: 'Overview' },
  { id: 'board', name: 'Board' },
  { id: 'list', name: 'List' },
  { id: 'table', name: 'Table' },
  { id: 'calendar', name: 'Calendar' },
  { id: 'timeline', name: 'Timeline' },
  { id: 'files', name: 'Files' },
  { id: 'activity', name: 'Activity' },
] as const;

/* Названия разделов и вкладок — из словаря (sections.<id>, projectTabs.<id>) на текущем языке.
   Подписи выше остаются английским запасным вариантом: новый раздел без ключа в словаре покажет его */
function localize(items: Iterable<[string, { name: string }]>, ns: 'sections' | 'projectTabs') {
  for (const [id, item] of items) {
    const fallback = item.name;
    const key = `${ns}.${id}`;
    Object.defineProperty(item, 'name', { get: () => (hasKey(key) ? t(key) : fallback), enumerable: true });
  }
}
localize(Object.entries(SECTIONS), 'sections');
localize(PROJECT_TABS.map(tab => [tab.id, tab]), 'projectTabs');
