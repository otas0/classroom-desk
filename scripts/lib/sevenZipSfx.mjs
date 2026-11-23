/**
 * Shared 7-Zip host binary + 7zSD.sfx for Teacher SFX builders (Windows CI + macOS pack).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sfxCache = path.join(root, '.cache', 'teacher-setup-tools');
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

export function ensureHost7zz() {
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

  mkdirp(sfxCache);
  if (process.platform === 'darwin') {
    const tar = path.join(sfxCache, `7z${SEVEN_VER}-mac.tar.xz`);
    const urls = [
      `https://github.com/ip7z/7zip/releases/download/${SEVEN_TAG}/7z${SEVEN_VER}-mac.tar.xz`,
      `https://www.7-zip.org/a/7z${SEVEN_VER}-mac.tar.xz`,
    ];
    if (!fs.existsSync(tar) || fs.statSync(tar).size < 1000) downloadFirst(urls, tar);
    const extractDir = path.join(sfxCache, 'mac7z');
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
    const txz = path.join(sfxCache, `7z${SEVEN_VER}-linux-x64.tar.xz`);
    downloadFirst(
      [
        `https://github.com/ip7z/7zip/releases/download/${SEVEN_TAG}/7z${SEVEN_VER}-linux-x64.tar.xz`,
        `https://www.7-zip.org/a/7z${SEVEN_VER}-linux-x64.tar.xz`,
      ],
      txz,
    );
    const extractDir = path.join(sfxCache, 'linux7z');
    rmrf(extractDir);
    mkdirp(extractDir);
    execFileSync('tar', ['-xJf', txz, '-C', extractDir], { stdio: 'inherit' });
    const bin = path.join(extractDir, '7zz');
    if (!fs.existsSync(bin)) throw new Error('7zz missing after linux extract');
    fs.chmodSync(bin, 0o755);
    return bin;
  }

  const sevenZr = path.join(sfxCache, '7zr.exe');
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

export function ensureSfx() {
  const sfx = path.join(sfxCache, '7zSD.sfx');
  if (fs.existsSync(sfx) && fs.statSync(sfx).size > 10000) return sfx;

  const extra = path.join(sfxCache, '7z920_extra.7z');
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
  const extractDir = path.join(sfxCache, 'extra-sfx');
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
