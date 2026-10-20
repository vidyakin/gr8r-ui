import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import './styles/index.css';
import { Gr8rProvider } from '@/components/ui';
import { WorkspaceProvider } from '@/app/data/store';
import { router } from '@/app/router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gr8rProvider>
      <WorkspaceProvider>
        <RouterProvider router={router} />
      </WorkspaceProvider>
    </Gr8rProvider>
  </StrictMode>,
);
