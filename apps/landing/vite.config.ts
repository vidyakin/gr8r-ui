import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Две страницы: лендинг «/» и документация «/docs/» (статьи docs/user собираются в неё при сборке)
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), docs: resolve(import.meta.dirname, 'docs/index.html') } } },
  // Форма заявки шлёт POST /api/hooks/leads/<токен> — в разработке так же, как у apps/web, проксируем /api на API
  server: { proxy: { '/api': { target: apiTarget, changeOrigin: true, rewrite: p => p.replace(/^\/api/, '') } } },
});
