#!/usr/bin/env node
/**
 * Build Teacher-Fix.exe — one-click repair for old teacher PCs (7z SFX).
 * Force Windows Node + reset login to teacher/admin. No bat hunting.
 *
 *   npm run pack:teacher-fix
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureHost7zz, ensureSfx, sfxCache as cache } from './lib/sevenZipSfx.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(root, 'ClassroomDesk-Dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.0.0');
const outExe = path.join(distRoot, `ClassroomDesk-Teacher-Fix-${version}-x64.exe`);

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}
function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function main() {
  const seven = ensureHost7zz();
  const sfx = ensureSfx();
  mkdirp(distRoot);

  const staging = path.join(cache, 'teacher-fix-staging');
  const archive = path.join(cache, 'teacher-fix.7z');
  rmrf(staging);
  mkdirp(staging);

  const files = [
    'setup-teacher-fix.cmd',
    'ensure-windows-node.ps1',
    'reset-teacher-login.ps1',
    'reset-teacher-login.mjs',
    'Force-Windows-Node.bat',
    'Fix-Teacher-PC.bat',
    'Reset-Teacher-Login.bat',
    'Start-ClassroomDesk.cmd',
    'launch-classroom-desk.cmd',
  ];
  for (const f of files) {
    const src = path.join(root, f);
    if (!fs.existsSync(src)) throw new Error(`missing ${f}`);
    fs.copyFileSync(src, path.join(staging, f));
  }

  // Embed daily launcher exe if already built (optional).
  const launcherSrc = [
    path.join(distRoot, 'ClassroomDesk.exe'),
    path.join(distRoot, 'ClassroomDesk-Launcher-x64.exe'),
  ].find((p) => fs.existsSync(p));
  if (launcherSrc) {
    fs.copyFileSync(launcherSrc, path.join(staging, 'ClassroomDesk.exe'));
  }

  fs.writeFileSync(
    path.join(staging, 'README.txt'),
    `Classroom Desk Teacher Fix ${version}

Double-click Teacher-Fix.exe on a PC that already has Classroom Desk installed.
- Re-downloads official Windows Node (CN + overseas mirrors)
- Resets login to teacher / admin (change password in Settings after)
`,
    'utf8',
  );

  rmrf(archive);
  console.log('compress teacher-fix payload…');
  execFileSync(seven, ['a', '-t7z', '-mx=9', '-m0=lzma2', archive, '*'], {
    cwd: staging,
    stdio: 'inherit',
  });

  const config = `;!@Install@!UTF-8!
Title="Classroom Desk Teacher Fix"
ExtractTitle="Classroom Desk"
RunProgram="setup-teacher-fix.cmd"
GUIMode="1"
;!@InstallEnd@!
`;
  const configPath = path.join(cache, 'sfx-teacher-fix-config.txt');
  fs.writeFileSync(configPath, config, 'utf8');

  console.log('link SFX →', outExe);
  fs.writeFileSync(
    outExe,
    Buffer.concat([fs.readFileSync(sfx), fs.readFileSync(configPath), fs.readFileSync(archive)]),
  );

  const stable = path.join(distRoot, 'ClassroomDesk-Teacher-Fix-x64.exe');
  fs.copyFileSync(outExe, stable);

  const give = path.join(root, 'Give-To-Teacher');
  mkdirp(give);
  fs.copyFileSync(stable, path.join(give, 'Teacher-Fix.exe'));

  const mb = (fs.statSync(outExe).size / (1024 * 1024)).toFixed(2);
  console.log(`OK  ${outExe} (${mb} MB)`);
  console.log(`OK  ${path.join(give, 'Teacher-Fix.exe')}`);
  console.log('Ship as: Teacher-Fix.exe');
}

main();
