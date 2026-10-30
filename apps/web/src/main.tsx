import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import './styles/index.css';
import { Gr8rProvider } from '@/components/ui';
import { SessionProvider } from '@/app/data/session';
import { router } from '@/app/router';
import { I18nProvider } from '@/i18n';

// Данные воркспейса актуальны, пока их не отметит устаревшими событие realtime или своя мутация (staleTime: Infinity)
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: Infinity } } });

if (import.meta.env.DEV) (window as unknown as { __qc: QueryClient }).__qc = queryClient; // для отладки в консоли браузера

createRoot(document.getElementById('root')!).render(
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

if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/driver-sw.js');
