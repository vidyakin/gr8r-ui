import { createHashRouter } from 'react-router';
import { AppShell } from './layout/AppShell';
import { HomePage } from './pages/HomePage';
import { DesignSystemPage } from './pages/DesignSystemPage';
import { NotFoundPage, PlaceholderPage } from './pages/PlaceholderPage';
import { SECTIONS } from './routes';

/* Hash-роутинг, как в оригинале: работает на любом статическом хостинге без настройки rewrite.
   Чтобы перенести раздел, замените PlaceholderPage на его компонент. */
export const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: SECTIONS.system.path, element: <DesignSystemPage /> },
      ...Object.values(SECTIONS)
        .filter(s => s.path !== '/' && s !== SECTIONS.system)
        .map(s => ({ path: s.path, element: <PlaceholderPage /> })),
      { path: '/projects/:id/:tab?', element: <PlaceholderPage /> },
      { path: '/teams/:id', element: <PlaceholderPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
