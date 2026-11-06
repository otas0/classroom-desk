#!/usr/bin/env node
/**
 * Write a classroom-specific student config.json then print dist:win hint.
 * Usage:
 *   node scripts/pack-classroom-config.mjs --apiBase http://192.168.1.50:8787 --classId <uuid>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const apiBase = String(args.apiBase ?? '').replace(/\/$/, '');
const classId = String(args.classId ?? '').trim();
if (!apiBase || !classId) {
  console.error('Required: --apiBase http://TEACHER_IP:8787 --classId <id>');
  process.exit(1);
}

const out = path.join(root, 'apps/student-desktop/resources/config.json');
const cfg = {
  apiBase,
  classId,
  comment: 'Classroom-specific pack. Do not use 127.0.0.1 on student PCs.',
};
fs.writeFileSync(out, JSON.stringify(cfg, null, 2) + '\n');
console.log('Wrote', out);
console.log(JSON.stringify(cfg, null, 2));
console.log('Next: npm run dist:win --workspace=@classroom-desk/student-desktop');
console.log('Store installers per classroom under releases/<teacher-ip>/');
