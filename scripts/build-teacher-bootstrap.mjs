#!/usr/bin/env node
/**
 * Tiny Teacher-Bootstrap.exe for public / slow links.
 * Ships install scripts only; first run pulls ClassroomDesk-*-win-x64.zip
 * via install-teacher.ps1 -BootstrapOnline (mirrors + curl resume).
 *
 * Full offline USB still uses Teacher-Setup.exe (complete pack).
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
const outExe = path.join(distRoot, `ClassroomDesk-Teacher-Bootstrap-${version}-x64.exe`);
const SEVEN_VER = '2409';
const SEVEN_TAG = '24.09';

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}
function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function download(url, dest) {
  console.log('GET', url);
  mkdirp(path.dirname(dest));
  const r = spawnSync('curl', ['-fsSL', '--connect-timeout', '20', '--max-time', '600', '-o', dest, url], {
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`download failed: ${url}`);
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
    throw new Error(`download too small: ${dest}`);
  }
}

function downloadFirst(urls, dest) {
  let last;
  for (const u of urls) {
    try {
      download(u, dest);
      return;
    } catch (e) {
      last = e;
      console.warn(String(e.message || e));
    }
  }
  throw last || new Error('download failed');
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

  mkdirp(cache);
  if (process.platform === 'darwin') {
    const tar = path.join(cache, `7z${SEVEN_VER}-mac.tar.xz`);
    if (!fs.existsSync(tar) || fs.statSync(tar).size < 1000) {
      downloadFirst(
        [
          `https://github.com/ip7z/7zip/releases/download/${SEVEN_TAG}/7z${SEVEN_VER}-mac.tar.xz`,
          `https://www.7-zip.org/a/7z${SEVEN_VER}-mac.tar.xz`,
        ],
        tar,
      );
    }
    const extractDir = path.join(cache, 'mac7z');
    rmrf(extractDir);
    mkdirp(extractDir);
    execFileSync('tar', ['-xJf', tar, '-C', extractDir], { stdio: 'inherit' });
    const candidates = [];
    function walk(d) {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.name === '7zz' || ent.name === '7za') candidates.push(p);
      }
    }
    walk(extractDir);
    if (!candidates.length) throw new Error('7zz not found');
    fs.chmodSync(candidates[0], 0o755);
    return candidates[0];
  }
  throw new Error('Install 7zz/7z on PATH for bootstrap SFX build');
}

function ensureSfx() {
  const sfx = path.join(cache, '7zSD.sfx');
  if (fs.existsSync(sfx) && fs.statSync(sfx).size > 1000) return sfx;
  // Reuse tools from full teacher-setup build when present
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

  const staging = path.join(cache, 'bootstrap-staging');
  const archive = path.join(cache, 'teacher-bootstrap.7z');
  rmrf(staging);
  mkdirp(staging);

  const files = [
    'setup-from-bootstrap.cmd',
    'install-teacher.ps1',
    'ensure-windows-node.ps1',
    'Install.bat',
    'Install-Teacher.bat',
    'Check-Pack.bat',
    'Unblock-ClassroomDesk.bat',
    'Start-ClassroomDesk.cmd',
    'package.json',
  ];
  for (const f of files) {
    const src = path.join(root, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(staging, f));
  }
  fs.writeFileSync(
    path.join(staging, '.classroom-desk-bootstrap'),
    JSON.stringify({ bootstrap: true, version, packedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
  // Minimal package.json so Get-LocalTag / version resolve
  if (!fs.existsSync(path.join(staging, 'package.json'))) {
    fs.writeFileSync(
      path.join(staging, 'package.json'),
      JSON.stringify({ name: 'classroom-desk', version, private: true }, null, 2),
      'utf8',
    );
  }

  rmrf(archive);
  console.log('compress bootstrap payload…');
  execFileSync(seven, ['a', '-t7z', '-mx=9', '-m0=lzma2', archive, '*'], {
    cwd: staging,
    stdio: 'inherit',
  });

  const config = `;!@Install@!UTF-8!
Title="Classroom Desk Bootstrap"
ExtractTitle="Classroom Desk"
RunProgram="setup-from-bootstrap.cmd"
GUIMode="1"
;!@InstallEnd@!
`;
  const configPath = path.join(cache, 'sfx-bootstrap-config.txt');
  fs.writeFileSync(configPath, config, 'utf8');

  console.log('link SFX →', outExe);
  fs.writeFileSync(
    outExe,
    Buffer.concat([fs.readFileSync(sfx), fs.readFileSync(configPath), fs.readFileSync(archive)]),
  );
  const stable = path.join(distRoot, 'ClassroomDesk-Teacher-Bootstrap-x64.exe');
  fs.copyFileSync(outExe, stable);
  const mb = (fs.statSync(outExe).size / (1024 * 1024)).toFixed(2);
  console.log(`OK  ${outExe} (${mb} MB)`);
  console.log(`OK  ${stable}`);
}

main();
