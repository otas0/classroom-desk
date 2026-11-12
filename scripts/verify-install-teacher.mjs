#!/usr/bin/env node
/**
 * Ensures teacher easy-install stays additive (no product-app coupling)
 * and that download targets + required scripts exist.
 *
 * Usage: node scripts/verify-install-teacher.mjs
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

const bat = mustExist('Install-Teacher.bat');
const ps1 = mustExist('install-teacher.ps1');
assertEnglishName('Install-Teacher.bat');
assertEnglishName('install-teacher.ps1');
assertEnglishName('ClassroomDesk-Desk-Login.txt');

const batText = fs.readFileSync(bat, 'utf8');
const ps1Text = fs.readFileSync(ps1, 'utf8');

if (!batText.includes('install-teacher.ps1')) fail('Install-Teacher.bat must call install-teacher.ps1');
else ok('bat → ps1');

for (const needle of [
  'Ensure-PortableNode',
  'nodejs.org/dist',
  'archive/refs/tags',
  'ClassroomDesk-Desk-Login.txt',
  'start:classroom',
  'build:teacher',
  'fonts:cjk',
  'HOST=0.0.0.0',
  'Classroom Desk API',
  'ClassroomDeskServer',
]) {
  if (!ps1Text.includes(needle)) fail(`install-teacher.ps1 missing marker: ${needle}`);
}
ok('ps1 required markers');

if (/讲台登录|教师机一键安装\.bat|windows-teacher-easy-setup/.test(ps1Text)) {
  fail('install-teacher.ps1 still references old Chinese/legacy names');
} else {
  ok('no legacy Chinese install filenames in ps1');
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const s of ['start:classroom', 'start:server', 'build:teacher', 'fonts:cjk']) {
  if (!pkg.scripts?.[s]) fail(`package.json missing script ${s}`);
}
ok('package.json teacher scripts present');

// Product body must still be present — install is additive only
for (const rel of [
  'apps/server/package.json',
  'apps/teacher-web/package.json',
  'apps/student-desktop/package.json',
  'scripts/start-classroom.mjs',
  'scripts/teacher-host-restart.mjs',
]) {
  mustExist(rel);
}

const nodeVer = '22.14.0';
const nodeZip = `https://nodejs.org/dist/v${nodeVer}/node-v${nodeVer}-win-x64.zip`;
const tag = pkg.version ? `v${pkg.version}` : 'v0.1.8';
const srcZip = `https://github.com/otas0/classroom-desk/archive/refs/tags/${tag}.zip`;

function curlReachable(url, label) {
  try {
    const out = execFileSync(
      'curl',
      ['-sI', '-L', '--max-time', '45', '-A', 'classroom-desk-verify-install-teacher', url],
      { encoding: 'utf8', maxBuffer: 2_000_000 },
    );
    const m = out.match(/HTTP\/\d(?:\.\d)?\s+(\d+)/g);
    const last = m && m.length ? m[m.length - 1] : '';
    const code = Number((last.match(/(\d+)$/) || [])[1] || 0);
    if (code >= 200 && code < 400) ok(`${label} HTTP ${code}`);
    else fail(`${label} HTTP ${code || '??'}: ${url}`);
  } catch (e) {
    fail(`${label} unreachable: ${e.message}`);
  }
}

curlReachable(nodeZip, 'portable Node zip');
curlReachable(srcZip, `release source zip ${tag}`);

// Confirm current tree scripts match what a zip install would run
const startClassroom = fs.readFileSync(path.join(root, 'scripts/start-classroom.mjs'), 'utf8');
if (!startClassroom.includes('build:teacher') || !startClassroom.includes('start:server')) {
  fail('start-classroom.mjs does not build/start teacher server as expected');
} else {
  ok('start-classroom.mjs wiring');
}

// Ignore product regression: ensure this branch did not modify apps/ vs intent
// (verify script itself only checks local tree integrity)
try {
  const diff = execFileSync('git', ['diff', '--name-only', 'origin/main'], {
    cwd: root,
    encoding: 'utf8',
  });
  const touched = diff
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const productHits = touched.filter(
    (f) =>
      /^(apps\/(server|teacher-web|student-desktop)|packages\/)/.test(f) &&
      !/\.test\.(ts|tsx|mjs|js)$/.test(f) &&
      !/\/test\//.test(f),
  );
  if (productHits.length) {
    fail(`product runtime paths changed vs origin/main:\n  ${productHits.join('\n  ')}`);
  } else {
    ok(`no apps/packages runtime diffs vs origin/main (${touched.length} changed paths)`);
  }
} catch (e) {
  console.warn('skip git diff check:', e.message);
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nverify-install-teacher: all checks passed');
