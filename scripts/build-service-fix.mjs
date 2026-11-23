#!/usr/bin/env node
/**
 * Build ClassroomDesk-Service-Fix-*-x64.exe — standalone patch for
 * "127.0.0.1:8787/health won't open". Teachers double-click; no CMD typing.
 *
 *   npm run pack:service-fix
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(root, 'ClassroomDesk-Dist');
const cache = path.join(root, '.cache', 'teacher-setup-tools');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.0.0');
const outExe = path.join(distRoot, `ClassroomDesk-Service-Fix-${version}-x64.exe`);

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}
function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function ensureHost7zz() {
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['7zz'], {
    encoding: 'utf8',
  });
  if (onPath.status === 0 && onPath.stdout.trim()) {
    return onPath.stdout.trim().split(/\r?\n/)[0];
  }
  const onPath7z = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['7z'], {
    encoding: 'utf8',
  });
  if (onPath7z.status === 0 && onPath7z.stdout.trim()) {
    return onPath7z.stdout.trim().split(/\r?\n/)[0];
  }
  const cached = path.join(cache, 'mac7z', '7zz');
  if (fs.existsSync(cached)) return cached;
  throw new Error('Install 7zz/7z on PATH (or run pack:teacher-setup once to cache tools)');
}

function ensureSfx() {
  const sfx = path.join(cache, '7zSD.sfx');
  if (fs.existsSync(sfx) && fs.statSync(sfx).size > 1000) return sfx;
  const alt = path.join(cache, 'extra-sfx', '7zSD.sfx');
  if (fs.existsSync(alt)) {
    fs.copyFileSync(alt, sfx);
    return sfx;
  }
  throw new Error('7zSD.sfx missing — run npm run pack:teacher-setup once first');
}

function main() {
  const seven = ensureHost7zz();
  const sfx = ensureSfx();
  mkdirp(distRoot);

  const staging = path.join(cache, 'service-fix-staging');
  const archive = path.join(cache, 'service-fix.7z');
  rmrf(staging);
  mkdirp(staging);

  const files = [
    'setup-service-fix.cmd',
    'fix-classroom-service.ps1',
    'Start-ClassroomDesk.cmd',
    'ensure-windows-node.ps1',
  ];
  for (const f of files) {
    const src = path.join(root, f);
    if (!fs.existsSync(src)) throw new Error(`missing ${f}`);
    fs.copyFileSync(src, path.join(staging, f));
  }
  fs.writeFileSync(
    path.join(staging, 'SERVICE-FIX.txt'),
    `Classroom Desk — Service Fix ${version}

Double-click this installer (or setup-service-fix.cmd).
Fixes local API so http://127.0.0.1:8787/health and /admin/ open again.
No commands to type. Re-run anytime from Desktop\\ClassroomDesk-Fix-Service.cmd
`,
    'utf8',
  );

  rmrf(archive);
  console.log('compress service-fix payload…');
  execFileSync(seven, ['a', '-t7z', '-mx=9', '-m0=lzma2', archive, '*'], {
    cwd: staging,
    stdio: 'inherit',
  });

  const config = `;!@Install@!UTF-8!
Title="Classroom Desk Service Fix"
ExtractTitle="Classroom Desk"
RunProgram="setup-service-fix.cmd"
GUIMode="1"
;!@InstallEnd@!
`;
  const configPath = path.join(cache, 'sfx-service-fix-config.txt');
  fs.writeFileSync(configPath, config, 'utf8');

  console.log('link SFX →', outExe);
  fs.writeFileSync(
    outExe,
    Buffer.concat([fs.readFileSync(sfx), fs.readFileSync(configPath), fs.readFileSync(archive)]),
  );
  const stable = path.join(distRoot, 'ClassroomDesk-Service-Fix-x64.exe');
  fs.copyFileSync(outExe, stable);
  const give = path.join(root, 'Give-To-Teacher');
  if (fs.existsSync(give) || true) {
    mkdirp(give);
    fs.copyFileSync(stable, path.join(give, 'Service-Fix.exe'));
  }
  const mb = (fs.statSync(outExe).size / (1024 * 1024)).toFixed(2);
  console.log(`OK  ${outExe} (${mb} MB)`);
  console.log(`OK  ${stable}`);
  console.log('Ship as: Service-Fix.exe / ClassroomDesk-Service-Fix-x64.exe');
}

main();
