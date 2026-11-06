#!/usr/bin/env node
/**
 * Validate unsigned USB release artifacts + Windows host scripts (syntax / presence).
 * Does not run Windows PowerShell on macOS; prints the exact commands for a Windows teacher PC.
 *
 * Usage: npm run verify:usb-host
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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

const requiredScripts = [
  'scripts/windows-teacher-host.ps1',
  'scripts/windows-autostart-server.ps1',
  'scripts/windows-set-fixed-ip.ps1',
  'scripts/copy-usb-release.sh',
  'docs/LOCAL_USB_CHECKLIST.md',
  'docs/CLASSROOM_TEACHER_HOST.md',
];

for (const rel of requiredScripts) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) ok('file', rel);
  else fail('file', `missing ${rel}`);
}

const hostPs1 = path.join(root, 'scripts/windows-teacher-host.ps1');
const hostText = fs.readFileSync(hostPs1, 'utf8');
if (/Param\s*\(/i.test(hostText) && /SmokeTest/.test(hostText) && /8787/.test(hostText)) {
  ok('host.ps1.contract', 'SmokeTest + port 8787 present');
} else {
  fail('host.ps1.contract', 'expected SmokeTest / 8787 markers');
}

if (process.platform === 'win32') {
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Get-Command Test-Path; . '${hostPs1.replace(/'/g, "''")}' -? 2>$null; $true`],
    { encoding: 'utf8' },
  );
  if (r.status === 0) ok('host.ps1.windowsLoad', 'powershell reachable');
  else fail('host.ps1.windowsLoad', r.stderr || r.stdout || `status=${r.status}`);
} else {
  ok('host.ps1.skipRun', `platform=${process.platform} — run on Windows: powershell -ExecutionPolicy Bypass -File .\\scripts\\windows-teacher-host.ps1 -SmokeTest`);
}

const artDir = path.join(root, 'artifacts');
const exeCandidates = [];
function walk(dir, depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, depth + 1);
    else if (/\.exe$/i.test(name) && /ClassroomDesk/i.test(name)) exeCandidates.push(p);
  }
}
walk(artDir);
walk(path.join(root, 'apps/student-desktop/release'));
walk(path.join(root, 'releases'));

if (exeCandidates.length) {
  const sample = exeCandidates[0];
  const sha = `${sample}.sha256`;
  ok('unsigned.exe', `${exeCandidates.length} found; sample=${path.relative(root, sample)}`);
  if (fs.existsSync(sha)) ok('unsigned.sha256', path.relative(root, sha));
  else fail('unsigned.sha256', `missing beside ${path.relative(root, sample)}`);
} else {
  fail(
    'unsigned.exe',
    'no ClassroomDesk*.exe under artifacts/ / apps/student-desktop/release/ / releases/ — download CI artifact or npm run dist:win on Windows',
  );
}

const cfg = path.join(root, 'apps/student-desktop/resources/config.json');
if (fs.existsSync(cfg)) {
  try {
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    const api = String(j.apiBase ?? '');
    if (/127\.0\.0\.1|localhost/i.test(api)) {
      ok('config.localDev', `apiBase=${api} (dev OK; USB pack must use LAN IP)`);
    } else if (api) {
      ok('config.apiBase', api);
    } else {
      fail('config.apiBase', 'empty apiBase');
    }
  } catch (e) {
    fail('config.parse', e instanceof Error ? e.message : String(e));
  }
} else {
  fail('config.json', 'missing apps/student-desktop/resources/config.json');
}

console.log('\nWindows teacher host (run on the teacher PC):');
console.log('  powershell -ExecutionPolicy Bypass -File .\\scripts\\windows-set-fixed-ip.ps1');
console.log('  powershell -ExecutionPolicy Bypass -File .\\scripts\\windows-teacher-host.ps1 -SmokeTest');
console.log('  powershell -ExecutionPolicy Bypass -File .\\scripts\\windows-autostart-server.ps1');
console.log('See docs/LOCAL_USB_CHECKLIST.md');

const failed = log.filter((x) => !x.ok);
console.log(`\n${failed.length ? 'FAILED' : 'PASSED'} — ${log.length - failed.length}/${log.length} checks`);
if (failed.length) process.exit(1);
