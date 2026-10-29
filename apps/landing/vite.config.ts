import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Форма заявки шлёт POST /api/hooks/leads/<токен> — в разработке так же, как у apps/web, проксируем /api на API
  server: { proxy: { '/api': { target: apiTarget, changeOrigin: true, rewrite: p => p.replace(/^\/api/, '') } } },
});
