#!/usr/bin/env node
/**
 * Minimal classroom start: auto .env → (build teacher if needed) → API on LAN.
 * No gateway, TLS, DeskDNS, or hand-edited secrets required.
 *
 *   npm run start:minimal
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const skipBuild = process.argv.includes('--skip-build');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, HOST: process.env.HOST || '0.0.0.0' },
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

function lanIps() {
  const out = [];
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const n of list ?? []) {
        if (n.family !== 'IPv4' && n.family !== 4) continue;
        if (n.internal) continue;
        out.push(n.address);
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

await run(npm, ['run', 'ensure:minimal-env']);

const teacherDist = path.join(root, 'apps/teacher-web/dist/index.html');
const font = path.join(root, 'apps/server/assets/fonts/NotoSansSC-VF.ttf');
if (!skipBuild) {
  if (!fs.existsSync(font)) {
    console.log('[start:minimal] fonts…');
    await run(npm, ['run', 'fonts:cjk']);
  }
  if (!fs.existsSync(teacherDist)) {
    console.log('[start:minimal] build teacher…');
    await run(npm, ['run', 'build:teacher']);
  } else {
    console.log('[start:minimal] teacher dist present (use full rebuild: npm run build:teacher)');
  }
}

const port = Number(process.env.PORT || 8787);
const busy = await new Promise((resolve) => {
  const socket = net.connect({ port, host: '127.0.0.1' }, () => {
    socket.end();
    resolve(true);
  });
  socket.on('error', () => resolve(false));
});
if (busy) {
  console.error(`[start:minimal] :${port} already in use — stop the other process first`);
  process.exit(1);
}

const ips = lanIps();
console.log('');
console.log('[start:minimal] 开课地址');
console.log(`  教师: http://127.0.0.1:${port}/admin/`);
if (ips[0]) console.log(`  学生 apiBase: http://${ips[0]}:${port}`);
else console.log(`  学生 apiBase: http://<教师机IP>:${port}`);
console.log('  无需 OPNsense / UniFi / HTTPS / DeskDNS；Shield 未配时界面显示「网关未断」');
console.log('');

await run(npm, ['run', 'start:server']);
