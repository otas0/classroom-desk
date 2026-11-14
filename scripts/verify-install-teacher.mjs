#!/usr/bin/env node
/**
 * Ensures classroom teacher install: English entrypoints + auto-repair path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function ok(msg) {
  console.log(`OK  ${msg}`);
}
function fail(msg) {
  failures.push(msg);
  console.error(`FAIL  ${msg}`);
}
function mustExist(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) fail(`missing ${rel}`);
  else ok(`exists ${rel}`);
  return p;
}
function assertEnglishName(rel) {
  if (/[\u4e00-\u9fff]/.test(rel)) fail(`non-English path: ${rel}`);
}

for (const bad of ['安装.bat', '检查安装包.bat', '在Windows教师机上安装.txt']) {
  if (fs.existsSync(path.join(root, bad))) fail(`Chinese filename must be removed: ${bad}`);
}
ok('no Chinese install filenames in repo root');

mustExist('Install.bat');
mustExist('Check-Pack.bat');
mustExist('Install-Offline.bat');
mustExist('Install-Teacher.bat');
mustExist('Unblock-ClassroomDesk.bat');
const bat = mustExist('install-teacher.ps1');
assertEnglishName('Install.bat');
assertEnglishName('Check-Pack.bat');
assertEnglishName('install-teacher.ps1');

const installBat = fs.readFileSync(path.join(root, 'Install.bat'), 'utf8');
const checkBat = fs.readFileSync(path.join(root, 'Check-Pack.bat'), 'utf8');
const ps1Text = fs.readFileSync(bat, 'utf8');

if (!installBat.includes('install-teacher.ps1') || !installBat.includes('ChinaMirrorsFirst')) {
  fail('Install.bat must call install-teacher.ps1 -ChinaMirrorsFirst');
} else {
  ok('Install.bat → ps1 mirrors');
}
if (/[\u4e00-\u9fff]/.test(installBat)) fail('Install.bat must be English-only');
else ok('Install.bat English-only');

if (!checkBat.includes('-CheckOnly')) fail('Check-Pack.bat must use -CheckOnly');
else ok('Check-Pack.bat');

for (const needle of [
  'Repair-ProductPack',
  'Repair-FromProductZip',
  'Repair-StudentSetup',
  'Get-NetworkMinimumHelp',
  'Write-NetworkMinimumCard',
  'Set-ChinaNpmEnv',
  'registry.npmmirror.com',
  'Ensure-PortableNode',
  'Test-ProductReady',
  'Test-PackManifest',
  'Write-ReadyMarker',
  '-C',
  'Unblock-Tree',
  'Publish-StudentSetupToLan',
  'ClassroomDesk-Student-Install.txt',
  'ClassroomDesk-Network-Minimum.txt',
  'start:classroom',
  'HOST=0.0.0.0',
  'ZERO public network',
  'Write-PublicDeskFile',
  'Write-PrivateDeskFile',
  'Get-InteractiveUserDesktopDirs',
  'CommonDesktopDirectory',
  'Stop-ListeningPort',
  'Student-Setup.exe',
  'Teacher-Setup.exe',
  '-Wait -PassThru',
  'SYSTEM',
  'AtStartup',
  'ClassroomDesk-Health.url',
  'Port 8787 already in use',
]) {
  if (!ps1Text.includes(needle)) fail(`install-teacher.ps1 missing marker: ${needle}`);
}
ok('ps1 min-network repair markers');

const setupCmd = fs.readFileSync(path.join(root, 'setup-from-installer.cmd'), 'utf8');
if (
  !setupCmd.includes('Unblock-File') ||
  !setupCmd.includes('%USERPROFILE%\\Desktop\\ClassroomDesk-Desk-Login.txt') ||
  !setupCmd.includes('cd-keep-') ||
  !setupCmd.includes('Kept existing')
) {
  fail('setup-from-installer.cmd must unblock, preserve data, open teacher Desktop login');
} else {
  ok('setup-from-installer.cmd elevation-safe UX');
}

if (!ps1Text.includes('never Public') && !ps1Text.includes('not Public Desktop')) {
  fail('install-teacher.ps1 must keep login card off Public Desktop');
} else {
  ok('login card private desktop only');
}

const sfxBuild = fs.readFileSync(path.join(root, 'scripts/build-teacher-setup.mjs'), 'utf8');
if (sfxBuild.includes('InstallPath=')) {
  fail('build-teacher-setup must NOT InstallPath=C:\\ClassroomDesk (wipes live DB on re-run)');
} else if (!sfxBuild.includes('RunProgram="setup-from-installer.cmd"')) {
  fail('build-teacher-setup missing RunProgram setup-from-installer.cmd');
} else {
  ok('teacher SFX extracts to TEMP then merges');
}

const packText = fs.readFileSync(path.join(root, 'scripts/pack.mjs'), 'utf8');
if (!packText.includes("classroom.db") || !packText.includes('Never ship live DB')) {
  fail('pack.mjs must scrub classroom.db from Dist');
} else {
  ok('pack.mjs scrubs runtime DB');
}

if (/安装包不完整|检查安装包\.bat|不要在机房公网/.test(ps1Text)) {
  fail('install-teacher.ps1 still has Chinese lab-blocking copy');
} else {
  ok('ps1 English product copy');
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const s of ['pack', 'start:classroom']) {
  if (!pkg.scripts?.[s]) fail(`package.json missing script ${s}`);
}
ok('package.json scripts');

mustExist('scripts/pack.mjs');
mustExist('scripts/build-teacher-setup.mjs');
mustExist('setup-from-installer.cmd');
const packScript = fs.readFileSync(path.join(root, 'scripts/pack.mjs'), 'utf8');
if (
  !packScript.includes('PACK-MANIFEST.json') ||
  !packScript.includes('build-teacher-setup.mjs') ||
  !packScript.includes('Give-To-Teacher') ||
  !packScript.includes('Teacher-Setup.exe') ||
  !packScript.includes('SMOKE-CHECK.txt') ||
  !packScript.includes('LAB-GO-LIVE.txt')
) {
  fail('pack.mjs must build Give-To-Teacher / Teacher-Setup / SMOKE-CHECK / LAB-GO-LIVE');
} else {
  ok('pack.mjs Give-To-Teacher');
}

mustExist('docs/LAB_GO_LIVE.md');
mustExist('docs/SEMESTER_RESET.md');
mustExist('Give-To-Teacher/LAB-GO-LIVE.txt');
mustExist('Give-To-Teacher/SEMESTER-RESET.txt');
ok('lab go-live docs');

if (!packScript.includes('Teacher-Setup.exe.sha256') || !packScript.includes('createHash')) {
  fail('pack.mjs must write Setup SHA256 sidecars');
} else {
  ok('pack.mjs SHA256 sidecars');
}

if (!pkg.scripts?.['pack:teacher-setup']) fail('package.json missing pack:teacher-setup');
else ok('pack:teacher-setup script');

const onePager = fs.readFileSync(path.join(root, 'docs/CLASSROOM_DEPLOY_ONEPAGE.md'), 'utf8');
if (
  !onePager.includes('Give-To-Teacher') ||
  !onePager.includes('Teacher-Setup.exe') ||
  !onePager.includes('npm run pack')
) {
  fail('one-pager must lead with Give-To-Teacher / Teacher-Setup.exe');
} else {
  ok('deploy one-pager');
}

try {
  const touched = execFileSync('git', ['diff', '--name-only', 'origin/main'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean);
  console.warn(`note: ${touched.length} paths differ from origin/main (informational)`);
} catch (e) {
  console.warn('skip git diff check:', e.message);
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nverify-install-teacher: all checks passed');
