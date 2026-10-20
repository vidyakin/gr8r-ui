/* Единый список разделов: из него строятся навигация, хлебные крошки и заголовок вкладки. */
import {
  Activity,
  Archive,
  Bell,
  Calendar,
  ChartGantt,
  CircleCheck,
  Component,
  FolderKanban,
  House,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Settings,
  Star,
  Users,
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
  settings: { path: '/settings', name: 'Settings', icon: Settings },
  system: { path: '/design-system', name: 'Design system', icon: Component },
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
