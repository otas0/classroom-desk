/**
 * Soft-load .env for classroom minimal deploy (no dotenv dependency).
 * Does not override existing process.env. Safe for Pilot teacher hosts.
 */
import fs from 'node:fs';
import path from 'node:path';

function parseAndApply(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  let applied = 0;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    if (!k || process.env[k] != null && process.env[k] !== '') continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
    applied += 1;
  }
  if (applied) {
    console.log(`[env] loaded ${applied} key(s) from ${filePath}`);
  }
  return true;
}

const cwd = process.cwd();
const candidates = [
  process.env.CLASSROOM_DESK_ENV_FILE?.trim(),
  path.join(cwd, '.env'),
  path.join(cwd, '..', '..', '.env'), // apps/server → repo root
  path.join(cwd, '..', '.env'),
].filter(Boolean) as string[];

for (const p of candidates) {
  if (parseAndApply(path.resolve(p))) break;
}
