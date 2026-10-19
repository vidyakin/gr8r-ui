import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { Gr8rProvider } from '@/components/ui';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gr8rProvider>
      <App />
    </Gr8rProvider>
  </StrictMode>,
);
