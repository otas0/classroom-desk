import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const off = path.join(root, '.electron-off');
const port = Number(process.env.VITE_PORT || 5173);

/**
 * Electron is ON by default (FORCE_ELECTRON=1 passed to vite).
 * ELECTRON_OFF=1 → Vite-only (no Electron window); used by CI / Playwright toast e2e.
 */
const viteOnly = process.env.ELECTRON_OFF === '1' && process.env.FORCE_ELECTRON !== '1';
if (viteOnly) {
  console.log('[student-desktop] Vite-only (ELECTRON_OFF=1). Set FORCE_ELECTRON=1 for Electron.');
}

if (fs.existsSync(off)) {
  try {
    fs.unlinkSync(off);
    console.warn(
      '[student-desktop] removed stale .electron-off (no longer disables Electron; use ELECTRON_OFF=1 to opt out).',
    );
  } catch (e) {
    console.warn('[student-desktop] could not remove .electron-off:', e instanceof Error ? e.message : e);
  }
}

function freePort(p) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${p}`, { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
          console.log(`[student-desktop] freed port ${p} (killed PID ${pid})`);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    const out = execSync(`lsof -tiTCP:${p} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
    if (!out) return;
    for (const pid of out.split(/\n+/)) {
      try {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        console.log(`[student-desktop] freed port ${p} (killed PID ${pid})`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* nothing listening */
  }
}

freePort(port);

const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    ...(viteOnly ? { ELECTRON_OFF: '1' } : { FORCE_ELECTRON: process.env.FORCE_ELECTRON || '1' }),
  },
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
