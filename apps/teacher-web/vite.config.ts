import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function syncPermissionsPlugin() {
  const run = () => {
    execFileSync(process.execPath, [path.join(root, 'scripts/sync-permissions-md.mjs')], {
      stdio: 'inherit',
    });
  };
  return {
    name: 'sync-permissions-md',
    buildStart() {
      run();
    },
    configureServer() {
      run();
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Production assets are served by Express under /admin/
  base: mode === 'production' ? '/admin/' : '/',
  plugins: [react(), syncPermissionsPlugin()],
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
