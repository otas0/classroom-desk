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
    // Never copy host runtime (Mac/Linux Node) into the Windows product pack.
    'runtime',
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

function assertWindowsNodeExe(exePath) {
  if (!fs.existsSync(exePath)) throw new Error(`Windows node.exe missing: ${exePath}`);
  const fd = fs.openSync(exePath, 'r');
  const buf = Buffer.alloc(4);
  try {
    fs.readSync(fd, buf, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  // PE MZ — never ship Mach-O from a Mac pack host
  if (buf[0] === 0x4d && buf[1] === 0x5a) return;
  const magic = buf.toString('hex');
  throw new Error(
    `FATAL: runtime node.exe is not a Windows PE (magic=${magic}). ` +
      `Mac Node must never enter Teacher-Setup. Delete runtime/ and re-pack.`,
  );
}

function extractNode(zipPath) {
  const runtime = path.join(desk, 'runtime');
  mkdirp(runtime);
  const target = path.join(runtime, `node-v${nodeVer}-win-x64`);
  const exe = path.join(target, 'node.exe');
  // Always wipe non-Windows leftovers (e.g. accidental host runtime copy via copyTree).
  if (fs.existsSync(exe)) {
    try {
      assertWindowsNodeExe(exe);
      console.log('runtime Windows Node already extracted');
      return;
    } catch {
      console.warn('removing invalid/non-Windows node.exe before re-extract…');
      rmrf(target);
    }
  }
  // Also remove any darwin/linux node dirs that copyTree may have pulled in.
  for (const ent of fs.readdirSync(runtime, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (/darwin|linux|arm64|macos/i.test(ent.name) && !/win-/i.test(ent.name)) {
      console.warn('slim: remove non-Windows runtime', ent.name);
      rmrf(path.join(runtime, ent.name));
    }
  }
  console.log('extract Windows Node →', runtime);
  if (process.platform === 'darwin' || process.platform === 'linux') {
    execFileSync('unzip', ['-qo', zipPath, '-d', runtime], { stdio: 'inherit' });
  } else {
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${runtime}' -Force`],
      { stdio: 'inherit' },
    );
  }
  assertWindowsNodeExe(exe);
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
      // Node 24 on Windows: execFileSync('npm.cmd', …) → EINVAL; use cmd /c.
      if (process.platform === 'win32') {
        execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', ['npm', ...args].join(' ')], {
          cwd,
          stdio: 'inherit',
          env,
        });
      } else {
        execFileSync(npmBin, args, { cwd, stdio: 'inherit', env });
      }
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

  // Drop test/CI trees from product Dist.
  for (const rel of [
    'e2e',
    'artifacts',
    '.github',
    'apps/server/src/test',
    'apps/teacher-web/src',
    'docs/posters',
  ]) {
    const p = path.join(desk, rel);
    if (fs.existsSync(p)) {
      rmrf(p);
      console.log('slim: removed', rel);
    }
  }

  const marker = {
    product: true,
    version,
    packedAt: new Date().toISOString(),
    platform: 'win32-x64',
    serverEntry: 'apps/server/dist/index.mjs',
    note:
      'Official product distribution. Windows Node is NOT in the Dist zip — Teacher-Setup.exe embeds win-x64 Node; Bootstrap/Install downloads official win-x64 Node if missing.',
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
  // Node is intentionally absent from Dist zip; Teacher-Setup embeds it. Optional local runtime/zip for pack-time SFX only.
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

  const bootSetup = path.join(outRoot, 'ClassroomDesk-Teacher-Bootstrap-x64.exe');
  const bootVersioned = path.join(outRoot, `ClassroomDesk-Teacher-Bootstrap-${version}-x64.exe`);
  const srcBoot = fs.existsSync(bootSetup)
    ? bootSetup
    : fs.existsSync(bootVersioned)
      ? bootVersioned
      : null;
  if (srcBoot) cpFile(srcBoot, path.join(give, 'Teacher-Bootstrap.exe'));

  const fixSetup = path.join(outRoot, 'ClassroomDesk-Service-Fix-x64.exe');
  const fixVersioned = path.join(outRoot, `ClassroomDesk-Service-Fix-${version}-x64.exe`);
  const srcFix = fs.existsSync(fixSetup)
    ? fixSetup
    : fs.existsSync(fixVersioned)
      ? fixVersioned
      : null;
  if (!srcFix) {
    throw new Error('Service-Fix.exe missing — every teacher pack must include all patches (see patches/README.md)');
  }
  cpFile(srcFix, path.join(give, 'Service-Fix.exe'));
  const launcherGive = path.join(outRoot, 'ClassroomDesk.exe');
  if (fs.existsSync(launcherGive)) cpFile(launcherGive, path.join(give, 'ClassroomDesk.exe'));
  const teacherFixGive = path.join(outRoot, 'ClassroomDesk-Teacher-Fix-x64.exe');
  if (fs.existsSync(teacherFixGive)) cpFile(teacherFixGive, path.join(give, 'Teacher-Fix.exe'));
  embedResetTeacherLogin(path.join(give, 'Reset-Teacher-Login'));
  const resetDoc = path.join(root, 'docs/RESET_TEACHER_LOGIN.md');
  if (fs.existsSync(resetDoc)) {
    cpFile(resetDoc, path.join(give, 'Reset-Teacher-Login', 'README.md'));
  }

  const studentSrc = path.join(students, `ClassroomDesk-Setup-${version}-x64.exe`);
  if (fs.existsSync(studentSrc)) {
    cpFile(studentSrc, path.join(give, 'Student-Setup.exe'));
  } else {
    console.warn(
      `WARN: Student-Setup for ${version} missing — rebuild with npm run dist:win before release`,
    );
  }

  function writeSha256(filePath, outName) {
    if (!fs.existsSync(filePath)) return;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    fs.writeFileSync(path.join(give, outName), `${hash}  ${path.basename(filePath)}\n`, 'utf8');
    fs.writeFileSync(path.join(outRoot, outName), `${hash}  ${path.basename(filePath)}\n`, 'utf8');
    console.log('SHA256', outName, hash.slice(0, 16) + '…');
  }
  writeSha256(path.join(give, 'Teacher-Setup.exe'), 'Teacher-Setup.exe.sha256');
  writeSha256(path.join(give, 'Teacher-Bootstrap.exe'), 'Teacher-Bootstrap.exe.sha256');
  writeSha256(path.join(give, 'Service-Fix.exe'), 'Service-Fix.exe.sha256');
  writeSha256(path.join(give, 'Teacher-Fix.exe'), 'Teacher-Fix.exe.sha256');
  writeSha256(path.join(give, 'ClassroomDesk.exe'), 'ClassroomDesk.exe.sha256');
  writeSha256(path.join(give, 'Student-Setup.exe'), 'Student-Setup.exe.sha256');

  const start = `Classroom Desk — install (< 5 min · aim ~1 min)

TEACHER EXEs (full table: docs/TEACHER_EXES.md on GitHub)

1. FIRST TIME: Teacher-Setup.exe
   → full install + Desktop shortcuts:
      Classroom Desk / Classroom Desk Admin / Classroom Desk Fix
2. EVERY DAY: Desktop → "Classroom Desk"
3. BROKEN Node/password: Desktop → "Classroom Desk Fix"  (= Teacher-Fix.exe)
4. Only /health dead: Service-Fix.exe

Students: Public Desktop install card → open app → tap your name
DEFAULT LOGIN: teacher / admin → change in Admin → Settings
ONLINE thin: Teacher-Bootstrap.exe

Backup: Desktop\\ClassroomDesk-Desk-Login.txt
SmartScreen? More info → Run anyway
`;
  const timeDoc = path.join(root, 'docs/TIME_TO_CLASS.md');
  if (fs.existsSync(timeDoc)) cpFile(timeDoc, path.join(desk, 'docs/TIME_TO_CLASS.md'));
  fs.writeFileSync(path.join(give, 'START-HERE.txt'), start, 'utf8');
  fs.writeFileSync(path.join(outRoot, 'START-HERE.txt'), start, 'utf8');

  const smoke = `Classroom Desk — optional smoke (after Teacher-Setup)

[ ] Admin opens already logged in on roster import
[ ] Import a short roster
[ ] Student: Public Desktop\\ClassroomDesk-Student-Install.txt → Find classroom
[ ] Teacher sees the student online

If auto-login failed: Desktop\\ClassroomDesk-Desk-Login.txt
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

/** Patches that must exist in every latest teacher Dist / Teacher-Setup / Give-To-Teacher. */
const REQUIRED_PATCHES = [
  {
    id: 'service-fix',
    rel: 'patches/Service-Fix.exe',
    minBytes: 50_000,
    note: 'Local API /health + reject Mac Node (win-x64 reinstall)',
  },
  {
    id: 'reset-teacher-login',
    rel: 'patches/Reset-Teacher-Login.bat',
    minBytes: 200,
    note: 'Reset login to teacher/admin; change password in Admin settings',
  },
  {
    id: 'teacher-launcher',
    rel: 'patches/ClassroomDesk.exe',
    minBytes: 50_000,
    note: 'Daily one-click start (force Windows Node + API + Admin)',
  },
  {
    id: 'teacher-fix',
    rel: 'patches/Teacher-Fix.exe',
    minBytes: 50_000,
    note: 'One-click Node repair + reset teacher/admin login',
  },
];

const RESET_LOGIN_FILES = [
  'Reset-Teacher-Login.bat',
  'reset-teacher-login.ps1',
  'reset-teacher-login.mjs',
  'Force-Windows-Node.bat',
  'Fix-Teacher-PC.bat',
  'ensure-windows-node.ps1',
  'Start-ClassroomDesk.cmd',
];

function resolveServiceFixExe() {
  const fixSetup = path.join(outRoot, 'ClassroomDesk-Service-Fix-x64.exe');
  const fixVersioned = path.join(outRoot, `ClassroomDesk-Service-Fix-${version}-x64.exe`);
  if (fs.existsSync(fixSetup)) return fixSetup;
  if (fs.existsSync(fixVersioned)) return fixVersioned;
  return null;
}

function embedResetTeacherLogin(targetDir) {
  mkdirp(targetDir);
  for (const name of RESET_LOGIN_FILES) {
    const src = path.join(root, name);
    if (!fs.existsSync(src)) throw new Error(`Missing ${name} — required reset-teacher-login patch`);
    cpFile(src, path.join(targetDir, name));
  }
}

function buildAndEmbedRequiredPatches() {
  console.log('build Service-Fix.exe (required patch — every release)…');
  execFileSync(process.execPath, [path.join(root, 'scripts/build-service-fix.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  const srcFix = resolveServiceFixExe();
  if (!srcFix) throw new Error('Service-Fix.exe missing after build');

  console.log('build ClassroomDesk.exe (daily launcher)…');
  execFileSync(process.execPath, [path.join(root, 'scripts/build-teacher-launcher.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  console.log('build Teacher-Fix.exe (Node + login reset)…');
  execFileSync(process.execPath, [path.join(root, 'scripts/build-teacher-fix.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });

  const patchesDir = path.join(desk, 'patches');
  mkdirp(patchesDir);
  const readmeSrc = path.join(root, 'patches/README.md');
  if (fs.existsSync(readmeSrc)) cpFile(readmeSrc, path.join(patchesDir, 'README.md'));
  cpFile(srcFix, path.join(patchesDir, 'Service-Fix.exe'));
  // Also at pack root so Install / Service-Fix discovery is obvious on disk.
  cpFile(srcFix, path.join(desk, 'Service-Fix.exe'));
  console.log('embedded Service-Fix → ClassroomDesk/patches/ + ClassroomDesk/');

  embedResetTeacherLogin(desk);
  embedResetTeacherLogin(patchesDir);
  console.log('embedded Reset-Teacher-Login → ClassroomDesk/ + ClassroomDesk/patches/');

  const launcher = path.join(outRoot, 'ClassroomDesk.exe');
  const teacherFix = path.join(outRoot, 'ClassroomDesk-Teacher-Fix-x64.exe');
  if (!fs.existsSync(launcher)) throw new Error('ClassroomDesk.exe missing after launcher build');
  if (!fs.existsSync(teacherFix)) throw new Error('Teacher-Fix.exe missing after fix build');
  cpFile(launcher, path.join(desk, 'ClassroomDesk.exe'));
  cpFile(launcher, path.join(patchesDir, 'ClassroomDesk.exe'));
  cpFile(teacherFix, path.join(desk, 'Teacher-Fix.exe'));
  cpFile(teacherFix, path.join(patchesDir, 'Teacher-Fix.exe'));
  console.log('embedded ClassroomDesk.exe + Teacher-Fix.exe → pack + patches/');

  for (const p of REQUIRED_PATCHES) {
    const full = path.join(desk, p.rel);
    if (!fs.existsSync(full) || fs.statSync(full).size < p.minBytes) {
      throw new Error(`Required patch missing or too small: ${p.rel} (${p.note})`);
    }
  }
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
  'Start-ClassroomDesk.cmd',
  'fix-classroom-service.ps1',
  'setup-service-fix.cmd',
  'ensure-windows-node.ps1',
  ...RESET_LOGIN_FILES,
]) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) cpFile(src, path.join(desk, f));
}

// Win-x64 Node for Teacher-Setup.exe only (assert PE). Dist zip must NOT ship Node.
const zip = ensureNodeZip();
cpFile(zip, path.join(desk, 'downloads', nodeZipName));
extractNode(zip);
assertWindowsNodeExe(path.join(desk, 'runtime', `node-v${nodeVer}-win-x64`, 'node.exe'));
installWinDepsOfflineReady();
copyStudentSetup();

// Patches first so Teacher-Setup SFX always contains them.
buildAndEmbedRequiredPatches();

console.log('build one-click teacher Setup.exe (embeds Windows win-x64 Node)…');
execFileSync(process.execPath, [path.join(root, 'scripts/build-teacher-setup.mjs')], {
  cwd: root,
  stdio: 'inherit',
});

// After Teacher-Setup is baked: strip Node from Dist tree so ClassroomDesk-*-win-x64.zip stays Node-free.
// Install/Bootstrap will download official win-x64 Node; Teacher-Setup already carries it.
function stripNodeFromDistTree() {
  const runtime = path.join(desk, 'runtime');
  if (fs.existsSync(runtime)) {
    rmrf(runtime);
    console.log('strip Dist: removed runtime/ (Node stays inside Teacher-Setup.exe only)');
  }
  const dlNode = path.join(desk, 'downloads', nodeZipName);
  if (fs.existsSync(dlNode)) {
    fs.rmSync(dlNode, { force: true });
    console.log('strip Dist: removed downloads/', nodeZipName);
  }
  // Keep an empty downloads/ for install scripts that mkdir into it.
  mkdirp(path.join(desk, 'downloads'));
  fs.writeFileSync(
    path.join(desk, 'downloads', 'README-NODE.txt'),
    [
      'Portable Node is NOT shipped in ClassroomDesk-*-win-x64.zip.',
      'Teacher-Setup.exe embeds official Windows win-x64 Node.',
      'Bootstrap / Install.bat download win-x64 Node from nodejs.org / npmmirror when missing.',
      '',
    ].join('\n'),
    'utf8',
  );
}
stripNodeFromDistTree();

console.log('build thin Teacher-Bootstrap.exe (public / slow links)…');
try {
  execFileSync(process.execPath, [path.join(root, 'scripts/build-teacher-bootstrap.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
} catch (e) {
  console.warn('Teacher-Bootstrap build skipped:', e instanceof Error ? e.message : e);
}
writeGiveToTeacher();

console.log('\nDone.');
console.log('Hand teachers this folder only:');
console.log(path.join(root, 'Give-To-Teacher'));
console.log('  → Teacher-Setup.exe (includes Windows Node) + Service-Fix.exe');
console.log('  Dist zip has NO Node — Install downloads win-x64 Node if needed');
