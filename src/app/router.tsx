import { createHashRouter } from 'react-router';
import { AppShell } from './layout/AppShell';
import { HomePage } from './pages/HomePage';
import { DesignSystemPage } from './pages/DesignSystemPage';
import { InboxPage } from './pages/InboxPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { CalendarPage } from './pages/CalendarPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OverviewPage } from './pages/OverviewPage';
import { TasksPage } from './pages/TasksPage';
import { ProjectPage } from './pages/ProjectPage';
import { TimelinePage } from './pages/TimelinePage';
import { ActivityPage } from './pages/ActivityPage';
import { NotFoundPage, PlaceholderPage } from './pages/PlaceholderPage';
import { SECTIONS } from './routes';

/* Hash-роутинг, как в оригинале: работает на любом статическом хостинге без настройки rewrite.
   Чтобы перенести раздел, замените PlaceholderPage на его компонент. */
const PORTED = new Set([SECTIONS.home, SECTIONS.inbox, SECTIONS.mytasks, SECTIONS.favorites, SECTIONS.notifications, SECTIONS.overview, SECTIONS.calendar, SECTIONS.projects, SECTIONS.tasks, SECTIONS.timeline, SECTIONS.activity, SECTIONS.system].map(s => s.path));

export const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: SECTIONS.inbox.path, element: <InboxPage /> },
      { path: SECTIONS.mytasks.path, element: <MyTasksPage /> },
      { path: SECTIONS.favorites.path, element: <FavoritesPage /> },
      { path: SECTIONS.notifications.path, element: <NotificationsPage /> },
      { path: SECTIONS.overview.path, element: <OverviewPage /> },
      { path: SECTIONS.calendar.path, element: <CalendarPage /> },
      { path: SECTIONS.projects.path, element: <ProjectsPage /> },
      { path: SECTIONS.tasks.path, element: <TasksPage /> },
      { path: SECTIONS.timeline.path, element: <TimelinePage /> },
      { path: SECTIONS.activity.path, element: <ActivityPage /> },
      { path: SECTIONS.system.path, element: <DesignSystemPage /> },
      // Разделы, которые ещё не перенесены, открывают заглушку
      ...Object.values(SECTIONS)
        .filter(s => !PORTED.has(s.path))
        .map(s => ({ path: s.path, element: <PlaceholderPage /> })),
      { path: '/projects/:id/:tab?', element: <ProjectPage /> },
      { path: '/teams/:id', element: <PlaceholderPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
