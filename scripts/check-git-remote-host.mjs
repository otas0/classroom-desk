#!/usr/bin/env node
/**
 * Guard: classroom-desk must use Host github.com-classroom-desk (SSH :443 deploy key).
 * Do not point origin at generic github.com — that Host prefers buusdo/shield keys.
 *
 *   npm run check:git-remote
 */
import { execSync } from 'node:child_process';

const want = 'git@github.com-classroom-desk:otas0/classroom-desk.git';
let url = '';
try {
  url = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
} catch (e) {
  console.error('Unable to read git remote origin:', e.message);
  process.exit(1);
}

const ok =
  url === want ||
  url === `ssh://${want.replace(':', '/')}` ||
  url.startsWith('git@github.com-classroom-desk:otas0/classroom-desk');

if (!ok) {
  console.error(
    [
      `origin is "${url}"`,
      `expected Host alias remote like: ${want}`,
      'Fix: git remote set-url origin git@github.com-classroom-desk:otas0/classroom-desk.git',
      'SSH config must define Host github.com-classroom-desk → IdentityFile ~/.ssh/id_ed25519_classroom_desk',
    ].join('\n'),
  );
  process.exit(2);
}

console.log(`OK: origin uses classroom-desk SSH host (${url})`);
