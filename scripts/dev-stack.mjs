#!/usr/bin/env node
/**
 * Supervised local stack: API + teacher Vite + student Electron.
 * Each child restarts independently so one exit does not tear down the rest.
 *
 * Usage:
 *   npm run dev:stack
 *   npm run dev:stack -- --no-student
 *   npm run dev:stack -- --once   # no restart (CI-friendly)
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
  HOST: process.env.HOST || '127.0.0.1',
  PORT: process.env.PORT || '8787',
};

/** @type {Array<{ name: string, npmScript: string, env?: Record<string, string>, cwd?: string }>} */
const specs = [
  {
    name: 'api',
    npmScript: 'dev:server',
    env: serverEnv,
  },
  {
    name: 'teacher',
    npmScript: 'dev:teacher',
  },
];

if (!noStudent) {
  specs.push({
    name: 'student',
    npmScript: 'dev:electron',
    cwd: path.join(root, 'apps/student-desktop'),
    env: { FORCE_ELECTRON: '1' },
  });
}

let shuttingDown = false;
/** @type {Map<string, { child: import('node:child_process').ChildProcess, restarts: number }>} */
const procs = new Map();

function prefixPipe(stream, name, streamName) {
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
  void streamName;
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
  prefixPipe(child.stdout, spec.name, 'out');
  prefixPipe(child.stderr, spec.name, 'err');
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
    setTimeout(() => start(spec, next), delay);
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

console.log('[dev-stack] API :8787 · teacher :5174 · student Electron');
console.log('[dev-stack] Ctrl+C stops all. Flags: --no-student --once');
for (const spec of specs) start(spec);
