import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Предзагрузка основных шрифтов Geist (latin, кириллица, моно latin) и словаря ru: без неё браузер узнаёт о woff2 только из CSS,
// и шрифт стоит третьим в цепочке html → css → woff2 (Lighthouse «Network dependency tree»). Имена с хешем — из бандла
const FONT_PRELOAD = /^assets\/geist-(latin|cyrillic|mono-latin)-wght-normal-[\w-]+\.woff2$/;
function preloadFonts(): Plugin {
  let base = '/';
  return {
    name: 'preload-fonts',
    apply: 'build',
    configResolved(cfg) {
      base = cfg.base.endsWith('/') ? cfg.base : `${cfg.base}/`;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle ?? {};
        const fonts = Object.keys(bundle).filter(f => FONT_PRELOAD.test(f)).map(f => ({
          tag: 'link',
          attrs: { rel: 'preload', href: `${base}${f}`, as: 'font', type: 'font/woff2', crossorigin: '' },
          injectTo: 'head' as const,
        }));
        // Словарь ru (язык по умолчанию у аудитории) — сразу с HTML, а не после выполнения main.tsx (i18n/index.tsx, LOADERS)
        const ru = Object.values(bundle).find(c => c.type === 'chunk' && c.isDynamicEntry && /[\\/]i18n[\\/]ru[\\/]index\.ts$/.test(c.facadeModuleId ?? ''));
        const dict = ru ? [{ tag: 'link', attrs: { rel: 'modulepreload', href: `${base}${ru.fileName}`, crossorigin: '' }, injectTo: 'head' as const }] : [];
        return [...fonts, ...dict];
      },
    },
  };
}
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const umamiTarget = process.env.VITE_UMAMI_PROXY ?? 'http://localhost:3100';
const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwindcss(), preloadFonts()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    // Этап 2: фронтенд ходит в API по тому же origin (cookie без CORS): /api/* → API без префикса, /api/ws — WebSocket
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, ws: true, rewrite: p => p.replace(/^\/api/, '') },
      // Аналитика Umami (docs/architecture/analytics.md): /stats/x → Umami /x, как в nginx
      '/stats': { target: umamiTarget, changeOrigin: true, rewrite: p => p.replace(/^\/stats/, '') },
    },
  },
});
