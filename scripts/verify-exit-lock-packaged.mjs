#!/usr/bin/env node
/**
 * Static check that packaged / built student desktop embeds exit-lock logic.
 * Does not install the Windows exe on macOS — pair with docs/EXIT_LOCK_MDM.md manual steps.
 *
 * Usage: npm run verify:exit-lock-packaged
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = [];
function ok(name, detail = '') {
  log.push({ ok: true, name, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail) {
  log.push({ ok: false, name, detail });
  console.error(`✗ ${name} — ${detail}`);
}

const mainCandidates = [
  path.join(root, 'apps/student-desktop/dist-electron/main.js'),
  path.join(root, 'apps/student-desktop/electron/main.ts'),
];
const preloadCandidates = [
  path.join(root, 'apps/student-desktop/dist-electron/preload.js'),
  path.join(root, 'apps/student-desktop/electron/preload.ts'),
];

function firstExisting(paths) {
  return paths.find((p) => fs.existsSync(p));
}

const mainPath = firstExisting(mainCandidates);
const preloadPath = firstExisting(preloadCandidates);

if (!mainPath) fail('main', 'missing dist-electron/main.js and electron/main.ts');
else {
  const src = fs.readFileSync(mainPath, 'utf8');
  const needles = ['exitAllowed', 'before-quit', 'lock:grant-exit-and-quit', 'lock:blocked-close', 'setClosable'];
  const missing = needles.filter((n) => !src.includes(n));
  if (missing.length) fail('main.lockSymbols', `missing ${missing.join(', ')} in ${path.relative(root, mainPath)}`);
  else ok('main.lockSymbols', path.relative(root, mainPath));
}

if (!preloadPath) fail('preload', 'missing preload');
else {
  const src = fs.readFileSync(preloadPath, 'utf8');
  const needles = ['grantExitAndQuit', 'setExitAllowed', 'onBlockedClose', 'getExitLockState'];
  const missing = needles.filter((n) => !src.includes(n));
  if (missing.length) fail('preload.lockSymbols', `missing ${missing.join(', ')}`);
  else ok('preload.lockSymbols', path.relative(root, preloadPath));
}

const ui = path.join(root, 'apps/student-desktop/src/App.tsx');
if (fs.existsSync(ui)) {
  const src = fs.readFileSync(ui, 'utf8');
  if (
    src.includes('已锁定') &&
    src.includes('exit-unlock') &&
    src.includes('lock-badge') &&
    src.includes('aria-live')
  ) {
    ok('ui.lockBadge', '已锁定 / exit-unlock / lock-badge / aria-live');
  } else fail('ui.lockBadge', 'App.tsx missing lock UI markers');
  if (src.includes('exit-lock/ws') || src.includes('WebSocket')) ok('ui.ws', 'WebSocket client');
  else fail('ui.ws', 'missing WebSocket subscribe');
}

const md = path.join(root, 'docs/EXIT_LOCK_MDM.md');
if (fs.existsSync(md)) {
  const body = fs.readFileSync(md, 'utf8');
  if (/stateDiagram/.test(body) && /Assigned Access/i.test(body) && /Intune/i.test(body)) {
    ok('docs.mdm', 'state machine + MDM + Intune');
  } else fail('docs.mdm', 'missing mermaid stateDiagram / Assigned Access / Intune');
} else fail('docs.mdm', 'missing');

const intuneXml = path.join(root, 'docs/intune-student-kiosk.example.xml');
if (fs.existsSync(intuneXml) && /HideTaskManager|SYNCML/i.test(fs.readFileSync(intuneXml, 'utf8'))) {
  ok('docs.intuneXml', 'intune-student-kiosk.example.xml');
} else fail('docs.intuneXml', 'missing Intune XML example');

const checklist = path.join(root, 'docs/LOCAL_USB_CHECKLIST.md');
if (fs.existsSync(checklist) && /C2\.|锁退出/.test(fs.readFileSync(checklist, 'utf8'))) {
  ok('docs.usbChecklist', 'C2 锁退出项存在');
} else fail('docs.usbChecklist', 'LOCAL_USB_CHECKLIST 缺少 C2 锁退出');

const exeDirs = [
  path.join(root, 'apps/student-desktop/release'),
  path.join(root, 'artifacts'),
  path.join(root, 'artifacts'),
];
const exes = [];
for (const dir of exeDirs) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (/ClassroomDesk.*\.exe$/i.test(name)) exes.push(path.join(dir, name));
  }
}
if (exes.length) {
  ok('release.exe', `${exes.length} found; e.g. ${path.relative(root, exes[0])}`);
  let shaChecked = 0;
  let shaBad = 0;
  for (const exe of exes) {
    const side = `${exe}.sha256`;
    if (!fs.existsSync(side)) continue;
    shaChecked += 1;
    const expected = fs.readFileSync(side, 'utf8').trim().split(/\s+/)[0]?.toLowerCase();
    const actual = createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
    if (!expected || expected !== actual) {
      shaBad += 1;
      fail('release.sha256', `${path.relative(root, exe)} expected=${expected} actual=${actual}`);
    }
  }
  if (shaChecked && !shaBad) ok('release.sha256', `${shaChecked} sidecar(s) match`);
  else if (!shaChecked && process.env.REQUIRE_WIN_EXE === '1') {
    fail('release.sha256', 'REQUIRE_WIN_EXE=1 but no .exe.sha256 sidecars beside installers');
  } else if (!shaChecked) {
    ok('release.sha256', 'skipped (no .sha256 sidecars)');
  }
} else if (process.env.REQUIRE_WIN_EXE === '1') {
  fail('release.exe', 'REQUIRE_WIN_EXE=1 but no ClassroomDesk*.exe under release/artifacts/releases');
} else {
  ok('release.exe', 'skipped (no exe yet; windows-pack sets REQUIRE_WIN_EXE=1)');
}

const ciYml = path.join(root, '.github/workflows/ci.yml');
if (fs.existsSync(ciYml)) {
  const yml = fs.readFileSync(ciYml, 'utf8');
  if (
    /REQUIRE_WIN_EXE:\s*['"]?1['"]?/.test(yml) &&
    /if-no-files-found:\s*error/.test(yml) &&
    /classroom-desk-windows-setup/.test(yml)
  ) {
    ok('ci.windowsPack', 'REQUIRE_WIN_EXE=1 + artifact hard-fail + archive name');
  } else fail('ci.windowsPack', 'ci.yml missing REQUIRE_WIN_EXE / if-no-files-found:error / artifact');
} else fail('ci.windowsPack', 'missing .github/workflows/ci.yml');

console.log('\nManual Windows install check: docs/EXIT_LOCK_MDM.md →「验证打包安装态退出锁定」');
const failed = log.filter((x) => !x.ok);
console.log(`\n${failed.length ? 'FAILED' : 'PASSED'} — ${log.length - failed.length}/${log.length} checks`);
if (failed.length) process.exit(1);
