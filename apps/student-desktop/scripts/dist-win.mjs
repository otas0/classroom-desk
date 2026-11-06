#!/usr/bin/env node
/**
 * Windows NSIS build helper.
 * With CSC_LINK → sign; without → signExecutable=false (avoid schema/CLI mangling).
 */
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
process.exit(pack.status ?? 1);
