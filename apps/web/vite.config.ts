import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    // Этап 2: фронтенд ходит в API по тому же origin (cookie без CORS): /api/* → API без префикса, /api/ws — WebSocket
    proxy: { '/api': { target: apiTarget, changeOrigin: true, ws: true, rewrite: p => p.replace(/^\/api/, '') } },
  },
});
