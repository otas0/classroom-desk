#!/usr/bin/env node
/**
 * Windows NSIS build helper.
 * With CSC_LINK → sign; without → signExecutable=false (avoid schema/CLI mangling).
 *
 * Arch via CD_WIN_ARCH:
 *   x64 (default) | arm64 | dual
 * Artifacts: ClassroomDesk-Setup-<ver>-<arch>.exe
 * Plus legacy alias ClassroomDesk-Setup-<ver>.exe → x64 (USB/CI scripts).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(root, '..');
const hasCert = Boolean(process.env.CSC_LINK?.trim());
const archArg = String(process.argv[2] ?? process.env.CD_WIN_ARCH ?? 'x64')
  .trim()
  .toLowerCase();
const archMode = ['x64', 'arm64', 'dual'].includes(archArg) ? archArg : 'x64';

const build = spawnSync('npm', ['run', 'build'], { cwd: pkgDir, stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const ebArgs = ['electron-builder', '--win', 'nsis', '--publish', 'never'];
if (archMode === 'dual') {
  ebArgs.push('--x64', '--arm64');
} else if (archMode === 'arm64') {
  ebArgs.push('--arm64');
} else {
  ebArgs.push('--x64');
}

if (!hasCert) {
  console.log('[dist-win] CSC_LINK unset — unsigned build (win.signExecutable=false)');
  ebArgs.push('--config.win.signExecutable=false');
} else {
  console.log('[dist-win] CSC_LINK set — signing enabled');
  ebArgs.push('--config.win.signExecutable=true');
}
console.log(`[dist-win] arch=${archMode} → ${ebArgs.filter((a) => a.startsWith('--')).join(' ')}`);

const pack = spawnSync('npx', ebArgs, { cwd: pkgDir, stdio: 'inherit', shell: true, env: process.env });
if (pack.status !== 0) process.exit(pack.status ?? 1);

const releaseDir = path.join(pkgDir, 'release');
const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const version = String(pkgJson.version ?? '').trim();

if (fs.existsSync(releaseDir) && version) {
  // Legacy USB/CI name without arch → copy of x64.
  const x64Named = path.join(releaseDir, `ClassroomDesk-Setup-${version}-x64.exe`);
  const legacy = path.join(releaseDir, `ClassroomDesk-Setup-${version}.exe`);
  if (fs.existsSync(x64Named)) {
    fs.copyFileSync(x64Named, legacy);
    console.log(`[dist-win] legacy alias ${path.basename(legacy)} ← x64`);
  }

  for (const name of fs.readdirSync(releaseDir)) {
    if (!/ClassroomDesk.*\.exe$/i.test(name) || name.endsWith('.sha256')) continue;
    const exe = path.join(releaseDir, name);
    const hash = createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
    const side = `${exe}.sha256`;
    fs.writeFileSync(side, `${hash}  ${name}\n`);
    console.log(`[dist-win] wrote ${path.basename(side)}`);
  }
}

const repoRoot = path.resolve(pkgDir, '../..');
console.log('[dist-win] running verify:exit-lock-packaged …');
const verify = spawnSync('npm', ['run', 'verify:exit-lock-packaged'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, REQUIRE_WIN_EXE: '1' },
});
process.exit(verify.status ?? 0);
