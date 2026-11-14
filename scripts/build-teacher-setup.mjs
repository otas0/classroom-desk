#!/usr/bin/env node
/**
 * Build ClassroomDesk-Teacher-Setup-*-x64.exe (Windows one-click installer).
 * Pack host may be macOS/Linux/Windows — output is a Windows PE SFX.
 *
 *   npm run pack            # includes this step
 *   npm run pack:teacher    # setup only (expects ClassroomDesk-Dist ready)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(root, 'ClassroomDesk-Dist');
const desk = path.join(distRoot, 'ClassroomDesk');
const cache = path.join(root, '.cache', 'teacher-setup-tools');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.0.0');
const outExe = path.join(distRoot, `ClassroomDesk-Teacher-Setup-${version}-x64.exe`);
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

function host7zzName() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? '7zz-mac-arm64' : '7zz-mac-x64';
  }
  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? '7zz-linux-arm64' : '7zz-linux-x64';
  }
  return '7zz.exe';
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
    const urls = [
      `https://github.com/ip7z/7zip/releases/download/${SEVEN_TAG}/7z${SEVEN_VER}-mac.tar.xz`,
      `https://www.7-zip.org/a/7z${SEVEN_VER}-mac.tar.xz`,
    ];
    if (!fs.existsSync(tar) || fs.statSync(tar).size < 1000) downloadFirst(urls, tar);
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
    if (!candidates.length) throw new Error('7zz not found inside mac 7-Zip tarball');
    const bin = candidates[0];
    fs.chmodSync(bin, 0o755);
    return bin;
  }

  if (process.platform === 'linux') {
    const txz = path.join(cache, `7z${SEVEN_VER}-linux-x64.tar.xz`);
    downloadFirst(
      [
        `https://github.com/ip7z/7zip/releases/download/${SEVEN_TAG}/7z${SEVEN_VER}-linux-x64.tar.xz`,
        `https://www.7-zip.org/a/7z${SEVEN_VER}-linux-x64.tar.xz`,
      ],
      txz,
    );
    const extractDir = path.join(cache, 'linux7z');
    rmrf(extractDir);
    mkdirp(extractDir);
    execFileSync('tar', ['-xJf', txz, '-C', extractDir], { stdio: 'inherit' });
    const bin = path.join(extractDir, '7zz');
    if (!fs.existsSync(bin)) throw new Error('7zz missing after linux extract');
    fs.chmodSync(bin, 0o755);
    return bin;
  }

  // Windows: standalone 7zr.exe (create + extract)
  const sevenZr = path.join(cache, '7zr.exe');
  if (!fs.existsSync(sevenZr) || fs.statSync(sevenZr).size < 1000) {
    downloadFirst(
      [
        `https://github.com/ip7z/7zip/releases/download/${SEVEN_TAG}/7zr.exe`,
        `https://www.7-zip.org/a/7zr.exe`,
      ],
      sevenZr,
    );
  }
  return sevenZr;
}

function ensureSfx() {
  const sfx = path.join(cache, '7zSD.sfx');
  if (fs.existsSync(sfx) && fs.statSync(sfx).size > 10000) return sfx;

  // Modern 7z*-extra.7z no longer ships installer SFX; use classic 7z920_extra.
  const extra = path.join(cache, '7z920_extra.7z');
  if (!fs.existsSync(extra) || fs.statSync(extra).size < 1000) {
    downloadFirst(
      [
        'https://www.7-zip.org/a/7z920_extra.7z',
        'https://github.com/ip7z/7zip/releases/download/9.20/7z920_extra.7z',
      ],
      extra,
    );
  }

  const seven = ensureHost7zz();
  const extractDir = path.join(cache, 'extra-sfx');
  rmrf(extractDir);
  mkdirp(extractDir);
  execFileSync(seven, ['x', extra, `-o${extractDir}`, '-y'], { stdio: 'inherit' });

  const found = [];
  function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.toLowerCase() === '7zsd.sfx') found.push(p);
    }
  }
  walk(extractDir);
  if (!found.length) throw new Error('7zSD.sfx not found in 7z920_extra.7z');
  fs.copyFileSync(found[0], sfx);
  return sfx;
}

function main() {
  if (!fs.existsSync(path.join(desk, '.classroom-desk-ready')) && !fs.existsSync(path.join(desk, '.classroom-desk-offline-ready'))) {
    throw new Error(`Product pack missing. Run: npm run pack\nExpected: ${desk}`);
  }
  if (!fs.existsSync(path.join(desk, 'install-teacher.ps1'))) {
    throw new Error('install-teacher.ps1 missing in product pack');
  }

  // Ensure installer bootstrap is present in the payload.
  const bootstrapSrc = path.join(root, 'setup-from-installer.cmd');
  const bootstrapDest = path.join(desk, 'setup-from-installer.cmd');
  if (fs.existsSync(bootstrapSrc)) fs.copyFileSync(bootstrapSrc, bootstrapDest);
  if (!fs.existsSync(bootstrapDest)) throw new Error('setup-from-installer.cmd missing');

  mkdirp(distRoot);
  mkdirp(cache);

  const seven = ensureHost7zz();
  const sfx = ensureSfx();

  const staging = path.join(cache, 'payload-staging');
  const archive = path.join(cache, 'teacher-payload.7z');
  rmrf(staging);
  mkdirp(staging);
  // Payload root = contents of ClassroomDesk (setup-from-installer.cmd at top)
  fs.cpSync(desk, staging, { recursive: true });

  rmrf(archive);
  console.log('compress payload…');
  execFileSync(seven, ['a', '-t7z', '-mx=7', '-m0=lzma2', archive, '*'], {
    cwd: staging,
    stdio: 'inherit',
  });

  // Extract to TEMP (not C:\ClassroomDesk) so re-runs cannot wipe live .env / classroom.db.
  // setup-from-installer.cmd merges into C:\ClassroomDesk and preserves teacher data.
  const config = `;!@Install@!UTF-8!
Title="Classroom Desk"
ExtractTitle="Classroom Desk"
RunProgram="setup-from-installer.cmd"
GUIMode="1"
;!@InstallEnd@!
`;
  const configPath = path.join(cache, 'sfx-config.txt');
  fs.writeFileSync(configPath, config, 'utf8');

  console.log('link SFX →', outExe);
  const sfxBuf = fs.readFileSync(sfx);
  const cfgBuf = fs.readFileSync(configPath);
  const arcBuf = fs.readFileSync(archive);
  fs.writeFileSync(outExe, Buffer.concat([sfxBuf, cfgBuf, arcBuf]));

  // Stable name for "just double-click this"
  const stable = path.join(distRoot, 'ClassroomDesk-Teacher-Setup-x64.exe');
  fs.copyFileSync(outExe, stable);

  const mb = (fs.statSync(outExe).size / (1024 * 1024)).toFixed(1);
  console.log(`OK  ${outExe} (${mb} MB)`);
  console.log(`OK  ${stable}`);
  console.log('Teacher: double-click ClassroomDesk-Teacher-Setup-x64.exe');
}

main();
