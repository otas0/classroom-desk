#!/usr/bin/env node
/**
 * Detached helper: wait for old API to exit (or kill), then start server again.
 *
 *   node scripts/teacher-host-restart.mjs --pid 12345 --port 8787 --delay-ms 2000
 *
 * Env preserved via process.env from parent spawn.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function flag(name, fallback = '') {
  const i = args.indexOf(name);
  return i >= 0 ? String(args[i + 1] ?? fallback) : fallback;
}

const oldPid = Number(flag('--pid', '0'));
const port = Number(flag('--port', process.env.PORT || '8787'));
const delayMs = Number(flag('--delay-ms', '2000'));
const logFile = path.join(
  process.env.CLASSROOM_DESK_DATA_DIR || path.join(root, 'apps/server/data'),
  'teacher-host-restart.log',
);

function log(line) {
  const row = `[${new Date().toISOString()}] ${line}\n`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, row);
  } catch {
    /* ignore */
  }
  console.log(row.trim());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function portFree(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => {
      s.close(() => resolve(true));
    });
    s.listen(p, '127.0.0.1');
  });
}

async function waitPortFree(p, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await portFree(p)) return true;
    await sleep(400);
  }
  return false;
}

function tryKill(pid) {
  if (!pid || pid <= 0) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } catch {
      /* ignore */
    }
  }
}

log(`restart helper start oldPid=${oldPid} port=${port} delay=${delayMs}`);
await sleep(Math.max(500, delayMs));
tryKill(oldPid);
await sleep(800);
const free = await waitPortFree(port);
if (!free) {
  log(`port ${port} still busy — forcing kill again`);
  tryKill(oldPid);
  await waitPortFree(port, 15_000);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['run', 'start:server'], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    HOST: process.env.HOST || '0.0.0.0',
    PORT: String(port),
  },
  windowsHide: true,
});
child.unref();
log(`spawned start:server pid=${child.pid}`);
process.exit(0);
