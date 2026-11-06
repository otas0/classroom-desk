import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const off = path.join(root, '.electron-off');

/**
 * Electron is ON by default.
 * Opt-out only via ELECTRON_OFF=1 (CI / headless).
 * A leftover `.electron-off` file no longer silently disables the app —
 * it is removed and a warning is printed.
 */
if (process.env.ELECTRON_OFF === '1' && process.env.FORCE_ELECTRON !== '1') {
  console.log('[student-desktop] Electron skipped (ELECTRON_OFF=1). Set FORCE_ELECTRON=1 to override.');
  process.exit(0);
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

const child = spawn('npx', ['vite'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, FORCE_ELECTRON: process.env.FORCE_ELECTRON || '1' },
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
