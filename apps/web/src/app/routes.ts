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
  ReceiptText,
  ShoppingCart,
  CalendarRange,
  CalendarCheck,
  FileSignature,
  type LucideIcon,
} from 'lucide-react';

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
  otherCosts: { path: '/other-costs', name: 'Other costs', icon: ReceiptText },
  workCenters: { path: '/work-centers', name: 'Work centers', icon: Wrench },
  // Автоматизации
  automations: { path: '/automations', name: 'Automations', icon: Workflow },
  // Документы продаж и закупок, склад
  sales: { path: '/sales', name: 'Sales', icon: ReceiptText },
  workOrders: { path: '/work-orders', name: 'Work orders', icon: ClipboardList },
  servicesTimesheet: { path: '/services/timesheet', name: 'Timesheet', icon: CalendarClock },
  servicesPlanner: { path: '/services/planner', name: 'Service planner', icon: CalendarRange },
  purchases: { path: '/purchases', name: 'Purchases', icon: ShoppingCart },
  stockDocs: { path: '/stock-docs', name: 'Stock documents', icon: ArrowLeftRight },
  inventory: { path: '/inventory', name: 'Inventory', icon: Boxes },
  inUse: { path: '/stock/in-use', name: 'In use', icon: PackageCheck },
  // Договоры и биллинг
  contracts: { path: '/contracts', name: 'Contracts', icon: FileSignature },
  tariffPlans: { path: '/tariff-plans', name: 'Tariff plans', icon: ListChecks },
  billing: { path: '/billing', name: 'Billing', icon: ReceiptText },
} satisfies Record<string, Section>;

export type SectionId = keyof typeof SECTIONS;

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
