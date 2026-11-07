#!/usr/bin/env node
/**
 * Supervised local stack: API + teacher Vite (+ optional student Electron).
 * Default always starts API then teacher (waits /health) so one hang doesn't leave you with a half stack.
 * Each child restarts independently.
 *
 * Usage:
 *   npm run dev:stack                 # API + teacher + student
 *   npm run dev:stack -- --no-student # API + teacher only
 *   npm run dev:stack -- --once
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const noStudent = args.has('--no-student');
const once = args.has('--once');
const restartMs = Number(process.env.DEV_STACK_RESTART_MS ?? 1500);
const apiPort = process.env.PORT || '8787';
const apiHost = process.env.HOST || '127.0.0.1';

const offFile = path.join(root, 'apps/student-desktop/.electron-off');
if (fs.existsSync(offFile)) {
  fs.unlinkSync(offFile);
  console.log('[dev-stack] removed stale apps/student-desktop/.electron-off');
}

const serverEnv = {
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'AdminPass123',
  TEACHER_PASSWORD: process.env.TEACHER_PASSWORD || 'TeacherPass123',
  DEFAULT_CLASS_CODE: process.env.DEFAULT_CLASS_CODE || 'LOCAL01',
  HOST: apiHost,
  PORT: apiPort,
};

/** @type {Array<{ name: string, npmScript: string, env?: Record<string, string>, cwd?: string, waitHealth?: boolean }>} */
const specs = [
  {
    name: 'api',
    npmScript: 'dev:server',
    env: serverEnv,
  },
  {
    name: 'teacher',
    npmScript: 'dev:teacher',
    waitHealth: true,
  },
];

if (!noStudent) {
  specs.push({
    name: 'student',
    npmScript: 'dev:electron',
    cwd: path.join(root, 'apps/student-desktop'),
    env: { FORCE_ELECTRON: '1' },
    waitHealth: true,
  });
}

let shuttingDown = false;
/** @type {Map<string, { child: import('node:child_process').ChildProcess, restarts: number }>} */
const procs = new Map();

function prefixPipe(stream, name) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += String(chunk);
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length) process.stdout.write(`[${name}] ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buf.length) process.stdout.write(`[${name}] ${buf}\n`);
  });
}

async function waitForHealth(timeoutMs = 45_000) {
  const url = `http://${apiHost}:${apiPort}/health`;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const j = await res.json();
        if (j?.ok) {
          console.log(`[dev-stack] API healthy ${url}`);
          return;
        }
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.warn(`[dev-stack] API health wait timed out (${url}); starting remaining services anyway`);
}

function start(spec, restarts = 0) {
  if (shuttingDown) return;
  const cwd = spec.cwd ?? root;
  const env = { ...process.env, ...(spec.env ?? {}) };
  const child = spawn('npm', ['run', spec.npmScript], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  procs.set(spec.name, { child, restarts });
  prefixPipe(child.stdout, spec.name);
  prefixPipe(child.stderr, spec.name);
  console.log(`[dev-stack] started ${spec.name} pid=${child.pid} (restarts=${restarts})`);

  child.on('exit', (code, signal) => {
    const cur = procs.get(spec.name);
    if (!cur || cur.child !== child) return;
    console.log(
      `[dev-stack] ${spec.name} exited code=${code} signal=${signal ?? ''} restarts=${restarts}`,
    );
    if (shuttingDown || once) return;
    const next = restarts + 1;
    const delay = Math.min(10_000, restartMs * Math.min(next, 5));
    console.log(`[dev-stack] restarting ${spec.name} in ${delay}ms…`);
    setTimeout(() => {
      void (async () => {
        if (spec.waitHealth && spec.name !== 'api') await waitForHealth(20_000);
        start(spec, next);
      })();
    }, delay);
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[dev-stack] shutting down (${signal})…`);
  for (const [name, { child }] of procs) {
    try {
      if (child.pid && !child.killed) {
        child.kill('SIGTERM');
        console.log(`[dev-stack] sent SIGTERM to ${name}`);
      }
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(0), 800).unref?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log('[dev-stack] default: API :8787 + teacher :5174' + (noStudent ? '' : ' + student'));
console.log('[dev-stack] Ctrl+C stops all. Flags: --no-student --once');

/** If API listen process was SIGKILL'd but npm parent still "alive", force-restart. */
function startApiHealthWatchdog() {
  const intervalMs = Number(process.env.DEV_STACK_HEALTH_MS ?? 4000);
  setInterval(() => {
    if (shuttingDown || once) return;
    const url = `http://${apiHost}:${apiPort}/health`;
    void fetch(url)
      .then(async (res) => {
        if (res.ok) return;
        throw new Error(`status ${res.status}`);
      })
      .catch(() => {
        const cur = procs.get('api');
        if (!cur || shuttingDown) return;
        console.warn('[dev-stack] API health lost — killing npm parent and restarting…');
        try {
          cur.child.kill('SIGKILL');
        } catch {
          /* exit handler will restart */
        }
        // If exit handler did not fire (zombie), start anyway after brief delay
        setTimeout(() => {
          const still = procs.get('api');
          if (still && still.child === cur.child && !shuttingDown) {
            try {
              still.child.kill('SIGKILL');
            } catch {
              /* ignore */
            }
            procs.delete('api');
            start(specs[0], (still.restarts ?? 0) + 1);
          }
        }, 800);
      });
  }, intervalMs).unref?.();
}

async function main() {
  start(specs[0]); // api
  await waitForHealth();
  startApiHealthWatchdog();
  for (const spec of specs.slice(1)) start(spec);
}

void main();
