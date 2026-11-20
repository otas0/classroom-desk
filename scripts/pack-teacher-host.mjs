#!/usr/bin/env node
/**
 * Build a prebuilt Windows teacher-host zip (no npm install / no vite on school PC).
 * Target: extract + Start-TeacherHost.bat → /admin in &lt; 5 min globally (≈1 min on decent links).
 *
 *   npm run pack:teacher-host
 *
 * Output: dist/ClassroomDesk-TeacherHost-<version>-win-x64.zip
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const nodeVersion = process.env.CLASSROOM_DESK_PACK_NODE || '22.14.0';
const arch = 'win-x64';
const outDir = path.join(root, 'dist');
const stagingName = `ClassroomDesk-TeacherHost-${version}-${arch}`;
const staging = path.join(os.tmpdir(), `cd-teacher-host-${process.pid}`);
const zipOut = path.join(outDir, `${stagingName}.zip`);

function run(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
}

function copyDir(src, dest, filter) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (filter && !filter(ent.name, ent)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
}

function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

console.log(`[pack:teacher-host] staging ${staging}`);
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

const teacherDist = path.join(root, 'apps/teacher-web/dist/index.html');
if (!fs.existsSync(teacherDist)) {
  console.log('[pack:teacher-host] build:teacher…');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:teacher'], root);
}

const packRoot = path.join(staging, stagingName);
fs.mkdirSync(packRoot, { recursive: true });

// Slim workspace: server + shared packages only (no electron / student-desktop).
const rootPkg = {
  name: 'classroom-desk-teacher-host',
  private: true,
  version,
  type: 'module',
  workspaces: ['apps/server', 'packages/*'],
  scripts: {
    start: 'npm run start --workspace=@classroom-desk/server',
    'ensure:minimal-env': 'node scripts/ensure-minimal-env.mjs',
  },
  dependencies: {
    tsx: '^4.19.2',
  },
  engines: { node: '>=22.5' },
};
fs.writeFileSync(path.join(packRoot, 'package.json'), JSON.stringify(rootPkg, null, 2));

copyDir(path.join(root, 'apps/server'), path.join(packRoot, 'apps/server'), (name) => {
  return !['node_modules', 'dist', 'data', '.env'].includes(name);
});
copyDir(path.join(root, 'packages'), path.join(packRoot, 'packages'), (name) => {
  return !['node_modules', 'dist'].includes(name);
});
fs.mkdirSync(path.join(packRoot, 'apps/teacher-web'), { recursive: true });
copyDir(path.join(root, 'apps/teacher-web/dist'), path.join(packRoot, 'apps/teacher-web/dist'));

fs.mkdirSync(path.join(packRoot, 'scripts'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'scripts/ensure-minimal-env.mjs'),
  path.join(packRoot, 'scripts/ensure-minimal-env.mjs'),
);

// Server start must use workspace tsx (hoisted).
const serverPkgPath = path.join(packRoot, 'apps/server/package.json');
const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf8'));
serverPkg.scripts = {
  ...serverPkg.scripts,
  start: 'node ../../node_modules/tsx/dist/cli.mjs src/index.ts',
};
delete serverPkg.devDependencies;
fs.writeFileSync(serverPkgPath, JSON.stringify(serverPkg, null, 2));

console.log('[pack:teacher-host] npm install --omit=dev (no electron)…');
run(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['install', '--omit=dev', '--no-fund', '--no-audit'],
  packRoot,
  { npm_config_registry: 'https://registry.npmmirror.com' },
);

const nodeDirName = `node-v${nodeVersion}-${arch}`;
const runtimeRoot = path.join(packRoot, 'runtime');
fs.mkdirSync(runtimeRoot, { recursive: true });
const nodeZip = path.join(os.tmpdir(), `${nodeDirName}.zip`);
const nodeUrls = [
  `https://nodejs.org/dist/v${nodeVersion}/${nodeDirName}.zip`,
  `https://npmmirror.com/mirrors/node/v${nodeVersion}/${nodeDirName}.zip`,
  `https://cdn.npmmirror.com/binaries/node/v${nodeVersion}/${nodeDirName}.zip`,
];
console.log(`[pack:teacher-host] portable Node ${nodeVersion}…`);
let got = false;
for (const url of nodeUrls) {
  try {
    await download(url, nodeZip);
    got = true;
    console.log(`[pack:teacher-host] node from ${url}`);
    break;
  } catch (e) {
    console.warn(`[pack:teacher-host] node fail: ${e.message}`);
  }
}
if (!got) throw new Error('Could not download portable Node');

const extractDir = path.join(os.tmpdir(), `cd-node-extract-${process.pid}`);
fs.rmSync(extractDir, { recursive: true, force: true });
fs.mkdirSync(extractDir, { recursive: true });
if (process.platform === 'win32') {
  run('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -LiteralPath '${nodeZip}' -DestinationPath '${extractDir}' -Force`,
  ], root);
} else {
  run('unzip', ['-q', '-o', nodeZip, '-d', extractDir], root);
}
const extracted = path.join(extractDir, nodeDirName);
if (!fs.existsSync(path.join(extracted, 'node.exe'))) {
  throw new Error(`Expected ${extracted}/node.exe`);
}
copyDir(extracted, path.join(runtimeRoot, nodeDirName));

const startBat = `@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=%~dp0runtime\\${nodeDirName}\\node.exe"
set "NPM=%~dp0runtime\\${nodeDirName}\\npm.cmd"
set "PATH=%~dp0runtime\\${nodeDirName};%PATH%"
if not exist "%NODE%" (
  echo Missing portable Node: %NODE%
  pause
  exit /b 1
)
if not exist ".env" (
  echo Creating .env…
  "%NODE%" scripts\\ensure-minimal-env.mjs
)
echo Starting Classroom Desk teacher host…
echo Admin: http://127.0.0.1:8787/admin/
echo Students: http://^<LAN-IP^>:8787/get
start "" "http://127.0.0.1:8787/admin/"
"%NPM%" run start
pause
`;
fs.writeFileSync(path.join(packRoot, 'Start-TeacherHost.bat'), startBat.replace(/\n/g, '\r\n'));

const readme = `Classroom Desk TeacherHost ${version} (win-x64)
================================================
目标：解压后双击 Start-TeacherHost.bat，约 1 分钟内打开 /admin（视下载速度）。

1. 解压本文件夹到例如 C:\\ClassroomDesk
2. 右键 Start-TeacherHost.bat → 以管理员运行（首次放行防火墙 8787 更稳）
3. 桌面/终端里的口令登录 http://127.0.0.1:8787/admin/
4. 学生浏览器打开 http://<本机局域网IP>:8787/get

本包已含：便携 Node、生产依赖（无 Electron）、已构建教师 UI。
学校机无需再 npm install / build。
`;
fs.writeFileSync(path.join(packRoot, 'README.txt'), readme);

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(zipOut, { force: true });
console.log(`[pack:teacher-host] zip → ${zipOut}`);
if (process.platform === 'win32') {
  run('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${packRoot}' -DestinationPath '${zipOut}' -Force`,
  ], root);
} else {
  run('zip', ['-qr', zipOut, stagingName], staging);
}

const st = fs.statSync(zipOut);
const mb = (st.size / 1024 / 1024).toFixed(1);
const digest = sha256File(zipOut);
fs.writeFileSync(`${zipOut}.sha256`, `${digest}  ${path.basename(zipOut)}\n`);
fs.writeFileSync(
  path.join(outDir, `${stagingName}.timing.json`),
  JSON.stringify(
    {
      version,
      zipMb: Number(mb),
      sha256: digest,
      includesNode: true,
      nodeVersion,
      arch,
      estimateMinutes: {
        note: 'download+extract+start wall clock',
        at_10mbps: +((st.size * 8) / (10e6) / 60 + 0.5).toFixed(2),
        at_20mbps: +((st.size * 8) / (20e6) / 60 + 0.4).toFixed(2),
        at_50mbps: +((st.size * 8) / (50e6) / 60 + 0.3).toFixed(2),
      },
      builtAt: new Date().toISOString(),
      nonce: randomBytes(4).toString('hex'),
    },
    null,
    2,
  ),
);

fs.rmSync(staging, { recursive: true, force: true });
fs.rmSync(extractDir, { recursive: true, force: true });

console.log('');
console.log(`[pack:teacher-host] OK ${mb} MB`);
console.log(`  ${zipOut}`);
console.log(`  sha256 ${digest}`);
console.log('  Gate: <5 min needs roughly zip/(Mbps/8) + ~30s extract/start');
console.log('');
