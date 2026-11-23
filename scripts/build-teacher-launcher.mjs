#!/usr/bin/env node
/**
 * Build ClassroomDesk.exe — daily one-click teacher launcher (7z SFX).
 * Double-click → force Windows Node under C:\ClassroomDesk → start API → open Admin.
 *
 *   npm run pack:teacher-launcher
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
const outExe = path.join(distRoot, `ClassroomDesk-Launcher-${version}-x64.exe`);

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

  const staging = path.join(cache, 'teacher-launcher-staging');
  const archive = path.join(cache, 'teacher-launcher.7z');
  rmrf(staging);
  mkdirp(staging);

  const files = [
    'launch-classroom-desk.cmd',
    'ensure-windows-node.ps1',
    'Start-ClassroomDesk.cmd',
    'Force-Windows-Node.bat',
  ];
  for (const f of files) {
    const src = path.join(root, f);
    if (!fs.existsSync(src)) throw new Error(`missing ${f}`);
    fs.copyFileSync(src, path.join(staging, f));
  }
  fs.writeFileSync(
    path.join(staging, 'README.txt'),
    `Classroom Desk launcher ${version}

Double-click ClassroomDesk.exe after Teacher-Setup.exe has installed once.
Starts the local API at C:\\ClassroomDesk and opens Admin.
`,
    'utf8',
  );

  rmrf(archive);
  console.log('compress teacher-launcher payload…');
  execFileSync(seven, ['a', '-t7z', '-mx=9', '-m0=lzma2', archive, '*'], {
    cwd: staging,
    stdio: 'inherit',
  });

  const config = `;!@Install@!UTF-8!
Title="Classroom Desk"
ExtractTitle="Classroom Desk"
RunProgram="launch-classroom-desk.cmd"
GUIMode="1"
;!@InstallEnd@!
`;
  const configPath = path.join(cache, 'sfx-teacher-launcher-config.txt');
  fs.writeFileSync(configPath, config, 'utf8');

  console.log('link SFX →', outExe);
  fs.writeFileSync(
    outExe,
    Buffer.concat([fs.readFileSync(sfx), fs.readFileSync(configPath), fs.readFileSync(archive)]),
  );

  const stable = path.join(distRoot, 'ClassroomDesk-Launcher-x64.exe');
  const alias = path.join(distRoot, 'ClassroomDesk.exe');
  fs.copyFileSync(outExe, stable);
  fs.copyFileSync(outExe, alias);

  const give = path.join(root, 'Give-To-Teacher');
  mkdirp(give);
  fs.copyFileSync(alias, path.join(give, 'ClassroomDesk.exe'));

  const mb = (fs.statSync(outExe).size / (1024 * 1024)).toFixed(2);
  console.log(`OK  ${outExe} (${mb} MB)`);
  console.log(`OK  ${alias}`);
  console.log('Ship as: ClassroomDesk.exe (daily start)');
}

main();
