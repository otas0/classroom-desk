#!/usr/bin/env node
/**
 * Verify local 证据/C2-YYYYMMDD/ is complete (no PLACEHOLDER videos).
 * Does not record — fails until Windows operator replaces placeholders.
 *
 * Usage:
 *   npm run verify:c2-evidence
 *   CD_EVIDENCE_DIR=... npm run verify:c2-evidence -- 20261112
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.CD_EVIDENCE_DIR || path.join(root, '证据');
const dayArg = process.argv[2];
const day =
  dayArg ||
  [...fs.existsSync(base) ? fs.readdirSync(base) : []]
    .filter((n) => /^C2-\d{8}$/.test(n))
    .sort()
    .at(-1)?.replace(/^C2-/, '') ||
  null;

if (!day) {
  console.error('No 证据/C2-YYYYMMDD/ found. Run: npm run init:c2-evidence');
  process.exit(1);
}

const dest = path.join(base, `C2-${day}`);
const required = [
  'C2-intune-version.txt',
  'C2-alttab-win.mp4',
  'C2-taskmgr-deny.mp4',
  'C2-titlebar.png',
  'C2-intune-policy.png',
];
const optional = ['C2-narrator.mp4', 'README.txt'];

const problems = [];
if (!fs.existsSync(dest)) {
  console.error(`Missing ${dest}. Run: npm run init:c2-evidence`);
  process.exit(1);
}

const placeholder = path.join(dest, 'C2-alttab-win.mp4.PLACEHOLDER');
if (fs.existsSync(placeholder)) {
  problems.push('C2-alttab-win.mp4.PLACEHOLDER still present — replace with real recording');
}

for (const name of required) {
  const p = path.join(dest, name);
  if (!fs.existsSync(p)) {
    problems.push(`missing ${name}`);
    continue;
  }
  const st = fs.statSync(p);
  if (st.size < 32) problems.push(`${name} too small (${st.size} bytes)`);
  if (name.endsWith('.mp4') && st.size < 50_000) {
    problems.push(`${name} looks like a stub (${st.size} bytes; expect real screen recording)`);
  }
  if (name === 'C2-intune-version.txt') {
    const text = fs.readFileSync(p, 'utf8');
    if (/YYYY-MM-DD|例如 22621|是 \/ 否/.test(text) && !/HideTaskManager 生效:\s*是/.test(text)) {
      problems.push('C2-intune-version.txt still has template blanks (fill 22H2/24H2 + 是/否)');
    }
  }
}

const presentOptional = optional.filter((n) => fs.existsSync(path.join(dest, n)));

console.log(
  JSON.stringify(
    {
      dir: dest,
      ok: problems.length === 0,
      problems,
      presentOptional,
      note:
        problems.length === 0
          ? 'C2 evidence pack looks complete (operator-filled on Windows).'
          : 'Incomplete — school Windows + Intune trial still required.',
    },
    null,
    2,
  ),
);
process.exit(problems.length === 0 ? 0 : 1);
