// первым: прямая ссылка без хеша переносится в хеш до создания роутера
import './lib/path-to-hash';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
// Шрифты из бандла вместо Google Fonts: нет блокирующего внешнего CSS (Lighthouse «Render-blocking requests»)
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import './styles/index.css';
import { Gr8rProvider } from '@/components/ui';
import { SessionProvider, prefetchSession } from '@/app/data/session';
import { router } from '@/app/router';
import { I18nProvider, getLocale, loadLocale } from '@/i18n';

// Данные воркспейса актуальны, пока их не отметит устаревшими событие realtime или своя мутация (staleTime: Infinity).
// gcTime 30 минут: у скрытой вкладки (layout/TabPages.tsx) нет наблюдателей, её данные не должны пропадать через 5 минут
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: Infinity, gcTime: 30 * 60_000 } } });

if (import.meta.env.DEV) (window as unknown as { __qc: QueryClient }).__qc = queryClient; // для отладки в консоли браузера

// Словарь активного языка — отдельный чанк (i18n/index.tsx): ждём его до первой отрисовки, без него t() вернул бы ключи.
// Не загрузился (сеть) — рисуем всё равно: t() покажет ключи, а не пустой экран
const renderApp = () => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Gr8rProvider>
        <SessionProvider>
          <I18nProvider>
            <RouterProvider router={router} />
          </I18nProvider>
        </SessionProvider>
      </Gr8rProvider>
    </QueryClientProvider>
  </StrictMode>,
);
// Сессия запрашивается сразу, параллельно со словарём: SessionProvider возьмёт готовый ответ из кэша
void prefetchSession(queryClient);
loadLocale(getLocale()).then(renderApp, renderApp);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then(regs =>
    regs.forEach(r => {
      if (new URL(r.scope).pathname === '/') void r.unregister();
    }),
  );
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}driver-sw.js`);
}
