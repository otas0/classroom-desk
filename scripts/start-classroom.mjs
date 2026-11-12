#!/usr/bin/env node
/**
 * One-shot teacher host start: CJK fonts if missing → build teacher → start API.
 * Usage: npm run start:classroom
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const font = path.join(root, 'apps/server/assets/fonts/NotoSansSC-VF.ttf');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, HOST: process.env.HOST || '0.0.0.0', ...opts.env },
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!fs.existsSync(font)) {
  console.log('[start:classroom] fetching CJK fonts…');
  await run(npm, ['run', 'fonts:cjk']);
} else {
  console.log('[start:classroom] CJK fonts ok');
}

console.log('[start:classroom] build teacher…');
await run(npm, ['run', 'build:teacher']);

const port = Number(process.env.PORT || 8787);
const busy = await new Promise((resolve) => {
  const socket = net.connect({ port, host: '127.0.0.1' }, () => {
    socket.end();
    resolve(true);
  });
  socket.on('error', () => resolve(false));
});
if (busy) {
  console.error(
    `[start:classroom] 127.0.0.1:${port} already listening — refusing a second start:server`,
  );
  process.exit(1);
}

console.log('[start:classroom] starting server on HOST=%s …', process.env.HOST || '0.0.0.0');
console.log('[start:classroom] open http://127.0.0.1:8787/admin/');
await run(npm, ['run', 'start:server']);
