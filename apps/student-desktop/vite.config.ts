import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

const pkgDir = path.dirname(fileURLToPath(import.meta.url));
const pkgVersion = String(
  (JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as { version?: string })
    .version ?? '0.0.0',
);

const viteOnly = process.env.ELECTRON_OFF === '1' && process.env.FORCE_ELECTRON !== '1';

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
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
    ...(viteOnly
      ? []
      : [
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
        ]),
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
