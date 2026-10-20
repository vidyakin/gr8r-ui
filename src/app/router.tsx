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
import { MembersPage } from './pages/MembersPage';
import { MemberPage } from './pages/MemberPage';
import { NotFoundPage, PlaceholderPage } from './pages/PlaceholderPage';
import { SECTIONS } from './routes';
import { CrmProvider } from './crm/store';
import { DashboardPage as CrmDashboardPage } from './crm/DashboardPage';
import { DealsPage as CrmDealsPage } from './crm/DealsPage';
import { CompaniesPage as CrmCompaniesPage } from './crm/CompaniesPage';
import { CompanyPage as CrmCompanyPage } from './crm/CompanyPage';
import { ContactsPage as CrmContactsPage } from './crm/ContactsPage';
import { ActivitiesPage as CrmActivitiesPage } from './crm/ActivitiesPage';

/* Hash-роутинг, как в оригинале: работает на любом статическом хостинге без настройки rewrite.
   Чтобы перенести раздел, замените PlaceholderPage на его компонент. */
const PORTED = new Set([SECTIONS.home, SECTIONS.inbox, SECTIONS.mytasks, SECTIONS.favorites, SECTIONS.notifications, SECTIONS.overview, SECTIONS.calendar, SECTIONS.projects, SECTIONS.tasks, SECTIONS.timeline, SECTIONS.activity, SECTIONS.members, SECTIONS.system, SECTIONS.crm, SECTIONS.crmDeals, SECTIONS.crmCompanies, SECTIONS.crmContacts, SECTIONS.crmActivities].map(s => s.path));

export const router = createHashRouter([
  {
    // CRM-хранилище живёт над оболочкой: из него берут данные крошки в топбаре и пункт «New deal»
    element: (
      <CrmProvider>
        <AppShell />
      </CrmProvider>
    ),
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
      { path: SECTIONS.members.path, element: <MembersPage /> },
      { path: `${SECTIONS.members.path}/:id`, element: <MemberPage /> },
      { path: SECTIONS.system.path, element: <DesignSystemPage /> },
      { path: SECTIONS.crm.path, element: <CrmDashboardPage /> },
      { path: SECTIONS.crmDeals.path, element: <CrmDealsPage /> },
      { path: SECTIONS.crmCompanies.path, element: <CrmCompaniesPage /> },
      { path: `${SECTIONS.crmCompanies.path}/:id/:tab?`, element: <CrmCompanyPage /> },
      { path: SECTIONS.crmContacts.path, element: <CrmContactsPage /> },
      { path: SECTIONS.crmActivities.path, element: <CrmActivitiesPage /> },
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
