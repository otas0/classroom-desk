#!/usr/bin/env node
/**
 * Build a prebuilt Windows teacher-host zip (no npm install / no vite on school PC).
 * Target: extract + Start-TeacherHost.bat → /admin in &lt; 5 min.
 *
 *   npm run pack:teacher-host
 *
 * Output: dist/ClassroomDesk-TeacherHost-<version>-win-x64.zip
 *
 * CRITICAL: never ship host-Mac node_modules (darwin esbuild). Runtime starts
 * prebundled apps/server/dist/index.mjs — no tsx/esbuild on the classroom PC.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
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
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
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

function assertWindowsNodeExe(exePath) {
  const fd = fs.openSync(exePath, 'r');
  const buf = Buffer.alloc(4);
  try {
    fs.readSync(fd, buf, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (buf[0] === 0x4d && buf[1] === 0x5a) return;
  throw new Error(`FATAL: portable node.exe is not Windows PE (magic=${buf.toString('hex')})`);
}

function assertNoDarwinNativeBins(nmRoot) {
  if (!fs.existsSync(nmRoot)) return;
  const bad = [];
  function walk(d) {
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (
          (/^darwin-|^linux-|^macos/i.test(ent.name) || ent.name === 'fsevents') &&
          /node_modules[\\/](@esbuild|esbuild|@swc|fsevents)/i.test(p)
        ) {
          bad.push(p);
          continue;
        }
        walk(p);
      }
    }
  }
  walk(nmRoot);
  // Explicit known poison for this bug report
  for (const rel of [
    '@esbuild/darwin-arm64',
    '@esbuild/darwin-x64',
    'esbuild/node_modules/@esbuild/darwin-arm64',
  ]) {
    const p = path.join(nmRoot, rel);
    if (fs.existsSync(p)) bad.push(p);
  }
  if (bad.length) {
    throw new Error(
      `FATAL: Mac/Linux native modules in TeacherHost pack:\n  ${bad.slice(0, 12).join('\n  ')}\n` +
        `Re-pack with npm install --os=win32 --cpu=x64 (and start from dist, not tsx).`,
    );
  }
}

function stripDevNativeTooling(nmRoot) {
  // Runtime must not need tsx/esbuild after server is prebundled.
  for (const name of ['tsx', 'esbuild', '@esbuild', 'fsevents']) {
    const p = path.join(nmRoot, name);
    if (fs.existsSync(p)) {
      console.log('[pack:teacher-host] strip runtime tooling', name);
      rmrf(p);
    }
  }
}

function bundleServer(packRoot) {
  const entry = path.join(root, 'apps/server/src/index.ts');
  const outFile = path.join(packRoot, 'apps/server/dist/index.mjs');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  console.log('[pack:teacher-host] esbuild server → dist/index.mjs…');
  execFileSync(
    npmBin,
    [
      'exec',
      '--yes',
      '--',
      'esbuild',
      entry,
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--packages=external',
      `--outfile=${outFile}`,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 10_000) {
    throw new Error(`server bundle missing/too small: ${outFile}`);
  }
}

console.log(`[pack:teacher-host] staging ${staging}`);
rmrf(staging);
fs.mkdirSync(staging, { recursive: true });

const teacherDist = path.join(root, 'apps/teacher-web/dist/index.html');
if (!fs.existsSync(teacherDist)) {
  console.log('[pack:teacher-host] build:teacher…');
  run(npmBin, ['run', 'build:teacher'], root);
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
    start: 'node apps/server/dist/index.mjs',
    'ensure:minimal-env': 'node scripts/ensure-minimal-env.mjs',
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

const serverPkgPath = path.join(packRoot, 'apps/server/package.json');
const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf8'));
serverPkg.scripts = {
  ...serverPkg.scripts,
  start: 'node ./dist/index.mjs',
};
delete serverPkg.devDependencies;
fs.writeFileSync(serverPkgPath, JSON.stringify(serverPkg, null, 2));

console.log('[pack:teacher-host] npm install win32-x64 deps (no host-Mac natives)…');
run(
  npmBin,
  [
    'install',
    '--os=win32',
    '--cpu=x64',
    '--omit=dev',
    '--ignore-scripts',
    '--no-fund',
    '--no-audit',
  ],
  packRoot,
  {
    npm_config_registry: 'https://registry.npmmirror.com',
    npm_config_os: 'win32',
    npm_config_cpu: 'x64',
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
  },
);

bundleServer(packRoot);
stripDevNativeTooling(path.join(packRoot, 'node_modules'));
assertNoDarwinNativeBins(path.join(packRoot, 'node_modules'));

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
rmrf(extractDir);
fs.mkdirSync(extractDir, { recursive: true });
if (process.platform === 'win32') {
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${nodeZip}' -DestinationPath '${extractDir}' -Force`,
    ],
    root,
  );
} else {
  run('unzip', ['-q', '-o', nodeZip, '-d', extractDir], root);
}
const extracted = path.join(extractDir, nodeDirName);
const nodeExe = path.join(extracted, 'node.exe');
if (!fs.existsSync(nodeExe)) {
  throw new Error(`Expected ${extracted}/node.exe`);
}
assertWindowsNodeExe(nodeExe);
copyDir(extracted, path.join(runtimeRoot, nodeDirName));

const marker = {
  product: 'teacher-host',
  version,
  platform: 'win32-x64',
  serverEntry: 'apps/server/dist/index.mjs',
  packedAt: new Date().toISOString(),
  note: 'Prebundled server — no tsx/esbuild on classroom PC.',
};
fs.writeFileSync(path.join(packRoot, '.classroom-desk-ready'), JSON.stringify(marker, null, 2));

const startBat = `@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=%~dp0runtime\\${nodeDirName}\\node.exe"
set "PATH=%~dp0runtime\\${nodeDirName};%PATH%"
set CLASSROOM_DESK_BUNDLED=1
set CLASSROOM_DESK_OFFLINE=1
if not exist "%NODE%" (
  echo Missing portable Node: %NODE%
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$b=[IO.File]::ReadAllBytes('%NODE%')[0..1]; if(-not($b[0]-eq0x4D -and $b[1]-eq0x5A)){ Write-Host 'ERROR: node.exe is not Windows PE (Mac binary?).'; exit 2 }; exit 0"
if errorlevel 1 (
  pause
  exit /b 2
)
if not exist "apps\\server\\dist\\index.mjs" (
  echo ERROR: missing apps\\server\\dist\\index.mjs
  echo This TeacherHost pack is incomplete. Use Teacher-Setup.exe from the latest Release.
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
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8787/admin/"
"%NODE%" "apps\\server\\dist\\index.mjs"
set ERR=%ERRORLEVEL%
echo.
echo Server exited code %ERR%
if not "%ERR%"=="0" (
  echo If you see MODULE_NOT_FOUND / esbuild / darwin: download latest TeacherHost or Teacher-Setup from GitHub Release.
)
pause
exit /b %ERR%
`;
fs.writeFileSync(path.join(packRoot, 'Start-TeacherHost.bat'), startBat.replace(/\n/g, '\r\n'));

const readme = `Classroom Desk TeacherHost ${version} (win-x64)
================================================
目标：解压后双击 Start-TeacherHost.bat，约 1 分钟内打开 /admin。

1. 解压本文件夹到例如 C:\\ClassroomDesk
2. 右键 Start-TeacherHost.bat → 以管理员运行（首次放行防火墙 8787 更稳）
3. 浏览器打开 http://127.0.0.1:8787/admin/
4. 学生浏览器打开 http://<本机局域网IP>:8787/get

本包已含：Windows 便携 Node、win-x64 生产依赖、预编译 server dist、已构建教师 UI。
学校机无需 npm install / 不要用 Mac 上的 node_modules。
若仍报 esbuild / darwin：请改用最新 Release 的 Teacher-Setup.exe 或重新下载本 TeacherHost zip。
`;
fs.writeFileSync(path.join(packRoot, 'README.txt'), readme);

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(zipOut, { force: true });
console.log(`[pack:teacher-host] zip → ${zipOut}`);
if (process.platform === 'win32') {
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${packRoot}' -DestinationPath '${zipOut}' -Force`,
    ],
    root,
  );
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
      serverEntry: 'apps/server/dist/index.mjs',
      noTsxAtRuntime: true,
      estimateMinutes: {
        note: 'download+extract+start wall clock',
        at_10mbps: +((st.size * 8) / 10e6 / 60 + 0.5).toFixed(2),
        at_20mbps: +((st.size * 8) / 20e6 / 60 + 0.4).toFixed(2),
        at_50mbps: +((st.size * 8) / 50e6 / 60 + 0.3).toFixed(2),
      },
      builtAt: new Date().toISOString(),
      nonce: randomBytes(4).toString('hex'),
    },
    null,
    2,
  ),
);

rmrf(staging);
rmrf(extractDir);

console.log('');
console.log(`[pack:teacher-host] OK ${mb} MB`);
console.log(`  ${zipOut}`);
console.log(`  sha256 ${digest}`);
console.log('  Gate: <5 min needs roughly zip/(Mbps/8) + ~30s extract/start');
console.log('');
