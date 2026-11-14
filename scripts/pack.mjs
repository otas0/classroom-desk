#!/usr/bin/env node
/**
 * Build the Classroom Desk product distribution (teacher + student).
 * Same folder works from Release zip, network share, USB stick, or any copy.
 *
 *   npm run pack
 *
 * Pack host needs network once. Classroom PCs only run Install.bat — no npm/GitHub.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.join(root, 'ClassroomDesk-Dist');
const desk = path.join(outRoot, 'ClassroomDesk');
const downloads = path.join(outRoot, 'downloads');
const students = path.join(outRoot, 'students');
const nodeVer = '22.14.0';
const nodeZipName = `node-v${nodeVer}-win-x64.zip`;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.0.0');
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const NPM_REGISTRIES = [
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com',
];

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}
function cpFile(src, dest) {
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function shouldSkip(rel) {
  const parts = rel.split(/[/\\]/);
  const skipDirs = new Set([
    'node_modules',
    '.git',
    'dist-electron',
    'release',
    'artifacts',
    'ClassroomDesk-Dist',
    'Give-To-Teacher',
    'ClassroomDesk-Teacher-USB',
    '.tmp-rel',
    'coverage',
    'playwright-report',
    'test-results',
    '.turbo',
    'e2e',
  ]);
  if (parts.some((p) => skipDirs.has(p))) return true;
  const norm = rel.replace(/\\/g, '/');
  if (
    parts.includes('dist') &&
    !norm.includes('apps/teacher-web/dist') &&
    !norm.includes('apps/server/dist')
  ) {
    return true;
  }
  return false;
}

function copyTree(srcDir, destDir, base = srcDir) {
  mkdirp(destDir);
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const from = path.join(srcDir, ent.name);
    const rel = path.relative(base, from);
    if (shouldSkip(rel)) continue;
    const to = path.join(destDir, ent.name);
    if (ent.isDirectory()) copyTree(from, to, base);
    else if (ent.isFile()) cpFile(from, to);
  }
}

function download(url, dest) {
  console.log('GET', url);
  const r = spawnSync('curl', ['-fsSL', '--connect-timeout', '20', '--max-time', '600', '-o', dest, url], {
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`download failed: ${url}`);
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 1_000_000) {
    throw new Error(`download too small: ${dest}`);
  }
}

function ensureNodeZip() {
  mkdirp(downloads);
  const dest = path.join(downloads, nodeZipName);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) {
    console.log('reuse', dest);
    return dest;
  }
  // Global pack host: official Node first, China mirrors as fallback.
  const urls = [
    `https://nodejs.org/dist/v${nodeVer}/${nodeZipName}`,
    `https://npmmirror.com/mirrors/node/v${nodeVer}/${nodeZipName}`,
    `https://cdn.npmmirror.com/binaries/node/v${nodeVer}/${nodeZipName}`,
  ];
  let last;
  for (const u of urls) {
    try {
      download(u, dest);
      return dest;
    } catch (e) {
      last = e;
      console.warn(String(e.message || e));
    }
  }
  throw last || new Error('node zip download failed');
}

function extractNode(zipPath) {
  const runtime = path.join(desk, 'runtime');
  mkdirp(runtime);
  const target = path.join(runtime, `node-v${nodeVer}-win-x64`);
  if (fs.existsSync(path.join(target, 'node.exe'))) {
    console.log('runtime Node already extracted');
    return;
  }
  console.log('extract Node →', runtime);
  if (process.platform === 'darwin' || process.platform === 'linux') {
    execFileSync('unzip', ['-qo', zipPath, '-d', runtime], { stdio: 'inherit' });
  } else {
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${runtime}' -Force`],
      { stdio: 'inherit' },
    );
  }
}

function runNpm(cwd, args, extraEnv = {}) {
  const base = {
    ...process.env,
    ...extraEnv,
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  };
  let last;
  for (const registry of NPM_REGISTRIES) {
    const env = {
      ...base,
      npm_config_registry: registry,
      ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
    };
    console.log('npm', args.join(' '), `(cwd=${cwd}, registry=${registry})`);
    try {
      execFileSync(npmBin, args, { cwd, stdio: 'inherit', env });
      return;
    } catch (e) {
      last = e;
      console.warn(`npm failed with ${registry}: ${e.message || e}`);
    }
  }
  throw last || new Error('npm failed on all registries');
}

function prepareHostArtifacts() {
  console.log('build teacher UI + fonts on pack host…');
  try {
    runNpm(root, ['run', 'fonts:cjk']);
  } catch {
    console.warn('fonts:cjk optional — continuing if fonts already present');
  }
  runNpm(root, ['run', 'build:teacher']);
  const dist = path.join(root, 'apps/teacher-web/dist/index.html');
  if (!fs.existsSync(dist)) throw new Error(`teacher build missing: ${dist}`);
}

function bundleServerForOffline() {
  const entry = path.join(root, 'apps/server/src/index.ts');
  const outFile = path.join(desk, 'apps/server/dist/index.mjs');
  mkdirp(path.dirname(outFile));
  console.log('bundle server →', outFile);
  let last;
  for (const registry of NPM_REGISTRIES) {
    try {
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
        {
          cwd: root,
          stdio: 'inherit',
          env: { ...process.env, npm_config_registry: registry },
        },
      );
      last = null;
      break;
    } catch (e) {
      last = e;
      console.warn(`esbuild via ${registry} failed: ${e.message || e}`);
    }
  }
  if (last) throw last;
  if (!fs.existsSync(outFile)) throw new Error('server bundle missing');
}

function installWinDepsOfflineReady() {
  console.log('npm install win32 deps (--ignore-scripts; no esbuild/electron postinstall)…');
  runNpm(
    desk,
    [
      'install',
      '--os=win32',
      '--cpu=x64',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    { npm_config_os: 'win32', npm_config_cpu: 'x64' },
  );
  bundleServerForOffline();

  const electronDist = path.join(desk, 'node_modules', 'electron', 'dist');
  if (fs.existsSync(electronDist)) rmrf(electronDist);

  const studentNm = path.join(desk, 'node_modules', '@classroom-desk', 'student-desktop');
  try {
    fs.unlinkSync(studentNm);
  } catch {
    try {
      fs.rmSync(studentNm, { force: true, recursive: true });
    } catch {
      /* ignore */
    }
  }
  const studentApp = path.join(desk, 'apps/student-desktop');
  if (fs.existsSync(studentApp)) {
    console.log('remove apps/student-desktop from teacher pack…');
    rmrf(studentApp);
  }
  for (const extra of ['electron', 'electron-builder', 'vite-plugin-electron', 'vite-plugin-electron-renderer']) {
    const p = path.join(desk, 'node_modules', extra);
    if (fs.existsSync(p)) rmrf(p);
  }

  const teacherDist = path.join(desk, 'apps/teacher-web/dist/index.html');
  if (!fs.existsSync(teacherDist)) {
    const hostDist = path.join(root, 'apps/teacher-web/dist');
    copyTree(hostDist, path.join(desk, 'apps/teacher-web/dist'), hostDist);
  }
  if (!fs.existsSync(teacherDist)) throw new Error('teacher dist missing in pack');
  if (!fs.existsSync(path.join(desk, 'node_modules'))) throw new Error('node_modules missing in pack');
  if (!fs.existsSync(path.join(desk, 'apps/server/dist/index.mjs'))) {
    throw new Error('server dist missing in pack');
  }

  // Never ship live DB / uploads into the product pack (re-install must not wipe teachers;
  // also avoids accidental mock/sample classroom data in the Dist).
  const dataRoot = path.join(desk, 'apps/server/data');
  for (const name of ['classroom.db', 'classroom.db-wal', 'classroom.db-shm', 'federation-peers.json']) {
    const p = path.join(dataRoot, name);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
  for (const name of ['backups', 'uploads']) {
    const p = path.join(dataRoot, name);
    if (fs.existsSync(p)) rmrf(p);
  }
  mkdirp(path.join(dataRoot, 'upgrades'));
  mkdirp(path.join(dataRoot, 'uploads'));
  if (fs.existsSync(path.join(desk, '.env'))) fs.rmSync(path.join(desk, '.env'), { force: true });

  const marker = {
    product: true,
    version,
    packedAt: new Date().toISOString(),
    platform: 'win32-x64',
    serverEntry: 'apps/server/dist/index.mjs',
    note: 'Official product distribution. Install.bat only — no npm on classroom PCs.',
  };
  const markerJson = JSON.stringify(marker, null, 2);
  fs.writeFileSync(path.join(desk, '.classroom-desk-ready'), markerJson, 'utf8');
  // Legacy marker name (accepted by install/start).
  fs.writeFileSync(path.join(desk, '.classroom-desk-offline-ready'), markerJson, 'utf8');
  console.log('wrote .classroom-desk-ready');

  const files = [
    { path: 'package.json', minBytes: 200 },
    { path: 'apps/teacher-web/dist/index.html', minBytes: 200 },
    { path: 'apps/server/dist/index.mjs', minBytes: 50_000 },
    { path: 'install-teacher.ps1', minBytes: 1000 },
    { path: 'Install.bat', minBytes: 200 },
  ];
  const nodeExe = path.join(desk, 'runtime', `node-v${nodeVer}-win-x64`, 'node.exe');
  if (fs.existsSync(nodeExe)) {
    files.push({ path: `runtime/node-v${nodeVer}-win-x64/node.exe`, minBytes: 1_000_000 });
  } else {
    files.push({ path: `downloads/${nodeZipName}`, minBytes: 1_000_000 });
  }
  const nm = path.join(desk, 'node_modules');
  if (fs.existsSync(nm)) {
    // Directory presence checked by install; record a sentinel package.
    const sentinel = 'node_modules/express/package.json';
    if (fs.existsSync(path.join(desk, sentinel))) {
      files.push({ path: sentinel, minBytes: 50 });
    }
  }
  const manifest = {
    version,
    packedAt: marker.packedAt,
    files,
    hint: 'Incomplete packs auto-repair via Install.bat / Teacher-Setup.exe (mirrors). Prefer a complete Dist when possible.',
  };
  fs.writeFileSync(path.join(desk, 'PACK-MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('wrote PACK-MANIFEST.json');
}

function copyStudentSetup() {
  mkdirp(students);
  const names = [
    `ClassroomDesk-Setup-${version}-x64.exe`,
    `ClassroomDesk-Setup-${version}.exe`,
  ];
  const search = [
    path.join(root, 'apps/student-desktop/release'),
    path.join(root, 'artifacts/windows-pack-check'),
    path.join(outRoot, 'students'),
    path.join(root, 'ClassroomDesk-Dist', 'students'),
    path.join(root, 'ClassroomDesk-Teacher-USB', 'students'),
  ];
  let copied = null;
  for (const dir of search) {
    if (!fs.existsSync(dir)) continue;
    for (const name of names) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) {
        const destName = name.includes('x64') ? name : `ClassroomDesk-Setup-${version}-x64.exe`;
        cpFile(p, path.join(students, destName));
        console.log('student Setup →', path.join(students, destName));
        copied = destName;
        break;
      }
    }
    if (copied) break;
  }
  if (!copied) {
    console.warn('WARN: student Setup.exe not found — copy manually into students/');
    return;
  }
  // Pre-seed LAN upgrades so after teacher Install, students pull from LAN (not public net).
  const upgrades = path.join(desk, 'apps/server/data/upgrades');
  mkdirp(upgrades);
  const seeded = path.join(upgrades, copied);
  cpFile(path.join(students, copied), seeded);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(seeded)).digest('hex');
  fs.writeFileSync(`${seeded}.sha256`, `${hash}  ${copied}\n`, 'utf8');
  console.log('LAN upgrades seed →', seeded, '+ .sha256');
}

