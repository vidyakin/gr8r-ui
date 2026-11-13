// Лендинг на Astro: страница — статичный HTML, интерактив (записи модулей, форма заявки, документация) — React-острова
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { existsSync, readFileSync } from 'node:fs';

// Переменные берём из корневого .env, как остальные пакеты (dev запускается из apps/landing и его не видит).
// В браузер Vite отдаёт оттуда только VITE_*/PUBLIC_*, которые упомянуты в коде (envDir ниже)
const ROOT = new URL('../..', import.meta.url).pathname;
const rootEnv = existsSync(ROOT + '.env')
  ? Object.fromEntries(readFileSync(ROOT + '.env', 'utf8').split('\n').map(l => l.match(/^\s*([A-Z0-9_]+)=([^#]*)/)).filter(Boolean).map(m => [m[1], m[2].trim()]))
  : {};
const env = { ...rootEnv, ...process.env };
const apiTarget = env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  integrations: [react()],
  vite: {
    // Прежние переменные VITE_* (токен формы, адрес приложения) остаются видны в браузере
    envPrefix: ['PUBLIC_', 'VITE_'],
    envDir: ROOT,
    // Форма заявки шлёт POST /api/hooks/leads/<токен> — в разработке проксируем /api на API, как apps/web
    server: { proxy: { '/api': { target: apiTarget, changeOrigin: true, rewrite: p => p.replace(/^\/api/, '') } } },
  },
});
