#!/usr/bin/env node
/**
 * Static check that packaged / built student desktop embeds exit-lock logic.
 * Does not install the Windows exe on macOS — pair with docs/EXIT_LOCK_MDM.md manual steps.
 *
 * Usage: npm run verify:exit-lock-packaged
 */
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
  if (src.includes('已锁定') && src.includes('exit-unlock') && src.includes('lock-badge')) {
    ok('ui.lockBadge', '已锁定 / exit-unlock / lock-badge');
  } else fail('ui.lockBadge', 'App.tsx missing lock UI markers');
}

const md = path.join(root, 'docs/EXIT_LOCK_MDM.md');
if (fs.existsSync(md)) ok('docs.mdm', 'docs/EXIT_LOCK_MDM.md');
else fail('docs.mdm', 'missing');

const checklist = path.join(root, 'docs/LOCAL_USB_CHECKLIST.md');
if (fs.existsSync(checklist) && /锁退出|退出锁定/.test(fs.readFileSync(checklist, 'utf8'))) {
  ok('docs.usbChecklist', '锁退出项存在');
} else fail('docs.usbChecklist', 'LOCAL_USB_CHECKLIST 缺少锁退出');

console.log('\nManual Windows install check: docs/EXIT_LOCK_MDM.md →「验证打包安装态退出锁定」');
const failed = log.filter((x) => !x.ok);
console.log(`\n${failed.length ? 'FAILED' : 'PASSED'} — ${log.length - failed.length}/${log.length} checks`);
if (failed.length) process.exit(1);