function writeGiveToTeacher() {
  const give = path.join(root, 'Give-To-Teacher');
  rmrf(give);
  mkdirp(give);

  const teacherSetup = path.join(outRoot, 'ClassroomDesk-Teacher-Setup-x64.exe');
  const teacherVersioned = path.join(outRoot, `ClassroomDesk-Teacher-Setup-${version}-x64.exe`);
  const srcSetup = fs.existsSync(teacherSetup)
    ? teacherSetup
    : fs.existsSync(teacherVersioned)
      ? teacherVersioned
      : null;
  if (!srcSetup) throw new Error('Teacher Setup.exe missing — build-teacher-setup failed?');
  cpFile(srcSetup, path.join(give, 'Teacher-Setup.exe'));

  const studentSrc = path.join(students, `ClassroomDesk-Setup-${version}-x64.exe`);
  if (fs.existsSync(studentSrc)) {
    cpFile(studentSrc, path.join(give, 'Student-Setup.exe'));
  }

  function writeSha256(filePath, outName) {
    if (!fs.existsSync(filePath)) return;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    fs.writeFileSync(path.join(give, outName), `${hash}  ${path.basename(filePath)}\n`, 'utf8');
    fs.writeFileSync(path.join(outRoot, outName), `${hash}  ${path.basename(filePath)}\n`, 'utf8');
    console.log('SHA256', outName, hash.slice(0, 16) + '…');
  }
  writeSha256(path.join(give, 'Teacher-Setup.exe'), 'Teacher-Setup.exe.sha256');
  writeSha256(path.join(give, 'Student-Setup.exe'), 'Student-Setup.exe.sha256');

  const start = `Classroom Desk — install (< 5 min · aim ~1–2 min)

BEFORE class: copy this folder by USB/LAN (do not rely on slow public download in the classroom).

1. Double-click Teacher-Setup.exe
2. Desktop\\ClassroomDesk-Desk-Login.txt → log in (Admin opens)
3. Import roster into 本教室 (class is pre-created; easy-join is on)
4. Students: Desktop\\ClassroomDesk-Student-Install.txt → one link → Find classroom

SmartScreen? More info → Run anyway (unsigned — expected)

Details: docs/TIME_TO_CLASS.md · Optional: SMOKE-CHECK.txt · LAB-GO-LIVE.txt (exam only)
`;
  const timeDoc = path.join(root, 'docs/TIME_TO_CLASS.md');
  if (fs.existsSync(timeDoc)) cpFile(timeDoc, path.join(desk, 'docs/TIME_TO_CLASS.md'));
  fs.writeFileSync(path.join(give, 'START-HERE.txt'), start, 'utf8');
  fs.writeFileSync(path.join(outRoot, 'START-HERE.txt'), start, 'utf8');

  const smoke = `Classroom Desk — optional smoke (after Teacher-Setup)

[ ] Admin opens and login works (Desktop login card)
[ ] Student opens ClassroomDesk-Student-Install.txt link → Find classroom
[ ] Teacher sees the student online

If Setup failed: Desktop\\ClassroomDesk-Install-Log.txt
SmartScreen: More info → Run anyway (unsigned — expected)
`;
  fs.writeFileSync(path.join(give, 'SMOKE-CHECK.txt'), smoke, 'utf8');
  fs.writeFileSync(path.join(outRoot, 'SMOKE-CHECK.txt'), smoke, 'utf8');

  const labGoLive = `Classroom Desk — lab go-live (before every classroom)

1) Pilot ONE teacher PC
   - Run Teacher-Setup.exe
   - Complete SMOKE-CHECK.txt
   - Only then copy Give-To-Teacher to other rooms

2) Fixed LAN IP on the teacher PC
   - Prefer Ethernet
   - Static IPv4 or router DHCP reservation
   - After IP change, refresh Desktop\\ClassroomDesk-Student-Install.txt
   - IT helper in full pack: scripts\\windows-set-fixed-ip.ps1

3) Antivirus allowlist (do NOT turn Defender off)
   - Allow: C:\\ClassroomDesk\\
   - Allow: Teacher-Setup.exe and Student-Setup.exe you distribute
   - Unsigned builds may still show SmartScreen → More info → Run anyway
   - That is expected until the files are code-signed

4) Backup
   - Copy regularly: C:\\ClassroomDesk\\apps\\server\\data\\classroom.db
   - (Optional: whole apps\\server\\data\\ folder)

5) Updates (hot update)
   - Student app: default force same version; LAN /upgrades/ only
   - Teacher Admin → sync student packages (GitHub) OR upload Setup.exe
   - Big teacher host change → new Teacher-Setup.exe (opt-in teacher-code update needs GitHub+npm)
   - Day-1: Student-Setup is pre-seeded into upgrades/ by Teacher-Setup

6) Signing
   - With a cert: sign both Setup.exe in release CI
   - Without a cert: do not promise "no SmartScreen"

7) Guest Wi-Fi / client isolation
   - If students cannot reach the teacher, "Find classroom" fails
   - Teacher PC on Ethernet, or ask IT to allow student ↔ teacher TCP 8787
`;
  fs.writeFileSync(path.join(give, 'LAB-GO-LIVE.txt'), labGoLive, 'utf8');
  fs.writeFileSync(path.join(outRoot, 'LAB-GO-LIVE.txt'), labGoLive, 'utf8');
  const labMd = path.join(root, 'docs/LAB_GO_LIVE.md');
  if (fs.existsSync(labMd)) cpFile(labMd, path.join(desk, 'docs/LAB_GO_LIVE.md'));
  const semMd = path.join(root, 'docs/SEMESTER_RESET.md');
  if (fs.existsSync(semMd)) cpFile(semMd, path.join(desk, 'docs/SEMESTER_RESET.md'));

  const semester = `Classroom Desk — semester reset

1) Backup C:\\ClassroomDesk\\apps\\server\\data\\classroom.db (USB / school share)
2) Keep or clear old classes/rosters in Admin
3) Rotate teacher/admin passwords; discard old Desktop login card
4) If student app version changed: publish new Setup to LAN /upgrades/
5) Re-run SMOKE-CHECK.txt on the pilot teacher PC

Details: docs/SEMESTER_RESET.md
`;
  fs.writeFileSync(path.join(give, 'SEMESTER-RESET.txt'), semester, 'utf8');
  fs.writeFileSync(path.join(outRoot, 'SEMESTER-RESET.txt'), semester, 'utf8');
  console.log('Give-To-Teacher →', give);
}

console.log('pack →', outRoot);
prepareHostArtifacts();

mkdirp(outRoot);
rmrf(desk);
mkdirp(desk);

console.log('copy source…');
copyTree(root, desk);
for (const f of [
  'Install.bat',
  'Check-Pack.bat',
  'Install-Teacher.bat',
  'Install-Offline.bat',
  'install-teacher.ps1',
  'Unblock-ClassroomDesk.bat',
  'setup-from-installer.cmd',
]) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) cpFile(src, path.join(desk, f));
}

const zip = ensureNodeZip();
cpFile(zip, path.join(desk, 'downloads', nodeZipName));
extractNode(zip);
installWinDepsOfflineReady();
copyStudentSetup();

console.log('build one-click teacher Setup.exe…');
execFileSync(process.execPath, [path.join(root, 'scripts/build-teacher-setup.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
writeGiveToTeacher();

console.log('\nDone.');
console.log('Hand teachers this folder only:');
console.log(path.join(root, 'Give-To-Teacher'));
console.log('  → double-click Teacher-Setup.exe');
