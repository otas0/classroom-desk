import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'classroom-csp',
      transformIndexHtml(html) {
        if (mode === 'development') {
          // Dev: allow Vite HMR + local API
          return html.replace(
            /content="default-src[^"]*"/,
            `content="default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss: http://127.0.0.1:* http://localhost:*;"`,
          );
        }
        // Production packaged HTML: omit meta CSP; Electron main applies packaged CSP.
        return html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/i, '\n');
      },
    },
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
}));
