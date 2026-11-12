import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function detectArch(name: string): 'arm64' | 'x64' | 'unknown' {
  if (/-arm64\./i.test(name) || /arm64/i.test(name)) return 'arm64';
  if (/-x64\./i.test(name) || /x64|amd64/i.test(name)) return 'x64';
  if (/ClassroomDesk-Setup-[\d.]+\.exe$/i.test(name)) return 'x64';
  return 'unknown';
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-upgrades-'));
const files = ['ClassroomDesk-Setup-0.1.7-arm64.exe', 'ClassroomDesk-Setup-0.1.7-x64.exe'];
for (const f of files) fs.writeFileSync(path.join(dir, f), f);

const setups = files.map((name) => ({ name, arch: detectArch(name) }));
const preferArm = setups.find((f) => f.arch === 'arm64');
const preferX64 = setups.find((f) => f.arch === 'x64');
assert.equal(preferArm?.arch, 'arm64');
assert.equal(preferX64?.arch, 'x64');
assert.equal(detectArch('ClassroomDesk-Setup-0.1.7.exe'), 'x64');

console.log('upgradesLatest.test.ts ok');
