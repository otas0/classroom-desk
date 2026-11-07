#!/usr/bin/env node
/**
 * Windows NSIS build helper.
 * With CSC_LINK → sign; without → signExecutable=false (avoid schema/CLI mangling).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(root, '..');
const hasCert = Boolean(process.env.CSC_LINK?.trim());

const build = spawnSync('npm', ['run', 'build'], { cwd: pkgDir, stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const ebArgs = ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never'];
if (!hasCert) {
  console.log('[dist-win] CSC_LINK unset — unsigned build (win.signExecutable=false)');
  ebArgs.push('--config.win.signExecutable=false');
} else {
  console.log('[dist-win] CSC_LINK set — signing enabled');
  ebArgs.push('--config.win.signExecutable=true');
}

const pack = spawnSync('npx', ebArgs, { cwd: pkgDir, stdio: 'inherit', shell: true, env: process.env });
if (pack.status !== 0) process.exit(pack.status ?? 1);

const releaseDir = path.join(pkgDir, 'release');
if (fs.existsSync(releaseDir)) {
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
