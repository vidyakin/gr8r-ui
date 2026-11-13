// Лендинг на Astro: страница — статичный HTML, интерактив (записи модулей, форма заявки, документация) — React-острова
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  integrations: [react()],
  vite: {
    // Прежние переменные VITE_* (токен формы, адрес приложения) остаются видны в браузере
    envPrefix: ['PUBLIC_', 'VITE_'],
    // Форма заявки шлёт POST /api/hooks/leads/<токен> — в разработке проксируем /api на API, как apps/web
    server: { proxy: { '/api': { target: apiTarget, changeOrigin: true, rewrite: p => p.replace(/^\/api/, '') } } },
  },
});
