import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  // Production assets are served by Express under /admin/
  base: mode === 'production' ? '/admin/' : '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    // Dev same-origin: browser calls /api on :5174 → Express :8787
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/ready': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}));
